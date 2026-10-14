// Issue #3802 (follow-up to Wave 4, second part) — the normal form of a
// YouTube video link and of an Argentine or Mexican mobile number, on the
// page and on the server.
//
//   F-1  the table of examples the database suite asserts against the
//        server's crm_ident_key() is asserted here against the page's own
//        identKey(): a video id keeps its case in both link forms, every
//        other profile handle is lower-cased, the mobile digit after +54 and
//        +52 is dropped only when ten digits follow it
//   F-2  the pairs of phone numbers both sides match the same way
//   F-3  the follow-up migration's function is written the way this one is
//   F-4  the page: adding the same video or number twice is refused, and
//        search finds a record by either way of writing it
//   F-5  the Add form says a record's contact rule once: an exact name match
//        on a Do-not-contact record is one sentence with one Open it
//
// Run: node --test src/__tests__/normal_form_followup_issue3802.implementor.happy.test.js
// (from mingla-admin). Hermetic: no network, no browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addFormRuleNote, addIdentifier, contactHit, filterRecords, findDuplicates, identKey, phoneMatch } from "../lib/crmModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const REPO = path.resolve(SRC, "..", "..");
const SUITE = fs.readFileSync(
  path.join(REPO, "supabase", "migrations", "__tests__", "issue_3802_normal_form_followup.implementor.happy.pg17.test.sql"),
  "utf8"
);
const MIG = fs.readFileSync(path.join(REPO, "supabase", "migrations", "20271015003802_issue_3802_normal_form_followup.sql"), "utf8");
const LIB = fs.readFileSync(path.join(SRC, "lib", "crmModel.js"), "utf8");

const formsBlock = SUITE.slice(SUITE.indexOf("insert into t3802c_forms values"), SUITE.indexOf("create temp table t3802c_phones"));
const rows = [...formsBlock.matchAll(/^\s*\('(email|phone|handle)', '((?:[^']|'')*)', '((?:[^']|'')*)'\)[,;]$/gm)].map((m) => ({
  kind: m[1],
  value: m[2].replace(/''/g, "'"),
  want: m[3].replace(/''/g, "'"),
}));
const pairs = [
  ...SUITE.slice(SUITE.indexOf("insert into t3802c_phones values"), SUITE.indexOf("do $n2$")).matchAll(
    /^\s*\('([^']*)', '([^']*)', '(exact|national_number|none)'\)[,;]$/gm
  ),
].map((m) => ({ a: m[1], b: m[2], want: m[3] }));

