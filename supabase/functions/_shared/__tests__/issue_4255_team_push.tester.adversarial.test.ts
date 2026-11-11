// #4255 tester adversarial — Mingla team push words and lookups, from angles
// the implementor suite does not take:
//   * a failed NAME lookup (team_chat_name rpc error, not a table read)
//     throws, so the drain retries the row instead of sending "A teammate"
//   * a deleted message never lends its words to a push, even though its
//     team_mentions row still holds the old excerpt
//   * a DM never names a chat title, even if the row carries one
//   * every other category is untouched: no team lookup runs for it, so a
//     failing team table can never stall a Brand group or buyer push
//   * markup and links in the words are stripped; long names keep the title
//     at 65 characters; attachment counts and kinds read right; ids only
//     reach the provider
//
// FAILS-ON-REVERT (each proved by deleting the line in teamNotifications.ts
// and re-running this file, see the #4255 tester verdict):
//   * `if (error) throw new Error("team_lookup_failed:team_chat_name")`
//   * `!message.deleted_at &&` in resolveTeamPushText
//   * `if (!isTeamNotifyCategory(category)) return {};` in resolveTeamPushText
//   * `if (thread.kind !== "dm" && ...)` in resolveTeamPushText

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { providerSafePayload } from "../notifyV2.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import {
  renderTeamMessage,
  resolveTeamPushText,
  teamCut,
} from "../teamNotifications.ts";

const ACTOR = "4255a000-0000-4000-8000-000000000001";
const ME = "4255a000-0000-4000-8000-000000000002";
const THREAD = "4255a000-0000-4000-8000-0000000000a1";
const DM = "4255a000-0000-4000-8000-0000000000a2";
const MESSAGE = "4255a000-0000-4000-8000-0000000000b1";
const MENTION = "4255a000-0000-4000-8000-0000000000c1";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

interface Fake {
  tables: Record<string, Record<string, AnyRecord>>;
  rpcError?: boolean;
  failEveryTable?: boolean;
  reads: string[];
}

function client(fake: Fake) {
  return {
    from(table: string) {
      fake.reads.push(table);
      let id = "";
      const b: AnyRecord = {
        select: () => b,
        eq: (_c: string, v: string) => {
          id = v;
          return b;
        },
        maybeSingle: () =>
          Promise.resolve(
            fake.failEveryTable
              ? { data: null, error: { message: "down" } }
              : { data: fake.tables[table]?.[id] ?? null, error: null },
          ),
      };
      return b;
    },
    rpc(fn: string, _args: AnyRecord) {
      fake.reads.push(`rpc:${fn}`);
      return Promise.resolve(
        fake.rpcError
          ? { data: null, error: { message: "name service down" } }
          : { data: "Feyikemi", error: null },
      );
    },
  };
}

const row = (category: string, payload: AnyRecord): AnyRecord => ({
  id: "outbox-adv",
  category_key: category,
  user_id: ME,
  payload,
});

Deno.test("#4255 adversarial: a failed team_chat_name lookup throws so the row retries", async () => {
  const fake: Fake = {
    tables: { team_threads: { [THREAD]: { kind: "group", title: "Lagos launch" } } },
    rpcError: true,
    reads: [],
  };
  await assertRejects(
    () =>
      resolveTeamPushText(
        client(fake),
        row("business.team_group_message", {
          thread_id: THREAD,
          message_id: MESSAGE,
          actor_user_id: ACTOR,
        }),
      ),
    Error,
    "team_lookup_failed:team_chat_name",
  );
});

Deno.test("#4255 adversarial: a deleted message never lends its words, even from its mention row", async () => {
  const fake: Fake = {
    tables: {
      team_threads: { [THREAD]: { kind: "group", title: "Lagos launch" } },
      team_messages: { [MESSAGE]: { body_md: "", deleted_at: "2026-11-11T00:00:00Z" } },
      team_mentions: {
        [MENTION]: { actor_user_id: ACTOR, body_excerpt: "the secret plan for Friday" },
      },
    },
    reads: [],
  };
  const out = await resolveTeamPushText(
    client(fake),
    row("business.team_mention", {
      source_kind: "team_message",
      reason: "mention",
      mention_id: MENTION,
      thread_id: THREAD,
      message_id: MESSAGE,
      actor_user_id: ACTOR,
    }),
  );
  assertEquals(out.team_excerpt, undefined);
  const rendered = renderTeamMessage("business.team_mention", {
    ...out,
    source_kind: "team_message",
    reason: "mention",
  });
  assert(!rendered.push.body.includes("secret"), rendered.push.body);
  assertEquals(rendered.push.title, "Feyikemi mentioned you in Lagos launch");
});

