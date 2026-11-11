// Issue #4255 (Work board v2, waves W2 and W3) — implementor tests for the
// Admin board and card panel.
//
//   V-1  columns: only admins see Add column, the column menu and the drag
//        handle; everyone else sees the columns read-only; names and the last
//        column of a group are checked before anything is sent
//   V-2  a drag calls ops_work_move with the card's revision; a Closed column
//        asks for proof first; nothing else writes
//   V-3  a conflict (PT409, stale_write) snaps the card back and says so
//   V-4  the header is ONE line: it never wraps; the filters fold under
//        1,150px and only the active tab shows under 640px
//   V-5  up to five sprint goals; the sprint bar shows each as a pill
//   V-6  subtasks go two levels deep: a sub-subtask takes none
//   V-7  files: checked before upload (25 MB, types); opened through a
//        5-minute signed link; links open as they are
//   V-8  a thread message with an attachment: the file is uploaded to the
//        card first, then the message is posted with its id and mentions
//   V-9  "Message to send" (CardDrafts) is gone from the card
//
// Run: node --test src/__tests__/issue4255_work_v2_board_card.implementor.test.js
// (from mingla-admin, after `npm ci`; the components are built with esbuild
// and Supabase is replaced by a recorder, so nothing leaves this machine).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FILE_MAX_BYTES,
  GOAL_LIMIT,
  MOVE_CONFLICT_WORDS,
  activeFilterCount,
  archiveTargets,
  canAddGoal,
  canChangeColumns,
  canHaveSubtasks,
  columnNameProblem,
  fileKind,
  fileProblem,
  headerFit,
  lastOfGroup,
  moveErrorWords,
  moveLocally,
  planMove,
  reorderIds,
  tickProof,
} from "../lib/workBoardModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(read(rel));

const COLS = [
  { id: "a4255000-0000-4000-8000-000000000001", name: "To do", color: "#8a847b", grp: "todo", position: 0, revision: 1 },
  { id: "a4255000-0000-4000-8000-000000000002", name: "In progress", color: "#2f6fd6", grp: "doing", position: 1, revision: 1 },
  { id: "a4255000-0000-4000-8000-000000000004", name: "Waiting on someone", color: "#c27a12", grp: "doing", position: 2, revision: 3 },
  { id: "a4255000-0000-4000-8000-000000000003", name: "Done", color: "#1f8a5b", grp: "done", position: 3, revision: 1 },
];
const [TODO, DOING, WAITING, DONE] = COLS;
const card = (n, col, extra = {}) => ({ id: `c${n}`, number: n, title: `Card ${n}`, status: col.grp, status_id: col.id, revision: 7, due_on: "2026-11-12", owners: [{ email: "seth@x.test", name: "Seth" }], ...extra });

