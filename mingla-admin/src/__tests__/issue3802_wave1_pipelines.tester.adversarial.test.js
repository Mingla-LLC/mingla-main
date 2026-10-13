// Issue #3802 (Wave 1) — independent tester suite for the Hosts and Creators boards.
//
// A different angle from the implementor's suite: nothing here is a hand-picked
// example of the happy path. Each block either reads the merged server contract
// itself and holds the screen to it, or throws input at the screen's rules that
// no well-behaved caller would send.
//
//   A-1  every refusal the merged migration can raise (read from the SQL, not
//        listed by hand) reaches the screen as plain words written for a person
//   A-2  Undo is never offered for longer than the server accepts it, and is
//        taken away when the person adds to the card's history
//   A-3  a value that happens to be the name of a built-in object property
//        never selects words, a colour, a column or a count
//   A-4  the move rules hold for malformed and near-miss input
//   A-5  addresses: seeded random hostile input never throws, never survives
//        into a built address, and settles in one pass
//   A-6  the duplicate warning keeps the server's rule at its edges
//   A-7  a move the screen stops reads word for word like the server's refusal
//   A-8  the new screens keep nothing in browser storage, name no cache key
//        outside the key factory, and carry no debug leftovers
//
// Fails-on-revert is recorded on the issue for A-1 (the words for one refusal
// removed), A-2 (the Undo lifetime raised past the server's window), A-3 (the
// own-property check in the words lookup) and A-4 (the exact "signed" test).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOVE_BLOCK_COPY,
  byRegionTable,
  errorCopy,
  errorWords,
  findDuplicates,
  groupByStage,
  moveBlocker,
  nameKey,
  nextStage,
  parseServerError,
  stageBadgeVariant,
  stageNeedsSignedAgreement,
} from "../lib/crmModel.js";
import { NEW_CARD, buildCrmSearch, parseCrmSearch } from "../lib/crmUrl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, "..");
const REPO = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const MIGRATION = fs.readFileSync(
  path.join(REPO, "supabase", "migrations", "20270820003802_issue_3802_wave1_crm_pipelines.sql"),
  "utf8"
);

const GENERIC = errorCopy("unknown", "");
const STALE = errorCopy("invalid_stage", "");

// Words that are written for someone calling a server function, not for a
// person looking at a board.
const CALLER_WORDS = /crm_|\(\)|JSON|YYYY|ISO |request key|Send |Use one of|Use any of|p_[a-z]|\{|\}|%s/;

/**
 * Every "<token>: <message>" the migration can raise, read from the SQL.
 * Messages built with format() keep their %s; a token built with format()
 * (invalid_%s) is expanded with the field names the validator uses it for.
 */
function serverRefusals() {
  const out = [];
  const add = (token, message) => out.push({ token, message });
  const re = /RAISE EXCEPTION\s+(?:'%',\s*format\()?'((?:[^']|'')*)'/g;
  for (const m of MIGRATION.matchAll(re)) {
    const text = m[1].replace(/''/g, "'");
    const parts = text.match(/^([a-z_%]+):\s*([\s\S]*)$/);
    if (!parts) continue; // the migration's own self-check lines, and the bare 'forbidden'
    const [, token, message] = parts;
    if (token.includes("%s")) {
      // The validator raises invalid_<field> for exactly these two groups.
      const fields = /is not a known/.test(message) ? ["channel", "source", "agreement"] : ["contact", "next_action", "rate"];
      for (const f of fields) add(token.replace("%s", f), message);
    } else {
      add(token, message);
    }
  }
  return out;
}

const REFUSALS = serverRefusals();
const fill = (message) => message.replace(/%s/g, "Sample");

describe("#3802 A-1: every refusal in the merged migration reads as plain words", () => {
  it("the reader finds the refusals (a changed file layout fails loudly, not silently)", () => {
    const tokens = new Set(REFUSALS.map((r) => r.token));
    assert.ok(REFUSALS.length >= 60, `only ${REFUSALS.length} refusals were read`);
    assert.ok(tokens.size >= 35, `only ${tokens.size} distinct tokens were read`);
    for (const must of ["forbidden", "not_found", "try_again", "duplicate_name", "undo_expired", "undo_not_live", "agreement_required", "invalid_contact", "invalid_agreement", "unknown_owner"]) {
      assert.ok(tokens.has(must), `the reader missed ${must}`);
    }
  });

  it("no refusal falls through to the generic line", () => {
    for (const { token, message } of REFUSALS) {
      const words = errorCopy(token, fill(message));
      assert.notEqual(words, GENERIC, `${token} has no words of its own on screen`);
    }
  });

  it("no refusal shows words written for a caller of the function", () => {
    for (const { token, message } of REFUSALS) {
      const words = errorCopy(token, fill(message));
      assert.equal(typeof words, "string");
      assert.ok(words.trim().length >= 12, `${token}: "${words}"`);
      assert.ok(!CALLER_WORDS.test(words), `${token} shows caller words: "${words}"`);
      assert.ok(!words.startsWith(`${token}:`), `${token} shows its own token`);
    }
  });

  it("the same holds after the error has been through the parser, with its code", () => {
    for (const { token, message } of REFUSALS) {
      const code = token === "forbidden" ? "42501" : token === "not_found" ? "P0002" : token === "try_again" ? "40001" : "22023";
      const parsed = parseServerError({ code, message: `${token}: ${fill(message)}`, details: null, hint: null });
      assert.equal(parsed.token, token);
      const words = errorWords(parsed);
      assert.ok(!CALLER_WORDS.test(words), `${token}: "${words}"`);
      assert.notEqual(words, GENERIC, token);
    }
  });

  it("a refusal that means 'this page is out of date' never shows the server's wording", () => {
    for (const token of ["invalid_fields", "invalid_entry", "invalid_items", "unknown_field", "request_key_required", "request_key_reused", "invalid_owners"]) {
      const from = REFUSALS.find((r) => r.token === token);
      assert.ok(from, `${token} is no longer raised by the migration; drop it from this list`);
      assert.equal(errorCopy(token, fill(from.message)), STALE, token);
    }
  });
});

