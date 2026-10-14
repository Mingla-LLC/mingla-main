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
  recordOpenLabel,
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
  const block = SQL.slice(SQL.indexOf("insert into t3802b_forms values"), SQL.indexOf("do $b4$"));
  const rows = [...block.matchAll(/^\s*\('(email|phone|handle)', '((?:[^']|'')*)', '((?:[^']|'')*)'\)[,;]$/gm)].map((m) => ({
    kind: m[1],
    value: m[2].replace(/''/g, "'"),
    want: m[3].replace(/''/g, "'"),
  }));
  it("the shared table was read: at least 24 plain rows, of all three kinds", () => {
    assert.ok(rows.length >= 24, `only ${rows.length} rows were read`);
    for (const kind of ["email", "phone", "handle"]) assert.ok(rows.filter((r) => r.kind === kind).length >= 7, kind);
    assert.ok(rows.some((r) => r.want === "-"), "it holds values that are not usable");
    // The four examples the migration checks itself against are in it.
    for (const [kind, value, want] of [
      ["email", " A@B.co ", "a@b.co"],
      ["phone", "+234 (803) 555-0101", "2348035550101"],
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
    assert.equal(identKey("email", `${"a".repeat(250)}@b.co`), null, "longer than 254");
    assert.equal(identKey("phone", "1".repeat(16)), null);
    assert.equal(identKey("phone", "1".repeat(15)), "1".repeat(15));
    assert.equal(identKey("fax", "12345678"), null);
    for (const none of [null, undefined, 7, {}, []]) {
      assert.equal(identKey("email", none), null);
      assert.equal(identKey(none, "a@b.co"), null);
    }
  });
  it("the migration's own function is written the way this one is", () => {
    const MIG = fs.readFileSync(path.join(REPO, "supabase", "migrations", "20270831003802_issue_3802_wave4_agent_write_setup.sql"), "utf8");
    const fn = /CREATE FUNCTION public\.crm_ident_key\([\s\S]*?\n\$\$;/.exec(MIG)[0];
    const LIB = read("lib/crmModel.js");
    // The same list of profile addresses, in the same order.
    const sqlHosts = /'\^\(([^)]*)\)'/.exec(fn)[1].replace(/\[\.\]/g, ".").split("|");
    const jsHosts = /const HANDLE_HOSTS =\s*\/\^\(([^)]*)\)\//.exec(LIB)[1].replace(/\\\./g, ".").replace(/\\\//g, "/").split("|");
    assert.deepEqual(jsHosts, sqlHosts);
    assert.equal(sqlHosts.length, 11);
    // The same limits.
    assert.ok(fn.includes("BETWEEN 7 AND 15") && fn.includes("<= 254") && fn.includes("{2,60}"));
    assert.ok(LIB.includes("v.length >= 7 && v.length <= 15") && LIB.includes("<= 254") && LIB.includes("{2,60}"));
    // Only A to Z are lower-cased, on both sides, so the two cannot differ by locale.
    assert.ok(fn.includes("'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'"));
    assert.ok(LIB.includes("const asciiLower = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());"));
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
    assert.deepEqual(hit, { id: "r1", name: "Palm Court Kitchen", byIdentifier: true, line: "Looks like Palm Court Kitchen (same email)", rule: "" });
    assert.equal(contactHit({ verdict: "exists", match: "identifier", record, matched_on: [{ kind: "phone", rule: "last_9_digits" }] }).line, "Looks like Palm Court Kitchen (same phone number)");
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
  it("a refusal that names another record lets the drawer open it", () => {
    const DRAWER = read("components/crm/RecordDrawer.jsx");
    assert.ok(DRAWER.includes('return { message: errorWords(err), existingId: err?.token === "duplicate_identifier" ? err.detail || "" : "" };'));
    assert.ok(DRAWER.includes("onChange={(list) => saveExtra({ identifiers: identifiersToSend(list) })}") && DRAWER.includes("onOpenRecord={onOpenCard}"));
    const FIELD = read("components/crm/IdentifiersField.jsx");
    assert.ok(/\{problem\.existingId && onOpenRecord && \([\s\S]*onClick=\{\(\) => onOpenRecord\(problem\.existingId\)\}>\s*Open that record\s*<\/Button>/.test(FIELD));
    assert.ok(FIELD.includes('placeholder="Add an email, a phone number or a handle"'));
    assert.ok(FIELD.includes("flex h-11 w-11"), "the remove button is a 44px target");
    assert.ok(/aria-label=\{`Remove \$\{identLabel\(item\)\.toLowerCase\(\)\} \$\{item\.value\}`\}/.test(FIELD));
    assert.ok(FIELD.includes("Change") && FIELD.includes('aria-label="Where the handle is from"'));
  });
});

describe("#3802 C-7: City missing?", () => {
  it("an owner or admin is sent to Place Pool; everyone else is told who to ask", () => {
    assert.deepEqual(missingCityWords(true), {
      text: "Cities come from Launch Cities. Add the city in Place Pool; it is added as not live, and appears here straight away.",
      primary: "Open Place Pool",
      secondary: "Cancel",
      refresh: "Refresh regions",
    });
    const other = missingCityWords(false);
    assert.equal(other.text, "Cities come from Launch Cities, which an owner or admin manages. Ask one of them to add it. Until then, leave the region empty and put the city in a note.");
    assert.equal(other.primary, "OK");
    assert.equal(other.secondary, "");
  });
  it("every button does something, and focus comes back to the menu", () => {
    const LAYER = read("components/crm/MissingCityLayer.jsx");
    assert.ok(/onClick=\{\(\) => \{\s*window\.location\.hash = "#\/placepool";\s*\}\}/.test(LAYER));
    assert.ok(LAYER.includes("onClick={onRefresh}") && LAYER.includes("onClick={onClose}"));
    assert.equal((LAYER.match(/<Button/g) || []).length, 4);
    assert.equal((LAYER.match(/onClick=/g) || []).length, 4, "no button without an action");
    assert.ok(/if \(e\.key === "Escape"\) \{\s*e\.stopPropagation\(\);\s*onClose\(\);/.test(LAYER));
    assert.ok(LAYER.includes("firstRef.current?.focus();"));
    for (const b of LAYER.split("<Button").slice(1)) assert.ok(/max-sm:h-11/.test(b.slice(0, b.indexOf("</Button>"))));
    // Place Pool is a real page of this app.
    assert.ok(/placepool: PlacePoolManagementPage/.test(read("App.jsx")));
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
