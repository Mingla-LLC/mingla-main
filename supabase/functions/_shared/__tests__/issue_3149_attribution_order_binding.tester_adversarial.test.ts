/*
 * #3149 — INDEPENDENT TESTER PASS: which ORDER does a spent touch land on?
 *
 * #2830 shipped `brand_site_consume_attribution` with no caller. #3149 gave it
 * one, in `brand-site-attribution`, so an order placed from a brand's website
 * finally earns that website credit. Neither change has a tester sign-off.
 *
 * The implementor suite for #3149 proves the touch is found and scoped to the
 * site the envelope was signed for. It never asks the other half of the
 * question: the order. A touch binding has TWO ends, and only one of them is
 * checked anywhere.
 *
 * The sibling that shipped with #2830 — the trigger on the ticket rail — does
 * check both: it will only bind a touch whose `brand_id` equals the checkout's
 * `brand_id`. The tests below hold the two paths to the SAME standard, because
 * they write to the same column, and that is the angle the happy-path suite
 * does not cover.
 *
 * `brand_site_attribution_touches.order_id` has no foreign key and a UNIQUE
 * partial index, so an order id that is wrong is not merely noise: it takes the
 * one binding slot that order will ever have, and the trigger that would have
 * claimed it legitimately swallows the resulting conflict without a word.
 *
 * Run: deno test --allow-env --allow-read --allow-net=deno.land,esm.sh <file>
 *
 * NOT WIRED INTO CI for the same reason the #3149 implementor suite is not:
 * every Deno lane enumerates its files by name and adding one drifts the frozen
 * PR-family digest the #2851 gate holds. Naming the lane, never the file.
 */
import { handleBrandSiteAttribution } from "../../brand-site-attribution/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
/** An order that belongs to a different brand entirely. */
const FOREIGN_ORDER = "dddddddd-4444-4444-8444-444444444444";
const TOKEN = "T".repeat(43);
const KID = "runtime-core-current";
const KEY_B64 = btoa("E".repeat(32));
const PEPPER_B64 = btoa("P".repeat(32));

const SECURITY_JSON = JSON.stringify({
  schema_version: 1,
  attribution_pepper_b64: PEPPER_B64,
  core_to_cms_current_kid: "core-cms-current",
  core_to_cms_current_key_b64: btoa("A".repeat(32)),
  core_to_cms_previous_kid: null,
  core_to_cms_previous_key_b64: null,
  cms_to_core_current_kid: "cms-core-current",
  cms_to_core_current_key_b64: btoa("B".repeat(32)),
  cms_to_core_previous_kid: null,
  cms_to_core_previous_key_b64: null,
  runtime_to_core_current_kid: KID,
  runtime_to_core_current_key_b64: KEY_B64,
  runtime_to_core_previous_kid: null,
  runtime_to_core_previous_key_b64: null,
});

