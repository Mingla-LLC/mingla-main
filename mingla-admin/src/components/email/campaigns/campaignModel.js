// Issue #4419 — the Emails tab and one email's page, as data.
//
// Everything the list and the detail page decide (which pill, which time,
// which banner, which actions, which counts, what the export holds, how
// engagement is worded) lives here so a plain node test can check every
// state in the approved design without rendering anything.
//
// Pure module: no React, no Supabase.
import { audienceFilterWords } from "../../../lib/emailAudience.js";
import { formatInZone, isValidTimeZone } from "../../../lib/scheduleTime.js";
import { SNAPSHOT_FAILED_PARTWAY, emailFailureWords, partialCountWords } from "../../../lib/emailFailureWords.js";

export const LIST_FILTERS = Object.freeze([
  Object.freeze({ id: "all", label: "All" }),
  Object.freeze({ id: "scheduled", label: "Scheduled" }),
  Object.freeze({ id: "sending", label: "Sending" }),
  Object.freeze({ id: "sent", label: "Sent" }),
  Object.freeze({ id: "attention", label: "Needs attention" }),
  Object.freeze({ id: "cancelled", label: "Cancelled" }),
]);

/** Non-admins see scheduled emails only (Seth, 13 Nov), so only these chips. */
export function listFiltersFor(isAdmin) {
  return isAdmin ? LIST_FILTERS : LIST_FILTERS.filter((f) => f.id === "all" || f.id === "scheduled");
}

export const STATE_PILLS = Object.freeze({
  scheduled: Object.freeze({ label: "Scheduled", variant: "info" }),
  sending: Object.freeze({ label: "Sending", variant: "warning" }),
  sent: Object.freeze({ label: "Sent", variant: "success" }),
  partial: Object.freeze({ label: "Partially sent", variant: "warning" }),
  failed: Object.freeze({ label: "Failed", variant: "error" }),
  cancelled: Object.freeze({ label: "Cancelled", variant: "default" }),
  unknown: Object.freeze({ label: "Unknown", variant: "outline" }),
});

/** The pill for a state; the server's label wins (e.g. "Starting"). */
export function statePill(state, stateLabel) {
  const pill = STATE_PILLS[state] || STATE_PILLS.unknown;
  return { label: stateLabel || pill.label, variant: pill.variant };
}

// The sample person every saved copy and preview is written for (#4419).
const SAMPLE_TOKENS = Object.freeze({ first_name: "Maya", display_name: "Maya Okafor", username: "mayaexplores" });

/** A subject or preview line as the sample person (Maya) sees it, so the list never shows "{first_name}". */
export function sampleText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\{\s*(first_name|display_name|username)\s*\}/gi, (_m, key) => SAMPLE_TOKENS[key.toLowerCase()]);
}

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

function segmentLabel(seg) {
  if (!seg || seg.type === "all") return "All users";
  if (seg.type === "country") return `Country: ${seg.country || "—"}`;
  if (seg.type === "onboarding") return `Onboarding: ${seg.onboarding || "—"}`;
  if (seg.type === "status") return `Status: ${seg.status || "—"}`;
  return "Custom";
}

/** Who an email is for, in the composer's words (#4226). Never a bulk address. */
export function campaignAudienceLabel(row) {
  const audience = row?.audience;
  if (row?.recipient_type === "individual" || audience?.mode === "person") {
    return row?.to_label ? `One person · ${row.to_label}` : "One person";
  }
  if (audience?.mode === "everyone") return "Everyone";
  if (audience?.mode === "segment") {
    const active = audienceFilterWords(audience.filters);
    return active.length ? active.join(" · ") : "All Host & Explorer users";
  }
  return segmentLabel(row?.segment_filter);
}

