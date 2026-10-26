// Issue #4130 (Wave 4b) — the words and decisions behind Place pool, Ads,
// Team and roles, Platform health, Feature flags and Settings.
//
// Pure module: no React, no Supabase. The pages read it and a plain node test
// runs it (src/__tests__/issue_4130_wave4b_system.implementor.test.js).

// ── Tabs held in the address (#/page?tab=…) ──────────────────────────────────

export const PLACE_POOL_TABS = Object.freeze([
  Object.freeze({ id: "overview", label: "Overview" }),
  Object.freeze({ id: "cities", label: "Cities" }),
  Object.freeze({ id: "pipeline", label: "Pipeline" }),
  Object.freeze({ id: "browse", label: "Browse and map" }),
  Object.freeze({ id: "excluded", label: "Excluded" }),
]);

// Older tab names that still arrive in links: the Wave 0 hub's "places" tab
// and the retired Deck tuner (now an action on a place in Browse and map).
const PLACE_POOL_TAB_ALIASES = Object.freeze({ places: "browse", "deck-tuner": "browse" });

export const TEAM_TABS = Object.freeze([
  Object.freeze({ id: "team", label: "People", hosts: "admin" }),
  Object.freeze({ id: "invited", label: "Invited", hosts: "admin" }),
  Object.freeze({ id: "removed", label: "Removed", hosts: "admin" }),
  Object.freeze({ id: "careers", label: "Careers", hosts: "careers" }),
]);

// Platform health and Settings are one page each; a tab in a link names the
// section to scroll to (old addresses: #/stripe-mode -> tab=stripe, …).
export const PLATFORM_HEALTH_SECTIONS = Object.freeze(["problems", "providers", "stripe", "queue"]);
export const SETTINGS_SECTIONS = Object.freeze([
  "automatic-steps",
  "appearance",
  "app-config",
  "competitor-watch",
  "intelligence-trial",
  "danger-zone",
]);

/** The tab a link asks for, or the first tab when it names none we know. */
export function tabFor(tabs, requested, aliases = {}) {
  const id = typeof requested === "string" && Object.hasOwn(aliases, requested) ? aliases[requested] : requested;
  return tabs.find((t) => t.id === id) ? id : tabs[0].id;
}

export function placePoolTabFor(requested) {
  return tabFor(PLACE_POOL_TABS, requested, PLACE_POOL_TAB_ALIASES);
}

/** A section a link names, or "" when it names none on this page. */
export function sectionFor(sections, requested) {
  return typeof requested === "string" && sections.includes(requested) ? requested : "";
}

// ── Numbers ──────────────────────────────────────────────────────────────────

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** done as a whole-number share of total; null when there is nothing to share. */
export function shareOf(done, total) {
  const d = count(done);
  const t = count(total);
  if (d === null || t === null || t === 0) return null;
  return Math.round((Math.min(d, t) / t) * 100);
}

/**
 * The place funnel, every share of ACTIVE places. Returns null when the
 * funnel did not load: the page shows an error, never zeros.
 */
export function placeFunnelSteps(funnel) {
  if (!funnel || typeof funnel !== "object") return null;
  const active = count(funnel.active);
  if (active === null) return null;
  const step = (key, label, value) => {
    const n = count(value);
    return { key, label, count: n, share: n === null ? null : shareOf(n, active) };
  };
  return [
    { key: "active", label: "Active places", count: active, share: active > 0 ? 100 : null },
    step("checked", "Checked by Bouncer", funnel.checked),
    step("visible", "Explorers can see", funnel.visible),
    step("with_photos", "Have stored photos", funnel.with_photos),
  ];
}

/**
 * A pipeline stage, done of total. "Scored" can count more rows than there
 * are visible places (places scored before Bouncer excluded them), so the
 * share is capped at 100% and the extra is said, not shown as 114%.
 */
