// Issue #4571 W1 (people and goals) — implementor tests for Admin.
//
//   P-1  quickAddProblems: 1 to 10 owners, 1 to 10 watchers, nobody in both,
//        in the server's exact words (ops_people_check)
//   P-2  reviewRole: every watcher may confirm; the words say "any of"
//   P-3  the tile's people line and the board face's two faces and +N
//   P-4  the pickers are lists; removing the last owner or watcher is
//        refused with the design's words
//   P-5  reopen sends lists; "Waiting on any of: A, B"
//   G-1  goals: no cap, 3 to 120 characters, SprintBar folds after 3 pills
//   G-2  setSprintGoal, GOAL_LIMIT and the dead TeamOpsPanels are gone
//
// FAILS-ON-REVERT: on origin/main quickAddProblems refuses two owners,
// reviewRole sees only the first watcher, goalFold does not exist, GOAL_LIMIT
// is 5 and SprintBar draws every goal.
//
// Run: node --test src/__tests__/issue4571_w1_people_goals.implementor.test.js (after `npm ci`).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { quickAddProblems } from "../lib/opsModel.js";
import { andWords, closeFormWords, orWords, peopleLine, reviewRole, waitingOnWords } from "../lib/workReview.js";
import { waitingWords } from "../lib/dueLabel.js";
import * as model from "../lib/workBoardModel.js";
import { lastOwnerWords, lastWatcherWords, removePerson } from "../lib/peopleField.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const ADA = { email: "ada@x.test", name: "Ada" };
const TUNDE = { email: "tunde@x.test", name: "Tunde" };
const KEMI = { email: "kemi@x.test", name: "Kemi" };
const BO = { email: "bo@x.test", name: "Bo" };
const card = (extra = {}) => ({ id: "c1", number: 12, title: "Post the videos", status: "todo", revision: 3,
  owners: [ADA, TUNDE], watchers: [KEMI, BO], ...extra });
const TODAY = "2026-11-23";

