import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { shouldRestoreCompletionFocus } from "../lib/adAppIdentityReadiness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const panel = fs.readFileSync(
  path.resolve(here, "../components/AppIdentityReadinessPanel.jsx"),
  "utf8",
);

const base = {
  pending: { appKey: "explorer", requestId: 7 },
  appKey: "explorer",
  currentRequestId: 7,
  phase: "ready",
  state: "ready",
  online: true,
  errorStatus: undefined,
  buttonDisabled: false,
};

test("#1928 rework restores focus only for the matching completed request", () => {
  for (const appKey of ["explorer", "business"]) {
    for (const phase of ["ready", "blocked", "error"]) {
      assert.equal(shouldRestoreCompletionFocus({
        ...base,
        pending: { appKey, requestId: 11 },
        appKey,
        currentRequestId: 11,
        phase,
        state: phase,
        errorStatus: phase === "error" ? 500 : undefined,
      }), true, `${appKey}/${phase} should restore focus`);
    }
  }
});

test("#1928 rework never focuses for stale, offline, forbidden, aborted, switched, loading, disabled, or absent completions", () => {
  const blocked = [
    { pending: null },
    { pending: { appKey: "business", requestId: 7 } },
    { currentRequestId: 8 },
    { phase: "loading", state: "loading" },
    { phase: "not_checked", state: "not_checked" },
    { state: "stale" },
    { online: false, state: "offline" },
    { phase: "error", state: "error", errorStatus: 403 },
    { buttonDisabled: true },
  ];
  for (const input of blocked) {
    assert.equal(shouldRestoreCompletionFocus({ ...base, ...input }), false);
  }
});

test("#1928 rework consumes a one-shot completion token in a post-render effect", () => {
  const completionEffect = panel.indexOf("const pending = completionFocus.current;");
  const handler = panel.indexOf("const runCheck = async () =>");
  assert.ok(completionEffect > 0 && completionEffect < handler);
  assert.match(panel, /buttonDisabled: !action \|\| action\.disabled/);
  assert.match(panel, /completionFocus\.current = null;\s*if \(canFocus\) action\.focus\(\);/);
  assert.doesNotMatch(panel.slice(handler), /actionRef\.current\?\.focus\(\)/);
  assert.match(panel, /completionFocus\.current = \{ appKey: requestedAppKey, requestId \};/);
});