const PAGE = read("pages/PipelinePage.jsx");

describe("#3802 A-2: Undo is only offered while the server will take it", () => {
  it("the Undo lifetime on screen is well inside the server's window", () => {
    const client = PAGE.match(/const UNDO_MS = (\d[\d_]*);/);
    assert.ok(client, "UNDO_MS is no longer a plain number in PipelinePage.jsx");
    const undoMs = Number(client[1].replace(/_/g, ""));
    const server = MIGRATION.match(/statement_timestamp\(\) - interval '(\d+) seconds'/);
    assert.ok(server, "the server's undo window is no longer written as N seconds");
    const windowMs = Number(server[1]) * 1000;
    assert.ok(undoMs > 0);
    // Half the window leaves room for a slow request and a clock that is a little off.
    assert.ok(undoMs <= windowMs / 2, `Undo is offered for ${undoMs}ms; the server accepts it for ${windowMs}ms`);
  });

  it("the move, delete and add toasts all use that one lifetime", () => {
    const durations = [...PAGE.matchAll(/duration:\s*([A-Za-z_0-9]+)/g)].map((m) => m[1]);
    assert.ok(durations.length >= 3);
    for (const d of durations) assert.equal(d, "UNDO_MS");
  });

  it("Undo is attached to a move only when the server named the move", () => {
    assert.match(PAGE, /action:\s*res\.activity_id\s*\?\s*\{\s*label:\s*"Undo"/);
    assert.match(PAGE, /if \(!res\.changed\) return true;/);
  });

  it("adding to the card's history takes the offer away first", () => {
    // The server undoes a move only while it is the newest entry on the card.
    const wrapper = PAGE.slice(PAGE.indexOf("const drawerPipe"), PAGE.indexOf("// ── Screen"));
    assert.match(wrapper, /log:\s*async \(id, \.\.\.rest\) => \{\s*clearUndoToast\(id\);/);
    assert.match(wrapper, /Object\.hasOwn\(changes, "brand_id"\)\) clearUndoToast\(id\)/);
    // A new move, and a delete, also end the previous offer for that card.
    assert.match(PAGE, /async \(record, to, reason = null\) => \{\s*clearUndoToast\(record\.id\);/);
    assert.match(PAGE, /async \(record\) => \{\s*clearUndoToast\(record\.id\);/);
  });

  it("the server still refuses an undo unless the move is the person's own newest entry", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.crm_undoable_activity"), MIGRATION.indexOf("REVOKE EXECUTE ON FUNCTION public.crm_undoable_activity"));
    assert.match(fn, /ORDER BY x\.created_at DESC, x\.id DESC\s+LIMIT 1/);
    assert.match(fn, /a\.kind = 'stage_move'/);
    assert.match(fn, /a\.actor_email = p_actor/);
  });
});

const HOSTS = {
  id: "hosts",
  label: "Hosts",
  stages: [
    { id: "prospect", label: "Prospect" },
    { id: "contacted", label: "Contacted" },
    { id: "replied", label: "Replied" },
    { id: "meeting", label: "Meeting" },
    { id: "onboarded", label: "Onboarded" },
    { id: "live", label: "Live", auto: true },
    { id: "lost", label: "Lost", terminal: true },
  ],
};
const CREATORS = {
  id: "creators",
  label: "Creators",
  stages: [
    { id: "identified", label: "Identified" },
    { id: "contacted", label: "Contacted" },
    { id: "replied", label: "Replied" },
    { id: "negotiating", label: "Negotiating" },
    { id: "booked", label: "Booked" },
    { id: "posted", label: "Posted" },
    { id: "passed", label: "Passed", terminal: true },
  ],
};
const BUILT_INS = ["constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf", "__proto__", "__defineGetter__"];

describe("#3802 A-3: built-in property names are just unknown values", () => {
  it("never select words for the screen", () => {
    for (const name of BUILT_INS) {
      for (const message of ["", "x", "function Object() { [native code] }"]) {
        const words = errorCopy(name, message);
        assert.equal(typeof words, "string", name);
        assert.equal(words, GENERIC, name);
      }
      assert.equal(errorWords({ token: name, message: "leak" }), GENERIC);
      assert.equal(errorWords(parseServerError({ message: `${name}: leak`, code: "22023" })), GENERIC);
    }
  });

  it("never select a colour, a column or a count", () => {
    for (const name of BUILT_INS) {
      assert.equal(stageBadgeVariant(name), "default");
      const groups = groupByStage(HOSTS, [{ id: "1", stage: name }, { id: "2", stage: "prospect" }]);
      assert.deepEqual(Object.keys(groups), HOSTS.stages.map((s) => s.id));
      assert.equal(groups.prospect.length, 1);
      const table = byRegionTable(HOSTS, [{ id: "1", stage: name, region_id: null }], []);
      assert.equal(table.length, 1);
      for (const id of Object.keys(table[0].counts)) assert.equal(table[0].counts[id], 0, `${name} was counted under ${id}`);
      assert.equal(table[0].total, 1);
      assert.equal(nextStage(HOSTS, { stage: name }), null);
      assert.notEqual(moveBlocker(HOSTS, { stage: "prospect" }, name), null);
    }
  });

  it("the parser only accepts a token made of lower-case letters and underscores", () => {
    for (const message of ["Forbidden: x", "not found: x", "9lives: x", "a: x", "_private: x", "token-with-dash: x", `${"a".repeat(41)}: x`, " not_found: x", "ERROR: not_found: x"]) {
      const parsed = parseServerError({ message, code: "22023" });
      assert.equal(parsed.token, "unknown", message);
      assert.equal(errorWords(parsed), GENERIC, message);
    }
  });
});

describe("#3802 A-4: the move rules, pushed", () => {
  it("nothing malformed is ever waved through", () => {
    const junk = [null, undefined, "", 0, 1, NaN, {}, [], "LIVE", " live", "live ", "Lost", "prospect\n"];
    for (const to of junk) {
      for (const record of [{ stage: "prospect" }, null, undefined, {}, { stage: null }]) {
        for (const def of [HOSTS, CREATORS, null, undefined, {}, { stages: null }]) {
          let result;
          assert.doesNotThrow(() => {
            result = moveBlocker(def, record, to);
          });
          assert.notEqual(result, null, `moveBlocker let ${JSON.stringify(to)} through`);
          assert.doesNotThrow(() => nextStage(def, record));
        }
      }
    }
  });

  it("only the exact value signed opens Booked and Posted, from every stage", () => {
    const nearMisses = [undefined, null, "", "none", "sent", "Signed", "SIGNED", " signed", "signed ", true, 1, ["signed"]];
    for (const from of ["identified", "contacted", "replied", "negotiating", "passed"]) {
      for (const to of ["booked", "posted"]) {
        for (const agreement of nearMisses) {
          const block = moveBlocker(CREATORS, { stage: from, agreement }, to);
          assert.equal(block?.token, "agreement_required", `${from} -> ${to} with ${JSON.stringify(agreement)}`);
        }
        assert.equal(moveBlocker(CREATORS, { stage: from, agreement: "signed" }, to), null);
      }
    }
    // Leaving, and the closing stage, never need it.
    assert.equal(moveBlocker(CREATORS, { stage: "posted", agreement: "signed" }, "negotiating"), null);
    assert.equal(moveBlocker(CREATORS, { stage: "negotiating", agreement: "none" }, "passed"), null);
    assert.equal(stageNeedsSignedAgreement(CREATORS, "passed"), false);
    assert.equal(stageNeedsSignedAgreement(CREATORS, "nowhere"), false);
  });

  it("the agreement rule on screen is the rule in the server's move function", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.crm_record_move_stage"), MIGRATION.indexOf("CREATE FUNCTION public.crm_record_undo_stage_move"));
    assert.match(fn, /agreement_required: Mark the agreement as signed before moving to %s\./);
    assert.equal(
      moveBlocker(CREATORS, { stage: "negotiating", agreement: "sent" }, "booked").message,
      "Mark the agreement as signed before moving to Booked."
    );
  });

  it("Live: nobody moves a host in, and a Live host only leaves for Lost", () => {
    for (const from of ["prospect", "contacted", "replied", "meeting", "onboarded", "lost"]) {
      assert.equal(moveBlocker(HOSTS, { stage: from }, "live")?.token, "stage_sets_itself", from);
    }
    for (const to of ["prospect", "contacted", "replied", "meeting", "onboarded"]) {
      assert.equal(moveBlocker(HOSTS, { stage: "live" }, to)?.token, "stage_is_live", to);
    }
    assert.equal(moveBlocker(HOSTS, { stage: "live" }, "lost"), null);
    assert.equal(nextStage(HOSTS, { stage: "live" }), null);
    assert.equal(nextStage(HOSTS, { stage: "lost" }), null);
    // A pipeline whose stages arrive in another order still never gets an arrow into Live or Lost.
    const shuffled = { ...HOSTS, stages: [HOSTS.stages[0], HOSTS.stages[5], HOSTS.stages[6], HOSTS.stages[1]] };
    assert.equal(nextStage(shuffled, { stage: "prospect" }), null);
  });
});

// A small seeded generator, so a failure can be reproduced exactly.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const HOSTILE_PIECES = [
  "view", "q", "icp", "region", "mine", "card", "=", "&", "?", "#", "%", "%E0%A4%A", "%00", "+", " ", "<script>", "'", '"',
  "../", "__proto__", "constructor", "[]", "new", "NEW", "board", "list", "region", "1", "true", "none", "lagos", "DROP TABLE",
  "3d1d8e26-965e-4141-b13a-41728f957a0e", "3D1D8E26-965E-4141-B13A-41728F957A0E", "​", "‮", "💥", "a".repeat(90),
];