const encoder = new TextEncoder();

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A correctly signed runtime request. Nothing here is forged. */
async function signedRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<Request> {
  const serialized = JSON.stringify(body);
  const issued = new Date(Date.now() - 1_000);
  const unsigned = {
    schema_version: 1,
    issuer: "mingla-sites-runtime",
    audience: "mingla-core",
    direction: "runtime_to_core",
    site_id: SITE_A,
    operation_id: crypto.randomUUID(),
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + 60_000).toISOString(),
    nonce: crypto.randomUUID(),
    method: "POST",
    path,
    body_sha256: await sha256Hex(serialized),
    kid: KID,
  };
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes(KEY_B64)).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(Object.values(unsigned).join("\n")),
    ),
  );
  let raw = "";
  for (const byte of signature) raw += String.fromCharCode(byte);
  return new Request(
    `https://fixture.supabase.co/functions/v1/brand-site-attribution${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mingla-sites-envelope": btoa(
          JSON.stringify({ ...unsigned, signature_b64: btoa(raw) }),
        ),
      },
      body: serialized,
    },
  );
}

type Seen = { path: string; search: string; body: unknown };

function installStubs(
  touch: unknown,
): { seen: Seen[]; restore: () => void } {
  const seen: Seen[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const incoming = input instanceof Request
      ? input
      : new Request(String(input), init);
    const url = new URL(incoming.url);
    const text = incoming.method === "GET" ? "" : await incoming.text();
    seen.push({
      path: url.pathname,
      search: url.search,
      body: text ? JSON.parse(text) : null,
    });
    if (url.pathname === "/rest/v1/brand_site_gateway_nonces") {
      return Response.json([], { status: 201 });
    }
    if (url.pathname === "/rest/v1/brand_site_attribution_touches") {
      return new Response(
        touch === null ? "null" : JSON.stringify(touch),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/rest/v1/rpc/brand_site_consume_attribution") {
      return Response.json({ accepted: true });
    }
    throw new Error(`unexpected dependency ${url.pathname}`);
  }) as typeof fetch;
  return {
    seen,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function withEnvironment<T>(run: () => Promise<T>): Promise<T> {
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", SECURITY_JSON);
  Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
  return run();
}

const CONSUME_PATH = `/internal/v1/sites/${SITE_A}/attribution/consume`;

const MIGRATION = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270609002830_issue_2830_mingla_sites_foundation.sql",
    import.meta.url,
  ),
);

/** The body of one SQL routine, from its CREATE to the terminating `$$;`. */
function routine(name: string): string {
  const start = MIGRATION.indexOf(`FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`routine ${name} not found in the migration`);
  const end = MIGRATION.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`routine ${name} has no terminator`);
  return MIGRATION.slice(start, end);
}

/* ------------------------------------------------------------------ *
 * The gap: one binding path checks the brand, its sibling does not.
 * ------------------------------------------------------------------ */

Deno.test("#3149 both attribution binding paths check the brand of the order they bind", () => {
  const trigger = routine("brand_site_bind_checkout_attribution");
  const rpc = routine("brand_site_consume_attribution");

  /*
   * The ticket-rail trigger is the reference implementation. If this assertion
   * ever fails it means the reference lost its guard, and the comparison below
   * would then pass for the wrong reason.
   */
  assert(
    /touch\.brand_id\s*=\s*NEW\.brand_id/.test(trigger),
    "the ticket-rail trigger no longer binds a touch to the checkout's brand; the reference for this invariant is gone",
  );
  assert(
    /order_id\s*=\s*NEW\.order_id/.test(trigger),
    "the ticket-rail trigger no longer writes order_id; the fixture is stale",
  );

  /*
   * The venue-order RPC writes the SAME column from a caller-supplied order id.
   * It must reach the order's brand and compare it with the touch's, exactly as
   * its sibling does.
   */
  assert(
    /p_order_id/.test(rpc),
    "the RPC no longer takes an order id; the fixture is stale",
  );
  /*
   * The guard has to READ the order to learn its brand — there is no other way
   * to compare it with the touch's. So the falsifiable question is whether the
   * routine reads an orders table at all. Matching on the words "brand_id"
   * alone would pass on the audit-log insert at the bottom of this very
   * routine, which is the sort of assertion that reports a guard that is not
   * there.
   */
  assert(
    /FROM\s+public\.\w*orders?\b/i.test(rpc),
    "brand_site_consume_attribution binds a caller-supplied order id to a touch without ever reading that order, so it cannot compare the order's brand with the touch's. Its sibling brand_site_bind_checkout_attribution does compare them, and both write the same column, which carries a UNIQUE partial index and no foreign key.",
  );
});