Deno.test("#4255 adversarial: a DM never names a chat title, even if the row carries one", async () => {
  const fake: Fake = {
    tables: {
      team_threads: { [DM]: { kind: "dm", title: "should never show" } },
      team_messages: { [MESSAGE]: { body_md: "Lunch?", deleted_at: null } },
    },
    reads: [],
  };
  const out = await resolveTeamPushText(
    client(fake),
    row("business.team_message", { thread_id: DM, message_id: MESSAGE, actor_user_id: ACTOR }),
  );
  assertEquals(out.team_chat, undefined);
  assertEquals(out.team_chat_kind, "dm");
  const r = renderTeamMessage("business.team_message", out);
  assertEquals(r.push.title, "Feyikemi");
  assertEquals(r.push.body, "Lunch?");
});

Deno.test("#4255 adversarial: other categories run no team lookup, so a team outage cannot stall them", async () => {
  for (
    const category of [
      "business.brand_group_message",
      "admin.team_mention",
      "buyer_reservation_confirmed",
      "business.mingla_update",
    ]
  ) {
    const fake: Fake = { tables: {}, failEveryTable: true, rpcError: true, reads: [] };
    const out = await resolveTeamPushText(
      client(fake),
      row(category, { thread_id: THREAD, message_id: MESSAGE, mention_id: MENTION, actor_user_id: ACTOR }),
    );
    assertEquals(out, {}, category);
    assertEquals(fake.reads, [], category);
  }
});

Deno.test("#4255 adversarial: markup and links are stripped; long names keep the title at 65", () => {
  const words = "**Bold** <script>alert(1)</script> see [the doc](https://evil.example/x) ![pic](https://cdn.example/p.png) `code` # head";
  const cut = teamCut(words, 120);
  assert(!cut.includes("https://"), cut);
  assert(!cut.includes("<script>"), cut);
  assert(!cut.includes("**"), cut);
  assert(cut.includes("the doc"), cut);
  const r = renderTeamMessage("business.team_group_message", {
    team_sender: "A".repeat(80),
    team_chat: "B".repeat(80),
    team_chat_kind: "group",
    team_excerpt: words,
  });
  assert(r.push.title.length <= 65, `${r.push.title.length}`);
  assert(r.push.title.endsWith("…"));
  assertEquals(r.email, { subject: "", body: "" });
  assertEquals(r.sms, "");
  const long = renderTeamMessage("business.team_message", {
    team_sender: "Ray",
    team_chat_kind: "dm",
    team_excerpt: "x".repeat(400),
  });
  assert(long.push.body.length <= 120, `${long.push.body.length}`);
});

Deno.test("#4255 adversarial: attachment wording for counts and kinds; junk counts read as none", () => {
  const body = (p: AnyRecord) =>
    renderTeamMessage("business.team_message", { team_sender: "Ada", team_chat_kind: "dm", ...p }).push.body;
  assertEquals(body({ attachment_count: 3, attachment_kind: "image" }), "Ada sent 3 photos");
  assertEquals(body({ attachment_count: 2, attachment_kind: "mixed" }), "Ada sent 2 files");
  assertEquals(body({ attachment_count: 1, attachment_kind: "document" }), "Ada sent a file");
  assertEquals(body({ attachment_count: "lots", attachment_kind: "image" }), "Open Mingla Host to read it.");
  assertEquals(body({ attachment_count: -1 }), "Open Mingla Host to read it.");
  // The templates route the four team categories to this renderer.
  const via = renderCategoryMessage("business.team_group_message", {
    team_sender: "Ada",
    team_chat: "Lagos launch",
    team_chat_kind: "group",
    attachment_count: 1,
    attachment_kind: "link",
  });
  assertEquals(via.push.title, "Ada in Lagos launch");
  assertEquals(via.push.body, "Ada sent a link");
});

Deno.test("#4255 adversarial: the provider sees ids only, never who, where or what", () => {
  for (
    const category of [
      "business.team_message",
      "business.team_group_message",
      "business.team_mention",
      "business.team_decision",
    ]
  ) {
    const safe = providerSafePayload(category, {
      thread_id: THREAD,
      message_id: MESSAGE,
      mention_id: MENTION,
      card_id: "4255a000-0000-4000-8000-0000000000d1",
      reason: "mention",
      actor_user_id: ACTOR,
      team_sender: "Ray",
      team_chat: "Lagos launch",
      team_excerpt: "words",
      team_card_number: 612,
      body: "words",
      title: "Ray",
      attachment_kind: "image",
    });
    assertEquals(Object.keys(safe).sort(), ["card_id", "mention_id", "message_id", "reason", "thread_id"], category);
  }
});