/** "in 2 days", "5 days ago", "just now" (whole units, never a guess). */
export function relativeWords(iso, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const diff = at - now;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  if (abs < minute) return "just now";
  // #4419 (tester P3-2): rounded to the nearest unit, so 47 h 59 min is
  // "in 2 days", never "in 1 day".
  let words;
  const minutes = Math.round(abs / minute);
  const hours = Math.round(abs / hour);
  if (minutes < 60) words = `${minutes} min`;
  else if (hours < 24) words = `${hours} hour${hours === 1 ? "" : "s"}`;
  else {
    const d = Math.round(hours / 24);
    words = `${d} day${d === 1 ? "" : "s"}`;
  }
  return diff > 0 ? `in ${words}` : `${words} ago`;
}

/** A time in its own zone with the zone's short name: "Sat 15 Nov · 09:00 (Africa/Lagos)". */
export function zonedTime(iso, zone) {
  const safe = isValidTimeZone(zone) ? zone : "UTC";
  const text = formatInZone(iso, safe);
  return text ? `${text} (${safe})` : "";
}

/** The one time that matters on a list row, per state (the design's "when" cell). */
export function listWhen(row, now = Date.now()) {
  const zone = row?.timezone || "UTC";
  switch (row?.state) {
    case "scheduled":
      return row.scheduled_for
        ? `Goes out ${zonedTime(row.scheduled_for, zone)} · ${relativeWords(row.scheduled_for, now)}`
        : "Goes out soon";
    case "sending":
      return row.state_label === "Starting"
        ? "Starting now"
        : `${fmt(row.accepted)} of ${fmt(row.will_receive)} so far`;
    case "sent":
      return `Sent ${relativeWords(row.completed_at || row.started_at || row.created_at, now)}${row.has_snapshot ? "" : " · before exact copies"}`;
    case "partial":
      return `Stopped ${relativeWords(row.completed_at || row.started_at || row.created_at, now)}`;
    case "failed":
      return `Failed ${relativeWords(row.completed_at || row.started_at || row.created_at, now)}`;
    case "cancelled":
      return row.scheduled_for ? `Was for ${zonedTime(row.scheduled_for, zone)}` : "Never went out";
    default:
      return `Created ${relativeWords(row?.created_at, now)}`;
  }
}

/** The list's count cell: the big number and the matched line under it. */
export function listCount(row) {
  const matched = `${fmt(row?.matched)} matched`;
  if (row?.state === "scheduled" || row?.state === "cancelled" || row?.state === "unknown") {
    return { big: fmt(row?.will_receive), words: row?.state === "cancelled" ? "would have got it" : "will get it", small: matched };
  }
  const delivered = row?.delivered === null || row?.delivered === undefined ? null : `${fmt(row.delivered)} delivered`;
  return { big: fmt(row?.accepted), words: "accepted", small: delivered ? `${matched} · ${delivered}` : matched };
}

/** "1–20 of 31" */
export function pageRange(page, pageSize, total) {
  if (!total) return "0 of 0";
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return `${fmt(from)}–${fmt(to)} of ${fmt(total)}`;
}

const NOT_YET = "Not yet";

/**
 * The timeline: Created → Scheduled for (or Sent right away) → Sending started
 * → Finished / Stopped early / Failed / Cancelled. Each step: tone (done, now,
 * todo, half, bad, off), label, value, who. No time-left estimate: nothing
 * computes one (spec deviation 2).
 */
