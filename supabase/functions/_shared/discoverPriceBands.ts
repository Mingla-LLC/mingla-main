export interface DiscoverPriceBandSpec {
  currency: string;
  edgesMinor: number[];
  repeatSymbolInRange: boolean;
  compactThousands: boolean;
  symbol: string;
  bandsVersion: number;
}
const EVENT_EDGES: Record<string, number[]> = {
  GBP: [2_000, 4_000], USD: [2_500, 5_000, 10_000], EUR: [2_000, 4_000],
  NGN: [1_000_000, 2_500_000, 5_000_000], CAD: [2_500, 5_000, 10_000],
  GHS: [20_000, 50_000], KES: [200_000, 500_000],
};
const EXPERIENCE_EDGES: Record<string, number[]> = {
  GBP: [3_000, 6_000], USD: [4_000, 8_000], EUR: [3_000, 6_000],
  NGN: [2_000_000, 5_000_000], CAD: [4_000, 8_000], GHS: [30_000, 80_000],
  KES: [300_000, 800_000],
};
const SYMBOL: Record<string, string> = { GBP: "£", USD: "$", EUR: "€", NGN: "₦", CAD: "C$", GHS: "₵", KES: "KSh" };

/** Internal SQL hand-off. The edge remains the only owner of band edges. */
export function discoverPriceBandCatalog(kind: "events" | "experiences"): Record<string, number[]> {
  const source = kind === "experiences" ? EXPERIENCE_EDGES : EVENT_EDGES;
  return Object.fromEntries(Object.entries(source).map(([currency, edges]) => [currency, [...edges]]));
}

export function discoverPriceBands(kind: string, currencyRaw: string): DiscoverPriceBandSpec | null {
  const currency = currencyRaw.toUpperCase();
  const edgesMinor = (kind === "experiences" ? EXPERIENCE_EDGES : EVENT_EDGES)[currency];
  if (!edgesMinor) return null;
  return {
    currency,
    edgesMinor,
    repeatSymbolInRange: currency !== "KES",
    compactThousands: currency === "NGN" || currency === "KES",
    symbol: SYMBOL[currency],
    bandsVersion: 1,
  };
}
