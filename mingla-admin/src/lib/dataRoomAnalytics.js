// Issue #4130 (Wave 5) — the words and arithmetic behind the Data room page.
//
// Everything the page shows is computed on the server (admin_data_room_*,
// migration 20280116004130); this file only names things, works out shares
// and differences, and decides "Working / Not working" from the funnels with
// the thresholds below. Pure functions: no network, no React.

export const DATA_ROOM_TABS = Object.freeze([
  { id: "overview", label: "Overview" },
  { id: "explorers", label: "Explorers" },
  { id: "hosts", label: "Hosts" },
  { id: "funnels", label: "Funnels" },
  { id: "retention", label: "Retention" },
  { id: "usage", label: "Page usage" },
  { id: "documents", label: "Documents" },
]);

export function dataRoomTabFor(id) {
  return DATA_ROOM_TABS.find((t) => t.id === id) || DATA_ROOM_TABS[0];
}

export const SEGMENTS = Object.freeze([
  { key: "explorer", label: "Explorers", color: "var(--color-brand-500)" },
  { key: "host", label: "Hosts", color: "var(--color-success-500)" },
  { key: "both", label: "Both", color: "var(--color-warning-500)" },
  { key: "incomplete", label: "Didn't finish sign-up", color: "var(--gray-400)" },
]);

export const FUNNELS = Object.freeze([
  {
    id: "explorer",
    label: "Explorer",
    unit: "people",
    steps: Object.freeze({
      signed_up: "Signed up",
      onboarded: "Finished onboarding",
      saw_deck: "Looked at the deck",
      saved_card: "Saved a card",
      got_ticket: "Got a ticket with their account",
    }),
    source: "Source: accounts, deck views, saves and orders. Staff and test accounts left out. Most buyers check out as guests, so the last step counts only tickets bought while signed in.",
  },
  {
    id: "host",
    label: "Host",
    unit: "people",
    steps: Object.freeze({
      became_host: "Became a host",
      created_brand: "Created a brand",
      added_bank: "Added a bank",
      published: "Published an event",
      first_sale: "First paid sale",
      first_payout: "First payout",
    }),
    source: "Source: business accounts, brands, bank setup, events, orders and payouts. Hosts who joined someone else's brand stop at \"Created a brand\".",
  },
  {
    id: "checkout",
    label: "Buyer checkout",
    unit: "checkouts",
    steps: Object.freeze({
      started: "Started checkout",
      completed: "Paid or got a free ticket",
      checked_in: "Checked in at the door",
    }),
    source: "Source: checkout sessions, orders and ticket scans. Free and paid shown together; checkouts by staff and test accounts left out.",
  },
]);

/**
 * Working / Not working. A step "keeps" the share of people from the step
 * before who reached it. Shown on screen with these exact numbers.
 */
export const VERDICT_RULES = Object.freeze({
  workingAtLeast: 60, // keeps 60% or more → Working
  notWorkingBelow: 40, // keeps under 40% → Not working
  minPeople: 10, // the step before needs at least 10, or the share is noise
  maxEach: 3,
});

export function verdictRulesText(rules = VERDICT_RULES) {
  return `Working = a step that keeps ${rules.workingAtLeast}% or more of the people from the step before. Not working = a step that keeps under ${rules.notWorkingBelow}%. Steps with fewer than ${rules.minPeople} people before them are left out.`;
}

const pctOf = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);

/** Steps of one funnel with labels and the share kept from the step before. */
export function funnelSteps(funnels, id) {
  const def = FUNNELS.find((f) => f.id === id);
  const raw = Array.isArray(funnels?.[id]) ? funnels[id] : [];
  if (!def) return [];
  return raw.map((step, i) => {
    const count = Number(step?.count) || 0;
    const prev = i === 0 ? null : Number(raw[i - 1]?.count) || 0;
    return {
      key: step?.key,
      label: def.steps[step?.key] || step?.key,
      count,
      prev,
      kept: i === 0 ? null : pctOf(count, prev),
    };
  });
}

/** { working: [...], notWorking: [...] } from every funnel, strongest first. */
export function funnelVerdicts(funnels, rules = VERDICT_RULES) {
  const items = [];
  for (const def of FUNNELS) {
    const steps = funnelSteps(funnels, def.id);
    for (let i = 1; i < steps.length; i += 1) {
      const s = steps[i];
      if (s.kept == null || s.prev < rules.minPeople) continue;
      items.push({
        funnel: def.label,
        from: steps[i - 1].label,
        to: s.label,
        kept: s.kept,
        count: s.count,
        prev: s.prev,
        unit: def.unit,
      });
    }
  }
  const working = items
    .filter((x) => x.kept >= rules.workingAtLeast)
    .sort((a, b) => b.kept - a.kept)
    .slice(0, rules.maxEach);
  const notWorking = items
    .filter((x) => x.kept < rules.notWorkingBelow)
    .sort((a, b) => a.kept - b.kept)
    .slice(0, rules.maxEach);
  return { working, notWorking };
}

export function verdictSentence(item) {
  return `${item.kept}% of ${item.unit} who reached "${item.from}" went on to "${item.to}" (${item.count} of ${item.prev}).`;
}

/** Monthly rows with running totals per segment, for the growth chart. */
export function cumulativeMonths(months) {
  const running = { explorer: 0, host: 0, both: 0, incomplete: 0 };
  return (Array.isArray(months) ? months : []).map((m) => {
    const row = { month: m.month };
    for (const s of SEGMENTS) {
      running[s.key] += Number(m?.[s.key]) || 0;
      row[s.key] = running[s.key];
    }
    return row;
  });
}