export function timelineSteps(detail) {
  const c = detail?.campaign || {};
  const counts = detail?.counts || {};
  const zone = c.timezone || "UTC";
  const when = (iso) => (iso ? zonedTime(iso, zone) : "");
  const steps = [{ tone: "done", label: "Created", value: when(c.created_at) || "Not recorded", who: c.created_by_name ? `by ${c.created_by_name}` : "" }];
  if (c.scheduled_for) {
    const moved = Array.isArray(c.rescheduled) && c.rescheduled.length ? c.rescheduled[c.rescheduled.length - 1] : null;
    steps.push({ tone: "done", label: "Scheduled for", value: when(c.scheduled_for), who: moved?.by_name ? `${zone} · time changed by ${moved.by_name}` : zone });
  } else {
    steps.push({ tone: "done", label: "Sent right away", value: "No schedule", who: "Send now" });
  }
  switch (c.state) {
    case "cancelled":
      steps.push({ tone: "off", label: "Cancelled", value: when(c.cancelled_at) || "Not recorded", who: c.cancelled_by_name ? `by ${c.cancelled_by_name}` : "by someone, before this was recorded" });
      steps.push({ tone: "todo", label: "Finished", value: "Will not go out", who: "" });
      break;
    case "scheduled":
      steps.push({ tone: "todo", label: "Sending started", value: NOT_YET, who: "" });
      steps.push({ tone: "todo", label: "Finished", value: NOT_YET, who: "" });
      break;
    case "sending":
      steps.push({ tone: "now", label: "Sending started", value: when(c.started_at) || "Starting now", who: "In progress" });
      steps.push({ tone: "todo", label: "Finished", value: NOT_YET, who: "" });
      break;
    case "sent":
      steps.push({ tone: "done", label: "Sending started", value: when(c.started_at) || "Not recorded", who: "" });
      steps.push({ tone: "done", label: "Finished", value: when(c.completed_at) || "Not recorded", who: `${fmt(counts.accepted)} accepted` });
      break;
    case "partial":
      steps.push({ tone: "done", label: "Sending started", value: when(c.started_at) || "Not recorded", who: "" });
      steps.push({ tone: "half", label: "Stopped early", value: when(c.completed_at) || "Not recorded", who: "Some did not get it" });
      break;
    case "failed":
      steps.push({ tone: c.started_at ? "done" : "todo", label: "Sending started", value: when(c.started_at) || (c.started_at ? "" : "Never started"), who: "" });
      steps.push({ tone: "bad", label: "Failed", value: when(c.completed_at) || "Not recorded", who: Number(counts.accepted) > 0 ? `${fmt(counts.accepted)} got it` : "Nobody got it" });
      break;
    default:
      steps.push({ tone: "todo", label: "Sending started", value: "Unknown", who: "" });
      steps.push({ tone: "todo", label: "Finished", value: "Unknown", who: "" });
  }
  return steps;
}

/** The frame's label (the promise: what you see is a preview, the copy, or a rebuild). */
export function viewLabel(kind) {
  return kind === "exact" ? "Exact copy" : kind === "rebuilt" ? "Rebuilt" : "Preview";
}

/** The sentence for this email's failure, with the partial count when it is partial. */
export function failureSentence(detail) {
  const code = detail?.failure?.summary_code || "other";
  const someGotIt = Number(detail?.counts?.accepted || 0) > 0;
  const sentence = code === "email_snapshot_failed" && someGotIt ? SNAPSHOT_FAILED_PARTWAY : emailFailureWords(code);
  if (detail?.campaign?.state === "partial") {
    const counts = detail?.counts || {};
    const missed = Math.max(Number(counts.to_send || 0) - Number(counts.accepted || 0), Number(counts.failed || 0));
    return `${sentence} ${partialCountWords(counts.accepted, missed)}`;
  }
  return sentence;
}

/**
 * The banners above the frame, in order. Each: tone (info, ok, warn, err,
 * neutral), icon, title, text. A sent email without a copy says Rebuilt; a
 * partial or failed one also says why, in plain words (raw text stays in the
 * Delivery card's fold).
 */
