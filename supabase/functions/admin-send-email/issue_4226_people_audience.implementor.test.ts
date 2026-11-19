/**
 * #4226 Phase 2 — Email reads the People filter. A "people" audience (an
 * Activation play, a built group, or "Email these people" from People) is
 * read through admin_people_filter, the same function the People page counts
 * with, so the estimate's matched count equals the People count. The legacy
 * segment builder's country filter now matches in any case.
 */
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("SUPABASE_URL", "https://issue4226.supabase.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key-4226");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-4226");
Deno.env.set("RESEND_API_KEY", "re_test_issue_4226");
Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", "issue-4226-unsubscribe-secret-long-enough-for-tests");

const { loadDirectoryRows } = await import("./index.ts");
const { normalizeAudience, normalizePeopleFilter, PEOPLE_FILTER_KEYS, snapshotAudience } = await import("./model.ts");
const { applyDirectoryFilters, directoryRowToRecipient, requiresMarketingConsent } = await import("./audience.ts");

type Call = { fn: string; args?: Record<string, unknown>; ops: Array<[string, unknown[]]> };

/** A fake service client recording which RPC each page read and its filters. */
function fakeClient(rows: Record<string, unknown>[], calls: Call[]) {
  return {
    rpc(fn: string, args?: Record<string, unknown>) {
      const call: Call = { fn, args, ops: [] };
      calls.push(call);
      let from = 0;
      let to = rows.length - 1;
      const builder = {
        select(...a: unknown[]) {
          call.ops.push(["select", a]);
          return builder;
        },
        order(...a: unknown[]) {
          call.ops.push(["order", a]);
          return builder;
        },
        range(a: number, b: number) {
          from = a;
          to = b;
          call.ops.push(["range", [a, b]]);
          return builder;
        },
        in(...a: unknown[]) {
          call.ops.push(["in", a]);
          return builder;
        },
        eq(...a: unknown[]) {
          call.ops.push(["eq", a]);
          return builder;
        },
        ilike(...a: unknown[]) {
          call.ops.push(["ilike", a]);
          return builder;
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

const ROWS = [
  { person_key: "u:1", user_id: "00000000-0000-4000-8000-000000000001", email: "host1@mingla-fixture.org", app_status: "host", is_internal: false, marketing_consent: "no" },
  { person_key: "u:2", user_id: "00000000-0000-4000-8000-000000000002", email: "host2@mingla-fixture.org", app_status: "both", is_internal: false, marketing_consent: "yes" },
  { person_key: "e:buyer@mingla-fixture.org", user_id: null, email: "buyer@mingla-fixture.org", app_status: "ticket_buyer_no_app", is_internal: false, marketing_consent: "no" },
];

Deno.test("P-01 a people audience normalises to the shared filter keys only", () => {
  const audience = normalizeAudience({
    mode: "people",
    people: { track: "hosts", host_next_step: "connect_bank", country: "ng", city: "all", source: "" },
  });
  assertEquals(audience, { mode: "people", people: { track: "hosts", host_next_step: "connect_bank", country: "ng" } });
  assertEquals(normalizeAudience({ mode: "people" }), { mode: "people", people: {} });
  assertThrows(() => normalizePeopleFilter({ colour: "red" }), Error, "audience_filter_invalid:colour");
  assertThrows(() => normalizePeopleFilter({ track: { nested: true } }), Error, "audience_filter_invalid:track");
  assertThrows(() => normalizePeopleFilter(["track"]), Error, "audience_filter_invalid:people");
  assertThrows(() => normalizePeopleFilter({ search: "x".repeat(201) }), Error, "audience_filter_invalid:search");
});

Deno.test("P-02 the JS key list mirrors admin_people_filter_check", async () => {
  const sql = await Deno.readTextFile(
    new URL("../../migrations/20281118024226_issue_4226_people_journey.sql", import.meta.url),
  );
  const list = sql.match(/ELSIF v_key NOT IN \(([^)]*)\)/);
  assert(list, "admin_people_filter_check lists its keys");
  const keys = [...list[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assertEquals([...PEOPLE_FILTER_KEYS].sort(), keys);
});

Deno.test("P-03 a people audience reads admin_people_filter with the filter, never the legacy filters", async () => {
  const calls: Call[] = [];
  const audience = normalizeAudience({ mode: "people", people: { track: "hosts", host_next_step: "connect_bank" } });
  // deno-lint-ignore no-explicit-any
  const rows = await loadDirectoryRows(fakeClient(ROWS, calls) as any, audience);
  assertEquals(rows.length, 3);
  assertEquals(calls[0].fn, "admin_people_filter");
  assertEquals(calls[0].args, { p_filters: { track: "hosts", host_next_step: "connect_bank" } });
  assert(!calls[0].ops.some(([op]) => op === "in" || op === "eq" || op === "ilike"), "no second filter on top");
});

Deno.test("P-04 the estimate counts every filtered row as matched (People = Email), then applies the send rules", () => {
  const audience = normalizeAudience({ mode: "people", people: { track: "hosts" } });
  const recipients = ROWS.map((row) => directoryRowToRecipient(row));
  const snapshot = snapshotAudience(recipients, new Set(), {
    excludeInternal: true,
    requireConsent: (profile) => requiresMarketingConsent(audience, profile),
  });
  assertEquals(snapshot.matched, ROWS.length);
  // The no-account buyer said no to marketing: left out, counted by reason.
  assertEquals(snapshot.noConsent, 1);
  assertEquals(snapshot.willReceive, 2);
});

Deno.test("P-05 the legacy segment builder's country filter matches in any case", () => {
  const calls: Call[] = [];
  const client = fakeClient(ROWS, calls);
  applyDirectoryFilters(client.rpc("admin_people_directory"), {
    mode: "segment",
    filters: { userType: "all", appStatus: "all", country: "NG" },
  });
  assertEquals(calls[0].ops.find(([op]) => op === "ilike"), ["ilike", ["country", "NG"]]);
  assert(!calls[0].ops.some(([op, a]) => op === "eq" && (a as unknown[])[0] === "country"), "no exact-case match");
  // Not a plain code: falls back to an exact match (no wildcards).
  const calls2: Call[] = [];
  applyDirectoryFilters(fakeClient(ROWS, calls2).rpc("admin_people_directory"), {
    mode: "segment",
    filters: { userType: "all", country: "N%" },
  });
  assertEquals(calls2[0].ops.find(([op, a]) => op === "eq" && (a as unknown[])[0] === "country"), ["eq", ["country", "N%"]]);
  assert(!calls2[0].ops.some(([op]) => op === "ilike"), "a value with wildcards is never an ILIKE");
});
