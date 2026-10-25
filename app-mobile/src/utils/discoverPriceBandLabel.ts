import { formatCompactCount } from "@mingla/offering-rendering";
import type { DiscoverPriceBands } from "../types/discoverFeed";

type Translate = (key: string, values: Record<string, string>) => string;

export function formatPriceBandAmount(
  minor: number,
  spec: Pick<DiscoverPriceBands, "symbol" | "compactThousands">,
): string {
  const major = minor / 100;
  if (spec.compactThousands && major >= 1000) {
    return `${spec.symbol}${formatCompactCount(major) ?? String(major)}`;
  }
  return `${spec.symbol}${major}`;
}
export function formatPriceBandLabel(
  bandIndex: number,
  bands: DiscoverPriceBands,
  t: Translate,
): string {
  const edges = bands.edgesMinor;
  const count = edges.length + 1;
  if (bandIndex < 0 || bandIndex >= count) {
    throw new RangeError(`Invalid Discover price band ${bandIndex + 1} of ${count}`);
  }
  if (bandIndex === 0) {
    return t("price.under", {
      amount: formatPriceBandAmount(edges[0], bands),
    });
  }
  if (bandIndex === edges.length) {
    return t("price.over", {
      amount: formatPriceBandAmount(edges[edges.length - 1], bands),
    });
  }
  const low = formatPriceBandAmount(edges[bandIndex - 1], bands);
  const highWithSymbol = formatPriceBandAmount(edges[bandIndex], bands);
  const high = bands.repeatSymbolInRange
    ? highWithSymbol
    : highWithSymbol.slice(bands.symbol.length);
  return t("price.between", { low, high });
}
