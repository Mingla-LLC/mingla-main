/**
 * #3200 / #3201 tester adversarial — attacks the fixes from angles the
 * implementor suites do not: credentials that must NOT be accepted, derivation
 * inputs that must be REFUSED, secrets that must not LEAK, and the fail-open
 * path proven to be LOUD rather than silent. A renamed copy of the happy path
 * would prove nothing; every case here is a different failure surface.
 */
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAuthorizedCronCaller } from "../cronCallerAuth.ts";
import { calculateCronJitterMs } from "../stripeKycReminderSchedule.ts";
import {
  deriveScopedSecret,
  MIN_ROOT_SECRET_LENGTH,
  resolveScopedSecret,
  SCOPED_SECRET_LABELS,
} from "../derivedSecret.ts";
import {
  decodeCursor,
  encodeCursor,
} from "../../admin-source-refund-operations/index.ts";
import { handler as betaLeadHandler } from "../../beta-access-lead-submit/index.ts";

const SERVICE_KEY = "svc_" + "k".repeat(60);
const env = (vars: Record<string, string>) => ({ get: (n: string) => vars[n] });
const onlyService = env({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });

// ── cron caller: what must be REFUSED ─────────────────────────────────────────

Deno.test("#3200 adversarial: an unset CRON_SECRET matches nothing — not even an empty bearer", async () => {
  // The old guard's failure was "unset secret refuses everyone". The mirror bug
  // — "unset secret admits everyone" — is worse, and is what a naive
  // `bearer === (env.get('CRON_SECRET') ?? '')` would ship.
  for (
    const header of ["Bearer ", "Bearer", "", "Bearer undefined", "Bearer null"]
  ) {
    assertEquals(
      await isAuthorizedCronCaller(header, onlyService),
      false,
      `header ${JSON.stringify(header)} must be refused`,
    );
  }
  assertEquals(await isAuthorizedCronCaller(null, onlyService), false);
  assertEquals(await isAuthorizedCronCaller(undefined, onlyService), false);
});

Deno.test("#3200 adversarial: with NO credentials configured at all, nobody gets in", async () => {
  assertEquals(
    await isAuthorizedCronCaller(`Bearer ${SERVICE_KEY}`, env({})),
    false,
  );
});

Deno.test("#3200 adversarial: a near-miss service key is refused", async () => {
  for (
    const wrong of [
      SERVICE_KEY.slice(0, -1),
      SERVICE_KEY + "x",
      SERVICE_KEY.toUpperCase(),
    ]
  ) {
    assertEquals(
      await isAuthorizedCronCaller(`Bearer ${wrong}`, onlyService),
      false,
    );
  }
});

Deno.test("#3200 adversarial: the anon key shape is not a cron credential", async () => {
  // A public, client-held key must never satisfy a service-only endpoint.
  const anon = "eyJhbGciOiJIUzI1NiJ9.anon." + "a".repeat(40);
  assertEquals(
    await isAuthorizedCronCaller(`Bearer ${anon}`, onlyService),
    false,
  );
});

Deno.test("#3200 adversarial: bearer prefix is case-insensitive and whitespace-tolerant, value is not", async () => {
  assert(await isAuthorizedCronCaller(`bearer ${SERVICE_KEY}`, onlyService));
  assert(
    await isAuthorizedCronCaller(`Bearer    ${SERVICE_KEY}  `, onlyService),
  );
  assertEquals(
    await isAuthorizedCronCaller(`Bearer ${SERVICE_KEY} extra`, onlyService),
    false,
  );
});

Deno.test("#3200 adversarial: DISABLE_CRON_JITTER still zeroes the sleep", () => {
  const prior = Deno.env.get("DISABLE_CRON_JITTER");
  Deno.env.set("DISABLE_CRON_JITTER", "true");
  try {
    for (let i = 0; i < 200; i += 1) assertEquals(calculateCronJitterMs(), 0);
  } finally {
    if (prior === undefined) Deno.env.delete("DISABLE_CRON_JITTER");
    else Deno.env.set("DISABLE_CRON_JITTER", prior);
  }
});

// ── derivation: what must be REFUSED, and what must not LEAK ─────────────────

Deno.test("#3201 adversarial: a root too short to be a safe key is refused, not stretched", async () => {
  const short = "x".repeat(MIN_ROOT_SECRET_LENGTH - 1);
  await assertRejects(
    () => deriveScopedSecret("any", env({ SUPABASE_SERVICE_ROLE_KEY: short })),
    Error,
    "scoped_secret_root_unavailable",
  );
  await assertRejects(
    () => deriveScopedSecret("any", env({})),
    Error,
    "scoped_secret_root_unavailable",
  );
});

Deno.test("#3201 adversarial: an empty label is refused rather than colliding across purposes", async () => {
  await assertRejects(
    () => deriveScopedSecret("", onlyService),
    Error,
    "scoped_secret_label_required",
  );
});

