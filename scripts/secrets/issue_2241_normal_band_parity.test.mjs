/**
 * #2241 implementor proof — normal-mode migration-band parity, and the
 * post-deploy fallback watch that replaces the strictness being relaxed.
 *
 * The distinction used to be load-bearing while direct compatibility names
 * remained in production. #3645 closes that migration band at the exact
 * 90-name manifest, so normal and remediation mode now converge on one live
 * set while the same adversarial cases prove that no 91st name is admitted.
 *
 * Load-bearing assertions include:
 * - an in-band extra passes normal mode
 * - an out-of-band extra still fails normal mode
 * - a missing declared name still fails normal mode
 * - the relaxation ships with a replacement observation that can fail
 *
 * [TEST-MOD-APPROVED #3645] Seth approved the payout-release restricted key
 * as the 90th and final absolute-ceiling name. The migration band is therefore
 * empty; both modes require the exact declared set and the 91st name fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ISSUE_2241_EXTRA_NAMES } from "./audit-function-secret-contract.mjs";
import {
  assertLiveNameParity,
  ReadinessError,
} from "./preflight-function-secret-readiness.mjs";
import {
  buildWatchQuery,
  DEFAULT_WINDOW_MINUTES,
  evaluateFallbackWatch,
  FallbackWatchError,
  runGovernedFallbackWatch,
} from "./postdeploy-governed-fallback-watch.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/secrets.manifest.json"), "utf8"),
);
const contract = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/function-env.contract.json"), "utf8"),
);
const projectRef = "gqnoajqerqhnvulmnyvv";
const declared = manifest.secrets.map((record) => record.name);

function parity(liveNames, mode = "normal") {
  return assertLiveNameParity({
    contract,
    manifest,
    liveNames,
    projectRef,
    mode,
  });
}

function readinessCode(code, detail = null) {
  return (error) => {
    assert.ok(
      error instanceof ReadinessError,
      `not a ReadinessError: ${error}`,
    );
    assert.equal(error.code, code);
    if (detail !== null) {
      assert.ok(
        error.details.includes(detail),
        `expected detail ${detail} in ${JSON.stringify(error.details)}`,
      );
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Verdict 1 — an in-band extra passes normal mode.
// ---------------------------------------------------------------------------

test("#2241 happy: normal mode accepts the approved migration band", () => {
  assert.equal(declared.length, 90);
  assert.deepEqual([...ISSUE_2241_EXTRA_NAMES], []);

  // 90 — today's production state and the exact absolute-ceiling authority.
  const full = parity([...declared, ...ISSUE_2241_EXTRA_NAMES]);
  assert.equal(full.liveUserManaged.length, 90);

  // The empty in-band subset is the only permitted state at the ceiling.
  for (const band of [[]]) {
    const result = parity([...declared, ...band]);
    assert.equal(result.liveUserManaged.length, 90 + band.length);
  }

  // Platform-managed names are still excluded before the comparison, so the
  // band tolerance did not become a general prefix bypass.
  const withPlatform = parity([
    ...declared,
    ...ISSUE_2241_EXTRA_NAMES,
    ...contract.platform_managed,
  ]);
  assert.equal(withPlatform.liveUserManaged.length, 90);
});

// ---------------------------------------------------------------------------
// Verdict 2 — an out-of-band extra still fails.
// ---------------------------------------------------------------------------

test("#2241 adversarial: normal mode still rejects any name outside the band", () => {
  assert.throws(
    () => parity([...declared, "UNAPPROVED_EXTRA"]),
    readinessCode("live_name_set_mismatch", "unexpected:UNAPPROVED_EXTRA"),
  );
  // A 91st name is the exact breach the empty band must not admit.
  assert.throws(
    () => parity([...declared, ...ISSUE_2241_EXTRA_NAMES, "UNAPPROVED_EXTRA"]),
    readinessCode("live_name_set_mismatch", "unexpected:UNAPPROVED_EXTRA"),
  );
  // Names removed from production on 2026-09-02 are NOT in the band and must
  // not be smuggled back in through it.
  for (
    const removed of [
      "META_COMPETITOR_ACCESS_TOKEN",
      "META_COMPETITOR_IG_USER_ID",
      "RESEND_WEBHOOK_SECRET",
    ]
  ) {
    assert.throws(
      () => parity([...declared, ...ISSUE_2241_EXTRA_NAMES, removed]),
      readinessCode("live_name_set_mismatch", `unexpected:${removed}`),
    );
  }
  // The band widens only if the CONTRACT widens; the code carries no literal.
  const widened = structuredClone(contract);
  widened.remediation.allowed_extra_live_names = [
    ...widened.remediation.allowed_extra_live_names,
    "UNAPPROVED_EXTRA",
  ].sort();
  assert.notDeepEqual(
    widened.remediation.allowed_extra_live_names,
    contract.remediation.allowed_extra_live_names,
  );
});

// ---------------------------------------------------------------------------
// Verdict 3 — a missing declared name still fails.
// ---------------------------------------------------------------------------

test("#2241 adversarial: normal mode still rejects a missing declared name", () => {
  for (const absent of [declared[0], declared.at(-1)]) {
    assert.throws(
      () =>
        parity([
          ...declared.filter((name) => name !== absent),
          ...ISSUE_2241_EXTRA_NAMES,
        ]),
      readinessCode("live_name_set_mismatch", `missing:${absent}`),
    );
    assert.throws(
      () => parity(declared.filter((name) => name !== absent)),
      readinessCode("live_name_set_mismatch", `missing:${absent}`),
    );
  }
  // The wrong-project guard still fires ahead of any set comparison.
  assert.throws(
    () =>
      assertLiveNameParity({
        contract,
        manifest,
        liveNames: [...declared, ...ISSUE_2241_EXTRA_NAMES],
        projectRef: "abcdefghijklmnopqrst",
      }),
    readinessCode("wrong_project", "abcdefghijklmnopqrst"),
  );
});

// ---------------------------------------------------------------------------
// Remediation mode is untouched by the relaxation.
// ---------------------------------------------------------------------------

test("#2241 regression: remediation mode still REQUIRES exactly 90", () => {
  const result = parity(
    [...declared, ...ISSUE_2241_EXTRA_NAMES],
    "issue-2241-remediation",
  );
  assert.equal(result.liveUserManaged.length, 90);

  assert.throws(
    () => parity(declared.slice(1), "issue-2241-remediation"),
    readinessCode("live_name_set_mismatch", `missing:${declared[0]}`),
  );
});

// ---------------------------------------------------------------------------
// Out-of-scope invariants: byte-identical.
// ---------------------------------------------------------------------------

test("#2241 regression: every out-of-scope secret invariant is unchanged", () => {
  assert.equal(manifest.policy.normal_ceiling, 87);
  assert.equal(manifest.policy.absolute_ceiling, 90);
  assert.equal(manifest.secrets.length, 90);
  assert.equal(contract.remediation.allowed_extra_live_names.length, 0);
  assert.equal(contract.remediation.production_ref, projectRef);
  assert.equal(contract.remediation.issue, 2241);
  assert.equal(contract.remediation.selected_functions.length, 23);

  const preflight = readFileSync(
    resolve(ROOT, "scripts/secrets/preflight-function-secret-readiness.mjs"),
    "utf8",
  );
  for (
    const token of [
      "remediation_requires_exact_90",
      "liveUserManaged.length !== 90",
      "wrong_project",
      "`missing:${name}`",
      "`unexpected:${name}`",
      "live_name_set_mismatch",
    ]
  ) assert.ok(preflight.includes(token), `preflight lost: ${token}`);

  const records = new Map(manifest.secrets.map((r) => [r.name, r]));
  const adFields = new Set(
    records.get("AD_CONVERSION_TOKENS").bundle_fields.map((f) => f.name),
  );
  assert.ok(adFields.has("ATTENDANCE_CLAIM_PEPPER"));
  const deliveryFields = new Set(
    records.get("MINGLA_DELIVERY_FLAGS_JSON").bundle_fields.map((f) => f.name),
  );
  assert.ok(deliveryFields.has("checkout_revocation_execute"));
});

// ---------------------------------------------------------------------------
// The replacement observation. A relaxation whose watch cannot fail is #2113.
// ---------------------------------------------------------------------------

function watchRow(overrides = {}) {
  return {
    bundle_invalid: 0,
    function_log_rows: 400,
    legacy_fallback: 0,
    total_rows: 12000,
    ...overrides,
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { json: async () => body, ok, status };
}

test("#2241 happy: a clean observed window passes and reports its denominator", () => {
  const counts = evaluateFallbackWatch(watchRow());
  assert.equal(counts.legacyFallback, 0);
  assert.equal(counts.bundleInvalid, 0);
  assert.equal(counts.totalRows, 12000);

  const sql = buildWatchQuery();
  assert.match(sql, /governed_ad_legacy_fallback/);
  assert.match(sql, /governed_ad_bundle_invalid/);
  assert.match(sql, /from logs/);
  assert.match(sql, /source in \('edge_logs', 'function_logs'\)/);
  // Counts only. A raw log line must never leave the analytics engine.
  assert.doesNotMatch(sql, /select \*/);
  assert.match(sql, /^select count\(\) as total_rows,/);
});

