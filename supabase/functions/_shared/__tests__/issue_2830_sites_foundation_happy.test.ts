import {
  resolveCmsToCoreVerifier,
  resolveCoreToCmsSigner,
  resolveRuntimeToCoreVerifier,
  resolveSitesAttributionPepper,
} from "../sitesSecurity.ts";
import { SITE_AGENT_READ_ONLY, SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { safeSitesRoute } from "../sitesObservability.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function material(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
}

function envelope() {
  return {
    schema_version: 1,
    core_to_cms_current_kid: "core-cms-current",
    core_to_cms_current_key_b64: material(1),
    core_to_cms_previous_kid: null,
    core_to_cms_previous_key_b64: null,
    cms_to_core_current_kid: "cms-core-current",
    cms_to_core_current_key_b64: material(2),
    cms_to_core_previous_kid: null,
    cms_to_core_previous_key_b64: null,
    runtime_to_core_current_kid: "runtime-core-current",
    runtime_to_core_current_key_b64: material(3),
    runtime_to_core_previous_kid: null,
    runtime_to_core_previous_key_b64: null,
    attribution_pepper_b64: material(4),
  };
}

Deno.test("#2830 slot-88 parser returns only narrow directional projections", () => {
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", JSON.stringify(envelope()));
  assert(resolveCoreToCmsSigner().kid === "core-cms-current", "wrong signer");
  assert(resolveCmsToCoreVerifier().length === 1, "wrong CMS verifier set");
  assert(
    resolveRuntimeToCoreVerifier().length === 1,
    "wrong runtime verifier set",
  );
  assert(
    resolveSitesAttributionPepper().byteLength === 32,
    "wrong pepper projection",
  );
});

Deno.test("#2830 slot-88 parser rejects unknown fields and duplicate material", () => {
  const unknown = { ...envelope(), extra: true };
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", JSON.stringify(unknown));
  let failed = false;
  try {
    resolveCoreToCmsSigner();
  } catch (error) {
    failed = error instanceof Error &&
      error.message === "sites_security_unavailable";
  }
  assert(failed, "unknown field did not fail closed");

  const duplicate = envelope();
  duplicate.attribution_pepper_b64 = duplicate.core_to_cms_current_key_b64;
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", JSON.stringify(duplicate));
  failed = false;
  try {
    resolveSitesAttributionPepper();
  } catch (error) {
    failed = error instanceof Error &&
      error.message === "sites_security_unavailable";
  }
  assert(failed, "duplicate material did not fail closed");
});

Deno.test("#2830 Ari registry exposes exactly the approved twelve tools", () => {
  const names = SITE_AGENT_TOOLS.map((tool) => tool.name);
  assert(
    JSON.stringify(names) === JSON.stringify([
      "get_brand_site",
      "list_site_pages",
      "get_site_page",
      "propose_site_content_update",
      "propose_site_settings_update",
      "attach_approved_site_media",
      "validate_site_draft",
      "create_site_preview",
      "publish_site",
      "get_site_operation_status",
      "list_site_versions",
      "rollback_site",
    ]),
    "Ari Website tool registry drifted",
  );
  assert(SITE_AGENT_READ_ONLY.size === 6, "Ari read-only set drifted");
  const contentTool = SITE_AGENT_TOOLS.find((tool) =>
    tool.name === "propose_site_content_update"
  );
  const contentProperties = contentTool?.parameters.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const changes = contentProperties?.changes as
    | { properties?: Record<string, unknown>; additionalProperties?: boolean }
    | undefined;
  assert(
    changes?.additionalProperties === false,
    "page changes are not closed",
  );
  assert(
    Object.keys(changes.properties || {}).sort().join(",") ===
      "blocks,enabled,nav_label,nav_order,seo,title",
    "Ari page changes do not expose the approved fields",
  );
  const settingsTool = SITE_AGENT_TOOLS.find((tool) =>
    tool.name === "propose_site_settings_update"
  );
  const settingsProperties = settingsTool?.parameters.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const settingsChanges = settingsProperties?.changes as
    | { properties?: Record<string, unknown>; additionalProperties?: boolean }
    | undefined;
  assert(
    settingsChanges?.additionalProperties === false &&
      Object.keys(settingsChanges.properties || {}).length === 10,
    "Ari settings changes are not exact and usable",
  );
});

Deno.test("#2830 slot-88 import closure stays exact and value-blind", async () => {
  const expected = new Map([
    ["brand-site-control/index.ts", ["resolveCoreToCmsSigner"]],
    ["brand-site-cms-callback/index.ts", ["resolveCmsToCoreVerifier"]],
    ["brand-site-runtime-resolve/index.ts", ["resolveRuntimeToCoreVerifier"]],
    [
      "brand-site-attribution/index.ts",
      ["resolveRuntimeToCoreVerifier", "resolveSitesAttributionPepper"],
    ],
  ]);
  const root = new URL("../../", import.meta.url);
  const allResolvers = new Set([...expected.values()].flat());
  const observed = new Map<string, string[]>();
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory || !entry.name.startsWith("brand-site-")) continue;
    const relative = `${entry.name}/index.ts`;
    const source = await Deno.readTextFile(new URL(relative, root));
    const importedResolvers = [...allResolvers].filter((resolver) =>
      source.includes(resolver)
    ).sort();
    if (importedResolvers.length > 0) observed.set(relative, importedResolvers);
    assert(
      !source.includes("MINGLA_SITES_SECURITY_JSON"),
      `${relative} read the envelope directly`,
    );
  }
  assert(
    JSON.stringify([...observed.entries()].sort()) === JSON.stringify(
      [...expected.entries()].map(([path, resolvers]) => [
        path,
        [...resolvers].sort(),
      ]).sort(),
    ),
    "slot-88 resolver import closure drifted",
  );
  const helper = await Deno.readTextFile(
    new URL("../sitesSecurity.ts", import.meta.url),
  );
  assert(
    (helper.match(/Deno\.env\.get\(ENVELOPE_NAME\)/g) || []).length === 1,
    "slot-88 environment read is not sole",
  );
  assert(!helper.includes("console."), "slot-88 helper may not log material");
});