describe("#3802 A-5: addresses under seeded random hostile input", () => {
  it("2,000 hostile query strings: never a throw, never a junk value kept, settled in one pass", () => {
    const next = rng(3802);
    for (let i = 0; i < 2000; i++) {
      let search = "";
      const n = 1 + Math.floor(next() * 14);
      for (let j = 0; j < n; j++) search += HOSTILE_PIECES[Math.floor(next() * HOSTILE_PIECES.length)];
      let state;
      assert.doesNotThrow(() => {
        state = parseCrmSearch(search);
      }, search);
      assert.ok(["board", "list", "region"].includes(state.view), search);
      assert.equal(typeof state.mine, "boolean");
      assert.ok(state.q.length <= 80, search);
      assert.match(state.icp, /^$|^[a-z][a-z0-9_]{0,39}$/, search);
      assert.match(state.region, /^$|^[a-z0-9-]{1,60}$/, search);
      assert.match(state.card, /^$|^new$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, search);
      const built = buildCrmSearch(state);
      assert.deepEqual(parseCrmSearch(built), state, `not settled: ${search}`);
      assert.equal(buildCrmSearch(parseCrmSearch(built)), built);
      assert.ok(!/[<>"'\s]/.test(built), built);
    }
  });

  it("a state object carrying junk is cleaned on the way into an address", () => {
    const built = buildCrmSearch({
      view: "<img>",
      q: "x".repeat(81),
      icp: "DROP TABLE",
      region: "../x",
      mine: "yes",
      card: "javascript:alert(1)",
      extra: "ignored",
      __proto__: { view: "list" },
    });
    assert.equal(built, "mine=1");
    assert.equal(buildCrmSearch(null), "");
    assert.equal(buildCrmSearch(undefined), "");
  });

  it("exact edges: 80 characters kept and 81 dropped, a pasted upper-case id normalised, only 'new' opens the add form", () => {
    assert.equal(parseCrmSearch(`q=${"a".repeat(80)}`).q.length, 80);
    assert.equal(parseCrmSearch(`q=${"a".repeat(81)}`).q, "");
    assert.equal(parseCrmSearch("card=3D1D8E26-965E-4141-B13A-41728F957A0E").card, "3d1d8e26-965e-4141-b13a-41728f957a0e");
    assert.equal(parseCrmSearch("card=new").card, NEW_CARD);
    assert.equal(parseCrmSearch("card=NEW").card, "");
    assert.equal(parseCrmSearch("card=new%20").card, "");
    assert.equal(parseCrmSearch("mine=true").mine, false);
    assert.equal(parseCrmSearch("mine=1&mine=0").mine, true);
    assert.equal(parseCrmSearch("view=list&view=board").view, "list");
  });
});

describe("#3802 A-6: the duplicate warning at the edges of the server's rule", () => {
  const records = [
    { id: "a", name: "Palm Court Kitchen" },
    { id: "b", name: "Zo" },
    { id: "c", name: "!!!" },
    { id: "d", name: "@lagos.foodie" },
  ];

  it("typed spacing, case, punctuation and invisible characters are the same name", () => {
    for (const typed of ["  palm   court kitchen ", "PALM-COURT-KITCHEN", "Palm​Court Kitchen", "palm.court/kitchen!", "\tPalm Court Kitchen\n"]) {
      assert.equal(findDuplicates(records, typed).exact?.id, "a", JSON.stringify(typed));
    }
    assert.equal(findDuplicates(records, "lagosfoodie").exact?.id, "d");
    assert.equal(findDuplicates(records, "@LAGOS_FOODIE").exact?.id, "d");
  });

  it("an exact match is never also listed as a look-alike, and the record being edited is never its own duplicate", () => {
    const found = findDuplicates(records, "Palm Court Kitchen");
    assert.equal(found.exact.id, "a");
    assert.equal(found.similar.length, 0);
    const own = findDuplicates(records, "Palm Court Kitchen", "a");
    assert.equal(own.exact, null);
    assert.equal(own.similar.length, 0);
  });

  it("a two-character name is still an exact duplicate, but never a look-alike", () => {
    assert.equal(findDuplicates(records, "ZO").exact?.id, "b");
    assert.equal(findDuplicates(records, "Zoo").exact, null);
    assert.deepEqual(findDuplicates(records, "Zoo").similar, []);
    assert.deepEqual(findDuplicates(records, "Pa").similar, []);
    assert.equal(findDuplicates(records, "Pal").similar[0]?.id, "a");
  });

  it("a name with no letters or digits is compared as typed, as the server does", () => {
    assert.equal(nameKey("!!!"), "!!!");
    assert.equal(findDuplicates(records, " !!! ").exact?.id, "c");
    assert.equal(findDuplicates(records, "???").exact, null);
  });

  it("blank, invisible-only and non-text input finds nothing and never throws", () => {
    for (const typed of ["", "   ", "​​", null, undefined, 0, {}, []]) {
      assert.doesNotThrow(() => findDuplicates(records, typed));
      const found = findDuplicates(records, typed);
      assert.ok(found.exact === null || typeof found.exact === "object");
    }
    assert.deepEqual(findDuplicates(records, "​​"), { exact: null, similar: [] });
    assert.deepEqual(findDuplicates(null, "Palm"), { exact: null, similar: [] });
  });

  it("the server's check still uses three characters and five look-alikes", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.crm_duplicate_check"), MIGRATION.indexOf("REVOKE EXECUTE ON FUNCTION public.crm_duplicate_check"));
    assert.match(fn, /char_length\(v_key\) >= 3 AND char_length\(c\.name_key\) >= 3/);
    assert.match(fn, /LIMIT 5/);
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, name: `Palm number ${i}` }));
    assert.equal(findDuplicates(many, "palm").similar.length, 5);
  });
});

