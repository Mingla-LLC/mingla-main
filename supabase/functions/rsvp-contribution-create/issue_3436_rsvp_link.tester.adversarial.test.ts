import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type RsvpLinkRow } from "./rsvpLink.ts";

// Run the actual serve callback. Only import boundaries are substituted; the
// complete handler and production RSVP resolver execute unchanged. No credentials,
// HTTP listeners, network calls, payment execution, or production writes exist.
type Row = Record<string, unknown>;
type Harness = {
  userId: string | null;
  provider: "stripe" | "paystack";
  rsvps: RsvpLinkRow[];
  existing: Row | null;
  inserted: Row[];
  updated: Row[];
  readFailure?: "error" | "throw";
};
const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RSVP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const guest = (overrides: Partial<RsvpLinkRow> = {}): RsvpLinkRow => ({
  id: RSVP,
  event_id: EVENT,
  user_id: null,
  guest_email: "guest@example.com",
  ...overrides,
});
let active: Harness;
let handler: (request: Request) => Promise<Response>;

function client() {
  return {
    from(table: string) {
      let operation = "select";
      let payload: Row = {};
      const filters: Array<[string, string, unknown]> = [];
      const result = () => {
        if (table === "event_rsvps" && active.readFailure === "throw") {
          throw new Error("offline");
        }
        if (table === "event_rsvps" && active.readFailure === "error") {
          return { data: null, error: { message: "offline" } };
        }
        const matches = (row: Row) =>
          filters.every(([op, key, value]) => {
            if (op === "ilike") {
              return String(row[key]).toLowerCase() ===
                String(value).replace(/\\([\\%_])/g, "$1").toLowerCase();
            }
            return row[key] === value;
          });
        if (operation === "insert") {
          active.inserted.push(payload);
          return { data: null, error: null };
        }
        if (operation === "update") {
          if (active.existing && matches(active.existing)) {
            active.updated.push(payload);
            Object.assign(active.existing, payload);
          }
          return { data: null, error: null };
        }
        if (table === "events") {
          return {
            data: {
              id: EVENT,
              event_type: "rsvp",
              brand_id: "brand",
              title: "Test",
              status: "scheduled",
              visibility: "public",
              deleted_at: null,
              rsvp_contribution_enabled: true,
              brands: { slug: "brand", name: "Brand" },
            },
            error: null,
          };
        }
        if (table === "brands") {
          return {
            data: { payout_hold_cutover_at: "2026-01-01" },
            error: null,
          };
        }
        if (table === "event_rsvp_contributions") {
          return {
            data: active.existing && matches(active.existing)
              ? active.existing
              : null,
            error: null,
          };
        }
        if (table === "event_rsvps") {
          return {
            data: active.rsvps.filter((row) => matches({ ...row })),
            error: null,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      };
      const chain = {
        select(_columns: string) {
          return chain;
        },
        eq(key: string, value: unknown) {
          filters.push(["eq", key, value]);
          return chain;
        },
        is(key: string, value: unknown) {
          filters.push(["is", key, value]);
          return chain;
        },
        ilike(key: string, value: string) {
          filters.push(["ilike", key, value]);
          return chain;
        },
        limit(_count: number) {
          return Promise.resolve().then(result);
        },
        maybeSingle() {
          return Promise.resolve().then(() => {
            const response = result();
            return {
              ...response,
              data: Array.isArray(response.data)
                ? response.data[0] ?? null
                : response.data,
            };
          });
        },
        insert(row: Row) {
          operation = "insert";
          payload = row;
          return chain;
        },
        update(row: Row) {
          operation = "update";
          payload = row;
          return chain;
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (error: unknown) => unknown,
        ) {
          return Promise.resolve().then(result).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc(name: string) {
      if (name === "pg_brand_can_collect") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "resolve_event_pricing_inputs") {
        return Promise.resolve({
          data: [{
            pricing_region: "US",
            pricing_currency: active.provider === "paystack" ? "NGN" : "USD",
            effective_take_rate_bps: 100,
            take_rate_source: "platform_default",
            stripe_account_id: "acct_fake",
            payment_provider: active.provider,
            payment_country: active.provider === "paystack" ? "NG" : "US",
            paystack_subaccount_code: null,
          }],
          error: null,
        });
      }
      if (name === "issue_1930_claim_rsvp_provider_attempt") {
        return Promise.resolve({
          data: { outcome: "in_progress", epoch: 1, idempotencyKey: "test" },
          error: null,
        });
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
}

// Rework retest: additional actual-handler identity and compare-and-set cases.
for (const provider of ["stripe", "paystack"] as const) {
  Deno.test(`#3436 retest: ${provider} normalized anonymous retry remains the original guest`, async () => {
    const { response, harness } = await run({
      provider,
      existing: pending({ provider, user_id: null, guest_email: " Guest@Example.COM " }),
    }, { guestEmail: "  guest@example.com  " });
    assertEquals(response.status, 202);
    assertEquals(harness.existing?.rsvp_id, RSVP);
    assertEquals(harness.inserted.length, 0);
  });
  Deno.test(`#3436 retest: ${provider} matching email cannot convert anonymous payer to authenticated retry`, async () => {
    const { response, harness } = await run({
      provider,
      userId: USER,
      existing: pending({ provider, user_id: null, guest_email: "guest@example.com" }),
    });
    assertEquals(response.status, 409);
    assertEquals(await response.json(), { error: "contribution_retry_identity_mismatch" });
    assertEquals(harness.updated, []);
    assertEquals(harness.inserted, []);
  });
  Deno.test(`#3436 retest: ${provider} same-account retry uses original stored-email fallback`, async () => {
    const { response, harness } = await run({
      provider,
      userId: USER,
      existing: pending({ provider }),
      rsvps: [guest({ guest_email: "owner@example.com" }), guest({ id: OTHER, guest_email: "replacement@example.com" })],
    }, { guestEmail: "replacement@example.com", rsvpId: OTHER });
    assertEquals(response.status, 202);
    assertEquals(harness.existing?.rsvp_id, RSVP);
    assertEquals(harness.updated.length, 1);
  });
}

for (const changedField of ["user_id", "guest_email"] as const) {
  Deno.test(`#3436 retest: concurrent original ${changedField} change prevents stale-link CAS`, async () => {
    const previousHandler = handler;
    const raceBoundary = {
      ...boundary,
      serviceClient: () => {
        const base = client();
        return {
          ...base,
          from(table: string) {
            const query = base.from(table);
            if (table === "event_rsvp_contributions") {
              // Database reads produce a snapshot. Change the stored row after
              // that read, immediately before the real handler's update builds
              // its original-identity predicates.
              const selectOne = query.maybeSingle;
              query.maybeSingle = async () => {
                const result = await selectOne();
                return { ...result, data: result.data ? { ...result.data } : null };
              };
              const update = query.update;
              query.update = (row: Row) => {
                if (active.existing) active.existing[changedField] = changedField === "user_id" ? OTHER : "changed@example.com";
                return update(row);
              };
            }
            return query;
          },
        };
      },
    };
    Reflect.set(globalThis, marker, raceBoundary);
    try {
      await import(`data:application/typescript,${encodeURIComponent(prelude + productionBody + `\n// race-${changedField}`)}`);
      const { response, harness } = await run({ userId: USER, rsvps: [guest({ user_id: USER })], existing: pending() });
      assertEquals(response.status, 202);
      assertEquals(harness.existing?.rsvp_id, null);
      assertEquals(harness.updated, []);
      assertEquals(harness.inserted, []);
    } finally {
      handler = previousHandler;
      Reflect.deleteProperty(globalThis, marker);
    }
  });
}

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const imports = [
  ...source.matchAll(/^import\s[\s\S]*?from\s+["'][^"']+["'];/gm),
];
assert(imports.length >= 10, "actual production import boundary must be found");
const productionBody = source.replace(
  /^import\s[\s\S]*?from\s+["'][^"']+["'];/gm,
  "",
);
assert(!/^import\s/m.test(productionBody));
const boundary = {
  serve: (callback: typeof handler) => {
    handler = callback;
  },
  corsHeaders: {},
  serviceClient: client,
  userIdFromAuthHeader: () => Promise.resolve(active.userId),
  resolveProviderRouting: () => ({
    provider: active.provider,
    currency: active.provider === "paystack" ? "NGN" : "USD",
  }),
  computeBuyerSubtotal: ({ baseCents }: { baseCents: number }) => ({
    buyerSubtotalCents: baseCents,
    miglaFeeCents: 10,
  }),
  buildPricingBreakdown: (
    { amountTotalCents }: { amountTotalCents: number },
  ) => ({ buyer_total_cents: amountTotalCents }),
  MINGLA_SERVICE_FEE_BPS: 0,
};
const marker = Symbol.for("mingla.issue3436.handler.boundary");
Reflect.set(globalThis, marker, boundary);
const prelude =
  `import {resolveContributionRsvpId,supabaseRsvpLinkReader} from ${
    JSON.stringify(new URL("./rsvpLink.ts", import.meta.url).href)
  };
const {${
    Object.keys(boundary).join(",")
  }} = globalThis[Symbol.for("mingla.issue3436.handler.boundary")];`;
await import(
  `data:application/typescript,${encodeURIComponent(prelude + productionBody)}`
);
Reflect.deleteProperty(globalThis, marker);

async function run(options: Partial<Harness> = {}, request: Row = {}) {
  active = {
    userId: null,
    provider: "stripe",
    rsvps: [guest()],
    existing: null,
    inserted: [],
    updated: [],
    ...options,
  };
  const response = await handler(
    new Request("https://example.invalid/chip-in", {
      method: "POST",
      body: JSON.stringify({
        eventId: EVENT,
        guestEmail: "guest@example.com",
        amountCents: 500,
        callerIdempotencyKey: "same-key",
        surface: "web",
        ...request,
      }),
    }),
  );
  return { response, harness: active };
}

for (const provider of ["stripe", "paystack"] as const) {
  Deno.test(`#3436 tester: ${provider} real handler persists only the buyer's RSVP`, async () => {
    const { response, harness } = await run({
      provider,
      rsvps: [guest(), guest({ id: OTHER, user_id: OTHER })],
    }, { rsvpId: OTHER });
    assertEquals(response.status, 202);
    assertEquals(harness.inserted.length, 1);
    assertEquals(harness.inserted[0].rsvp_id, RSVP);
    assertEquals(harness.inserted[0].provider, provider);
  });
  Deno.test(`#3436 tester: ${provider} read errors/throws and ambiguous identities do not invent links`, async () => {
    for (
      const options of [
        { readFailure: "error" as const },
        { readFailure: "throw" as const },
        { rsvps: [guest(), guest({ id: OTHER })] },
        { rsvps: [guest({ user_id: OTHER })] },
      ]
    ) {
      const { response, harness } = await run({ provider, ...options });
      assertEquals(response.status, 202);
      assertEquals(harness.inserted[0].rsvp_id, null);
    }
  });
}

function pending(overrides: Row = {}): Row {
  return {
    id: "contribution-victim",
    event_id: EVENT,
    caller_idempotency_key: "same-key",
    status: "pending",
    provider: "stripe",
    user_id: USER,
    guest_email: "owner@example.com",
    rsvp_id: null,
    ...overrides,
  };
}
Deno.test("#3436 tester: same-owner pending retry fills a missing link, never overwrites an existing one", async () => {
  for (const stored of [null, OTHER]) {
    const { response, harness } = await run({
      userId: USER,
      rsvps: [guest({ user_id: USER })],
      existing: pending({ rsvp_id: stored }),
    });
    assertEquals(response.status, 202);
    assertEquals(harness.existing?.rsvp_id, stored ?? RSVP);
    assertEquals(harness.inserted.length, 0);
    assertEquals(harness.updated.length, stored === null ? 1 : 0);
  }
});
for (const provider of ["stripe", "paystack"] as const) {
  Deno.test(`#3436 tester: ${provider} another account's retry cannot relink the original payer`, async () => {
    const { harness } = await run({
      provider,
      userId: OTHER,
      rsvps: [guest({ user_id: OTHER })],
      existing: pending({ provider }),
    });
    assertEquals(
      harness.existing?.rsvp_id,
      null,
      "original payer USER's pending contribution must not acquire OTHER's RSVP",
    );
    assertEquals(harness.updated.length, 0);
  });
  Deno.test(`#3436 tester: ${provider} another email's anonymous retry cannot relink the original payer`, async () => {
    const { harness } = await run({
      provider,
      existing: pending({
        provider,
        user_id: null,
        guest_email: "owner@example.com",
      }),
    });
    assertEquals(
      harness.existing?.rsvp_id,
      null,
      "owner@example.com's contribution must not acquire guest@example.com's RSVP",
    );
    assertEquals(harness.updated.length, 0);
  });
}
