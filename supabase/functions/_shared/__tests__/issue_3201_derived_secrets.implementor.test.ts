/**
 * #3201 implementor proof — two controls that could not run now can.
 *
 * `BETA_LEAD_IP_SALT` and `ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET` were never
 * set in production. Without the salt the beta-signup abuse throttle was
 * skipped on every request (production: 2 leads, 0 with an `ip_hash`); without
 * the cursor secret the admin refund list threw on page two. Both now derive a
 * per-purpose secret from the service-role key when the named one is unset,
 * rather than adding secrets against the founder-approved 88-name target.
 *
 * RELATIONSHIP TO THE EXISTING HARNESS. `beta-access-lead-submit/__tests__/
 * submit_handler_sideeffects.tester.test.ts` sets SUPABASE_SERVICE_ROLE_KEY to
 * the 8-character "svc_fake" and documents "No salt by default → throttle
 * skipped". That default still holds, and deliberately: a root shorter than
 * MIN_ROOT_SECRET_LENGTH is refused for derivation, so the throttle falls back
 * to its pre-#3201 fail-open path. The test below uses a realistic key length —
 * the production case — and proves the throttle now runs there.
 */
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveScopedSecret,
  MIN_ROOT_SECRET_LENGTH,
  resolveScopedSecret,
  SCOPED_SECRET_LABELS,
} from "../derivedSecret.ts";
import { handler as betaLeadHandler } from "../../beta-access-lead-submit/index.ts";
import {
  decodeCursor,
  encodeCursor,
} from "../../admin-source-refund-operations/index.ts";

const ROOT = "svc_" + "r".repeat(80);
const rootEnv = {
  get: (n: string) => (n === "SUPABASE_SERVICE_ROLE_KEY" ? ROOT : undefined),
};

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const prior: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      prior[k] = Deno.env.get(k);
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(prior)) {
        if (v === undefined) Deno.env.delete(k);
        else Deno.env.set(k, v);
      }
    }
  };
}

Deno.test("#3201 happy: derivation is deterministic, 64 hex, and per-label", async () => {
  const a = await deriveScopedSecret(
    SCOPED_SECRET_LABELS.betaLeadIpSalt,
    rootEnv,
  );
  const b = await deriveScopedSecret(
    SCOPED_SECRET_LABELS.betaLeadIpSalt,
    rootEnv,
  );
  const c = await deriveScopedSecret(
    SCOPED_SECRET_LABELS.adminSourceRefundCursor,
    rootEnv,
  );
  assertEquals(a, b);
  assert(/^[0-9a-f]{64}$/.test(a));
  assertNotEquals(a, c, "two purposes must never share a secret");
  assert(ROOT.length >= MIN_ROOT_SECRET_LENGTH);
});

Deno.test("#3201 happy: an explicitly set secret still wins over derivation", async () => {
  assertEquals(
    await resolveScopedSecret(
      "explicit-salt",
      SCOPED_SECRET_LABELS.betaLeadIpSalt,
      rootEnv,
    ),
    "explicit-salt",
  );
});

Deno.test(
  "#3201 happy: with NO BETA_LEAD_IP_SALT and a real-length key, the beta throttle now fires",
  withEnv(
    {
      SUPABASE_URL: "https://fake.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: ROOT,
      RESEND_API_KEY: "re_fake_key",
      BETA_LEAD_IP_SALT: undefined,
    },
    async () => {
      let countCalls = 0;
      let insertCalls = 0;
      const prior = globalThis.fetch;
      globalThis.fetch =
        ((input: Request | URL | string, init?: RequestInit) => {
          const url = typeof input === "string"
            ? input
            : input instanceof URL
            ? input.href
            : input.url;
          const method =
            (init?.method ?? (input instanceof Request ? input.method : "GET"))
              .toUpperCase();
          if (url.includes("/rest/v1/beta_access_leads")) {
            if (method === "POST") {
              insertCalls += 1;
              return Promise.resolve(new Response(null, { status: 201 }));
            }
            countCalls += 1;
            // Five in-window attempts from this IP: the sixth must be refused.
            return Promise.resolve(
              new Response(null, {
                status: 200,
                headers: { "Content-Range": "0-4/5" },
              }),
            );
          }
          return Promise.resolve(
            new Response("{}", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }) as typeof fetch;
      try {
        const res = await betaLeadHandler(
          new Request("https://x/beta-access-lead-submit", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-forwarded-for": "203.0.113.7",
            },
            body: JSON.stringify({
              brandType: ["restaurant"],
              brandName: "The Corner Table",
              contactName: "Ada",
              city: "Lagos",
              email: "owner@thecornertable.com",
              consent: true,
              source: "organiser_marketing_hero",
            }),
          }),
        );
        // Before #3201 this was 200: no salt, so the throttle never counted.
        assertEquals(res.status, 429);
        assertEquals(await res.json(), { ok: false, error: "rate_limited" });
        assertEquals(countCalls, 1, "the throttle queried its window");
        assertEquals(insertCalls, 0, "a throttled lead is never written");
      } finally {
        globalThis.fetch = prior;
      }
    },
  ),
);

Deno.test(
  "#3201 happy: a page-2 refund cursor round-trips with NO cursor secret set",
  withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: ROOT,
      ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET: undefined,
    },
    async () => {
      // No override argument: this is the production path. Before #3201 the
      // encode threw `cursor_secret_unavailable` — the page-two failure.
      const cursor = await encodeCursor(
        "11111111-1111-4111-8111-111111111111",
        2,
      );
      const decoded = await decodeCursor(cursor);
      assertEquals(decoded.snapshotId, "11111111-1111-4111-8111-111111111111");
      assertEquals(decoded.nextOrdinal, 2);
    },
  ),
);