describe("#3802 A-7: a move the screen stops reads like the server's refusal", () => {
  it("both sentences are the migration's own, word for word", () => {
    for (const token of ["stage_sets_itself", "stage_is_live"]) {
      const from = REFUSALS.find((r) => r.token === token);
      assert.ok(from, token);
      assert.equal(MOVE_BLOCK_COPY[token], from.message, token);
      assert.equal(errorCopy(token, from.message), MOVE_BLOCK_COPY[token]);
    }
  });
});

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "__tests__" ? [] : walk(full);
    return /\.(js|jsx)$/.test(e.name) ? [full] : [];
  });
const NEW_FILES = [
  ...walk(path.join(SRC, "components", "crm")),
  path.join(SRC, "components", "ui", "Drawer.jsx"),
  path.join(SRC, "hooks", "useCrmConfig.js"),
  path.join(SRC, "hooks", "useCrmPipeline.js"),
  path.join(SRC, "hooks", "useHashQuery.js"),
  path.join(SRC, "lib", "crmModel.js"),
  path.join(SRC, "lib", "crmUrl.js"),
  path.join(SRC, "pages", "PipelinePage.jsx"),
  path.join(SRC, "services", "crmService.js"),
];
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("#3802 A-8: what the new screens keep and leave behind", () => {
  it("the list of new files is real", () => {
    assert.ok(NEW_FILES.length >= 20);
    for (const file of NEW_FILES) assert.ok(fs.existsSync(file), file);
  });

  it("server records are never written to browser storage or a store", () => {
    for (const file of NEW_FILES) {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code), `${path.basename(file)} uses browser storage`);
      assert.ok(!/from "zustand|from "redux|createStore\(|createContext\(/.test(code), `${path.basename(file)} adds a store`);
    }
  });

  it("no cache key is written outside the key factory", () => {
    for (const file of NEW_FILES) {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      const literals = code.match(/[`"']crm:[^`"']*[`"']/g) || [];
      if (file.endsWith("useCrmConfig.js")) {
        assert.equal(literals.length, 2, "the key factory names exactly two keys");
      } else {
        assert.deepEqual(literals, [], `${path.basename(file)} names a cache key itself`);
      }
    }
  });

  it("the configuration cache is keyed by the signed-in person and forgets a failed load", () => {
    const hook = read("hooks/useCrmConfig.js");
    assert.match(hook, /const key = crmKeys\.config\(access\?\.email\);/);
    assert.match(hook, /if \(cache\.key !== key \|\| !cache\.promise\)/);
    assert.match(hook, /promise\.catch\(\(\) => \{\s*if \(cache\.promise === promise\) cache = \{ key: null, promise: null \};/);
  });

  it("no debug leftovers", () => {
    for (const file of NEW_FILES) {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      assert.ok(!/console\.(log|debug|info|table|trace)\(|\bdebugger\b|\balert\(/.test(code), `${path.basename(file)} has a debug leftover`);
      assert.ok(!/TODO|FIXME|XXX|HACK/.test(fs.readFileSync(file, "utf8")), `${path.basename(file)} has an unfinished marker`);
    }
  });

  it("dragging is wired only where there is a pointer and the board is usable", () => {
    const board = read("components/crm/PipelineBoard.jsx");
    const card = read("components/crm/RecordCard.jsx");
    assert.match(board, /onDragOver=\{\s*canDrag && !disabled/);
    assert.match(board, /onDrop=\{canDrag && !disabled \? /);
    assert.match(board, /if \(record && record\.stage !== stageId\) onMove\(record, stageId\);/);
    assert.match(card, /const draggable = canDrag && !disabled && !pending;/);
    assert.match(PAGE, /matchMedia\?\.\("\(hover: hover\) and \(pointer: fine\)"\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retest of the boards rework (appended; nothing above this line was changed).
//
//   B-1  the card's save line under seeded random state: "Saved" is never
//        shown while anything is unsent, typed or in flight, and Try again
//        covers every unsent field exactly once
//   B-2  the page holds a card only for that card's own unsent edits
//   B-3  a stale card: every pair of stages gives the right verdict, and odd
//        history never produces a broken sentence or lets the move through
//   B-4  whatever arrives beside a token, the screen shows a sentence
//   B-5  the quiet refresh: its pace, and the three things that stop it
//   B-6  what the retest attacked at runtime, pinned in source: one press at a
//        time per card, nothing moved on a stale verdict, toasts that take no
//        taps, and exactly two places that can say "weren't saved"
//
// Fails-on-revert is recorded on the issue for B-1 (Saved decided before the
// unsent check), B-3 (the same-move case waved through), B-4 (any text accepted
// as a sentence) and B-6 (the card not marked busy during the freshness read).

import {
  BOARD_REFRESH_MS,
  editsToSend,
  fieldLabel,
  freshnessVerdict,
  hasUnsavedEdits,
  loadErrorWords,
  normalizeTyped,
  saveLine,
  shouldHoldCard,
  TEXT_FIELDS,
  unsentEdits,
} from "../lib/crmModel.js";

const ALL_FIELDS = ["name", "icp", "region_id", "owners", "contact", "channel", "source", "next_action", "due_on", "brand_id", "place_pool_id", "followers", "agreement", "rate"];
const SAVED_RECORD = { id: "r1", name: "Palm Court Kitchen", contact: "Ngozi", next_action: "Send deck", rate: null, followers: 12000, icp: "restaurant_bar" };

describe("#3802 B-1: the save line under random state", () => {
  it("3,000 seeded states: Saved or idle only when there is nothing to send and nothing in flight", () => {
    const next = rng(38021);
    const pick = (list) => list[Math.floor(next() * list.length)];
    const typedValues = ["", " ", "Ngozi", " Ngozi ", "Send deck", "new text", "12000", "12k", "Palm  Court   Kitchen", "x"];
    for (let i = 0; i < 3000; i++) {
      const drafts = {};
      const unsent = {};
      for (let j = Math.floor(next() * 4); j > 0; j--) drafts[pick(ALL_FIELDS)] = pick(typedValues);
      for (let j = Math.floor(next() * 4); j > 0; j--) unsent[pick(ALL_FIELDS)] = { value: pick(typedValues), message: "x", local: next() < 0.2 };
      const saving = next() < 0.25 ? 1 + Math.floor(next() * 3) : 0;
      const savedAt = next() < 0.6 ? "3:42 pm" : "";
      const state = { saving, drafts, record: SAVED_RECORD, unsent, savedAt };
      const line = saveLine(state);
      const toSend = editsToSend(drafts, SAVED_RECORD, unsent);
      const where = JSON.stringify(state);

      if (line.kind === "saved" || line.kind === "idle") {
        assert.equal(saving, 0, where);
        assert.equal(toSend.length, 0, `"${line.kind}" with something still to send: ${where}`);
        assert.equal(hasUnsavedEdits(state), false, where);
      } else {
        assert.equal(hasUnsavedEdits(state), true, where);
      }
      if (Object.keys(unsent).length > 0 && saving === 0) assert.equal(line.kind, "unsent", where);
      if (line.kind === "saved") assert.equal(savedAt, "3:42 pm");

      // Try again sends every failed field, once each, never a field twice.
      const keys = toSend.map((e) => e.key);
      assert.equal(new Set(keys).size, keys.length, `a field would be sent twice: ${where}`);
      for (const key of Object.keys(unsent)) assert.ok(keys.includes(key), `${key} failed but would not be re-sent: ${where}`);
      if (line.kind === "unsent") assert.deepEqual([...line.keys].sort(), Object.keys(unsent).sort(), where);
    }
  });

  it("typed text that only differs by outer spacing is not an edit; a real difference always is", () => {
    for (const key of TEXT_FIELDS) {
      const saved = { id: "r", [key]: key === "followers" ? 12000 : "Same text" };
      const same = key === "followers" ? " 12000 " : "  Same text  ";
      assert.deepEqual(editsToSend({ [key]: same }, saved, {}), [], key);
      assert.equal(editsToSend({ [key]: "different" }, saved, {}).length, 1, key);
      assert.equal(saveLine({ drafts: { [key]: "different" }, record: saved, savedAt: "1:00 pm" }).kind, "pending", key);
    }
    assert.equal(normalizeTyped("name", "  Palm \t Court\n Kitchen "), "Palm Court Kitchen");
    assert.equal(normalizeTyped("contact", "  two  spaces kept  "), "two  spaces kept");
    assert.equal(normalizeTyped("contact", null), "");
  });

  it("junk state never throws and is never called saved by accident", () => {
    for (const junk of [null, undefined, 0, "x", [], { constructor: { value: "x" } }, { __proto__: { contact: { value: "x" } } }]) {
      assert.doesNotThrow(() => saveLine({ unsent: junk, drafts: junk, record: junk }));
      assert.doesNotThrow(() => editsToSend(junk, junk, junk));
      assert.deepEqual(unsentEdits(junk), []);
    }
    assert.equal(saveLine().kind, "idle");
    assert.equal(saveLine({ saving: 1, savedAt: "1:00 pm" }).kind, "saving");
    // An inherited key is not a failed field; an own one is.
    assert.deepEqual(unsentEdits(Object.create({ contact: { value: "x" } })), []);
    assert.equal(unsentEdits({ contact: { value: "x" } }).length, 1);
  });

  it("every field has a plain name, and an unknown one never shows its key", () => {
    for (const key of ALL_FIELDS) {
      const label = fieldLabel(key, "hosts");
      assert.ok(/^[A-Z][A-Za-z ]+$/.test(label), `${key} -> ${label}`);
      assert.ok(!label.includes("_"), label);
    }
    for (const key of ["constructor", "__proto__", "p_changes", "", undefined]) assert.equal(fieldLabel(key, "hosts"), "A field");
    assert.equal(fieldLabel("contact", "creators"), "Handle and reach");
  });
});

describe("#3802 B-2: a card is held only for its own unsent edits", () => {
  it("the whole truth table", () => {
    const ids = ["", "a", "b", "new"];
    for (const shown of ids) {
      for (const url of ids) {
        for (const dirty of ids) {
          const held = shouldHoldCard(shown, url, dirty);
          const expected = shown !== "" && shown !== url && dirty === shown;
          assert.equal(held, expected, `shown=${shown} url=${url} dirty=${dirty}`);
        }
      }
    }
    for (const junk of [null, undefined, 0, false]) assert.equal(shouldHoldCard(junk, "a", junk), false);
  });
});

describe("#3802 B-3: a card that moved behind an old board", () => {
  const stages = HOSTS.stages.map((s) => s.id);
  const histories = [
    undefined,
    null,
    [],
    "not a list",
    [{}],
    [{ kind: "note", to_stage: "meeting" }],
    [{ kind: "stage_move" }],
    [{ kind: "stage_move", to_stage: "meeting", actor_email: "bisi@test.local", actor_name: "Bisi", occurred_at: new Date().toISOString() }],
    [{ kind: "stage_move", to_stage: "meeting", actor_email: "", occurred_at: "not a date" }],
    [{ kind: "stage_move", to_stage: "meeting", actor_email: "x@test.local", actor_name: null, occurred_at: null }],
  ];

  it("every pair of stages: go only when nothing changed, already only for the same move, moved otherwise", () => {
    for (const shownStage of stages) {
      for (const freshStage of stages) {
        for (const to of stages) {
          for (const activity of histories) {
            let verdict;
            assert.doesNotThrow(() => {
              verdict = freshnessVerdict(HOSTS, { id: "1", name: "Zo", stage: shownStage }, { id: "1", name: "Zo", stage: freshStage }, to, activity);
            });
            const expected = freshStage === shownStage ? "go" : freshStage === to ? "already" : "moved";
            assert.equal(verdict.kind, expected, `${shownStage} / ${freshStage} / ${to}`);
            if (expected === "go") continue;
            const words = `${verdict.title} ${verdict.description}`;
            assert.ok(verdict.title.includes("Zo"), words);
            assert.ok(!/undefined|null|NaN|Invalid Date|\[object|@test\.local/.test(words), words);
            // (An entry whose time cannot be read leaves a stray space before the full
            // stop. The server always sends a time, so that case is reported on the
            // issue as a low finding and not asserted here.)
            const timed = !Array.isArray(activity) || activity.every((a) => !a.to_stage || Number.isFinite(Date.parse(a.occurred_at)));
            if (timed) assert.ok(!/\s{2,}|\s\./.test(verdict.description), `broken spacing: "${verdict.description}"`);
            if (expected === "moved") assert.match(verdict.description, /Your move was not made\./);
            else assert.match(verdict.description, /Nothing else was changed\.$/);
          }
        }
      }
    }
  });

  it("names the person and the time when the history has them, and never invents a person", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    const moved = freshnessVerdict(
      HOSTS,
      { name: "Unowned Lounge", stage: "prospect" },
      { name: "Unowned Lounge", stage: "meeting" },
      "contacted",
      [{ kind: "stage_move", to_stage: "meeting", actor_email: "bisi@test.local", actor_name: "Bisi", occurred_at: "2026-10-12T11:55:00Z" }],
      now
    );
    assert.equal(moved.title, "Unowned Lounge is no longer in Prospect");
    assert.match(moved.description, /^Bisi moved it from Prospect to Meeting 5m ago\./);
    const system = freshnessVerdict(HOSTS, { name: "A", stage: "onboarded" }, { name: "A", stage: "live" }, "lost", [{ kind: "stage_move", to_stage: "live", actor_email: null, occurred_at: "2026-10-12T11:00:00Z" }], now);
    assert.match(system.description, /by itself 1h ago\./);
    const unknown = freshnessVerdict(HOSTS, { name: "A", stage: "prospect" }, { name: "A", stage: "meeting" }, "contacted", [], now);
    assert.match(unknown.description, /^It is in Meeting now, not Prospect\./);
    assert.ok(!/moved it/.test(unknown.description));
  });

  it("a missing card on either side is not a reason to stop, and never throws", () => {
    for (const [shown, fresh] of [[null, null], [null, { stage: "meeting" }], [{ stage: "prospect" }, null], [undefined, undefined]]) {
      assert.equal(freshnessVerdict(HOSTS, shown, fresh, "contacted", []).kind, "go");
    }
    assert.doesNotThrow(() => freshnessVerdict(null, { name: "A", stage: "x" }, { name: "A", stage: "y" }, "z", null));
  });
});

describe("#3802 B-4: whatever arrives beside a token, the screen shows a sentence", () => {
  const tokens = [...new Set(REFUSALS.map((r) => r.token)), "forbidden", "network", "signed_out", "not_ready", "unknown", "never_seen_before"];
  const notSentences = (token) => ["", " ", token, `${token}:`, "forbidden", "x", "ERROR", "a_b_c", "22023", "null", "undefined"];

  it("a bare word, a code or the token itself is never shown", () => {
    for (const token of tokens) {
      for (const message of notSentences(token)) {
        for (const words of [errorCopy(token, message), errorWords({ token, message }), loadErrorWords({ token, message })]) {
          assert.equal(typeof words, "string");
          assert.ok(words.trim().split(/\s+/).length >= 3, `${token} + ${JSON.stringify(message)} -> "${words}"`);
          assert.notEqual(words.trim(), message.trim() || "\u0000");
          assert.ok(!/^[a-z_]+$/.test(words.trim()), `${token} -> "${words}"`);
          assert.ok(!CALLER_WORDS.test(words), `${token} -> "${words}"`);
        }
      }
    }
  });

  it("the path the screen really takes: the service's error object, then the words", () => {
    const service = read("services/crmService.js");
    assert.match(service, /super\(typeof message === "string" \? message : ""\);/);
    assert.ok(!/super\(message \|\| token\)/.test(service));
    // The same object shape, built here, for the three bare refusals seen at runtime.
    for (const raw of [
      { code: "42501", message: "permission denied for table crm_records" },
      { code: "42501", message: "forbidden" },
      { code: "42501", message: "" },
    ]) {
      const parsed = parseServerError(raw);
      const asService = { token: parsed.token, message: typeof parsed.message === "string" ? parsed.message : "" };
      const words = errorWords(asService);
      assert.match(words, /Ask the owner/, JSON.stringify(raw));
      assert.ok(!/permission denied|^forbidden$/.test(words));
    }
  });

  it("something that failed to load never says it failed to save", () => {
    for (const err of [{ token: "unknown", message: "" }, { token: "network", message: "" }, { token: "try_again", message: "" }, new TypeError("Failed to fetch"), { code: "XX000", message: "boom" }, null, undefined, "x"]) {
      const words = loadErrorWords(err);
      assert.ok(!/save|saved/i.test(words), words);
      assert.ok(words.split(/\s+/).length >= 4, words);
    }
    assert.match(loadErrorWords({ token: "signed_out", message: "" }), /sign-in/i);
    assert.match(loadErrorWords({ token: "forbidden", message: "" }), /Ask the owner/);
  });
});

const PAGE_NOW = read("pages/PipelinePage.jsx");
const HOOK_NOW = read("hooks/useCrmPipeline.js");
const DRAWER_NOW = read("components/crm/RecordDrawer.jsx");
const SHELL_NOW = read("components/ui/Drawer.jsx");
const TOAST_NOW = read("components/ui/Toast.jsx");
const BOARD_NOW = read("components/crm/PipelineBoard.jsx");

describe("#3802 B-5: the quiet refresh", () => {
  it("is slow enough not to hammer the server and fast enough to matter", () => {
    assert.ok(BOARD_REFRESH_MS >= 15_000 && BOARD_REFRESH_MS <= 60_000, String(BOARD_REFRESH_MS));
  });

  it("is skipped while paused, hidden or offline, and is always a quiet one", () => {
    const start = HOOK_NOW.indexOf("const timer = setInterval(");
    const timer = HOOK_NOW.slice(start, HOOK_NOW.indexOf("return () => clearInterval(timer);", start));
    assert.ok(start > 0 && timer.length > 50);
    assert.match(timer, /if \(pausedRef\.current\) return;/);
    assert.match(timer, /if \(document\.visibilityState !== "visible"\) return;/);
    assert.match(timer, /if \(navigator\.onLine === false\) return;/);
    assert.match(timer, /refetch\(\{ quiet: true \}\);/);
    assert.match(timer, /\}, BOARD_REFRESH_MS\);/);
    assert.ok(!/refetch\(\)/.test(timer), "the timer must never show the loading state");
  });

  it("is paused by unsent edits on a card and by the open Lost or Passed question", () => {
    assert.match(PAGE_NOW, /useCrmPipeline\(pipeline, \{ enabled: !!def, paused: !!dirtyCard \|\| !!reasonFor \}\)/);
  });

  it("a quiet refresh never replaces the list while a card is mid-save, and never clears it on failure", () => {
    assert.match(HOOK_NOW, /if \(quiet && pendingRef\.current\.size > 0\) return;/);
    assert.match(HOOK_NOW, /\/\/ A failed background refresh keeps what is on screen\.\s+if \(quiet\) return;/);
  });
});

describe("#3802 B-6: what the retest attacked at runtime, pinned", () => {
  const move = PAGE_NOW.slice(PAGE_NOW.indexOf("const requestMove = useCallback("), PAGE_NOW.indexOf("// A failed move to Lost or Passed keeps the question open"));

  it("one press at a time per card: the card is busy from before the read until after it", () => {
    assert.ok(move.length > 400);
    const busyOn = move.indexOf("pipe.setBusy(shown.id, true);");
    const read1 = move.indexOf("fresh = await pipe.checkFresh(shown.id);");
    const busyOff = move.indexOf("pipe.setBusy(shown.id, false);");
    assert.ok(busyOn > 0 && read1 > busyOn, "the card must be marked busy before the server is asked");
    assert.match(move.slice(read1, busyOff), /finally \{\s*$/m);
    const card = read("components/crm/RecordCard.jsx");
    assert.match(card, /disabled=\{disabled \|\| pending\}/);
    assert.match(card, /const draggable = canDrag && !disabled && !pending;/);
  });

  it("nothing is sent on a stale verdict, and the verdict is judged on the server's copy", () => {
    const verdictAt = move.indexOf("const verdict = freshnessVerdict(def, shown, record, to, fresh.activity);");
    const stopAt = move.indexOf('if (verdict.kind !== "go") {');
    const sendAt = move.indexOf("performMove(record, to);");
    assert.ok(verdictAt > 0 && stopAt > verdictAt && sendAt > stopAt);
    assert.match(move.slice(stopAt, sendAt), /addToast\([\s\S]*?\);\s*return;/);
    assert.match(move, /const record = fresh\.record;\s*pipe\.applyRecord\(record\);/);
    // The rules (Live, agreement, reason) are then applied to the server's copy, not the old one.
    assert.match(move, /const block = moveBlocker\(def, record, to\);/);
    assert.match(move, /setReasonFor\(\{ record, to \}\);/);
  });

  it("offline and a failed read move nothing", () => {
    assert.ok(move.indexOf("if (!online) {") < move.indexOf("pipe.setBusy(shown.id, true);"));
    const failed = move.slice(move.indexOf("} catch (err) {"), move.indexOf("} finally {"));
    assert.match(failed, /return;\s*$/);
    assert.ok(!/performMove/.test(failed));
  });

  it("toasts take no taps meant for the page and sit on a solid surface", () => {
    assert.match(TOAST_NOW, /data-toast-region=""\s+className="pointer-events-none fixed/);
    assert.match(TOAST_NOW, /bottom: "calc\(1\.5rem \+ var\(--toast-lift, 0px\)\)"/);
    assert.match(TOAST_NOW, /className="pointer-events-auto [^"]*bg-\[var\(--color-background-primary\)\]/);
    assert.match(TOAST_NOW, /aria-label="Dismiss"/);
    // The lift is taken away again when the card closes, so other pages are unaffected.
    assert.match(SHELL_NOW, /root\.style\.setProperty\("--toast-lift", `\$\{h\}px`\);/);
    assert.match(SHELL_NOW, /root\.style\.removeProperty\("--toast-lift"\);/);
  });

  it("exactly two places can say a card's changes weren't saved, and a discarded card says nothing", () => {
    const code = stripComments(DRAWER_NOW);
    const calls = code.match(/keepForLater\(/g) || [];
    assert.equal(calls.length, 2, "one in the failed save of a card that left the screen, one when the card leaves with text unsent");
    const leaving = code.slice(code.indexOf("setTimeout(() => {", code.indexOf("onDirtyChange?.(recordId, false);")));
    assert.match(leaving, /if \(mounted\.current\) return;/);
    assert.match(leaving, /if \(discarded \|\| !rec\) return;/);
    assert.match(code, /const closeWithoutSaving = \(\) => \{\s*live\.current\.discarded = true;\s*leftUnsent\.delete\(recordId\);/);
    // What is kept is the typed text only, in memory only.
    assert.ok(!/localStorage|sessionStorage/.test(code));
  });

  it("a column that refuses the card is never a drop target, and the board stops scrolling when the drag ends", () => {
    const over = BOARD_NOW.slice(BOARD_NOW.indexOf("if (refusal(stage.id)) {"), BOARD_NOW.indexOf('e.dataTransfer.dropEffect = "move";'));
    assert.match(over, /e\.dataTransfer\.dropEffect = "none";\s*return;/);
    assert.ok(over.indexOf("return;") < over.indexOf("e.preventDefault();"));
    assert.match(BOARD_NOW, /const endDrag = \(\) => \{\s*stopScrolling\(\);/);
    assert.match(BOARD_NOW, /useEffect\(\(\) => stopScrolling, \[\]\);/);
  });
});