export function stageShare(done, total) {
  const d = count(done) ?? 0;
  const t = count(total) ?? 0;
  if (t === 0) return { pct: 0, done: d, total: t, extra: 0, label: d > 0 ? `${d.toLocaleString()} (no places to measure against)` : "0" };
  const shown = Math.min(d, t);
  const pct = Math.round((shown / t) * 100);
  const extra = Math.max(0, d - t);
  return {
    pct,
    done: shown,
    total: t,
    extra,
    label: `${shown.toLocaleString()} / ${t.toLocaleString()} (${pct}%)${extra > 0 ? ` · ${extra.toLocaleString()} more no longer visible` : ""}`,
  };
}

/** Where a city stands before and after it goes live for Explorers. */
export function cityReadiness(row) {
  const visible = count(row?.is_servable_places) ?? 0;
  const active = count(row?.total_active_places) ?? 0;
  if (row?.is_live_for_consumers) return { key: "live", label: "Live", variant: "success" };
  if (visible > 0) return { key: "ready", label: "Ready to launch", variant: "brand" };
  if (active > 0) return { key: "checking", label: "Places not checked yet", variant: "warning" };
  return { key: "not_seeded", label: "Not seeded", variant: "default" };
}

// ── Platform health ──────────────────────────────────────────────────────────

// Payment processors report their balance in the smallest unit (kobo, cents).
const MINOR_UNIT_PROVIDERS = new Set(["paystack", "stripe"]);

