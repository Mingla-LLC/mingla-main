import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateReadinessResponse } from "../lib/adAppReadiness.js";
import { response } from "./fixtures/issue1950Readiness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const featureFlagSource = read("src/lib/featureFlags.js");
const pageSource = read("src/pages/AdEnginePage.jsx");
const boundaryCopy = "App-download readiness is being connected. No campaigns can be created here.";

async function loadFlagsWith(resultOrRpc) {
  globalThis.__issue1950FlagRpc = typeof resultOrRpc === "function"
    ? resultOrRpc
    : async () => resultOrRpc;
  const executable = featureFlagSource.replace(
    /import \{ supabase \} from '\.\/supabase';/,
    "const supabase = { rpc: globalThis.__issue1950FlagRpc };",
  );
  return import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}#${crypto.randomUUID()}`);
}

function currentFixture() {
  const fixture = structuredClone(response);
  const serverNow = new Date().toISOString();
  fixture.server_now = serverNow;
  for (const target of fixture.targets) {
    target.latest.checked_at = serverNow;
    target.latest.stale_at = new Date(Date.parse(serverNow) + 15 * 60 * 1000).toISOString();
    for (const result of target.latest.results) {
      for (const item of Object.values(result.evidence)) item.source_checked_at = serverNow;
    }
  }
  return fixture;
}

function createEphemeralInterceptor(flagResult) {
  const calls = [];
  const fixture = currentFixture();
  return {
    calls,
    async request(route, body) {
      calls.push({ route, body });
      if (route === "admin_get_feature_flags") return flagResult;
      if (route === "admin-ad-app-readiness") {
        assert.ok(["load", "check"].includes(body?.action));
        return { data: fixture, error: null };
      }
      if (route === "admin-ad-app-readiness-event") {
        assert.equal(typeof body?.event_name, "string");
        return { data: { accepted: true }, error: null };
      }
      throw new Error(`unlisted_request:${route}`);
    },
  };
}

test("#1950 feature gate fails closed for false, missing, malformed, and RPC failure", async () => {
  const cases = [
    { data: { enable_app_download_readiness: false }, error: null },
    { data: {}, error: null },
    { data: { enable_app_download_readiness: "true" }, error: null },
    { data: null, error: new Error("admin unavailable") },
  ];
  for (const result of cases) {
    const flags = await loadFlagsWith(result);
    assert.equal(await flags.isFlagEnabled("enable_app_download_readiness"), false);
  }
  assert.match(
    pageSource,
    /const \[appDownloadReadinessEnabled, setAppDownloadReadinessEnabled\] = useState\(false\);/,
  );
  assert.ok(pageSource.includes(boundaryCopy));
});

test("#1950 page gates the mount instead of hiding the panel and preserves traffic campaigns", () => {
  assert.match(
    pageSource,
    /appDownloadReadinessEnabled \? \(\s*<AppDownloadReadinessPanel \/>\s*\) : \(/,
  );
  assert.equal((pageSource.match(/<AppDownloadReadinessPanel \/>/g) ?? []).length, 1);
  assert.doesNotMatch(pageSource, /display:\s*["']none["'][\s\S]{0,160}AppDownloadReadinessPanel/);
  assert.match(pageSource, /Create web traffic campaign/);
  assert.match(pageSource, /Web traffic preflight/);
});

test("#1950 flag-ON ephemeral interceptor admits only readiness reads, checks, and safe analytics", async () => {
  const interceptor = createEphemeralInterceptor({
    data: { enable_app_download_readiness: true },
    error: null,
  });
  const flags = await loadFlagsWith((route, body) => interceptor.request(route, body));
  assert.equal(await flags.isFlagEnabled("enable_app_download_readiness"), true);
  assert.deepEqual(interceptor.calls[0], {
    route: "admin_get_feature_flags",
    body: {
      p_keys: [
        "enable_rules_filter_tab",
        "enable_refresh_tab",
        "enable_app_download_readiness",
      ],
    },
  });
  const loaded = await interceptor.request("admin-ad-app-readiness", {
    action: "load",
    app_key: "business",
    os: "android",
  });
  const checked = await interceptor.request("admin-ad-app-readiness", {
    action: "check",
    app_key: "business",
    os: "android",
  });
  await interceptor.request("admin-ad-app-readiness-event", {
    event_name: "check_completed",
    app_key: "business",
    os: "android",
  });
  for (const result of [loaded, checked]) {
    const accepted = validateReadinessResponse(result.data, "business", "android");
    assert.equal(accepted.targets.length, 4);
    assert.deepEqual(
      accepted.selected.latest.results.map((row) => row.provider),
      ["meta", "tiktok", "snapchat", "google", "reddit"],
    );
  }
  await assert.rejects(
    () => interceptor.request("admin-ad-create-campaign"),
    /unlisted_request/,
  );
  assert.equal(
    interceptor.calls.filter(({ route }) => /^https?:\/\//.test(route)).length,
    0,
  );
});

test("#1950 OFF rollback makes zero readiness calls in the next fresh session", async () => {
  const interceptor = createEphemeralInterceptor({
    data: { enable_app_download_readiness: false },
    error: null,
  });
  const flags = await loadFlagsWith((route, body) => interceptor.request(route, body));
  const enabled = await flags.isFlagEnabled("enable_app_download_readiness");
  if (enabled) await interceptor.request("admin-ad-app-readiness", { action: "load" });
  assert.equal(enabled, false);
  assert.deepEqual(interceptor.calls.map(({ route }) => route), ["admin_get_feature_flags"]);
  assert.match(pageSource, /<AdConnectionsPanel \/>/);
  assert.match(pageSource, /Web traffic campaigns/);
});
