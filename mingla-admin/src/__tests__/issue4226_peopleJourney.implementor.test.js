// Issue #4226 Phase 2 — People journey and Email segmentation in Admin.
//
//   1. The panel fits the person: a non-host never gets Brands or Money, in
//      the panel or the full record; no-account people open a Details panel.
//   2. One filter: People's tabs, strip, filters and counts, Email's plays,
//      builder and "Email these people" all send the same filter object to
//      the same server functions (admin_people_filter / _facets /
//      _filter_counts); filter options only list values that exist, with
//      counts; a combination with nobody offers Clear filters.
//   3. An Activation play sends exactly the filter People uses for the same
//      people (the parity test), and the hand-off links round-trip it.
//   4. Activity says "not connected yet" instead of an empty list; saved
//      groups are labelled [TRANSITIONAL] browser storage.
//   5. One owner: the Support desk and the full record read the People
//      classifier; no admin source reads profiles_with_segment.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_PLAYS,
  JOURNEY_TABS,
  PEOPLE_FILTER_KEYS,
  SAVED_GROUPS_KEY,
  cleanFilter,
  decodeFilter,
  emailHrefFor,
  explorerLadder,
  facetOptions,
  filterChips,
  hostChecklistView,
  journeyTabFor,
  panelTabsFor,
  peopleAudience,
  peopleFilterFromHash,
  peopleHrefFor,
  playForFilter,
  readSavedGroups,
  startingPoint,
  recipientFromHash,
  recipientHrefFor,
  saveGroup,
  stageLabel,
  stripOptions,
  tabFilter,
  withoutKey,
} from "../lib/peopleFilter.js";
import { AUDIENCE_PRESETS, EMPTY_FILTERS, audienceFor, choosePreset, presetIsActive } from "../lib/emailAudience.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(full);
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [full] : [];
  });
}

