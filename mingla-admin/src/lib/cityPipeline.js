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

/** "1 place", "2 places", "1,204 places". */
export function plural(value, one, many = `${one}s`) {
  const n = num(value);
  return `${count(n)} ${n === 1 ? one : many}`;
}

export function count(value) {
  const n = num(value);
  return n === null ? "–" : n.toLocaleString("en-US");
}

/** Serper is counted by request and priced only from a configured rate. */
export function serperCostText(requests, ratePerRequest) {
  const r = num(requests) ?? 0;
  const rate = num(ratePerRequest);
  if (rate === null) return `${plural(r, "Serper request")}, cost unknown until a rate is set`;
  return `${plural(r, "Serper request")}, ${usd(r * rate)}`;
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
  if (n.searches !== undefined) lines.push(plural(n.searches, "search", "searches"));
  if (n.tiles !== undefined) lines.push(plural(n.tiles, "tile"));
  if (n.places !== undefined) lines.push(plural(n.places, "place"));
  if (n.estimatedCostUsd !== undefined) lines.push(`Google or Gemini: ${usd(n.estimatedCostUsd)}${n.costIsFloor ? " at least" : ""}`);
  if (n.estimatedSeedCostUsd !== undefined) lines.push(`Seeding this box: ${usd(n.estimatedSeedCostUsd)}`);
  if (n.serper_requests_max !== undefined) lines.push(serperCostText(n.serper_requests_max, serperRate));
  if (Array.isArray(n.askReasons) && n.askReasons.length) lines.push(`Asks a person because: ${n.askReasons.join(", ")}`);
  const outside = n.placesOutside?.outside_active;
  if (outside) lines.push(`${plural(outside, "active place")} would sit outside this box`);
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

/**
 * The "needs attention" list. Each item only when its count is above zero, with the
 * tab that shows the gap (tab and link), when one does.
 */
export function attentionItems(totals) {
  if (!totals) return [];
  const items = [];
  const add = (n, head, body, tab = null, link = null) => {
    if ((num(n) ?? 0) > 0) items.push({ count: num(n), head, body, tab, link });
  };
  add(totals.rules_only, "Explorers see places on rules alone",
    "These places passed the final check but have no Intelligence, so their score is rules only.",
    "pipeline", "See the gap");
  add(totals.no_reviews, "Places with no reviews on record",
    "Intelligence for these ran, or will run, without any reviews.",
    "pipeline", "See the gap");
  add(totals.intelligence_without_reviews, "Intelligence that ran with no reviews",
    "These can be redone once Serper is working again. Redoing changes live decks, so it is a separate choice.",
    "pipeline", "See the gap");
  add(totals.held, "Held until they finish",
    "New places stay hidden until reviews, Intelligence and the final score are done.");
  add(totals.never_checked, "Never checked",
    "Active places neither check has looked at yet.",
    "pipeline", "See the gap");
  add(totals.dropped_no_photos, "Dropped at seed for no photo",
    "Google returned these with no photo, so they were never added. Explorer cards need photos.",
    "excluded", "See reasons");
  return items;
}

/** The recorded-spend line: each provider, Serper counted by request until priced. */
export function spendTotalsLine(t) {
  if (!t) return "";
  const parts = [`Seeding ${usd(t.seeding_usd)}`, `Photos ${usd(t.photos_usd)}`, `Gemini ${usd(t.gemini_usd)}`];
  const rate = num(t.serper_usd_per_request);
  parts.push(rate === null
    ? `Serper ${plural(t.serper_requests ?? 0, "request")}, not priced`
    : `Serper ${usd((num(t.serper_requests) ?? 0) * rate)}`);
  return parts.join(" · ");
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

/**
 * One city's row from the places-outside-box report. The report has no row for a city
 * with no places, so a city missing from a report that did load has 0 outside. Only a
 * report that failed to load is unknown (null).
 */
export function outsideBoxRow(report, cityId) {
  if (!Array.isArray(report)) return null;
  return report.find((r) => r?.city_id === cityId)
    ?? { city_id: cityId, places_total: 0, outside_total: 0, outside_active: 0, outside_servable: 0 };
}

/** Plain-English list of a city's gaps. "Couldn't check" is said, not skipped. */
export function gapLines(gaps) {
  if (!gaps) return [];
  const lines = [];
  if (gaps.missingIntelligence > 0) lines.push(`${count(gaps.missingIntelligence)} without Intelligence`);
  if (gaps.missingReviews > 0) lines.push(`${count(gaps.missingReviews)} without reviews`);
  if (gaps.searchUnknown) lines.push("Searches couldn't be checked");
  else {
    if ((gaps.unsearchedAreas ?? 0) > 0) lines.push(`${plural(gaps.unsearchedAreas, "area")} never searched`);
    if ((gaps.unfinishedSearches ?? 0) > 0) lines.push(`${plural(gaps.unfinishedSearches, "search", "searches")} unfinished`);
  }
  if (gaps.outsideBox > 0) lines.push(`Box flagged: ${plural(gaps.outsideBox, "place")} outside it`);
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

// Column order and words follow the approved design. `kind` is the legend:
//   missing  a gap to close (amber)
//   check    the geo box needs a look: places sit outside it (red)
//   redo     an optional redo (blue): Intelligence that ran with no reviews
//   follows  happens on its own once the stages before it finish (dashed)
export const MATRIX_COLUMNS = Object.freeze([
  Object.freeze({ id: "box", label: "Geo box", sub: "Places outside", kind: "check" }),
  Object.freeze({ id: "seed", label: "Seed", sub: "Find places", kind: "missing" }),
  Object.freeze({ id: "unsearched", label: "Unsearched", sub: "Never run", kind: "missing" }),
  Object.freeze({ id: "capped", label: "Capped", sub: "Hit 20, split", kind: "missing" }),
  Object.freeze({ id: "pre_check", label: "Pre-check", sub: "Free rules", kind: "missing" }),
  Object.freeze({ id: "photos", label: "Photos", sub: "Download", kind: "missing" }),
  Object.freeze({ id: "final_check", label: "Final check", sub: "Servable?", kind: "missing" }),
  Object.freeze({ id: "reviews", label: "Reviews", sub: "Serper", kind: "missing" }),
  Object.freeze({ id: "intelligence", label: "Intelligence", sub: "Gemini", kind: "missing" }),
  Object.freeze({ id: "redo", label: "Redo", sub: "Ran, no reviews", kind: "redo" }),
  Object.freeze({ id: "score", label: "Final score", sub: "Follows", kind: "follows" }),
]);

/** A city never seeded: a draft with no active places. */
export function neverSeeded(funnelRow) {
  return !funnelRow?.is_live && (num(funnelRow?.active) ?? 0) === 0;
}

export const HELD_BACKLOG_NOTE =
  "Held in the score backlog: AI results from before 5 Nov 2026 stay off live decks until Seth releases them, so no run re-judges or rescores these places.";

/**
 * One row's cells. A cell is a gap when its count is above zero; null is unknown.
 * redoRow (admin_place_pipeline_redo_counts) splits the no-review places: Reviews and
 * Redo count only the places a run may reach, and the held backlog is carried as
 * `held` on the cell, never pickable. Until it has answered those two cells are "?".
 */
export function matrixCells(funnelRow, searchRow, outsideRow, redoRow) {
  const n = (v) => num(v) ?? 0;
  const f = funnelRow ?? {};
  const unknownSearch = !searchRow || !!searchRow.error;
  const unsearched = unknownSearch ? null : n(searchRow.uncoveredTiles) + n(searchRow.unfinishedSearches);
  const fresh = neverSeeded(f);
  const values = {
    box: outsideRow ? n(outsideRow.outside_active) : null,
    seed: fresh ? 1 : 0,
    unsearched,
    capped: unknownSearch ? null : n(searchRow.cappedOpen),
    pre_check: Math.max(0, n(f.active) - n(f.pre_checked)),
    // #4276 round 6: the places each stage would take, counted place by place by the
    // funnel (photos_needed, final_check_needed). A difference of two totals hid places
    // with photos that never passed the pre-check, or with only a failed-download marker.
    photos: f.photos_needed != null ? n(f.photos_needed) : Math.max(0, n(f.pre_passed) - n(f.with_photos)),
    final_check: f.final_check_needed != null ? n(f.final_check_needed) : Math.max(0, n(f.with_photos) - n(f.final_checked)),
    reviews: redoRow ? n(redoRow.reviews_eligible) : null,
    intelligence: n(f.rules_only),
    redo: redoRow ? n(redoRow.redo_eligible) : null,
    score: Math.max(0, n(f.servable) - n(f.scored)),
  };
  // What a search cell is made of, for its cost: tiles never searched, searches not done.
  const parts = {
    unsearched: unknownSearch ? null : { tiles: n(searchRow.uncoveredTiles), searches: n(searchRow.unfinishedSearches) },
  };
  return MATRIX_COLUMNS.map((c) => {
    const v = values[c.id];
    let text = v === null ? "?" : v === 0 ? "Done" : count(v);
    if (c.id === "seed") text = fresh ? "Never seeded" : "Done";
    // A city never seeded has nothing for the later stages to do yet.
    if (fresh && !["box", "seed", "unsearched"].includes(c.id) && v === 0) text = "–";
    const held = c.id === "reviews" ? n(redoRow?.reviews_held) : c.id === "redo" ? n(redoRow?.redo_held) : 0;
    // Nothing a run may reach, only held places: "–", not a gap and not pickable.
    if ((c.id === "reviews" || c.id === "redo") && v === 0 && held > 0) text = "–";
    return {
      id: c.id, kind: c.kind, value: v, text, gap: v !== null && v > 0, parts: parts[c.id] ?? null,
      held, heldText: held > 0 ? `Held: ${count(held)} (backlog paused)` : "",
      total: c.id === "reviews" ? n(f.no_reviews) : c.id === "redo" ? n(f.intelligence_without_reviews) : v,
    };
  });
}

/** The "All gaps" row: each column's total over the rows shown, "?" while any is unknown. */
export function matrixTotals(rowsOfCells) {
  return MATRIX_COLUMNS.map((c, i) => {
    let total = 0;
    let unknown = false;
    for (const cells of rowsOfCells) {
      const v = cells[i]?.value;
      if (v === null || v === undefined) unknown = true;
      else total += c.id === "seed" ? (cells[i].gap ? 1 : 0) : v;
    }
    const text = c.id === "seed"
      ? (total ? plural(total, "city", "cities") : "Done")
      : total ? `${count(total)}${unknown ? "+" : ""}` : unknown ? "?" : "Done";
    return { id: c.id, kind: c.kind, text, gap: total > 0 };
  });
}

const STAGE_WORDS = {
  pre_check: "Not pre-checked",
  photos: "Stuck at photos",
  final_check: "Final check not run",
  reviews: "Mostly no reviews",
  intelligence: "Rules only",
};

/**
 * The words under a city's name: Live or not, then where it stands. "Not started" for
 * a seeded city whose checks never ran, "Draft, never seeded" for a draft.
 */
export function cityStatusLine(funnelRow, cells) {
  const f = funnelRow ?? {};
  if (neverSeeded(f)) return "Draft, never seeded";
  const active = num(f.active) ?? 0;
  const servable = num(f.servable) ?? 0;
  const by = Object.fromEntries((cells ?? []).map((c) => [c.id, c]));
  let where;
  if (active > 0 && (by.pre_check?.value ?? 0) >= active) where = "Not started";
  else if (servable > 0 && (by.reviews?.total ?? by.reviews?.value ?? 0) * 2 > servable) where = STAGE_WORDS.reviews;
  else if (servable > 0 && (by.intelligence?.value ?? 0) * 2 > servable) where = STAGE_WORDS.intelligence;
  else {
    const first = ["pre_check", "photos", "final_check"].find((id) => (by[id]?.value ?? 0) > active * 0.25);
    where = first ? STAGE_WORDS[first]
      : (cells ?? []).some((c) => c.gap && c.kind !== "follows" && c.kind !== "redo") ? "Small gaps" : "Complete";
  }
  const held = num(f.held) ?? 0;
  const line = f.is_live ? `Live · ${where}` : where;
  return held > 0 ? `${line} · ${count(held)} held` : line;
}

/** The "Show" filter on the gaps table. */
export const MATRIX_FILTERS = Object.freeze([
  Object.freeze({ id: "all", label: "All cities" }),
  Object.freeze({ id: "live", label: "Live" }),
  Object.freeze({ id: "seeded", label: "Seeded, not live" }),
  Object.freeze({ id: "drafts", label: "Drafts" }),
]);

export function matrixFilter(funnelRow, filter) {
  if (filter === "live") return !!funnelRow?.is_live;
  if (filter === "seeded") return !funnelRow?.is_live && !neverSeeded(funnelRow);
  if (filter === "drafts") return neverSeeded(funnelRow);
  return true;
}

/** "39 x 55 km" from a box's corners, or "" when there is no box. */
export function boxSizeText(c) {
  const sw = [num(c?.bbox_sw_lat), num(c?.bbox_sw_lng)];
  const ne = [num(c?.bbox_ne_lat), num(c?.bbox_ne_lng)];
  if ([...sw, ...ne].some((v) => v === null)) return "";
  const midLat = ((sw[0] + ne[0]) / 2) * (Math.PI / 180);
  const w = Math.abs(ne[1] - sw[1]) * 111.32 * Math.cos(midLat);
  const h = Math.abs(ne[0] - sw[0]) * 110.57;
  return `${Math.round(w)} x ${Math.round(h)} km`;
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

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * Run a server read, and if it fails once, wait and run it once more before the
 * failure counts. A cold first call (the Intelligence coverage read) can time out
 * and then answer straight away; the second failure is the one a person sees.
 */
export async function withOneRetry(read, { delayMs = 1500, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  try {
    return await read();
  } catch {
    await wait(delayMs);
    return read();
  }
}


/** A place's stored check reasons ("B4:no_website;B6:no_hours") in words. */
export function reasonWords(stored) {
  if (!stored) return "No reason recorded";
  const words = String(stored).split(";").map((r) => r.trim()).filter(Boolean)
    .map((r) => { const code = r.split(":")[0]; return /^B\d+$/.test(code) ? ruleLabel(code) : r; });
  return [...new Set(words)].join(", ");
}

/**
 * The Cities tab's readiness, in the design's five words:
 *   Live              live, and reviews and Intelligence cover at least 95% of what
 *                     Explorers see
 *   Live, with gaps   live, with more than 5% of servable places missing reviews or
 *                     Intelligence
 *   Ready             not live, places Explorers could see and no gap
 *   Needs work        seeded, not live, with a gap or nothing servable yet
 *   Draft             never seeded
 * `why` is one sentence for "What's in the way", "Nothing" when nothing is.
 */
export function cityLaunchState(row, gaps) {
  const servable = num(row?.is_servable_places) ?? 0;
  const active = num(row?.total_active_places) ?? 0;
  const lines = gapLines(gaps);
  const why = lines.length ? `${lines.join(". ")}.` : "Nothing";
  if (row?.is_live_for_consumers) {
    const missing = Math.max(gaps?.missingIntelligence ?? 0, gaps?.missingReviews ?? 0);
    return servable > 0 && missing / servable > 0.05
      ? { key: "live_gaps", label: "Live, with gaps", variant: "warning", why }
      : { key: "live", label: "Live", variant: "success", why };
  }
  if (active === 0) return { key: "draft", label: "Draft", variant: "default", why: lines.length ? why : "Mapped, never seeded." };
  if (servable > 0 && lines.length === 0) return { key: "ready", label: "Ready", variant: "brand", why };
  return { key: "needs_work", label: "Needs work", variant: "error", why: servable === 0 && !lines.length ? "Seeded. The checks have not made any place servable yet." : why };
}

export const CITY_FILTERS = Object.freeze([
  Object.freeze({ id: "all", label: "All" }),
  Object.freeze({ id: "live", label: "Live" }),
  Object.freeze({ id: "ready", label: "Ready" }),
  Object.freeze({ id: "needs_work", label: "Needs work" }),
  Object.freeze({ id: "draft", label: "Drafts" }),
]);

export function cityFilterMatch(stateKey, filter) {
  if (filter === "all") return true;
  if (filter === "live") return stateKey === "live" || stateKey === "live_gaps";
  return stateKey === filter;
}

/**
 * The single rule that takes the biggest share of one city's active places at the
 * pre-check, for the Excluded banner. Null below 25%, or when nothing was checked.
 */
export function biggestRuleLoss(cities) {
  let best = null;
  for (const c of Array.isArray(cities) ? cities : []) {
    const active = num(c?.active) ?? 0;
    if (!c?.city_id || active <= 0) continue;
    for (const [rule, n] of Object.entries(c.pre_check ?? {})) {
      const places = num(n) ?? 0;
      const share = Math.round((places / active) * 100);
      if (!best || share > best.share) best = { city: c.city_name, rule, label: ruleLabel(rule), places, active, share };
    }
  }
  return best && best.share >= 25 ? best : null;
}

/** A place's Google type in words: "Pub", "Bakery", "Italian restaurant". */
export function placeTypeLabel(place) {
  const shown = typeof place?.primary_type_display_name === "string" ? place.primary_type_display_name.trim() : "";
  if (shown) return shown;
  const raw = typeof place?.primary_type === "string" ? place.primary_type.trim() : "";
  if (!raw) return "No type";
  const words = raw.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where one place stands, stage by stage, for the Browse side panel. Each stage is
 * { id, label, state: "done" | "failed" | "waiting" | "not_run", text }.
 */
function failedBecause(stored) {
  return stored ? `Failed: ${reasonWords(stored)}` : "Failed";
}

export function placeStages(place) {
  if (!place) return [];
  const photos = Array.isArray(place.stored_photo_urls) ? place.stored_photo_urls.length : 0;
  const stage = (id, label, state, text) => ({ id, label, state, text });
  const pre = place.passes_pre_photo_check === true ? stage("pre_check", "Pre-check", "done", "Passed")
    : place.passes_pre_photo_check === false ? stage("pre_check", "Pre-check", "failed", failedBecause(place.pre_photo_bouncer_reason))
    : stage("pre_check", "Pre-check", "not_run", "Not run");
  const pic = photos > 0 ? stage("photos", "Photos", "done", `${photos} saved`)
    : place.passes_pre_photo_check === false ? stage("photos", "Photos", "not_run", "Not needed: failed the pre-check")
    : stage("photos", "Photos", "not_run", "Not downloaded");
  const fin = place.is_servable === true ? stage("final_check", "Final check", "done", "Passed: Explorers can see it")
    : place.is_servable === false ? stage("final_check", "Final check", "failed", failedBecause(place.bouncer_reason))
    : stage("final_check", "Final check", "not_run", "Not run");
  const scores = place.is_servable !== true ? stage("scores", "Scores", "not_run", "Only for places that pass the final check")
    : place.ai_signal_scores ? stage("scores", "Scores", "done", "Scored")
    : stage("scores", "Scores", "failed", "Missing");
  const held = place.serving_hold ? [stage("held", "Held", "waiting", "Hidden until its run finishes")] : [];
  const active = place.is_active === false ? [stage("active", "Active pool", "failed", place.deleted_reason || "Removed")] : [];
  return [pre, pic, fin, scores, ...held, ...active];
}

// ── Picking gaps for a city's run, and what they cost ───────────────────────

// The rates a run uses. They mirror the server so a cell can show a cost before the
// run's own preview prices it; a test reads the server files and fails if they drift.
//   SEARCH_USD, PHOTO_USD, PHOTOS_PER_PLACE  supabase/functions/_shared/seedingGeometry.ts
//   SEARCHES_PER_TILE                        the 14 configs in _shared/seedingCategories.ts
//   SPLIT_SEARCHES                           a capped search repeats as 4 at half radius
//   REVIEW_MAX_PAGES                         run-city-pipeline/conductor.ts (Serper requests)
// Gemini's per-place rate comes from the server's cost model; Serper's from your rate.
export const PIPELINE_RATES = Object.freeze({
  SEARCH_USD: 0.032,
  PHOTO_USD: 0.007,
  PHOTOS_PER_PLACE: 5,
  SEARCHES_PER_TILE: 14,
  EXPECTED_PLACES_PER_TILE: 10,
  SPLIT_SEARCHES: 4,
  REVIEW_MAX_PAGES: 5,
});

function money(n) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * One cell's estimated cost: { usd, text }. usd is null when it can't be priced yet
 * (Serper with no rate, Gemini before its rate is read) and text then names the provider.
 * A free stage reads "Free". Cells with nothing to do, or that follow on their own,
 * have no cost line ({ usd: null, text: "" }).
 */
export function cellCost(cell, rates = {}) {
  const none = { usd: null, text: "" };
  if (!cell?.gap) return none;
  const r = PIPELINE_RATES;
  const v = num(cell.value) ?? 0;
  const priced = (usd) => ({ usd, text: money(usd) });
  switch (cell.id) {
    case "unsearched": {
      // The server's fill estimate (estimateFillCostUsd): every search, plus the photos the
      // new tiles are expected to bring.
      const p = cell.parts ?? { tiles: 0, searches: v };
      const searches = p.tiles * r.SEARCHES_PER_TILE + p.searches;
      const photos = p.tiles * r.EXPECTED_PLACES_PER_TILE * r.PHOTOS_PER_PLACE * r.PHOTO_USD;
      return priced(Math.round((searches * r.SEARCH_USD + photos) * 100) / 100);
    }
    case "capped":
      return priced(v * r.SPLIT_SEARCHES * r.SEARCH_USD);
    case "pre_check":
    case "final_check":
      return { usd: 0, text: "Free" };
    case "photos":
      return priced(v * r.PHOTOS_PER_PLACE * r.PHOTO_USD);
    case "reviews": {
      const rate = num(rates.serperUsdPerRequest);
      return rate === null ? { usd: null, text: "Serper" } : priced(v * r.REVIEW_MAX_PAGES * rate);
    }
    case "intelligence":
    case "redo": {
      const rate = num(rates.geminiPerPlaceUsd);
      return rate === null ? { usd: null, text: "Gemini" } : priced(v * rate);
    }
    default:
      return none;
  }
}

/** The "All gaps" row's cost per column: summed where every row could be priced. */
export function matrixTotalCosts(rowsOfCells, rates = {}) {
  return MATRIX_COLUMNS.map((c, i) => {
    let usd = 0;
    let any = false;
    let label = "";
    for (const cells of rowsOfCells) {
      const cost = cellCost(cells[i], rates);
      if (!cost.text) continue;
      any = true;
      if (cost.usd === null) label = cost.text;
      else usd += cost.usd;
    }
    if (!any) return { id: c.id, text: "" };
    if (label) return { id: c.id, text: usd > 0 ? `${money(usd)} + ${label}` : label };
    return { id: c.id, text: usd === 0 ? "Free" : money(usd) };
  });
}

// What a picked gap needs first, by what the data needs, not by stage order (the same
// rule as supabase/functions/run-city-pipeline/plan.ts). Photos are only downloaded for
// places that passed the pre-check; the final check needs photos; Intelligence and
// reviews only run on places that passed the final check. A redo or a reviews pick also
// evaluates places never evaluated, and the two are one piece of work. A search is never
// needed first: it finds places not found yet, which none of these need.
const NEEDS = Object.freeze({
  photos: ["pre_check"],
  final_check: ["photos", "pre_check"],
  intelligence: ["final_check", "photos", "pre_check"],
  // Reviews come with a place's first Intelligence; a redo is its own, separate choice.
  reviews: ["final_check", "photos", "pre_check", "intelligence"],
  redo: ["final_check", "photos", "pre_check", "intelligence"],
});

// A picked gap as the run's stage list (run-city-pipeline start and preview).
const SERVER_STAGE = Object.freeze({
  box: "box",
  seed: "fill",
  unsearched: "fill",
  capped: "split",
  pre_check: "pre_check",
  photos: "photos",
  final_check: "final_check",
  intelligence: "intelligence",
});

/** A cell a person can pick: a gap that doesn't simply follow on its own. */
export function pickable(cell) {
  return !!cell?.gap && cell.kind !== "follows";
}

/** The gaps a pick needs first, which the plan adds for you. Only gaps that exist. */
export function neededFirst(picked, cells) {
  const set = new Set(picked);
  const gaps = new Set((cells ?? []).filter(pickable).map((c) => c.id));
  const needed = new Set();
  for (const id of set) {
    for (const n of NEEDS[id] ?? []) {
      if (gaps.has(n) && !set.has(n)) needed.add(n);
    }
  }
  return needed;
}

/**
 * What the run is asked to do for these picks: its stage list and whether to redo
 * Intelligence with fresh reviews. The server adds what each stage needs first.
 */
export function serverPlanFor(picked) {
  const set = new Set(picked);
  const stages = [];
  for (const id of set) {
    const stage = SERVER_STAGE[id];
    if (stage && !stages.includes(stage)) stages.push(stage);
  }
  // Reviews are fetched with a place's first Intelligence; only Redo re-judges.
  if (set.has("reviews") && !stages.includes("intelligence")) stages.push("intelligence");
  const redoIntelligence = set.has("redo");
  if (redoIntelligence && !stages.includes("intelligence")) stages.push("intelligence");
  return { stages, redoIntelligence };
}

/** Everything a whole row picks: every gap that can be picked except optional redos. */
export function wholeRow(cells) {
  return (cells ?? []).filter((c) => pickable(c) && c.kind !== "redo").map((c) => c.id);
}

/** The Run plan's lines for a city's picks, in run order, with an estimated total. */
export function planLines(cells, picked, rates = {}) {
  const set = new Set(picked);
  const needed = neededFirst(picked, cells);
  const lines = [];
  for (const c of cells ?? []) {
    if (!set.has(c.id) && !needed.has(c.id)) continue;
    const col = MATRIX_COLUMNS.find((m) => m.id === c.id);
    lines.push({ id: c.id, label: col?.label ?? c.id, count: c.text, cost: cellCost(c, rates), needed: needed.has(c.id) });
  }
  const priced = lines.filter((l) => l.cost.usd !== null);
  const unpriced = lines.filter((l) => l.cost.usd === null && l.cost.text).map((l) => l.cost.text);
  const usd = priced.reduce((a, l) => a + l.cost.usd, 0);
  return {
    lines,
    totalText: `${money(usd)}${unpriced.length ? ` + ${[...new Set(unpriced)].join(" + ")}` : ""}`,
    searches: lines.some((l) => ["seed", "unsearched", "capped"].includes(l.id)),
    server: serverPlanFor(picked),
  };
}

/**
 * A count that depends on the pipeline table: "–" while it loads, "?" when it failed,
 * the number once it answered. Never 0 for a count nobody has read.
 */
export function loadedCount(value, { loading, error }) {
  if (error) return "?";
  if (loading || value === null || value === undefined) return "–";
  return count(value);
}

/** The Show chips' counts: a placeholder while loading, none on error. */
export function filterChipCount(n, { loading, error }) {
  if (error) return null;
  if (loading) return "–";
  return n;
}
