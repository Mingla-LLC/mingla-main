// Issue #4084 — a later reviewed edge deploy may complete an older release
// record only through an exact, machine-written attestation on its merge SHA.
// MINGLA-INVARIANT: I-4084-EDGE-SUPERSESSION-EXACT | issue #4084 | A later edge deploy supersedes an earlier failed release-record deploy only when current main descends from the merge, preflight is off, and the deployed concrete function set exactly equals the pull request's changed concrete functions.
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  concreteEdgeFunctions,
  deployState,
  edgeSupersessionStatus,
  edgeSupersessionVerdict,
  renderRecord,
} from "../../../../.github/scripts/release-records/lib.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const WORKFLOW_ROOT = ".github/workflows/";
const sha = (letter: string) => letter.repeat(40);

const pr = {
  merged_at: "2026-10-21T07:59:55Z",
  merge_commit_sha: sha("a"),
  base: { ref: "main" },
};
const paths = [
  "supabase/functions/_shared/adPlanPauseTransition.ts",
  "supabase/functions/admin-ad-campaign-action/index.ts",
  "supabase/functions/admin-ad-spend-sync/index.ts",
];
const selected = ["admin-ad-campaign-action", "admin-ad-spend-sync"];

Deno.test("#4084 the superseding selection must exactly equal every changed concrete function", () => {
  assertEquals(concreteEdgeFunctions(paths), selected);
  assertEquals(edgeSupersessionVerdict({
    pr,
    paths,
    selected,
    compareStatus: "ahead",
    currentSha: sha("b"),
    preflightOnly: false,
  }), { ok: true, expected: selected });

  assertEquals(edgeSupersessionVerdict({ pr, paths, selected: selected.slice(0, 1), compareStatus: "ahead", currentSha: sha("b"), preflightOnly: false }).reason, "selection_mismatch");
  assertEquals(edgeSupersessionVerdict({ pr, paths, selected: [...selected, "other"], compareStatus: "ahead", currentSha: sha("b"), preflightOnly: false }).reason, "selection_mismatch");
  assertEquals(edgeSupersessionVerdict({ pr, paths, selected, compareStatus: "diverged", currentSha: sha("b"), preflightOnly: false }).reason, "current_main_not_descendant");
  assertEquals(edgeSupersessionVerdict({ pr, paths, selected, compareStatus: "ahead", currentSha: sha("b"), preflightOnly: true }).reason, "preflight_only");
  assertEquals(edgeSupersessionVerdict({ pr, paths: [paths[0]], selected: [], compareStatus: "ahead", currentSha: sha("b"), preflightOnly: false }).reason, "no_concrete_functions");
});

Deno.test("#4084 only the exact success context and self-consistent Actions run count", () => {
  const good = {
    id: 9,
    context: "mingla/edge-deploy-supersession",
    state: "success",
    target_url: "https://github.com/Mingla-LLC/mingla-main/actions/runs/39579970600",
    description: "Later reviewed run 39579970600 deployed all 2 changed edge functions",
    created_at: "2026-10-22T20:00:00Z",
  };
  assertEquals(edgeSupersessionStatus([good]), {
    run_id: 39579970600,
    url: good.target_url,
    description: good.description,
    at: good.created_at,
  });
  for (const bad of [
    { ...good, state: "pending" },
    { ...good, context: "mingla/edge-deploy" },
    { ...good, target_url: "https://example.com/actions/runs/39579970600" },
    { ...good, description: "Later reviewed run 7 deployed all 2 changed edge functions" },
    { ...good, description: "Later reviewed run 39579970600 deployed all 0 changed edge functions" },
  ]) assertEquals(edgeSupersessionStatus([bad]), null);
});

Deno.test("#4084 a valid later attestation advances failed to deployed and keeps the original failure in the record", () => {
  const status = {
    context: "mingla/edge-deploy-supersession",
    state: "success",
    target_url: "https://github.com/Mingla-LLC/mingla-main/actions/runs/39579970600",
    description: "Later reviewed run 39579970600 deployed all 2 changed edge functions",
    created_at: "2026-10-22T20:00:00Z",
  };
  const state = deployState({
    web: [],
    edge: selected,
    marker: true,
    statuses: [status],
    checks: [],
    edgeRuns: [{ name: "Deploy Supabase Edge Functions", status: "completed", conclusion: "failure", created_at: "2026-10-21T08:00:00Z" }],
  });
  assertEquals(state.edge, "deployed");
  const data = {
    v: 1,
    repo: "Mingla-LLC/mingla-main",
    pr: 4035,
    title: "[deploy] toward #3697: restore relaunch",
    pr_url: "https://github.com/Mingla-LLC/mingla-main/pull/4035",
    merged_at: pr.merged_at,
    merge_sha: pr.merge_commit_sha,
    merged_by: "sethogieva",
    author: "sethogieva",
    issues: [{ number: 3697, relation: "toward" }],
    migrations_added: [],
    migrations_applied_state: "none",
    migrations_status: null,
    edge_functions: selected,
    web_projects: [],
    deploy_marker: true,
    deploy: state,
    edge_original_state: "failed",
    edge_supersession: edgeSupersessionStatus([status]),
    feature_guide: [],
    live_check: { text: "Checked live", by_login: "sethogieva", url: "https://github.com/Mingla-LLC/mingla-main/issues/3697#issuecomment-1", at: "2026-10-22T20:00:00Z" },
    test_files: [],
    problems: [],
  };
  const body = renderRecord(data);
  assertMatch(body, /deployed by later reviewed run https:\/\/github\.com\/Mingla-LLC\/mingla-main\/actions\/runs\/39579970600 \(original merge run failed\)/);
  assertMatch(body, /Status: Complete/);
  assert(body.includes('"edge_original_state":"failed"'));
});

Deno.test("#4084 only a successful real deployment can write the supersession status", () => {
  const deploy = read(WORKFLOW_ROOT + "deploy-functions.yml");
  assertMatch(deploy, /supersedes_pr:/);
  assertMatch(deploy, /statuses: write/);
  assertMatch(deploy, /success\(\).*inputs\.supersedes_pr != ''/);
  assertMatch(deploy, /inputs\.preflight_only != true/);
  assertMatch(deploy, /node \.github\/scripts\/release-records\/attest-edge-deploy\.mjs/);
  assertMatch(deploy, /edge_deployed: \$\{\{ steps\.deploy-marker\.outputs\.deployed \}\}/);
  assertMatch(deploy, /EDGE_DEPLOY_ATTESTATION_FAILED/);
  assertMatch(deploy, /Do not redeploy older code/);

  const release = read(WORKFLOW_ROOT + "release-records.yml");
  assertMatch(release, /github\.event\.context == 'mingla\/edge-deploy-supersession'/);

  const script = read(".github/scripts/release-records/attest-edge-deploy.mjs");
  assertMatch(script, /edgeSupersessionVerdict/);
  assertMatch(script, /\/compare\/\$\{pr\.merge_commit_sha\}\.\.\.\$\{currentSha\}/);
  assertMatch(script, /\/statuses\/\$\{pr\.merge_commit_sha\}/);
  assert(!/child_process|\beval\(|new Function\(/.test(script));
});
