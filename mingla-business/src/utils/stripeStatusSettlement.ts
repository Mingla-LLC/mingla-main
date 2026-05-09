import type { BrandStripeStatus } from "../store/currentBrandStore";

export interface StripeStatusSettlementResult {
  status?: BrandStripeStatus | null;
  requirements?: unknown;
}

export interface StripeStatusSettlementOptions {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 15;
const DEFAULT_INTERVAL_MS = 2000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function settleStripeStatus<T extends StripeStatusSettlementResult>(
  refetch: () => Promise<{ data?: T | null }>,
  options: StripeStatusSettlementOptions = {},
): Promise<T | null> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep = options.sleep ?? delay;
  let latest: T | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await refetch();
    latest = result.data ?? null;
    const status = latest?.status;
    if (status === "active" || status === "restricted" || attempt === maxAttempts - 1) {
      return latest;
    }
    await sleep(intervalMs);
  }

  return latest;
}
