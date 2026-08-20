/**
 * Parse a TCP port number from an environment-style string.
 *
 * Guards against the silent-ephemeral-bind class of bug: `Number("") === 0`
 * and `Number("0") === 0`, so a bare `PORT=""`/`PORT=0` in the environment
 * used to make the server listen on a random port and appear "not running".
 * Anything that is not an integer in 1..65535 falls back to `fallback`.
 */
export function parsePort(
  raw: string | undefined,
  fallback = 3210, // must match the port the frontend proxy (/api/*) targets
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  if (value < 1 || value > 65535) return fallback;
  return value;
}
