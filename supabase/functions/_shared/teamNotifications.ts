// #4255 W4 — Mingla team notifications (team chat messages, Admin mentions
// and decisions) delivered to the Host app.
//
// Producers live in SQL (team_chat_enqueue and ops_notify_people,
// 20280614034255_issue_4255_team_chat_functions.sql) and write
// notification_outbox rows that carry ids only. This module is the one place
// the dispatcher, the outbox drain and the templates learn about these
// categories:
//   * teamDeepLinkValid       the strict deep-link shape check (notifyV2)
//   * teamProviderSafeKeys    the ids that may reach OneSignal (notifyV2)
//   * teamInAppSuppressed     which category never makes a Host app bell row
//   * renderTeamMessage       push words from the resolved names (templates)
//   * resolveTeamPushText     names and excerpts looked up from the ids (drain)
//   * teamQuietUntil         quiet hours 22:00 to 07:00 local (drain)
// Pushes go to the business (Host) OneSignal app: every category here starts
// with "business.", which resolveOneSignalApp routes there.

import { isQuietHours } from "./quietHours.ts";

export const TEAM_NOTIFY_CATEGORIES = [
  "business.team_message",
  // #4255 fix-up: group and Mingla team messages have their own switch
  // (20280614044255): a DM pushes by default, a group only once switched on.
  "business.team_group_message",
  "business.team_mention",
  "business.team_decision",
  // #4255 rework: "My cards due and late", one notice at 09:00 local
  // (ops_due_digest, 20280614054255).
  "business.team_due",
] as const;

export type TeamNotifyCategory = typeof TEAM_NOTIFY_CATEGORIES[number];

export function isTeamNotifyCategory(
  category: string,
): category is TeamNotifyCategory {
  return (TEAM_NOTIFY_CATEGORIES as readonly string[]).includes(category);
}

// Orchestrator decision (10 Nov): a mention's in-app home is the Mingla team
// Mentions tab (team_mentions), so business.team_mention never adds a row to
// the Host app bell. The notifications row is still written (the delivery
// ledger hangs off it) but is born suppressed.
// #4255 fix-up (orchestrator decision): team chat lives in the Mingla team
// space, not the bell, so chat messages (DMs and groups) are born suppressed
// too. Decisions (business.team_decision) still reach the bell.
const IN_APP_SUPPRESSED: ReadonlySet<string> = new Set([
  "business.team_mention",
  "business.team_message",
  "business.team_group_message",
]);

export function teamInAppSuppressed(
  category: string,
  payload: Record<string, unknown> = {},
): boolean {
  if (IN_APP_SUPPRESSED.has(category)) return true;
  // #4255 rework: a decision or the due notice for someone who switched its
  // in-app notices off still pushes (when push is on) but makes no bell row.
  // The producer reads the switch (can_send) and says so in the payload.
  return isTeamNotifyCategory(category) && payload.inapp === false;
}

// ---------------------------------------------------------------------------
// Quiet hours (spec rev 3: "Quiet hours 22:00 to 07:00 hold pushes, which stay
// waiting in Messages"). The drain holds a team row until 07:00 in the
// person's own time zone (profiles.timezone, the source the legacy path
// reads); the Mentions tab and Admin Messages already have it.
// ---------------------------------------------------------------------------
export const TEAM_QUIET_END_HOUR = 7;

/** The instant quiet hours end (07:00:00 local), or null when it is not quiet. */
export function teamQuietUntil(
  timezone: string | null,
  now: Date = new Date(),
): string | null {
  if (!isQuietHours(timezone, now, TEAM_QUIET_END_HOUR)) return null;
  let hour = 0, minute = 0, second = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
      timeZone: timezone || "America/New_York",
    }).formatToParts(now);
    const part = (type: string): number =>
      Number(parts.find((p) => p.type === type)?.value ?? "0");
    hour = part("hour") % 24;
    minute = part("minute");
    second = part("second");
  } catch {
    // An unknown zone counts as quiet (isQuietHours fails closed): hold an hour.
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }
  const secondsLeft = ((TEAM_QUIET_END_HOUR - hour + 24) % 24) * 3600 -
    minute * 60 - second;
  return new Date(now.getTime() + Math.max(secondsLeft, 60) * 1000)
    .toISOString();
}

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const THREAD_LINK = new RegExp(`^mingla-business://team/(${UUID})$`);
const MENTION_LINK = new RegExp(`^mingla-business://team/mention/(${UUID})$`);

const idOf = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === "string" ? String(payload[key]) : "";

/**
 * Only mingla-business://team/<uuid> (a chat) and
 * mingla-business://team/mention/<uuid> (an Admin mention) are accepted, and
 * the id must be the payload's own thread or mention. A chat message opens
 * only its chat.
 */
export function teamDeepLinkValid(
  category: TeamNotifyCategory,
  deepLink: string | null | undefined,
  payload: Record<string, unknown> = {},
): boolean {
  if (typeof deepLink !== "string") return false;
  const thread = THREAD_LINK.exec(deepLink);
  if (thread) return thread[1] === idOf(payload, "thread_id");
  if (
    category === "business.team_message" ||
    category === "business.team_group_message"
  ) return false;
  const mention = MENTION_LINK.exec(deepLink);
  return !!mention && mention[1] === idOf(payload, "mention_id");
}

