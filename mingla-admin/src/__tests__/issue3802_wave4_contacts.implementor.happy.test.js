// Issue #3802 (Wave 4, second part) — identifiers, the contact rule,
// Experience host and "City missing?" on the Hosts and Creators screens.
//
//   C-1  the normal form of an email, a phone number and a handle is the
//        server's: one table of examples, read from the database suite, is
//        asserted here against the page's own function
//   C-2  which kind a typed value looks like, and adding one to a list
//   C-3  search finds a record by email, phone digits or handle
//   C-4  the contact rule: the pill, the banner, the card's name, the warning
//        on the log form
//   C-5  the contactable check's answer in the Add form's words
//   C-6  every new answer from the server becomes a sentence
//   C-7  "City missing?", by role, and every button does something
//   C-8  source contracts: Experience host needs no list in the client; the
//        new fields are wired where the spec puts them
//
// Run: node --test src/__tests__/issue3802_wave4_contacts.implementor.happy.test.js
// (from mingla-admin). Hermetic: no network, no browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTACT_RULES,
  IDENT_KINDS,
  IDENT_PLATFORMS,
  MAX_IDENTIFIERS,
  addIdentifier,
  contactHit,
  contactRuleView,
  detectIdentKind,
  detectPlatform,
  errorCopy,
  errorWords,
  filterRecords,
  identKey,
  identLabel,
  identifiersToSend,
  logRuleWarning,
  missingCityWords,
  phoneMatch,
  recordOpenLabel,
  sharedDetailHolder,
  sharedDetailRule,
} from "../lib/crmModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const REPO = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("#3802 C-1: one normal form, on the server and on the page", () => {
  // The table the database suite asserts against the server's function.
  const SQL = fs.readFileSync(
    path.join(REPO, "supabase", "migrations", "__tests__", "issue_3802_wave4_agent_write_setup.implementor.happy.pg17.test.sql"),
    "utf8"
  );
  const block = SQL.slice(SQL.indexOf("insert into t3802b_forms values"), SQL.indexOf("create temp table t3802b_phones"));
  // A value written E'...' carries characters nobody can see, as \uXXXX.
  const unescape = (text, escaped) =>
    (escaped ? text.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) : text).replace(/''/g, "'");
  const rows = [...block.matchAll(/^\s*\('(email|phone|handle)', (E?)'((?:[^']|'')*)', '((?:[^']|'')*)'\)[,;]$/gm)].map((m) => ({
    kind: m[1],
    value: unescape(m[3], m[2] === "E"),
    want: m[4].replace(/''/g, "'"),
  }));
  const pairs = [
    ...SQL.slice(SQL.indexOf("insert into t3802b_phones values"), SQL.indexOf("do $b4$")).matchAll(
      /^\s*\('([^']*)', '([^']*)', '(exact|national_number|none)'\)[,;]$/gm
    ),
  ].map((m) => ({ a: m[1], b: m[2], want: m[3] }));
  it("the shared table was read: every row of it, of all three kinds", () => {
    // Every row the database suite inserts is read here, bar the two it builds with repeat().
    const written = block.split("\n").filter((line) => /^\s*\('(email|phone|handle)',/.test(line)).length;
    assert.equal(rows.length, written - 2, `read ${rows.length} of ${written} rows`);
    assert.ok(rows.length >= 89, `only ${rows.length} rows were read`);
    for (const kind of ["email", "phone", "handle"]) assert.ok(rows.filter((r) => r.kind === kind).length >= 9, kind);
    assert.ok(rows.filter((r) => /[^\x20-\x7e]/.test(r.value)).length >= 10, "it holds values with characters nobody can see");
    assert.ok(rows.some((r) => r.want === "-"), "it holds values that are not usable");
    // The four examples the migration checks itself against are in it.
    for (const [kind, value, want] of [
      ["email", " A@B.co ", "a@b.co"],
      ["phone", "+234 (803) 555-0101", "+2348035550101"],
      ["handle", "https://www.instagram.com/Palm.Court/?hl=en", "palm.court"],
      ["handle", "@x", "-"],
    ]) {
      assert.ok(rows.some((r) => r.kind === kind && r.value === value && r.want === want), `${kind} ${value}`);
    }
  });
  it("every row gives the same key here as on the server", () => {
    for (const r of rows) {
      assert.equal(identKey(r.kind, r.value) ?? "-", r.want, `${r.kind}: "${r.value}"`);
    }
  });
  it("the rows the table builds with repeat(), and values that are not text", () => {
    assert.equal(identKey("handle", "a".repeat(61)), null);
    assert.equal(identKey("handle", "a".repeat(60)), "a".repeat(60));
    assert.equal(identKey("handle", "a"), null);
    assert.equal(identKey("email", `${"a".repeat(250)}@b.co`), null, "longer than 200");
    assert.equal(identKey("email", `${"a".repeat(195)}@b.co`), `${"a".repeat(195)}@b.co`, "exactly 200");
    assert.equal(identKey("email", `${"a".repeat(196)}@b.co`), null, "201");
    assert.equal(identKey("phone", "1".repeat(16)), null);
    assert.equal(identKey("phone", "1".repeat(15)), "1".repeat(15));
    assert.equal(identKey("fax", "12345678"), null);
    for (const none of [null, undefined, 7, {}, []]) {
      assert.equal(identKey("email", none), null);
      assert.equal(identKey(none, "a@b.co"), null);
    }
  });
  it("a link never becomes its site alone, or a path word that is not a name", () => {
    const sites = new Set(["linktr.ee", "beacons.ai", "bit.ly", "t.me", "threads.net", "example.com", "alicekitchen.com", "m.facebook.com", "mobile.twitter.com", "uk.linkedin.com", "vm.tiktok.com", "instagram.com", "facebook.com", "youtube.com"]);
    const words = new Set(["profile.php", "channel", "c", "user", "pages", "people", "groups", "reel", "reels", "stories", "p", "share"]);
    const links = rows.filter((r) => r.kind === "handle" && /[/]/.test(r.value));
    assert.ok(links.length >= 40);
    for (const r of links) {
      const key = identKey("handle", r.value);
      assert.ok(key === null || (!sites.has(key) && !words.has(key)), `${r.value} -> ${key}`);
    }
    // Two people who each gave a link of the same kind are two keys.
    for (const [one, two] of [
      ["https://linktr.ee/alice", "https://linktr.ee/bob"],
      ["https://www.facebook.com/profile.php?id=100001", "https://www.facebook.com/profile.php?id=100002"],
      ["https://www.youtube.com/channel/UCabc123", "https://www.youtube.com/channel/UCxyz789"],
      ["https://bit.ly/3abc", "https://bit.ly/4xyz"],
      ["https://beacons.ai/alice", "https://beacons.ai/bob"],
      ["https://www.threads.net/@alice", "https://threads.net/@bob"],
    ]) {
      assert.ok(identKey("handle", one) && identKey("handle", two), `${one} / ${two}`);
      assert.notEqual(identKey("handle", one), identKey("handle", two), `${one} / ${two}`);
    }
    // A site with nothing after it is not a handle, whatever it is.
    for (const bare of ["https://linktr.ee", "https://linktr.ee/", "http://www.example.com", "https://www.instagram.com/", "instagram.com", "www.tiktok.com"]) {
      assert.equal(identKey("handle", bare), null, bare);
    }
  });
  it("two phone numbers match here the way they match on the server", () => {
    assert.equal(pairs.length, 37);
    for (const p of pairs) {
      assert.equal(phoneMatch(p.a, p.b) || "none", p.want, `${p.a} ~ ${p.b}`);
      assert.equal(phoneMatch(p.b, p.a) || "none", p.want, `${p.b} ~ ${p.a}`);
    }
    for (const none of [["", "919 555 0142"], [null, undefined], ["12", "12"]]) assert.equal(phoneMatch(none[0], none[1]), "");
  });
  it("the migration's own function is written the way this one is", () => {
    const MIG = fs.readFileSync(path.join(REPO, "supabase", "migrations", "20270831003802_issue_3802_wave4_agent_write_setup.sql"), "utf8");
    const fn = /CREATE FUNCTION public\.crm_ident_key\([\s\S]*?\n\$\$;/.exec(MIG)[0];
    const LIB = read("lib/crmModel.js");
    const list = (text) => [...text.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    // The same profile sites and the same path words, in the same order.
    const sqlSites = list(/c_sites\s+constant text\[\] := ARRAY\[([\s\S]*?)\];/.exec(fn)[1]);
    const jsSites = list(/const IDENT_SITES = \[([\s\S]*?)\];/.exec(LIB)[1]);
    assert.deepEqual(jsSites, sqlSites);
    assert.equal(sqlSites.length, 7);
    // The same link sites, sites that are never a handle, site-name ends, words that lead to a name, and country codes.
    for (const [sqlName, jsName] of [["c_links", "IDENT_LINKS"], ["c_never", "IDENT_NEVER"], ["c_ends", "IDENT_ENDS"], ["c_lead", "IDENT_LEAD"], ["c_cc2", "PHONE_CC2"]]) {
      const fromSql = list(new RegExp(`${sqlName}\\s+constant text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`).exec(fn)[1]);
      const fromJs = list(new RegExp(`const ${jsName} = \\[([\\s\\S]*?)\\];`).exec(LIB)[1]);
      assert.deepEqual(fromJs, fromSql, sqlName);
      assert.ok(fromSql.length >= 5, sqlName);
    }
    // The national part uses the same country codes.
    const nat = /CREATE FUNCTION public\.crm_phone_national\([\s\S]*?\n\$\$;/.exec(MIG)[0];
    assert.deepEqual(list(/ARRAY\[([\s\S]*?)\]/.exec(nat)[1]), list(/const PHONE_CC2 = \[([\s\S]*?)\];/.exec(LIB)[1]));
    const sqlWords = list(/c_words\s+constant text\[\] := ARRAY\[([\s\S]*?)\];/.exec(fn)[1]);
    const jsWords = list(/const IDENT_WORDS = new Set\(\[([\s\S]*?)\]\);/.exec(LIB)[1]);
    assert.deepEqual(jsWords, sqlWords);
    assert.ok(sqlWords.length >= 50);
    // The same characters are removed, and the same ones are a space.
    const points = (cls) =>
      cls.replace(/\\U000([0-9A-F]{5})/g, "\\u{$1}").replace(/\\u\{0*([0-9A-F]+)\}/g, "\\u{$1}").replace(/ /g, "\\u0020");
    assert.equal(points(/c_hidden constant text := '\[([^']*)\]';/.exec(fn)[1]), points(/const IDENT_HIDDEN = \/\[([^\]]*)\]\/gu;/.exec(LIB)[1]));
    assert.equal(points(/c_space\s+constant text := '\[([^']*)\]';/.exec(fn)[1]), points(/const IDENT_SPACE = \/\[([^\]]*)\]\+\/gu;/.exec(LIB)[1]));
    // The same limits.
    assert.ok(fn.includes("BETWEEN 7 AND 15") && fn.includes("char_length(t) > 200") && fn.includes("{2,60}"));
    assert.ok(LIB.includes("n >= 7 && n <= 15") && LIB.includes("[...t].length > 200") && LIB.includes("{2,60}"));
    // Only A to Z are lower-cased, on both sides, so the two cannot differ by locale.
    assert.ok(fn.includes("'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'"));
    assert.ok(LIB.includes("const asciiLower = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());"));
    // Both sides compose the text first.
    assert.ok(fn.includes("normalize(p_value, NFC)") && LIB.includes('.normalize("NFC")'));
  });
});

