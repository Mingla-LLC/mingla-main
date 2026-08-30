import {
  resolveCmsToCoreVerifier,
  resolveCoreToCmsSigner,
  resolveRuntimeToCoreVerifier,
  resolveSitesAttributionPepper,
} from "../sitesSecurity.ts";
import { SITE_AGENT_READ_ONLY, SITE_AGENT_TOOLS } from "../agentSiteTools.ts";

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
});

Deno.test("#2830 slot-88 import closure stays exact and value-blind", async () => {
  const expected = new Map([
    ["brand-site-control/index.ts", "resolveCoreToCmsSigner"],
    ["brand-site-cms-callback/index.ts", "resolveCmsToCoreVerifier"],
    ["brand-site-runtime-resolve/index.ts", "resolveRuntimeToCoreVerifier"],
    ["brand-site-attribution/index.ts", "resolveSitesAttributionPepper"],
  ]);
  const root = new URL("../../", import.meta.url);
  const observed = new Map<string, string>();
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory || !entry.name.startsWith("brand-site-")) continue;
    const relative = `${entry.name}/index.ts`;
    const source = await Deno.readTextFile(new URL(relative, root));
    for (const resolver of expected.values()) {
      if (source.includes(resolver)) observed.set(relative, resolver);
    }
    assert(
      !source.includes("MINGLA_SITES_SECURITY_JSON"),
      `${relative} read the envelope directly`,
    );
  }
  assert(
    JSON.stringify([...observed.entries()].sort()) ===
      JSON.stringify([...expected.entries()].sort()),
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
