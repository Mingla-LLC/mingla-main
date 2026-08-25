import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptRequest, analyticsPayload, countsFor, demoteLatest, parseTargetQuery, refreshLatestFreshness, safeActionHref, summaryFor, validateReadinessResponse, writeTargetQuery } from "../lib/adAppReadiness.js";
import { response } from "./fixtures/issue1950Readiness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("#1950 validates exact four-target/five-provider response and strict stale boundary", () => {
  const accepted = validateReadinessResponse(response, "business", "android");
  assert.equal(accepted.selected.store_identifier, "com.sethogieva.minglabusiness");
  assert.deepEqual(countsFor(accepted.selected.latest), { ready: 5, action_required: 0, blocked: 0, stale: 0 });
  assert.equal(summaryFor(accepted.selected.latest), "Ready for a future paused app campaign.");
  const boundary = structuredClone(response); boundary.server_now = boundary.targets[0].latest.stale_at;
  assert.equal(countsFor(validateReadinessResponse(boundary, "explorer", "ios").selected.latest).stale, 5);
  assert.equal(validateReadinessResponse({ ...response, targets: response.targets.slice(0, 3) }, "explorer", "ios"), null);
});

test("#1950 recheck demotes all prior results and exact request guard rejects late/sibling results", () => {
  const latest = validateReadinessResponse(response, "explorer", "ios").selected.latest;
  assert.equal(countsFor(demoteLatest(latest)).stale, 5);
  assert.equal(refreshLatestFreshness(latest, Date.parse(latest.stale_at) - 1), latest);
  assert.equal(countsFor(refreshLatestFreshness(latest, Date.parse(latest.stale_at))).stale, 5);
  const base = { selectedKey: "business:ios", capturedKey: "business:ios", currentRequestId: 4, capturedRequestId: 4, mounted: true, aborted: false };
  assert.equal(acceptRequest(base), true);
  assert.equal(acceptRequest({ ...base, selectedKey: "explorer:ios" }), false);
  assert.equal(acceptRequest({ ...base, currentRequestId: 5 }), false);
  assert.equal(acceptRequest({ ...base, aborted: true }), false);
});

test("#1950 URL and analytics helpers serialize only controlled values", () => {
  assert.deepEqual(parseTargetQuery("?app=business&os=android&token=secret"), { appKey: "business", os: "android" });
  assert.equal(writeTargetQuery("business", "android"), "?app=business&os=android");
  assert.equal(safeActionHref("https://ads.google.com/billing?secret=x#y"), "https://ads.google.com/billing");
  assert.equal(safeActionHref("javascript:alert(1)"), null);
  assert.deepEqual(Object.keys(analyticsPayload("detail_toggled", { appKey: "business", os: "ios", provider: "meta" })).sort(), ["app_key","event_name","os","provider"]);
});

test("#1950 Admin IA, a11y, responsive, disabled boundary, and web behavior stay explicit", () => {
  const page=read("src/pages/AdEnginePage.jsx"), panel=read("src/components/app-readiness/AppDownloadReadinessPanel.jsx"), selector=read("src/components/app-readiness/TargetSelector.jsx"), row=read("src/components/app-readiness/ProviderReadinessRow.jsx"), evidence=read("src/components/app-readiness/ReadinessEvidence.jsx"), boundary=read("src/components/app-readiness/FutureAppCampaignBoundary.jsx"), shell=read("src/components/layout/AppShell.jsx"), card=read("src/components/ui/Card.jsx"), service=read("src/services/adEngineService.js");
  assert.ok(page.indexOf("<AdConnectionsPanel />") < page.indexOf("<AppDownloadReadinessPanel />"));
  assert.ok(page.indexOf("<AppDownloadReadinessPanel />") < page.indexOf("Web traffic campaigns"));
  assert.doesNotMatch(page,/AppIdentityReadinessPanel/);
  assert.match(page,/Create web traffic campaign/); assert.match(page,/Web traffic preflight/);
  assert.match(panel,/aria-live="polite"/); assert.match(panel,/aria-busy/); assert.match(panel,/visibilitychange/); assert.match(panel,/window\.setInterval/); assert.match(selector,/role="tablist"/); assert.match(selector,/type="radio"/); assert.match(row,/aria-expanded/); assert.match(evidence,/<dl/);
  assert.match(boundary,/<button type="button" disabled aria-describedby=/); assert.doesNotMatch(boundary,/onClick=/);
  assert.match(shell,/px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12/); assert.doesNotMatch(shell,/px-16/);
  assert.match(card,/sm:flex-wrap/); assert.match(card,/break-words/);
  for (const name of ["loadAppReadiness","checkAppReadiness","recordAppReadinessEvent"]) assert.match(service,new RegExp(`export async function ${name}`));
  for (const unchanged of ["createCampaign","campaignAction","syncCampaigns"]) assert.match(service,new RegExp(`export async function ${unchanged}`));
});

