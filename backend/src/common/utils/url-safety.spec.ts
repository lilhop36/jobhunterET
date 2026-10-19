import {
  assertSafeHttpUrl,
  isBlockedIp,
  isBlockedIpv6,
  UnsafeUrlError,
} from './url-safety';

describe('url-safety (SSRF guard)', () => {
  describe('isBlockedIp', () => {
    it.each([
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.5.4',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ])('blocks private/reserved IPv4 %s', (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34'])(
      'allows public IPv4 %s',
      (ip) => {
        expect(isBlockedIp(ip)).toBe(false);
      },
    );

    it.each(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1'])(
      'blocks private/reserved IPv6 %s',
      (ip) => {
        expect(isBlockedIpv6(ip)).toBe(true);
      },
    );

    it('blocks IPv4-mapped private addresses', () => {
      expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
      expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
    });

    it('allows a public IPv6 address', () => {
      expect(isBlockedIpv6('2001:4860:4860::8888')).toBe(false);
    });
  });

  describe('assertSafeHttpUrl', () => {
    it('rejects non-http(s) schemes', async () => {
      await expect(assertSafeHttpUrl('file:///etc/passwd')).rejects.toBeInstanceOf(
        UnsafeUrlError,
      );
      await expect(assertSafeHttpUrl('ftp://example.com/x')).rejects.toBeInstanceOf(
        UnsafeUrlError,
      );
      await expect(assertSafeHttpUrl('gopher://example.com/')).rejects.toBeInstanceOf(
        UnsafeUrlError,
      );
    });

    it('rejects loopback, private and metadata targets', async () => {
      for (const target of [
        'http://127.0.0.1/admin',
        'http://localhost:3000/',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.5/',
        'http://192.168.0.1/',
        'http://[::1]/',
      ]) {
        await expect(assertSafeHttpUrl(target)).rejects.toBeInstanceOf(
          UnsafeUrlError,
        );
      }
    });

    it('rejects embedded credentials', async () => {
      await expect(
        assertSafeHttpUrl('http://user:pass@example.com/'),
      ).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it('rejects non-standard ports', async () => {
      await expect(
        assertSafeHttpUrl('http://example.com:8080/'),
      ).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it('accepts a public HTTPS URL', async () => {
      const url = await assertSafeHttpUrl('https://example.com/jobs/1', {
        resolveDns: false,
      });
      expect(url.hostname).toBe('example.com');
    });

    it('accepts a public IP literal without DNS', async () => {
      const url = await assertSafeHttpUrl('http://8.8.8.8/');
      expect(url.hostname).toBe('8.8.8.8');
    });
  });
});
