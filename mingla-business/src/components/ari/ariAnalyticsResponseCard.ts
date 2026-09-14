/**
 * #1984 — map Ari analytics tool_results into ResponseCard rows.
 * Presentational helpers only: no fetches, no writes, no currency cross-sums.
 */

export type AnalyticsResponseRow = { label: string; value: string };

export type AnalyticsCardModel = {
  eyebrow: string;
  title: string;
  rows: AnalyticsResponseRow[];
  state: "default" | "error";
  seedAction?: { id: string; label: string; message: string };
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const formatCount = (value: unknown): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return String(Math.trunc(value));
};

const formatRate = (value: unknown): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
};

/** Never cross-sum currencies — render each key separately. */
export const formatCentsByCurrency = (value: unknown): string | null => {
  const map = asRecord(value);
  if (!map) return null;
  const parts: string[] = [];
  for (const [currency, cents] of Object.entries(map).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (typeof cents !== "number" || !Number.isFinite(cents)) continue;
    const code = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;
    parts.push(`${code} ${(cents / 100).toFixed(2)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
};

const pushRow = (
  rows: AnalyticsResponseRow[],
  label: string,
  value: string | null,
): void => {
  if (value === null || value.length === 0) return;
  rows.push({ label, value });
};

const unauthorizedOrError = (
  payload: Record<string, unknown> | null,
  eyebrow: string,
  title: string,
): AnalyticsCardModel | null => {
  if (!payload) {
    return { eyebrow, title, rows: [], state: "error" };
  }
  if (payload.error !== undefined) {
    return { eyebrow, title, rows: [], state: "error" };
  }
  if (payload.authorized === false) {
    return {
      eyebrow,
      title,
      rows: [{ label: "Access", value: "Not authorized for this brand" }],
      state: "default",
    };
  }
  return null;
};

const topSourceLabel = (bySource: unknown): string | null => {
  if (!Array.isArray(bySource) || bySource.length === 0) return null;
  let best: { source: string; score: number } | null = null;
  for (const entry of bySource) {
    const row = asRecord(entry);
    if (!row || typeof row.source !== "string") continue;
    const score =
      typeof row.customers === "number"
        ? row.customers
        : typeof row.reservations === "number"
          ? row.reservations
          : typeof row.covers === "number"
            ? row.covers
            : typeof row.conversions === "number"
              ? row.conversions
              : 0;
    if (!best || score > best.score) best = { source: row.source, score };
  }
  return best ? `${best.source} (${best.score})` : null;
};

export function buildBrandAnalyticsCard(
  result: unknown,
): AnalyticsCardModel | null {
  const root = asRecord(result);
  if (!root) return null;
  const eyebrow = "Brand analytics";
  const title = "Brand performance";
  const conversion = asRecord(root.conversion);
  const venue = asRecord(root.venue);
  const conversionFailed =
    conversion === null ||
    conversion.authorized === false ||
    conversion.error !== undefined;
  const venueFailed =
    venue === null ||
    venue.authorized === false ||
    venue.error !== undefined;
  if (conversion?.authorized === false) {
    return {
      eyebrow,
      title,
      rows: [{ label: "Access", value: "Not authorized for this brand" }],
      state: "default",
    };
  }
  if (conversionFailed && venueFailed) {
    return { eyebrow, title, rows: [], state: "error" };
  }

  const rows: AnalyticsResponseRow[] = [];
  if (conversion && conversion.authorized !== false && !conversion.error) {
    pushRow(rows, "Driven customers (30d)", formatCount(conversion.customers_driven_30d));
    pushRow(
      rows,
      "Driven customers (lifetime)",
      formatCount(conversion.customers_driven_lifetime),
    );
    pushRow(rows, "Value (30d)", formatCentsByCurrency(conversion.value_cents_30d));
    pushRow(
      rows,
      "Value (lifetime)",
      formatCentsByCurrency(conversion.value_cents_lifetime),
    );
    const platforms = Array.isArray(conversion.by_platform)
      ? conversion.by_platform
      : [];
    if (platforms.length > 0) {
      pushRow(rows, "Top platform", topSourceLabel(
        platforms.map((p) => {
          const row = asRecord(p);
          return row
            ? { source: row.platform, conversions: row.conversions }
            : null;
        }).filter(Boolean),
      ));
    }
  }
  if (venue && venue.authorized !== false && !venue.error) {
    pushRow(rows, "Orders", formatCount(venue.order_count));
    pushRow(rows, "Revenue (7d)", formatCentsByCurrency(venue.rev7d_by_currency));
    pushRow(rows, "Revenue (all)", formatCentsByCurrency(venue.revenue_by_currency));
  }
  if (rows.length === 0) {
    return {
      eyebrow,
      title,
      rows: [{ label: "Status", value: "No analytics data yet" }],
      state: "default",
    };
  }
  return {
    eyebrow,
    title,
    rows,
    state: "default",
    seedAction: {
      id: "ask_event",
      label: "Ask about an event",
      message: "How is my next event doing?",
    },
  };
}

export function buildListingConversionCard(
  result: unknown,
): AnalyticsCardModel | null {
  const root = asRecord(result);
  if (!root) return null;
  const conversion = asRecord(root.conversion);
  const eyebrow = "Listing analytics";
  const title = "Listing conversion";
  const blocked = unauthorizedOrError(conversion, eyebrow, title);
  if (blocked) return blocked;
  if (!conversion) return { eyebrow, title, rows: [], state: "error" };

  const rows: AnalyticsResponseRow[] = [];
  pushRow(rows, "Customers", formatCount(conversion.mingla_drove_count));
  pushRow(rows, "Value", formatCentsByCurrency(conversion.value_cents));
  pushRow(rows, "Top source", topSourceLabel(conversion.by_source));
  if (rows.length === 0) {
    rows.push({ label: "Status", value: "No conversion data yet" });
  }
  return {
    eyebrow,
    title,
    rows,
    state: "default",
    seedAction: {
      id: "ask_recon",
      label: "Sold / refunded / net?",
      message: "What is sold, refunded, and net for this event?",
    },
  };
}

export function buildReservationMetricsCard(
  result: unknown,
): AnalyticsCardModel | null {
  const root = asRecord(result);
  if (!root) return null;
  const metrics = asRecord(root.metrics);
  const eyebrow = "Reservations";
  const title = "Reservation metrics";
  const blocked = unauthorizedOrError(metrics, eyebrow, title);
  if (blocked) return blocked;
  if (!metrics) return { eyebrow, title, rows: [], state: "error" };

  const rows: AnalyticsResponseRow[] = [];
  pushRow(rows, "Covers (30d)", formatCount(metrics.covers_30d));
  pushRow(rows, "Covers (lifetime)", formatCount(metrics.covers_lifetime));
  pushRow(rows, "No-show rate", formatRate(metrics.no_show_rate));
  if (typeof metrics.avg_party_size === "number" && Number.isFinite(metrics.avg_party_size)) {
    pushRow(
      rows,
      "Avg party size",
      Number.isInteger(metrics.avg_party_size)
        ? String(metrics.avg_party_size)
        : metrics.avg_party_size.toFixed(1),
    );
  }
  pushRow(rows, "Value (30d)", formatCentsByCurrency(metrics.value_cents_30d));
  pushRow(rows, "Top source", topSourceLabel(metrics.by_source));
  if (rows.length === 0) {
    rows.push({ label: "Status", value: "No reservation data yet" });
  }
  return { eyebrow, title, rows, state: "default" };
}

export function buildOrderReconciliationCard(
  result: unknown,
): AnalyticsCardModel | null {
  const root = asRecord(result);
  if (!root) return null;
  const eyebrow = "Orders";
  const title = "Event reconciliation";
  const currency =
    typeof root.currency === "string" && /^[A-Za-z]{3}$/.test(root.currency)
      ? root.currency.toUpperCase()
      : null;
  const money = (cents: unknown): string | null => {
    if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
    const amount = (cents / 100).toFixed(2);
    return currency ? `${currency} ${amount}` : amount;
  };
  const rows: AnalyticsResponseRow[] = [];
  pushRow(rows, "Sold", formatCount(root.sold_count));
  pushRow(rows, "Gross", money(root.revenue_cents));
  pushRow(rows, "Refunded", money(root.refunded_cents));
  pushRow(rows, "Net", money(root.net_revenue_cents));
  if (rows.length === 0) {
    return { eyebrow, title, rows: [], state: "error" };
  }
  return {
    eyebrow,
    title,
    rows,
    state: "default",
    seedAction: {
      id: "ask_listing",
      label: "Ask about conversion",
      message: "How is conversion looking for this event?",
    },
  };
}

export function buildAnalyticsCardForTool(
  toolName: string,
  result: unknown,
): AnalyticsCardModel | null {
  switch (toolName) {
    case "get_brand_analytics":
      return buildBrandAnalyticsCard(result);
    case "get_listing_conversion":
      return buildListingConversionCard(result);
    case "get_reservation_metrics":
      return buildReservationMetricsCard(result);
    case "get_event_order_reconciliation":
      return buildOrderReconciliationCard(result);
    default:
      return null;
  }
}
