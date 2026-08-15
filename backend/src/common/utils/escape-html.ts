/**
 * Escape text for Telegram HTML parse mode (SEC-002).
 *
 * Telegram's HTML mode only allows a small set of tags; raw `& < >` in message
 * text either render as markup or make the Bot API reject the message with a
 * 400 — silently dropping the alert. Every source-controlled field (job titles,
 * companies, locations, URLs) must pass through this before interpolation.
 */
export function escHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
