import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { resolveConsentScopes } from "./scopes.ts";

Deno.test("#3859 omitted scopes preserve the legacy bundled grant", () => {
  assertEquals(resolveConsentScopes(undefined), ["transactional", "marketing"]);
});

Deno.test("#3859 checkout can request transactional consent without marketing", () => {
  assertEquals(resolveConsentScopes(["transactional"]), ["transactional"]);
});

Deno.test("#3859 explicit scopes are deduped into canonical order", () => {
  assertEquals(
    resolveConsentScopes(["marketing", "transactional", "marketing"]),
    ["transactional", "marketing"],
  );
});

Deno.test("#3859 malformed and empty scopes fail closed", () => {
  assertEquals(resolveConsentScopes([]), null);
  assertEquals(resolveConsentScopes(null), null);
  assertEquals(resolveConsentScopes("transactional"), null);
  assertEquals(resolveConsentScopes(["transactional", "unknown"]), null);
  assertEquals(resolveConsentScopes([true]), null);
});

Deno.test("#3859 record-consent resolves caller scopes before writing rows", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertMatch(source, /const scopes = resolveConsentScopes\(body\.scopes\);/);
  assertMatch(source, /if \(scopes === null\)[\s\S]*invalid_consent_scopes/);
  assertMatch(source, /for \(const scope of scopes\)/);
});
