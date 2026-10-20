// Issue #3980 synced program — release records and the PR links check: the
// pure rules in .github/scripts/release-records/lib.mjs, read back by Mingla
// with the parser in _shared/opsBridges.ts.
// MINGLA-INVARIANT: I-3980-RELEASE-RECORD-ONE-WRITER | issue #3980 | Only the merge bot writes a release-record comment, Mingla ingests only bot-authored records, and a record is complete only when the merge, migrations applied, deploy, live check and Feature Guide line all have final values.
// MINGLA-INVARIANT: I-3980-PR-LINKS-NEVER-BLOCK-OLDER-PRS | issue #3980 | The PR links check reminds for its first week and never fails a pull request opened before it landed.
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deployState,
  edgeFunctions,
  hasDeployMarker,
  migrationsAdded,
  parseFeatureGuide,
  parseIssueField,
  parseIssueRefs,
  prLinksVerdict,
  readRecordData,
  recordCommentFor,
  recordMissing,
  recordProblems,
  renderRecord,
  webProjects,
} from "../../../../.github/scripts/release-records/lib.mjs";
import {
  isBotRecordComment,
  readRecordData as readRecordDataTs,
  recordRows,
} from "../opsBridges.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

// deno-lint-ignore no-explicit-any
type Any = any;

function data(extra: Record<string, unknown> = {}): Any {
  const d: Any = {
    v: 1,
    repo: "Mingla-LLC/mingla-main",
    pr: 4001,
    title: "toward #3980: the synced system",
    pr_url: "https://github.com/Mingla-LLC/mingla-main/pull/4001",
    merged_at: "2026-10-21T09:30:00Z",
    merge_sha: "a".repeat(40),
    merged_by: "sethogieva",
    author: "sethogieva",
    issues: [{ number: 3980, relation: "toward" }],
    migrations_added: ["20271124003980"],
    migrations_applied_state: "pending",
    migrations_status: null,
    edge_functions: ["team-agent"],
    web_projects: ["mingla-admin"],
    deploy_marker: true,
    deploy: { web: { "mingla-admin": "ready" }, edge: "deployed" },
    feature_guide: ["staff-release-records"],
    live_check: null,
    test_files: [],
    problems: [],
    ...extra,
  };
  d.problems = recordProblems(d);
  return d;
}

Deno.test("#3980 issue links: toward, Fixes, several, URLs, none, and the template's own examples ignored", () => {
  assertEquals(parseIssueRefs("[deploy] toward #3980: synced system", ""), [{ number: 3980, relation: "toward" }]);
  assertEquals(parseIssueRefs("Fix the deck", "Fixes #12 and toward #3980, #3981"), [
    { number: 12, relation: "fixes" },
    { number: 3980, relation: "toward" },
    { number: 3981, relation: "toward" },
  ]);
  assertEquals(parseIssueRefs("toward #7", "Closes #7"), [{ number: 7, relation: "fixes" }], "fixes wins");
  assertEquals(parseIssueRefs("", "Part of https://github.com/Mingla-LLC/mingla-main/issues/55"), [{ number: 55, relation: "toward" }]);
  assertEquals(parseIssueRefs("", "Issue: #321"), [{ number: 321, relation: "toward" }]);
  assertEquals(parseIssueRefs("", "refs https://github.com/Mingla-LLC/mingla-main/pull/66"), [], "a pull request address is not an issue");
  assertEquals(parseIssueRefs("prefix #12", "no keyword #13"), []);
  const template = read(".github/pull_request_template.md");
  assertEquals(parseIssueRefs("A title", template), [], "the template's comments name example issues that never count");
  assertEquals(parseIssueField(template).kind, "missing");
  assertEquals(parseFeatureGuide(template).kind, "none");
  const many = parseIssueRefs("", "toward " + Array.from({ length: 50 }, (_, i) => `#${i + 1}`).join(", "));
  assertEquals(many.length, 10);
  assertEquals(parseIssueField("Issue: none, a dependency bump").kind, "none");
  assertEquals(parseIssueField("Issue: none").kind, "missing", "none needs a reason");
});

