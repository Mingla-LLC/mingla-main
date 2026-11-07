// #4273 — the one place a Blast SMS quote joins provider currencies.
//
// A quote that texts numbers priced in more than one currency is shown in the
// brand's currency. The conversion uses the daily mid-market snapshot that was
// live AS OF the quote's `quotedAt` (never "the latest"), so the confirm,
// which rebuilds the quote at the same `quotedAt`, picks the same snapshot and
// reproduces the same numbers and hash even after the daily refresh. No rate
// value ever leaves this module; only the snapshot id is sealed.

export const SMS_FX_PROVIDER = "exchange_rate_api_open_v6" as const;
export const SMS_FX_UNAVAILABLE = "cost_unavailable:fx_unavailable";

export interface SmsFxConverted {
  currency: string;
  providerCostMinor: number;
  convertedCostMinor: number;
}

export interface SmsFxConversion {
  snapshotId: string;
  provider: typeof SMS_FX_PROVIDER;
  converted: SmsFxConverted[];
}

export interface SmsFxConverter {
  /** Throws `cost_unavailable:fx_unavailable` when it cannot convert. */
  convert(input: {
    subtotals: { currency: string; estimatedCostMinor: number }[];
    targetCurrency: string;
    at: Date;
  }): Promise<SmsFxConversion>;
}

// deno-lint-ignore no-explicit-any
export function dbSmsFxConverter(db: any): SmsFxConverter {
  return {
    async convert({ subtotals, targetCurrency, at }) {
      const iso = at.toISOString();
      let snapshotId: string;
      try {
        const { data, error } = await db.from("fx_rate_snapshots")
          .select("id")
          .in("status", ["active", "superseded"])
          .lte("fetched_at", iso)
          .gte("expires_at", iso)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error || typeof data?.id !== "string" || data.id.length === 0) {
          throw new Error(SMS_FX_UNAVAILABLE);
        }
        snapshotId = data.id;
      } catch {
        throw new Error(SMS_FX_UNAVAILABLE);
      }
      const converted: SmsFxConverted[] = [];
      for (const subtotal of subtotals) {
        const provider = subtotal.estimatedCostMinor;
        let value: number;
        if (subtotal.currency === targetCurrency) {
          value = provider;
        } else {
          let result: { data: unknown; error: unknown };
          try {
            result = await db.rpc("fx_convert_minor", {
              p_amount: provider,
              p_source: subtotal.currency,
              p_target: targetCurrency,
              p_snapshot: snapshotId,
            });
          } catch {
            throw new Error(SMS_FX_UNAVAILABLE);
          }
          const raw = typeof result.data === "string"
            ? Number(result.data)
            : result.data;
          if (
            result.error || typeof raw !== "number" ||
            !Number.isSafeInteger(raw) || raw < 0
          ) throw new Error(SMS_FX_UNAVAILABLE);
          value = raw;
        }
        // Never show nothing for a cost that is not nothing.
        if (provider > 0 && value === 0) value = 1;
        converted.push({
          currency: subtotal.currency,
          providerCostMinor: provider,
          convertedCostMinor: value,
        });
      }
      converted.sort((a, b) => a.currency.localeCompare(b.currency));
      return { snapshotId, provider: SMS_FX_PROVIDER, converted };
    },
  };
}