test("#2241 adversarial: either governed diagnostic fails the deploy job", () => {
  for (
    const [field, event] of [
      ["legacy_fallback", "governed_ad_legacy_fallback"],
      ["bundle_invalid", "governed_ad_bundle_invalid"],
    ]
  ) {
    assert.throws(
      () => evaluateFallbackWatch(watchRow({ [field]: 1 })),
      (error) => {
        assert.ok(error instanceof FallbackWatchError);
        assert.equal(error.code, "governed_ad_fallback_observed");
        assert.ok(error.details.includes(event));
        return true;
      },
      event,
    );
  }
  assert.throws(
    () =>
      evaluateFallbackWatch(
        watchRow({ bundle_invalid: 3, legacy_fallback: 7 }),
      ),
    (error) =>
      error instanceof FallbackWatchError &&
      error.details.length === 2,
  );
});

test("#2241 adversarial: the watch fails closed on every way of not observing", () => {
  // A zero with no denominator is not evidence of health.
  assert.throws(
    () =>
      evaluateFallbackWatch(watchRow({ function_log_rows: 0, total_rows: 0 })),
    (error) =>
      error instanceof FallbackWatchError && error.code === "log_window_empty",
  );
  for (
    const row of [
      watchRow({ total_rows: "not-a-number" }),
      watchRow({ legacy_fallback: -1 }),
      watchRow({ bundle_invalid: null }),
      watchRow({ function_log_rows: 1.5 }),
      null,
      [],
    ]
  ) {
    assert.throws(
      () => evaluateFallbackWatch(row),
      (error) =>
        error instanceof FallbackWatchError &&
        error.code === "watch_response_invalid",
      JSON.stringify(row),
    );
  }
});