let h;
before(async () => {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test"); }
  // Supabase is a recorder: every rpc and storage call is written to
  // globalThis.__calls and answered from globalThis.__answer.
  const fake = {
    name: "fake-supabase",
    setup(build) {
      build.onResolve({ filter: /lib\/supabase(\.js)?$/ }, () => ({ path: "fake-supabase", namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
        loader: "js",
        contents: `
const rec = (kind, args) => { (globalThis.__calls ||= []).push({ kind, ...args }); return Promise.resolve(globalThis.__answer ? globalThis.__answer(kind, args) : { data: null, error: null }); };
export const supabase = {
  rpc: (fn, params) => rec("rpc", { fn, params }),
  storage: { from: (bucket) => ({
    upload: (path, file, opts) => rec("upload", { bucket, path, opts }),
    createSignedUrl: (path, seconds) => rec("sign", { bucket, path, seconds }),
    createSignedUrls: (paths, seconds) => rec("signMany", { bucket, paths, seconds }),
  }) },
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
import { WorkBoard } from "../components/ops/WorkBoard.jsx";
import { WorkHeader } from "../components/ops/WorkHeader.jsx";
import { SprintBar } from "../components/ops/SprintBar.jsx";
import { CardSubtasks } from "../components/ops/CardSubtasks.jsx";
import * as ops from "../services/opsService.js";
export { ops };
export function board(props) { return renderToStaticMarkup(<WorkBoard onSelect={() => {}} onMoveCard={() => {}} columnActions={{ add() {}, rename() {}, recolour() {}, move() {}, archive() {} }} layout="desktop" today="2026-11-10" {...props} />); }
export function header(props) { return renderToStaticMarkup(<WorkHeader view="board" onView={() => {}} typed="" onTyped={() => {}} onSearch={() => {}} ownerOptions={[{ value: "", label: "Everyone" }]} owner={null} onOwner={() => {}} show="" onShow={() => {}} linked="" onLinked={() => {}} onClear={() => {}} filtersOn={false} showSubtasks={false} onToggleSubtasks={() => {}} onNewCard={() => {}} onCopyStandup={() => {}} {...props} />); }
export function bar(props) { return renderToStaticMarkup(<SprintBar onGoal={() => {}} onWeek={() => {}} onThisWeek={() => {}} onPlan={() => {}} today="2026-11-10" isThisWeek {...props} />); }
export function subtasks(props) { return renderToStaticMarkup(<CardSubtasks columns={[]} onOpenCard={() => {}} onChanged={() => {}} offerUndo={() => {}} onError={() => {}} {...props} />); }
`;
  const out = await esbuild.build({
    stdin: { contents, resolveDir: HERE, sourcefile: "issue4255.v2.harness.jsx", loader: "jsx" },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
    plugins: [fake],
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4255-v2-")), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  h = await import(pathToFileURL(file).href);
});

const reset = (answer = null) => { globalThis.__calls = []; globalThis.__answer = answer; };

describe("V-1 columns: admins change them, everyone else reads them", () => {
  const cards = [card(1, TODO), card(2, DOING)];
  it("an admin sees Add column, each column's menu and its drag handle", () => {
    const html = h.board({ columns: COLS, cards, canChange: true });
    assert.match(html, /data-add-column=""/);
    assert.equal((html.match(/data-popover-button="column:/g) || []).length, 4);
    assert.equal((html.match(/aria-label="Drag to move the [^"]+ column"/g) || []).length, 4);
    assert.equal((html.match(/data-column="/g) || []).length, 4, "every live column is a column, in order");
    assert.ok(html.indexOf(`data-column="${WAITING.id}"`) < html.indexOf(`data-column="${DONE.id}"`));
  });
  it("anyone else sees the same columns with no way to change them", () => {
    const html = h.board({ columns: COLS, cards, canChange: false });
    assert.doesNotMatch(html, /data-add-column=""|data-popover-button="column:|Drag to move the/);
    assert.equal((html.match(/data-column="/g) || []).length, 4);
  });
  it("the server's answer decides; an agent or a non-admin never gets the menu", () => {
    assert.equal(canChangeColumns({ can_change: false }, { me: { can_columns: true } }), false);
    assert.equal(canChangeColumns({ can_change: true }, null), true);
    assert.equal(canChangeColumns(null, { me: { can_columns: false } }), false);
    assert.equal(canChangeColumns(null, null), false);
  });
  it("a name is 1 to 30 characters and new to the board; the last column of a group cannot be archived", () => {
    assert.equal(columnNameProblem("  ", COLS), "Name the column in 1 to 30 characters.");
    assert.equal(columnNameProblem("x".repeat(31), COLS), "Name the column in 1 to 30 characters.");
    assert.equal(columnNameProblem("in progress", COLS), "A column called “in progress” is already on the board.");
    assert.equal(columnNameProblem("In progress", COLS, DOING.id), "", "renaming a column to its own name is fine");
    assert.equal(columnNameProblem("Review", COLS), "");
    assert.equal(lastOfGroup(TODO, COLS), true);
    assert.equal(lastOfGroup(DOING, COLS), false);
    assert.deepEqual(archiveTargets(DOING, COLS).map((c) => c.id), [WAITING.id], "cards move only to another column of the same group");
  });
  it("the page sends every column change with the column's revision", () => {
    const page = code("pages/WorkBoardPage.jsx");
    assert.match(page, /ops\.updateStatus\(col\.id, \{ name \}, col\.revision\)/);
    assert.match(page, /ops\.moveStatus\(col\.id, position, col\.revision\)/);
    assert.match(page, /ops\.archiveStatus\(archiving\.id, to, archiving\.revision\)/);
  });
});

describe("V-2 a drag calls ops_work_move with the card's revision", () => {
  it("a drop decides the column only: same column nothing, Closed asks for proof, others move", () => {
    const c = card(5, TODO);
    assert.equal(planMove(c, TODO).kind, "same");
    assert.equal(planMove(c, DOING).kind, "move");
    assert.equal(planMove(c, WAITING).kind, "move");
    assert.equal(planMove(c, DONE).kind, "close");
    assert.equal(planMove({ ...c, status: "done", status_id: DONE.id }, TODO).kind, "move", "out of Closed reopens on the server");
  });
  it("the move shows at once in the target column", () => {
    const list = moveLocally([card(5, TODO), card(6, TODO)], "c5", WAITING);
    assert.equal(list[0].status_id, WAITING.id);
    assert.equal(list[0].status, "doing");
    assert.equal(list[1].status_id, TODO.id);
  });
  it("ops_work_move gets the card id, the column, the card's revision and, into Closed, the proof", async () => {
    reset(() => ({ data: { card: {}, event_id: "e1", changed: true }, error: null }));
    await h.ops.moveWork("c5", WAITING.id, 7);
    await h.ops.moveWork("c5", DONE.id, 8, { proof: [{ kind: "text", text: "Posted both" }], result: "Live", closeChildren: true });
    assert.deepEqual(globalThis.__calls.map((c) => c.fn), ["ops_work_move", "ops_work_move"]);
    assert.deepEqual(globalThis.__calls[0].params, { p_id: "c5", p_status_id: WAITING.id, p_expected_revision: 7, p_proof: null, p_result: null, p_close_children: false });
    assert.deepEqual(globalThis.__calls[1].params, { p_id: "c5", p_status_id: DONE.id, p_expected_revision: 8, p_proof: [{ kind: "text", text: "Posted both" }], p_result: "Live", p_close_children: true });
  });
  it("the board page moves through planMove, and the close sheet sends the proof", () => {
    const page = code("pages/WorkBoardPage.jsx");
    assert.match(page, /const answer = await ops\.moveWork\(card\.id, to\.id, card\.revision, extra\);/);
    assert.match(page, /if \(what\.kind === "close"\) setClosing\(\{ card, column: to \}\);\s*else if \(what\.kind === "move"\) runMove\(card, to\);/);
    assert.match(page, /runMove\(closing\.card, closing\.column, \{ proof, result, closeChildren: children \}\)/);
    assert.match(page, /offerUndo\(answer, `Moved to \$\{to\.name\}`\)/);
  });
});

describe("V-3 a conflict snaps the card back and says so", () => {
  it("PT409 from the server reads as stale_write and the one sentence", async () => {
    reset(() => ({ data: null, error: { message: "stale_write: This card changed since you opened it. Reload it, then try again.", code: "PT409" } }));
    let caught = null;
    try { await h.ops.moveWork("c5", WAITING.id, 6); } catch (e) { caught = e; }
    assert.ok(caught, "the stale move throws");
    assert.equal(caught.token, "stale_write");
    assert.equal(moveErrorWords(caught, () => "other"), MOVE_CONFLICT_WORDS);
    assert.equal(MOVE_CONFLICT_WORDS, "Someone changed this card. It is back where it was.");
    assert.equal(moveErrorWords({ token: "forbidden" }, () => "other"), "other");
  });
  it("the page puts the board back as it was before the move, then reloads it", () => {
    const page = code("pages/WorkBoardPage.jsx");
    const body = page.slice(page.indexOf("const runMove = async"), page.indexOf("const onMoveCard"));
    assert.match(body, /const before = list\.data;/);
    assert.match(body, /catch \(error\) \{\s*list\.setData\(before\);/);
    assert.match(body, /if \(error\?\.token === "stale_write"\) addToast\(\{ variant: "warning", title: moveErrorWords\(error, opsErrorWords\) \}\);/);
    assert.match(body, /list\.refetch\(\{ quiet: true \}\);\s*return false;/);
  });
});

describe("V-4 the header is one line", () => {
  it("full width shows the three filter chips; nothing wraps", () => {
    const html = h.header({ fit: "full" });
    assert.match(html, /data-work-header="" data-fit="full" class="flex h-12 min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden"/);
    assert.doesNotMatch(html, /flex-wrap/);
    for (const f of ["owner", "show", "linked"]) assert.match(html, new RegExp(`data-filter-chip="${f}"`));
    assert.equal((html.match(/role="tab"/g) || []).length, 4);
    assert.match(html, /data-show-subtasks=""/);
    assert.match(html, /data-new-card=""/);
  });
  it("under 1,150px the chips fold into one Filters button; under 640px only the active tab shows", () => {
    const folded = h.header({ fit: "folded", owner: "ray@x.test", show: "overdue" });
    assert.doesNotMatch(folded, /data-filter-chip=/);
    assert.match(folded, /data-popover-button="filters"[^>]*>[\s\S]*?Filters · 2/);
    assert.equal((folded.match(/role="tab"/g) || []).length, 4);
    const compact = h.header({ fit: "compact" });
    assert.equal((compact.match(/role="tab"/g) || []).length, 0);
    assert.match(compact, /data-popover-button="views"[^>]*>[\s\S]*?Board/);
    assert.equal(headerFit(1440), "full");
    assert.equal(headerFit(1150), "full");
    assert.equal(headerFit(1149), "folded");
    assert.equal(headerFit(1024), "folded");
    assert.equal(headerFit(639), "compact");
    assert.equal(activeFilterCount({ owner: "a@b", show: "", linked: "host" }), 2);
  });
});

describe("V-5 sprint goals: five at most", () => {
  const goals = (n) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, title: `Goal ${i + 1}`, state: i === 1 ? "at_risk" : "on_track", cards: 4, done: i }));
  it("a sixth goal cannot be added", () => {
    assert.equal(GOAL_LIMIT, 5);
    assert.equal(canAddGoal(goals(4)), true);
    assert.equal(canAddGoal(goals(5)), false);
    assert.equal(canAddGoal([...goals(4), { id: "x", archived: true }]), true, "an archived goal does not count");
    const planner = code("components/ops/SprintPlanner.jsx");
    assert.match(planner, /\{canAddGoal\(goals\) \? \(/);
    assert.match(planner, /A sprint has at most five goals\. Archive one to add another\./);
  });
  it("the bar shows each goal as a pill that filters the board, and the numbers", () => {
    const html = h.bar({ sprint: { starts_on: "2026-11-09" }, plan: { goals: goals(5), in_sprint: [{ status: "done" }, { status: "todo" }], capacity: [{ planned_minutes: 600, hours: 8 }] }, goalId: "g1", late: 2 });
    assert.equal((html.match(/data-goal-pill="/g) || []).length, 5);
    assert.match(html, /data-goal-pill="g1" aria-pressed="true"/);
    assert.match(html, /data-goal-pill="g0" aria-pressed="false"/);
    assert.match(html, /1 of 2 done/);
    assert.match(html, /data-sprint-capacity=""[^>]*text-\[var\(--color-error-700\)\][^>]*>10 of 8 h planned/, "over capacity is red");
    assert.match(html, />2 late</);
    assert.match(html, /Day 2 of 7/);
    assert.match(html, /data-sprint-bar="" class="flex h-11 min-w-0 flex-nowrap/);
  });
});

describe("V-6 subtasks: two levels deep", () => {
  const parent = { id: "p1", number: 612, title: "Edit and post", status: "todo", depth: 0, revision: 4 };
  const subs = [{ id: "s1", title: "Find the footage", status: "done", status_id: DONE.id, revision: 2, owners: [], subtasks: { total: 0, done: 0 } }, { id: "s2", title: "Final edit", status: "doing", status_id: DOING.id, revision: 3, owners: [], subtasks: { total: 2, done: 1 } }];
  it("a card and a subtask take subtasks; a sub-subtask takes none", () => {
    assert.equal(canHaveSubtasks({ depth: 0 }), true);
    assert.equal(canHaveSubtasks({ depth: 1 }), true);
    assert.equal(canHaveSubtasks({ depth: 2 }), false);
    const top = h.subtasks({ card: parent, subtasks: subs });
    assert.match(top, /data-add-subtask=""/);
    assert.match(top, /1 of 2 done/);
    assert.match(top, /aria-label="Show the subtasks of Final edit"/, "a subtask with its own subtasks expands one level");
    const deepest = h.subtasks({ card: { ...parent, depth: 2 }, subtasks: [] });
    assert.equal(deepest, "", "a sub-subtask with none shows no Subtasks section");
    const deepWithRows = h.subtasks({ card: { ...parent, depth: 2 }, subtasks: subs });
    assert.doesNotMatch(deepWithRows, /data-add-subtask=""|Add a subtask and press Enter/);
    assert.match(deepWithRows, /Subtasks go two levels deep/);
    const level1 = h.subtasks({ card: { ...parent, depth: 1 }, subtasks: subs });
    assert.doesNotMatch(level1, /Show the subtasks of/, "a subtask's subtasks are the last level: no expander");
  });
  it("a reorder sends every id once; a tick closes with honest proof", () => {
    assert.deepEqual(reorderIds(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
    assert.deepEqual(reorderIds(["a", "b"], "x", "a"), ["a", "b"]);
    assert.deepEqual(tickProof("Seth"), [{ kind: "text", text: "Ticked done in the subtask list by Seth." }]);
    const src = code("components/ops/CardSubtasks.jsx");
    assert.match(src, /ops\.reorderSubtasks\(card\.id, ids, card\.revision\)/);
    assert.match(src, /ops\.moveWork\(sub\.id, doneColumn\?\.id, sub\.revision, \{ proof: tickProof\(myName\), closeChildren: true \}\)/);
  });
});

describe("V-7 files: checked first, opened through a signed link", () => {
  it("over 25 MB or an odd type is refused before anything is sent", () => {
    assert.equal(FILE_MAX_BYTES, 26214400);
    assert.equal(fileProblem({ name: "big.mov", type: "video/quicktime", size: 10 }).startsWith("big.mov is not a type a card takes."), true);
    assert.equal(fileProblem({ name: "cut.pdf", type: "application/pdf", size: FILE_MAX_BYTES + 1 }), "cut.pdf is over 25 MB. Share it as a link instead.");
    assert.equal(fileProblem({ name: "cut.pdf", type: "application/pdf", size: FILE_MAX_BYTES }), "");
    assert.equal(fileKind({ name: "IMG_1.HEIC", type: "" }), "image", "a type read from the name when the browser gives none");
    assert.equal(fileKind({ name: "deck.key", type: "" }), "document");
  });
  it("upload: the row first (it says where), then the bytes to exactly that path", async () => {
    reset((kind, args) => (kind === "rpc" && args.fn === "ops_file_add"
      ? { data: { file: { id: "f1", kind: "document" }, upload: { bucket: "ops-work-files", path: "p1/f1/cut.pdf" } }, error: null }
      : { data: { path: "p1/f1/cut.pdf" }, error: null }));
    const row = await h.ops.uploadCardFile("p1", { name: "cut.pdf", size: 1200 }, { kind: "document", mime: "application/pdf", key: "web_file_1" });
    assert.equal(row.id, "f1");
    assert.deepEqual(globalThis.__calls.map((c) => c.kind), ["rpc", "upload"]);
    assert.deepEqual(globalThis.__calls[0].params, { p_card_id: "p1", p_file: { kind: "document", name: "cut.pdf", mime: "application/pdf", size_bytes: 1200 }, p_request_key: "web_file_1" });
    assert.equal(globalThis.__calls[1].path, "p1/f1/cut.pdf");
    assert.equal(globalThis.__calls[1].opts.contentType, "application/pdf");
    assert.equal(globalThis.__calls[1].opts.upsert, false);
  });
  it("open: ops_file_sign, then a 5-minute signed link for that bucket and path; a link is its own address", async () => {
    reset((kind, args) => (kind === "rpc"
      ? { data: args.params.p_file_id === "f1" ? { kind: "document", bucket: "ops-work-files", path: "p1/f1/cut.pdf", expires_in: 300 } : { kind: "link", url: "https://drive.google.com/x" }, error: null }
      : { data: { signedUrl: "https://fake.test/signed/cut.pdf?token=t" }, error: null }));
    assert.equal(await h.ops.openableFileUrl("f1"), "https://fake.test/signed/cut.pdf?token=t");
    assert.deepEqual(globalThis.__calls[0], { kind: "rpc", fn: "ops_file_sign", params: { p_file_id: "f1" } });
    assert.deepEqual(globalThis.__calls[1], { kind: "sign", bucket: "ops-work-files", path: "p1/f1/cut.pdf", seconds: 300 });
    reset((kind) => (kind === "rpc" ? { data: { kind: "link", url: "https://drive.google.com/x" }, error: null } : { data: null, error: null }));
    assert.equal(await h.ops.openableFileUrl("f2"), "https://drive.google.com/x");
    assert.equal(globalThis.__calls.filter((c) => c.kind === "sign").length, 0, "a link is never signed");
  });
  it("a failed upload says so (it never passes as done)", async () => {
    reset((kind) => (kind === "rpc" ? { data: { file: { id: "f9" }, upload: { bucket: "ops-work-files", path: "p1/f9/x.pdf" } }, error: null } : { data: null, error: { message: "new row violates row-level security policy" } }));
    await assert.rejects(() => h.ops.uploadCardFile("p1", { name: "x.pdf", size: 5 }, { kind: "document", mime: "application/pdf" }), (e) => e.token === "upload_failed");
  });
});

describe("V-8 a thread message with an attachment", () => {
  it("the file goes onto the card first; the message carries its id, the mentions and @everyone", async () => {
    reset((kind, args) => {
      if (kind === "rpc" && args.fn === "ops_file_add") return { data: { file: { id: "f7", kind: "image" }, upload: { bucket: "ops-work-files", path: "p1/f7/cover.jpg" } }, error: null };
      if (kind === "rpc" && args.fn === "ops_message_post") return { data: { message: { id: "m1" }, told: 2 }, error: null };
      return { data: {}, error: null };
    });
    const f = await h.ops.uploadCardFile("p1", { name: "cover.jpg", size: 900 }, { kind: "image", mime: "image/jpeg", key: "k1" });
    const answer = await h.ops.postMessage("p1", { body: "Cover for @Ray", mentions: ["ray@x.test"], fileIds: [f.id], everyone: false, key: "web_msg_1" });
    assert.equal(answer.told, 2);
    assert.deepEqual(globalThis.__calls.map((c) => c.fn || c.kind), ["ops_file_add", "upload", "ops_message_post"]);
    assert.deepEqual(globalThis.__calls[2].params, { p_card_id: "p1", p_body: "Cover for @Ray", p_mentions: ["ray@x.test"], p_parent_message_id: null, p_file_ids: ["f7"], p_everyone: false, p_request_key: "web_msg_1" });
  });
  it("the composer uploads every attachment before posting and keeps the text when one fails", () => {
    const thread = code("components/ops/CardThread.jsx");
    const send = thread.slice(thread.indexOf("const send = async () => {"), thread.indexOf("return (", thread.indexOf("const send = async () => {")));
    assert.match(send, /const done = await Promise\.all\(tray\.map\(upload\)\);/);
    assert.match(send, /if \(done\.some\(\(d\) => !d\?\.id\)\) \{ setError\("A file didn’t upload\. Retry it, or remove it, then send\. Your message is kept\."\); return; \}/);
    // #4255 W4: the composer posts through its adapter (the card's posts with
    // ops.postMessage; a Mingla team chat reuses the same composer).
    assert.ok(send.indexOf("adapter.post(") > send.indexOf("Promise.all(tray.map(upload))"), "post only after every upload");
    assert.ok(send.indexOf("ref.current?.clear()") > send.indexOf("adapter.post("), "the text is cleared only after the post");
    assert.match(thread, /post: \(cardId, \{ body, emails, parentId, fileIds, everyone \}\) =>\s*ops\.postMessage\(cardId,/);
    assert.match(thread, /if \(next\.length > room\) addToast\(\{ variant: "error", title: "A message carries up to 10 files\." \}\);/);
  });
});

describe("V-9 Message to send is gone", () => {
  it("no card embeds the drafts screen any more", () => {
    assert.doesNotMatch(code("components/ops/CardPersonPanels.jsx"), /export function CardDrafts|DraftsPage/);
    const detail = code("components/ops/WorkDetail.jsx");
    assert.doesNotMatch(detail, /CardDrafts|Message to send|DraftsPage/);
    for (const dir of ["components/ops", "components/panels", "pages"]) {
      for (const f of fs.readdirSync(path.join(SRC, dir)).filter((x) => /\.jsx?$/.test(x))) {
        assert.doesNotMatch(code(`${dir}/${f}`), /<CardDrafts\b|"Message to send"/, `${dir}/${f}`);
      }
    }
  });
});
