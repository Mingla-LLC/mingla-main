// #4255 retest — tester adversarial for Mingla team quiet hours (22:00 to
// 07:00 local) in the outbox drain, and the in-app switch flag. Angles the
// implementor rework suite does not take:
//   * a row parked at 23:30 Lagos waits until exactly 07:00 Lagos, keeps its
//     attempts, and nothing is dispatched; at 07:00:00 it goes
//   * the boundary 06:59:59 is still quiet; 22:00:00 is quiet; 21:59:59 is not
//   * a person with no profile row reads as New York
//   * a failed profile read retries the row (never sends in quiet hours by
//     mistake), and a non-team row never reads profiles at all
//   * inapp:false suppresses the bell row only for team categories, and only
//     the real boolean false does it
//
// FAILS-ON-REVERT (each proved by deleting the line and re-running; see the
// #4255 retest verdict):
//   * notify-outbox-drain: the `if (until) { ... return false; }` park block
//   * teamNotifications: `if (profileError) throw` in the drain
//   * teamNotifications: `isTeamNotifyCategory(category) &&` in
//     teamInAppSuppressed

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processGeneric } from "../../notify-outbox-drain/index.ts";
import { teamInAppSuppressed, teamQuietUntil } from "../teamNotifications.ts";

const USER = "4255c000-0000-4000-8000-000000000001";
const THREAD = "4255c000-0000-4000-8000-0000000000a1";
const MESSAGE = "4255c000-0000-4000-8000-0000000000b1";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

interface World {
  profiles: Record<string, AnyRecord>;
  failProfiles?: boolean;
  reads: string[];
  updates: AnyRecord[];
  dispatched: number;
}

function admin(world: World) {
  return {
    from(table: string) {
      world.reads.push(table);
      let id = "";
      const b: AnyRecord = {
        select: () => b,
        eq: (_c: string, v: string) => {
          id = v;
          return b;
        },
        maybeSingle: () => {
          if (table === "profiles") {
            return Promise.resolve(world.failProfiles
              ? { data: null, error: { message: "down" } }
              : { data: world.profiles[id] ?? null, error: null });
          }
          if (table === "team_threads") return Promise.resolve({ data: { kind: "dm", title: null }, error: null });
          if (table === "team_messages") return Promise.resolve({ data: { body_md: "Lunch?", deleted_at: null }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        update(values: AnyRecord) {
          if (table === "notification_outbox") world.updates.push(values);
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
      return b;
    },
    rpc: (_fn: string) => Promise.resolve({ data: "Ray", error: null }),
  };
}

const row = (category = "business.team_message"): AnyRecord => ({
  id: "outbox-quiet",
  category_key: category,
  user_id: USER,
  contact: null,
  attempts: 1,
  idempotency_key: `${category}:${MESSAGE}:${USER}`,
  payload: {
    source_kind: "team_message",
    thread_id: THREAD,
    thread_kind: "dm",
    message_id: MESSAGE,
    actor_user_id: USER,
    deep_link: `mingla-business://team/${THREAD}`,
  },
});

async function drain(world: World, r: AnyRecord, now: Date): Promise<boolean> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    world.dispatched++;
    return new Response(JSON.stringify({ success: true, deliveries: [{ channel: "push", status: "sent" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    return await processGeneric(admin(world), r, "http://127.0.0.1:54321", "service-key", now);
  } finally {
    globalThis.fetch = original;
  }
}

const newWorld = (over: Partial<World> = {}): World => ({
  profiles: { [USER]: { timezone: "Africa/Lagos" } },
  reads: [],
  updates: [],
  dispatched: 0,
  ...over,
});

Deno.test("#4255 adversarial: 23:30 Lagos parks the row until exactly 07:00 Lagos, attempts kept, nothing sent", async () => {
  const world = newWorld();
  const now = new Date("2026-11-11T22:30:00Z"); // 23:30 in Lagos (UTC+1)
  assertEquals(await drain(world, row(), now), false);
  assertEquals(world.dispatched, 0);
  const park = world.updates.at(-1)!;
  assertEquals(park.status, "retry_wait");
  assertEquals(park.last_error, "quiet_hours");
  assertEquals(park.next_attempt_at, "2026-11-12T06:00:00.000Z"); // 07:00 Lagos
  assert(!("attempts" in park), "a parked row keeps its attempts");
});

Deno.test("#4255 adversarial: the edges of the window in the person's own zone", () => {
  const lagos = (utc: string) => teamQuietUntil("Africa/Lagos", new Date(utc));
  assert(lagos("2026-11-12T05:59:59Z") !== null, "06:59:59 is still quiet");
  assertEquals(lagos("2026-11-12T06:00:00Z"), null); // 07:00:00 opens
  assertEquals(lagos("2026-11-11T20:59:59Z"), null); // 21:59:59 open
  assert(lagos("2026-11-11T21:00:00Z") !== null, "22:00:00 is quiet");
});

Deno.test("#4255 adversarial: at 07:00:00 Lagos the row goes", async () => {
  const world = newWorld();
  await drain(world, row(), new Date("2026-11-12T06:00:00Z"));
  assertEquals(world.dispatched, 1);
});

Deno.test("#4255 adversarial: no profile row reads as New York", async () => {
  const world = newWorld({ profiles: {} });
  // 09:00 Lagos is 03:00 New York: quiet for a person with no zone.
  assertEquals(await drain(world, row(), new Date("2026-11-12T08:00:00Z")), false);
  assertEquals(world.dispatched, 0);
  assertEquals(world.updates.at(-1)!.next_attempt_at, "2026-11-12T12:00:00.000Z"); // 07:00 New York
});

Deno.test("#4255 adversarial: a failed profile read retries the row; a non-team row never reads profiles", async () => {
  const failing = newWorld({ failProfiles: true });
  assertEquals(await drain(failing, row(), new Date("2026-11-11T22:30:00Z")), false);
  assertEquals(failing.dispatched, 0);
  assertEquals(failing.updates.at(-1)!.status, "retry_wait");
  assertEquals(failing.updates.at(-1)!.attempts, 2);
  const other = newWorld();
  await drain(other, { ...row("buyer_order_confirmed"), payload: {} }, new Date("2026-11-11T22:30:00Z"));
  assert(!other.reads.includes("profiles"), "only team rows read the zone");
});

Deno.test("#4255 adversarial: inapp false suppresses the bell only for team categories, only as a real false", () => {
  assertEquals(teamInAppSuppressed("business.team_decision", { inapp: false }), true);
  assertEquals(teamInAppSuppressed("business.team_due", { inapp: false }), true);
  assertEquals(teamInAppSuppressed("business.team_decision", { inapp: "false" }), false);
  assertEquals(teamInAppSuppressed("business.team_decision", { inapp: true }), false);
  assertEquals(teamInAppSuppressed("business.team_decision", {}), false);
  assertEquals(teamInAppSuppressed("business.brand_group_message", { inapp: false }), false);
  assertEquals(teamInAppSuppressed("admin.team_mention", { inapp: false }), false);
});