function money(amount, currency) {
  const code = String(currency || "").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${code}`;
  }
}

/**
 * A provider's balance or usage against its own alert line, from the
 * monitored-service registry (depletion_signal.balance: { warn, crit, unit }).
 * Returns null when the provider reports none.
 *   { text, line, low, critical }
 */
export function providerBalance(svc) {
  const detail = svc?.layers?.synthetic?.detail || {};
  const rule = svc?.depletion_signal?.balance || null;
  const key = svc?.service_key;

  if (MINOR_UNIT_PROVIDERS.has(key) && detail.balance != null && Number.isFinite(Number(detail.balance))) {
    const major = Number(detail.balance) / 100;
    return { text: money(major, detail.currency || (key === "paystack" ? "NGN" : "USD")), line: null, low: false, critical: false };
  }
  if (!rule) return null;

  if (rule.unit === "USD" && detail.balance != null && Number.isFinite(Number(detail.balance))) {
    const amount = Number(detail.balance);
    const warn = count(rule.warn);
    const crit = count(rule.crit);
    return {
      text: money(amount, detail.currency || "USD"),
      line: warn === null ? null : money(warn, "USD"),
      low: warn !== null && amount < warn,
      critical: crit !== null && amount < crit,
    };
  }
  if (rule.unit === "pct_used") {
    const used = Number(detail.used_percent ?? detail.usage_percent);
    if (!Number.isFinite(used)) return null;
    const warn = count(rule.warn);
    const crit = count(rule.crit);
    return {
      text: `${used.toFixed(1)}% used`,
      line: warn === null ? null : `${warn}%`,
      low: warn !== null && used >= warn,
      critical: crit !== null && used >= crit,
    };
  }
  if (rule.unit === "requests") {
    const left = Number(detail.requests_remaining);
    if (!Number.isFinite(left)) return null;
    const warn = count(rule.warn);
    const crit = count(rule.crit);
    return {
      text: `${left.toLocaleString()} requests left`,
      line: warn === null ? null : `${warn.toLocaleString()}`,
      low: warn !== null && left <= warn,
      critical: crit !== null && left <= crit,
    };
  }
  return null;
}

function worstStatus(layers) {
  const order = { healthy: 1, degraded: 2, down: 3 };
  let worst = null;
  for (const layer of Object.values(layers || {})) {
    const s = layer?.status;
    if (!Object.hasOwn(order, s)) continue;
    if (worst === null || order[s] > order[worst]) worst = s;
  }
  return worst;
}

/** One status per provider, worst first: down, low balance, slow, unknown, OK. */
export function providerStatus(svc) {
  const worst = worstStatus(svc?.layers);
  const balance = providerBalance(svc);
  if (svc?.alert_state === "alerting" || worst === "down") return { key: "down", label: "Down", variant: "error", rank: 0 };
  if (balance?.critical) return { key: "low", label: "Almost out", variant: "error", rank: 1 };
  if (balance?.low) return { key: "low", label: "Low balance", variant: "warning", rank: 2 };
  if (worst === "degraded") return { key: "degraded", label: "Slow or failing", variant: "warning", rank: 3 };
  if (worst === null) return { key: "unknown", label: "Never checked", variant: "default", rank: 4 };
  return { key: "ok", label: "OK", variant: "success", rank: 5 };
}

/** The latest time any check on this provider ran, or null. */
export function lastCheckedAt(svc) {
  let max = null;
  for (const layer of Object.values(svc?.layers || {})) {
    const t = Date.parse(layer?.checked_at ?? "");
    if (Number.isFinite(t) && (max === null || t > max)) max = t;
  }
  return max === null ? null : new Date(max).toISOString();
}

/** Providers sorted so problems come first, then by the registry's order. */
export function sortProviders(services) {
  return [...(services || [])].sort(
    (a, b) => providerStatus(a).rank - providerStatus(b).rank || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
  );
}

/**
 * Was this error "the database function does not exist"? (PostgREST answers
 * PGRST202, Postgres 42883.) Queue health uses it to say "not set up in
 * production yet" instead of a raw error.
 */
export function isMissingFunctionError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST202" || code === "42883") return true;
  return /could not find the function|function .* does not exist/i.test(String(error.message || ""));
}

/**
 * Stripe mode, honest: "aligned" only when every signal is confirmed and all
 * agree. signals: [{ status: "ok" | "error" | "unverifiable" | …, mode }]
 *   { state: "aligned" | "unconfirmed" | "misaligned" | "unknown", confirmed, total, mode, title }
 */
export function stripeModeVerdict(signals) {
  const list = Array.isArray(signals) ? signals : [];
  const total = list.length;
  const confirmed = list.filter((s) => s?.status === "ok");
  const modes = new Set(confirmed.map((s) => s.mode).filter(Boolean));
  const mode = modes.size === 1 ? [...modes][0] : null;
  if (list.some((s) => s?.status === "error") || modes.size > 1) {
    return { state: "misaligned", confirmed: confirmed.length, total, mode, title: "Stripe mode needs a look" };
  }
  if (confirmed.length === 0) {
    return { state: "unknown", confirmed: 0, total, mode: null, title: "Stripe mode could not be checked" };
  }
  const modeWord = mode === "live" ? "Live mode" : mode === "test" ? "Test mode" : "Mode";
  if (confirmed.length === total) {
    return { state: "aligned", confirmed: confirmed.length, total, mode, title: `${modeWord} · all ${total} checks agree` };
  }
  return {
    state: "unconfirmed",
    confirmed: confirmed.length,
    total,
    mode,
    title: `${modeWord} · ${confirmed.length} of ${total} checks confirmed`,
  };
}

/**
 * The problems that lead Platform health, worst first.
 *   services: admin_get_api_health().services
 *   queue:    { missing, error, verdict }   stripe: stripeModeVerdict(...)
 */
export function platformProblems({ services = [], queue = null, stripe = null } = {}) {
  const out = [];
  if (queue?.missing) {
    out.push({ key: "queue", tone: "error", badge: "Not set up", title: "Queue health", detail: "Its database function is not in production yet." });
  } else if (queue?.error) {
    out.push({ key: "queue", tone: "error", badge: "Error", title: "Queue health", detail: "Couldn't load. Try again." });
  } else if (queue?.stalled) {
    out.push({ key: "queue", tone: "error", badge: "Stalled", title: "Queue health", detail: "Buyers are waiting and nobody is being let in." });
  }
  for (const svc of sortProviders(services)) {
    const status = providerStatus(svc);
    const name = svc.display_name || svc.service_key;
    if (status.key === "down") out.push({ key: svc.service_key, tone: "error", badge: "Down", title: name, detail: "Its last check failed." });
    else if (status.key === "low") {
      const b = providerBalance(svc);
      out.push({
        key: svc.service_key,
        tone: status.variant === "error" ? "error" : "warning",
        badge: status.label,
        title: `${name} ${b?.text ?? ""}`.trim(),
        detail: b?.line ? `Below the ${b.line} warning line.` : "Below its warning line.",
      });
    } else if (status.key === "degraded") out.push({ key: svc.service_key, tone: "warning", badge: "Slow", title: name, detail: "Some checks are slow or failing." });
  }
  const never = (services || []).filter((svc) => providerStatus(svc).key === "unknown");
  if (never.length > 0) {
    const names = never.map((svc) => svc.display_name || svc.service_key);
    out.push({
      key: "never-checked",
      tone: "default",
      badge: "Unknown",
      title: `${names.join(", ")} ${names.length === 1 ? "has" : "have"} never been checked`,
      detail: "",
    });
  }
  if (stripe && stripe.state !== "aligned") {
    out.push({
      key: "stripe",
      tone: stripe.state === "misaligned" || stripe.state === "unknown" ? "error" : "info",
      badge: "Stripe",
      title: stripe.title,
      detail: stripe.state === "unconfirmed" ? "The app and business-app checks can't be confirmed from here yet." : "",
    });
  }
  return out;
}

// ── Feature flags ────────────────────────────────────────────────────────────

/** The issue a flag's description names (#1234), or "" when it names none. */
export function flagIssue(row) {
  if (row?.issue) return String(row.issue);
  const m = String(row?.description ?? "").match(/#(\d+)/);
  return m ? m[1] : "";
}

/** "Turn off…" / "Turn on…" and the confirmation words for a flag change. */
export function flagChange(row) {
  const on = !!row?.is_enabled;
  return {
    next: !on,
    button: on ? "Turn off…" : "Turn on…",
    title: on ? `Turn off ${row?.flag_key}?` : `Turn on ${row?.flag_key}?`,
    confirm: on ? "Turn it off" : "Turn it on",
  };
}

/** Can this flag change go ahead? A reason is required. */
export function canChangeFlag(reason) {
  return typeof reason === "string" && reason.trim().length > 0;
}

export const RESTART_WORD = "RESTART";

/** The danger-zone button unlocks only on the exact word and a reason. */
export function canRestartTour(typed, reason) {
  return typed === RESTART_WORD && typeof reason === "string" && reason.trim().length > 0;
}

// ── Team and roles ───────────────────────────────────────────────────────────

/** "now", "5m ago", "today", "3d ago", a date, or "–" when never. */
export function lastActiveLabel(value, now = Date.now()) {
  const t = Date.parse(value ?? "");
  if (!Number.isFinite(t)) return "–";
  const mins = Math.floor((now - t) / 60000);
  if (mins < 5) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Team rows split into the tabs: People (with access), Invited, Removed. */
export function teamGroups(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    team: list.filter((r) => r.status === "active"),
    invited: list.filter((r) => r.status === "invited"),
    removed: list.filter((r) => r.status === "revoked"),
  };
}

// ── Ads ──────────────────────────────────────────────────────────────────────

/** When something was last seen, in words: a date, or "never". */
export function seenLabel(value) {
  const t = Date.parse(value ?? "");
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "never";
}

// Results are credited to ads by Mingla's own attribution. Until that is
// proven ad-specific, the page labels them as not proven.
export const ADS_RESULTS_PROVEN = false;
export const ADS_RESULTS_CAVEAT =
  "Not proven: these may include purchases that did not come from an ad. They stay labelled until attribution is checked against each ad.";
