// #4255 W4 — Mingla team pushes reach the Host app through the existing
// outbox pipeline. Drives the REAL drain (processGeneric) and the REAL v2
// dispatcher (dispatchV2) with recording fakes, plus the pure shape check.
//
// FAILS-ON-REVERT: removing the #4255 team branch from validDeepLink in
// notifyV2.ts lets a forged team link through (the forged-link test reds);
// removing teamInAppSuppressed from the inbox insert puts a mention in the
// Host app bell (the bell test reds); removing resolveTeamPushText from the
// drain loses the names (the title tests red).
// #4255 fix-up: group messages are business.team_group_message, and chat
// messages (DMs and groups) never land in the Host app bell either: removing
// either from teamNotifications IN_APP_SUPPRESSED reds the group and DM tests;
// removing business.team_group_message from TEAM_NOTIFY_CATEGORIES reds the
// group test (no Host app push, no names).
// #4255 rework: quiet hours (22:00 to 07:00 in the person's time zone) hold
// every team row in the drain: deleting the quiet-hours block from
// processGeneric reds the R-QUIET tests (the push goes out at 23:00).
// Decisions and the due notice obey their in-app switch (payload.inapp):
// deleting the payload check from teamInAppSuppressed reds R-INAPP.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processGeneric } from "../../notify-outbox-drain/index.ts";
import {
  dispatchV2,
  type MinimalClient,
  providerSafePayload,
} from "../notifyV2.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { resolveOneSignalApp } from "../push-utils.ts";
import {
  renderTeamMessage,
  TEAM_NOTIFY_CATEGORIES,
  teamDeepLinkValid,
  teamInAppSuppressed,
  teamQuietUntil,
} from "../teamNotifications.ts";

const SERVICE_KEY = "issue-4255-service-role";
const SUPABASE_URL = "http://127.0.0.1:54321";
const USER_ID = "42550000-0000-4000-8000-000000000001";
const RAY = "42550000-0000-4000-8000-000000000002";
const FEYIKEMI = "42550000-0000-4000-8000-000000000003";
const THREAD = "42550000-0000-4000-8000-0000000000a1";
const OTHER_THREAD = "42550000-0000-4000-8000-0000000000a2";
const MESSAGE = "42550000-0000-4000-8000-0000000000b1";
const MENTION = "42550000-0000-4000-8000-0000000000c1";
const CARD = "42550000-0000-4000-8000-0000000000d1";
const EVENT = "42550000-0000-4000-8000-0000000000e1";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

interface World {
  tables: Record<string, Record<string, AnyRecord>>;
  names: Record<string, string>;
  failTable?: string;
  outboxUpdates: AnyRecord[];
  dispatchBodies: AnyRecord[];
  dispatchResults: AnyRecord[];
  onesignal: AnyRecord[];
  inbox: AnyRecord[];
  deliveries: AnyRecord[];
  reads?: string[];
}

const LONG =
  "Venue for the 22nd is confirmed. @Seth can you post the flyer today? " +
  "The printers close at six and Ada wants the final file before lunch so she can share it.";

const newWorld = (over: Partial<World> = {}): World => ({
  tables: {
    team_threads: {
      [THREAD]: { kind: "group", title: "Lagos launch" },
      [OTHER_THREAD]: { kind: "dm", title: null },
    },
    team_messages: { [MESSAGE]: { body_md: LONG, deleted_at: null } },
    team_mentions: {
      [MENTION]: {
        actor_user_id: RAY,
        body_excerpt:
          "Ray tagged you on Edit the end card: “@Seth the end card needs your sign-off before Friday”",
      },
    },
    ops_work_cards: { [CARD]: { number: 612 } },
    // #4255 rework: the person's time zone, read for quiet hours.
    profiles: { [USER_ID]: { timezone: "Africa/Lagos" } },
  },
  names: { [RAY]: "Ray", [FEYIKEMI]: "Feyikemi" },
  outboxUpdates: [],
  dispatchBodies: [],
  dispatchResults: [],
  onesignal: [],
  inbox: [],
  deliveries: [],
  ...over,
});