describe("#3802 F-1: one normal form for a video link and a mobile number, on the server and on the page", () => {
  it("the shared table was read: every row of it", () => {
    const written = formsBlock.split("\n").filter((line) => /^\s*\('(email|phone|handle)',/.test(line)).length;
    assert.equal(rows.length, written, `read ${rows.length} of ${written} rows`);
    assert.ok(rows.length >= 45, `only ${rows.length} rows were read`);
    assert.ok(rows.filter((r) => r.kind === "phone").length >= 20);
    assert.ok(rows.filter((r) => r.kind === "handle").length >= 20);
    // The rows that carry the two corrections, and the ones that must not change.
    for (const [kind, value, want] of [
      ["phone", "+54 9 11 1234 5678", "+541112345678"],
      ["phone", "+52 1 55 1234 5678", "+525512345678"],
      ["phone", "+54 9 11 1234 567", "+549111234567"],
      ["phone", "+55 9 11 1234 5678", "+5591112345678"],
      ["handle", "https://youtu.be/dQw4w9WgXcQ", "youtube.com/watch?v=dQw4w9WgXcQ"],
      ["handle", "https://www.youtube.com/watch?v=DQW4W9WGXCQ", "youtube.com/watch?v=DQW4W9WGXCQ"],
      ["handle", "https://www.youtube.com/@AliceCooks", "alicecooks"],
    ]) {
      assert.ok(rows.some((r) => r.kind === kind && r.value === value && r.want === want), `${kind} ${value}`);
    }
  });
  it("every row gives the same key here as on the server", () => {
    for (const r of rows) assert.equal(identKey(r.kind, r.value) ?? "-", r.want, `${r.kind}: "${r.value}"`);
  });
  it("one video written either way is one key; ids that differ only in case are two", () => {
    const long = identKey("handle", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(identKey("handle", "https://youtu.be/dQw4w9WgXcQ"), long);
    assert.notEqual(identKey("handle", "https://youtu.be/dqw4w9wgxcq"), long);
    assert.notEqual(identKey("handle", "https://www.youtube.com/watch?v=DQW4W9WGXCQ"), long);
    // Every other profile handle stays the same whatever its case.
    assert.equal(identKey("handle", "https://www.YouTube.com/@AliceCooks"), identKey("handle", "youtube.com/@alicecooks"));
    assert.equal(identKey("handle", "https://Instagram.com/Palm.Court"), identKey("handle", "instagram.com/palm.court"));
  });
});

describe("#3802 F-2: two phone numbers match here the way they match on the server", () => {
  it("every pair, asked both ways round", () => {
    assert.equal(pairs.length, 13);
    for (const p of pairs) {
      assert.equal(phoneMatch(p.a, p.b) || "none", p.want, `${p.a} ~ ${p.b}`);
      assert.equal(phoneMatch(p.b, p.a) || "none", p.want, `${p.b} ~ ${p.a}`);
    }
  });
});

describe("#3802 F-3: the follow-up migration's function is written the way this one is", () => {
  const fn = /CREATE OR REPLACE FUNCTION public\.crm_ident_key\([\s\S]*?\n\$\$;/.exec(MIG)[0];
  const list = (text) => [...text.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  it("the same lists, in the same order", () => {
    for (const [sqlName, jsName] of [["c_sites", "IDENT_SITES"], ["c_links", "IDENT_LINKS"], ["c_never", "IDENT_NEVER"], ["c_ends", "IDENT_ENDS"], ["c_lead", "IDENT_LEAD"], ["c_cc2", "PHONE_CC2"]]) {
      const fromSql = list(new RegExp(`${sqlName}\\s+constant text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`).exec(fn)[1]);
      const fromJs = list(new RegExp(`const ${jsName} = \\[([\\s\\S]*?)\\];`).exec(LIB)[1]);
      assert.deepEqual(fromJs, fromSql, sqlName);
      assert.ok(fromSql.length >= 5, sqlName);
    }
    const sqlWords = list(/c_words\s+constant text\[\] := ARRAY\[([\s\S]*?)\];/.exec(fn)[1]);
    const jsWords = list(/const IDENT_WORDS = new Set\(\[([\s\S]*?)\]\);/.exec(LIB)[1]);
    assert.deepEqual(jsWords, sqlWords);
  });
  it("the same video id, the same mobile-digit rule, and the same characters removed", () => {
    assert.equal(/c_video\s+constant text := '([^']*)';/.exec(fn)[1], /const IDENT_VIDEO = "([^"]*)";/.exec(LIB)[1]);
    assert.ok(fn.includes("t ~ '^[+]549[0-9]{10}$' OR t ~ '^[+]521[0-9]{10}$'"));
    assert.ok(LIB.includes("/^[+]549[0-9]{10}$/.test(t) || /^[+]521[0-9]{10}$/.test(t)"));
    assert.ok(fn.includes("v_site = 'youtu.be' AND v_path ~ ('^' || c_video || '$')"));
    assert.ok(LIB.includes('site === "youtu.be" && new RegExp(`^${IDENT_VIDEO}$`).test(path)'));
    const points = (cls) =>
      cls.replace(/\\U000([0-9A-F]{5})/g, "\\u{$1}").replace(/\\u\{0*([0-9A-F]+)\}/g, "\\u{$1}").replace(/ /g, "\\u0020");
    assert.equal(points(/c_hidden constant text := '\[([^']*)\]';/.exec(fn)[1]), points(/const IDENT_HIDDEN = \/\[([^\]]*)\]\/gu;/.exec(LIB)[1]));
    assert.equal(points(/c_space\s+constant text := '\[([^']*)\]';/.exec(fn)[1]), points(/const IDENT_SPACE = \/\[([^\]]*)\]\+\/gu;/.exec(LIB)[1]));
    assert.ok(fn.includes("'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'") && fn.includes("normalize(p_value, NFC)"));
  });
});

describe("#3802 F-4: on the page", () => {
  it("adding one video or one number a second time, written the other way, is refused", () => {
    const one = addIdentifier([], { kind: "handle", value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).list;
    assert.equal(one.length, 1);
    assert.deepEqual(addIdentifier(one, { kind: "handle", value: "https://youtu.be/dQw4w9WgXcQ" }), { message: "That one is already on this record." });
    assert.equal(addIdentifier(one, { kind: "handle", value: "https://youtu.be/dqw4w9wgxcq" }).list.length, 2, "another video");
    const phone = addIdentifier([], { kind: "phone", value: "+54 9 11 1234 5678" }).list;
    assert.deepEqual(addIdentifier(phone, { kind: "phone", value: "+54 11 1234 5678" }), { message: "That one is already on this record." });
    const mx = addIdentifier([], { kind: "phone", value: "+52 55 1234 5678" }).list;
    assert.deepEqual(addIdentifier(mx, { kind: "phone", value: "+52 1 55 1234 5678" }), { message: "That one is already on this record." });
  });
  it("search finds a record by either way of writing its video or its number, and not by another video", () => {
    const records = [
      { id: "a", name: "Video Creator", identifiers: [{ kind: "handle", value: "https://youtu.be/dQw4w9WgXcQ", key: "youtube.com/watch?v=dQw4w9WgXcQ" }] },
      { id: "b", name: "Buenos Aires Host", identifiers: [{ kind: "phone", value: "+54 9 11 1234 5678", key: "+541112345678" }] },
      { id: "c", name: "CDMX Host", identifiers: [{ kind: "phone", value: "+52 55 1234 5678", key: "+525512345678" }] },
    ];
    const ids = (q) => filterRecords(records, { q }).map((r) => r.id).join(",");
    assert.equal(ids("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "a");
    assert.equal(ids("https://youtu.be/dQw4w9WgXcQ"), "a");
    assert.equal(ids("https://youtu.be/dqw4w9wgxcq"), "");
    assert.equal(ids("+54 11 1234 5678"), "b");
    assert.equal(ids("+52 1 55 1234 5678"), "c");
    assert.equal(ids("buenos"), "b", "a name still finds it");
  });
});

describe("#3802 F-5: the Add form says a record's contact rule once", () => {
  const FORM = fs.readFileSync(path.join(SRC, "components", "crm", "AddRecordForm.jsx"), "utf8");
  const dnc = { id: "r1", name: "Namesake Grill", stage: "prospect", owners: [], contact_rule: "do_not_contact", contact_rule_reason: "Lawyer letter" };
  const clean = { id: "r2", name: "Clean Email Cafe", stage: "prospect", owners: [] };

  it("an exact name match on a Do-not-contact record: the name warning says the rule, and no second line does", () => {
    // What the server answers for that name, read the way the form reads it.
    const hit = contactHit({ verdict: "do_not_contact", match: "name", record: dnc, matches: [{ record: dnc, name_match: true, matched_on: [] }] });
    assert.equal(hit.id, "r1");
    assert.equal(hit.rule, "Do not contact: Lawyer letter");
    const dupes = findDuplicates([dnc, clean], "Namesake Grill");
    assert.equal(dupes.exact?.id, "r1");
    const lookalikes = [dupes.exact];
    assert.equal(addFormRuleNote(hit, null, lookalikes), null, "said once, in the name warning");
    // A near name shows the record in the same block, with its rule: still once.
    assert.equal(addFormRuleNote(hit, null, [dnc]), null);
  });

  it("the rule is still said when nothing else on the form says it", () => {
    const hit = { id: "r1", name: "Namesake Grill", rule: "Do not contact: Lawyer letter", byIdentifier: false };
    assert.equal(addFormRuleNote(hit, null, []), hit, "no name warning");
    assert.equal(addFormRuleNote(hit, null, [clean]), hit, "the name warning shows another record");
    assert.equal(addFormRuleNote(hit, null, [{ ...dnc, contact_rule: null, contact_rule_reason: null }]), hit, "the list on the page does not know the rule yet");
    assert.equal(addFormRuleNote({ ...hit, rule: "" }, null, []), null, "no rule, nothing to say");
    assert.equal(addFormRuleNote(hit, { ...hit, byIdentifier: true }, []), null, "the shared-detail warning says it");
    assert.equal(addFormRuleNote(null, null, [dnc]), null);
    assert.equal(addFormRuleNote(hit, null, undefined), hit);
  });

  it("the form uses that choice, and each block has one sentence and one Open it", () => {
    assert.ok(FORM.includes("const ruleNote = addFormRuleNote(hit, shared, lookalikes);"));
    assert.equal((FORM.match(/ is marked \{/g) || []).length, 2, "one in the name warning, one in the rule line");
    assert.equal((FORM.match(/>\s*Open it\s*<\/Button>/g) || []).length, 3, "the name warning, the rule line, the shared detail");
  });
});
