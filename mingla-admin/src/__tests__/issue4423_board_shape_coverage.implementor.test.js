// Issue #4423 (W2.2, W2.7) — board-shape coverage.
//
// The Work list views now read ops_work_list with `shape: "board"` (a light
// card without drawer-only fields). This static test reads every admin file
// that renders, filters or moves those cards and checks:
//   1. every card field they read is in BOARD_FIELDS (the shape the server
//      must send), and
//   2. every BOARD_FIELDS entry is read by at least one of them.
// The card drawer is not here: it reads the full card through ops_work_get.
//
// The spec's starting list carried eight fields none of these files read
// (OPTIONAL_CARRIED); the server may keep or drop them. It was missing four
// the board does read (links, anchor, instructions, proof): those are
// required, with the minimum sub-shape pinned below.
//
// FAILS-ON-REVERT: read a drawer-only field on a board card (for example
// `card.done_means` in components/ops/WorkBoard.jsx) and check 1 goes red;
// drop `links` from BOARD_FIELDS and check 1 goes red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

export const BOARD_FIELDS = [
  "id", "number", "title", "status", "status_id", "blocked", "tag", "person_reason", "auto", "auto_kind",
  "due_on", "overdue", "owners", "watchers", "parent", "depth", "position", "estimate_minutes", "subtasks",
  "files_count", "thread_count", "goal", "working", "review", "sent_back", "release_items", "closed_at",
  "revision", "archived",
  // read by the board's filters and draft split (lib/workViews.js), not in the spec's first list
  "links", "anchor", "instructions", "proof",
];

// In the spec's list, read by none of the board files. The server may send them.
export const OPTIONAL_CARRIED = ["column", "blocked_kind", "sprint", "carried_count", "start_on", "claim", "in_backlog", "updated_at"];

// Whole files whose card-ish variables are board cards.
const FILES = [
  "components/ops/WorkBoard.jsx",
  "components/ops/BoardDialogs.jsx",
  "pages/WorkBoardPage.jsx",
  "components/ops/MyCardsPanels.jsx",
  "components/ops/WorkViews.jsx",
  "lib/workBoardModel.js",
  "components/ops/workToday.js",
  "lib/dueLabel.js",
  "lib/workViews.js",
  "lib/teamPulse.js",
  "pages/TeamDashboardPage.jsx",
];
// Named functions (in files that also hold drawer helpers) the board calls.
const FUNCTIONS = {
  "lib/opsModel.js": ["isTagged", "personReasonLabel", "dueOrder", "sortColumn", "cardReasons", "readPersonAsTodo"],
  "components/ops/TeamSettingsPanels.jsx": ["CardSearch"],
};
// The variable names these files give a card.
const CARD_VAR = /\b(card|c|cd|top|sub|parent|a|b|x)\??\.([a-z_][a-z_0-9]*)/g;
// Reads on those names that are not card fields, each with its reason.
const NOT_CARD_FIELDS = new Map([
  ["__ghost", "WorkBoard.jsx: the drag placeholder the client adds to a column list"],
  ["data", "WorkBoard.jsx: dnd-kit draggable/droppable `c.data` / `a.data`"],
  ["left", "WorkBoard.jsx: DOMRect of a column while dragging"],
  ["grp", "columns (`c.grp`), not cards"],
  ["name", "columns and people (`c.name`, `a.name`)"],
  ["email", "people sort (`a.email`)"],
  ["done", "subtaskProgress() result (`sub.done`)"],
  ["total", "subtaskProgress() result (`sub.total`)"],
  ["get", "Map#get (`x.get`)"],
  ["key", "period buckets in WorkViews (`b.key`)"],
  ["label", "period buckets and pulse rows (`b.label`)"],
]);

function functionBody(src, name) {
  const i = src.search(new RegExp(`function ${name}\\b`));
  assert.ok(i >= 0, `function ${name} not found`);
  let depth = 0;
  const start = src.indexOf("{", src.indexOf(")", i));
  for (let j = start; j < src.length; j += 1) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") { depth -= 1; if (!depth) return src.slice(i, j + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function reads() {
  const out = new Map(); // field -> Set(where)
  const add = (where, code) => {
    for (const m of strip(code).matchAll(CARD_VAR)) {
      if (!out.has(m[2])) out.set(m[2], new Set());
      out.get(m[2]).add(where);
    }
  };
  for (const f of FILES) add(f, read(f));
  for (const [f, names] of Object.entries(FUNCTIONS)) for (const n of names) add(`${f}#${n}`, functionBody(read(f), n));
  return out;
}

