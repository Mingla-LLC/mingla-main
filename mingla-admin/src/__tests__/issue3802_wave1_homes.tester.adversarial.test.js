// Issue #3802 (Wave 1) — role homes, monthly targets, Beta leads, invite
// follow-ups: INDEPENDENT TESTER proof for the admin app.
//
// A different angle from the implementor suite beside this file. That suite
// checks each helper with the inputs it was written for. This one feeds them
// what they were not written for:
//
//   TA-1  the name key against answers taken from the real database, for
//         names the first suite does not use
//   TA-2  the two new address readers under hostile and random input
//   TA-3  access for every combination of areas and every status, including a
//         role that holds the pipelines but not Beta leads
//   TA-4  the words for "Add to Hosts" under every combination of answers,
//         and under answers that are not answers
//   TA-5  the number helpers under numbers that are not numbers
//   TA-6  the stale-card sentence over every pair of stages, with and without
//         a name and a time
//   TA-7  the accept screen's address and message under hostile addresses,
//         and where the link's secret may and may not go
//   TA-8  every way a card moves ends in the one call that names the stage
//   TA-9  no raw database error reaches the screen for the new calls
//
// Fails-on-revert is recorded on the issue.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  betaConvertMessage,
  betaLeadButton,
  betaSuggestionLine,
  dueTotals,
  errorWords,
  freshnessVerdict,
  funnelRows,
  loadErrorWords,
  nameKey,
  parseServerError,
  parseTarget,
  targetPill,
  weekIsEmpty,
  weekRows,
} from "../lib/crmModel.js";
import { buildBetaSearch, buildTeamSearch, parseBetaSearch, parseCrmHash, parseTeamSearch, targetSliceHash } from "../lib/crmUrl.js";
import { AREA, areaForPage, canOpenPage, homePageFor, resolveRoute, visibleNavGroups } from "../lib/access.js";
import { NAV_GROUPS } from "../lib/constants.js";
import { ACCEPT_COPY, acceptBody, acceptConflictMessage } from "../lib/inviteLink.js";

const __filename = fileURLToPath(import.meta.url);
const SRC = path.resolve(path.dirname(__filename), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const cp = (...points) => String.fromCodePoint(...points);

/** Every .js and .jsx file under src, except tests: [relative path, text]. */
function sources(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") sources(full, out);
    } else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) {
      out.push([path.relative(SRC, full), fs.readFileSync(full, "utf8")]);
    }
  }
  return out;
}

// A small generator with a fixed seed, so a failure can be repeated.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("#3802 TA-1: the name key, against what the database answered", () => {
  // Each of these was sent to the real server function on PostgreSQL 17 and
  // refused as "not a name": the key was empty.
  const NOTHING = [
    ["a blank braille cell", cp(0x2800)],
    ["three blank cells and a tag", cp(0x2800, 0x2800, 0x2800, 0xe007f)],
    ["the language tag", cp(0xe0001)],
    ["tag letters", cp(0xe0041, 0xe0042)],
    ["the last variation selector", cp(0xe01ef)],
    ["two variation selectors", cp(0xfe0f, 0xe0100)],
    ["musical beam marks", cp(0x1d173, 0x1d17a)],
    ["a lone acute accent", cp(0x301)],
    ["a space, an accent, a space", ` ${cp(0x301)} `],
    ["a spacing diaeresis", cp(0xa8)],
    ["a lone enclosing circle", cp(0x20dd)],
    ["four Hangul fillers", cp(0x3164, 0xffa0, 0x115f, 0x1160)],
    ["direction marks only", cp(0x202e, 0x2066, 0x2069)],
    ["a joiner and a selector", cp(0x200d, 0xfe0f)],
    ["a soft hyphen and a no-break space", cp(0xad, 0xa0)],
    ["hieroglyph format marks", cp(0x13430, 0x1343f)],
    ["a shorthand format mark", cp(0x1bca0)],
    ["a Kaithi number sign", cp(0x110bd)],
  ];
  for (const [label, name] of NOTHING) {
    it(`${label} has no key`, () => assert.equal(nameKey(name), ""));
  }

  // Each pair was one record on the server: the second spelling was answered
  // as a duplicate of the first.
  const SAME = [
    ["composed and decomposed accent", `Caf${cp(0xe9)}`, `Cafe${cp(0x301)}`],
    ["full-width and plain letters", "XB4 Wide", cp(0xff38, 0xff22, 0xff14, 0x20, 0xff37, 0xff49, 0xff44, 0xff45)],
    ["a ligature", "XB4 fish", `XB4 ${cp(0xfb01)}sh`],
    ["tag characters inside", "XB4 Tagged", `XB4${cp(0xe0041)} Tag${cp(0xe0062)}ged`],
    ["a blank braille cell inside", "XB4 Braille", `XB4${cp(0x2800)}Braille`],
    ["a musical mark inside", "XB4 Music", `XB4${cp(0x1d173)}Music`],
    ["a heart with and without its selector", `XB4 ${cp(0x2764)}`, `XB4 ${cp(0x2764, 0xfe0f)}`],
    ["the angstrom sign and a decomposed umlaut", `XB4 ${cp(0xc5)}ngstr${cp(0xf6)}m`, `XB4 ${cp(0x212b)}ngstro${cp(0x308)}m`],
    ["half-width and full-width kana", `XB4 ${cp(0x30ab)}`, `XB4 ${cp(0xff76)}`],
    ["a superscript digit", "XB4 x2", `XB4 x${cp(0xb2)}`],
    ["a circled digit", "XB4 no 1", `XB4 no ${cp(0x2460)}`],
    ["a no-break and an ideographic space", "XB4 nb sp", `XB4${cp(0xa0)}nb${cp(0x3000)}sp`],
    ["joiners inside a word", "XB4 joined", `XB4 jo${cp(0x200d)}in${cp(0x200c)}ed`],
    ["case, spacing and a leading @", "@Palm.Court  KITCHEN", "palm court kitchen"],
  ];
  for (const [label, a, b] of SAME) {
    it(`${label}: one key`, () => {
      assert.notEqual(nameKey(a), "");
      assert.equal(nameKey(a), nameKey(b));
    });
  }

  it("letters of two alphabets that look alike keep two keys", () => {
    assert.notEqual(nameKey("XB4 AB"), nameKey(`XB4 ${cp(0x410, 0x412)}`));
  });

  it("names in many scripts, emoji and symbols all have a key", () => {
    const names = [
      cp(0x645, 0x637, 0x639, 0x645),
      cp(0x5d1, 0x5b5, 0x5bc, 0x5d9, 0x5ea),
      cp(0xe23, 0xe49, 0xe32, 0xe19),
      cp(0x926, 0x93f, 0x932, 0x94d, 0x932, 0x940),
      cp(0x6771, 0x4eac),
      cp(0xd55c, 0xad6d),
      cp(0x1f355, 0x1f37a),
      cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
      cp(0x1f1f3, 0x1f1ec),
      cp(0x1f44d, 0x1f3fd),
      `a${cp(0x301)}`,
      "&&&",
      "7",
    ];
    for (const name of names) assert.notEqual(nameKey(name), "", [...name].map((c) => c.codePointAt(0).toString(16)).join(" "));
  });

  it("the key is the same however many times it is taken, and never throws on odd input", () => {
    for (const name of [...SAME.flat().filter((x) => x.includes(" ")), "", " ", cp(0xd800), `x${cp(0xdfff)}y`, "a".repeat(5000)]) {
      const once = nameKey(name);
      assert.equal(nameKey(once), nameKey(nameKey(once)));
    }
    for (const odd of [null, undefined, 7, {}, [], true]) assert.doesNotThrow(() => nameKey(odd));
  });
});

