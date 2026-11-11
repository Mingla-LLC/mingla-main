// #4255 rework 2 (P4): the drain's answer counts a Mingla team row parked for
// quiet hours as "held", never as "failed". Drives the REAL handler
// (handleNotifyOutboxDrain) through the REAL supabase-js client; only the
// network is faked. One claimed team row whose person is at 23:00 local is
// parked (retry_wait until 07:00, attempts untouched), and one broken legacy
// row really fails, so the two counts are told apart.
//
// FAILS-ON-REVERT: counting a parked row with the failures again (the
// boolean processGeneric in the loop) answers failed: 2, held: undefined.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleNotifyOutboxDrain } from "../index.ts";

const SERVICE_KEY = "issue-4255-drain-held";
const SUPABASE_URL = "http://127.0.0.1:54321";
const USER_ID = "4255aaaa-0000-4000-8000-000000000001";

/** An Etc/GMT zone whose wall clock reads 23:xx at `now` (quiet hours). */
function zoneAtElevenPm(now: Date): string {
  for (let offset = -12; offset <= 14; offset++) {
    // Etc/GMT signs are inverted: Etc/GMT-3 is UTC+3.
    const zone = offset === 0
      ? "Etc/GMT"
      : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: zone,
      }).format(now),
    ) % 24;
    if (hour === 23) return zone;
  }
  throw new Error("no zone at 23:00");
}

Deno.test("#4255 P4 the drain answers held for a quiet-hours row, failed only for a real failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = Deno.env.get("SUPABASE_URL");
  const originalKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const zone = zoneAtElevenPm(new Date());
  const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
  const dispatched: string[] = [];
  let genericClaims = 0;
  const teamRow = {
    id: "4255bbbb-0000-4000-8000-000000000001",
    category_key: "business.team_mention",
    user_id: USER_ID,
    attempts: 0,
    payload: {
      source_kind: "work_card",
      mention_id: "4255cccc-0000-4000-8000-000000000001",
    },
    idempotency_key:
      "business.team_mention:4255cccc-0000-4000-8000-000000000001",
  };
  // A legacy quiet-hours row without its stored push: a real failure.
  const brokenRow = {
    id: "4255bbbb-0000-4000-8000-000000000002",
    category_key: "legacy_quiet_hours_push",
    payload: {},
    attempts: 0,
  };
  globalThis.fetch =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method =
        (init?.method ?? (input instanceof Request ? input.method : "GET"))
          .toUpperCase();
      const ok = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url.includes("/rest/v1/rpc/claim_notification_outbox")) {
        genericClaims++;
        return ok(genericClaims === 1 ? [teamRow, brokenRow] : []);
      }
      if (
        url.includes("/rest/v1/rpc/claim_source_refund_notification_outbox")
      ) return ok([]);
      if (url.includes("/rest/v1/profiles")) return ok([{ timezone: zone }]);
      if (url.includes("/rest/v1/notification_outbox") && method === "PATCH") {
        patches.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return ok([]);
      }
      if (url.includes("/functions/v1/notify-dispatch")) {
        dispatched.push(url);
        return ok({ success: true });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  try {
    const response = await handleNotifyOutboxDrain(
      new Request("http://localhost/functions/v1/notify-outbox-drain", {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      }),
    );
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(
      { processed: body.processed, failed: body.failed, held: body.held },
      { processed: 0, failed: 1, held: 1 },
      `zone ${zone}`,
    );
    assertEquals(dispatched, [], "nothing is sent in quiet hours");
    const parked = patches.find((p) => p.url.includes(teamRow.id));
    assert(parked, "the team row is parked");
    assertEquals(parked.body.status, "retry_wait");
    assertEquals(parked.body.last_error, "quiet_hours");
    assertEquals("attempts" in parked.body, false, "attempts untouched");
    const broken = patches.find((p) => p.url.includes(brokenRow.id));
    assertEquals(broken?.body.status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", originalUrl);
    if (originalKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalKey);
  }
});