describe("#4423 board-shape coverage (W2.7)", () => {
  const found = reads();

  it("every NOT_CARD_FIELDS entry is actually hit (no dead excuses that could hide a real read)", () => {
    const dead = [...NOT_CARD_FIELDS.keys()].filter((f) => !found.has(f));
    assert.deepEqual(dead, []);
  });

  it("every card field the board reads is in the board shape", () => {
    const missing = [];
    for (const [field, where] of found) {
      if (NOT_CARD_FIELDS.has(field) || BOARD_FIELDS.includes(field)) continue;
      missing.push(`${field} (${[...where].join(", ")})`);
    }
    assert.deepEqual(missing, [], "add these to the board shape, or explain them in NOT_CARD_FIELDS");
  });

  it("every board-shape field is read by the board (the shape carries nothing unread)", () => {
    const unread = BOARD_FIELDS.filter((f) => !found.has(f));
    assert.deepEqual(unread, []);
  });

  it("the fields left out of the spec's list are really unread, so the server may drop them", () => {
    for (const f of OPTIONAL_CARRIED) assert.equal(found.has(f), false, f);
  });

  it("the spec's drawer-only fields stay out (except the four the board reads)", () => {
    for (const f of ["done_means", "description", "result", "plan", "github", "close_reason", "override", "files_url"]) {
      assert.equal(BOARD_FIELDS.includes(f), false, f);
      assert.equal(found.has(f), false, `${f} is read by a board file`);
    }
  });

  it("minimum sub-shapes the board needs: links [{kind, id}], proof [{kind, id}], anchor {kind}, full instructions", () => {
    const views = strip(read("lib/workViews.js"));
    // links: the linked filter reads l.kind; the draft split reads kind and id
    assert.match(views, /\(Array\.isArray\(card\?\.links\) \? card\.links : \[\]\)\.map\(\(l\) => l\?\.kind\)/);
    assert.match(views, /\.filter\(\(l\) => l && \(l\.kind === "host" \|\| l\.kind === "creator"\) && typeof l\.id === "string"\)/);
    // anchor: kind event / expected
    assert.match(views, /card\?\.anchor\?\.kind === "event" \|\| card\?\.anchor\?\.kind === "expected"/);
    // proof: draft entries by kind and id
    assert.match(views, /\(Array\.isArray\(card\.proof\) \? card\.proof : \[\]\)\.filter\(\(p\) => p\?\.kind === "draft"\)\.map\(\(p\) => String\(p\.id\)\)/);
    // instructions: the client re-filters the server's q results on title + instructions
    assert.match(views, /const hay = `\$\{c\.title \|\| ""\} \$\{c\.instructions \|\| ""\}`\.toLowerCase\(\);/);
  });

  it("the list views ask for shape:board; the drawer and agents do not", () => {
    const svc = read("services/opsService.js");
    assert.match(svc, /export const BOARD_SHAPE = "board";/);
    assert.match(svc, /return await listWork\(\{ \.\.\.query, shape: BOARD_SHAPE \}\);/);
    const callers = {
      "hooks/useOpsWork.js": 3,
      "components/ops/workToday.js": 3,
      "pages/TeamDashboardPage.jsx": 1,
      "components/ops/TeamSettingsPanels.jsx": 1,
    };
    for (const [file, n] of Object.entries(callers)) {
      const code = strip(read(file));
      assert.equal((code.match(/ops\.listBoardWork\b/g) || []).length, n, file);
      assert.equal(/ops\.listWork\(/.test(code), false, `${file} still reads the full list`);
    }
    // the drawer reads one full card
    assert.match(read("hooks/useOpsCard.js"), /getWork\(/);
  });
});

describe("#4423 listBoardWork: [TRANSITIONAL] fallback before the W2 migration", () => {
  it("an old server's invalid_query naming shape is recognised; other errors are not", async () => {
    // opsService imports lib/supabase (Vite env); test the pure predicate from its source.
    const svc = read("services/opsService.js");
    const body = svc.slice(svc.indexOf("export function refusesShape"), svc.indexOf("export const listBoardWork"));
    const refusesShape = new Function(`${body.replace("export function", "return function")}`)();
    assert.equal(refusesShape({ token: "invalid_query", message: 'The board cannot filter by "shape". It takes status, who, …' }), true);
    assert.equal(refusesShape({ token: "invalid_query", message: 'The board cannot filter by "per_status".' }), false);
    assert.equal(refusesShape({ token: "network", message: "" }), false);
    assert.equal(refusesShape(null), false);
    assert.match(svc, /\[TRANSITIONAL\] A server without 20280704014423/);
  });
});
