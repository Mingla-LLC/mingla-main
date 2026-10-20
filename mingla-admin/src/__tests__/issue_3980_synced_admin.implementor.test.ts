// Issue #3980 synced program, Wave 1 — the Admin side: GitHub links on work
// cards (the same cases as the server), chat names on agent labels, the
// working mark words, display names on Team and roles, and the people picker
// that no longer breaks names letter by letter.
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  agentName,
  GITHUB_LINK_WORDS,
  githubChipWords,
  parseGithubInput,
  workingWords,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));

// The same table the W1 SQL suite checks ops_github_parse against.
const CASES: [string, string][] = [
  ["#3980", "issue:3980"], ["3980", "issue:3980"], [" #12 ", "issue:12"],
  ["https://github.com/Mingla-LLC/mingla-main/issues/123", "issue:123"],
  ["https://github.com/Mingla-LLC/mingla-main/pull/3991", "pull:3991"],
  ["https://github.com/Mingla-LLC/mingla-main/pull/3991/", "pull:3991"],
  ["https://github.com/Mingla-LLC/mingla-main/pull/3991#issuecomment-1", "pull:3991"],
  ["https://github.com/Mingla-LLC/mingla-main/issues/5?x=1", "issue:5"],
  ["https://github.com/other/repo/pull/1", "error"], ["https://github.com/Mingla-LLC/other/issues/1", "error"],
  ["http://github.com/Mingla-LLC/mingla-main/issues/1", "error"], ["https://gitlab.com/Mingla-LLC/mingla-main/issues/1", "error"],
  ["https://github.com/Mingla-LLC/mingla-main/commit/abc", "error"], ["#0", "error"], ["#12345678", "error"], ["abc", "error"], ["", "error"],
];

Deno.test("#3980 synced: a GitHub link is parsed exactly as the server parses it", () => {
  for (const [input, want] of CASES) {
    const got = parseGithubInput(input);
    assertEquals("error" in got ? (got.error === GITHUB_LINK_WORDS ? "error" : got.error) : `${got.kind}:${got.number}`, want, JSON.stringify(input));
  }
  const sql = Deno.readTextFileSync(new URL("supabase/migrations/__tests__/issue_3980_synced_w1.implementor.happy.pg17.test.sql", ROOT));
  for (const [input, want] of CASES) {
    assert(sql.includes(`('${input}', '${want}')`), `the SQL suite checks ${JSON.stringify(input)} the same way`);
  }
  const migration = Deno.readTextFileSync(new URL("supabase/migrations/20271124003980_issue_3980_synced_w1_foundations.sql", ROOT));
  assert(migration.includes(GITHUB_LINK_WORDS), "the words are the server's own");
});

Deno.test("#3980 synced: chips, agent names with the chat, and the working mark words", () => {
  assertEquals(githubChipWords({ number: 3980, label: "In Progress" }), "#3980 · In Progress");
  assertEquals(githubChipWords({ number: 12 }), "#12 · Checking GitHub");
  assertEquals(agentName("Seth", "claude", "Hosts sweep"), "Seth's Claude (Hosts sweep)");
  assertEquals(agentName("Seth", "codex", null), "Seth's Codex");
  assertEquals(agentName("Seth", null, "Hosts sweep"), "Seth");
  const now = Date.parse("2026-10-21T12:00:00Z");
  assertEquals(workingWords({ name: "Seth's Claude (Hosts sweep)", last_update_at: "2026-10-21T10:00:00Z", quiet: false }, now),
    "Seth's Claude (Hosts sweep) is on it · last update 2 h ago");
  assertEquals(workingWords({ name: "Seth's Claude", last_update_at: "2026-10-19T12:00:00Z", quiet: true }, now),
    "Seth's Claude is on it · quiet for 2 days");
});

Deno.test("#3980 synced F6: people picker names never break letter by letter", () => {
  const picker = read("components/ops/PeoplePicker.jsx");
  assert(!/min-w-0 break-words/.test(picker), "the squeezed name classes are gone");
  // [TEST-MOD-APPROVED #3980] D8 (Wave 1 rework): a six-character floor let
  // a long one-word name shrink under the chip's remove button. Names now
  // never shrink below their longest word (min-content).
  assertEquals((picker.match(/min-w-min break-normal \[overflow-wrap:normal\]/g) ?? []).length, 2, "chip and option names keep their words");
  assertMatch(picker, /flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between/);
  assert(!/shrink-0 text-\[12px\][^"]*">\{p\.role_label\}/.test(picker), "the role label can drop under the name");
});

Deno.test("#3980 synced F3 and D-4: work cards link GitHub safely and show the working mark", () => {
  const detail = read("components/ops/WorkDetail.jsx");
  assertMatch(detail, /target="_blank" rel="noopener noreferrer"/);
  assertMatch(detail, /placeholder="#123 or a GitHub link"/);
  assertMatch(detail, /Clear working mark/);
  assertMatch(detail, /ops\.clearWorkingMark\(card\.id, reason\.trim\(\)\)/);
  assert(!/The claim ends at/.test(detail), "the 30-minute card claim line is gone");
  const add = read("components/ops/WorkAddForm.jsx");
  assertMatch(add, /out\.github = github\.map\(\(g\) => g\.input\)/);
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R8): the Agent log is the Agent activity tab on Work.
  const log = read("components/ops/AgentActivity.jsx");
  assertMatch(log, /title="Working right now"/);
  assertMatch(log, /agentName\(c\.holder_name, c\.holder_via, c\.holder_chat_label\)/);
  assertMatch(read("components/ops/LogRow.jsx"), /agentName\(entry\.actor_name, entry\.via, entry\.chat_label\)/);
});

Deno.test("#3980 synced F5: the owner sets names on Team and roles; the ops_ calls stay in opsService", () => {
  const page = read("pages/AdminPage.jsx");
  assertMatch(page, /Names show in every picker, in agent messages and in the agent log\. Without one, Mingla uses the first part of the email\./);
  assertMatch(page, /placeholder=\{profiles\[email\]\.fallback\}/);
  assertMatch(page, /placeholder="github username"/);
  assertMatch(page, /"Saving…"/);
  assertMatch(page, /"Saved"/);
  assert(page.includes('rpc("admin_team_list")'), "the roster call is untouched");
  const service = read("services/teamProfileService.js");
  assert(!/\.rpc\(/.test(service), "the profile service calls through opsService");
  const ops = read("services/opsService.js");
  assertMatch(ops, /supabase\.rpc\("ops_profiles_list"\)/);
  assertMatch(ops, /supabase\.rpc\("ops_profile_set", \{ p_teammate: email,/);
  for (const file of ["pages/AdminPage.jsx", "components/ops/WorkDetail.jsx", "components/ops/WorkAddForm.jsx", "pages/AgentLogPage.jsx", "components/ops/PeoplePicker.jsx"]) {
    assert(!/\bbg-white\b|\btext-black\b/.test(read(file)), `${file} uses theme tokens`);
  }
});