function drainAdmin(world: World) {
  return {
    from(table: string) {
      let id = "";
      const builder: AnyRecord = {
        select: () => builder,
        eq: (_col: string, value: string) => {
          id = value;
          return builder;
        },
        maybeSingle: () => {
          (world.reads ??= []).push(table);
          return Promise.resolve(
            world.failTable === table
              ? { data: null, error: { message: "boom" } }
              : { data: world.tables[table]?.[id] ?? null, error: null },
          );
        },
        update(values: AnyRecord) {
          if (table === "notification_outbox") world.outboxUpdates.push(values);
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
      return builder;
    },
    rpc(fn: string, args: AnyRecord) {
      if (fn === "team_chat_name") {
        return Promise.resolve({
          data: world.names[args.p_user_id] ?? "A teammate",
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function dispatchClient(world: World): MinimalClient {
  return {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: (_col: string, key: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    (TEAM_NOTIFY_CATEGORIES as readonly string[]).includes(key)
                      ? {
                        key,
                        is_transactional: true,
                        urgency: "normal",
                        active: true,
                        default_channels: ["inapp", "push"],
                      }
                      : null,
                  error: null,
                }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        insert(row: AnyRecord) {
          if (table === "notifications") world.inbox.push(row);
          if (table === "notification_deliveries") world.deliveries.push(row);
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: `42550000-0000-4000-8000-${
                      String(world.inbox.length).padStart(12, "0")
                    }`,
                  },
                  error: null,
                }),
            }),
          });
        },
        update: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
    rpc(fn: string) {
      return Promise.resolve({
        data: fn === "can_send" ? true : null,
        error: null,
      });
    },
  } as unknown as MinimalClient;
}

async function withEnv(fn: () => Promise<void>) {
  const values: Record<string, string> = {
    DENO_TESTING: "1",
    ONESIGNAL_BUSINESS_APP_ID: "business-app-4255",
    ONESIGNAL_BUSINESS_REST_API_KEY: "business-key-4255",
    ONESIGNAL_APP_ID: "consumer-app-4255",
    ONESIGNAL_REST_API_KEY: "consumer-key-4255",
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((k) => [k, Deno.env.get(k)]),
  );
  for (const [k, v] of Object.entries(values)) Deno.env.set(k, v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

// 10:00 in Lagos (09:00 UTC): outside quiet hours, so the older tests send.
const DAYTIME = new Date("2026-11-11T09:00:00Z");

async function send(
  world: World,
  row: AnyRecord,
  now: Date = DAYTIME,
): Promise<boolean> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/functions/v1/notify-dispatch")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        world.dispatchBodies.push(body);
        const result = await dispatchV2(dispatchClient(world), {
          user_id: body.user_id ?? null,
          contact: body.contact ?? null,
          category_key: body.category_key,
          payload: body.payload ?? {},
          idempotency_key: body.idempotency_key,
          deep_link: body.deep_link ?? null,
        });
        world.dispatchResults.push(result);
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
        });
      }
      if (url.includes("onesignal.com")) {
        world.onesignal.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ id: "os-4255", recipients: 1 }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  try {
    return await processGeneric(
      drainAdmin(world),
      row,
      SUPABASE_URL,
      SERVICE_KEY,
      now,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Shapes exactly as team_chat_enqueue and ops_notify_people write them. A DM
// is business.team_message; a group or the Mingla team is
// business.team_group_message (#4255 fix-up, 20280624044255).
const chatCategory = (over: AnyRecord): string =>
  over.thread_kind === "dm"
    ? "business.team_message"
    : "business.team_group_message";
const chatMessageRow = (over: AnyRecord = {}): AnyRecord => ({
  id: "outbox-team-message",
  category_key: chatCategory(over),
  user_id: USER_ID,
  contact: null,
  attempts: 0,
  idempotency_key: `${chatCategory(over)}:${MESSAGE}:${USER_ID}`,
  payload: {
    source_kind: "team_message",
    thread_id: THREAD,
    thread_kind: "group",
    message_id: MESSAGE,
    actor_user_id: FEYIKEMI,
    attachment_count: 0,
    attachment_kind: null,
    deep_link: `mingla-business://team/${THREAD}`,
    ...over,
  },
});

const cardMentionRow = (over: AnyRecord = {}): AnyRecord => ({
  id: "outbox-card-mention",
  category_key: "business.team_mention",
  user_id: USER_ID,
  contact: null,
  attempts: 0,
  idempotency_key: `business.team_mention:${MENTION}`,
  payload: {
    source_kind: "work_card",
    reason: "mention",
    mention_id: MENTION,
    source_id: EVENT,
    card_id: CARD,
    deep_link: `mingla-business://team/mention/${MENTION}`,
    ...over,
  },
});

Deno.test("#4255 a group message pushes '<Sender> in <Chat>' with the first 120 characters, to the Host app, ids only", async () => {
  await withEnv(async () => {
    const world = newWorld();
    const row = chatMessageRow();
    const before = JSON.stringify(row.payload);
    assertEquals(await send(world, row), true);
    assertEquals(
      JSON.stringify(row.payload),
      before,
      "the outbox row keeps ids only",
    );
    assertEquals(world.onesignal.length, 1);
    const push = world.onesignal[0];
    assertEquals(push.app_id, "business-app-4255");
    assertEquals(push.headings.en, "Feyikemi in Lagos launch");
    assert(
      push.contents.en.length <= 120 && push.contents.en.length >= 110,
      push.contents.en,
    );
    assert(push.contents.en.startsWith("Venue for the 22nd is confirmed."));
    assert(push.contents.en.endsWith("…"));
    assertEquals(push.data.thread_id, THREAD);
    assertEquals(push.data.message_id, MESSAGE);
    for (
      const key of [
        "team_sender",
        "team_chat",
        "team_excerpt",
        "actor_user_id",
        "body_md",
      ]
    ) {
      assertEquals(key in push.data, false, `${key} must not reach OneSignal`);
    }
    // #4255 fix-up: team chat lives in the Mingla team space, not the bell.
    assertEquals(row.category_key, "business.team_group_message");
    assertEquals(world.inbox.length, 1);
    assert(
      typeof world.inbox[0].in_app_suppressed_at === "string",
      "the bell must not show a group message",
    );
    assertEquals(
      world.deliveries.find((d) => d.channel === "inapp")?.status,
      "suppressed",
    );
    assertEquals(world.outboxUpdates.at(-1)?.status, "done");
  });
});

Deno.test("#4255 a direct message is titled with the sender only", async () => {
  await withEnv(async () => {
    const world = newWorld();
    const row = chatMessageRow({
      thread_id: OTHER_THREAD,
      thread_kind: "dm",
      deep_link: `mingla-business://team/${OTHER_THREAD}`,
    });
    assertEquals(await send(world, row), true);
    assertEquals(row.category_key, "business.team_message");
    assertEquals(world.onesignal[0].headings.en, "Feyikemi");
    assert(
      typeof world.inbox[0].in_app_suppressed_at === "string",
      "the bell must not show a direct message",
    );
  });
});

Deno.test("#4255 a message with only a photo says 'Feyikemi sent a photo'", async () => {
  await withEnv(async () => {
    const world = newWorld();
    world.tables.team_messages[MESSAGE] = { body_md: "", deleted_at: null };
    assertEquals(
      await send(
        world,
        chatMessageRow({ attachment_count: 1, attachment_kind: "image" }),
      ),
      true,
    );
    assertEquals(world.onesignal[0].contents.en, "Feyikemi sent a photo");
    const two = renderTeamMessage("business.team_message", {
      team_sender: "Feyikemi",
      team_chat: "Lagos launch",
      attachment_count: 2,
      attachment_kind: "mixed",
    });
    assertEquals(two.push.body, "Feyikemi sent 2 files");
  });
});

Deno.test("#4255 a card mention pushes 'Ray mentioned you · #612' and never lands in the Host app bell", async () => {
  await withEnv(async () => {
    const world = newWorld();
    assertEquals(await send(world, cardMentionRow()), true);
    const push = world.onesignal[0];
    assertEquals(push.app_id, "business-app-4255");
    assertEquals(push.headings.en, "Ray mentioned you · #612");
    assert(push.contents.en.length <= 120);
    assertEquals(push.data.mention_id, MENTION);
    assertEquals(push.data.card_id, CARD);
    assertEquals(
      world.dispatchBodies[0].deep_link,
      `mingla-business://team/mention/${MENTION}`,
    );
    // The notifications row exists for the ledger but is born suppressed.
    assertEquals(world.inbox.length, 1);
    assert(
      typeof world.inbox[0].in_app_suppressed_at === "string",
      "the bell must not show a team mention",
    );
    const inapp = world.deliveries.find((d) => d.channel === "inapp");
    assertEquals(inapp?.status, "suppressed");
    assertEquals(inapp?.failed_reason, "inapp_in_team_mentions");
    assertEquals(world.outboxUpdates.at(-1)?.status, "done");
  });
});

Deno.test("#4255 a chat mention and a reply name the chat", async () => {
  await withEnv(async () => {
    const world = newWorld();
    const row = {
      ...cardMentionRow(),
      payload: {
        source_kind: "team_message",
        reason: "mention",
        mention_id: MENTION,
        thread_id: THREAD,
        thread_kind: "group",
        message_id: MESSAGE,
        actor_user_id: FEYIKEMI,
        attachment_count: 0,
        attachment_kind: null,
        deep_link: `mingla-business://team/${THREAD}`,
      },
    };
    assertEquals(await send(world, row), true);
    assertEquals(
      world.onesignal[0].headings.en,
      "Feyikemi mentioned you in Lagos launch",
    );
    const reply = renderTeamMessage("business.team_mention", {
      source_kind: "team_message",
      reason: "reply",
      team_sender: "Ray",
      team_chat: "Mingla team",
    });
    assertEquals(reply.push.title, "Ray replied to you in Mingla team");
  });
});

Deno.test("#4255 decision and work-update titles; no email, no text message", () => {
  const decision = renderCategoryMessage("business.team_decision", {
    team_sender: "Taofeek",
    team_card_number: 610,
  });
  assertEquals(decision.push.title, "Taofeek needs your decision · #610");
  assertEquals(decision.email.subject, "");
  assertEquals(decision.sms, "");
  const update = renderCategoryMessage("business.team_mention", {
    source_kind: "work_card",
    reason: "work_update",
    team_sender: "Ray",
    team_card_number: 612,
  });
  assertEquals(update.push.title, "Ray updated #612");
  const unknown = renderCategoryMessage("business.team_message", {});
  assertEquals(unknown.push.title, "A teammate");
  assertEquals(unknown.push.body, "Open Mingla Host to read it.");
});

Deno.test("#4255 deep-link shape check accepts only team/<uuid> and team/mention/<uuid> naming the payload's id", () => {
  const thread = { thread_id: THREAD };
  const mention = { mention_id: MENTION, thread_id: THREAD };
  // Accepted.
  assert(
    teamDeepLinkValid(
      "business.team_message",
      `mingla-business://team/${THREAD}`,
      thread,
    ),
  );
  assert(
    teamDeepLinkValid(
      "business.team_mention",
      `mingla-business://team/${THREAD}`,
      mention,
    ),
  );
  assert(
    teamDeepLinkValid(
      "business.team_mention",
      `mingla-business://team/mention/${MENTION}`,
      mention,
    ),
  );
  assert(
    teamDeepLinkValid(
      "business.team_decision",
      `mingla-business://team/mention/${MENTION}`,
      mention,
    ),
  );
  // Refused.
  const refused: Array<[string, string | null | undefined, AnyRecord]> = [
    ["business.team_message", null, thread],
    [
      "business.team_group_message",
      `mingla-business://team/mention/${MENTION}`,
      mention,
    ],
    [
      "business.team_group_message",
      `mingla-business://team/${OTHER_THREAD}`,
      thread,
    ],
    ["business.team_message", undefined, thread],
    ["business.team_message", "", thread],
    [
      "business.team_message",
      `mingla-business://team/mention/${MENTION}`,
      mention,
    ],
    ["business.team_message", `mingla-business://team/${OTHER_THREAD}`, thread],
    ["business.team_message", `mingla-business://team/${THREAD}/x`, thread],
    ["business.team_message", `mingla-business://team/${THREAD}?x=1`, thread],
    ["business.team_message", ` mingla-business://team/${THREAD}`, thread],
    ["business.team_message", `mingla-business://messages/${THREAD}`, thread],
    ["business.team_message", `mingla://team/${THREAD}`, thread],
    [
      "business.team_message",
      `https://admin.usemingla.com/#/messages?thread=${THREAD}`,
      thread,
    ],
    ["business.team_message", "mingla-business://team/not-a-uuid", {
      thread_id: "not-a-uuid",
    }],
    [
      "business.team_mention",
      `mingla-business://team/mention/${CARD}`,
      mention,
    ],
    ["business.team_mention", `mingla-business://team/mention/${MENTION}`, {}],
    [
      "business.team_mention",
      `mingla-business://team/mention/${MENTION}/edit`,
      mention,
    ],
    [
      "business.team_mention",
      `mingla-business://team/mention/${MENTION.toUpperCase()}`,
      { mention_id: MENTION.toUpperCase() },
    ],
    ["business.team_decision", `mingla-business://team/${THREAD}`, {
      mention_id: MENTION,
    }],
  ];
  for (const [category, link, payload] of refused) {
    assertEquals(
      teamDeepLinkValid(category as "business.team_message", link, payload),
      false,
      `${category} ${link}`,
    );
  }
});

Deno.test("#4255 a forged team link is refused by the dispatcher before anything is sent", async () => {
  await withEnv(async () => {
    for (
      const forged of [
        "https://evil.example/#/x",
        `mingla-business://team/${OTHER_THREAD}`,
        `mingla-business://community/roadmap`,
      ]
    ) {
      const world = newWorld();
      const ok = await send(world, chatMessageRow({ deep_link: forged }));
      assertEquals(ok, false, forged);
      assertEquals(
        world.dispatchResults[0].reason,
        "deep_link_invalid",
        forged,
      );
      assertEquals(world.onesignal.length + world.inbox.length, 0, forged);
      assertEquals(world.outboxUpdates.at(-1)?.status, "retry_wait", forged);
    }
  });
});

Deno.test("#4255 a failed name lookup retries the row instead of sending without words", async () => {
  await withEnv(async () => {
    const world = newWorld({ failTable: "team_threads" });
    assertEquals(await send(world, chatMessageRow()), false);
    assertEquals(world.dispatchBodies.length, 0);
    assertEquals(world.outboxUpdates.at(-1)?.status, "retry_wait");
  });
});

Deno.test("#4255 the four team categories go to the Host OneSignal app; mentions and chat messages skip the bell", () => {
  assertEquals([...TEAM_NOTIFY_CATEGORIES], [
    "business.team_message",
    "business.team_group_message",
    "business.team_mention",
    "business.team_decision",
    "business.team_due",
  ]);
  for (const category of TEAM_NOTIFY_CATEGORIES) {
    assertEquals(resolveOneSignalApp(category), "business", category);
    const safe = providerSafePayload(category, {
      thread_id: THREAD,
      mention_id: MENTION,
      team_sender: "Ray",
      team_chat: "Lagos launch",
      team_excerpt: "secret words",
      deep_link: `mingla-business://team/${THREAD}`,
    });
    assertEquals(
      Object.keys(safe).sort(),
      ["mention_id", "thread_id"],
      category,
    );
  }
  assertEquals(teamInAppSuppressed("business.team_mention"), true);
  assertEquals(teamInAppSuppressed("business.team_message"), true);
  assertEquals(teamInAppSuppressed("business.team_group_message"), true);
  assertEquals(teamInAppSuppressed("business.team_decision"), false);
  assertEquals(teamInAppSuppressed("admin.team_mention"), false);
});

// ---------------------------------------------------------------------------
// #4255 rework (P1): quiet hours. Lagos is UTC+1 all year.
// ---------------------------------------------------------------------------

const decisionRow = (over: AnyRecord = {}): AnyRecord => ({
  ...cardMentionRow(),
  id: "outbox-decision",
  category_key: "business.team_decision",
  idempotency_key: `business.team_decision:${MENTION}`,
  payload: {
    ...cardMentionRow().payload,
    reason: "decision",
    inapp: true,
    ...over,
  },
});
const dueRow = (over: AnyRecord = {}): AnyRecord => ({
  id: "outbox-due",
  category_key: "business.team_due",
  user_id: USER_ID,
  contact: null,
  attempts: 0,
  idempotency_key: `business.team_due:${MENTION}`,
  payload: {
    source_kind: "work_due",
    reason: "due",
    mention_id: MENTION,
    due_today: 1,
    late: 1,
    inapp: true,
    deep_link: `mingla-business://team/mention/${MENTION}`,
    ...over,
  },
});

Deno.test("#4255 R-QUIET a team push queued at 23:00 local is held until 07:00 local, untouched attempts, nothing sent", async () => {
  await withEnv(async () => {
    for (
      const row of [
        chatMessageRow({
          thread_kind: "dm",
          thread_id: OTHER_THREAD,
          deep_link: `mingla-business://team/${OTHER_THREAD}`,
        }),
        chatMessageRow(),
        cardMentionRow(),
        decisionRow(),
        dueRow(),
      ]
    ) {
      const world = newWorld();
      // 23:00 in Lagos = 22:00 UTC.
      const sent = await send(world, row, new Date("2026-11-11T22:00:00Z"));
      assertEquals(sent, false, row.category_key);
      assertEquals(world.dispatchBodies.length, 0, row.category_key);
      assertEquals(world.onesignal.length, 0, row.category_key);
      assertEquals(world.outboxUpdates, [{
        status: "retry_wait",
        // 07:00 in Lagos the next morning = 06:00 UTC.
        next_attempt_at: "2026-11-12T06:00:00.000Z",
        last_error: "quiet_hours",
      }], row.category_key);
    }
  });
});

Deno.test("#4255 R-QUIET 06:59:30 waits 30 seconds more; 07:00 sends; 21:59 sends; 22:00 waits", async () => {
  await withEnv(async () => {
    let world = newWorld();
    await send(world, cardMentionRow(), new Date("2026-11-12T05:59:30Z"));
    assertEquals(
      world.outboxUpdates[0]?.next_attempt_at,
      "2026-11-12T06:00:30.000Z",
      "a minute at least, never a busy loop",
    );
    assertEquals(world.onesignal.length, 0);
    for (const at of ["2026-11-12T06:00:00Z", "2026-11-11T20:59:00Z"]) {
      world = newWorld();
      assertEquals(await send(world, cardMentionRow(), new Date(at)), true, at);
      assertEquals(world.onesignal.length, 1, at);
      assertEquals(world.outboxUpdates.at(-1)?.status, "done", at);
    }
    world = newWorld();
    assertEquals(
      await send(world, cardMentionRow(), new Date("2026-11-11T21:00:00Z")),
      false,
    );
    assertEquals(world.outboxUpdates[0]?.last_error, "quiet_hours");
  });
});

Deno.test("#4255 R-QUIET the person's own time zone decides (New York 23:00 is Lagos 05:00)", async () => {
  await withEnv(async () => {
    const world = newWorld();
    world.tables.profiles[USER_ID] = { timezone: "America/New_York" };
    // 2026-11-11 23:00 New York (EST, UTC-5) = 04:00Z.
    assertEquals(
      await send(world, cardMentionRow(), new Date("2026-11-12T04:00:00Z")),
      false,
    );
    assertEquals(
      world.outboxUpdates[0]?.next_attempt_at,
      "2026-11-12T12:00:00.000Z",
    );
    // 10:00 New York = 15:00Z: sent.
    const day = newWorld();
    day.tables.profiles[USER_ID] = { timezone: "America/New_York" };
    assertEquals(
      await send(day, cardMentionRow(), new Date("2026-11-12T15:00:00Z")),
      true,
    );
  });
});

Deno.test("#4255 R-QUIET a failed time-zone read retries the row (never sent, never dropped); other categories never read it", async () => {
  await withEnv(async () => {
    const world = newWorld({ failTable: "profiles" });
    assertEquals(
      await send(world, cardMentionRow(), new Date("2026-11-11T22:00:00Z")),
      false,
    );
    assertEquals(world.onesignal.length, 0);
    assertEquals(world.outboxUpdates[0]?.status, "retry_wait");
    assertEquals(world.outboxUpdates[0]?.attempts, 1);
    assert(
      String(world.outboxUpdates[0]?.last_error).includes(
        "team_quiet_hours_lookup_failed",
      ),
    );
    const other = newWorld();
    await send(other, {
      ...cardMentionRow(),
      category_key: "admin.team_mention",
    }, new Date("2026-11-11T22:00:00Z"));
    assertEquals((other.reads ?? []).includes("profiles"), false);
  });
});

Deno.test("#4255 R-QUIET teamQuietUntil: 22:00 to 07:00 local, to the second; an unknown zone holds an hour", () => {
  const lagos = (iso: string) => teamQuietUntil("Africa/Lagos", new Date(iso));
  assertEquals(lagos("2026-11-11T20:59:59Z"), null); // 21:59:59
  assertEquals(lagos("2026-11-11T21:00:00Z"), "2026-11-12T06:00:00.000Z"); // 22:00
  assertEquals(lagos("2026-11-11T23:30:00Z"), "2026-11-12T06:00:00.000Z"); // 00:30
  assertEquals(lagos("2026-11-12T05:59:59Z"), "2026-11-12T06:00:59.000Z"); // 06:59:59, a minute floor
  assertEquals(lagos("2026-11-12T06:00:00Z"), null); // 07:00
  assertEquals(
    teamQuietUntil("Not/AZone", new Date("2026-11-11T12:00:00Z")),
    "2026-11-11T13:00:00.000Z",
  );
});

Deno.test("#4255 R-INAPP decisions and the due notice: in-app off pushes without a bell row; in-app on reaches the bell", async () => {
  await withEnv(async () => {
    for (
      const [row, title] of [[
        decisionRow({ inapp: false }),
        "Ray needs your decision · #612",
      ], [dueRow({ inapp: false }), "Your cards due and late"]] as const
    ) {
      const world = newWorld();
      assertEquals(await send(world, row), true, row.category_key);
      assertEquals(world.onesignal.length, 1, row.category_key);
      assertEquals(world.onesignal[0]?.headings?.en, title, row.category_key);
      assert(
        world.inbox[0]?.in_app_suppressed_at,
        `${row.category_key}: no bell row`,
      );
    }
    for (const row of [decisionRow(), dueRow()]) {
      const world = newWorld();
      assertEquals(await send(world, row), true);
      assertEquals(
        world.inbox[0]?.in_app_suppressed_at,
        undefined,
        `${row.category_key}: in the bell`,
      );
    }
  });
  assertEquals(
    teamInAppSuppressed("business.team_decision", { inapp: false }),
    true,
  );
  assertEquals(
    teamInAppSuppressed("business.team_due", { inapp: false }),
    true,
  );
  assertEquals(
    teamInAppSuppressed("business.team_due", { inapp: true }),
    false,
  );
  assertEquals(
    teamInAppSuppressed("admin.team_mention", { inapp: false }),
    false,
    "only team categories",
  );
});

Deno.test("#4255 R-DUE the due notice opens Mentions and carries ids and counts only", () => {
  const link = `mingla-business://team/mention/${MENTION}`;
  assertEquals(
    teamDeepLinkValid("business.team_due", link, { mention_id: MENTION }),
    true,
  );
  assertEquals(
    teamDeepLinkValid("business.team_due", `mingla-business://team/${THREAD}`, {
      mention_id: MENTION,
    }),
    false,
  );
  const safe = providerSafePayload("business.team_due", dueRow().payload);
  assertEquals(Object.keys(safe).sort(), ["mention_id", "reason"]);
  assertEquals(
    renderTeamMessage("business.team_due", {
      team_excerpt: "1 due today · 1 late: Book the venue",
    }).push,
    {
      title: "Your cards due and late",
      body: "1 due today · 1 late: Book the venue",
    },
  );
});