export function bannersFor(detail) {
  const c = detail?.campaign || {};
  const view = detail?.view || {};
  const counts = detail?.counts || {};
  const zone = c.timezone || "UTC";
  const out = [];
  const rebuilt = {
    tone: "neutral", icon: "layers", title: "Rebuilt from saved blocks",
    text: "This was sent before Admin kept an exact copy. It may differ slightly from what people got, for example if the blog post or template changed since.",
  };
  switch (c.state) {
    case "scheduled":
      out.push({
        tone: "info", icon: "eye", title: "Not sent yet. This is a preview.",
        text: `It may change if you edit the words, or if the blog post changes before ${c.scheduled_for ? zonedTime(c.scheduled_for, zone) : "it sends"}. The exact copy is saved when it sends.`,
      });
      break;
    case "sending":
      out.push(view.kind === "exact"
        ? { tone: "warn", icon: "clock", title: "Sending now", text: "This is the exact copy going out. You can't change or stop it once it has started." }
        : { tone: "warn", icon: "clock", title: "Starting to send", text: "The exact copy is saved when the first batch goes out. You can't change or stop it now." });
      break;
    case "sent":
      out.push(view.kind === "exact"
        ? { tone: "ok", icon: "check", title: "Exact copy of what was sent", text: "Saved when sending started, for a sample person (Maya). Personal fields like first name were filled in for each person." }
        : rebuilt);
      break;
    case "partial":
      out.push({ tone: "warn", icon: "alert", title: `Partially sent: ${fmt(counts.accepted)} of ${fmt(counts.to_send)} got it`, text: failureSentence(detail) });
      if (view.kind === "rebuilt") out.push(rebuilt);
      break;
    case "failed":
      out.push({
        tone: "err", icon: "alert",
        title: Number(counts.accepted) > 0 ? `Failed after ${fmt(counts.accepted)} got it.` : "Failed. Nobody got this email.",
        text: failureSentence(detail),
      });
      if (view.kind === "rebuilt") out.push(rebuilt);
      break;
    case "cancelled":
      out.push({
        tone: "neutral", icon: "ban",
        title: c.cancelled_by_name
          ? `Cancelled by ${c.cancelled_by_name}${c.cancelled_at ? ` on ${zonedTime(c.cancelled_at, zone)}` : ""}`
          : `Cancelled${c.cancelled_at ? ` on ${zonedTime(c.cancelled_at, zone)}` : ""}, by someone, before this was recorded`,
        text: "It never went out. This is how it would have looked.",
      });
      break;
    default:
      out.push({ tone: "neutral", icon: "info", title: "We can't tell where this email is", text: "Its status isn't one Admin knows, so nothing is guessed. Tell engineering if it matters." });
  }
  return out;
}

/**
 * The actions that fit the state (approved defaults: no "Send to the rest";
 * "Send test to me" on scheduled and sent emails; export is counts only).
 */
export function actionsFor(detail, { isAdmin = false } = {}) {
  const c = detail?.campaign || {};
  switch (c.state) {
    case "scheduled":
      return [
        { id: "change_time", label: "Change time", disabled: !c.can_change, title: c.can_change ? "" : "It has started sending" },
        { id: "edit_words", label: "Edit words", disabled: !c.can_change, title: c.can_change ? "" : "It has started sending" },
        { id: "send_test", label: "Send test to me" },
        { id: "cancel", label: "Cancel", danger: true, disabled: !c.can_change },
      ];
    case "sending":
      return [{ id: "change_time", label: "Change time", disabled: true, title: "It has started sending" }];
    case "sent":
    case "partial":
      return isAdmin
        ? [{ id: "duplicate", label: "Duplicate as new", primary: true }, { id: "send_test", label: "Send test to me" }, { id: "export", label: "Export counts" }]
        : [];
    case "failed":
      return isAdmin ? [{ id: "duplicate", label: "Duplicate as new", primary: true }, { id: "export", label: "Export counts" }] : [];
    case "cancelled":
      return isAdmin ? [{ id: "duplicate", label: "Duplicate as new", primary: true }] : [];
    default:
      return [];
  }
}