let h;
before(async () => {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test"); }
  const fake = {
    name: "fake-supabase",
    setup(build) {
      build.onResolve({ filter: /lib\/supabase(\.js)?$/ }, () => ({ path: "fake-supabase", namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
        loader: "js",
        contents: `
const rec = (kind, args) => { (globalThis.__calls ||= []).push({ kind, ...args }); return Promise.resolve({ data: { ok: true }, error: null }); };
export const supabase = {
  rpc: (fn, params) => rec("rpc", { fn, params }),
  storage: { from: () => ({ upload: () => rec("upload", {}), createSignedUrl: () => rec("sign", {}), createSignedUrls: () => rec("signMany", {}) }) },
  auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
};
export const SUPABASE_URL = "https://fake.test"; export const SUPABASE_ANON_KEY = "fake";
export async function invokeWithRefresh() { return { data: null, error: null }; }
`,
      }));
    },
  };
  const contents = `
import { renderToStaticMarkup } from "react-dom/server";
import { BoardCardFace } from "../components/ops/WorkBoard.jsx";
import { SprintBar } from "../components/ops/SprintBar.jsx";
import * as ops from "../services/opsService.js";
export { ops };
export function face(card) { return renderToStaticMarkup(<BoardCardFace card={card} today="${TODAY}" />); }
export function bar(goals) { return renderToStaticMarkup(<SprintBar sprint={{ starts_on: "2026-11-23", goals }} today="${TODAY}" onGoal={() => {}} onWeek={() => {}} onThisWeek={() => {}} isThisWeek onPlan={() => {}} />); }
`;
  const out = await esbuild.build({
    stdin: { contents, resolveDir: HERE, sourcefile: "issue4571.harness.jsx", loader: "jsx" },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    plugins: [fake],
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4571-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

describe("P-1 quickAddProblems speaks the server's words", () => {
  const form = (extra) => ({ title: "Call the venue", owners: ["ada@x.test", "tunde@x.test"], watchers: ["kemi@x.test", "bo@x.test", "zed@x.test"], due: "2026-11-30", ...extra });
  const names = (e) => ({ "ada@x.test": "Ada" })[e] || e;
  it("2 owners and 3 watchers are fine", () => assert.deepEqual(quickAddProblems(form(), TODAY, names), []));
  it("no owner, no watcher, 11 of either", () => {
    assert.equal(quickAddProblems(form({ owners: [] }), TODAY)[0].message, "A card needs at least one owner.");
    assert.equal(quickAddProblems(form({ watchers: [] }), TODAY)[0].message, "A card needs at least one watcher, who is not an owner.");
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}@x.test`);
    assert.equal(quickAddProblems(form({ owners: eleven }), TODAY)[0].message, "A card has at most 10 owners.");
    assert.equal(quickAddProblems(form({ watchers: eleven }), TODAY)[0].message, "A card has at most 10 watchers.");
  });
  it("an owner named as a watcher is refused by name, never dropped", () => {
    const p = quickAddProblems(form({ watchers: ["ada@x.test", "kemi@x.test"] }), TODAY, names);
    assert.deepEqual(p, [{ field: "watchers", message: "Ada owns this card, so they cannot also watch it." }]);
  });
});

describe("P-2 any one watcher confirms", () => {
  it("each watcher is a watcher, each owner an owner", () => {
    for (const w of [KEMI, BO]) assert.equal(reviewRole(card({ review: { requested_by_name: "Ada" } }), w.email).canConfirm, true, w.name);
    for (const o of [ADA, TUNDE]) {
      const r = reviewRole(card({ review: {} }), o.email);
      assert.equal(r.isOwner, true); assert.equal(r.canConfirm, false);
      assert.equal(r.words, "You marked it done. Waiting on any of: Kemi, Bo to confirm. You cannot confirm your own card.");
    }
  });
  it("words for several people", () => {
    assert.equal(reviewRole(card(), ADA.email).words, "When you finish, press Mark done. It goes to Kemi or Bo to confirm.");
    assert.equal(reviewRole(card(), "nobody@x.test").words, "Ada and Tunde own this. Kemi or Bo confirms it.");
    assert.equal(closeFormWords(card(), TUNDE.email).line, "Sends it to Kemi or Bo to confirm.");
    assert.equal(closeFormWords(card(), BO.email).submit, "Close card");
    assert.equal(andWords(["A", "B", "C"]), "A, B and C");
    assert.equal(orWords(["A", "B"]), "A or B");
    assert.equal(waitingOnWords(["Kemi"]), "Waiting on Kemi");
  });
  it("Waiting on any of: Kemi, Bo (and the old single key still reads)", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    assert.equal(waitingWords({ review: { requested_at: "2026-11-23T10:00:00Z", waiting_on: "Kemi", waiting_on_all: ["Kemi", "Bo"] } }, now), "Waiting on any of: Kemi, Bo");
    assert.equal(waitingWords({ review: { requested_at: "2026-11-23T10:00:00Z", waiting_on: "Kemi" } }, now), "Waiting on Kemi");
  });
});

describe("P-3 the board tile shows everyone", () => {
  it("the people line", () => {
    assert.equal(peopleLine(card()), "Ada and Tunde own · Kemi, Bo watch");
    assert.equal(peopleLine(card({ owners: [ADA, TUNDE, KEMI, { email: "z@x.test", name: "Zed" }], watchers: [BO] })), "Ada, Tunde and 2 more own · Bo watches");
    assert.equal(peopleLine(card({ owners: [ADA], watchers: [BO] })), "Ada owns · Bo watches");
    assert.equal(peopleLine(card({ owners: [], watchers: [] })), "—");
  });
  it("two faces, then +N", () => {
    const html = h.face(card({ owners: [ADA, TUNDE, KEMI], watchers: [BO] }));
    assert.match(html, /data-owners-more=""[^>]*>\+1</);
    assert.match(html, /Ada, Tunde and 1 more own · Bo watches/);
    assert.doesNotMatch(h.face(card()), /data-owners-more/);
  });
});

describe("P-4 pickers are lists, the last person stays", () => {
  it("removing the last owner or watcher is refused with the design's words", () => {
    assert.equal(removePerson(["ada@x.test"], "ada@x.test", 1, lastOwnerWords(ADA)).refused,
      "Ada is the last owner. A card needs at least one, so add someone else first.");
    assert.equal(lastWatcherWords(KEMI), "Kemi is the last watcher. Someone has to confirm the work, so add another watcher first.");
    assert.deepEqual(removePerson(["ada@x.test", "tunde@x.test"], "ada@x.test", 1, "x").value, ["tunde@x.test"]);
  });
  it("no owner or watcher picker is single any more", () => {
    for (const f of ["components/ops/WorkDetail.jsx", "components/ops/WorkAddForm.jsx", "components/ops/TicketForm.jsx", "components/crm/HostToDoSection.jsx"]) {
      const src = read(f);
      for (const m of src.matchAll(/<PeopleField[^>]*label="(Owners?|Watch(er|ing))"[^>]*>/g)) assert.doesNotMatch(m[0], /\bsingle\b/, `${f}: ${m[1]}`);
      assert.doesNotMatch(src, /label="Watcher"/, f);
    }
    assert.match(read("components/crm/HostToDoSection.jsx"), /owners: \(owners \|\| \[\]\)\.slice\(0, 10\)/);
  });
});

describe("P-5 reopen sends lists", () => {
  it("ops_work_reopen gets p_owners and p_watchers", async () => {
    globalThis.__calls = [];
    await h.ops.reopenWork("c1", null, 4, { owners: ["ada@x.test", "tunde@x.test"], watchers: ["kemi@x.test"] });
    const c = globalThis.__calls.at(-1);
    assert.equal(c.fn, "ops_work_reopen");
    assert.deepEqual(c.params, { p_id: "c1", p_reason: null, p_expected_revision: 4, p_owners: ["ada@x.test", "tunde@x.test"], p_watchers: ["kemi@x.test"] });
    globalThis.__calls = [];
    await h.ops.reopenWork("c1", null, 4);
    assert.deepEqual(Object.keys(globalThis.__calls.at(-1).params).sort(), ["p_expected_revision", "p_id", "p_reason"]);
  });
});

describe("G-1 sprint goals", () => {
  const goals = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, title: `Goal ${i + 1}`, state: "on_track", cards: 2, done: 1 }));
  it("no cap; 3 to 120 characters", () => {
    assert.equal(model.canAddGoal(goals), true);
    assert.equal(model.goalTitleProblem("x".repeat(120)), "");
    assert.equal(model.goalTitleProblem("x".repeat(121)), "Say the goal in 3 to 120 characters.");
    assert.equal(model.goalTitleProblem("ab"), "Say the goal in 3 to 120 characters.");
  });
  it("SprintBar shows 3 pills then +4 more", () => {
    const html = h.bar(goals);
    assert.equal((html.match(/data-goal-pill=/g) || []).length, 3);
    assert.match(html, /data-goals-more=""[^>]*>\+4 more/);
    assert.doesNotMatch(h.bar(goals.slice(0, 3)), /data-goals-more/);
  });
  it("a goal is added with its note", async () => {
    globalThis.__calls = [];
    await h.ops.addSprintGoal("s1", "Ship the host card", null, "By Friday");
    assert.deepEqual(globalThis.__calls.at(-1).params, { p_sprint_id: "s1", p_title: "Ship the host card", p_owner_email: null, p_note: "By Friday" });
  });
});

describe("G-2 the dead single goal is gone", () => {
  it("no GOAL_LIMIT, no setSprintGoal, no TeamOpsPanels/SprintPanel", () => {
    assert.equal("GOAL_LIMIT" in model, false);
    assert.equal("setSprintGoal" in h.ops, false);
    const panels = read("components/ops/TeamOpsPanels.jsx");
    assert.doesNotMatch(panels, /function SprintPanel|export function TeamOpsPanels/);
    assert.match(panels, /export function RunwayPanel/);
    assert.doesNotMatch(read("services/opsService.js"), /ops_sprint_set_goal/);
  });
});
