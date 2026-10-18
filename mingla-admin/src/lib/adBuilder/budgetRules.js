/**
 * ISSUE-864 WP4 [Campaign Builder] — budget floors, pacing truths, the
 * learning-limited formula and the frequency-cap gate (SPEC A4.0(4), A4.e,
 * A4.g; blueprint §1.4).
 *
 * Money contract: major-units-in / MINOR-UNITS-AT-REST. Conversion to provider units is
 * the ADAPTER's job at the API boundary — never the builder's (the 10,000×
 * cents-vs-micro money bug, blueprint §1.4 Discovery 3).
 */

// ── Meta per-category floors (A4.0(4) / PROOF M-P8) ───────────────────────────
// NEVER hardcoded: read from ad_connections.extra.minimum_budgets, fetched
// live at connect (GET /act_{id}/minimum_budgets). This map mirrors the
// server's metaBudgetCategoryForGoal (supabase/functions/_shared/adChannel.ts)
// — LINK_CLICKS is HIGH-FREQUENCY (=$5/day floor live-probed), not $1.
export function metaBudgetCategoryForGoal(goal) {
  switch (goal) {
    case "IMPRESSIONS":
    case "REACH":
    case "AD_RECALL_LIFT":
      return "imp";
    case "THRUPLAY":
    case "VIDEO_VIEWS":
    case "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS":
      return "video_views";
    case "LINK_CLICKS":
    case "LANDING_PAGE_VIEWS":
    case "POST_ENGAGEMENT":
    case "PAGE_LIKES":
    case "EVENT_RESPONSES":
    case "PROFILE_VISIT":
    case "VISIT_INSTAGRAM_PROFILE":
    case "REMINDERS_SET":
      return "high_freq";
    default:
      return "low_freq";
  }
}

/**
 * Meta's floor for the chosen goal, from the CONNECTION row (extra.
 * minimum_budgets) — null when the connection hasn't stored floors yet
 * (the server then 424s create with "re-run admin-ad-connect").
 */
export function metaFloorCents(connection, goal) {
  const floors = connection?.extra?.minimum_budgets;
  if (!floors || typeof floors !== "object") return null;
  const value = floors[metaBudgetCategoryForGoal(goal)];
  return typeof value === "number" ? value : null;
}

/**
 * Per-channel floor in cents (Ads Design Contract v1.3 D1 / #3709):
 *  - Meta: per-CATEGORY from the connection row (never hardcoded).
 *  - TikTok: $50/day campaign floor (one ad group per host campaign).
 *  - Snapchat: $20/day campaign floor (squad min $5; campaign binds).
 *  - Reddit: $5/day.
 *  - Google: $0 money floor (3-day total-budget rule is separate).
 */
export function channelFloorCents(
  platform,
  { connection = null, metaGoal = "LINK_CLICKS" } = {},
) {
  switch (platform) {
    case "meta":
      return metaFloorCents(connection, metaGoal);
    case "tiktok":
      return 5000;
    case "snapchat":
      return 2000;
    case "google":
      return 0;
    case "reddit":
      return 500;
    default:
      return null;
  }
}

export function formatBudgetMinor(currency, cents) {
  if (
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency) ||
    !Number.isFinite(Number(cents))
  ) {
    return "currency unavailable";
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(Number(cents) / 100);
  } catch {
    return `${currency} ${(Number(cents) / 100).toFixed(2)}`;
  }
}

export function floorLabel(platform, floorCents, currency = null) {
  if (typeof floorCents === "number") {
    if (floorCents === 0 && platform === "google") {
      return "no money minimum (total budgets need ≥3 days)";
    }
    return `${formatBudgetMinor(currency, floorCents)}/day`;
  }
  if (platform === "google")
    return "no money minimum (total budgets need ≥3 days)";
  return "unknown until connected";
}

/** Inclusive calendar days between ISO datetimes (UTC date parts); null if incomplete. */
export function calendarDaysBetween(startsAt, endsAt) {
  if (!startsAt || !endsAt) return null;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  const startDay = Date.UTC(
    new Date(start).getUTCFullYear(),
    new Date(start).getUTCMonth(),
    new Date(start).getUTCDate(),
  );
  const endDay = Date.UTC(
    new Date(end).getUTCFullYear(),
    new Date(end).getUTCMonth(),
    new Date(end).getUTCDate(),
  );
  return Math.floor((endDay - startDay) / 86_400_000) + 1;
}

/**
 * Split a lifetime total across daily allocations so the cents sum exactly
 * to `totalLifetimeCents` (no floor(total/days)*days loss).
 * @param {Array<{platform: string, dailyCents: number}>} allocations
 * @param {number} totalLifetimeCents
 * @returns {Array<{platform: string, dailyCents: number, amountCents: number}>}
 */
