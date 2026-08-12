import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const root = new URL("../../", import.meta.url);
const source = await Deno.readTextFile(
  new URL("admin-ad-app-identity-preflight/index.ts", root),
);

Deno.test("#1928 endpoint authenticates and authorizes before service-role registry access", () => {
  const auth = source.indexOf("userClient.auth.getUser()");
  const admin = source.indexOf("userClient.rpc(");
  assertStringIncludes(source, '"is_admin_user"');
  const service = source.indexOf(
    "const service = createClient(SUPABASE_URL, SERVICE_KEY",
  );
  assert(auth > 0 && admin > auth && service > admin);
});

Deno.test("#1928 endpoint is mutation-free and uses exact provider primitives", () => {
  assertStringIncludes(source, "metaCheckPageAdvertiseTaskForIdentity");
  assertStringIncludes(source, "metaFetchIgBusinessAccountForIdentity");
  assertStringIncludes(source, "metaValidateOnlyCreativeProbeForIdentity");
  assertStringIncludes(source, "tiktokFetchIdentities");
  assertStringIncludes(source, "selectExactTikTokIdentity");
  assert(!/\.from\([^)]*\)\.(insert|update|upsert|delete)\(/.test(source));
  assert(
    !/campaign\/create|adgroup\/create|ad\/create|upload|publish/.test(
      source.replace(/^\s*\*.*$/gm, ""),
    ),
  );
});

Deno.test("#1928 endpoint preserves strict request, no-store, and deterministic provider contracts", () => {
  assertStringIncludes(
    source,
    'const PROVIDERS: readonly AdIdentityProvider[] = ["meta", "tiktok"]',
  );
  assertStringIncludes(source, "new Set(providers).size !== providers.length");
  assertStringIncludes(
    source,
    "PROVIDERS.filter((provider) => requested.has(provider))",
  );
  assertStringIncludes(source, '"Cache-Control": "no-store"');
  assert(
    /results\.every\(\(row\) => row\.verdict === "ready"\)[\s\S]*?\? "ready"[\s\S]*?: "blocked"/
      .test(
        source,
      ),
  );
  assertEquals(
    (source.match(/return json\(\{ error: "forbidden" \}, 403\)/g) ?? [])
      .length,
    1,
  );
});