describe("#3802 C-2: what was typed, and adding it", () => {
  it("an @ with a dot after it is an email; 7 or more digits is a phone number; anything else is a handle", () => {
    for (const [typed, kind] of [
      ["hello@palmcourt.example", "email"],
      [" Name.Surname+tag@Example.COM ", "email"],
      ["+234 (803) 555-0101", "phone"],
      ["0803.555.0101", "phone"],
      ["5550101", "phone"],
      ["555010", "handle"],
      ["@palm.court", "handle"],
      ["palm.court", "handle"],
      ["https://www.instagram.com/Palm.Court/", "handle"],
      ["tiktok.com/@some_creator", "handle"],
      ["name@nodot", "handle"],
      ["919-555-0103 ext 4", "handle"],
      ["", ""],
      ["   ", ""],
      [null, ""],
    ]) {
      assert.equal(detectIdentKind(typed), kind, String(typed));
    }
  });
  it("a profile address says where the handle is from", () => {
    assert.equal(detectPlatform("https://www.instagram.com/Palm.Court/"), "instagram");
    assert.equal(detectPlatform("TikTok.com/@x"), "tiktok");
    assert.equal(detectPlatform("twitter.com/mingla"), "x");
    assert.equal(detectPlatform("x.com/mingla"), "x");
    assert.equal(detectPlatform("facebook.com/p"), "facebook");
    assert.equal(detectPlatform("youtube.com/@c"), "youtube");
    assert.equal(detectPlatform("linkedin.com/in/jane"), "linkedin");
    assert.equal(detectPlatform("https://uk.linkedin.com/in/jane"), "linkedin");
    assert.equal(detectPlatform("https://m.facebook.com/aliceskitchen"), "facebook");
    assert.equal(detectPlatform("https://mobile.twitter.com/alice"), "x");
    assert.equal(detectPlatform("https://linktr.ee/alice"), "");
    assert.equal(detectPlatform("@palm.court"), "");
    assert.equal(detectPlatform("example.com/x"), "");
  });
  it("adding: usable values join the list with their key; unusable ones, repeats and a full list say why", () => {
    const one = addIdentifier([], { value: "  https://instagram.com/Palm.Court  " });
    assert.deepEqual(one.list, [{ kind: "handle", value: "https://instagram.com/Palm.Court", key: "palm.court", platform: "instagram" }]);
    const two = addIdentifier(one.list, { value: "Hello@Palm.co" });
    assert.deepEqual(two.list[1], { kind: "email", value: "Hello@Palm.co", key: "hello@palm.co", platform: null });
    // The same handle written another way is the same identifier.
    assert.equal(addIdentifier(two.list, { value: "@PALM.COURT" }).message, "That one is already on this record.");
    assert.equal(addIdentifier(two.list, { value: "hello@palm.co " }).message, "That one is already on this record.");
    // A list that came from the server (its key is "key") is compared the same way.
    assert.equal(addIdentifier([{ kind: "phone", value: "+1 919 555 0103", key: "19195550103" }], { value: "1 (919) 555-0103" }).message, "That one is already on this record.");
    // The same number without its country code is the same number; another country's is not.
    assert.equal(addIdentifier([{ kind: "phone", value: "+234 803 555 0101", key: "2348035550101" }], { value: "0803 555 0101" }).message, "That one is already on this record.");
    assert.equal(addIdentifier([{ kind: "phone", value: "+44 7911 123456", key: "447911123456" }], { value: "+234 7911 123456" }).list.length, 2);
    // A link keeps what tells two people apart; a site alone is not a handle.
    assert.equal(addIdentifier([], { value: "https://linktr.ee/alice" }).list[0].key, "linktr.ee/alice");
    assert.match(addIdentifier([], { value: "https://linktr.ee/" }).message, /A site on its own, a post, a search or a share link names no one\./);
    assert.match(addIdentifier([], { value: "linktr.ee" }).message, /A site on its own/);
    // A share link says what to paste instead.
    assert.equal(
      addIdentifier([], { value: "https://www.facebook.com/sharer.php?u=https://palm.example" }).message,
      "That is a link that shares or forwards a page, not a profile. Paste the link to the profile itself instead."
    );
    // A WhatsApp link is a phone number, typed as anything.
    for (const kind of ["", "handle", "phone"]) {
      const wa = addIdentifier([], { kind, value: "https://wa.me/2348035550101" }).list[0];
      assert.deepEqual([wa.kind, wa.key, wa.platform], ["phone", "+2348035550101", null], kind || "guessed");
    }
    assert.equal(detectIdentKind("https://api.whatsapp.com/send?phone=447911123456"), "phone");
    // A number with its trunk 0 or a (0) is the same number.
    assert.equal(addIdentifier([{ kind: "phone", value: "+44 20 7745 7222", key: "+442077457222" }], { value: "+44 (0)20 7745 7222" }).message, "That one is already on this record.");
    assert.equal(addIdentifier([], { kind: "email", value: "not-an-email" }).message, "An email needs a name, an @ and a domain.");
    assert.equal(addIdentifier([], { kind: "phone", value: "12" }).message, "A phone number needs 7 to 15 digits.");
    assert.match(addIdentifier([], { kind: "handle", value: "has space" }).message, /^A handle is 2 to 60 letters/);
    assert.match(addIdentifier([], { value: "" }).message, /^A handle is/);
    // A chosen kind wins over the guess; a chosen platform is kept.
    assert.equal(addIdentifier([], { kind: "handle", value: "5550101", platform: "tiktok" }).list[0].platform, "tiktok");
    const full = Array.from({ length: MAX_IDENTIFIERS }, (_, i) => ({ kind: "email", value: `n${i}@b.co`, key: `n${i}@b.co` }));
    assert.equal(addIdentifier(full, { value: "one-more@b.co" }).message, "A record holds at most 20 of these.");
    assert.equal(MAX_IDENTIFIERS, 20);
  });
  it("what is sent back to the server is kind, value and platform, never the key", () => {
    assert.deepEqual(
      identifiersToSend([
        { kind: "handle", value: "@Palm.Court", key: "palm.court", platform: "instagram" },
        { kind: "email", value: "a@b.co", key: "a@b.co", platform: null },
        null,
        { kind: "phone" },
      ]),
      [{ kind: "handle", value: "@Palm.Court", platform: "instagram" }, { kind: "email", value: "a@b.co" }]
    );
    assert.deepEqual(identifiersToSend(null), []);
    assert.equal(identLabel({ kind: "handle", platform: "tiktok" }), "TikTok");
    assert.equal(identLabel({ kind: "handle", platform: null }), "Handle");
    assert.equal(identLabel({ kind: "email" }), "Email");
    assert.equal(identLabel({ kind: "phone" }), "Phone");
    assert.deepEqual(IDENT_KINDS.map((k) => k.id), ["email", "phone", "handle"]);
    assert.deepEqual(IDENT_PLATFORMS.map((p) => p.id), ["instagram", "tiktok", "x", "facebook", "youtube", "linkedin", "other"]);
  });
});