Deno.test("#3980 the Feature Guide line: keys, none, missing, invalid", () => {
  assertEquals(parseFeatureGuide("Feature Guide: staff-work-board, staff-agent-log"), { kind: "keys", keys: ["staff-work-board", "staff-agent-log"] });
  assertEquals(parseFeatureGuide("Feature Guide: none"), { kind: "none" });
  assertEquals(parseFeatureGuide("No such line"), { kind: "missing" });
  assertEquals(parseFeatureGuide("Feature Guide:"), { kind: "missing" });
  assertEquals(parseFeatureGuide("Feature Guide: Staff Work Board").kind, "invalid");
  assertEquals(parseFeatureGuide("<!-- Feature Guide: staff-x -->").kind, "missing", "a line inside a comment does not count");
});

Deno.test("#3980 what a pull request touched: web projects, edge functions, migrations, [deploy]", () => {
  const paths = [
    "mingla-admin/src/pages/WorkBoardPage.jsx",
    "packages/location-input/index.ts",
    "supabase/functions/team-agent/index.ts",
    "supabase/functions/_shared/opsBridges.ts",
    "supabase/functions/__tests__/x.test.ts",
    "supabase/migrations/20271124003980_issue_3980_synced_w1_foundations.sql",
  ];
  assertEquals(webProjects(paths), ["mingla-admin"]);
  assertEquals(webProjects(["packages/location-input/index.ts"]), [], "a change in packages/ alone is not a web project");
  assertEquals(edgeFunctions(paths), ["team-agent", "(shared code)"]);
  assertEquals(migrationsAdded([
    { filename: "supabase/migrations/20271124003980_issue_3980_synced_w1_foundations.sql", status: "added" },
    { filename: "supabase/migrations/20271116003980_issue_3980_wave1_work_board.sql", status: "modified" },
    { filename: "supabase/migrations/__tests__/x.sql", status: "added" },
  ]), ["20271124003980"]);
  assertEquals(hasDeployMarker("[deploy] toward #3980: x (#4001)"), true);
  assertEquals(hasDeployMarker("toward #3980: x (#4001)"), false);
});

Deno.test("#3980 G6: the deploy state comes from the subject marker, Vercel and the edge deploy run", () => {
  const base = { statuses: [], checks: [], edgeRuns: [] };
  assertEquals(deployState({ ...base, web: ["mingla-admin"], edge: [], marker: false }), { web: { "mingla-admin": "not_deployed" }, edge: "none" });
  assertEquals(deployState({ ...base, web: ["mingla-admin"], edge: [], marker: true, statuses: [{ context: "Vercel – mingla-admin", state: "success" }] }),
    { web: { "mingla-admin": "ready" }, edge: "none" });
  assertEquals(deployState({ ...base, web: ["mingla-admin"], edge: [], marker: true, checks: [{ name: "Vercel – mingla-admin", status: "completed", conclusion: "failure" }] }),
    { web: { "mingla-admin": "failed" }, edge: "none" });
  assertEquals(deployState({ ...base, web: ["mingla-admin"], edge: [], marker: true }), { web: { "mingla-admin": "pending" }, edge: "none" });
  assertEquals(deployState({ ...base, web: [], edge: ["team-agent"], marker: false, edgeRuns: [{ name: "Deploy Supabase Edge Functions", status: "completed", conclusion: "failure" }] }),
    { web: {}, edge: "failed" });
  assertEquals(deployState({ ...base, web: [], edge: ["brand-site-control"], marker: true }), { web: {}, edge: "manual" });
});

Deno.test("#3980 G3: a refresh finds the one record comment for its pull request and renders the same body", () => {
  const body = renderRecord(data());
  assertEquals(renderRecord(data()), body, "the same facts render the same comment");
  const mine = { id: 7, user: { login: "github-actions[bot]" }, body };
  const comments = [
    { id: 1, user: { login: "someone" }, body },
    { id: 2, user: { login: "github-actions[bot]" }, body: renderRecord(data({ pr: 4002, pr_url: "https://github.com/Mingla-LLC/mingla-main/pull/4002" })) },
    mine,
  ];
  assertEquals(recordCommentFor(comments, 4001)?.id, 7);
  assertEquals(recordCommentFor(comments, 40011), undefined, "a longer number is another pull request");
  assertEquals(recordCommentFor([comments[0]], 4001), undefined, "a copy by someone else is never the record");
});