Deno.test({
  name: "#3149 a signed runtime cannot spend its touch on another brand's order",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const stubs = installStubs({ id: "touch-1" });
      try {
        const response = await handleBrandSiteAttribution(
          await signedRequest(CONSUME_PATH, {
            action: "consume",
            site_id: SITE_A,
            token: TOKEN,
            order_id: FOREIGN_ORDER,
          }),
        );
        const consumeCall = stubs.seen.find((call) =>
          call.path === "/rest/v1/rpc/brand_site_consume_attribution"
        );
        const payload = await response.json() as {
          data?: { accepted?: boolean };
        };
        assert(
          consumeCall === undefined ||
            (consumeCall.body as { p_order_id?: string }).p_order_id !==
              FOREIGN_ORDER,
          `Core accepted an order id it never checked: the consume RPC was called with p_order_id=${FOREIGN_ORDER}, an order this site did not produce. Nothing between the runtime and the row compares that order's brand with the touch's brand, and the column it lands in is UNIQUE, so a wrong order id also denies the real one its only binding slot.`,
        );
        assert(
          payload.data?.accepted !== true,
          "a touch spent on an order the site did not produce must not be reported accepted",
        );
      } finally {
        stubs.restore();
      }
    }),
});

/* ------------------------------------------------------------------ *
 * What holds. These are the guards the site half genuinely has, kept
 * here so a regression in them is visible beside the gap above.
 * ------------------------------------------------------------------ */

Deno.test({
  name: "#3149 a touch belonging to another site is never spent",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      // PostgREST answers "no such row" because the touch is not this site's.
      const stubs = installStubs(null);
      try {
        const response = await handleBrandSiteAttribution(
          await signedRequest(CONSUME_PATH, {
            action: "consume",
            site_id: SITE_A,
            token: TOKEN,
            order_id: FOREIGN_ORDER,
          }),
        );
        const payload = await response.json() as {
          data?: { accepted?: boolean };
        };
        assert(
          payload.data?.accepted === false,
          "an unknown touch must answer accepted:false rather than failing the order",
        );
        assert(
          !stubs.seen.some((call) =>
            call.path.includes("brand_site_consume_attribution")
          ),
          "the consume RPC must never run for a touch this site does not own",
        );
        const lookup = stubs.seen.find((call) =>
          call.path === "/rest/v1/brand_site_attribution_touches"
        );
        assert(
          lookup !== undefined && lookup.search.includes(SITE_A),
          "the touch lookup must be scoped to the site the envelope was signed for",
        );
      } finally {
        stubs.restore();
      }
    }),
});

Deno.test({
  name: "#3149 a consume request carrying an extra field is refused outright",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const stubs = installStubs({ id: "touch-1" });
      try {
        const response = await handleBrandSiteAttribution(
          await signedRequest(CONSUME_PATH, {
            action: "consume",
            site_id: SITE_A,
            token: TOKEN,
            order_id: FOREIGN_ORDER,
            // A field the consume contract does not name.
            brand_id: "eeeeeeee-5555-4555-8555-555555555555",
          }),
        );
        assert(
          response.status === 400,
          `an unknown field on a consume body must be refused, got ${response.status}`,
        );
        assert(
          !stubs.seen.some((call) => call.path.includes("rpc/")),
          "no RPC may run for a body the contract does not accept",
        );
      } finally {
        stubs.restore();
      }
    }),
});

Deno.test({
  name: "#3149 a token that is not the minted shape never reaches the database",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const stubs = installStubs({ id: "touch-1" });
      try {
        for (
          const badToken of [
            "T".repeat(42),
            "T".repeat(44),
            `${"T".repeat(42)}=`,
            `${"T".repeat(42)}/`,
            "",
          ]
        ) {
          const response = await handleBrandSiteAttribution(
            await signedRequest(CONSUME_PATH, {
              action: "consume",
              site_id: SITE_A,
              token: badToken,
              order_id: FOREIGN_ORDER,
            }),
          );
          assert(
            response.status === 400,
            `a token of shape ${JSON.stringify(badToken)} must be refused, got ${response.status}`,
          );
        }
        assert(
          !stubs.seen.some((call) =>
            call.path.includes("brand_site_attribution_touches")
          ),
          "a malformed token must never be turned into a digest and looked up",
        );
      } finally {
        stubs.restore();
      }
    }),
});