test("#2241 adversarial: the watch transport fails closed and never skips", async () => {
  const ok = {
    accessToken: "t",
    fetchImpl: async () => jsonResponse({ result: [watchRow()] }),
    projectRef,
  };
  const clean = await runGovernedFallbackWatch(ok);
  assert.equal(clean.windowMinutes, DEFAULT_WINDOW_MINUTES);
  assert.equal(clean.legacyFallback, 0);

  const cases = [
    ["watch_access_token_missing", { ...ok, accessToken: "" }],
    ["watch_access_token_missing", { ...ok, accessToken: undefined }],
    ["watch_project_ref_invalid", { ...ok, projectRef: "short" }],
    ["watch_project_ref_invalid", { ...ok, projectRef: undefined }],
    ["watch_window_invalid", { ...ok, windowMinutes: 0 }],
    ["watch_window_invalid", { ...ok, windowMinutes: 1441 }],
    ["watch_transport_unavailable", { ...ok, fetchImpl: null }],
    [
      "watch_request_failed",
      {
        ...ok,
        fetchImpl: async () => jsonResponse({}, { ok: false, status: 401 }),
      },
    ],
    [
      "watch_request_failed",
      {
        ...ok,
        fetchImpl: async () => {
          throw new Error("network down");
        },
      },
    ],
    [
      "watch_query_error",
      {
        ...ok,
        fetchImpl: async () => jsonResponse({ error: "bad sql", result: [] }),
      },
    ],
    [
      "watch_response_invalid",
      { ...ok, fetchImpl: async () => jsonResponse({ result: [] }) },
    ],
    [
      "watch_response_invalid",
      {
        ...ok,
        fetchImpl: async () => ({
          json: async () => {
            throw new Error("not json");
          },
          ok: true,
          status: 200,
        }),
      },
    ],
    [
      "governed_ad_fallback_observed",
      {
        ...ok,
        fetchImpl: async () =>
          jsonResponse({ result: [watchRow({ legacy_fallback: 1 })] }),
      },
    ],
  ];
  for (const [code, args] of cases) {
    await assert.rejects(
      () => runGovernedFallbackWatch(args),
      (error) => {
        assert.ok(error instanceof FallbackWatchError, `${code}: ${error}`);
        assert.equal(error.code, code);
        return true;
      },
      code,
    );
  }
});

