/**
 * Outbound URL safety (SSRF defence).
 *
 * Ingested job URLs and redirect targets are attacker-influenced: a source can
 * point at `http://169.254.169.254/latest/meta-data/`, at localhost admin
 * panels, or at an internal host. Every outbound fetch of an ingested URL must
 * therefore be validated before the connection is made.
 *
 * This module:
 *   - accepts only http/https URLs with default ports and no embedded
 *     credentials,
 *   - rejects IP literals in loopback/private/link-local/CGNAT/metadata space,
 *   - resolves hostnames and rejects any host that resolves into those ranges
 *     (including every answer, so a mixed A-record cannot slip through).
 *
 * Residual risk: validation and connection are separate steps, so a DNS
 * answer can change in between (rebinding). Closing that window needs a custom
 * dispatcher that connects to the validated address; that is documented in
 * docs/ENGINEERING.md as follow-up work rather than claimed as solved.
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local + cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const v4ToInt = (ip: string): number =>
  ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

const inV4Range = (ip: string, base: string, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};

/** True for loopback, private, link-local, CGNAT, multicast and reserved IPv4. */
export function isBlockedIpv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  return BLOCKED_V4.some(([base, bits]) => inV4Range(ip, base, bits));
}

/** True for loopback, private, link-local, multicast and IPv4-mapped private IPv6. */
export function isBlockedIpv6(ip: string): boolean {
  if (isIP(ip) !== 6) return false;
  const lower = ip.toLowerCase();

  if (lower === '::' || lower === '::1') return true;

  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms.
  const mapped = lower.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
  const firstHextet = lower.split(':')[0] || '';
  const prefix = parseInt(firstHextet || '0', 16);
  if (Number.isNaN(prefix)) return true;

  if ((prefix & 0xfe00) === 0xfc00) return true;
  if ((prefix & 0xffc0) === 0xfe80) return true;
  if ((prefix & 0xff00) === 0xff00) return true;

  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  // Not an IP literal — callers should have resolved it first.
  return false;
}

/**
 * Validate a URL for outbound fetching. Throws UnsafeUrlError when the URL is
 * not something we are willing to connect to.
 *
 * `resolveDns: false` skips hostname resolution (used by unit tests and for
 * redirects that were already resolved).
 */
export async function assertSafeHttpUrl(
  raw: string,
  options: { resolveDns?: boolean } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`Unsupported URL protocol: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new UnsafeUrlError(`Unsupported port: ${url.port}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (!hostname) {
    throw new UnsafeUrlError('URL has no hostname');
  }

  if (hostname.toLowerCase() === 'localhost') {
    throw new UnsafeUrlError('localhost is not allowed');
  }

  const literal = isIP(hostname);
  if (literal) {
    if (isBlockedIp(hostname)) {
      throw new UnsafeUrlError(`Blocked IP address: ${hostname}`);
    }
    return url;
  }

  if (options.resolveDns === false) return url;

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new UnsafeUrlError(
      `Could not resolve ${hostname}: ${(error as Error).message}`,
    );
  }

  if (!addresses.length) {
    throw new UnsafeUrlError(`Could not resolve ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new UnsafeUrlError(
        `${hostname} resolves to a blocked address (${address})`,
      );
    }
  }

  return url;
}
