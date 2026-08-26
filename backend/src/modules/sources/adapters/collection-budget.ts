/**
 * Shared request-budget helper for adapters.
 * Enforces maxRequests + requestDelayMs so pacing logic is written once.
 */

export class RequestBudget {
  private requests = 0;
  private lastRequestAt = 0;

  constructor(
    private readonly maxRequests: number,
    private readonly requestDelayMs: number,
  ) {}

  canSpend(): boolean {
    return this.requests < this.maxRequests;
  }

  spend(): void {
    this.requests++;
  }

  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.requestDelayMs) {
      await new Promise((r) => setTimeout(r, this.requestDelayMs - elapsed));
    }
    this.lastRequestAt = Date.now();
    this.spend();
  }

  get spent(): number {
    return this.requests;
  }

  get remaining(): number {
    return Math.max(0, this.maxRequests - this.requests);
  }
}
