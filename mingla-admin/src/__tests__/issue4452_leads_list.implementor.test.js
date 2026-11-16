// #4452 A1.8 / A1.5 (admin side): the Leads list and the composer hand-off.
//
//   L-1 the address holds every filter except the search text (never a URL)
//   L-2 old Beta / Tool leads addresses open on that source; #/leads is an alias
//   L-3 rows, consent and ad lines, the selection banner (exact copy)
//   L-4 the banner's marketable count uses leads_audience_counts' rules
//   L-5 the CSV quotes, and never lets a cell start a formula
//   L-6 the composer: #/email?leads= / ?lead=, audienceFor, the summary words,
//       and a restored draft never pre-selects a leads audience
//   L-7 the page and the menu
//
// FAILS-ON-REVERT: letting `q` into querySet fails L-1; dropping the formula
// guard fails L-5; counting no-consent rows as marketable fails L-4; dropping
// the ?leads= parse fails L-6.
//
// Run: node --test src/__tests__/issue4452_leads_list.implementor.test.js (from mingla-admin).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adLine, consentLine, filterFromQuery, leadCardFields, leadRowView, leadsCsv, marketableOf, pipelineFor, querySet, selectionBanner } from "../lib/leadsModel.js";
import { audienceFor, audienceSummary, leadTargetFromHash, leadsSendError, AUDIENCE_PRESETS } from "../lib/emailAudience.js";
import { restoreDraftAudience } from "../lib/emailDraftAudience.js";
import { redirectHash } from "../lib/adminRoutes.js";
import { NAV_ITEMS } from "../lib/constants.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const SEL = "44520000-0000-4000-8000-0000000000a1";
const LEAD = "44520000-0000-4000-8000-0000000000b1";
const FORM = "44520000-0000-4000-8000-0000000000f1";

describe("#4452 L-1 the address and the filter", () => {
  it("maps every address key to the server filter; the search box is passed separately", () => {
    const f = filterFromQuery(`label=creator&source=form&form=${FORM}&page=/creators&consent=yes&email_status=emailed&from=2026-11-01&to=2026-11-16&utm_source=meta&utm_campaign=x&in_pipeline=no&test=1`, " Ada ");
    assert.deepEqual(f, { labels: ["creator"], sources: ["form"], form_id: FORM, page_path: "/creators", consent: "yes", in_pipeline: "no",
      email_status: "emailed", from: "2026-11-01", to: "2026-11-16", utm_source: "meta", utm_campaign: "x", show_test: true, q: "Ada" });
    assert.deepEqual(filterFromQuery("label=stopped"), { email_status: "follow_ups_stopped" });
    assert.deepEqual(filterFromQuery("label=nope&source=x&form=1&page=creators&from=2026-1-1"), {}, "anything unknown is dropped");
  });
  it("never writes the search text into the address", () => {
    assert.throws(() => querySet("", "q", "ada@example.org"));
    assert.equal(filterFromQuery("q=ada@example.org").q, undefined, "a q in the address is ignored");
    assert.equal(querySet("label=host", "label", null), "");
    assert.equal(querySet("", "test", true), "test=1");
    const list = read("components/leads/LeadsList.jsx");
    assert.match(list, /const \[q, setQ\] = useState\(""\);/);
    assert.match(list, /setTimeout\(\(\) => setQDebounced\(q\), 300\)/, "debounced 300 ms");
  });
});

describe("#4452 L-2 old addresses", () => {
  it("Beta and Tool leads open on their source; #/leads is the list", () => {
    assert.equal(redirectHash("#/leads"), "#/inbound");
    assert.equal(redirectHash("#/beta-leads"), "#/inbound?tab=beta");
    assert.deepEqual(filterFromQuery("tab=beta").sources, ["beta"]);
    assert.deepEqual(filterFromQuery("tab=tools").sources, ["tool"]);
  });
});

describe("#4452 L-3 what a row and the drawer read", () => {
  it("a row", () => {
    const r = leadRowView({ id: "1", name: "Ada Okafor", email: "ada@example.org", primary_label: "creator", labels: ["creator", "host"],
      latest: { source: "form", form_name: "Creators: join", utm_source: "meta", utm_campaign: "lagos" }, email_status: "follow_ups_stopped", last_seen_at: "2026-11-15T10:00:00Z" });
    assert.deepEqual([r.label, r.moreLabels, r.source, r.cameFrom, r.utm, r.emailStatus], ["Creator", 1, "Form", "Creators: join", "meta / lagos", "Emails stopped"]);
    assert.equal(leadRowView({ id: "2", latest: {} }).utm, "direct");
  });
  it("consent and ad lines; the card fields", () => {
    assert.equal(consentLine({ marketing_consent: true, consent_at: "D", consent_source: "book_a_call" }), "Agreed to marketing email on D · Book a call");
    assert.equal(consentLine({ marketing_consent: false }), "No marketing consent");
    assert.equal(adLine("meta_click"), "Came from a Meta ad");
    assert.equal(adLine("ads_off"), "Ad cookies off");
    assert.equal(adLine("none"), "No ad");
    assert.equal(pipelineFor({ primary_label: "creator" }), "creators");
    assert.equal(pipelineFor({ primary_label: "local" }), "hosts");
    assert.deepEqual(leadCardFields({ name: "Ada", email: "ada@example.org" }), { name: "Ada", source: "inbound", identifiers: [{ kind: "email", value: "ada@example.org" }], channel: "email" });
  });
  it("the banner copy is exact", () => {
    const b = selectionBanner({ selected: 12, marketable: 9 });
    assert.equal(b.strong, "12 selected.");
    assert.equal(b.rest, "9 can get a marketing email; 3 left out (no consent or unsubscribed). One-to-one replies are always allowed.");
  });
});