describe("#3802 C-3: search by email, phone digits or handle", () => {
  const records = [
    { id: "1", name: "Palm Court Kitchen", identifiers: [{ kind: "email", key: "hello@palmcourt.example" }, { kind: "handle", key: "palm.court" }, { kind: "phone", key: "2348035550101" }] },
    { id: "2", name: "Test Host Three", identifiers: [{ kind: "phone", key: "19195550103" }] },
    { id: "3", name: "No Details", identifiers: [] },
    { id: "4", name: "Old Shape" },
    { id: "5", name: "Zeta", identifiers: [{ kind: "handle", key: "quux.handle" }] },
  ];
  const found = (q) => filterRecords(records, { q }).map((r) => r.id);
  it("an email, whole or in part", () => {
    assert.deepEqual(found("hello@palmcourt.example"), ["1"]);
    assert.deepEqual(found("HELLO@PalmCourt.example"), ["1"]);
    assert.deepEqual(found("palmcourt.ex"), ["1"]);
  });
  it("the digits of a phone number, however they are typed", () => {
    assert.deepEqual(found("9195550103"), ["2"]);
    assert.deepEqual(found("(919) 555-0103"), ["2"]);
    assert.deepEqual(found("+1 919 555 0103"), ["2"]);
    assert.deepEqual(found("0803 555 0101"), ["1"], "a local form finds the number stored with its country code");
    assert.deepEqual(found("5550103"), ["2"]);
    assert.deepEqual(found("555010"), [], "fewer than seven digits is not a phone search");
  });
  it("a handle, with or without @, or as a profile address", () => {
    assert.deepEqual(found("@palm.court"), ["1"]);
    assert.deepEqual(found("palm.court"), ["1"]);
    assert.deepEqual(found("@Palm"), ["1"]);
    assert.deepEqual(found("https://www.instagram.com/Palm.Court/?hl=en"), ["1"]);
    assert.deepEqual(found("@quu"), ["5"]);
    assert.deepEqual(found("@qu"), [], "two characters is too little to search identifiers by");
  });
  it("the name still works, and records with no identifiers are not broken by the search", () => {
    assert.deepEqual(found("palm court"), ["1"]);
    assert.deepEqual(found("old"), ["4"]);
    assert.deepEqual(found(""), ["1", "2", "3", "4", "5"]);
    assert.deepEqual(found("zzzz"), []);
    assert.deepEqual(filterRecords([{ id: "x", name: "A", identifiers: "nope" }, { id: "y", name: "B", identifiers: [null, { kind: "email" }] }], { q: "a@b.co" }), []);
  });
  it("the toolbar says so", () => {
    assert.ok(read("components/crm/PipelineToolbar.jsx").includes('placeholder="Search by name, email, phone or handle"'));
  });
});

