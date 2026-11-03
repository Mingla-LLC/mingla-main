// Issue #4238 P2-a — raw database text never reaches a Host.
//
// A Host read "canceling statement due to statement timeout" because
// ad-plan's databaseFailure sent the Postgres message as the detail. Now a
// response keeps only a code our own RPCs raised (`ad_plan_not_found`,
// `ad_plan_destination_not_ready:ended`); anything else becomes
// `database_operation_failed` (or the call site's neutral code) and the raw
// text is logged on the server with values redacted.
//
// MINGLA-INVARIANT: I-4238-NO-RAW-DB-TEXT-TO-HOST | issue #4238 | A Host-reachable ad edge function (ad-plan, host-ad-campaign, admin-ad-create-campaign) never puts a Postgres/PostgREST error message in a response body; only code-shaped RAISE tokens pass, through _shared/adDatabaseErrorDetail.ts.
//
// FAILS ON REVERT: restore `const detail = error?.message ?? ...` in
// databaseFailure (the timeout text reaches the body), or put any
// `detail: <dbError>.message` back in host-ad-campaign / admin-ad-create-campaign.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleAdPlan } from "../index.ts";
import { callAdPlan, FakeAdPlanDb, HOST } from "./fakeAdPlanDb.ts";
import {
  hostSafeDatabaseDetail,
  isRaisedDatabaseCode,
  NEUTRAL_DATABASE_DETAIL,
  redactDatabaseMessage,
} from "../../_shared/adDatabaseErrorDetail.ts";

const BRAND = "4238aaaa-0000-4000-8000-000000000001";
const TIMEOUT = "canceling statement due to statement timeout";

function hostDb(openError: { code: string; message: string }): FakeAdPlanDb {
  return new FakeAdPlanDb(
    { admin_users: [], ad_plans: [], brands: [] },
    {
      ad_can_host_action: () => ({ data: true }),
      ad_plan_open: () => ({ error: openError }),
    },
    { host: HOST },
  );
}

async function openPlan(db: FakeAdPlanDb) {
  return await callAdPlan(handleAdPlan, db, "host", {
    action: "open",
    client_kind: "host",
    owner_kind: "host",
    brand_id: BRAND,
    destination_family: "event",
    destination_key: "event:4238",
  });
}

function quietly<T>(run: () => Promise<T>): Promise<{ value: T; logged: string[] }> {
  const original = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  return run().then(
    (value) => {
      console.error = original;
      return { value, logged };
    },
    (error) => {
      console.error = original;
      throw error;
    },
  );
}

Deno.test("P2-a a statement timeout reaches the Host as a neutral code", async () => {
  const { value, logged } = await quietly(() =>
    openPlan(hostDb({ code: "57014", message: TIMEOUT }))
  );
  assertEquals(value.status, 502);
  assertEquals(value.body, {
    error: "plan_operation_failed",
    detail: NEUTRAL_DATABASE_DETAIL,
  });
  assertFalse(JSON.stringify(value.body).includes("statement"));
  // The raw text is kept for engineering, in the server log only.
  assert(logged.some((line) => line.includes("code=57014") && line.includes(TIMEOUT)));
});

Deno.test("P2-a a code our RPC raised still reaches the app so it can map it", async () => {
  const { value } = await quietly(() =>
    openPlan(hostDb({ code: "P0002", message: "ad_plan_not_found" }))
  );
  assertEquals(value.status, 404);
  assertEquals(value.body, { error: "plan_operation_failed", detail: "ad_plan_not_found" });
});

Deno.test("P2-a only code-shaped tokens pass", () => {
  for (const code of [
    "ad_plan_not_found",
    "audience_country_mismatch",
    "ad_plan_destination_not_ready:ended",
    "stage_creative_not_found:c0000000-0000-4000-8000-000000000001",
  ]) assert(isRaisedDatabaseCode(code), code);
  for (const raw of [
    TIMEOUT,
    'duplicate key value violates unique constraint "ad_plans_pkey"',
    'invalid input syntax for type uuid: "abc"',
    "permission denied for table ad_plans",
    "JWT expired",
    "",
  ]) assertFalse(isRaisedDatabaseCode(raw), raw);
});

Deno.test("P2-a the call site's neutral code is used when one is given", async () => {
  const { value } = await quietly(() =>
    Promise.resolve(
      hostSafeDatabaseDetail({ code: "57014", message: TIMEOUT }, "t", "provider_quote_unavailable"),
    )
  );
  assertEquals(value, "provider_quote_unavailable");
  assertEquals(hostSafeDatabaseDetail(null, "t", "destination_not_ready"), "destination_not_ready");
});

Deno.test("P2-a the server log carries no row values", () => {
  const line = redactDatabaseMessage(
    'Key (email)=(ada@example.com) already exists for "Ada Obi" at \'Lagos\' user 4238cccc-0000-4000-8000-000000000003',
  );
  assertFalse(line.includes("ada@example.com"));
  assertFalse(line.includes("Ada Obi"));
  assertFalse(line.includes("Lagos"));
  assertFalse(line.includes("4238cccc"));
});

Deno.test("P2-a no Host-reachable ad function sends a database message as a detail", async () => {
  // Any `detail: <name>.message` / `<name>?.message` in a response is the
  // leak shape; every one of these now goes through hostSafeDatabaseDetail.
  const leak = /detail:\s*[A-Za-z_.]*(?:[Ee]rror|\.error)\??\.message\b/;
  for (const file of [
    "../index.ts",
    "../../host-ad-campaign/index.ts",
    "../../admin-ad-create-campaign/index.ts",
  ]) {
    const source = await Deno.readTextFile(new URL(file, import.meta.url));
    const lines = source.split("\n");
    // The ops alert (notifyAdLaunchAttempt) is internal and keeps the text.
    const responseHits = lines.filter((line, index) =>
      leak.test(line) &&
      !lines.slice(Math.max(0, index - 4), index).some((before) =>
        before.includes("notifyAdLaunchAttempt(")
      )
    );
    assertEquals(responseHits, [], file);
    assert(source.includes("hostSafeDatabaseDetail("), file);
  }
  const adPlan = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertFalse(/detail = error\?\.message/.test(adPlan));
});