/** New people in the last month of the series, per segment and in total. */
export function lastMonthNew(months) {
  const list = Array.isArray(months) ? months : [];
  const last = list[list.length - 1];
  if (!last) return null;
  const out = { month: last.month, total: 0 };
  for (const s of SEGMENTS) {
    out[s.key] = Number(last[s.key]) || 0;
    out.total += out[s.key];
  }
  return out;
}

/**
 * #4130: a month on a chart or in a table, "Oct 2026" — never "Oct 26",
 * which reads as a day.
 */
export function monthLabel(month) {
  if (!month || typeof month !== "string") return "";
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** #4130: a month in a sentence, "October 2026". */
export function monthName(month) {
  if (!month || typeof month !== "string") return "";
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function share(part, whole) {
  return pctOf(Number(part) || 0, Number(whole) || 0);
}

/** A change between two counts as { text, up } for a stat; null when unknown. */
export function countChange(now, before) {
  if (now == null || before == null) return null;
  const diff = Number(now) - Number(before);
  if (!Number.isFinite(diff)) return null;
  if (diff === 0) return { text: "same as before", up: null };
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs the period before`, up: diff > 0 };
}

/** Retention cell: a number with %, or "too new" when the server sent null. */
export function retentionCell(value) {
  if (value == null) return { text: "too new", tooNew: true, value: null };
  const n = Number(value);
  return { text: `${Number.isInteger(n) ? n : n.toFixed(1)}%`, tooNew: false, value: n };
}

/** Where a figure came from, for the "as of" line. */
export function asOfLine(envelope) {
  if (!envelope?.as_of) return "";
  const when = new Date(envelope.as_of);
  const stamp = Number.isNaN(when.getTime())
    ? envelope.as_of
    : when.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  return envelope.source === "snapshot" ? `as of ${stamp}, nightly snapshot` : `as of ${stamp}, live`;
}

/** Weekly money rows for one currency, for the chart. */
export function weeklyMoney(money, currency) {
  return (Array.isArray(money?.weekly) ? money.weekly : [])
    .filter((r) => r.currency === currency)
    .map((r) => ({ week: r.week_start, paid: (Number(r.buyers_paid_cents) || 0) / 100, fee: (Number(r.fee_cents) || 0) / 100 }));
}

export function moneyCurrencies(money) {
  const set = new Set();
  for (const r of Array.isArray(money?.weekly) ? money.weekly : []) if (r.currency) set.add(r.currency);
  for (const r of Array.isArray(money?.last_30d) ? money.last_30d : []) if (r.currency) set.add(r.currency);
  return [...set].sort();
}

/** One kind of last-30-day money, per currency, never added across currencies. */
export function last30(money, kind) {
  return (Array.isArray(money?.last_30d) ? money.last_30d : [])
    .filter((r) => r.kind === kind)
    .map((r) => ({ currency: r.currency, cents: Number(r.cents) || 0, usdCents: r.usd_cents == null ? null : Number(r.usd_cents) }));
}

// The Page usage tab stays empty until both of these exist. No made-up numbers.
export const PAGE_USAGE_NEEDS = Object.freeze([
  "Both apps tag every event with which app sent it, and record each screen people open.",
  "A read-only PostHog key for admin, so this page can read screens and pages without exposing the key in the browser.",
]);

// Chart and number formatting shared by the tabs.
export const CHART_TICK = Object.freeze({ fontSize: 11, fill: "var(--color-text-tertiary)" });

export const fmtInt = (n) => (n == null ? "–" : Number(n).toLocaleString("en-GB"));
export const fmtPct = (n) => (n == null ? "–" : `${Number.isInteger(Number(n)) ? Number(n) : Number(n).toFixed(1)}%`);
export const fmtWeek = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

/**
 * #4226 — the ticket-buyer tiles from analytics_dr_users().ticket_buyers.
 * Null when the stored day predates #4226 (the block is missing): the page
 * says so instead of showing 0. conversion_rate is a 0..1 share or null.
 */
export function ticketBuyerTiles(block) {
  if (!block || typeof block !== "object") return null;
  const rate = block.conversion_rate == null ? null : Number(block.conversion_rate) * 100;
  return [
    { key: "buyers", label: "Ticket buyers", value: fmtInt(block.buyers), note: `${fmtInt(block.no_account)} with no Mingla account` },
    { key: "no_app", label: "Buyers with no app", value: fmtInt(block.no_app), note: "Not on the Explorer app yet" },
    { key: "with_app", label: "Buyers with an app", value: fmtInt(block.with_app), note: "Explorer or Host" },
    {
      key: "conversion",
      label: "Buyer → app conversion",
      value: rate == null ? "–" : fmtPct(Math.round(rate * 10) / 10),
      note: `${fmtInt(block.converted)} of ${fmtInt(block.bought_before_account)} who bought before having an account`,
    },
  ];
}

/**
 * #4226 — the host-contact tiles from analytics_dr_users().host_contacts.
 * Null when the stored day predates host contacts (the block is missing):
 * the page says so instead of showing 0.
 */
export function hostContactTiles(block) {
  if (!block || typeof block !== "object") return null;
  const rate = block.conversion_rate == null ? null : Number(block.conversion_rate) * 100;
  return [
    { key: "contacts", label: "Host contacts", value: fmtInt(block.contacts), note: `${fmtInt(block.no_app_no_ticket)} with no account and no ticket` },
    { key: "no_app", label: "Host contacts with no app", value: fmtInt(block.no_app), note: "Not on the Explorer or Host app yet" },
    { key: "converted", label: "Later got an app", value: fmtInt(block.converted), note: `of ${fmtInt(block.added_before_account)} a host added before they had an account` },
    {
      key: "conversion",
      label: "Host contact → app conversion",
      value: rate == null ? "–" : fmtPct(Math.round(rate * 10) / 10),
      note: "Share of host contacts who later got an app",
    },
  ];
}