export function allocateLifetimeCents(
  allocations = [],
  totalLifetimeCents = 0,
) {
  const total = Math.max(0, Math.floor(Number(totalLifetimeCents) || 0));
  const rows = Array.isArray(allocations) ? allocations : [];
  if (rows.length === 0) return [];
  const dailySum = rows.reduce(
    (s, a) => s + Math.max(0, Math.floor(Number(a.dailyCents) || 0)),
    0,
  );
  if (dailySum <= 0 || total <= 0) {
    return rows.map((a) => ({
      platform: a.platform,
      dailyCents: Math.max(0, Math.floor(Number(a.dailyCents) || 0)),
      amountCents: 0,
    }));
  }
  let remaining = total;
  return rows.map((a, i) => {
    const daily = Math.max(0, Math.floor(Number(a.dailyCents) || 0));
    const amountCents =
      i === rows.length - 1
        ? remaining
        : Math.floor((total * daily) / dailySum);
    if (i < rows.length - 1) remaining -= amountCents;
    return { platform: a.platform, dailyCents: daily, amountCents };
  });
}

/**
 * D1 sum across picked platforms (Admin = ad budget, no 15% fee).
 * mode=daily → days=1; mode=lifetime → × schedule days.
 */
export function computeAdminMinimumCents({
  platforms = [],
  mode = "daily",
  startsAt = null,
  endsAt = null,
  connection = null,
  metaGoal = "LINK_CLICKS",
} = {}) {
  const days =
    mode === "lifetime" ? (calendarDaysBetween(startsAt, endsAt) ?? 1) : 1;
  let total = 0;
  const breakdown = [];
  for (const platform of platforms) {
    const perDay = channelFloorCents(platform, { connection, metaGoal }) ?? 0;
    const subtotal = perDay * days;
    breakdown.push({
      platform,
      perDayCents: perDay,
      days,
      subtotalCents: subtotal,
    });
    total += subtotal;
  }
  return { minBudgetCents: total, days, breakdown };
}

// ── Pacing truths (A4.e — honest badges, exact figures) ──────────────────────
export const PACING_DISCLOSURES = {
  meta: "Meta may spend up to 175% of your daily budget on a single day (not the folklore 2×), averaging out Sunday–Saturday — never more than 7× your daily budget in a week.",
  google:
    "Google can spend up to 2× your daily budget on one day; the month is capped at about 30.4× the daily budget, with overdelivery refunded as credit.",
};

/**
 * The launch-confirm modal line (blueprint §1.8).
 *
 * `providerDeliveryBudgets` is the immutable-plan path. Each row is already in
 * the provider account's billing currency and declares whether its amount is a
 * daily delivery budget or a lifetime total. The legacy scalar arguments stay
 * supported for the pure builder helpers, but the launch UI must use the
 * provider-native rows so a hard cap is never mislabeled as a daily budget.
 */
export function launchConfirmCopy({
  channelCount,
  totalDailyCents,
  currency = null,
  providerDeliveryBudgets = null,
  providerHardCaps = null,
  hasMeta = true,
}) {
  let budgetCopy;
  if (Array.isArray(providerDeliveryBudgets)) {
    const grouped = new Map();
    for (const row of providerDeliveryBudgets) {
      const code =
        typeof row?.currency === "string"
          ? row.currency.trim().toUpperCase()
          : "";
      const amount = Number(row?.amountCents);
      const cadence = row?.cadence === "lifetime" ? "lifetime" : "daily";
      if (
        !/^[A-Z]{3}$/.test(code) ||
        !Number.isSafeInteger(amount) ||
        amount <= 0
      ) {
        return "Provider delivery budget unresolved. Launch is blocked until every channel has an authoritative amount and currency.";
      }
      const key = `${code}:${cadence}`;
      const next = (grouped.get(key) ?? 0) + amount;
      if (!Number.isSafeInteger(next)) {
        return "Provider delivery budget unresolved. Launch is blocked until every channel has an authoritative amount and currency.";
      }
      grouped.set(key, next);
    }
    if (grouped.size === 0) {
      return "Provider delivery budget unresolved. Launch is blocked until every channel has an authoritative amount and currency.";
    }
    budgetCopy = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, amount]) => {
        const [code, cadence] = key.split(":");
        return `${formatBudgetMinor(code, amount)}${cadence === "daily" ? "/day" : " total"}`;
      })
      .join("; ");
  } else {
    budgetCopy = `${formatBudgetMinor(currency, totalDailyCents)}/day`;
  }
  let capCopy = "";
  if (Array.isArray(providerHardCaps)) {
    const capsByCurrency = new Map();
    for (const row of providerHardCaps) {
      const code =
        typeof row?.currency === "string"
          ? row.currency.trim().toUpperCase()
          : "";
      const amount = Number(row?.amountCents);
      if (
        !/^[A-Z]{3}$/.test(code) ||
        !Number.isSafeInteger(amount) ||
        amount <= 0
      ) {
        return "Provider hard cap unresolved. Launch is blocked until every channel has an authoritative cap and currency.";
      }
      const next = (capsByCurrency.get(code) ?? 0) + amount;
      if (!Number.isSafeInteger(next)) {
        return "Provider hard cap unresolved. Launch is blocked until every channel has an authoritative cap and currency.";
      }
      capsByCurrency.set(code, next);
    }
    if (capsByCurrency.size === 0) {
      return "Provider hard cap unresolved. Launch is blocked until every channel has an authoritative cap and currency.";
    }
    capCopy = ` Frozen provider hard cap: ${[...capsByCurrency.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, amount]) => `${formatBudgetMinor(code, amount)} total`)
      .join("; ")}.`;
  }
  const pacing = hasMeta
    ? " Meta can spend up to 175% of its daily allocation on a busy day, evening out across the week."
    : " Provider pacing rules still apply within these frozen amounts.";
  return `Launch this immutable plan across ${channelCount} channel${channelCount === 1 ? "" : "s"}? Provider delivery budget: ${budgetCopy}.${capCopy}${pacing} You can pause any time.`;
}