describe("#4452 L-4 the marketable count", () => {
  it("counts only consent yes, not unsubscribed, not test", () => {
    const rows = [
      { marketing_consent: true, email_status: "emailed" },
      { marketing_consent: false, email_status: "never_emailed" },
      { marketing_consent: true, email_status: "unsubscribed" },
      { marketing_consent: true, email_status: "emailed", is_test: true },
    ];
    assert.equal(marketableOf(rows), 1);
  });
});

describe("#4452 L-5 the CSV", () => {
  it("quotes and guards against formulas", () => {
    const csv = leadsCsv({ columns: ["email", "name"], answer_fields: [{ key: "city", label: "City" }],
      rows: [{ email: "a@b.c", name: "=HYPERLINK(\"x\")", answers: { city: "Lagos, NG" } }, { email: "d@e.f", name: "+1", answers: {} }] });
    const lines = csv.split("\n");
    assert.equal(lines[0], "email,name,City");
    assert.equal(lines[1], "a@b.c,\"'=HYPERLINK(\"\"x\"\")\",\"Lagos, NG\"");
    assert.equal(lines[2], "d@e.f,'+1,");
    assert.ok(!/phone/i.test(read("services/leadsService.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no phones in the export path");
  });
});

describe("#4452 L-6 the composer hand-off", () => {
  it("reads #/email?leads= and ?lead=, nothing else", () => {
    assert.deepEqual(leadTargetFromHash(`#/email?leads=${SEL}`), { mode: "leads", selectionId: SEL });
    assert.deepEqual(leadTargetFromHash(`#/email?lead=${LEAD}`), { mode: "lead_reply", leadId: LEAD });
    assert.equal(leadTargetFromHash("#/email?leads=x"), null);
    assert.equal(leadTargetFromHash("#/email"), null);
  });
  it("audienceFor and the summary words", () => {
    assert.deepEqual(audienceFor("leads", null, {}, { selectionId: SEL }), { mode: "leads", selectionId: SEL });
    assert.deepEqual(audienceFor("lead_reply", null, {}, { leadId: LEAD }), { mode: "lead_reply", leadId: LEAD });
    assert.equal(audienceSummary("leads", {}, { will_receive: 7 }), "7 leads");
    assert.equal(audienceSummary("lead_reply", {}, null, null, { name: "Ada" }), "Reply to Ada");
    assert.equal(AUDIENCE_PRESETS.some((p) => /lead/i.test(p.id)), false, "leads are reached only from the Leads list");
  });
  it("a restored draft never pre-selects a leads audience (falls back to Hosts)", () => {
    for (const mode of ["leads", "lead_reply"]) {
      assert.deepEqual(restoreDraftAudience({ audienceMode: mode, filters: {} }, {}), { audienceMode: "segment", filters: { userType: "host" } });
    }
  });
  it("the send errors read in plain words", () => {
    assert.equal(leadsSendError(new Error("leads_send_limit")).message, "You've sent 5 emails to leads today. Ask an admin to send more.");
    assert.equal(leadsSendError(new Error("lead_selection_expired")).message, "This selection expired. Go back to Leads and select again.");
    const composer = read("components/email/EmailComposer.jsx");
    assert.match(composer, /One-to-one reply\. It goes even without marketing consent; don't use it for promotions\./);
    assert.match(composer, /leads from Leads/);
    assert.match(composer, /Change audience/);
  });
});

describe("#4452 L-7 the page and the menu", () => {
  it("is called Leads, keeps its id and renders the one list", () => {
    assert.equal(NAV_ITEMS.find((i) => i.id === "inbound").label, "Leads");
    const page = read("pages/InboundLeadsPage.jsx");
    assert.match(page, /title="Leads"/);
    assert.match(page, /description="Every lead in one list: forms, calls, free tools and beta\. Labelled, filterable, emailable\."/);
    assert.match(page, /<LeadsList /);
    const list = read("components/leads/LeadsList.jsx");
    assert.match(list, /<strong>No leads match\.<\/strong>/);
    assert.match(list, /Email \{count\.toLocaleString\(\)\} selected/);
    assert.match(list, /\{state\.can\.export && \(/, "Export only for leads_can_export");
    assert.match(list, /Select all \{state\.total\.toLocaleString\(\)\} matching/);
  });
});
