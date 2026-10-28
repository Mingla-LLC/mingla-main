/*
 * #2829 W5 (amendment A4) — the runtime asks whether a site's contact form may
 * be shown (implementor suite).
 *
 *  - a request signed for site A, naming site A, reads site A's brand's
 *    `enquiries_enabled` / `enquiries_available` (#4111's view columns):
 *    both true → available; either false → unavailable;
 *  - before #4111's columns exist (PostgREST errors) the answer is "unknown",
 *    so the site keeps the form and shows any refusal to the visitor;
 *  - a request whose envelope, path or body disagree on the site, or a
 *    host-resolution envelope, reads nothing and burns no nonce.
 */
import { SITES_HOST_RESOLUTION_SITE_ID } from "../sitesContracts.ts";
import { handleBrandSiteRuntimeResolve } from "../../brand-site-runtime-resolve/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const encoder = new TextEncoder();
const RUNTIME_KID = "runtime-core-current";
const RUNTIME_KEY_B64 = btoa("E".repeat(32));
const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";

const SECURITY_JSON = JSON.stringify({
  schema_version: 1,
  attribution_pepper_b64: btoa("P".repeat(32)),
  core_to_cms_current_kid: "core-cms-current",
  core_to_cms_current_key_b64: btoa("A".repeat(32)),
  core_to_cms_previous_kid: null,
  core_to_cms_previous_key_b64: null,
  cms_to_core_current_kid: "cms-core-current",
  cms_to_core_current_key_b64: btoa("C".repeat(32)),
  cms_to_core_previous_kid: null,
  cms_to_core_previous_key_b64: null,
  runtime_to_core_current_kid: RUNTIME_KID,
  runtime_to_core_current_key_b64: RUNTIME_KEY_B64,
  runtime_to_core_previous_kid: null,
  runtime_to_core_previous_key_b64: null,
});

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function statusRequest(input: {
  envelopeSite: string;
  pathSite: string;
  bodySite: string;
}): Promise<Request> {
  const path = `/internal/v1/sites/${input.pathSite}/enquiry-status`;
  const body = JSON.stringify({ site_id: input.bodySite });
  const issued = new Date(Date.now() - 1000);
  const unsigned = {
    schema_version: 1,
    issuer: "mingla-sites",
    audience: "mingla-core",
    direction: "runtime_to_core",
    site_id: input.envelopeSite,
    operation_id: crypto.randomUUID(),
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + 60_000).toISOString(),
    nonce: crypto.randomUUID(),
    method: "POST",
    path,
    body_sha256: await sha256Hex(body),
    kid: RUNTIME_KID,
  };
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(RUNTIME_KEY_B64), (c) => c.charCodeAt(0)).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(Object.values(unsigned).join("\n"))),
  );
  let raw = "";
  for (const byte of signature) raw += String.fromCharCode(byte);
  return new Request(
    `https://fixture.supabase.co/functions/v1/brand-site-runtime-resolve${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mingla-sites-envelope": btoa(JSON.stringify({ ...unsigned, signature_b64: btoa(raw) })),
      },
      body,
    },
  );
}

type BrandRow = { enquiries_enabled?: unknown; enquiries_available?: unknown } | "missing_columns";

function stubCore(brand: BrandRow) {
  const nonces: Array<{ site_id?: string }> = [];
  const reads: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === "/rest/v1/brand_site_gateway_nonces") {
      nonces.push(JSON.parse(await request.text()));
      return Response.json([], { status: 201 });
    }
    if (url.pathname === "/rest/v1/brand_sites") {
      reads.push(`brand_sites:${url.searchParams.get("id")}`);
      const site = url.searchParams.get("id") === `eq.${SITE_A}` ? "brand-a-id" : "brand-b-id";
      return Response.json({ brand_id: site });
    }
    if (url.pathname === "/rest/v1/business_public_brands_view") {
      reads.push(`brand:${url.searchParams.get("id")}:${url.searchParams.get("select")}`);
      if (brand === "missing_columns") {
        return Response.json(
          { code: "42703", message: "column business_public_brands_view.enquiries_enabled does not exist" },
          { status: 400 },
        );
      }
      return Response.json(brand);
    }
    throw new Error(`unexpected ${url.pathname}`);
  }) as typeof fetch;
  return { nonces, reads, restore: () => { globalThis.fetch = original; } };
}

function env() {
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", SECURITY_JSON);
  Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
}

async function statusFor(brand: BrandRow): Promise<{ status: number; answer: unknown; reads: string[]; nonces: number }> {
  env();
  const stub = stubCore(brand);
  try {
    const response = await handleBrandSiteRuntimeResolve(
      await statusRequest({ envelopeSite: SITE_A, pathSite: SITE_A, bodySite: SITE_A }),
    );
    const payload = await response.json() as { data?: { status?: unknown } };
    return { status: response.status, answer: payload.data?.status, reads: stub.reads, nonces: stub.nonces.length };
  } finally {
    stub.restore();
  }
}

Deno.test({
  name: "#2829 W5 enquiry status follows the brand's enquiry switch",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const on = await statusFor({ enquiries_enabled: true, enquiries_available: true });
    assert(on.status === 200 && on.answer === "available", `on: ${JSON.stringify(on)}`);
    assert(on.reads.includes(`brand_sites:eq.${SITE_A}`), "status did not read the site's own brand");
    assert(on.reads.some((read) => read.startsWith("brand:eq.brand-a-id:enquiries_enabled")), `wrong brand read: ${on.reads}`);
    assert(on.nonces === 1, "status request did not record its replay row");
    const off = await statusFor({ enquiries_enabled: false, enquiries_available: true });
    assert(off.answer === "unavailable", `switched off: ${JSON.stringify(off)}`);
    const noTeam = await statusFor({ enquiries_enabled: true, enquiries_available: false });
    assert(noTeam.answer === "unavailable", `nobody to read: ${JSON.stringify(noTeam)}`);
  },
});

Deno.test({
  name: "#2829 W5 enquiry status is unknown before the enquiry columns exist",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const before = await statusFor("missing_columns");
    assert(before.status === 200 && before.answer === "unknown", `pre-#4111: ${JSON.stringify(before)}`);
  },
});

Deno.test({
  name: "#2829 W5 an enquiry status request that disagrees on the site reads nothing",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    env();
    for (
      const shape of [
        { envelopeSite: SITE_A, pathSite: SITE_B, bodySite: SITE_B },
        { envelopeSite: SITE_A, pathSite: SITE_A, bodySite: SITE_B },
        { envelopeSite: SITE_B, pathSite: SITE_A, bodySite: SITE_A },
        { envelopeSite: SITES_HOST_RESOLUTION_SITE_ID, pathSite: SITE_A, bodySite: SITE_A },
      ]
    ) {
      const stub = stubCore({ enquiries_enabled: true, enquiries_available: true });
      try {
        const response = await handleBrandSiteRuntimeResolve(await statusRequest(shape));
        assert(response.status === 404, `mismatched status request answered ${response.status}: ${JSON.stringify(shape)}`);
        assert(stub.reads.length === 0, `read on a mismatched request: ${JSON.stringify(shape)}`);
        assert(stub.nonces.length === 0, "a refused status request burned a nonce row");
      } finally {
        stub.restore();
      }
    }
  },
});
