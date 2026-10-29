export type PayoutBank = { name: string; code: string };
type ProviderPayoutBank = { name?: unknown; code?: unknown };

/**
 * Paystack can return duplicate rows for one Nigerian bank code. The code is
 * the provider identity used for account resolution, so keep the first valid
 * row for each code instead of rendering ambiguous duplicate picker choices.
 */
export function normalizePayoutBanks(banks: readonly ProviderPayoutBank[]): PayoutBank[] {
  const unique = new Map<string, PayoutBank>();

  for (const bank of banks) {
    if (typeof bank.code !== 'string' || typeof bank.name !== 'string') continue;
    const code = bank.code.trim();
    const name = bank.name.trim();
    if (!code || !name || unique.has(code)) continue;
    unique.set(code, { code, name });
  }

  return [...unique.values()];
}
