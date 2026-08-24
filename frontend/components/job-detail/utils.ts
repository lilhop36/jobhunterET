/** Utility functions for the job detail page. */

/** Sanitise HTML: strip scripts/iframes and dangerous attributes. */
export function sanitiseHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * Strip all HTML tags and decode common entities from a string.
 * Used to sanitise fields like applyEmail that may contain raw HTML from scraping.
 */
export function cleanEmail(raw: string | null | undefined): string {
  if (!raw) return '';
  const stripped = raw
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/["'>]+/g, ' ')
    .trim();
  const match = stripped.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : stripped;
}

/**
 * Plain-text → HTML.
 * - Double newlines become paragraph breaks.
 * - Single newlines become <br/>.
 * - Lines that look like pipe-table rows become a <table>.
 */
export function plainToHtml(text: string): string {
  const blocks = text.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      const tableLines = lines.filter((l) => (l.match(/\|/g) ?? []).length >= 2);
      if (tableLines.length >= 2 && tableLines.length >= lines.length * 0.6) {
        const rows = lines
          .filter((l) => l.trim() && !/^[\s|\-]+$/.test(l))
          .map((l) => {
            const cells = l.split('|').map((c) => c.trim()).filter(Boolean);
            return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
          });
        return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0">${rows.join('')}</table>`;
      }
      return `<p>${lines.join('<br/>')}</p>`;
    })
    .join('');
}

/** Company initials from name. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Colour band for a score percentage. */
export function scoreBand(pct: number): 'high' | 'mid' | 'low' {
  if (pct >= 75) return 'high';
  if (pct >= 45) return 'mid';
  return 'low';
}

/** Format salary range. */
export function fmtSalary(
  salary: number | null,
  salaryMax: number | null,
  currency: string,
): string {
  if (salary == null) return '—';
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (salaryMax != null && salaryMax > salary)
    return `${currency} ${fmt(salary)} – ${fmt(salaryMax)}`;
  return `${currency} ${fmt(salary)}`;
}
