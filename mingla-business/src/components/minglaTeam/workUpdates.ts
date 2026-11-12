/**
 * #4398 — Mingla team > Work updates in the Host app: only what a person did
 * (mentions, a card waiting for your confirm, a card sent back to you, a card
 * given to you, a status change on a card you own or watch). The server sends
 * nothing else here (team_inbox reads push notices only). Filters All / Needs
 * you / Mentions, and the due label the Admin board uses
 * (mingla-admin/src/lib/dueLabel.js): "Overdue 4 days", "Due today",
 * "Due tomorrow", "Due Fri 14 Nov" within six days, "Due 21 Nov" later,
 * "Done 11 Nov". Pure, so it is tested without a device.
 */
import type { TeamMention } from "../../services/teamChatService";
import type { TeamT } from "./teamText";

export type WorkUpdateFilter = "all" | "needs" | "mentions";
export type DueTone = "over" | "today" | "soon" | "week" | "later" | "done" | "none";

export interface WorkUpdateCard {
  number: number;
  title: string;
  status: string;
  due_on: string | null;
  closed_at: string | null;
  column: string | null;
  in_review: boolean;
  owner: string | null;
  watcher: string | null;
  parent: { number: number; title: string } | null;
}

/** A Work update notice: the team_inbox mention row with its card. */
export type WorkUpdate = TeamMention & {
  event_kind?: string | null;
  needs_you?: boolean;
  card?: WorkUpdateCard | null;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function utcDay(value: string | null | undefined): number | null {
  const m = typeof value === "string" ? value.match(DATE_RE) : null;
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

/** The person's own calendar day of a date-time, as YYYY-MM-DD. */
export function localDay(value: string | null | undefined): string | null {
  const t = Date.parse(value ?? "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateWords(t: number, language: string, weekday: boolean): string {
  try {
    return new Intl.DateTimeFormat(language, { timeZone: "UTC", day: "numeric", month: "short", ...(weekday ? { weekday: "short" } : {}) }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/** { text, tone } for a card's due date, in the person's language. today is YYYY-MM-DD. */
export function workDueLabel(card: Pick<WorkUpdateCard, "status" | "due_on" | "closed_at"> | null | undefined, today: string, t: TeamT, language: string): { text: string; tone: DueTone } {
  if (!card) return { text: "", tone: "none" };
  const dueT = utcDay(card.due_on);
  if (card.status === "done") {
    const closedT = utcDay(localDay(card.closed_at)) ?? dueT;
    return closedT == null ? { text: "", tone: "none" } : { text: t("team.done_on", { date: dateWords(closedT, language, false) }), tone: "done" };
  }
  const todayT = utcDay(today);
  if (dueT == null || todayT == null) return { text: "", tone: "none" };
  const days = Math.round((dueT - todayT) / 86_400_000);
  if (days < 0) return { text: days === -1 ? t("team.due_overdue_one") : t("team.due_overdue", { n: -days }), tone: "over" };
  if (days === 0) return { text: t("team.due_today"), tone: "today" };
  if (days === 1) return { text: t("team.due_tomorrow"), tone: "soon" };
  if (days <= 6) return { text: t("team.due_on", { date: dateWords(dueT, language, true) }), tone: "week" };
  return { text: t("team.due_on", { date: dateWords(dueT, language, false) }), tone: "later" };
}

/**
 * A notice that still asks this person to act: confirm a card, or a card sent back to them.
 * The server's needs_you turns false once the ask is resolved (#4398 retest P3), read or not;
 * only a payload without it falls back to the kind.
 */
export function needsYou(update: Pick<WorkUpdate, "event_kind" | "needs_you">): boolean {
  if (typeof update.needs_you === "boolean") return update.needs_you;
  return update.event_kind === "review" || update.event_kind === "sent_back";
}

export function isMention(update: Pick<WorkUpdate, "event_kind" | "kind">): boolean {
  return update.event_kind === "mention" || update.kind === "mention";
}

export function filterWorkUpdates<T extends WorkUpdate>(list: readonly T[], filter: WorkUpdateFilter): T[] {
  if (filter === "needs") return list.filter(needsYou);
  if (filter === "mentions") return list.filter(isMention);
  return [...list];
}

/** Unread count per filter, for the chips. */
export function workUpdateCounts(list: readonly WorkUpdate[]): Record<WorkUpdateFilter, number> {
  const unread = list.filter((m) => m.read_at === null);
  return { all: unread.length, needs: unread.filter(needsYou).length, mentions: unread.filter(isMention).length };
}
