// #4490 — the read-only "Features" view of a venue on the Admin venue detail.
//
// `admin_venue_features(venue_id)` returns the venue's 15 features (on/off, the
// spaces each is limited to, what each is waiting on) and `page`, the same
// payload guests get (active spaces, offers on sale, hours, events). This file
// turns that into plain rows. Pure: no React, no network, so it runs under
// `node --test`.
//
// Wording: "features" (never "modules"); "On request" / "Instant" for how an
// offer is confirmed.

export const FEATURE_LABELS = {
  entry: "Entry",
  group_packages: "Group packages",
  private_hire: "Private hire",
  by_the_hour: "By the hour",
  table_reservations: "Table reservations",
  floor_plan: "Floor plan",
  pick_a_table: "Pick a table",
  menu: "Menu",
  table_ordering: "Table ordering",
  min_spend_tables: "Minimum-spend tables",
  guest_list: "Guest list",
  memberships: "Memberships",
  stays: "Stays",
  events_here: "Events here",
  waitlist: "Waitlist",
};

const WAITING_ON_LABELS = { ...FEATURE_LABELS, space: "a space" };

export const OFFER_KIND_LABELS = {
  entry: "Entry",
  group_package: "Group package",
  private_hire: "Private hire",
  by_the_hour: "By the hour",
  // #4490 P6 — a monthly plan's own (hidden) offering.
  membership: "Membership plan",
};

/** "Group package", "Membership plan"; an unknown kind is made readable, never shown raw. */
export function offerKindLabel(kind) {
  if (typeof kind !== "string" || kind.length === 0) return "Offer";
  return OFFER_KIND_LABELS[kind] ?? kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const asArray = (value) => (Array.isArray(value) ? value : []);

/** "₦4,000" / "£12.50" from minor units, or "—". */
export function adminMoney(minor, currency, exponent = 2) {
  if (!Number.isSafeInteger(minor) || minor < 0 || !currency) return "—";
  const whole = minor % 10 ** exponent === 0;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : exponent,
      maximumFractionDigits: whole ? 0 : exponent,
    }).format(minor / 10 ** exponent);
  } catch {
    return `${(minor / 10 ** exponent).toFixed(whole ? 0 : exponent)} ${currency}`;
  }
}

/**
 * One row per feature, in the server's order.
 *   state "on_live"     enabled and guests can use it
 *   state "on_waiting"  enabled but not live for guests (waiting on a feature or
 *                       a space, or not available in this release)
 *   state "off"         switched off
 */
export function buildFeatureRows(payload) {
  const page = payload?.page ?? {};
  const live = new Set(asArray(page.features));
  const spaceNames = new Map(asArray(page.spaces).map((s) => [s.id, s.name]));
  return asArray(payload?.features).map((f) => {
    const enabled = f.enabled === true;
    const waitingOn = asArray(f.blocked_by).map((k) => WAITING_ON_LABELS[k] ?? k);
    const scope = Array.isArray(f.space_ids) ? f.space_ids : null;
    return {
      key: f.key,
      label: FEATURE_LABELS[f.key] ?? f.key,
      enabled,
      state: !enabled ? "off" : live.has(f.key) ? "on_live" : "on_waiting",
      waitingOn,
      // null = every space; otherwise the names (a removed space shows as such).
      scope:
        scope === null
          ? null
          : scope.map((id) => spaceNames.get(id) ?? "A space that is no longer active"),
    };
  });
}

const SETTING_LABELS = { indoor: "Indoor", covered: "Covered", outdoor: "Outdoor" };

export function buildSpaceRows(payload) {
  return asArray(payload?.page?.spaces).map((s) => {
    const parts = [];
    if (Number.isInteger(s.capacityStanding)) parts.push(`${s.capacityStanding} standing`);
    if (Number.isInteger(s.capacitySeated)) parts.push(`${s.capacitySeated} seated`);
    return {
      id: s.id,
      name: s.name,
      setting: SETTING_LABELS[s.setting] ?? "Space",
      capacity: parts.length > 0 ? parts.join(" · ") : null,
    };
  });
}

export function buildOfferRows(payload) {
  const page = payload?.page ?? {};
  const currency = page.currencyCode ?? null;
  const exponent = Number.isInteger(page.minorUnitExponent) ? page.minorUnitExponent : 2;
  return asArray(page.offers).map((o) => ({
    id: o.id,
    kind: offerKindLabel(o.kind),
    name: o.name,
    from: adminMoney(o.fromMinor, currency, exponent),
    mode: o.confirmationMode === "request" ? "On request" : "Instant",
    // The page lists only offers that are on sale; the other states are not
    // part of this read yet.
    status: "On sale",
  }));
}

/** #4490 P6/K — the monthly and yearly plans on sale (from the public page block). */
export function buildPlanRows(payload) {
  const page = payload?.page ?? {};
  const currency = page.currencyCode ?? null;
  const exponent = Number.isInteger(page.minorUnitExponent) ? page.minorUnitExponent : 2;
  return asArray(page.memberships?.plans).map((p) => ({
    id: p.id,
    name: p.name,
    price: `${adminMoney(p.priceMinor, currency, exponent)} a ${p.interval === "year" ? "year" : "month"}`,
    period: p.interval === "year" ? "Yearly" : "Monthly",
    status: p.full === true ? "Full" : "On sale",
  }));
}

/** How many features are on, for the section heading. */
export function countFeaturesOn(rows) {
  return rows.filter((r) => r.enabled).length;
}