/** The Delivery card's headline numbers. */
export function deliveryHeadline(detail) {
  const c = detail?.campaign || {};
  const n = detail?.counts || {};
  const toSend = Number(n.to_send || 0);
  const matched = Number(n.matched || 0);
  if (c.state === "scheduled" || c.state === "cancelled" || c.state === "unknown") {
    return {
      kind: "plan",
      cells: [
        { label: "Matched", value: fmt(matched) },
        { label: "Left out", value: fmt(Math.max(matched - toSend, 0)) },
        { label: c.state === "cancelled" ? "Would have got it" : "Will get it", value: fmt(toSend), tone: "ok" },
      ],
      note: c.state === "scheduled"
        ? "Counted when it was scheduled. Anyone who unsubscribes before then is skipped."
        : "Counted when it was scheduled.",
    };
  }
  if (c.state === "sending") {
    const done = Number(n.accepted || 0) + Number(n.failed || 0);
    const pct = toSend > 0 ? Math.min(100, Math.round((done / toSend) * 100)) : 0;
    return { kind: "progress", done, total: toSend, pct, words: `${fmt(done)} of ${fmt(toSend)}`, note: "Updates every few seconds" };
  }
  const notSent = c.state === "failed" ? Math.max(toSend - Number(n.accepted || 0), Number(n.failed || 0)) : Number(n.failed || 0);
  return {
    kind: "result",
    cells: [
      { label: "Matched", value: fmt(matched) },
      { label: "Accepted", value: fmt(n.accepted), tone: "ok" },
      { label: c.state === "failed" ? "Not sent" : "Failed", value: fmt(notSent), tone: notSent > 0 ? "bad" : "" },
    ],
    note: "",
  };
}

/** Matched − each reason left out = to send; then accepted / failed once it went. */
export function funnelRows(detail) {
  const c = detail?.campaign || {};
  const n = detail?.counts || {};
  const rows = [
    { label: "Matched the audience", value: n.matched, kind: "head" },
    { label: "Staff and test accounts", value: n.internal, kind: "minus" },
    { label: "Didn't agree to marketing", value: n.no_consent, kind: "minus" },
    { label: "Unsubscribed", value: n.unsubscribed, kind: "minus" },
    { label: "No valid email", value: n.no_contact, kind: "minus" },
    { label: "Duplicate address", value: n.duplicate, kind: "minus" },
    { label: c.state === "scheduled" ? "Will be sent to" : c.state === "cancelled" ? "Would have been sent to" : "Sent to", value: n.to_send, kind: "total" },
  ];
  if (c.state === "sent" || c.state === "partial" || c.state === "sending") {
    rows.push({ label: "Accepted by provider", value: n.accepted, kind: "head" });
    rows.push({ label: "Failed", value: n.failed, kind: "minus" });
    if (c.state === "sending") rows.push({ label: "Still to send", value: n.pending, kind: "minus" });
  }
  if (c.state === "failed") {
    rows.push({ label: "Accepted by provider", value: n.accepted, kind: "head" });
    rows.push({ label: "Not sent", value: Math.max(Number(n.to_send || 0) - Number(n.accepted || 0), Number(n.failed || 0)), kind: "minus" });
  }
  return rows.map((row) => ({ ...row, value: fmt(row.value) }));
}

/**
 * The export: counts and reasons only, never an address (approved default
 * D4). Rows of { measure, count }.
 */
export function exportRows(detail) {
  const funnel = funnelRows(detail).map((row) => ({ measure: row.label, count: row.value.replace(/,/g, "") }));
  const reasons = (detail?.failure?.by_reason || []).map((r) => ({ measure: `Failed: ${emailFailureWords(r.code)}`, count: String(r.count) }));
  const e = detail?.engagement;
  const after = e
    ? [
      { measure: "Delivered", count: String(e.delivered ?? 0) },
      { measure: "Bounced (permanent)", count: String(e.bounced?.hard ?? 0) },
      { measure: "Bounced (temporary)", count: String(e.bounced?.soft ?? 0) },
      { measure: "Marked as spam", count: String(e.complained ?? 0) },
      { measure: "Opened, approximate (people)", count: e.tracking?.opens_seen ? String(e.opened_unique ?? 0) : "not tracked" },
      { measure: "Clicked (people)", count: e.tracking?.clicks_seen_anywhere ? String(e.clicked_unique ?? 0) : "click tracking is off" },
    ]
    : [];
  return [...funnel, ...reasons, ...after];
}