test("#2241 regression: the request is bounded, authorized and value-blind", async () => {
  let seen = null;
  await runGovernedFallbackWatch({
    accessToken: "token-value",
    fetchImpl: async (url, init) => {
      seen = { init, url: new URL(url) };
      return jsonResponse({ result: [watchRow()] });
    },
    nowMs: Date.parse("2026-09-02T12:34:56.789Z"),
    projectRef,
    windowMinutes: 60,
  });
  assert.equal(seen.url.hostname, "api.supabase.com");
  assert.equal(
    seen.url.pathname,
    `/v1/projects/${projectRef}/analytics/endpoints/logs`,
  );
  assert.equal(seen.init.method, "GET");
  assert.equal(seen.init.headers.Authorization, "Bearer token-value");
  // Bounded window, rounded to the minute, inside the API's 24-hour maximum.
  assert.equal(
    seen.url.searchParams.get("iso_timestamp_start"),
    "2026-09-02T11:34:00.000Z",
  );
  assert.equal(
    seen.url.searchParams.get("iso_timestamp_end"),
    "2026-09-02T12:34:00.000Z",
  );
  // The credential is never placed in the query string.
  assert.doesNotMatch(seen.url.search, /token-value/);
});

// ---------------------------------------------------------------------------
// The watch is actually WIRED. An unrun check is not an observation.
// ---------------------------------------------------------------------------

test("#2241 regression: every relaxed deploy route runs the fallback watch", () => {
  const deploy = readFileSync(
    resolve(ROOT, "scripts/deploy-supabase-functions.sh"),
    "utf8",
  );
  const code = deploy
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const invocations = code.match(
    /postdeploy-governed-fallback-watch\.mjs/g,
  ) ?? [];
  assert.equal(
    invocations.length,
    2,
    "both routes whose NORMAL-mode parity was relaxed must run the watch: " +
      "the plain deploy loop and --normal-governed-deploy",
  );
  // `exec` on the governed route would have replaced this shell and made the
  // watch unreachable — an observation that cannot run is not an observation.
  assert.doesNotMatch(
    code,
    /exec node .*reconcile-governed-secrets\.mjs\s*\\\s*\n\s*--normal-governed-deploy/,
  );
  assert.match(code, /--normal-governed-deploy/);
  // The remediation route is NOT relaxed by #2241 and keeps its own contract.
  // [TEST-MOD-APPROVED #3643] The #3067 assertion used wrapper-level `exec`
  // as a proxy for terminal remediation. Phase 3 owns an EXIT cleanup trap, so
  // the security proof now scopes the branch and requires the coordinator's
  // remediation-mode verdict to terminate it without bypassing restoration.
  const remediationMatch = code.match(
    /if \[\[ "\$remediation" == true \]\]; then\n([\s\S]*?)\nfi/,
  );
  assert.ok(remediationMatch, "the remediation branch must remain explicit");
  const remediationBody = remediationMatch[1].trim();
  const coordinatorCommand =
    'node "${repo_root}/scripts/secrets/reconcile-governed-secrets.mjs"';
  assert.equal(
    remediationBody.split(coordinatorCommand).length - 1,
    1,
    "remediation must invoke the coordinator exactly once",
  );
  assert.match(remediationBody, /--project-ref "\$project_ref"/);
  assert.match(remediationBody, /"\$\{coordinator_args\[@\]\}"/);
  assert.doesNotMatch(remediationBody, /--normal-governed-deploy/);
  assert.doesNotMatch(remediationBody, /postdeploy-governed-fallback-watch\.mjs/);
  assert.doesNotMatch(remediationBody, /\bexec\b/);
  assert.match(
    remediationBody,
    /"\$\{coordinator_args\[@\]\}"\n\s*exit 0$/,
    "successful remediation must terminate before transition or normal deploy logic",
  );
});
