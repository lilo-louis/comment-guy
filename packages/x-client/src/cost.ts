/**
 * X API pay-per-use rates, USD (checked 2026-09-09).
 * Subscription tiers were removed in Feb 2026; there is no free tier.
 */
export const X_RATES = {
  postRead: 0.005,
  userLookup: 0.01,
  /** Reads of your own posts/bookmarks/followers. */
  ownRead: 0.001,
  likeRead: 0.001,
  postWrite: 0.015,
  /** A post containing a URL costs 13x a plain one. The engine bans links anyway. */
  postWriteWithLink: 0.2,
} as const;

export type XBillable = keyof typeof X_RATES;

export interface XUsage {
  postRead: number;
  userLookup: number;
  ownRead: number;
  likeRead: number;
  postWrite: number;
  postWriteWithLink: number;
}

const ZERO: XUsage = {
  postRead: 0,
  userLookup: 0,
  ownRead: 0,
  likeRead: 0,
  postWrite: 0,
  postWriteWithLink: 0,
};

/**
 * Counts billed X operations. Every discovered post costs half a cent whether
 * or not it ever becomes a comment, so this is wired in from the first run
 * rather than after the first surprise invoice.
 */
export class CostMeter {
  usage: XUsage = { ...ZERO };
  /** True when the numbers are simulated (fixture client) rather than billed. */
  readonly simulated: boolean;

  constructor(simulated = false) {
    this.simulated = simulated;
  }

  record(op: XBillable, count = 1): void {
    this.usage[op] += count;
  }

  get totalUsd(): number {
    return (Object.keys(this.usage) as XBillable[]).reduce(
      (sum, k) => sum + this.usage[k] * X_RATES[k],
      0,
    );
  }

  get reads(): number {
    return this.usage.postRead + this.usage.ownRead;
  }

  reset(): void {
    this.usage = { ...ZERO };
  }

  format(): string {
    const lines = (Object.keys(this.usage) as XBillable[])
      .filter((k) => this.usage[k] > 0)
      .map((k) => `    ${k.padEnd(18)} ${String(this.usage[k]).padStart(5)} x $${X_RATES[k]} = $${(this.usage[k] * X_RATES[k]).toFixed(3)}`);
    const label = this.simulated ? "X API cost (SIMULATED — fixture data)" : "X API cost";
    if (lines.length === 0) return `  ${label}: $0.000`;
    return `  ${label}: $${this.totalUsd.toFixed(3)}\n${lines.join("\n")}`;
  }
}

/**
 * Stops discovery once the day's read budget is spent. Without this a bad
 * query or a retry loop can burn the month's budget in an afternoon.
 */
export class ReadBudget {
  private spent = 0;
  readonly maxReadsPerRun: number;

  constructor(maxReadsPerRun: number) {
    this.maxReadsPerRun = maxReadsPerRun;
  }

  get remaining(): number {
    return Math.max(0, this.maxReadsPerRun - this.spent);
  }

  /** Returns how many reads may actually be made, capped by what's left. */
  request(wanted: number): number {
    const allowed = Math.min(wanted, this.remaining);
    this.spent += allowed;
    return allowed;
  }

  get exhausted(): boolean {
    return this.remaining === 0;
  }
}
