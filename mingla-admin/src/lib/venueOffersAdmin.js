// #4490 P2-7 — Admin venue offers (entry and later kinds): the list's words.
// Pure: no React, no network, so it runs under `node --test`.
//
// `admin_list_venue_offers` lists every venue offer across venues (admin
// only). Pause / resume go through `issue_4490_admin_set_offer_status`, which
// requires a reason (3–500 characters) and writes admin_audit_log.

export const VENUE_OFFER_STATUS = {
  live: { label: "On sale", variant: "success" },
  paused: { label: "Paused", variant: "warning" },
  draft: { label: "Draft", variant: "default" },
  archived: { label: "Archived", variant: "default" },
};

export const VENUE_OFFER_KIND_LABELS = {
  entry: "Entry",
  group_package: "Group package",
  private_hire: "Private hire",
  by_the_hour: "By the hour",
};

const ENTRY_STYLE_LABELS = { walk_in: "Walk-in", day_pass: "Day pass", timed_session: "Timed session" };

export function venueOfferStatus(status) {
  return VENUE_OFFER_STATUS[status] ?? { label: "Unknown", variant: "default" };
}

export function venueOfferKindLabel(kind, entryStyle) {
  const kindLabel = VENUE_OFFER_KIND_LABELS[kind] ?? "Venue offer";
  const style = ENTRY_STYLE_LABELS[entryStyle];
  return kind === "entry" && style ? `${kindLabel} · ${style}` : kindLabel;
}

/** "₦4,000" from minor units; "No price yet" when there is none. */
export function venueOfferFromPrice(fromMinor, currency) {
  if (typeof fromMinor !== "number" || !Number.isFinite(fromMinor)) return "No price yet";
  const code = typeof currency === "string" && currency.length === 3 ? currency : "NGN";
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
      .maximumFractionDigits;
    const whole = fromMinor % 10 ** digits === 0;
    return `from ${new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: whole ? 0 : digits,
    }).format(fromMinor / 10 ** digits)}`;
  } catch {
    return `from ${(fromMinor / 100).toFixed(2)} ${code}`;
  }
}

/** The one moderation action a row offers: pause a live offer, resume a paused one. */
export function venueOfferAction(row) {
  if (row?.status === "live") return { kind: "pause", label: "Pause", next: "paused" };
  if (row?.status === "paused") return { kind: "resume", label: "Resume", next: "live" };
  return null;
}

const READINESS_WORDS = {
  feature_off: "the venue has switched this feature off",
  no_price_option: "it has no price",
  no_policy: "it has no refund rules",
  no_schedule: "it has no days on sale",
  no_day_limit: "it has no day limit",
  guest_max_over_capacity: "a price allows more guests than the day limit",
  no_spaces: "it has no spaces",
};

/** Plain words for an RPC failure (never the raw code). */
export function venueOfferAdminError(message) {
  const text = typeof message === "string" ? message : "";
  if (text.includes("not_authorized")) return "Active Admin access is required.";
  if (text.includes("invalid_payload")) return "Add a reason of at least 3 characters.";
  if (text.includes("offer_not_found")) return "This offer no longer exists. Reload the list.";
  const ready = /offer_not_ready:([a-z_]+)/.exec(text);
  if (ready) {
    return `It can't go back on sale yet: ${READINESS_WORDS[ready[1]] ?? "the host has something to finish first"}.`;
  }
  return "That didn't save. Try again.";
}
