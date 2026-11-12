// Issue #4398 — the due label every Work card shows (board, subtask lists,
// card detail): "Overdue 4 days" in red, "Due today", "Due tomorrow",
// "Due Fri 14 Nov" within six days, "Due 21 Nov" later, and "Done 11 Nov" for
// a closed card. Pure: today is passed in (YYYY-MM-DD, the person's own day).
// The Host app's Work updates use the same rules
// (mingla-business/src/components/minglaTeam/workUpdates.ts).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function utcDay(value) {
  if (typeof value !== "string") return null;
  const m = value.match(DATE_RE);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

/** The local calendar day (YYYY-MM-DD) of a date-time, in the browser's zone. */
export function localDay(value) {
  const t = Date.parse(value || "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * { text, tone, full } for a card. tone is over | today | soon | week | later
 * | done | none. full is the long date for the detail view ("Fri 14 Nov 2026").
 */
export function dueLabel(card, today) {
  const done = card?.status === "done";
  const dueT = utcDay(card?.due_on);
  const todayT = utcDay(today);
  if (done) {
    const closedT = utcDay(localDay(card?.closed_at) || "") ?? dueT;
    if (closedT == null) return { text: "Done", tone: "done", full: "" };
    const c = new Date(closedT);
    return { text: `Done ${c.getUTCDate()} ${MONTHS[c.getUTCMonth()]}`, tone: "done", full: dueT != null ? `Was due ${long(dueT)}` : "" };
  }
  if (dueT == null || todayT == null) return { text: "No due date", tone: "none", full: "" };
  const days = Math.round((dueT - todayT) / 86400000);
  const d = new Date(dueT);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (days < 0) {
    const n = -days;
    return { text: `Overdue ${n} ${n === 1 ? "day" : "days"}`, tone: "over", full: `Was due ${long(dueT)}` };
  }
  if (days === 0) return { text: "Due today", tone: "today", full: long(dueT) };
  if (days === 1) return { text: "Due tomorrow", tone: "soon", full: long(dueT) };
  if (days <= 6) return { text: `Due ${WEEKDAYS[d.getUTCDay()]} ${date}`, tone: "week", full: long(dueT) };
  return { text: `Due ${date}`, tone: "later", full: long(dueT) };
}

function long(t) {
  const d = new Date(t);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Tailwind classes for each tone, from the Admin tokens (light and dark). */
export const DUE_TONE = Object.freeze({
  over: "bg-[var(--color-error-50)] text-[var(--color-error-700)] font-bold",
  today: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] font-bold",
  soon: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-bold",
  week: "bg-[var(--gray-100)] text-[var(--color-text-primary)] font-bold",
  later: "bg-[var(--gray-50)] text-[var(--color-text-secondary)] font-semibold",
  done: "bg-[var(--color-success-50)] text-[var(--color-success-700)] font-bold",
  none: "bg-[var(--gray-50)] text-[var(--color-text-tertiary)] font-semibold",
});

/**
 * Working days (Monday to Friday) a card has waited in review, from the time
 * the owner asked to now. "Waiting on <watcher> for N days" shows from 2.
 */
export function workingDaysSince(value, now = new Date()) {
  const t = Date.parse(value || "");
  if (!Number.isFinite(t)) return 0;
  let n = 0;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) n += 1;
  }
  return n;
}

/** "Waiting on Seth" or, after two working days, "Waiting on Seth for 3 days". */
export function waitingWords(card, now = new Date()) {
  const r = card?.review;
  if (!r) return "";
  const who = r.waiting_on || "the watcher";
  const n = workingDaysSince(r.requested_at, now);
  return n >= 2 ? `Waiting on ${who} for ${n} days` : `Waiting on ${who}`;
}