test("#1950 provider corrective links use the Admin external-navigation owner", () => {
  const row = read("src/components/app-readiness/ProviderReadinessRow.jsx");
  assert.match(row, /import \{ openExternal \} from "\.\.\/\.\.\/lib\/openExternal";/);
  assert.match(row, /openExternal\(result\.action_href\)/);
  assert.doesNotMatch(row, /window\.open\(/);
});

// [TEST-MOD-APPROVED #2439] SC-14.1. This test read
// `../.github/workflows/issue-1950-app-readiness-tests.yml`, which #2439 Phase 3C
// deletes at cutover — the read happens inside the test body, so it would have
// failed this one test rather than the file, but it would have failed
// permanently on a correct tree. It now asserts the SAME four properties against
// the CI registry record that actually runs the suite: no `npm run lint` leaf
// exists; the exact `node --test src/__tests__/issue1950*.test.js` leaf exists
// with cwd `mingla-admin`; the `npm run build` leaf exists; and all 22
// lint-surface paths appear in the eslint leaf's argv. Nothing is loosened: each
// property is now pinned to the leaf that owns it, which is strictly tighter
// than matching anywhere in a YAML file.
test("#1950 CI lints its exact Admin ownership surface without inheriting unrelated baseline debt", () => {
  const registry = JSON.parse(read("../.github/ci-batch/MANIFEST.json"));
  const suite = registry.suites.filter((item) => item.id === "issue-1950-app-readiness-tests");
  assert.equal(suite.length, 1, "#1950 must be exactly one registered CI suite");
  const leaves = suite[0].steps.flatMap((step) => (step.children ?? []).map((child) => ({
    cwd: child.cwd ?? step.cwd ?? ".",
    command: child.invocation?.argv?.[1] ?? "",
  })));
  const owned = [
    "src/services/adEngineService.js",
    "src/lib/adAppReadiness.js",
    "src/lib/featureFlags.js",
    "src/components/AdConnectionsPanel.jsx",
    "src/components/app-readiness/AppDownloadReadinessPanel.jsx",
    "src/components/app-readiness/FutureAppCampaignBoundary.jsx",
    "src/components/app-readiness/ProviderReadinessList.jsx",
    "src/components/app-readiness/ProviderReadinessRow.jsx",
    "src/components/app-readiness/ReadinessEvidence.jsx",
    "src/components/app-readiness/SelectedTargetSummary.jsx",
    "src/components/app-readiness/TargetOverview.jsx",
    "src/components/app-readiness/TargetSelector.jsx",
    "src/components/campaign-builder/StepLane.jsx",
    "src/components/layout/AppShell.jsx",
    "src/components/ui/Card.jsx",
    "src/pages/AdEnginePage.jsx",
    "src/__tests__/fixtures/issue1950Readiness.js",
    "src/__tests__/issue1928_app_identity_focus_rework.test.js",
    "src/__tests__/issue1928_app_identity_readiness.test.js",
    "src/__tests__/issue1950_app_readiness.adversarial.tester.test.js",
    "src/__tests__/issue1950_app_readiness.test.js",
    "src/__tests__/issue1950_app_readiness_gate.test.js",
  ];
  for (const { command } of leaves) assert.doesNotMatch(command, /npm run lint/);
  assert.ok(
    leaves.some(({ cwd, command }) => cwd === "mingla-admin" && /^node --test src\/__tests__\/issue1950\*\.test\.js$/.test(command)),
    "the exact node --test leaf must run in mingla-admin",
  );
  assert.ok(leaves.some(({ cwd, command }) => cwd === "mingla-admin" && /^npm run build$/.test(command)), "the npm run build leaf must exist");
  const eslint = leaves.filter(({ command }) => command.startsWith("npx eslint "));
  assert.equal(eslint.length, 1, "exactly one eslint leaf owns the lint surface");
  assert.equal(eslint[0].cwd, "mingla-admin");
  const linted = eslint[0].command.slice("npx eslint ".length).split(/\s+/).filter(Boolean);
  for (const relative of owned) assert.ok(linted.includes(relative), `lint surface lost ${relative}`);
  assert.equal(owned.length, 22);
});
