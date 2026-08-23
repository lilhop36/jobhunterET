import { normalizeUrl, decodeHtmlEntities, cleanDescription, scoreDescriptionQuality, extractApplyMethod, normalizeSalary, normalizeCompany, buildFingerprint, truncateHtml, extractDeadlineFromDescription } from "./job-fidelity";

describe("normalizeUrl (FR-012f)", () => {
  it("strips tracking params", () => { expect(normalizeUrl("https://example.com/job?utm_source=google&id=123")).toBe("https://example.com/job?id=123"); });
  it("http to https", () => { expect(normalizeUrl("http://example.com/job")).toBe("https://example.com/job"); });
  it("keeps http for localhost", () => { expect(normalizeUrl("http://localhost:3000/job")).toBe("http://localhost:3000/job"); });
  it("resolves relative", () => { expect(normalizeUrl("/jobs/123", "https://example.com")).toBe("https://example.com/jobs/123"); });
  it("invalid stays as-is", () => { expect(normalizeUrl("not-a-url")).toBe("not-a-url"); });
});

describe("decodeHtmlEntities (FR-012d)", () => {
  it("named entities", () => { expect(decodeHtmlEntities("Tom &amp; Jerry")).toBe("Tom & Jerry"); });
  it("numeric entities", () => { expect(decodeHtmlEntities("&#8211;")).toBe("–"); });
  it("unknown preserved", () => { expect(decodeHtmlEntities("&unknown;")).toBe("&unknown;"); });
});

describe("cleanDescription (FR-012d)", () => {
  it("strips unwanted tags", () => { const r = cleanDescription("<nav>M</nav><p>C</p><script>a</script><footer>f</footer>"); expect(r).toContain("C"); expect(r).not.toContain("a"); });
  it("strips boilerplate", () => { const r = cleanDescription("<p>Apply now. Share on Twitter. (c) 2026.</p>"); expect(r).not.toMatch(/apply now/i); });
  it("collapses whitespace", () => { expect(cleanDescription("A     B")).toContain("A B"); });
  it("empty for empty", () => { expect(cleanDescription("")).toBe(""); });
});

describe("scoreDescriptionQuality (FR-012e)", () => {
  it("0 for empty", () => { expect(scoreDescriptionQuality("")).toBe(0); });
  it("penalizes truncation", () => { const c = "A".repeat(500); expect(scoreDescriptionQuality(c + ".../more")).toBeLessThan(scoreDescriptionQuality(c)); });
});

describe("extractApplyMethod (FR-012g)", () => {
  it("detects email", () => { const r = extractApplyMethod("https://x.com", "Apply via email to hr@co.com"); expect(r.applyMethod).toBe("EMAIL"); expect(r.applyEmail).toBe("hr@co.com"); });
  it("detects in-person", () => { expect(extractApplyMethod("https://x.com", "Submit in person").applyMethod).toBe("IN_PERSON"); });
  it("detects PDF", () => { expect(extractApplyMethod("https://x.com/app.pdf", "").applyMethod).toBe("PDF_FORM"); });
  it("defaults ONLINE_URL", () => { expect(extractApplyMethod("https://x.com/apply", "").applyMethod).toBe("ONLINE_URL"); });
});

describe("normalizeSalary (FR-012h)", () => {
  it("validates currencies", () => { expect(normalizeSalary(50000, "USD")).toEqual({ salary: 50000, currency: "USD" }); });
  it("defaults USD", () => { expect(normalizeSalary(50000, "XYZ")).toEqual({ salary: 50000, currency: "USD" }); });
  it("null for 0", () => { expect(normalizeSalary(0)).toEqual({ salary: null, currency: "USD" }); });
});

describe("normalizeCompany (FR-012h)", () => {
  it("strips suffixes", () => { expect(normalizeCompany("Acme PLC")).toBe("Acme"); expect(normalizeCompany("Tech Corp.")).toBe("Tech"); });
  it("preserves plain names", () => { expect(normalizeCompany("Google")).toBe("Google"); });
});

describe("buildFingerprint (FR-014)", () => {
  it("normalizes", () => { const fp = buildFingerprint("Acme PLC", "Sr Dev", "Addis", "desc"); expect(fp).toContain("Acme"); });
});

describe("truncateHtml", () => {
  it("short unchanged", () => { expect(truncateHtml("<p>Hello</p>", 100)).toBe("<p>Hello</p>"); });
});

describe("extractDeadlineFromDescription (FR-012h)", () => {
  it("month-first", () => { const r = extractDeadlineFromDescription("Deadline September 6, 2026."); expect(r).toBeInstanceOf(Date); expect(r!.getFullYear()).toBe(2026); });
  it("day-first", () => { const r = extractDeadlineFromDescription("Closing date: 15 August 2026"); expect(r).toBeInstanceOf(Date); expect(r!.getFullYear()).toBe(2026); });
  it("null without keyword", () => { expect(extractDeadlineFromDescription("Regular posting")).toBeNull(); });
});