describe("#3802 TA-2: the two new address readers under hostile input", () => {
  const HOSTILE = [
    "person=<img src=x onerror=alert(1)>",
    "person=javascript:alert(1)@x.y",
    "person=%3Cscript%3E@x.y",
    "person=a@b&person=c@d",
    "person[]=a@b.c",
    "person=a@b.c%0d%0aSet-Cookie:x",
    "person=a%20b@c.d",
    "person=@",
    "person=a@",
    "person=@b",
    "person=a@@b",
    `person=${"a".repeat(65)}@b.c`,
    `person=a@${"b".repeat(191)}`,
    "person=a@b.c#/admin",
    "person=a@b.c?x=1",
    "person=a=b@c.d",
    "__proto__[person]=a@b.c",
    "constructor.prototype.person=a@b.c",
    "%E0%A4%A",
    "person=%",
    "show=<script>",
    "show=NEW",
    "show=new%00",
    "show=new ",
    "show[]=new",
    "show=all&show=new",
    "__proto__[show]=new",
  ];

  it("the person filter is a plain lower-case address or nothing, whatever is in the address bar", () => {
    for (const q of HOSTILE) {
      let got;
      assert.doesNotThrow(() => {
        got = parseTeamSearch(q);
      }, q);
      assert.deepEqual(Object.keys(got), ["person"], q);
      assert.ok(got.person === "" || /^[^\s@?&#=]{1,64}@[^\s@?&#=]{1,190}$/.test(got.person), `${q} -> ${got.person}`);
      // Whatever it is, it goes back into the address encoded: no raw markup.
      assert.ok(!/[<>"'\s]/.test(buildTeamSearch(got)), `${q} -> ${buildTeamSearch(got)}`);
      assert.equal(got.person, got.person.toLowerCase());
      // What is written back is read back the same.
      assert.deepEqual(parseTeamSearch(buildTeamSearch(got)), got, q);
    }
    assert.equal(parseTeamSearch("person=<img src=x onerror=alert(1)>").person, "");
    assert.equal(parseTeamSearch("person=a%20b@c.d").person, "");
    assert.equal(parseTeamSearch("person=a@b.c#/admin").person, "");
    assert.equal(parseTeamSearch("person=MAYA@Mingla.Test").person, "maya@mingla.test");
    assert.equal(parseTeamSearch("person=a@b&person=c@d").person, "a@b");
    assert.equal({}.person, undefined);
  });

  it("the New filter is exactly 'new' or it is everything", () => {
    for (const q of HOSTILE) {
      let got;
      assert.doesNotThrow(() => {
        got = parseBetaSearch(q);
      }, q);
      assert.ok(got.show === "all" || got.show === "new", q);
      assert.ok(["", "show=new"].includes(buildBetaSearch(got)));
    }
    for (const q of ["show=NEW", "show=new%00", "show=new ", "show[]=new", "show=<script>", "__proto__[show]=new", ""]) {
      assert.equal(parseBetaSearch(q).show, "all", q);
    }
    assert.equal(parseBetaSearch("show=new").show, "new");
    assert.equal({}.show, undefined);
  });

  it("things that are not text are read as nothing", () => {
    for (const odd of [null, undefined, 7, {}, [], () => "person=a@b.c", { toString: () => "person=a@b.c" }]) {
      assert.deepEqual(parseTeamSearch(odd), { person: "" });
      assert.deepEqual(parseBetaSearch(odd), { show: "all" });
      assert.equal(buildTeamSearch(odd), "");
      assert.equal(buildBetaSearch(odd), "");
    }
    assert.equal(buildTeamSearch({ person: "not an address" }), "");
    assert.equal(buildTeamSearch({ person: "<b>@x.y" }).includes("<"), false);
  });

  it("three thousand random strings never throw, never pollute and always round-trip", () => {
    const rand = seeded(3802);
    const alphabet = ["a", "Z", "@", ".", "=", "&", "?", "#", "%", "<", ">", " ", "\n", "person", "show", "new", "[", "]", "__proto__", cp(0x2800), cp(0x202e), "%E0", "+"];
    for (let i = 0; i < 3000; i++) {
      let q = "";
      const n = 1 + Math.floor(rand() * 9);
      for (let k = 0; k < n; k++) q += alphabet[Math.floor(rand() * alphabet.length)];
      const team = parseTeamSearch(q);
      const beta = parseBetaSearch(q);
      assert.deepEqual(parseTeamSearch(buildTeamSearch(team)), team, JSON.stringify(q));
      assert.deepEqual(parseBetaSearch(buildBetaSearch(beta)), beta, JSON.stringify(q));
      assert.ok(!/\s/.test(team.person), JSON.stringify(q));
      assert.ok(!/[<>"'\s]/.test(buildTeamSearch(team)), JSON.stringify(q));
    }
    assert.equal(Object.prototype.person, undefined);
    assert.equal(Object.prototype.show, undefined);
  });

  it("a target's slice is built only from an ICP and a region the board itself would accept", () => {
    assert.equal(targetSliceHash("event_organizer", "lagos"), "#/hosts?icp=event_organizer&region=lagos");
    for (const [icp, region] of [["<script>", "lagos"], ["event_organizer", "la gos"], ["a&card=new", "x"], ["x", "y#/admin"], [null, undefined]]) {
      const hash = targetSliceHash(icp, region);
      assert.ok(hash.startsWith("#/hosts"), hash);
      assert.ok(!/[<>\s]/.test(hash), hash);
      const back = parseCrmHash(hash);
      assert.equal(back.card, "", `${hash} must never open a card`);
    }
  });
});

describe("#3802 TA-3: access for every combination of areas", () => {
  const AREAS = Object.values(AREA);
  const person = (areas, status = "active", role = "growth") => ({ email: "x@test.local", role, status, areas });
  const subsets = [];
  for (let mask = 0; mask < 1 << AREAS.length; mask++) subsets.push(AREAS.filter((_, i) => mask & (1 << i)));

  it("there are five areas, and Beta leads is one of them", () => {
    assert.deepEqual([...AREAS].sort(), ["admin_console", "beta_leads", "crm", "role_home", "team_manage"]);
  });

  it("Beta leads opens with its own area and with nothing else; the Team dashboard only with the admin area", () => {
    for (const areas of subsets) {
      const p = person(areas);
      assert.equal(canOpenPage(p, "beta-leads"), areas.includes("beta_leads"), areas.join(","));
      assert.equal(canOpenPage(p, "team-dashboard"), areas.includes("admin_console"), areas.join(","));
      assert.equal(canOpenPage(p, "hosts"), areas.includes("crm"), areas.join(","));
      assert.equal(canOpenPage(p, "home"), areas.includes("role_home"), areas.join(","));
      assert.equal(canOpenPage(p, "admin"), areas.includes("team_manage"), areas.join(","));
    }
  });

  it("a role with the pipelines but not Beta leads sees no Beta Leads in the menu and is sent home from its address", () => {
    const p = person(["role_home", "crm"]);
    const ids = visibleNavGroups(NAV_GROUPS, p).flatMap((g) => g.items.map((i) => i.id));
    assert.deepEqual(ids, ["home", "hosts", "creators"]);
    const known = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    assert.deepEqual(resolveRoute("beta-leads", p, known), { pageId: homePageFor(p), denied: true, requestedId: "beta-leads" });
    assert.deepEqual(resolveRoute("team-dashboard", p, known), { pageId: "home", denied: true, requestedId: "team-dashboard" });
    assert.deepEqual(resolveRoute("hosts", p, known), { pageId: "hosts", denied: false, requestedId: "hosts" });
  });

  it("a role with Beta leads but not the pipelines sees Beta Leads and no board", () => {
    const p = person(["role_home", "beta_leads"]);
    const ids = visibleNavGroups(NAV_GROUPS, p).flatMap((g) => g.items.map((i) => i.id));
    assert.deepEqual(ids, ["home", "beta-leads"]);
  });

  it("someone invited, removed or of unknown status opens nothing, whatever areas they are said to hold", () => {
    for (const status of ["invited", "revoked", "", "ACTIVE", " active", null, undefined, true]) {
      const p = { email: "x@test.local", role: "owner", status, areas: AREAS };
      for (const page of ["home", "team-dashboard", "beta-leads", "hosts", "creators", "admin", "overview"]) {
        assert.equal(canOpenPage(p, page), false, `${status} ${page}`);
      }
      assert.deepEqual(visibleNavGroups(NAV_GROUPS, p), []);
    }
    for (const nobody of [null, undefined, {}, { status: "active" }, { status: "active", areas: "admin_console" }]) {
      assert.equal(canOpenPage(nobody, "team-dashboard"), false);
      assert.equal(canOpenPage(nobody, "beta-leads"), false);
    }
  });

  it("page ids that look like the new ones do not borrow their access", () => {
    for (const id of ["Beta-Leads", "beta_leads", "beta-leads ", "beta-leads/", "team_dashboard", "TEAM-DASHBOARD", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      assert.equal(areaForPage(id), AREA.ADMIN_CONSOLE, id);
      assert.equal(canOpenPage(person(["role_home", "crm", "beta_leads"]), id), false, id);
    }
  });
});

describe("#3802 TA-4: the words for Add to Hosts, whatever comes back", () => {
  const STATUSES = ["created", "exists", "linked", "duplicate", "CREATED", "", null, undefined, 7, "error", "__proto__"];
  const NOTES = ["set", "none", "several", "not_launch_city", "ambiguous", "", null, undefined, 3, "<b>"];
  const CITIES = ["Lagos", "", null, undefined, "<img src=x onerror=1>", "O'Brien's Town", 42, "a".repeat(300)];

  it("every combination gives a variant, a title in words and a description that is text", () => {
    let n = 0;
    for (const status of STATUSES) for (const icp_note of NOTES) for (const region_note of NOTES) for (const city of CITIES) {
      const m = betaConvertMessage({ status, record: { id: "1", name: "Palm Court" }, icp_note, region_note, city }, "Fallback");
      n++;
      assert.ok(["success", "info", "error"].includes(m.variant), `${status}`);
      assert.equal(typeof m.title, "string");
      assert.equal(typeof m.description, "string");
      assert.ok(m.title.trim().split(/\s+/).length >= 3, m.title);
      assert.ok(!/undefined|null|NaN|\[object|__proto__/.test(m.title + m.description), `${status}/${icp_note}/${region_note}/${String(city).slice(0, 12)}: ${m.title} ${m.description}`);
      // Only the four real statuses ever read as good news.
      if (m.variant !== "error") assert.ok(["created", "exists", "linked", "duplicate"].includes(status), String(status));
      if (status === "created") {
        assert.equal(m.variant, "success");
        const carried = icp_note === "set" && region_note === "set";
        assert.equal(m.description === "ICP and region carried over. You are the owner.", carried, `${icp_note}/${region_note}`);
        if (icp_note !== "set") assert.match(m.description, /ICP/);
        if (region_note !== "set") assert.match(m.description, /region/i);
      }
    }
    assert.equal(n, STATUSES.length * NOTES.length * NOTES.length * CITIES.length);
  });

  it("an answer that is not an answer is an error in words, never a thrown one", () => {
    for (const odd of [null, undefined, "", 7, [], {}, { status: "created" }, { record: null }, { status: "created", record: {} }]) {
      let m;
      assert.doesNotThrow(() => {
        m = betaConvertMessage(odd, "");
      });
      assert.ok(m.title.length > 10);
      assert.ok(!/undefined|null/.test(m.title + m.description));
    }
    assert.equal(betaConvertMessage({ status: "created", record: {}, icp_note: "set", region_note: "set" }, "Fallback Name").title, "Fallback Name added to Hosts");
    assert.equal(betaConvertMessage({ status: "exists" }, "").title, "This lead is already in Hosts");
  });

  it("a row offers Open host only for a host with a real id", () => {
    for (const lead of [null, undefined, {}, { host: null }, { host: {} }, { host: { id: "" } }, { host: { id: 7 } }, { host: { id: null, name: "x" } }, { host: "abc" }, { host: [] }]) {
      assert.equal(betaLeadButton(lead), "add", JSON.stringify(lead));
    }
    assert.equal(betaLeadButton({ host: { id: "0c0c" } }), "open");
  });

  it("the line under Add to Hosts never promises what the server did not", () => {
    const line = (s) => betaSuggestionLine({ suggested: s });
    assert.equal(line({ icp_note: "set", icp_label: "Restaurant or bar", region_note: "set", region_name: "Lagos" }), `As Restaurant or bar ${cp(183)} Lagos`);
    // A note of "set" with nothing to show, or a label with a note that is not "set", promises nothing.
    for (const s of [undefined, null, {}, { icp_note: "set" }, { icp_label: "Restaurant or bar" }, { icp_note: "several", icp_label: "Restaurant or bar" }, { icp_note: "none", icp_label: "x", region_note: "ambiguous", region_name: "Lagos" }, { region_note: "not_launch_city", region_name: "Lagos" }]) {
      assert.equal(line(s), `ICP to pick on the card ${cp(183)} Region to pick on the card`, JSON.stringify(s));
    }
    assert.doesNotThrow(() => betaSuggestionLine(null));
  });
});

describe("#3802 TA-5: the number helpers under numbers that are not numbers", () => {
  const ODD = [null, undefined, "", "abc", NaN, Infinity, -Infinity, -1, -0.5, {}, [], "7", 7.9, "1e3", true];

  it("what is due is never negative, never a fraction and never not-a-number", () => {
    for (const a of ODD) for (const b of ODD) {
      const t = dueTotals({ overdue: a, today: b });
      for (const v of [t.overdue, t.today, t.total]) assert.ok(Number.isInteger(v) && v >= 0, `${String(a)} ${String(b)} -> ${v}`);
      assert.equal(t.total, t.overdue + t.today);
    }
    assert.deepEqual(dueTotals(null), { overdue: 0, today: 0, total: 0 });
    assert.deepEqual(dueTotals({ overdue: "3", today: 2.9 }), { overdue: 3, today: 2, total: 5 });
  });

  it("a pill is only green when the target is real and reached", () => {
    for (const a of ODD) for (const b of ODD) assert.ok(["success", "warning", "default"].includes(targetPill(a, b)));
    assert.equal(targetPill(5, 0), "warning");
    assert.equal(targetPill(5, null), "warning");
    assert.equal(targetPill(0, 0), "default");
    assert.equal(targetPill(Infinity, 3), "default");
    assert.equal(targetPill(3, 3), "success");
    assert.equal(targetPill(2, 3), "warning");
    assert.equal(targetPill(-4, 3), "default");
  });

  it("a bar is between nothing and full width, and a stage with nobody in it is nothing", () => {
    const rand = seeded(11);
    for (let i = 0; i < 300; i++) {
      const stages = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, k) => ({ id: `s${k}`, label: `S${k}`, count: ODD.concat([0, 0, 1, 5, 4000])[Math.floor(rand() * (ODD.length + 5))] }));
      const rows = funnelRows(stages);
      assert.equal(rows.length, stages.length);
      for (const r of rows) {
        assert.ok(r.width >= 0 && r.width <= 100, JSON.stringify(r));
        // Nobody in a stage is no bar at all. (A stage holding under one
        // two-thousandth of the largest rounds down to no bar too.)
        if (r.count === 0) assert.equal(r.width, 0, JSON.stringify(r));
        if (r.width === 0 && r.count > 0) assert.ok(r.count * 2000 < Math.max(...rows.map((x) => x.count)), JSON.stringify(r));
        assert.ok(Number.isInteger(r.count) && r.count >= 0);
      }
      if (rows.some((r) => r.count > 0)) assert.ok(rows.some((r) => r.width === 100));
    }
    for (const odd of [null, undefined, "x", 7, {}]) assert.deepEqual(funnelRows(odd), []);
    assert.deepEqual(funnelRows([null, undefined, {}]).map((r) => r.count), [0, 0, 0]);
  });

  it("this week by person drops rows with no address and never invents a count", () => {
    const rows = weekRows([null, {}, { email: "" }, { email: 7 }, { email: "maya@x.co", touches: "4", stage_moves: -2, added: NaN, overdue: 1.9, due_today: null, status: "former" }, { email: "kofi@x.co", status: "invited" }]);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.email, r.touches, r.stageMoves, r.added, r.overdue, r.dueToday, r.former, r.invited]),
      [["maya@x.co", 4, 0, 0, 1, 0, true, false], ["kofi@x.co", 0, 0, 0, 0, 0, false, true]]
    );
    assert.equal(weekIsEmpty(rows), false);
    assert.equal(weekIsEmpty(weekRows([{ email: "a@b.c", overdue: 9, due_today: 9 }])), true);
    for (const odd of [null, undefined, "x", {}]) assert.deepEqual(weekRows(odd), []);
  });

  it("a typed target is digits only: no signs, points, exponents, spaces inside or other digit shapes", () => {
    const table = [
      ["1", 1], ["1000", 1000], [" 12 ", 12], ["0100", 100], ["007", 7],
      ["0", null], ["1001", null], ["10000", null], ["-5", null], ["+5", null], ["2.5", null], ["12.0", null], ["1e3", null], ["0x10", null],
      ["1 2", null], ["", null], [" ", null], ["abc", null], [cp(0xff11, 0xff12), null], [cp(0x661, 0x662), null], ["12\n", 12], [null, null], [undefined, null], [NaN, null], [{}, null], [12, 12], [12.5, null],
    ];
    for (const [typed, want] of table) assert.equal(parseTarget(typed), want, JSON.stringify(typed));
  });
});

describe("#3802 TA-6: the stale-card sentence over every pair of stages", () => {
  const DEF = { stages: ["Prospect", "Contacted", "Replied", "Meeting", "Onboarded", "Live", "Lost"].map((label, i) => ({ id: `s${i}`, label })) };
  const NOW = Date.parse("2026-10-13T12:00:00Z");
  const ENTRIES = (to) => [
    [],
    null,
    [{ kind: "stage_move", to_stage: to, actor_email: "maya@x.co", actor_name: "Maya", occurred_at: "2026-10-13T11:59:30Z" }],
    [{ kind: "stage_move", to_stage: to, actor_email: "maya@x.co", actor_name: "Maya", occurred_at: null }],
    [{ kind: "stage_move", to_stage: to, actor_email: "maya@x.co", actor_name: "", occurred_at: "" }],
    [{ kind: "stage_move", to_stage: to, actor_email: null, actor_name: null, occurred_at: "garbage" }],
    [{ kind: "stage_move", to_stage: to, actor_email: null, actor_name: null, occurred_at: "2026-10-13T09:00:00Z" }],
    [{ kind: "note", body: "unrelated" }],
  ];

  it("whatever the log holds, the words have no gap before a full stop, no double space and nothing unfilled", () => {
    let seen = 0;
    for (const from of DEF.stages) for (const now of DEF.stages) for (const to of DEF.stages) {
      const shown = { id: "1", name: "Palm Court", stage: from.id };
      for (const activity of ENTRIES(now.id)) {
        const v = freshnessVerdict(DEF, shown, { ...shown, stage: now.id }, to.id, activity, NOW);
        assert.ok(["go", "already", "moved"].includes(v.kind), v.kind);
        // A card that has not moved is free to go; one that has is never moved again from where it was.
        assert.equal(v.kind === "go", from.id === now.id, `${from.label} ${now.label} ${to.label}`);
        if (v.kind === "go") continue;
        seen++;
        const words = `${v.title} ${v.description}`;
        assert.ok(!/\s[.,]/.test(words), words);
        assert.ok(!/ {2}/.test(words), words);
        assert.ok(!/undefined|null|NaN|Invalid|s\d\b/.test(words), words);
        assert.ok(words.includes(now.label), words);
        assert.match(v.description, /\.$/);
      }
    }
    assert.ok(seen > 2000, String(seen));
  });
});

describe("#3802 TA-7: the accept screen's address and message, and the link's secret", () => {
  const HOSTILE = [
    "<img src=x onerror=alert(1)>@x.y z",
    "a@b.c\nBcc: everyone@x.y",
    "a b@c.d",
    "a@b@c",
    `${"a".repeat(65)}@b.c`,
    `a@${"b".repeat(191)}`,
    "",
    "   ",
    null,
    undefined,
    7,
    {},
    ["a@b.c"],
    "not an address",
    "a@b.c\t",
  ];

  it("an address that is not plainly one is never shown or put into the message", () => {
    for (const email of HOSTILE.slice(0, 14)) {
      const body = acceptBody("account_conflict", { invitedEmail: email });
      assert.ok(body.startsWith("This address already has a Mingla account"), `${JSON.stringify(email)} -> ${body.slice(0, 40)}`);
      const message = acceptConflictMessage(email);
      assert.ok(message.startsWith("Hi, my Mingla Admin invite can't be used because the address already has"), JSON.stringify(email));
      for (const text of [body, message]) {
        assert.ok(!/[<>\n\t]|Bcc|undefined|null|\[object|\{email\}/.test(text), text);
      }
    }
    // A trailing tab is trimmed; the address is then shown exactly.
    assert.ok(acceptBody("account_conflict", { invitedEmail: "a@b.c\t" }).startsWith("a@b.c already has"));
    assert.ok(acceptConflictMessage("  maya@mingla.test ").includes("invite to maya@mingla.test can't"));
  });

  it("the signed-in address is never mistaken for the invited one", () => {
    // Someone signed in as another person opens a conflicting link: the screen
    // names the invited address, or "This address", never the signed-in one.
    assert.ok(acceptBody("account_conflict", { email: "signed.in@x.y" }).startsWith("This address already"));
    assert.ok(acceptBody("account_conflict", { email: "signed.in@x.y", invitedEmail: "invited@x.y" }).startsWith("invited@x.y already"));
    assert.ok(!acceptBody("account_conflict", { email: "signed.in@x.y", invitedEmail: "invited@x.y" }).includes("signed.in"));
    for (const state of Object.keys(ACCEPT_COPY).filter((s) => s !== "account_conflict")) {
      assert.ok(!acceptBody(state, { email: "signed.in@x.y", invitedEmail: "invited@x.y" }).includes("invited@x.y"), state);
      assert.ok(!acceptBody(state, {}).includes("{email}"), state);
    }
  });

  it("sign-in passes the invited address on for the one state only, and passes nothing else from the answer", () => {
    const AUTH = read("context/AuthContext.jsx");
    const start = AUTH.indexOf("const acceptInvite = async (token) => {");
    const body = AUTH.slice(start, AUTH.indexOf("const completeInviteSetup", start));
    assert.ok(start > 0 && body.length > 400);
    const returns = [...body.matchAll(/return \{([^}]*)\}/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
    // Every answer this function gives is a state, and at most the address.
    for (const r of returns) assert.match(r, /^state: [^,]+(, email: data\.email)?$/, r);
    assert.equal(returns.filter((r) => r.includes("email")).length, 1);
    assert.ok(body.includes('data?.state === "account_conflict" && typeof data.email === "string"'));
    // The link's secret goes to the function and nowhere else in this file.
    assert.equal((body.match(/\btoken\b/g) || []).filter((_, i) => i > 0).length, 1, "the secret is used once after it is received");
    assert.match(body, /body: \{ token \}/);
    assert.ok(!/console\.[a-z]+\([^)]*\btoken\b/.test(body));
    assert.ok(!/(localStorage|sessionStorage)\.setItem\([^)]*\btoken\b/.test(body));
  });

  it("the accept screen keeps the secret in memory only", () => {
    const SCREEN = read("components/InviteAcceptScreen.jsx");
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(SCREEN));
    assert.ok(!/console\.[a-z]+\([^)]*\b(token|secret)\b/.test(SCREEN));
    // The message that is copied is built from the address, never from the link.
    assert.match(SCREEN, /acceptConflictMessage\(/);
    assert.ok(!/acceptConflictMessage\([^)]*\b(token|secret|hash|location)\b/.test(SCREEN));
    assert.ok(!/writeText\([^)]*\b(token|secret|location|href)\b/.test(SCREEN));
  });
});

describe("#3802 TA-8: every way a card moves ends in the one call that names the stage", () => {
  const ALL = sources();

  it("only the service file names the move function, and it sends the expected stage unconditionally", () => {
    const callers = ALL.filter(([, text]) => text.includes("crm_record_move_stage")).map(([rel]) => rel);
    assert.deepEqual(callers, ["services/crmService.js"]);
    const SERVICE = read("services/crmService.js");
    const fn = SERVICE.slice(SERVICE.indexOf("export function moveStage("), SERVICE.indexOf("export function", SERVICE.indexOf("export function moveStage(") + 10));
    assert.equal((fn.match(/supabase\.rpc\(/g) || []).length, 1);
    assert.match(fn, /p_expected_from: expectedFrom,/);
    // Not sent "only when there is one": no spread, no condition around the argument.
    assert.ok(!/\.\.\.\(|expectedFrom \?|expectedFrom &&|if \(expectedFrom/.test(fn), fn);
  });

  it("only the pipeline hook calls the service's move, with the stage of the card it was handed", () => {
    const users = ALL.filter(([rel, text]) => rel !== "services/crmService.js" && /\b(crm|crmService)\.moveStage\(|\bmoveStage\s*\}\s*from\s*["'][^"']*crmService/.test(text)).map(([rel]) => rel);
    assert.deepEqual(users, ["hooks/useCrmPipeline.js"]);
    const HOOK = read("hooks/useCrmPipeline.js");
    const calls = [...HOOK.matchAll(/crm\.moveStage\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, " "));
    assert.deepEqual(calls, ["record.id, toStage, reason, record.stage"]);
  });

  it("the page moves a card through one function, whatever was pressed, dragged or chosen", () => {
    const PAGE = read("pages/PipelinePage.jsx");
    const calls = [...PAGE.matchAll(/pipe\.moveStage\(/g)];
    assert.equal(calls.length, 1, "one place in the page asks the hook to move a card");
    const perform = PAGE.slice(PAGE.indexOf("const performMove = useCallback("), PAGE.indexOf("const requestMove = useCallback("));
    assert.ok(perform.includes("pipe.moveStage("));
    // The board (drag and the arrow), the list and the open card all hand the move to the page.
    for (const rel of ["components/crm/PipelineBoard.jsx", "components/crm/RecordDrawer.jsx"]) {
      const text = read(rel);
      assert.ok(!/moveStage\(|supabase|crm_record_move_stage/.test(text), `${rel} moves nothing by itself`);
    }
    assert.match(PAGE, /onMove=\{requestMove\}/);
    assert.match(PAGE, /onRequestMove=\{requestMove\}/);
    // A refusal for a stale stage is explained before any generic error path.
    const stale = perform.search(/\n\s+if \(err\?\.token === "stage_changed"\) \{\n[\s\S]{0,600}?await explainStale\(record, to, err\);\n\s+return false;/);
    const sink = perform.indexOf("moveErrorSink.current &&");
    assert.ok(stale > 0 && sink > stale);
  });

  it("Undo goes through its own server function, which decides by itself whether the move can still be undone", () => {
    const SERVICE = read("services/crmService.js");
    assert.match(SERVICE, /supabase\.rpc\("crm_record_undo_stage_move", \{ p_activity_id: [a-zA-Z]+ \}\)/);
    const callers = ALL.filter(([, text]) => text.includes("crm_record_undo_stage_move")).map(([rel]) => rel);
    assert.deepEqual(callers, ["services/crmService.js"]);
  });
});

describe("#3802 TA-9: no raw database error reaches the screen for the new calls", () => {
  // What PostgREST really answered on the local stack for each kind of failure.
  const RAW = [
    [{ code: "22023", details: "meeting", message: "stage_changed: This card is in Meeting now, not Prospect, so nothing was moved. Read the card again and move it from where it is." }, /This card is in Meeting now, not Prospect/],
    [{ code: "22023", details: null, message: "stage_changed:" }, /Someone moved this card/],
    [{ code: "22023", message: "lead_name_unusable: This lead's business name cannot be used as a host name. Add the host by hand from Hosts." }, /Add the host by hand from Hosts/],
    [{ code: "22023", message: "invalid_target: A monthly target is a whole number from 1 to 1000. Send nothing to remove the target." }, /whole number from 1 to 1000/],
    [{ code: "42501", message: "forbidden: Only an owner or admin can open the team dashboard." }, /Only an owner or admin can open the team dashboard/],
    [{ code: "42501", message: "forbidden: Only an owner or admin can set targets." }, /Only an owner or admin can set targets/],
    [{ code: "42501", message: "forbidden: Your account cannot open Beta leads. Ask the owner to give you team access." }, /cannot open Beta leads/],
    [{ code: "P0002", message: "not_found: That beta lead is no longer here." }, /./],
    [{ code: "22P02", message: 'invalid input syntax for type uuid: "x\' or 1=1 --"' }, /./],
    [{ code: "22007", message: 'invalid input syntax for type date: "tomorrow; drop table x"' }, /./],
    [{ code: "22P02", message: 'invalid input syntax for type integer: "2.5"' }, /./],
    [{ code: "PGRST202", message: "Could not find the function public.crm_home_summary(p_today) in the schema cache", details: "Searched for the function public.crm_home_summary" }, /./],
    [{ code: "42501", message: "permission denied for table crm_targets" }, /./],
    [{ code: "23505", message: 'duplicate key value violates unique constraint "crm_targets_slice_key"' }, /./],
    [{ code: "40001", message: "try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again." }, /./],
    [{ message: "JWT expired", code: "PGRST303" }, /./],
    [new TypeError("Failed to fetch"), /./],
    [{}, /./],
    [null, /./],
  ];
  const LEAK = /invalid input syntax|schema cache|PGRST|permission denied|unique constraint|crm_[a-z_]+|p_today|JWT|TypeError|Failed to fetch|22P02|42501|\bnull\b|undefined|drop table|1=1/;

  it("each becomes a sentence in words, and never carries the database's own", () => {
    for (const [err, want] of RAW) {
      for (const words of [errorWords(err), loadErrorWords(err)]) {
        assert.equal(typeof words, "string");
        assert.ok(words.trim().split(/\s+/).length >= 4, `${JSON.stringify(err)} -> ${words}`);
        assert.ok(!LEAK.test(words), `${JSON.stringify(err)} -> ${words}`);
        assert.ok(!/^[a-z_]+:/.test(words), words);
      }
      assert.match(errorWords(err), want);
    }
  });

  it("a function that is not there yet is 'not switched on', which every new page has its own words for", () => {
    assert.equal(parseServerError({ code: "PGRST202", message: "Could not find the function" }).token, "not_ready");
    for (const rel of ["pages/RoleHomePage.jsx", "pages/TeamDashboardPage.jsx", "pages/BetaLeadsPage.jsx"]) {
      const text = read(rel);
      assert.match(text, /error\.token === "not_ready" \? NOT_READY_WORDS/, rel);
      assert.match(text, /error\.token === "forbidden"/, rel);
      assert.match(text, /window\.location\.reload\(\)/, rel);
    }
  });

  it("a stale-move refusal keeps the stage the card is in, for the screen to read the card again", () => {
    const parsed = parseServerError({ code: "22023", details: "meeting", message: "stage_changed: This card is in Meeting now, not Prospect, so nothing was moved." });
    assert.deepEqual([parsed.token, parsed.detail], ["stage_changed", "meeting"]);
  });
});

// ===========================================================================
// RETEST (appended). The rework's fixes, from the outside:
//
//   TA-10  one stacking order, and nothing on the boards drawn outside it
//   TA-11  where messages sit beside an open card, at every width
//   TA-12  names decided by category: every script works, marks-only,
//          format-only and private-use-only names do not
//   TA-13  every #3802 admin suite is really run by the workflow
// ===========================================================================
import { CRM_LAYER_ORDER, CRM_LAYER_Z, layerStyle } from "../lib/crmLayers.js";
import { EDGE_GAP, NARROWEST_TOAST, PANEL_GAP, USUAL_TOAST, stackEdges, stackPlace } from "../lib/toastPlace.js";

describe("#3802 TA-10: one stacking order for everything that opens over a board", () => {
  const PAGE = read("pages/PipelinePage.jsx");
  const LAYER = read("components/crm/CrmLayer.jsx");
  const CSS = read("globals.css");

  it("a question is above a card, and messages are above both", () => {
    assert.deepEqual(CRM_LAYER_ORDER, ["board", "card", "dialog", "toast"]);
    assert.ok(CRM_LAYER_Z.dialog > CRM_LAYER_Z.card);
    const toast = Number(CSS.match(/--z-toast:\s*(\d+);/)[1]);
    assert.ok(toast > CRM_LAYER_Z.dialog, `${toast} must be above ${CRM_LAYER_Z.dialog}`);
    for (const name of ["card", "dialog"]) {
      const style = layerStyle(name);
      // A layer is a stacking context of its own: a number AND a position.
      assert.equal(style.zIndex, CRM_LAYER_Z[name]);
      assert.ok(["relative", "fixed", "absolute"].includes(style.position), style.position);
    }
    for (const unknown of ["toast", "board", "", "__proto__", "constructor", undefined, null]) {
      assert.throws(() => layerStyle(unknown), /Unknown layer/, String(unknown));
    }
    assert.ok(Object.isFrozen(CRM_LAYER_Z));
  });

  it("the page hands the card and the question to the layers, each in its own slot, and draws neither anywhere else", () => {
    const overlays = PAGE.slice(PAGE.indexOf("<PipelineOverlays"));
    const cardSlot = overlays.slice(overlays.indexOf("card={"), overlays.indexOf("dialog={"));
    const dialogSlot = overlays.slice(overlays.indexOf("dialog={"));
    assert.ok(cardSlot.includes("<RecordDrawer") && cardSlot.includes("<AddRecordForm"));
    assert.ok(!cardSlot.includes("<ReasonPrompt"), "the question is never in the card's layer");
    // The question goes into the dialog slot itself, not into some other prop.
    assert.match(overlays, /\n\s+dialog=\{\s*reasonFor \? \(\s*<ReasonPrompt/);
    assert.equal((overlays.match(/\n\s+[a-zA-Z]+=\{/g) || []).filter((m) => /^\n {8}[a-zA-Z]+=\{$/.test(m)).map((m) => m.trim()).join(" "), "card={ dialog={");
    assert.ok(dialogSlot.includes("<ReasonPrompt") && !dialogSlot.includes("<RecordDrawer") && !dialogSlot.includes("<Drawer"));
    // Each is drawn exactly once in the page, and only inside the layers.
    for (const tag of ["<ReasonPrompt", "<RecordDrawer", "<AddRecordForm"]) {
      assert.equal(PAGE.split(tag).length - 1, 1, tag);
      assert.ok(PAGE.indexOf(tag) > PAGE.indexOf("<PipelineOverlays"), tag);
    }
    // The page places nothing at the top of the document by itself, and sets no stacking number.
    assert.ok(!/createPortal|zIndex|z-\[|z-\d/.test(PAGE), "PipelinePage.jsx stacks nothing by hand");
  });

  it("the layer component draws the question after the card and takes its numbers from the one file", () => {
    assert.ok(LAYER.indexOf('name="card"') < LAYER.indexOf('name="dialog"'));
    assert.match(LAYER, /style=\{layerStyle\(name\)\}/);
    assert.match(LAYER, /createPortal\(box, document\.body\)/);
    assert.ok(!/zIndex:\s*\d|z-\[|z-\d/.test(LAYER));
    // While a question is open the card does not also answer the keyboard.
    assert.match(PAGE, /suspended=\{!!reasonFor\}/);
  });
});

describe("#3802 TA-11: where messages sit beside an open card", () => {
  const PANEL = 440; // the side panel's width from 640px up

  it("from 640px up there is always room beside the card, and the stack never reaches it", () => {
    for (let vw = 640; vw <= 2600; vw++) {
      const place = stackPlace(vw, PANEL, true);
      assert.equal(place.beside, PANEL, `${vw}px`);
      const edges = stackEdges(vw, place);
      assert.ok(edges.left >= EDGE_GAP, `${vw}px`);
      assert.ok(edges.right <= vw - PANEL - PANEL_GAP, `${vw}px: the stack would touch the card`);
      assert.ok(edges.right - edges.left >= NARROWEST_TOAST, `${vw}px: ${edges.right - edges.left}px is too narrow to read`);
      // It only squeezes when it has to.
      assert.equal(place.fill, edges.right - edges.left < USUAL_TOAST, `${vw}px`);
    }
  });

  it("on a phone, with no card, or with a card as wide as the screen, the stack stays at the bottom", () => {
    for (let vw = 280; vw < 640; vw++) assert.deepEqual(stackPlace(vw, vw, false), { beside: 0, fill: false }, `${vw}px`);
    for (const vw of [640, 1024, 1400]) {
      assert.deepEqual(stackPlace(vw, 0, true), { beside: 0, fill: false });
      assert.deepEqual(stackPlace(vw, vw, true), { beside: 0, fill: false });
      assert.deepEqual(stackPlace(vw, PANEL, false), { beside: 0, fill: false });
      assert.equal(stackEdges(vw, stackPlace(vw, 0, true)), null);
    }
  });

  it("odd measurements never put the stack over the card or off the screen", () => {
    const ODD = [NaN, Infinity, -Infinity, -1, 0, null, undefined, "440", {}, []];
    for (const vw of [...ODD, 320, 640, 1400]) for (const panel of [...ODD.filter((v) => v !== Infinity), 440, 5000]) for (const wide of [true, false, undefined, "yes"]) {
      let place;
      assert.doesNotThrow(() => {
        place = stackPlace(vw, panel, wide);
      });
      // Real measurements are finite numbers; for those the stack is beside
      // the card only when there is room, and never over it.
      if (typeof vw === "number" && Number.isFinite(vw) && typeof panel === "number" && Number.isFinite(panel)) {
        assert.ok(place.beside === 0 || (wide && place.beside === panel && vw - panel - EDGE_GAP - PANEL_GAP >= NARROWEST_TOAST), `${vw} ${panel} ${String(wide)} -> ${JSON.stringify(place)}`);
        const edges = stackEdges(vw, place);
        if (edges) assert.ok(edges.right > edges.left && edges.left >= 0 && edges.right <= vw - panel, `${vw} ${panel}`);
      } else {
        assert.doesNotThrow(() => stackEdges(vw, place));
      }
    }
    for (const notAPlace of [null, undefined, {}, { beside: -5 }, { beside: 0 }, { beside: NaN }]) assert.equal(stackEdges(1400, notAPlace), null);
  });

  it("an open card on a phone leaves room after its last field for a message shown over it", () => {
    const DRAWER = read("components/crm/RecordDrawer.jsx");
    const TOAST = read("components/ui/Toast.jsx");
    const PAGE = read("pages/PipelinePage.jsx");
    assert.match(DRAWER, /paddingBottom: "var\(--toast-clear, 0px\)"/);
    assert.match(PAGE, /paddingBottom: "var\(--toast-clear, 0px\)"/, "the add form leaves the same room");
    assert.match(TOAST, /setProperty\("--toast-clear"/);
    assert.match(TOAST, /removeProperty\("--toast-clear"\)/);
  });
});

describe("#3802 TA-12: names decided by category (the database gave the same answers)", () => {
  const WORKS = [
    ["Latin with accents", `Cr${cp(0xe8)}me Br${cp(0xfb)}l${cp(0xe9)}e`],
    ["Latin, accents typed as marks", `Pa${cp(0x302)}te${cp(0x301)} Maison`],
    ["Vietnamese", `Ph${cp(0x1edf)} H${cp(0xe0)} N${cp(0x1ed9)}i`],
    ["Hebrew with points", cp(0x5d1, 0x5b5, 0x5bc, 0x5d9, 0x5ea)],
    ["Arabic with vowel marks", cp(0x645, 0x64e, 0x637, 0x652, 0x639, 0x64e, 0x645)],
    ["Persian with a non-joiner", cp(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645)],
    ["Devanagari, one syllable", cp(0x915, 0x93f)],
    ["Tamil", cp(0xba4, 0xbae, 0xbbf, 0xbb4, 0xbcd)],
    ["Thai, a consonant and a vowel sign", cp(0xe01, 0xe34)],
    ["hiragana", cp(0x3059, 0x3057)],
    ["katakana with a long mark", cp(0x30e9, 0x30fc, 0x30e1, 0x30f3)],
    ["kana with its voiced mark typed apart", cp(0x304b, 0x3099)],
    ["Chinese", cp(0x6771, 0x4eac)],
    ["Chinese beyond the basic plane", cp(0x20bb7, 0x91ce, 0x5bb6)],
    ["Korean typed as separate jamo", cp(0x1112, 0x1161, 0x11ab)],
    ["Ethiopic", cp(0x12a0, 0x12f2, 0x1235)],
    ["one emoji", cp(0x1f355)],
    ["an emoji with its selector", cp(0x2764, 0xfe0f)],
    ["a joined family emoji", cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)],
    ["a flag", cp(0x1f1f3, 0x1f1ec)],
    ["a keycap", `1${cp(0xfe0f, 0x20e3)}`],
    ["an emoji with a skin tone", cp(0x1f44d, 0x1f3fd)],
    ["currency signs", cp(0x20a6, 0x20a6)],
    ["Arabic-Indic digits", cp(0x661, 0x662)],
    ["a letter in an enclosing mark", `e${cp(0x20dd)}`],
  ];
  const NOTHING = [
    ["a Latin mark", cp(0x301)],
    ["a Hebrew point", cp(0x5b4)],
    ["an Arabic vowel mark", cp(0x64e)],
    ["a Devanagari vowel sign", cp(0x93f)],
    ["a Devanagari nukta and virama", cp(0x93c, 0x94d)],
    ["a Tamil vowel sign", cp(0xbbf)],
    ["a Thai vowel sign", cp(0xe34)],
    ["the kana voiced mark", cp(0x3099)],
    ["a musical combining stem", cp(0x1d165)],
    ["the keycap mark", cp(0x20e3)],
    ["marks of four scripts and spaces", `${cp(0x301)} ${cp(0x5b4)} ${cp(0x93f, 0xe34)}`],
    ["the two joiners", cp(0x200d, 0x200c)],
    ["direction marks", cp(0x202e, 0x2066)],
    ["the Arabic number sign", cp(0x600)],
    ["an interlinear anchor", cp(0xfff9)],
    ["tag characters", cp(0xe0041, 0xe007f)],
    ["private use, basic plane", cp(0xe000, 0xf8ff)],
    ["private use, plane 15", cp(0xf0000)],
    ["private use, plane 16", cp(0x10fffd)],
    ["a code point with no character", cp(0x378)],
    ["a noncharacter", cp(0xfdd0)],
    ["fillers and a blank cell", cp(0x3164, 0x2800, 0x115f)],
    ["the null notehead and a script filler", cp(0x1d159, 0x16fe4)],
    ["every kind of space", ` ${cp(0xa0, 0x2003, 0x3000, 0x205f, 0x1680)}`],
    ["controls", cp(0x1, 0x7f, 0x85)],
    ["a lone surrogate", "\ud800"],
    ["a mark, a private-use character and a joiner", cp(0x301, 0xe000, 0x200d)],
  ];
  for (const [label, name] of WORKS) it(`${label} has a key`, () => assert.notEqual(nameKey(name), ""));
  for (const [label, name] of NOTHING) it(`${label} alone has no key`, () => assert.equal(nameKey(name), ""));

  it("the same name in two forms is one key, and what nobody can see changes nothing", () => {
    const SAME = [
      [`Caf${cp(0xe9)}`, `Cafe${cp(0x301)}`],
      ["Palm Court", cp(0xff30, 0xff41, 0xff4c, 0xff4d, 0x20, 0xff23, 0xff4f, 0xff55, 0xff52, 0xff54)],
      [cp(0x30ac), cp(0x30ab, 0x3099)],
      [cp(0x30ac), cp(0xff76, 0xff9e)],
      [cp(0xd55c), cp(0x1112, 0x1161, 0x11ab)],
      ["Palm Court", `Palm${cp(0xe000)} Court`],
      ["Palm Court", `Pa${cp(0x378)}lm Court`],
      ["Palm Court", `P${cp(0x200d)}alm${cp(0x2800)} Co${cp(0xfe0f)}urt${cp(0xe0041)}`],
    ];
    for (const [a, b] of SAME) assert.equal(nameKey(b), nameKey(a), [...b].map((c) => c.codePointAt(0).toString(16)).join(" "));
    // Two scripts that only look alike stay apart, and so do hiragana and katakana.
    assert.notEqual(nameKey("AB"), nameKey(cp(0x410, 0x412)));
    assert.notEqual(nameKey(cp(0x3059, 0x3057)), nameKey(cp(0x30b9, 0x30b7)));
  });

  it("the rule is written by category, not as a list someone has to keep up", () => {
    const MODEL = read("lib/crmModel.js");
    assert.match(MODEL, /\\p\{Cf\}/);
    assert.match(MODEL, /\\p\{Co\}/);
    assert.match(MODEL, /const NAME_KEY_MARKS = \/\\p\{M\}\+\/gu;/);
  });
});

describe("#3802 TA-13: every #3802 admin suite is run by the workflow", () => {
  // The workflow is found by what it runs, never by its file name: a file name written here would enrol this test in the CI registry's sealed inventory of that workflow.
  const WORKFLOW = fs.readdirSync(path.resolve(SRC, "../../.github/workflows")).map((f) => fs.readFileSync(path.resolve(SRC, "../../.github/workflows", f), "utf8")).find((text) => text.includes("run: node --test src/__tests__/issue3802_")) ?? "";
  const suites = fs.readdirSync(path.join(SRC, "__tests__")).filter((f) => /^issue3802_.*\.test\.js$/.test(f)).sort();

  it("there are nine of them, and each has a step that runs it", () => {
    assert.equal(suites.length, 9, suites.join(", "));
    for (const file of suites) {
      const run = new RegExp(`\\n\\s+run: node --test src/__tests__/${file.replace(/\./g, "\\.")}\\n`);
      assert.match(WORKFLOW, run, `${file} is listed for triggering but no step runs it`);
    }
  });

  it("the rendered stacking check has the packages it needs installed before it runs, in the same job", () => {
    const at = WORKFLOW.indexOf("run: node --test src/__tests__/issue3802_wave1_overlay_stack.rendered.test.js");
    assert.ok(at > 0);
    const job = WORKFLOW.slice(WORKFLOW.lastIndexOf("\n    steps:\n", at), at);
    const install = job.lastIndexOf("run: npm ci");
    assert.ok(install > 0, "an install step comes before the rendered check");
    assert.match(job.slice(job.lastIndexOf("- name:", install), install), /working-directory: mingla-admin/);
  });
});
