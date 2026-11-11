/** Format an event confirmation time in the event's timezone, always including its year. */
export function formatEventProposalWhen(
  startAt: unknown,
  endAt: unknown,
  timezone: unknown,
): string | null {
  if (typeof startAt !== "string") return null;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;
  const timeZone = typeof timezone === "string" && timezone.trim()
    ? timezone
    : undefined;
  try {
    const startDate = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    }).format(start);
    const startTime = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(start);
    const zoneLabel = typeof timeZone === "string"
      ? timeZone === "Africa/Lagos"
        ? "WAT"
        : new Intl.DateTimeFormat(undefined, {
          timeZone,
          timeZoneName: "short",
        }).formatToParts(start).find((part) => part.type === "timeZoneName")
          ?.value ?? timeZone
      : null;
    const startText = `${startDate}, ${startTime}${zoneLabel ? ` ${zoneLabel}` : ""}`;
    if (typeof endAt !== "string") return startText;
    const end = new Date(endAt);
    if (Number.isNaN(end.getTime())) return startText;
    const startDay = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(start);
    const endDay = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(end);
    if (startDay === endDay) {
      const endTime = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }).format(end);
      return `${startText} – ${endTime}${zoneLabel ? ` ${zoneLabel}` : ""}`;
    }
    const endDate = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(end);
    return `${startText} – ${endDate}${zoneLabel ? ` ${zoneLabel}` : ""}`;
  } catch {
    // Invalid or stale timezone values should not hide the event date entirely.
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(start);
    } catch {
      return null;
    }
  }
}

/** "Lagos time" for Africa/Lagos. */
function zoneCity(timeZone: string): string {
  const city = timeZone.split("/").pop()?.replace(/_/g, " ").trim();
  return city ? `${city} time` : timeZone;
}

/**
 * #3355 rework 3 (R3-5): one instant in the brand's own time zone, the way
 * the host says it: "Sat 19 Dec 2026, 11:59 pm Lagos time". Null when the
 * value is not a date.
 */
export function formatProposalInstant(
  value: unknown,
  timezone: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const zone = typeof timezone === "string" && timezone.trim()
    ? timezone.trim()
    : "UTC";
  try {
    const day = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: zone,
    }).format(instant).replace(/,/g, "");
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: zone,
    }).format(instant).toLowerCase();
    return `${day}, ${time} ${zone === "UTC" ? "UTC" : zoneCity(zone)}`;
  } catch {
    return null;
  }
}

/** "₦1,500" from 150000 minor units of NGN; null without a currency. */
export function formatProposalMinor(
  minor: unknown,
  currency: unknown,
): string | null {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    return null;
  }
  try {
    const formatter = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(minor / 10 ** digits);
  } catch {
    return null;
  }
}

/**
 * #3355 rework 3 (R3-5): the create_discount card's rows. Starts and Ends
 * are shown in the brand's time zone before approval (the 10 Nov incident:
 * the host could not see the stated end date), and a fixed amount is money,
 * never "minor units".
 */
export function discountProposalFields(
  args: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  const context =
    args.__proposal_context !== null &&
    typeof args.__proposal_context === "object" &&
    !Array.isArray(args.__proposal_context)
      ? (args.__proposal_context as Record<string, unknown>)
      : {};
  const zone = context.brand_timezone;
  const currency = typeof args.currency === "string"
    ? args.currency
    : context.brand_currency;
  if (typeof args.name === "string") {
    out.push({ label: "Discount", value: args.name });
  }
  if (typeof args.kind === "string") {
    out.push({ label: "Type", value: args.kind.replace(/_/g, " ") });
  }
  if (typeof args.code === "string") {
    out.push({ label: "Code", value: args.code });
  }
  if (typeof args.value_bps === "number") {
    out.push({ label: "Value", value: `${args.value_bps / 100}% off` });
  }
  if (typeof args.value_minor === "number") {
    const money = formatProposalMinor(args.value_minor, currency);
    out.push({
      label: "Value",
      value: money ? `${money} off` : `${args.value_minor / 100} off`,
    });
  }
  const starts = formatProposalInstant(args.starts_at, zone);
  out.push({ label: "Starts", value: starts ?? "As soon as you confirm" });
  const ends = formatProposalInstant(args.ends_at, zone);
  out.push({ label: "Ends", value: ends ?? "No end date" });
  if (typeof args.max_total_uses === "number") {
    out.push({ label: "Total uses", value: String(args.max_total_uses) });
  }
  if (typeof args.max_uses_per_buyer === "number") {
    out.push({ label: "Uses per buyer", value: String(args.max_uses_per_buyer) });
  }
  // #3355 rework 4 (R4-8): the minimum order and what the code applies to,
  // in words ("All event tickets", "Lagos Food Fest tickets"), never the raw
  // scope enum.
  if (typeof args.min_subtotal_minor === "number") {
    const money = formatProposalMinor(args.min_subtotal_minor, currency);
    if (money) out.push({ label: "Minimum order", value: money });
  }
  const appliesTo = discountAppliesTo(args, context);
  if (appliesTo) out.push({ label: "Applies to", value: appliesTo });
  if (typeof args.combines_with === "string") {
    out.push({
      label: "Combines with",
      value: args.combines_with.replace(/_/g, " "),
    });
  }
  return out;
}

const KIND_APPLIES: Readonly<Record<string, string>> = {
  event: "All event tickets",
  experience: "All experiences",
  trip: "All trips",
  venue_order: "All venue orders",
  reservation_deposit: "All table deposits",
};

const ONE_TARGET: Readonly<Record<string, string>> = {
  event: "One event's tickets",
  ticket_type: "One ticket type",
  venue_menu: "A venue menu",
  menu_item: "One menu item",
  venue_deposit: "Table deposits",
};

/**
 * #3355 rework 4 (R4-8): what a discount applies to, in the host's words.
 * A specific event uses its title from the server's proposal context
 * (`discount_target_titles`, read by the server); a whole kind reads "All
 * event tickets"; a brand-wide code reads "Everything you sell". Null when
 * the card says nothing about it.
 */
export function discountAppliesTo(
  args: Record<string, unknown>,
  context: Record<string, unknown> = {},
): string | null {
  const titles = context.discount_target_titles !== null &&
      typeof context.discount_target_titles === "object" &&
      !Array.isArray(context.discount_target_titles)
    ? (context.discount_target_titles as Record<string, unknown>)
    : {};
  const targets = Array.isArray(args.targets) ? args.targets : [];
  const parts: string[] = [];
  for (const raw of targets) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const target = raw as Record<string, unknown>;
    const kind = typeof target.listing_kind === "string"
      ? target.listing_kind
      : null;
    let part: string | null = null;
    if (target.target_kind === "listing_kind" && kind) {
      part = KIND_APPLIES[kind] ?? null;
    } else if (typeof target.target_kind === "string") {
      const id = typeof target.target_id === "string" ? target.target_id : "";
      const title = typeof titles[id] === "string"
        ? (titles[id] as string).trim()
        : "";
      part = title
        ? target.target_kind === "event" ? `${title} tickets` : title
        : ONE_TARGET[target.target_kind] ?? null;
    }
    if (part && !parts.includes(part)) parts.push(part);
  }
  if (parts.length > 0) return parts.join(", ");
  if (args.scope_kind === "brand") return "Everything you sell";
  return null;
}