/**
 * "After it left us" (#4419 Part B). Opens are approximate (Apple Mail loads
 * every image). A number is only shown when the provider is reporting it:
 * no open events means "not tracked, or nobody opened"; no click event on any
 * Admin email means click tracking is off (a Seth-owned provider switch).
 * Never a 0% that wasn't measured.
 */
export function engagementView(detail) {
  const c = detail?.campaign || {};
  if (!["sent", "partial", "sending", "failed"].includes(c.state)) return null;
  const e = detail?.engagement;
  if (!e) return { state: "unavailable", text: "Couldn't load what happened after it left us. Try again in a moment." };
  if (Number(e.accepted || 0) === 0 && Number(e.events || 0) === 0) {
    return { state: "none", text: "Nothing reached the provider, so there is nothing to track." };
  }
  const tracking = e.tracking || {};
  const rows = [
    { label: "Delivered", value: fmt(e.delivered) },
    { label: "Bounced", value: fmt(Number(e.bounced?.hard || 0) + Number(e.bounced?.soft || 0)), sub: `${fmt(e.bounced?.hard)} permanent · ${fmt(e.bounced?.soft)} temporary` },
    { label: "Marked as spam", value: fmt(e.complained) },
    tracking.opens_seen
      ? { label: "Opened (approximate)", value: fmt(e.opened_unique), sub: `${fmt(e.opened_total)} opens in all` }
      : { label: "Opened (approximate)", value: "—", sub: "Opens aren't tracked for this sender, or nobody opened yet." },
    !tracking.clicks_seen_anywhere
      ? { label: "Clicked", value: "—", sub: "Click tracking is off" }
      : tracking.clicks_seen
      ? { label: "Clicked", value: fmt(e.clicked_unique), sub: `${fmt(e.clicked_total)} clicks in all` }
      : { label: "Clicked", value: "—", sub: "No clicks yet." },
  ];
  const links = Array.isArray(e.top_links) ? e.top_links.map((l) => ({ url: l.url, words: `${fmt(l.unique)} people · ${fmt(l.total)} clicks` })) : [];
  return { state: "ready", rows, links, note: "Opens are approximate: some mail apps open every email to load images." };
}

/**
 * A draft for "Duplicate as new": the same words and blocks. The audience is
 * offered in the drafts' own shape, so the composer reads it through the
 * #3720 host-default guard (composerStateFromDraft): a host segment comes
 * back as it was; anything else (everyone, one person) starts at the hosts
 * default for the teammate to choose again, never a wider audience.
 */
export function duplicateDraft(detail) {
  const c = detail?.campaign || {};
  const audience = c.audience && typeof c.audience === "object" ? c.audience : null;
  return {
    key: `${c.id}:${Date.now()}`,
    subject: typeof c.subject === "string" ? c.subject : "",
    document: Array.isArray(c.document) ? c.document : [],
    audience: {
      audienceMode: audience?.mode === "segment" ? "segment" : audience?.mode === "person" ? "person" : "everyone",
      filters: audience?.mode === "segment" && audience.filters && typeof audience.filters === "object" ? audience.filters : {},
    },
  };
}

export const SENDING_POLL_MS = 5000;

/**
 * Refresh an email's page every 5 s while it is sending. It stops by itself
 * once a refresh says the email left Sending, and when the returned stop()
 * runs (the page closing). `timers` is injectable for tests.
 */
export function startSendingPoll({ refresh, every = SENDING_POLL_MS, timers = globalThis }) {
  let stopped = false;
  let id = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (id !== null) timers.clearInterval(id);
  };
  id = timers.setInterval(async () => {
    if (stopped) return;
    const detail = await refresh();
    if (detail && detail.campaign?.state !== "sending") stop();
  }, every);
  return stop;
}
