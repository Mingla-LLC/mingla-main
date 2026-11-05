// Issue #4276 wave 4: the words and numbers behind the Place pool pipeline screens.
//
// Pure module: no React, no Supabase. The screens read it and a plain node test runs
// it (src/lib/__tests__/issue4276CityPipeline.implementor.test.js).
//
// Two rules hold everywhere here:
//   * A number we don't have is said, never made up. Serper's price is unknown until
//     someone sets a rate, so its cost reads "unknown", never $0.
//   * Nothing here can release the held rescore backlog. There is no whole-city or
//     all-cities scoring anywhere on these screens.

// ── Formatting ───────────────────────────────────────────────────────────────

const GIB = 1024 ** 3;

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Bytes as "5.4 GB" (binary, like the 7 GB pause line), or "unknown". */
export function formatGb(bytes) {
  const n = num(bytes);
  if (n === null) return "unknown";
  return `${(n / GIB).toFixed(1)} GB`;
}

/** Share 0..100 of a limit, for a bar. Null when either side is unknown. */
export function sharePct(value, limit) {
  const v = num(value);
  const l = num(limit);
  if (v === null || l === null || l <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((v / l) * 100)));
}

/** Dollars, or "unknown" for a cost nobody can know yet. */
export function usd(value) {
  const n = num(value);
  if (n === null) return "unknown";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n < 1 && n > 0 ? 4 : 2 });
}

export function count(value) {
  const n = num(value);
  return n === null ? "–" : n.toLocaleString("en-US");
}

/** Serper is counted by request and priced only from a configured rate. */
export function serperCostText(requests, ratePerRequest) {
  const r = num(requests) ?? 0;
  const rate = num(ratePerRequest);
  if (rate === null) return `${count(r)} Serper requests, cost unknown until a rate is set`;
  return `${count(r)} Serper requests, ${usd(r * rate)}`;
}

/** The rate is stored per request; people think per 1,000. */
export function perThousand(ratePerRequest) {
  const rate = num(ratePerRequest);
  return rate === null ? "" : String(Math.round(rate * 1000 * 10000) / 10000);
}

/** "0.5" per 1,000 -> 0.0005 per request. Empty clears the rate (unknown). */
export function ratePerRequestFrom(perThousandText) {
  const text = String(perThousandText ?? "").trim();
  if (text === "") return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Enter a price of 0 or more, or leave it empty" };
  return { ok: true, value: n / 1000 };
}

// ── Runs and stages ──────────────────────────────────────────────────────────

export const ACTIVE_RUN_STATUSES = Object.freeze(["queued", "running", "paused", "awaiting_approval"]);

export const RUN_STAGES = Object.freeze([
  Object.freeze({ id: "box", label: "Geo box", sub: "Google's box, tiles" }),
  Object.freeze({ id: "fill", label: "Unsearched", sub: "Areas and searches never run" }),
  Object.freeze({ id: "split", label: "Capped searches", sub: "Search again, smaller" }),
  Object.freeze({ id: "completeness", label: "Completeness check", sub: "What is still missing" }),
  Object.freeze({ id: "pre_check", label: "Pre-check", sub: "Free rules, new places only" }),
  Object.freeze({ id: "photos", label: "Photos", sub: "Download stored photos" }),
  Object.freeze({ id: "final_check", label: "Final check", sub: "Servable or not" }),
  Object.freeze({ id: "intelligence", label: "Reviews and Intelligence", sub: "Serper, then Gemini" }),
  Object.freeze({ id: "score", label: "Final score", sub: "Places this run evaluated" }),
  Object.freeze({ id: "release", label: "Release", sub: "Finished places stop being held" }),
  Object.freeze({ id: "thumbnails", label: "Thumbnails", sub: "After the final check" }),
]);

export function stageLabel(id) {
  return RUN_STAGES.find((s) => s.id === id)?.label ?? String(id ?? "");
}