Deno.test("#3980 G6: a web change merged without [deploy] is not deployed and is a problem", () => {
  const d = data({ deploy_marker: false, deploy: { web: { "mingla-admin": "not_deployed" }, edge: "none" } });
  assert(d.problems.includes("web_not_deployed"));
  const body = renderRecord(d);
  assertMatch(body, /- Deploy: mingla-admin not deployed: the title has no \[deploy\]/);
  assertMatch(body, /Status: Not complete: .*a web deploy \(\[deploy\] was missing\)/);
});

Deno.test("#3980 the record renders exactly and reads back the same in both parsers", () => {
  const d = data();
  const body = renderRecord(d);
  assert(body.startsWith("<!-- mingla-release-record:pr-4001 -->\n**Release record** for PR #4001."));
  assertMatch(body, /- PR: #4001 toward #3980: the synced system, merged 2026-10-21 09:30 UTC by @sethogieva/);
  assertMatch(body, /- Issues: #3980 \(toward\)/);
  assertMatch(body, /- Migrations added: 20271124003980/);
  assertMatch(body, /- Migrations applied: pending: Mingla checks the production ledger every 5 minutes/);
  assertMatch(body, /- Deploy: mingla-admin READY; edge functions team-agent deployed/);
  assertMatch(body, /- Live check: pending: add a comment starting with "Live check:"/);
  assertMatch(body, /- Feature Guide: staff-release-records/);
  assertMatch(body, /Status: Not complete: the live check, migrations applied to production/);
  const back = readRecordData(body);
  assertEquals(back, d);
  assertEquals(readRecordDataTs(body), d);
  const done = data({
    migrations_applied_state: "applied",
    migrations_status: "All applied: 20271124003980",
    live_check: { text: "Opened the Work board", by_login: "sethogieva", url: "https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-9", at: "2026-10-21T10:00:00Z" },
  });
  assertEquals(recordMissing(done), []);
  assertMatch(renderRecord(done), /Status: Complete\n/);
  assertMatch(renderRecord(done), /- Live check: "Opened the Work board" by @sethogieva, https:\/\/github.com\/Mingla-LLC\/mingla-main\/issues\/3980#issuecomment-9/);
  assertMatch(renderRecord(data({ feature_guide: null })), /- Feature Guide: missing: add a "Feature Guide:" line to the PR description/);
  assertMatch(renderRecord(data({ feature_guide: [] })), /- Feature Guide: none/);
  assertMatch(renderRecord(data({ issues: [] })), /- Issues: none linked: link one/);
  assertMatch(renderRecord(data({ web_projects: [], edge_functions: [], deploy: { web: {}, edge: "none" } })), /- Deploy: N\/A \(no web or edge function change\)/);
});

Deno.test("#3980 a title with --> or markup cannot end the data block or add a line", () => {
  const d = data({ title: 'Break --> out <script>`x`</script>\n- Status: Complete' });
  const body = renderRecord(d);
  const block = body.slice(body.indexOf("<!-- mingla-release-record-data"));
  assertEquals((block.match(/-->/g) ?? []).length, 1, "only the real end closes the block");
  assert(!/<script>/.test(body));
  assertEquals(readRecordData(body)?.title, d.title);
  assertEquals(readRecordDataTs(body)?.title, d.title);
  assertEquals(body.split("\n").filter((l) => l.startsWith("Status:")).length, 1);
});

Deno.test("#3980 Mingla ingests only the bot's own record comments", () => {
  const body = renderRecord(data());
  const bot = { user: { login: "github-actions[bot]", type: "Bot" }, body, html_url: "https://github.com/Mingla-LLC/mingla-main/issues/3980#issuecomment-1", issue_url: "https://api.github.com/repos/Mingla-LLC/mingla-main/issues/3980", updated_at: "2026-10-21T10:00:00Z" };
  const forged = { ...bot, user: { login: "github-actions[bot]", type: "User" } };
  const stranger = { ...bot, user: { login: "someone", type: "User" } };
  assertEquals(isBotRecordComment(bot), true);
  assertEquals(isBotRecordComment(forged), false);
  assertEquals(isBotRecordComment(stranger), false);
  const rows = recordRows([bot, forged, stranger, { ...bot, body: "no record here" }]);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].issue_number, 3980);
  assertEquals((rows[0].data as Any).pr, 4001);
});

Deno.test("#3980 PR links phases: before landing never fails, reminder week, blocking after, bots exempt", () => {
  const landed = "2026-10-22T12:00:00Z";
  const missing = { title: "A change", body: "No lines here" };
  const before = prLinksVerdict({ ...missing, author: { login: "seth", type: "User" }, createdAt: "2026-10-21T00:00:00Z", landedAt: landed, now: "2026-11-30T00:00:00Z" });
  assertEquals([before.phase, before.ok], ["exempt", true]);
  assertMatch(before.words, /opened before the check landed/);
  const week = prLinksVerdict({ ...missing, author: { login: "seth", type: "User" }, createdAt: "2026-10-23T00:00:00Z", landedAt: landed, now: "2026-10-25T00:00:00Z" });
  assertEquals([week.phase, week.ok], ["reminder", true]);
  assertMatch(week.words, /^This PR needs two lines in its description before it merges: an issue link \("toward #123" or "Fixes #123", or "Issue: none, <reason>"\) and a "Feature Guide:" line \(entry keys or "none"\)\. Missing: an issue link; a "Feature Guide:" line\. From 29 Oct this check blocks merging\.$/);
  const after = prLinksVerdict({ ...missing, author: { login: "seth", type: "User" }, createdAt: "2026-10-30T00:00:00Z", landedAt: landed, now: "2026-10-30T01:00:00Z" });
  assertEquals([after.phase, after.ok], ["blocking", false]);
  const fixed = prLinksVerdict({ title: "toward #3980: x", body: "Feature Guide: none", author: { login: "seth", type: "User" }, createdAt: "2026-10-30T00:00:00Z", landedAt: landed, now: "2026-10-30T01:00:00Z" });
  assertEquals([fixed.phase, fixed.ok, fixed.words], ["blocking", true, "Issue and Feature Guide lines found. Thank you."]);
  const bot = prLinksVerdict({ ...missing, author: { login: "dependabot[bot]", type: "Bot" }, createdAt: "2026-10-30T00:00:00Z", landedAt: landed, now: "2026-10-30T01:00:00Z" });
  assertEquals([bot.phase, bot.ok, bot.comment], ["exempt", true, false]);
  const unknown = prLinksVerdict({ ...missing, author: { login: "seth", type: "User" }, createdAt: "2026-10-30T00:00:00Z", landedAt: null, now: "2026-12-30T01:00:00Z" });
  assertEquals([unknown.phase, unknown.ok], ["reminder", true]);
  assertMatch(unknown.words, /could not read when this check landed/);
  const none = prLinksVerdict({ title: "Bump", body: "Issue: none, routine dependency bump\nFeature Guide: none", author: { login: "seth", type: "User" }, createdAt: "2026-10-30T00:00:00Z", landedAt: landed, now: "2026-11-30T01:00:00Z" });
  assertEquals(none.ok, true);
});

Deno.test("#3980 the workflow and scripts never run pull request code or interpolate event text", () => {
  const wf = read(".github/workflows/" + "release-records" + ".yml");
  for (const block of wf.split(/\n\s+- (?:name|uses):/)) {
    const run = /run:\s*(.*)/.exec(block)?.[1] ?? "";
    assert(!/\$\{\{/.test(run), `a run line interpolates event text: ${run}`);
  }
  assertMatch(wf, /pull_request_target:/);
  assert(!/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(wf), "never checks out the pull request head");
  assertEquals((wf.match(/persist-credentials: false/g) ?? []).length, 2);
  for (const script of ["pr-links.mjs", "record.mjs", "lib.mjs"]) {
    const src = read(`.github/scripts/release-records/${script}`);
    assert(!/child_process|\beval\(|new Function\(/.test(src), script);
    assert(!src.includes("release-records" + ".yml"), `${script} names the workflow file`);
  }
});