describe("#3802 C-4: the contact rule on screen", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");
  const team = [{ email: "tunde@usemingla.com", display_name: "Tunde" }];
  const dnc = { name: "Palm Court Kitchen", contact_rule: "do_not_contact", contact_rule_reason: "Asked us not to message again", contact_rule_by: "tunde@usemingla.com", contact_rule_at: "2026-10-14T09:00:00" };
  it("the two rules, their labels and their colours", () => {
    assert.deepEqual(CONTACT_RULES, [
      { id: "warm_intro_only", label: "Warm intro only", variant: "warning" },
      { id: "do_not_contact", label: "Do not contact", variant: "error" },
    ]);
  });
  it("the pill, the banner and the card's name", () => {
    const v = contactRuleView(dnc, team, NOW);
    assert.equal(v.label, "Do not contact");
    assert.equal(v.variant, "error");
    assert.equal(v.reason, "Asked us not to message again");
    assert.equal(v.banner, "Do not contact · Asked us not to message again · set by Tunde on 14 Oct");
    assert.equal(recordOpenLabel(dnc, team), "Open Palm Court Kitchen, do not contact");
    const warm = contactRuleView({ contact_rule: "warm_intro_only", contact_rule_reason: "Knows the founder" }, team, NOW);
    assert.equal(warm.variant, "warning");
    assert.equal(warm.banner, "Warm intro only · Knows the founder");
    assert.equal(recordOpenLabel({ name: "X", contact_rule: "warm_intro_only" }), "Open X, warm intro only");
    // Another year is said; someone no longer on the team is still named by their address.
    assert.match(contactRuleView({ ...dnc, contact_rule_at: "2025-03-02T09:00:00" }, team, NOW).banner, /set by Tunde on 2 Mar 2025$/);
    assert.match(contactRuleView({ ...dnc, contact_rule_by: "left@usemingla.com" }, team, NOW).banner, /set by .+ on 14 Oct$/);
  });
  it("no rule, or one this page does not know, shows nothing", () => {
    for (const r of [{ name: "X" }, { name: "X", contact_rule: null }, { name: "X", contact_rule: "something_new" }, null, undefined]) {
      assert.equal(contactRuleView(r), null);
    }
    assert.equal(recordOpenLabel({ name: "Palm Court Kitchen" }), "Open Palm Court Kitchen");
  });
  it("the log form warns a person logging an outbound touch on a marked record, and only then", () => {
    assert.equal(logRuleWarning(dnc, { kind: "touch", direction: "outbound" }), "This record is marked Do not contact. Log this only if it really happened.");
    assert.equal(logRuleWarning({ contact_rule: "warm_intro_only" }, { kind: "touch", direction: "outbound" }), "This record is marked Warm intro only. Log this only if it really happened.");
    assert.equal(logRuleWarning(dnc, { kind: "touch", direction: "inbound" }), "");
    assert.equal(logRuleWarning(dnc, { kind: "note", direction: "outbound" }), "");
    assert.equal(logRuleWarning({ name: "X" }, { kind: "touch", direction: "outbound" }), "");
    // It never blocks: the form's Save is not disabled by it.
    const FORM = read("components/crm/LogForm.jsx");
    assert.ok(FORM.includes("{logRuleWarning(record, { kind, direction }) && ("));
    assert.ok(FORM.includes('<Button type="submit" size="sm" className="max-sm:h-11" loading={busy} disabled={disabled}>'));
  });
  it("the card, the list and the drawer draw it", () => {
    const CARD = read("components/crm/RecordCard.jsx");
    assert.ok(CARD.includes("aria-label={recordOpenLabel(record, team)}"));
    assert.ok(/\{rule && \(\s*<p className="mt-1" title=\{rule\.reason \|\| undefined\}>\s*<Badge variant=\{rule\.variant\}>\{rule\.label\}<\/Badge>/.test(CARD));
    const LIST = read("components/crm/PipelineList.jsx");
    assert.ok(LIST.includes("const rule = contactRuleView(row, team);") && LIST.includes("<Badge variant={rule.variant}>{rule.label}</Badge>"));
    const DRAWER = read("components/crm/RecordDrawer.jsx");
    assert.ok(DRAWER.includes("const rule = contactRuleView(record, config.team);"));
    assert.ok(/\{rule && \(\s*<p\s+role="status"/.test(DRAWER));
    assert.ok(DRAWER.includes("<ContactRuleField record={record} disabled={locked} onSave={saveExtra} />"));
    const FIELD = read("components/crm/ContactRuleField.jsx");
    assert.ok(FIELD.includes("Lift this rule? Agents will be able to log a first touch again."));
    assert.ok(/const ready = rule === "" \? stored !== "" : reason\.trim\(\) !== "" && changed;/.test(FIELD), "Save rule needs both the rule and the reason");
    assert.ok(FIELD.includes("disabled={disabled || !ready}"));
    assert.ok(FIELD.includes("send({ contact_rule: rule, contact_rule_reason: reason.trim() })") && FIELD.includes("send({ contact_rule: null })"));
    assert.ok(/<Button type="button" variant="danger" className="max-sm:h-11" onClick=\{lift\}[^>]*>\s*Lift\s*<\/Button>/.test(FIELD) && /onClick=\{keep\}>\s*Keep\s*<\/Button>/.test(FIELD));
  });
});

describe("#3802 C-5: the contactable check, in the Add form's words", () => {
  const record = { id: "r1", name: "Palm Court Kitchen", stage: "contacted", owners: [], contact_rule: null, contact_rule_reason: null };
  it("a match by identifier says which, and can be opened or added anyway", () => {
    const hit = contactHit({ verdict: "exists", match: "identifier", record, matched_on: [{ kind: "email", value: "a@b.co", rule: "exact" }] });
    assert.deepEqual(hit, { id: "r1", name: "Palm Court Kitchen", byIdentifier: true, line: "Looks like Palm Court Kitchen (same email)", rule: "", others: 0 });
    assert.equal(contactHit({ verdict: "exists", match: "identifier", record, matched_on: [{ kind: "phone", rule: "national_number" }] }).line, "Looks like Palm Court Kitchen (same phone number)");
    assert.equal(
      contactHit({ verdict: "exists", match: "both", record, matched_on: [{ kind: "handle" }, { kind: "email" }, { kind: "handle" }] }).line,
      "Looks like Palm Court Kitchen (same handle and email)"
    );
    assert.equal(contactHit({ verdict: "exists", match: "name", record, matched_on: [] }).byIdentifier, false);
    assert.equal(contactHit({ verdict: "exists", match: "name", record, matched_on: [] }).line, "Looks like Palm Court Kitchen (same name)");
  });
  it("a match that carries a rule shows the rule and its reason", () => {
    const hit = contactHit({
      verdict: "do_not_contact",
      match: "identifier",
      record: { ...record, contact_rule: "do_not_contact", contact_rule_reason: "Seth's personal contact" },
      matched_on: [{ kind: "handle" }],
    });
    assert.equal(hit.rule, "Do not contact: Seth's personal contact");
    assert.equal(contactHit({ verdict: "warm_intro_only", match: "name", record: { ...record, contact_rule: "warm_intro_only" }, matched_on: [] }).rule, "Warm intro only");
  });
  it("every match is weighed: a rule on any of them is the rule shown, with the record that carries it", () => {
    const clean = { id: "c1", name: "Clean Cafe", contact_rule: null, contact_rule_reason: null };
    const blocked = { id: "b1", name: "Blocked Bistro", contact_rule: "do_not_contact", contact_rule_reason: "Asked us to stop" };
    const warm = { id: "w1", name: "Warm Wine Bar", contact_rule: "warm_intro_only", contact_rule_reason: "Knows Tunde" };
    // The server's order: the strictest rule first. The name is one record, the email another.
    const answer = {
      verdict: "do_not_contact",
      match: "both",
      record: blocked,
      matched_on: [],
      other_matches: 2,
      matches: [
        { record: blocked, name_match: true, matched_on: [] },
        { record: warm, name_match: false, matched_on: [{ kind: "phone", rule: "national_number" }] },
        { record: clean, name_match: false, matched_on: [{ kind: "email", rule: "exact" }] },
      ],
    };
    assert.deepEqual(contactHit(answer), {
      id: "b1",
      name: "Blocked Bistro",
      byIdentifier: false,
      line: "Looks like Blocked Bistro (same name)",
      rule: "Do not contact: Asked us to stop",
      others: 2,
    });
    // A near name that carries a rule says so, with its reason, beside Open it.
    const FORM_SRC = read("components/crm/AddRecordForm.jsx");
    assert.ok(/\{contactRuleView\(r\) && \([\s\S]{0,160}<b>\{r\.name\}<\/b> is marked \{contactRuleView\(r\)\.label\}\s*\{contactRuleView\(r\)\.reason \? `: \$\{contactRuleView\(r\)\.reason\}` : ""\}\./.test(FORM_SRC));
    assert.ok(FORM_SRC.indexOf("{lookalikes.map((r) => (") < FORM_SRC.indexOf("{contactRuleView(r) && ("));
    // Even if the record named first were the clean one, the rule found on another match is the one shown.
    const cleanFirst = contactHit({ ...answer, verdict: "exists", record: clean, matched_on: [{ kind: "email" }], matches: [answer.matches[2], answer.matches[1], answer.matches[0]] });
    assert.equal(cleanFirst.id, "b1");
    assert.equal(cleanFirst.rule, "Do not contact: Asked us to stop");
    // Do not contact outranks Warm intro only wherever each sits in the list.
    const warmFirst = contactHit({ ...answer, record: clean, matches: [answer.matches[1], answer.matches[2], answer.matches[0]] });
    assert.equal(warmFirst.rule, "Do not contact: Asked us to stop");
    assert.equal(contactHit({ ...answer, record: warm, matches: [answer.matches[1], answer.matches[2]] }).rule, "Warm intro only: Knows Tunde");
    // No rule anywhere: the record named, by what it matched on.
    const none = contactHit({ verdict: "exists", match: "identifier", record: clean, matched_on: [{ kind: "email" }], matches: [answer.matches[2]] });
    assert.deepEqual([none.id, none.rule, none.byIdentifier, none.others], ["c1", "", true, 0]);
    // The Add form says a rule whichever way the match came, and never only for a shared detail.
    const FORM = read("components/crm/AddRecordForm.jsx");
    // The rule line is chosen by addFormRuleNote, which says it once (its truth table is in the follow-up suite).
    assert.ok(FORM.includes("const ruleNote = addFormRuleNote(hit, shared, lookalikes);"));
    assert.ok(/\{ruleNote && \([\s\S]{0,420}<b>\{ruleNote\.name\}<\/b> is marked \{ruleNote\.rule\}\./.test(FORM));
    assert.ok(/onClick=\{\(\) => onOpenExisting\(ruleNote\.id\)\}>\s*Open it\s*<\/Button>/.test(FORM));
    assert.ok(FORM.includes("{shared.rule ? `. Marked ${shared.rule}.` : \".\"}"));
    // An answer of the add itself that names a marked record carries its rule too.
    assert.ok(/const rule = contactRuleView\(result\.duplicate\);/.test(FORM));
  });
  it("someone new, an unreadable candidate, or no answer shows nothing", () => {
    for (const none of [null, undefined, {}, { verdict: "new", record: null }, { verdict: "invalid", error: "x" }, { verdict: "exists", record: null }]) {
      assert.equal(contactHit(none), null);
    }
  });
  it("the Add form asks a moment after typing stops, blocks on a shared detail, and Add anyway sends the flag", () => {
    const FORM = read("components/crm/AddRecordForm.jsx");
    assert.ok(FORM.includes("const CONTACT_CHECK_MS = 400;"));
    assert.ok(/const timer = setTimeout\(\(\) => \{[\s\S]*contactCheck\(pipeline, \[candidate\]\)\.then\(/.test(FORM));
    assert.ok(FORM.includes("return () => clearTimeout(timer);"));
    assert.ok(FORM.includes("if (mine === checkSeq.current) setHitFor({ key: checkKey, hit: contactHit(answer?.results?.[0]) });"), "an answer to an older question is dropped");
    assert.ok(FORM.includes("if (addAnyway) fields.allow_shared_identifier = true;"));
    assert.ok(FORM.includes("if (values.identifiers.length > 0) fields.identifiers = identifiersToSend(values.identifiers);"));
    assert.ok(/if \(blockedByShared\) \{\s*setError\(`\$\{shared\.line\}\. Open it, or choose Add anyway\.`\);/.test(FORM));
    assert.ok(/onClick=\{\(\) => onOpenExisting\(shared\.id\)\}>\s*Open it\s*<\/Button>/.test(FORM));
    assert.ok(/setAddAnyway\(true\);[\s\S]{0,120}Add anyway\s*<\/Button>/.test(FORM));
    // Add anyway removes its own button: focus goes to the button that adds.
    assert.ok(/useEffect\(\(\) => \{\s*if \(addAnyway\) submitRef\.current\?\.focus\(\);\s*\}, \[addAnyway\]\);/.test(FORM));
    assert.ok(FORM.includes('<Button ref={submitRef} type="submit" loading={busy} disabled={disabled || !!exact}>'));
    assert.ok(FORM.includes('if (key === "name" || key === "identifiers") setAddAnyway(false);'), "changing what was typed asks again");
    assert.ok(FORM.includes('if (result?.duplicate && result.reason === "identifier") {'));
    const PAGE = read("pages/PipelinePage.jsx");
    assert.ok(PAGE.includes('if (res?.status === "duplicate") return { duplicate: res.existing, reason: res.reason || "name" };'));
    // Only the service calls the server.
    assert.ok(read("services/crmService.js").includes('supabase.rpc("crm_contact_check", { p_pipeline: pipeline, p_candidates: candidates })'));
  });
});

describe("#3802 C-6: every new answer from the server becomes a sentence", () => {
  it("answers written for the person on screen are shown as they come", () => {
    for (const [token, message] of [
      ["duplicate_identifier", '"@Palm.Court" already belongs to "Palm Court Kitchen" in Hosts. Open that record instead.'],
      ["invalid_identifier", '"nope" is not a usable email. An email needs a name, an @ and a domain.'],
      ["do_not_contact", '"Palm Court" is marked Do not contact: Asked us not to. Nothing was logged. Do not message them; tell your person.'],
      ["warm_intro_only", '"Palm Court" is marked Warm intro only: Knows the founder. Nothing was logged. Ask your person to make the introduction.'],
      ["needs_a_person", '"Palm Court" has already been contacted, so a follow-up or an answer is your person\'s to send and log. Tell them what you would say.'],
      ["contact_rule_locked", "Only a person can lift or loosen a contact rule. Tell your person why you think it should change."],
      ["reason_required", "Say in one line why, so the next person and their agent know."],
    ]) {
      assert.equal(errorCopy(token, message), message, token);
      assert.equal(errorWords({ token, message }), message, token);
    }
  });
  it("the same answers without their sentence, and the ones written for a caller, get the page's own words", () => {
    for (const token of [
      "duplicate_identifier",
      "invalid_identifier",
      "do_not_contact",
      "warm_intro_only",
      "needs_a_person",
      "contact_rule_locked",
      "invalid_identifiers",
      "invalid_contact_rule",
      "invalid_contact_rule_reason",
      "invalid_candidates",
      "field_not_for_agents",
    ]) {
      for (const message of ["", token, undefined, "crm_ident_key"]) {
        const words = errorCopy(token, message);
        assert.ok(words.length > 20 && /\s/.test(words) && /[.]$/.test(words), `${token}: ${words}`);
        assert.equal(/crm_|[a-z]+_[a-z]+_[a-z]+|undefined|null/.test(words), false, `${token}: ${words}`);
      }
    }
    assert.equal(errorCopy("invalid_contact_rule", "ignore is not a contact rule. Use do_not_contact, warm_intro_only, or leave it empty."), "Pick None, Warm intro only or Do not contact, and say why in one line.");
    assert.equal(errorCopy("invalid_region", "That city is not in the Launch Cities list. Use an id from crm_config().regions, or leave the region out and ask an owner or admin to add the city."), "That region is no longer in the list. Pick another.");
  });
  it("a refusal that names another record lets the drawer open it, or keep the detail anyway", () => {
    const DRAWER = read("components/crm/RecordDrawer.jsx");
    assert.ok(DRAWER.includes('return { message: errorWords(err), existingId: err?.token === "duplicate_identifier" ? err.detail || "" : "" };'));
    assert.ok(DRAWER.includes("onOpenRecord={onOpenCard}"));
    // The person's say-so travels with the same list, and only when it was given.
    assert.ok(
      /onChange=\{\(list, options\) =>\s*saveExtra\(\s*options\?\.allowShared\s*\? \{ identifiers: identifiersToSend\(list\), allow_shared_identifier: true \}\s*: \{ identifiers: identifiersToSend\(list\) \}\s*\)\s*\}/.test(DRAWER)
    );
    assert.equal((DRAWER.match(/allow_shared_identifier/g) || []).length, 1);
    const FIELD = read("components/crm/IdentifiersField.jsx");
    // The same words and the same two ways forward as the Add form.
    assert.ok(FIELD.includes("`Looks like ${sharedDetailHolder(problem.message)} (same contact detail)`"));
    assert.ok(/onClick=\{\(\) => onOpenRecord\(problem\.existingId\)\}>\s*Open it\s*<\/Button>/.test(FIELD));
    assert.ok(/onClick=\{addAnyway\}>\s*Add anyway\s*<\/Button>/.test(FIELD));
    assert.ok(FIELD.includes("if (await send(problem.shared, { allowShared: true })) {"), "Add anyway sends the list that was refused, with the flag");
    assert.ok(FIELD.includes("shared: result.existingId ? next : null"), "only a refusal that names a record offers it");
    assert.ok(FIELD.includes('if (problem.message) setProblem({ message: "", existingId: "", shared: null });'), "typing again withdraws the offer");
    // Focus is back in the box once the save has ended.
    assert.ok(/useEffect\(\(\) => \{\s*if \(busy \|\| !focusInput\.current\) return;\s*focusInput\.current = false;\s*inputRef\.current\?\.focus\(\);\s*\}, \[busy\]\);/.test(FIELD));
    assert.ok(FIELD.includes('placeholder="Add an email, a phone number or a handle"'));
    assert.ok(FIELD.includes("flex h-11 w-11"), "the remove button is a 44px target");
    assert.ok(/aria-label=\{`Remove \$\{identLabel\(item\)\.toLowerCase\(\)\} \$\{item\.value\}`\}/.test(FIELD));
    assert.ok(FIELD.includes("Change") && FIELD.includes('aria-label="Where the handle is from"'));
    for (const b of FIELD.split("<Button").slice(1)) assert.ok(/max-sm:h-11/.test(b.slice(0, b.indexOf("</Button>"))));
  });
  it("a shared detail held by a record that carries a rule says so, from the server's sentence", () => {
    const said = '"twin@b6.example" already belongs to "B6 Marked Twin" in Hosts, which is marked Do not contact: Asked us to stop. Open that record instead.';
    assert.equal(sharedDetailHolder(said), "B6 Marked Twin");
    assert.equal(sharedDetailRule(said), "Do not contact: Asked us to stop");
    assert.equal(sharedDetailRule('"x" already belongs to "Plain" in Creators. Open that record instead.'), "");
    assert.equal(sharedDetailRule('"x" already belongs to "Warm" in Creators, which is marked Warm intro only: Knows Tunde. Open that record instead.'), "Warm intro only: Knows Tunde");
    const FIELD = read("components/crm/IdentifiersField.jsx");
    assert.ok(/\{sharedDetailRule\(problem\.message\) && \([\s\S]{0,200}<b>\{sharedDetailHolder\(problem\.message\)\}<\/b> is marked \{sharedDetailRule\(problem\.message\)\}\./.test(FIELD));
    // The server's sentence names the rule: the same words reach an agent.
    const MIG = fs.readFileSync(path.join(REPO, "supabase", "migrations", "20270831003802_issue_3802_wave4_agent_write_setup.sql"), "utf8");
    assert.ok(MIG.includes("WHEN 'do_not_contact' THEN ', which is marked Do not contact: ' || (v_hits->0->'record'->>'contact_rule_reason')"));
  });
  it("the record a refusal names is read from the server's own sentence", () => {
    assert.equal(sharedDetailHolder('"https://linktr.ee/alice" already belongs to "T H2 Alice" in Creators. Open that record instead.'), "T H2 Alice");
    assert.equal(sharedDetailHolder('"@Palm.Court" already belongs to "Palm "Court" Kitchen" in Hosts. Open that record instead.'), 'Palm "Court" Kitchen');
    for (const none of ["", null, undefined, "That didn't save.", 'already belongs to "x" in Somewhere.']) assert.equal(sharedDetailHolder(none), "");
  });
  it("lifting a contact rule puts focus back on the rule menu once the save has ended", () => {
    const RULE = read("components/crm/ContactRuleField.jsx");
    // A save (Enter or the button), refused or not, does the same.
    assert.ok(/focusRule\.current = true;\s*send\(\{ contact_rule: rule, contact_rule_reason: reason\.trim\(\) \}\);/.test(RULE));
    assert.ok(/useEffect\(\(\) => \{\s*if \(busy \|\| asking \|\| !focusRule\.current\) return;\s*focusRule\.current = false;\s*selectRef\.current\?\.focus\(\);\s*\}, \[busy, asking\]\);/.test(RULE));
    assert.ok(/const lift = async \(\) => \{\s*focusRule\.current = true;\s*setAsking\(false\);\s*await send\(\{ contact_rule: null \}\);\s*\};/.test(RULE));
    assert.ok(/const keep = \(\) => \{\s*focusRule\.current = true;/.test(RULE));
    // Nothing asks a control that is still busy to take focus.
    assert.equal(/await send\([^)]*\);\s*selectRef\.current\?\.focus\(\);/.test(RULE), false);
  });
});

describe("#3802 C-7: City missing?", () => {
  it("an owner or admin is sent to Place Pool; everyone else is told who to ask", () => {
    assert.deepEqual(missingCityWords(true), {
      text: "Cities come from Launch Cities. Add the city in Place Pool: it opens in a new tab, so what you have typed here stays. The city is added as not live; press Refresh regions here afterwards.",
      primary: "Open Place Pool",
      secondary: "Cancel",
      refresh: "Refresh regions",
      blocked: "Your browser blocked the new tab. Allow pop-ups for this site, or open Place Pool yourself:",
    });
    const other = missingCityWords(false);
    assert.equal(other.text, "Cities come from Launch Cities, which an owner or admin manages. Ask one of them to add it. Until then, leave the region empty and put the city in a note.");
    assert.equal(other.primary, "OK");
    assert.equal(other.secondary, "");
  });
  it("every button does something, and focus comes back to the menu", () => {
    const LAYER = read("components/crm/MissingCityLayer.jsx");
    // A browser that blocks the new tab never sends this tab there: the panel says so and offers a link.
    assert.ok(LAYER.includes("assign: () => {\n                      refused = true;"));
    assert.ok(LAYER.includes("setBlocked(refused);"));
    assert.ok(/\{blocked && \([\s\S]{0,200}\{words\.blocked\}\{" "\}\s*<a\s+ref=\{linkRef\}\s+href=\{placePool\}\s+target="_blank"/.test(LAYER));
    assert.equal(missingCityWords(true).blocked, "Your browser blocked the new tab. Allow pop-ups for this site, or open Place Pool yourself:");
    // Place Pool opens beside this page: nothing typed in the form behind it is lost.
    assert.ok(LAYER.includes("const placePool = `${window.location.pathname}${window.location.search}#/placepool`;") && LAYER.includes("openExternal(placePool, {"));
    assert.ok(LAYER.includes('import { openExternal } from "../../lib/openExternal";'), "through the package's one owner of a new tab");
    assert.equal(/window\.location\.hash\s*=|window\.location\.assign|window\.location\.href\s*=/.test(LAYER), false, "this page is never navigated away from");
    assert.ok(LAYER.includes("onClick={onRefresh}") && LAYER.includes("onClick={onClose}"));
    assert.equal((LAYER.match(/<Button/g) || []).length, 4);
    assert.equal((LAYER.match(/onClick=/g) || []).length, 4, "no button without an action");
    assert.ok(/if \(e\.key === "Escape"\) \{\s*e\.stopPropagation\(\);\s*onClose\(\);/.test(LAYER));
    assert.ok(LAYER.includes("firstRef.current?.focus();"));
    for (const b of LAYER.split("<Button").slice(1)) assert.ok(/max-sm:h-11/.test(b.slice(0, b.indexOf("</Button>"))));
    // Place Pool is a real page of this app.
    // #4130: #/placepool opens the Place pool page, whose first tab is the old page.
    // #4130 (Wave 4b): Place pool is a real page; the old page draws its tools.
    assert.ok(/placepool: PlacePoolPage/.test(read("App.jsx")));
    assert.ok(/<PlacePoolManagementPage key="browse" section="browse" \/>/.test(read("pages/PlacePoolPage.jsx")));
  });
  it("it is the last row of the region menu in the toolbar, the Add form and the drawer, and is never taken as a region", () => {
    const FIELDS = read("components/crm/fields.jsx");
    assert.ok(FIELDS.includes('export const MISSING_CITY = "__city_missing__";') && FIELDS.includes('export const MISSING_CITY_LABEL = "City missing?";'));
    for (const f of ["PipelineToolbar.jsx", "AddRecordForm.jsx", "RecordDrawer.jsx"]) {
      const src = read(`components/crm/${f}`);
      assert.ok(src.includes("regionOptions.push({ value: MISSING_CITY, label: MISSING_CITY_LABEL });"), f);
      assert.ok(/if \(e\.target\.value === MISSING_CITY\) setCityMissing\(true\);\s*else /.test(src), `${f}: choosing it opens the panel and changes nothing`);
      assert.ok(/setCityMissing\(false\);\s*regionRef\.current\?\.focus\(\);/.test(src), `${f}: closing returns focus`);
      assert.ok(src.includes("<MissingCityLayer"), f);
    }
    // The row is added after every real region.
    const TOOLBAR = read("components/crm/PipelineToolbar.jsx");
    assert.ok(TOOLBAR.indexOf('label: "No region yet"') < TOOLBAR.indexOf("regionOptions.push({ value: MISSING_CITY"));
    const PAGE = read("pages/PipelinePage.jsx");
    assert.equal((PAGE.match(/canAddRegion=\{!!config\?\.me\?\.can_add_region\}/g) || []).length, 2);
    assert.equal((PAGE.match(/onRefreshRegions=\{cfg\.retry\}/g) || []).length, 3);
    assert.ok(read("components/crm/RecordDrawer.jsx").includes("canAddRegion={!!config.me?.can_add_region}"));
  });
});

describe("#3802 C-8: source contracts", () => {
  const files = walk(SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`) && /\.(js|jsx)$/.test(f));
  it("no ICP id is written in the client: Experience host arrives with the server's list", () => {
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      // (An address example in a comment may name an older ICP; the new one is nowhere.)
      assert.equal(src.includes("experience_host"), false, `${path.relative(SRC, f)} names experience_host`);
      assert.equal(/Experience host/.test(src), false, `${path.relative(SRC, f)} writes the label itself`);
    }
    // Every ICP list on screen is drawn from the pipeline definition.
    assert.ok(read("components/crm/PipelineToolbar.jsx").includes("(def?.icps || []).map((i) => ({ value: i.id, label: i.label }))"));
    assert.ok(read("components/crm/AddRecordForm.jsx").includes("options={opt(def.icps)}"));
    assert.ok(read("components/crm/RecordDrawer.jsx").includes("options={opt(def.icps)}"));
  });
  it("the two services are still the only callers of the server, and nothing here reaches a table", () => {
    const crm = files.filter((f) => /rpc\(\s*["'`]crm_/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
    assert.deepEqual(crm, [path.join("services", "crmService.js")]);
    for (const f of ["IdentifiersField.jsx", "ContactRuleField.jsx", "MissingCityLayer.jsx"]) {
      const src = stripComments(read(`components/crm/${f}`));
      assert.equal(/lib\/supabase|\.from\(|\.rpc\(|fetch\(|localStorage|sessionStorage/.test(src), false, f);
      assert.equal(/dangerouslySetInnerHTML/.test(src), false, f);
      const buttons = src.split("<Button").slice(1).map((rest) => rest.slice(0, rest.indexOf("</Button>")));
      for (const b of buttons) assert.ok(/max-sm:h-11/.test(b), `${f}: a button is under 44px on a phone: ${b.slice(0, 50)}`);
    }
  });
  it("a record's identifiers are saved the moment they change, through the same update the other fields use", () => {
    const DRAWER = read("components/crm/RecordDrawer.jsx");
    assert.ok(/const saveExtra = useCallback\(\s*async \(changes\) => \{[\s\S]*await pipe\.update\(before\.id, changes\);/.test(DRAWER));
    assert.ok(DRAWER.includes("value={record.identifiers}"));
  });
});