const RUN_STATUS_WORDS = Object.freeze({
  queued: { label: "Waiting to start", variant: "info" },
  running: { label: "Running", variant: "brand" },
  paused: { label: "Paused", variant: "warning" },
  awaiting_approval: { label: "Waiting for your OK", variant: "warning" },
  complete: { label: "Finished", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  cancelled: { label: "Cancelled", variant: "default" },
});

export function runStatusWord(status) {
  return RUN_STATUS_WORDS[status] ?? { label: String(status ?? "Unknown"), variant: "default" };
}

const PAUSE_REASONS = Object.freeze({
  paused_by_admin: "You paused it.",
  spend_limit: "It reached its spend limit. Raise the limit to resume.",
  database_limit: "The database is at its 7 GB pause line.",
  storage_limit: "Storage is at its 85 GB guard.",
  provider_unhealthy: "A provider it needs is failing its health check.",
  failure_rate: "Too many failures in a row. Check the provider, then resume.",
  search_failures: "Some searches failed. Resume to try them once more.",
  intelligence_failures: "Some Intelligence places failed. Resume to try them once more.",
  blocked_by_run: "Another run holds this city. Finish or cancel it first.",
  completeness_failed: "The completeness check failed.",
  check_write_errors: "A check could not save some of its verdicts.",
  places_unfinished: "Some places have no Intelligence yet.",
  stage_error: "A stage hit an error three times.",
  high_cost: "The next step is above its high-cost limit.",
  box_needs_person: "Google returned a state or region, or the box would cost over $500 to seed.",
  split_sample: "The first 10 capped tiles were searched again. Look at the yield before the rest.",
  split_level: "The next split level is ready, with its real numbers.",
});

export function pauseReasonText(reason) {
  if (!reason) return "";
  return PAUSE_REASONS[reason] ?? String(reason).replaceAll("_", " ");
}

/** The approval a waiting run asks for, from its pause_detail. */
export function pendingApproval(run) {
  if (!run || run.status !== "awaiting_approval") return null;
  const detail = run.pause_detail ?? {};
  if (typeof detail.key !== "string") return null;
  const numbers = detail.numbers ?? {};
  return {
    key: detail.key,
    stage: detail.stage ?? run.current_stage,
    reason: run.pause_reason,
    highCost: run.pause_reason === "high_cost" || numbers.exceedsHighCost === true,
    numbers,
  };
}

/** What a waiting stage's numbers say, as short lines. Unknown is said, not zeroed. */
export function approvalLines(approval, serperRate) {
  if (!approval) return [];
  const n = approval.numbers ?? {};
  const lines = [];
  if (n.searches !== undefined) lines.push(`${count(n.searches)} searches`);
  if (n.tiles !== undefined) lines.push(`${count(n.tiles)} tiles`);
  if (n.places !== undefined) lines.push(`${count(n.places)} places`);
  if (n.estimatedCostUsd !== undefined) lines.push(`Google or Gemini: ${usd(n.estimatedCostUsd)}${n.costIsFloor ? " at least" : ""}`);
  if (n.estimatedSeedCostUsd !== undefined) lines.push(`Seeding this box: ${usd(n.estimatedSeedCostUsd)}`);
  if (n.serper_requests_max !== undefined) lines.push(serperCostText(n.serper_requests_max, serperRate));
  if (Array.isArray(n.askReasons) && n.askReasons.length) lines.push(`Asks a person because: ${n.askReasons.join(", ")}`);
  const outside = n.placesOutside?.outside_active;
  if (outside) lines.push(`${count(outside)} active places would sit outside this box`);
  return lines;
}

/** Spend rows, totalled, with Serper's cost kept unknown until a rate is set. */
export function spendSummary(ledger) {
  const rows = Array.isArray(ledger?.rows) ? ledger.rows : [];
  const byProvider = {};
  for (const r of rows) {
    const p = r.provider ?? "other";
    byProvider[p] ??= { units: 0, actual: 0, actualKnown: true };
    byProvider[p].units += num(r.units) ?? 0;
    const a = num(r.actual_usd);
    if (a === null) byProvider[p].actualKnown = false;
    else byProvider[p].actual += a;
  }
  const serperKnown = ledger?.serper_cost_known === true;
  return {
    knownUsd: num(ledger?.known_actual_usd) ?? 0,
    google: byProvider.google ? byProvider.google.actual : 0,
    gemini: byProvider.gemini ? byProvider.gemini.actual : 0,
    serperRequests: num(ledger?.serper_requests) ?? 0,
    serperUsd: serperKnown && byProvider.serper ? byProvider.serper.actual : null,
    serperText: serperCostText(ledger?.serper_requests ?? 0, serperKnown ? ledger?.serper_usd_per_request : null),
  };
}

// ── The funnel ───────────────────────────────────────────────────────────────

/** Every stage of the Overview funnel, each a share of ACTIVE places. */
export function pipelineFunnelSteps(totals) {
  if (!totals || typeof totals !== "object") return null;
  const active = num(totals.active);
  if (active === null) return null;
  const step = (key, label, value, note) => {
    const n = num(value);
    return { key, label, note, count: n, share: n === null || active === 0 ? null : Math.round((Math.min(n, active) / active) * 100) };
  };
  return [
    step("active", "Active places", active),
    step("pre_passed", "Passed the pre-check", totals.pre_passed, "Free rules, before photos"),
    step("with_photos", "Have stored photos", totals.with_photos),
    step("servable", "Explorers can see", totals.servable, "Passed the final check"),
    step("reviews", "Have reviews", totals.reviews, "Of places Explorers can see"),
    step("intelligence", "Have Intelligence", totals.intelligence, "Of places Explorers can see"),
    step("scored", "Have a final score", totals.scored, "Of places Explorers can see"),
  ];
}

/** The "needs attention" cards. Each one only when its count is above zero. */
export function attentionItems(totals) {
  if (!totals) return [];
  const items = [];
  const add = (n, head, body) => { if ((num(n) ?? 0) > 0) items.push({ count: num(n), head, body }); };
  add(totals.rules_only, "Explorers see places on rules alone",
    "These places passed the final check but have no Intelligence, so their score is rules only.");
  add(totals.no_reviews, "Places with no reviews on record",
    "Intelligence for these ran, or will run, without any reviews.");
  add(totals.intelligence_without_reviews, "Intelligence that ran with no reviews",
    "These can be redone once Serper is working again. Redoing changes live decks, so it is a separate choice.");
  add(totals.held, "Held until they finish",
    "New places stay hidden until reviews, Intelligence and the final score are done.");
  add(totals.never_checked, "Never checked",
    "Active places neither check has looked at yet.");
  add(totals.dropped_no_photos, "Dropped at seed for no photo",
    "Google returned these with no photo, so they were never added. Explorer cards need photos.");
  return items;
}

// ── Readiness (Cities) ───────────────────────────────────────────────────────

/** What keeps a city from being ready, from the funnel row, search status and box report. */
export function cityGaps(funnelRow, searchRow, outsideRow) {
  const n = (v) => num(v) ?? 0;
  const unsearchedAreas = num(searchRow?.uncoveredTiles);
  const unfinished = num(searchRow?.unfinishedSearches);
  return {
    missingIntelligence: n(funnelRow?.rules_only),
    missingReviews: n(funnelRow?.no_reviews),
    unsearchedAreas,
    unfinishedSearches: unfinished,
    cappedOpen: num(searchRow?.cappedOpen),
    searchUnknown: !searchRow || !!searchRow.error,
    outsideBox: n(outsideRow?.outside_active),
    held: n(funnelRow?.held),
  };
}

/** Plain-English list of a city's gaps. "Couldn't check" is said, not skipped. */
export function gapLines(gaps) {
  if (!gaps) return [];
  const lines = [];
  if (gaps.missingIntelligence > 0) lines.push(`${count(gaps.missingIntelligence)} without Intelligence`);
  if (gaps.missingReviews > 0) lines.push(`${count(gaps.missingReviews)} without reviews`);
  if (gaps.searchUnknown) lines.push("Searches couldn't be checked");
  else {
    if ((gaps.unsearchedAreas ?? 0) > 0) lines.push(`${count(gaps.unsearchedAreas)} areas never searched`);
    if ((gaps.unfinishedSearches ?? 0) > 0) lines.push(`${count(gaps.unfinishedSearches)} searches unfinished`);
  }
  if (gaps.outsideBox > 0) lines.push(`Box flagged: ${count(gaps.outsideBox)} places outside it`);
  return lines;
}

/**
 * Where a city stands. "Ready" needs places Explorers can see and no gap at all; a live
 * city stays Live whatever its gaps, and going live is still its own confirmed step.
 */
export function cityReadinessWithGaps(row, gaps) {
  const visible = num(row?.is_servable_places) ?? 0;
  const active = num(row?.total_active_places) ?? 0;
  const lines = gapLines(gaps);
  if (row?.is_live_for_consumers) return { key: "live", label: "Live", variant: "success", gaps: lines };
  if (visible > 0 && lines.length === 0) return { key: "ready", label: "Ready to launch", variant: "brand", gaps: lines };
  if (visible > 0) return { key: "gaps", label: "Has gaps", variant: "warning", gaps: lines };
  if (active > 0) return { key: "checking", label: "Places not checked yet", variant: "warning", gaps: lines };
  return { key: "not_seeded", label: "Not seeded", variant: "default", gaps: lines };
}

// ── The "what each city is missing" table ───────────────────────────────────

export const MATRIX_COLUMNS = Object.freeze([
  Object.freeze({ id: "box", label: "Geo box", sub: "Places outside it" }),
  Object.freeze({ id: "unsearched", label: "Unsearched", sub: "Areas and searches" }),
  Object.freeze({ id: "capped", label: "Capped", sub: "Hit 20 results" }),
  Object.freeze({ id: "pre_check", label: "Pre-check", sub: "Not checked yet" }),
  Object.freeze({ id: "photos", label: "Photos", sub: "Passed, no photos" }),
  Object.freeze({ id: "final_check", label: "Final check", sub: "Have photos, not checked" }),
  Object.freeze({ id: "reviews", label: "Reviews", sub: "Servable, none" }),
  Object.freeze({ id: "intelligence", label: "Intelligence", sub: "Servable, rules only" }),
  Object.freeze({ id: "score", label: "Final score", sub: "Servable, no score" }),
  Object.freeze({ id: "held", label: "Held", sub: "Waiting to finish" }),
]);

/** One row's cells. A cell is a gap when its count is above zero; null is unknown. */
export function matrixCells(funnelRow, searchRow, outsideRow) {
  const n = (v) => num(v) ?? 0;
  const f = funnelRow ?? {};
  const unknownSearch = !searchRow || !!searchRow.error;
  const unsearched = unknownSearch ? null : n(searchRow.uncoveredTiles) + n(searchRow.unfinishedSearches);
  const values = {
    box: outsideRow ? n(outsideRow.outside_active) : null,
    unsearched,
    capped: unknownSearch ? null : n(searchRow.cappedOpen),
    pre_check: Math.max(0, n(f.active) - n(f.pre_checked)),
    photos: Math.max(0, n(f.pre_passed) - n(f.with_photos)),
    final_check: Math.max(0, n(f.with_photos) - n(f.final_checked)),
    reviews: n(f.no_reviews),
    intelligence: n(f.rules_only),
    score: Math.max(0, n(f.servable) - n(f.scored)),
    held: n(f.held),
  };
  return MATRIX_COLUMNS.map((c) => {
    const v = values[c.id];
    return { id: c.id, value: v, text: v === null ? "?" : v === 0 ? "done" : count(v), gap: v !== null && v > 0 };
  });
}

// ── Excluded ─────────────────────────────────────────────────────────────────

const RULES = Object.freeze({
  B1: "Wrong type",
  B2: "Closed",
  B3: "Missing details",
  B4: "No website",
  B5: "Social media only",
  B6: "No opening hours",
  B7: "No Google photos",
  B8: "No stored photos",
  B9: "Child venue",
  B10: "Fast food or convenience",
  B11: "Chain",
});

export function ruleLabel(rule) {
  return RULES[rule] ?? `Other (${rule})`;
}

/** Grouped reasons with their share of the places that failed that check. */
export function reasonRows(groups, failed) {
  const total = num(failed) ?? 0;
  return (Array.isArray(groups) ? groups : []).map((g) => ({
    rule: g.rule,
    label: ruleLabel(g.rule),
    places: num(g.places) ?? 0,
    share: total > 0 ? Math.round(((num(g.places) ?? 0) / total) * 100) : null,
  }));
}

// ── Completeness check ───────────────────────────────────────────────────────

/** A completeness check in words. A failed check is never shown as a result, and a
 * share nobody measured is "unknown", never 0%. */
export function completenessSummary(check) {
  if (!check) return { state: "none", failed: false, text: "No completeness check on record" };
  const date = check.created_at ? new Date(check.created_at).toLocaleDateString() : "";
  if (check.status !== "completed") {
    const failedN = num(check.searches_failed);
    const planned = num(check.searches_planned);
    const counts = failedN !== null && planned !== null ? ` (${count(failedN)} of ${count(planned)} searches failed)` : "";
    return { state: "failed", failed: true, text: `Completeness check failed${counts}${date ? ` on ${date}` : ""}` };
  }
  const share = num(check.missing_share);
  const missing = share === null ? "share missing unknown" : `${Math.round(share * 100)}% missing`;
  return { state: "completed", failed: false, text: `Completeness check${date ? ` on ${date}` : ""}: ${missing}` };
}