/** Opaque ids only: never a name, a chat title or message words. */
export function teamProviderSafeKeys(): string[] {
  return ["thread_id", "message_id", "mention_id", "card_id", "reason"];
}

// ---------------------------------------------------------------------------
// Words. The drain adds these resolved fields to the dispatch payload (never
// to the outbox row): team_sender, team_chat, team_chat_kind, team_card_number,
// team_excerpt.
// ---------------------------------------------------------------------------

function plain(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function teamCut(value: unknown, max: number): string {
  const text = plain(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function attachmentWords(payload: Record<string, unknown>): string {
  const n = Number(payload.attachment_count ?? 0);
  if (!Number.isSafeInteger(n) || n < 1) return "";
  const kind = String(payload.attachment_kind ?? "");
  if (n === 1 && kind === "image") return "sent a photo";
  if (n === 1 && kind === "link") return "sent a link";
  if (n === 1) return "sent a file";
  if (kind === "image") return `sent ${n} photos`;
  return `sent ${n} files`;
}

export interface TeamRendered {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string;
}

export function renderTeamMessage(
  category: TeamNotifyCategory,
  payload: Record<string, unknown>,
): TeamRendered {
  const sender = teamCut(payload.team_sender, 40) || "A teammate";
  const chatKind = String(payload.team_chat_kind ?? payload.thread_kind ?? "");
  const chat = teamCut(payload.team_chat, 40) ||
    (chatKind === "team" ? "Mingla team" : "");
  const num = Number(payload.team_card_number);
  const card = Number.isSafeInteger(num) && num > 0 ? `#${num}` : "";
  const reason = String(payload.reason ?? "");
  const words = teamCut(payload.team_excerpt, 120);
  const files = attachmentWords(payload);
  const body = words || (files ? `${sender} ${files}` : "") ||
    "Open Mingla Host to read it.";
  const inChat = chatKind !== "dm" && chat ? ` in ${chat}` : "";

  let title: string;
  if (
    category === "business.team_message" ||
    category === "business.team_group_message"
  ) {
    title = chatKind === "dm" || !chat ? sender : `${sender} in ${chat}`;
  } else if (category === "business.team_due") {
    // #4255 rework: the 09:00 notice; its words are the excerpt ("2 due
    // today · 1 late: …").
    title = "Your cards due and late";
  } else if (category === "business.team_decision") {
    title = card
      ? `${sender} needs your decision · ${card}`
      : `${sender} needs your decision`;
  } else if (String(payload.source_kind ?? "") === "work_card") {
    if (reason === "mention") {
      title = card
        ? `${sender} mentioned you · ${card}`
        : `${sender} mentioned you`;
    } else {
      title = card
        ? `${sender} updated ${card}`
        : `${sender} updated a work card`;
    }
  } else if (reason === "reply") {
    title = `${sender} replied to you${inChat}`;
  } else {
    title = `${sender} mentioned you${inChat}`;
  }
  const shortTitle = title.length <= 65
    ? title
    : `${title.slice(0, 64).trimEnd()}…`;
  return {
    push: { title: shortTitle, body },
    email: { subject: "", body: "" },
    sms: "",
  };
}

// ---------------------------------------------------------------------------
// The drain's lookup. Service role. A failed read throws so the outbox row is
// retried (never sent with missing words, never dropped).
// ---------------------------------------------------------------------------

interface TeamLookupClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

async function one(
  client: TeamLookupClient,
  table: string,
  cols: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const { data, error } = await client.from(table).select(cols).eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`team_lookup_failed:${table}`);
  return (data as Record<string, unknown> | null) ?? null;
}

export async function resolveTeamPushText(
  client: TeamLookupClient,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const category = String(row.category_key ?? "");
  if (!isTeamNotifyCategory(category)) return {};
  const payload = (row.payload as Record<string, unknown> | null) ?? {};
  const out: Record<string, unknown> = {};

  let actor = idOf(payload, "actor_user_id");
  const mention = await one(
    client,
    "team_mentions",
    "actor_user_id, body_excerpt",
    idOf(payload, "mention_id"),
  );
  if (!actor && typeof mention?.actor_user_id === "string") {
    actor = mention.actor_user_id;
  }
  if (actor) {
    const { data, error } = await client.rpc("team_chat_name", {
      p_user_id: actor,
    });
    if (error) throw new Error("team_lookup_failed:team_chat_name");
    if (typeof data === "string") out.team_sender = data;
  }

  const thread = await one(
    client,
    "team_threads",
    "kind, title",
    idOf(payload, "thread_id"),
  );
  if (thread) {
    out.team_chat_kind = thread.kind;
    if (thread.kind !== "dm" && typeof thread.title === "string") {
      out.team_chat = thread.title;
    }
  }

  const message = await one(
    client,
    "team_messages",
    "body_md, deleted_at",
    idOf(payload, "message_id"),
  );
  if (message && !message.deleted_at && typeof message.body_md === "string") {
    out.team_excerpt = teamCut(message.body_md, 120);
  } else if (!message && typeof mention?.body_excerpt === "string") {
    out.team_excerpt = teamCut(mention.body_excerpt, 120);
  }

  const card = await one(
    client,
    "ops_work_cards",
    "number",
    idOf(payload, "card_id"),
  );
  if (card && card.number !== null && card.number !== undefined) {
    out.team_card_number = Number(card.number);
  }
  return out;
}