Deno.test("#3201 adversarial: a whitespace-only explicit value is treated as unset, not as the secret", async () => {
  const derived = await deriveScopedSecret(
    SCOPED_SECRET_LABELS.betaLeadIpSalt,
    onlyService,
  );
  assertEquals(
    await resolveScopedSecret(
      "   ",
      SCOPED_SECRET_LABELS.betaLeadIpSalt,
      onlyService,
    ),
    derived,
  );
});

Deno.test("#3201 adversarial: the derived secret never exposes the service-role key", async () => {
  for (const label of Object.values(SCOPED_SECRET_LABELS)) {
    const derived = await deriveScopedSecret(label, onlyService);
    assert(
      !derived.includes(SERVICE_KEY),
      "root must not appear in the output",
    );
    assert(
      !SERVICE_KEY.includes(derived),
      "output must not be a slice of the root",
    );
    assertEquals(derived.length, 64);
  }
});

Deno.test("#3201 adversarial: a tampered cursor is rejected under the derived secret", async () => {
  const prior = {
    k: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    c: Deno.env.get("ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET"),
  };
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  Deno.env.delete("ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET");
  try {
    const cursor = await encodeCursor(
      "22222222-2222-4222-8222-222222222222",
      2,
    );
    const [payload, sig] = cursor.split(".");
    // Forge ordinal 999 with the old signature: must not decode.
    const forged = btoa(
      JSON.stringify({
        v: 1,
        snapshotId: "22222222-2222-4222-8222-222222222222",
        nextOrdinal: 999,
      }),
    ).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    await assertRejects(
      () => decodeCursor(`${forged}.${sig}`),
      Error,
      "invalid_cursor",
    );
    // And a signature from a different root must not verify either.
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY + "-rotated");
    await assertRejects(
      () => decodeCursor(`${payload}.${sig}`),
      Error,
      "invalid_cursor",
    );
  } finally {
    if (prior.k === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prior.k);
    if (prior.c === undefined) {
      Deno.env.delete("ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET");
    } else Deno.env.set("ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET", prior.c);
  }
});

Deno.test("#3201 adversarial: a weak EXPLICIT cursor secret is still refused, not silently replaced", async () => {
  // Derivation fills an absence; it must not paper over a misconfiguration.
  await assertRejects(
    () => encodeCursor("33333333-3333-4333-8333-333333333333", 2, "too-short"),
    Error,
    "cursor_secret_unavailable",
  );
});

Deno.test("#3201 adversarial: when the throttle cannot key itself it fails open LOUDLY, never silently", async () => {
  // The whole defect was a control that did nothing and said nothing. With an
  // unusable root the throttle still skips (a legit lead must not be blocked),
  // but it must say so.
  const priorEnv = {
    u: Deno.env.get("SUPABASE_URL"),
    k: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    r: Deno.env.get("RESEND_API_KEY"),
    s: Deno.env.get("BETA_LEAD_IP_SALT"),
  };
  Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc_fake"); // too short to derive from
  Deno.env.set("RESEND_API_KEY", "re_fake_key");
  Deno.env.delete("BETA_LEAD_IP_SALT");
  const errors: string[] = [];
  const priorError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  let countCalls = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const method =
      (init?.method ?? (input instanceof Request ? input.method : "GET"))
        .toUpperCase();
    if (url.includes("/rest/v1/beta_access_leads") && method !== "POST") {
      countCalls += 1;
    }
    if (url.includes("/rest/v1/beta_access_leads") && method === "POST") {
      return Promise.resolve(new Response(null, { status: 201 }));
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
          "x-forwarded-for": "203.0.113.9",
        },
        body: JSON.stringify({
          brandType: ["restaurant"],
          brandName: "Loud Failure Cafe",
          contactName: "Bo",
          city: "London",
          email: "bo@loudfailure.example",
          consent: true,
          source: "organiser_marketing_hero",
        }),
      }),
    );
    assertEquals(
      res.status,
      200,
      "a legit lead is not blocked by a keying failure",
    );
    assertEquals(countCalls, 0, "no key, so no throttle query");
    assert(
      errors.some((line) => line.includes("throttle salt unavailable")),
      "the skipped throttle must be reported, not silent",
    );
  } finally {
    globalThis.fetch = priorFetch;
    console.error = priorError;
    for (
      const [k, name] of [
        ["u", "SUPABASE_URL"],
        ["k", "SUPABASE_SERVICE_ROLE_KEY"],
        ["r", "RESEND_API_KEY"],
        ["s", "BETA_LEAD_IP_SALT"],
      ] as const
    ) {
      const v = priorEnv[k];
      if (v === undefined) Deno.env.delete(name);
      else Deno.env.set(name, v);
    }
  }
});