Deno.test("#2830 observability normalizes routes without query or identifier leakage", () => {
  const request = new Request(
    "https://fixture.invalid/functions/v1/brand-site-runtime-resolve/internal/v1/hosts/00000000-0000-4000-8000-000000000001/publication?token=must-not-appear",
  );
  const route = safeSitesRoute(request, "brand-site-runtime-resolve");
  assert(
    route === "/internal/v1/hosts/{id}/publication",
    `unsafe observation route: ${route}`,
  );
  assert(!route.includes("token"), "observation route retained query data");
});

Deno.test("#2830 provisioning recovery is projected from the Core receipt", async () => {
  const source = await Deno.readTextFile(
    new URL("../../brand-site-control/index.ts", import.meta.url),
  );
  for (
    const token of [
      '.from("brand_site_operation_receipts")',
      '.eq("kind", "provision")',
      '.order("authorized_at", { ascending: false })',
      "latest_provision_operation: receipt ?? null",
    ]
  ) {
    assert(
      source.includes(token),
      `Core provisioning projection lost ${token}`,
    );
  }
});

Deno.test({
  name:
    "#3016 brand-site-control emits the shared CORS contract on real response paths",
  // Supabase Auth owns background timers even with session persistence off.
  // The test restores fetch and env state; timer lifetime is library-owned.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const [{ handleBrandSiteControl }, { corsHeaders }] = await Promise.all([
      import("../../brand-site-control/index.ts"),
      import("../cors.ts"),
    ]);
    const originalFetch = globalThis.fetch;
    const originalUrl = Deno.env.get("SUPABASE_URL");
    const originalAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const originalServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const brandId = "733bc470-45e1-4684-8896-acd7e26074ff";
    const siteId = "90f19f28-42e2-4eb9-b88b-02829bfcb045";
    const endpoint =
      "https://fixture.supabase.co/functions/v1/brand-site-control";
    const invokeBody = JSON.stringify({
      route: `/v1/brands/${brandId}/site-availability`,
      method: "GET",
    });

    const assertCors = (response: Response, label: string): void => {
      for (const [name, value] of Object.entries(corsHeaders)) {
        assert(
          response.headers.get(name) === value,
          `${label} lost ${name}`,
        );
      }
    };

    Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
    Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
    globalThis.fetch = ((input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === "/auth/v1/user") {
        if (request.headers.get("authorization") === "Bearer rejected") {
          return Promise.resolve(
            Response.json({ message: "invalid JWT" }, { status: 401 }),
          );
        }
        return Promise.resolve(Response.json({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          aud: "authenticated",
          role: "authenticated",
          email: "fixture@example.invalid",
        }));
      }
      if (
        url.pathname ===
          "/rest/v1/rpc/brand_site_business_availability"
      ) {
        return Promise.resolve(
          Response.json({ available: true, site_id: siteId }),
        );
      }
      throw new Error(`unexpected fixture request: ${url.pathname}`);
    }) as typeof fetch;

    try {
      const preflight = await handleBrandSiteControl(
        new Request(endpoint, {
          method: "OPTIONS",
          headers: {
            Origin: "https://host.usemingla.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers":
              "authorization, apikey, content-type, x-client-info",
          },
        }),
      );
      assert(preflight.status === 204, `preflight status ${preflight.status}`);
      assertCors(preflight, "preflight");

      const forbidden = await handleBrandSiteControl(
        new Request(endpoint, {
          method: "POST",
          headers: {
            Authorization: "Bearer rejected",
            "Content-Type": "application/json",
          },
          body: invokeBody,
        }),
      );
      assert(forbidden.status === 403, `forbidden status ${forbidden.status}`);
      assertCors(forbidden, "forbidden response");
      const forbiddenBody = await forbidden.json();
      assert(
        JSON.stringify(forbiddenBody) === JSON.stringify({
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "This Website action is not available for your role.",
            retryable: false,
            operation_id: null,
          },
        }),
        "forbidden customer body changed",
      );

      const available = await handleBrandSiteControl(
        new Request(endpoint, {
          method: "POST",
          headers: {
            Authorization: "Bearer accepted",
            "Content-Type": "application/json",
          },
          body: invokeBody,
        }),
      );
      assert(
        available.status === 200,
        `availability status ${available.status}`,
      );
      assertCors(available, "availability response");
      assert(
        JSON.stringify(await available.json()) === JSON.stringify({
          ok: true,
          data: { available: true, site_id: siteId },
        }),
        "availability customer body changed",
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (
        const [name, value] of [
          ["SUPABASE_URL", originalUrl],
          ["SUPABASE_ANON_KEY", originalAnonKey],
          ["SUPABASE_SERVICE_ROLE_KEY", originalServiceKey],
        ] as const
      ) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  },
});
