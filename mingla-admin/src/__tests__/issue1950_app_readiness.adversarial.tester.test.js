import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("#1950 tester: stored registry identifiers cannot prove provider-native binding or measurement", () => {
  const common = read("../supabase/functions/_shared/adAppReadinessProviders/common.ts");

  assert.doesNotMatch(
    common,
    /binding\.provider_app_id\s*\?\s*evidence\(\s*["']proven["'][\s\S]{0,240}["']provider_api["']/,
    "a stored provider_app_id is configuration, not fresh provider API proof",
  );
  assert.doesNotMatch(
    common,
    /binding\.provider_measurement_id\s*\?\s*evidence\(\s*["']proven["'][\s\S]{0,240}["']appsflyer_api["']/,
    "a stored provider_measurement_id is configuration, not fresh AppsFlyer proof",
  );
});

test("#1950 tester: AppsFlyer evidence must be externally verified and consumed by every provider result", () => {
  const appsflyer = read("../supabase/functions/_shared/adAppReadinessProviders/appsflyer.ts");
  const handler = read("../supabase/functions/admin-ad-app-readiness/handler.ts");

  assert.doesNotMatch(
    appsflyer,
    /Promise\.resolve\(evidence\(\s*["']proven["']/,
    "the AppsFlyer adapter cannot unconditionally convert a registry value into fresh proof",
  );
  assert.doesNotMatch(
    handler,
    /await\s+verifyAppsflyer\([^;]+;\s*const\s+jobs/s,
    "the once-per-target AppsFlyer result must not be discarded before provider checks",
  );
});

test("#1950 tester: unavailable corrective destinations never render an enabled dead action", () => {
  const row = read("src/components/app-readiness/ProviderReadinessRow.jsx");

  assert.match(
    row,
    /action\s*&&\s*result\.action_href\s*&&\s*<button/,
    "render provider navigation only when an allowlisted destination exists",
  );
});