describe("#4226 P2: the panel fits the person", () => {
  it("a non-host never gets Brands or Money; a host does; Both gets the union", () => {
    const ids = (kind) => panelTabsFor(kind).map((t) => t.id);
    for (const kind of ["explorer", "signing_up", "internal", "no_account_buyer", "no_account_contact"]) {
      assert.equal(ids(kind).includes("brands"), false, `${kind} has no Brands tab`);
      assert.equal(ids(kind).includes("money"), false, `${kind} has no Money tab`);
    }
    assert.deepEqual(ids("explorer"), ["journey", "going", "social", "activity", "support"]);
    assert.deepEqual(ids("host"), ["journey", "brands", "money", "activity", "support"]);
    assert.deepEqual(ids("both"), ["journey", "going", "brands", "money", "social", "activity", "support"]);
    assert.deepEqual(ids("no_account_buyer"), ["details"]);
    assert.deepEqual(ids("no_account_contact"), ["details"]);
    assert.deepEqual(ids("__proto__"), ids("explorer"), "an unknown kind falls back safely");
  });

  it("the panel draws only the tabs that fit, and the old Business tab is gone", () => {
    const drawer = read("components/people/PersonDrawer.jsx");
    assert.match(drawer, /const tabs = panelTabsFor\(kind\);/);
    assert.match(drawer, /<Tabs tabs=\{tabs\} activeTab=\{activeTab\}/);
    assert.match(drawer, /const activeTab = tabs\.some\(\(t\) => t\.id === tab\) \? tab : tabs\[0\]\.id;/, "a stale tab never shows for a person it doesn't fit");
    assert.equal(/id: "business"/.test(drawer), false, "no hard-coded Business tab");
    assert.match(drawer, /isHostKind\(kind\) &&/, "the host checklist only for hosts");
  });

  it("the full record hides Business sections for a non-host", () => {
    const page = read("pages/PeopleConsolePage.jsx");
    assert.match(page, /const isHost = person\.is_host === true \|\| !!account;/);
    assert.match(page, /if \(isHost\) \{\n {2}\/\/ Business account/);
    assert.equal(/label: "Consumer-only"/.test(page), false, "no 'Consumer-only' business badge for non-hosts");
  });

  it("the host checklist marks the first unticked item as the next step", () => {
    const view = hostChecklistView({
      items: [
        { key: "host_account", done: true },
        { key: "brand_created", done: true },
        { key: "payout_country", done: true },
        { key: "offering_drafted", done: true },
        { key: "published", done: false },
        { key: "bank_connected", done: true, at: "2026-10-04T00:00:00Z" },
      ],
    });
    assert.equal(view.length, 8);
    assert.deepEqual(view.filter((i) => i.next).map((i) => i.key), ["published"], "bank before publishing: next is still publish");
    assert.equal(view.find((i) => i.key === "bank_connected").done, true);
    const ladder = explorerLadder("connected");
    assert.deepEqual(ladder.filter((i) => i.done).map((i) => i.key), ["signing_up", "onboarded", "exploring", "connected"]);
    assert.equal(ladder.find((i) => i.current).key, "connected");
  });

  it("stage words: steps, team members and no-account kinds", () => {
    assert.equal(stageLabel({ explorer_stage: "signing_up", explorer_stopped_step: 3 }), "Stopped at step 3");
    assert.equal(stageLabel({ explorer_stage: "signing_up", explorer_stopped_step: null }), "Step not recorded");
    assert.equal(stageLabel({ host_next_step: "team_member", host_checklist: { team_brands: [{ name: "Ctrl" }] } }), "Team member at Ctrl");
    assert.equal(stageLabel({ explorer_stage: "going", host_next_step: "publish" }), "Going · Next: publish");
    assert.equal(stageLabel({ person_kind: "no_account_contact" }), "Host contact, never bought");
  });
});

describe("#4226 P2: one filter for People and Email", () => {
  it("the JS keys mirror admin_people_filter_check in the migration", () => {
    const sql = fs.readFileSync(path.join(REPO, "supabase/migrations/20281118024226_issue_4226_people_journey.sql"), "utf8");
    const list = sql.match(/ELSIF v_key NOT IN \(([^)]*)\)/);
    assert.ok(list, "the SQL lists its keys");
    const keys = [...list[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual([...PEOPLE_FILTER_KEYS].sort(), keys);
  });

  it("a tab sends its track, the strip choice and its filters; empties are dropped", () => {
    const hosts = journeyTabFor("hosts");
    assert.deepEqual(tabFilter(hosts, { strip: "connect_bank", filters: { payout_country: "NG", city: "" , track: "internal" } }),
      { track: "hosts", host_next_step: "connect_bank", payout_country: "NG" }, "a filter can never change the tab's track");
    const noAccount = journeyTabFor("noaccount");
    assert.deepEqual(tabFilter(noAccount, { strip: "no_account_contacts" }), { track: "no_account_contacts" });
    assert.deepEqual(tabFilter(noAccount, {}), { track: "no_account" });
    assert.deepEqual(cleanFilter({ track: "hosts", colour: "red", city: "all", search: "  " }), { track: "hosts" });
  });

  it("filter options only list values that exist, each with its count", () => {
    const options = facetOptions("source", { source: [
      { value: "friend_invite", label: "friend_invite", count: 3 },
      { value: "paid_ad", label: "paid_ad", count: 0 },
      { value: null, label: null, count: 4 },
    ] });
    assert.deepEqual(options.map((o) => o.value), ["friend_invite"]);
    assert.equal(options[0].label, "Friend invite (3)");
    assert.deepEqual(facetOptions("source", undefined), []);
    const strip = stripOptions(journeyTabFor("explorers"), { explorer_stage: [{ value: "going", count: 5 }] }, null);
    assert.deepEqual(strip.map((s) => [s.value, s.count]), [["onboarded", 0], ["exploring", 0], ["connected", 0], ["going", 5], ["regular", 0]]);
    const steps = stripOptions(journeyTabFor("signing"), { stopped_step: [{ value: "none", count: 2 }, { value: "3", count: 1 }, { value: "1", count: 4 }] }, null);
    assert.deepEqual(steps.map((s) => s.value), ["1", "3", "none"], "steps in order, not recorded last");
  });

  it("People reads lists, facets and counts from the one filter, and offers Clear filters", () => {
    const page = read("pages/PeoplePage.jsx");
    assert.match(page, /listPeopleByFilter\(\s*tabFilter\(tab, \{ strip, filters, search \}\)/);
    assert.match(page, /getPeopleFacets\(f\)/);
    assert.match(page, /facetOptions\(key, facets\)/);
    assert.match(page, /Nobody matches these filters/);
    assert.match(page, /onClick=\{clearAll\}>Clear filters</);
    assert.match(page, /href=\{emailHrefFor\(emailFilter\)\}/, "Email these N people hands over the same filter");
    assert.match(page, /disabled=\{!on && s\.count === 0\}/, "a strip button with nobody is not a dead tap");
    const service = read("services/peopleService.js");
    assert.match(service, /rpc\("admin_people_filter", \{ p_filters: filter \|\| \{\} \}, \{ count: "exact" \}\)/);
  });

  it("chips name each filter and remove it; the track stays", () => {
    const chips = filterChips({ track: "hosts", host_next_step: "connect_bank", country: "NG" });
    assert.deepEqual(chips.map((c) => [c.key, c.removable]), [["track", false], ["host_next_step", true], ["country", true]]);
    assert.equal(chips[1].label, "Host next step: Next: connect bank");
    assert.deepEqual(withoutKey({ track: "hosts", country: "NG" }, "country"), { track: "hosts" });
  });
});

describe("#4226 P2: Email presets send the same filter as People (parity)", () => {
  it("every play is a People filter, sent unchanged as the Email audience", () => {
    for (const play of ACTIVATION_PLAYS) {
      assert.deepEqual(audienceFor("plays", null, EMPTY_FILTERS, null, play.filter), { mode: "people", people: cleanFilter(play.filter) }, play.id);
      assert.deepEqual(audienceFor("people", null, EMPTY_FILTERS, null, play.filter), peopleAudience(play.filter), play.id);
    }
  });

  it("a play equals the People tab filter for the same people", () => {
    const tab = (id) => journeyTabFor(id);
    const play = (id) => ACTIVATION_PLAYS.find((p) => p.id === id).filter;
    assert.deepEqual(play("nobank"), tabFilter(tab("hosts"), { strip: "connect_bank" }));
    assert.deepEqual(play("nobrand"), tabFilter(tab("hosts"), { strip: "create_brand" }));
    assert.deepEqual(play("draft"), tabFilter(tab("hosts"), { strip: "publish" }));
    assert.deepEqual(play("nooffer"), tabFilter(tab("hosts"), { strip: "draft_offering" }));
    assert.deepEqual(play("nosale"), tabFilter(tab("hosts"), { strip: "first_sale" }));
    assert.deepEqual(play("nosave"), tabFilter(tab("explorers"), { strip: "onboarded" }));
    assert.deepEqual(play("dormant"), tabFilter(tab("explorers"), { strip: "going", filters: { activity_status: "dormant" } }));
    assert.deepEqual(play("stuck"), tabFilter(tab("signing"), {}));
    assert.deepEqual(play("buyers"), tabFilter(tab("noaccount"), { strip: "no_account_buyers" }));
    assert.deepEqual(play("contacts"), tabFilter(tab("noaccount"), { strip: "no_account_contacts" }));
    assert.equal(ACTIVATION_PLAYS.length, 10, "spec D8's nine plays plus the second no-account play");
  });

  it("People -> Email -> People round-trips the filter in the address", () => {
    const filter = { track: "hosts", host_next_step: "connect_bank", search: "ada" };
    const href = emailHrefFor(filter);
    assert.match(href, /^#\/email\?compose=1&people=/);
    assert.deepEqual(peopleFilterFromHash(href), filter);
    const back = peopleHrefFor(filter);
    assert.match(back, /^#\/people\?tab=hosts&f=/);
    assert.deepEqual(decodeFilter(new URLSearchParams(back.split("?")[1]).get("f")), filter);
    assert.equal(peopleFilterFromHash("#/email?people=%7Bnot-json"), null, "an unreadable filter is no filter");
    assert.equal(recipientFromHash(recipientHrefFor("ada@example.org")), "ada@example.org");
  });

  it("the composer offers plays and a builder, and Hosts says it includes Both", () => {
    assert.deepEqual(AUDIENCE_PRESETS.slice(0, 2).map((p) => p.id), ["plays", "people"]);
    assert.equal(AUDIENCE_PRESETS.find((p) => p.id === "hosts").label, "Hosts (incl. Both)");
    const plays = AUDIENCE_PRESETS.find((p) => p.id === "plays");
    const next = choosePreset(plays, EMPTY_FILTERS);
    assert.equal(next.audienceMode, "plays");
    assert.equal(presetIsActive(plays, "plays", EMPTY_FILTERS), true);
    const composer = read("components/email/EmailComposer.jsx");
    assert.match(composer, /audienceFor\(audienceMode, selectedRecipient, filters, leadTarget, peopleFilter\)/);
    assert.match(composer, /<option value="host">Hosts \(incl\. Both\)<\/option>/);
    assert.match(composer, /peopleFilterFromHash\(window\.location\.hash\)/, "Email these people preloads the filter");
    const picker = read("components/email/PeopleAudiencePicker.jsx");
    assert.match(picker, /getPeopleFilterCounts\(Object\.fromEntries\(plays\.map\(\(p\) => \[p\.id, p\.filter\]\)\)\)/, "play counts are People counts");
    assert.match(picker, /Edit filters/);
    assert.match(picker, /Save as a group/);
    assert.match(picker, /Nobody has all of these at once/);
  });
});

describe("#4226 P2: saved groups, activity, one owner", () => {
  it("saved groups persist in browser storage, labelled transitional", () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    assert.deepEqual(readSavedGroups(storage), []);
    assert.throws(() => saveGroup(storage, [], { name: "Empty", filter: {} }), /at least one filter/);
    const next = saveGroup(storage, [], { name: "Lagos hosts", filter: { track: "hosts", city: "Lagos" } });
    assert.equal(next.length, 1);
    const again = readSavedGroups(storage);
    assert.equal(again[0].name, "Lagos hosts");
    assert.deepEqual(again[0].filter, { track: "hosts", city: "Lagos" });
    assert.equal(again[0].group, "Your saved groups");
    assert.deepEqual(readSavedGroups({ getItem: () => "{broken" }), [], "a broken store reads as none");
    assert.match(read("lib/peopleFilter.js"), /\[TRANSITIONAL\] Saved groups live in this browser/);
    assert.equal(typeof SAVED_GROUPS_KEY, "string");
  });

  it("Activity says when tracking isn't connected, never an empty list", () => {
    const drawer = read("components/people/PersonDrawer.jsx");
    assert.match(drawer, /if \(!state\.data\?\.configured\)/);
    assert.match(drawer, /Activity tracking not connected yet/);
    assert.match(drawer, /Recent screens \(both apps\)/);
    assert.match(read("services/peopleService.js"), /functions\.invoke\("admin-person-activity", \{ body: \{ user_id: userId \} \}\)/);
  });

  it("the Support desk and the full record read the People classifier", () => {
    const support = read("services/supportDeskService.js");
    assert.match(support, /rpc\("admin_people_lookup", \{ p_user_ids: ids, p_query: null \}\)/);
    assert.match(support, /rpc\("admin_people_lookup", \{ p_user_ids: null, p_query: text \}\)/);
    for (const file of walk(SRC)) {
      assert.equal(/profiles_with_segment|derive_user_segment/.test(fs.readFileSync(file, "utf8")), false, path.relative(SRC, file));
    }
    const modal = read("components/support/NewTicketModal.jsx");
    assert.match(modal, /\["host", "both"\]\.includes\(person\.app_status \|\| person\.segment\) \? "business" : "explorer"/);
  });
});

describe("#4226 rework: starting points, counts that follow the filter, Email button", () => {
  const saved = { id: "saved-going", name: "Going, Lagos", who: "Going", filter: { track: "explorers", explorer_stage: "going", city: "Lagos" }, message: "" };
  const plays = [...ACTIVATION_PLAYS, saved];

  it("N3: the card, message and starting point follow the selected filter, not a stale id", () => {
    // A stale id for the first play while the filter is the saved group's.
    const current = playForFilter(plays, saved.filter, ACTIVATION_PLAYS[0].id);
    assert.equal(current.id, "saved-going");
    assert.equal(playForFilter(plays, ACTIVATION_PLAYS[1].filter, null).id, ACTIVATION_PLAYS[1].id);
    assert.equal(playForFilter(plays, { track: "hosts", search: "nobody" }, null), null);
    assert.equal(playForFilter(plays, ACTIVATION_PLAYS[0].filter, "saved-going").id, ACTIVATION_PLAYS[0].id, "an id whose filter is not the current one never wins");
  });

  it("N3: a saved group's starting point is its own name, never another play's subject", () => {
    const first = startingPoint(ACTIVATION_PLAYS[0], { subject: "", bodyText: "" });
    assert.equal(first.subject, ACTIVATION_PLAYS[0].name);
    // The previous click filled the subject; the next group replaces it.
    const next = startingPoint(saved, { subject: first.subject, bodyText: first.message || "", lastAutoSubject: first.subject, lastAutoBody: first.message || "" });
    assert.equal(next.subject, "Going, Lagos");
    assert.equal(next.message, null, "a saved group has no message of its own, so the body is left alone");
    // A subject the person wrote is kept.
    assert.equal(startingPoint(saved, { subject: "My own subject", lastAutoSubject: first.subject }).subject, null);
    // A play with its own message replaces an auto-filled body but never a written one.
    const withMsg = ACTIVATION_PLAYS.find((p) => p.message);
    assert.equal(startingPoint(withMsg, { subject: "", bodyText: "Typed by hand", lastAutoBody: "x" }).message, null);
    assert.equal(startingPoint(withMsg, { subject: "", bodyText: "x", lastAutoBody: "x" }).message, withMsg.message);
  });

  it("N3: the Email composer uses them, and the saved group gets a starting point button", () => {
    const picker = fs.readFileSync(path.join(REPO, "mingla-admin/src/components/email/PeopleAudiencePicker.jsx"), "utf8");
    const composer = fs.readFileSync(path.join(REPO, "mingla-admin/src/components/email/EmailComposer.jsx"), "utf8");
    assert.match(picker, /playForFilter\(plays, clean, playId\)/);
    assert.doesNotMatch(picker, /plays\.find\(\(p\) => p\.id === playId\)/, "no lookup by a possibly stale id");
    assert.doesNotMatch(picker, /\{current\.message && \(/, "the starting point is offered for every group");
    assert.match(composer, /startingPoint\(play,/);
  });

  it("N4/N5: the strip, dropdown counts and Email button follow the search and every filter, and never keep old numbers", () => {
    const page = fs.readFileSync(path.join(REPO, "mingla-admin/src/pages/PeoplePage.jsx"), "utf8");
    assert.match(page, /countsFilterKey = JSON\.stringify\(tabFilter\(tab, \{ strip, filters, search: visible\.search \}\)\)/);
    assert.match(page, /JSON\.parse\(countsFilterKey\)/);
    const catchBlock = page.slice(page.indexOf("// Never keep numbers that belong to an earlier filter."));
    assert.match(catchBlock.slice(0, 300), /setFacets\(null\);\s*setStripCounts\(null\);\s*setEmailReach\(null\);/);
    assert.match(page, /can receive/, "the button says how many can receive");
    assert.match(page, /emails_ok: "yes"/);
  });

  it("N6: the audience pills do not animate their highlight", () => {
    const composer = fs.readFileSync(path.join(REPO, "mingla-admin/src/components/email/EmailComposer.jsx"), "utf8");
    const pill = composer.slice(composer.indexOf("aria-pressed={active}"), composer.indexOf("aria-pressed={active}") + 400);
    assert.doesNotMatch(pill, /px-3 py-1\.5 text-xs font-semibold transition /);
    assert.equal(presetIsActiveFor("people"), "people");
  });

  it("T-10: a sign-up with no recorded step reads Step not recorded, and the filter option says so", () => {
    assert.equal(stageLabel({ explorer_stage: "signing_up", explorer_stopped_step: null }), "Step not recorded");
    assert.equal(stageLabel({ explorer_stage: "signing_up", explorer_stopped_step: 0 }), "Stopped at step 0");
    const opts = facetOptions("stopped_step", { stopped_step: [{ value: "none", label: "none", count: 3 }, { value: "2", label: "2", count: 1 }] });
    assert.equal(opts[0].label, "Step not recorded (3)");
  });

  it("N7: Joined and Signed up come from the same auth sign-up in the migration", () => {
    const sql = fs.readFileSync(path.join(REPO, "supabase/migrations/20281118024226_issue_4226_people_journey.sql"), "utf8");
    assert.match(sql, /COALESCE\(st\.auth_created_at, st\.created_at/);
    assert.match(sql, /SELECT u\.created_at AS at, 'signed_up'/);
  });
});

function presetIsActiveFor(mode) {
  // The pill is active exactly when the composer's audience mode is its id.
  return AUDIENCE_PRESETS.find((p) => p.id === mode && presetIsActive(p, mode, {}))?.id;
}