// ── Learning-phase honesty (A4.e / GR-47) ─────────────────────────────────────
// Meta's learning exit bar is ~50 optimization events / ad set / rolling 7
// days. Warn at create when daily × 7 ÷ estimated_CPA < 50. The CPA estimate
// is the Travel/Arts CPC consensus (~$0.50) — an ESTIMATE, labeled as such.
export const DEFAULT_ESTIMATED_CPA_CENTS = 50;
export const LEARNING_EXIT_EVENTS_PER_WEEK = 50;

export function learningLimitedWarning(
  dailyCents,
  estimatedCpaCents = DEFAULT_ESTIMATED_CPA_CENTS,
) {
  if (!dailyCents || dailyCents <= 0 || !estimatedCpaCents) return null;
  const weeklyEvents = (dailyCents * 7) / estimatedCpaCents;
  if (weeklyEvents >= LEARNING_EXIT_EVENTS_PER_WEEK) return null;
  return (
    `This ad set is unlikely to reach the ~50 results per week Meta needs to leave its learning phase at this budget (est. ${Math.round(weeklyEvents)}/week). ` +
    "Treat the numbers as directional only — they are not a verdict on the channel."
  );
}

// ── Frequency-cap gate (A4.g / GR-63) ─────────────────────────────────────────
// Meta's frequency_control_specs is writable ONLY on REACH/THRUPLAY ad sets —
// on LINK_CLICKS it 400s. When the control ships (flags.FREQUENCY_CAP_
// CONTROL_ENABLED), it renders ONLY when this returns true; otherwise it is
// ABSENT (not disabled — absent).
export function frequencyCapAllowed(optimizationGoal) {
  return optimizationGoal === "REACH" || optimizationGoal === "THRUPLAY";
}

// ── Budget validation (blueprint §1.4 messages) ───────────────────────────────
export function validateBudget({
  totalDailyCents,
  channelRows,
  currency = null,
}) {
  const errors = [];
  if (!totalDailyCents || totalDailyCents <= 0) {
    errors.push("Enter a daily budget.");
    return errors;
  }
  const eligible = channelRows.filter((r) => r.eligible);
  if (eligible.length === 0) {
    // Ignore $0 / null floors (Google has no money minimum) so the cheapest
    // positive platform floor drives the message — never "$0.00/day on Google".
    const floors = channelRows
      .map((r) => ({ label: r.label, floorCents: r.floorCents }))
      .filter((r) => typeof r.floorCents === "number" && r.floorCents > 0)
      .sort((a, b) => a.floorCents - b.floorCents);
    if (floors.length > 0 && totalDailyCents < floors[0].floorCents) {
      errors.push(
        `${formatBudgetMinor(currency, totalDailyCents)}/day is below every channel's minimum. The cheapest we can run is ${formatBudgetMinor(currency, floors[0].floorCents)}/day on ${floors[0].label}.`,
      );
    } else {
      errors.push(
        "No channel can run this campaign right now — fix the blockers above.",
      );
    }
  }
  return errors;
}
