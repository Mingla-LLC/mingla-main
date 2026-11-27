// #4452 §7.3–§7.5, §7.8 (Admin Forms): the list, the builder, Results and the
// Google conversions card. Rules are tested on the pure model; components are
// rendered from their real source (esbuild + react-dom/server) with the
// services stubbed, so no network is touched.
//
//   T-7.3   SC-150  list filters, Duplicate toast, Archive question, empty state
//   T-7.4a  SC-151  autosave: dirty / saved / a newer edit stays dirty / PT409 keeps the edit
//   T-7.4b  SC-152  Publish blocks while any check fails and lists each failing check (risky path)
//   T-7.4c  SC-153  contrast badge ratio and red below 4.5; the preview is the marketing field kit
//   T-7.4d  SC-154  photos: over 8 MB refused before upload; ≤ 5 MiB stored with a _thumb
//   T-AUTO          automation timing, stop rules and branches (risky path)
//   T-7.5c  SC-157  funnel % and bars, real zeros, no "Illustrative", "—" spend
//   T-7.8   SC-60   Google conversions: Ready / Create, never a resource name
//   T-7.0   SC-163  view-only members see every edit control disabled with the hint
//   A1-T-6  A1-SC-19 Submissions / Results are the Leads list with {form_id}
//
// FAILS-ON-REVERT: letting Publish enable while a check fails (dropping
// `!review.ok` from its disabled) fails T-7.4b; a follow-up before any wait
// (kind walk) fails T-AUTO; letting the PT409 path overwrite fails T-7.4a.
//
//   B22/B23/B24 (follow-up, migration 20280725004452): check 5 passes with "No emails to test" when the
//   flow sends the person no email; an invalid_flow refusal (bad_step:<id> and the other flow codes) marks
//   the step card with a plain reason and never points at Publish; "save first" hints close themselves and
//   a successful save closes the stale error toasts.
//   FAILS-ON-REVERT: `ok: testedAt !== null` alone fails B22; the "See Publish for the list." toast or a
//   card without data-step-error fails B23; an error-variant no_email_steps toast fails B24.
//
// Run: node --test src/__tests__/issue4452_forms_builder.implementor.test.js (from mingla-admin).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHarness, readSrc } from "./support/issue4452Harness.js";

const STUB_SERVICES = `
export class FormsError extends Error {}
export const listForms = () => new Promise(() => {});
export const libraryPhotos = () => new Promise(() => {});
export const googleConversionKinds = () => new Promise(() => {});
export const crmChoices = () => Promise.resolve({ stages: [], team: [] });
export const getSchedulerProfiles = () => Promise.resolve([]);
export const uploadFormPhoto = async () => ({});
export const createGoogleConversion = async () => ({});
export const sendTestEmails = async () => ({ sent: 1 });
export const publishForm = async () => ({ version: 2 });
export const formResults = () => new Promise(() => {});
export const formsErrorWords = (e) => e?.message || "x";
export const saveAutomationDraft = async () => ({}); export const publishAutomation = async () => ({});
export const setAutomationEnabled = async () => ({}); export const testWholeFlow = async () => ({});
export const getAutomation = async () => ({}); export const getForm = async () => ({}); export const saveFormDraft = async () => ({});
export const archiveForm = async () => ({ result: {}, refreshed: true }); export const refreshSiteAfter = async (a) => ({ result: await a(), refreshed: true }); export const siteRefreshWarning = () => {}; export const unarchiveForm = async () => ({ result: {}, refreshed: true }); export const createForm = async () => ({}); export const duplicateForm = async () => ({});
`;

let h;
before(async () => {
  h = await buildHarness(`
import { renderToStaticMarkup as r } from "react-dom/server";
import * as M from "../../lib/formsModel.js";
import * as F from "../../lib/flowModel.js";
import { FormsTable } from "../../pages/FormsPage.jsx";
import { PublishTab } from "../../components/forms/PublishTab.jsx";
import { DesignTab } from "../../components/forms/DesignTab.jsx";
import { FieldsTab } from "../../components/forms/FieldsTab.jsx";
import { GoogleConversionsCardView } from "../../components/forms/GoogleConversionsCardView.jsx";
import { FlowList } from "../../components/forms/AutomationsTab.jsx";
import { kitSrcDoc, previewForm } from "../../lib/formsPreview.js";
export { M, F, kitSrcDoc, previewForm };
export const table = (p) => r(<FormsTable onEdit={() => {}} onDuplicate={() => {}} onArchive={() => {}} {...p} />);
export const publish = (p) => r(<PublishTab flush={async () => {}} reload={async () => {}} meta={{ versions: 2 }} rev={3} dirty={false} {...p} />);
export const design = (p) => r(<DesignTab edit={() => {}} {...p} />);
export const fields = (p) => r(<FieldsTab edit={() => {}} {...p} />);
export const google = (p) => r(<GoogleConversionsCardView onCreate={() => {}} busy="" {...p} />);
export const flowList = (steps, errors) => r(<FlowList steps={steps} path={[]} ctx={{ canEdit: true, cardOn: false, kinds: {}, fields: [], stats: {}, sel: null, errors, select() {}, add() {} }} />);
`, {
    name: "issue4452-forms",
    stubs: {
      "context/ToastContext": "export const useToast = () => ({ addToast() {} });",
      "services/formsService": STUB_SERVICES,
      "services/websitePagesService": "export const revalidatePages = async () => true; export const formPlacements = () => new Promise(() => {});",
      // FormsPage and ResultsTab embed the Leads list (and its drawer): stub their
      // services too, so no Supabase client (and no realtime socket, which Node 20
      // lacks) is built at import time.
      "services/leadsService": "export const listLeads = () => new Promise(() => {}); export const exportLeads = async () => ({}); export const createLeadSelection = async () => ({}); export const getLead = () => new Promise(() => {}); export const linkLeadToCard = async () => ({}); export const stopFormEmails = async () => ({});",
      "services/crmService": "export const createRecord = async () => ({}); export const newRequestKey = () => 'k';",
    },
  });
});

const CREATORS = () => ({
  v: 1, audience: "creator",
  fields: [
    { key: "name", type: "name", label: "Your name", required: true, locked: true },
    { key: "email", type: "email", label: "Email", required: true, locked: true },
    { key: "phone", type: "phone", label: "Phone", required: true, locked: true },
    { key: "what_do_you_make", type: "single", label: "What do you make?", required: true, options: ["Video", "Photo", "Both"] },
    { key: "consent", type: "consent", label: "Send me creator tips.", required: false },
  ],
  ads: { lead_on: true, goal: "call_booked" },
  routing: { card: { on: false } },
  own_page: { on: false, index: false, bg: "night" },
});
const FLOW = () => ({
  v: 1,
  steps: [
    { id: "welcome", type: "email", name: "Welcome", to: "person", from: "creators", reply_to: "team", subject: "Hi {first_name}", doc: [{ id: "b", type: "rich_text", html: "<p>Hi</p>" }], show_answers: false, action_bar: "auto" },
    { id: "w2", type: "wait", n: 2, unit: "days", at10: true, skip_weekends: false },
    { id: "nudge", type: "email", name: "Day 2", to: "person", from: "creators", reply_to: "team", subject: "Day 2", doc: [{ id: "c", type: "rich_text", html: "<p>Hey</p>" }], show_answers: false, action_bar: "auto" },
  ],
});

describe("#4452 T-7.3 the Forms list", () => {
  it("the status segments map to admin_forms_list's p_status", () => {
    assert.deepEqual(h.M.STATUS_FILTERS.map((s) => [s.label, s.status]), [["All", null], ["Live", "live"], ["Drafts", "draft"], ["Archived", "archived"]]);
    assert.match(readSrc("pages/FormsPage.jsx"), /const load = useCallback\(\(\) => listForms\(status\), \[status\]\);/);
  });
  it("Duplicate and Archive say exactly what the design says", () => {
    assert.equal(h.M.DUPLICATED_TOAST, "Duplicated as a draft. It is not on any page yet.");
    assert.equal(h.M.ARCHIVED_TOAST, "Archived and taken off every page. Answers stay.");
    assert.equal(h.M.archiveQuestion("Creators"), "Archive 'Creators'? It is taken off every page and its emails stop. Answers stay.");
    assert.match(readSrc("pages/FormsPage.jsx"), /await archiveForm\(archiving\.id\)/, "archive only after the confirm dialog");
  });
  it("rows show status, label, where it shows, 7 days and goes to; an empty filter says Nothing here.", () => {
    const html = h.table({ canEdit: true, rows: [{ id: "f1", name: "Creators", status: "live", live_version: 3, audience: "creator", fields: 7, placements: [{ page_key: "creators", spot: "after-steps", type: "form" }], subs_7d: 12, goes_to: "Leads" }] });
    assert.match(html, /Live v3/);
    assert.match(html, /data-label-pill="creator"[^>]*>Creator lead</);
    assert.match(html, /creators · after the steps/);
    assert.match(html, />12</);
    assert.match(html, />Leads</);
    assert.match(html, /7 questions/);
    const empty = h.table({ canEdit: true, rows: [] });
    assert.match(empty, /Nothing here\./);
    assert.match(empty, /Archived forms keep their answers\./);
  });
  it("Book-a-call forms say they use the Book-a-call emails", () => {
    assert.equal(h.M.formSubLine({ template: "book_call_extra", fields: 3 }), "Uses Book-a-call emails");
    // #4452 §6.9: the free tools' system follow-up forms are labelled, and never offered for a page spot.
    assert.equal(h.M.formSubLine({ template: "tool", fields: 3 }), h.M.TOOL_FORM_HINT);
    assert.match(readSrc("components/website/PageSidePanel.jsx"), /f\.template !== "tool" && \(details \?/);
  });
});

describe("#4452 T-7.4a autosave and conflicts", () => {
  const start = { draft: { a: 1 }, rev: 4, dirty: false, saving: false, conflict: false, saveError: null };
  it("an edit is dirty; saved clears it and takes the new rev", () => {
    const d1 = { a: 2 };
    let s = h.M.autosaveReducer(start, { type: "edit", draft: d1 });
    assert.equal(s.dirty, true);
    s = h.M.autosaveReducer(h.M.autosaveReducer(s, { type: "saving" }), { type: "saved", rev: 5, sent: d1 });
    assert.deepEqual([s.dirty, s.rev, s.saving], [false, 5, false]);
  });
  it("an edit made while saving stays dirty after the save returns", () => {
    const d1 = { a: 2 };
    const d2 = { a: 3 };
    let s = h.M.autosaveReducer(start, { type: "edit", draft: d1 });
    s = h.M.autosaveReducer(s, { type: "saving" });
    s = h.M.autosaveReducer(s, { type: "edit", draft: d2 });
    s = h.M.autosaveReducer(s, { type: "saved", rev: 5, sent: d1 });
    assert.equal(s.dirty, true);
    assert.equal(s.draft, d2);
  });
  it("a PT409 is a conflict that KEEPS the local edit (no overwrite, no reload)", () => {
    const d1 = { a: 9 };
    let s = h.M.autosaveReducer(start, { type: "edit", draft: d1 });
    s = h.M.autosaveReducer(s, { type: "conflict" });
    assert.equal(s.conflict, true);
    assert.equal(s.draft, d1);
    assert.equal(s.rev, 4, "the rev is not bumped: the next save cannot overwrite theirs");
    const src = readSrc("components/forms/FormBuilder.jsx");
    assert.match(src, /if \(e\.code === "PT409"\) dispatch\(\{ type: "conflict" \}\);/);
    assert.match(src, /if \(!cur\.dirty \|\| cur\.saving \|\| cur\.conflict\) return;/, "no save while in conflict");
    assert.match(src, /Load their version/);
    assert.equal(h.M.AUTOSAVE_MS, 800);
    assert.equal(h.M.CONFLICT_COPY, "Someone else changed this form.");
  });
  it("leaving with an unsaved edit asks Keep or Discard, in the page", () => {
    const src = readSrc("components/forms/FormBuilder.jsx");
    assert.match(src, /data-leave-prompt=""/);
    assert.match(src, /Keep editing/);
    assert.match(src, />Discard</);
  });
});

describe("#4452 T-7.4b Publish blocks while a check fails (risky path)", () => {
  it("each of the five checks fails on its own and is listed", () => {
    const base = CREATORS();
    const ok = h.M.publishReview(base, FLOW(), "2026-11-16T00:00:00Z");
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    const noTest = h.M.publishReview(base, FLOW(), null);
    assert.deepEqual(noTest.checks.filter((c) => !c.ok).map((c) => c.title), ["You sent yourself a test"]);
    const noConsent = { ...base, fields: base.fields.filter((f) => f.type !== "consent") };
    const r2 = h.M.publishReview(noConsent, FLOW(), "x");
    assert.ok(r2.checks.find((c) => c.id === "consent_for_follow_ups" && !c.ok));
    assert.ok(r2.errors.some((e) => e.code === "follow_up_needs_consent"));
    const required = { ...base, fields: base.fields.map((f) => (f.type === "consent" ? { ...f, required: true } : f)) };
    assert.ok(h.M.publishReview(required, FLOW(), "x").checks.find((c) => c.id === "consent_optional" && !c.ok));
    const noEmail = { ...base, fields: base.fields.filter((f) => f.type !== "email") };
    assert.ok(h.M.publishReview(noEmail, null, "x").checks.find((c) => c.id === "email_required" && !c.ok));
    const noLabel = { ...base, audience: "x" };
    assert.ok(h.M.publishReview(noLabel, null, "x").checks.find((c) => c.id === "lead_label_set" && !c.ok));
  });
  it("R and F errors are listed by field and step", () => {
    const def = CREATORS();
    def.fields[3] = { ...def.fields[3], options: [] };
    const flow = FLOW();
    flow.steps[0].subject = "Hi {nickname}";
    const r = h.M.publishReview(def, flow, "x");
    const lines = r.errors.map((e) => e.line);
    assert.ok(lines.some((l) => l.startsWith("What do you make?: needs 1 to 20 different options")), lines.join(" | "));
    assert.ok(lines.some((l) => l === 'Unknown merge field {nickname} (in "Welcome")'), lines.join(" | "));
  });
  it("the Publish button is disabled while anything fails, with the exact words", () => {
    const def = CREATORS();
    const bad = h.M.publishReview(def, FLOW(), null);
    const html = h.publish({ form: { id: "f" }, def, flow: FLOW(), review: bad, canEdit: true });
    assert.match(html, /data-publish-button=""[^>]*disabled=""|disabled=""[^>]*data-publish-button=""/);
    assert.match(html, /Fix the items marked ! to publish\./);
    assert.match(html, /data-check="tested" data-ok="no"/);
    assert.match(html, /Publish version 3/);
    const good = h.M.publishReview(def, FLOW(), "x");
    const ok = h.publish({ form: { id: "f" }, def, flow: FLOW(), review: good, canEdit: true });
    assert.doesNotMatch(ok, /Fix the items marked !/);
    assert.doesNotMatch(ok.match(/<button[^>]*data-publish-button[^>]*>/)?.[0] || "", /disabled/);
  });
  it("the server's refusal list is read back as lines", () => {
    const lines = h.M.serverCheckLines(JSON.stringify([{ path: "check", code: "tested" }, { path: "fields[3].options", code: "bad_options" }]), CREATORS(), null);
    assert.deepEqual(lines, ["You sent yourself a test", "What do you make?: needs 1 to 20 different options, each up to 60 characters"]);
  });
});

describe("#4452 T-7.4c the Design tab", () => {
  it("the contrast badge: ratio, green at 4.5 and up, red below", () => {
    const white = h.M.designContrast({ text_color: "#ffffff", backdrop: "night" });
    assert.ok(white >= 4.5, String(white));
    assert.match(h.M.contrastBadge(white).text, /^Contrast \d+\.\d:1 · easy to read$/);
    const low = h.M.designContrast({ text_color: "#ffffff", backdrop: "paper" });
    assert.ok(low < 4.5, String(low));
    assert.equal(h.M.contrastBadge(low).text, `Contrast ${low.toFixed(1)}:1 · too low, pick a darker backdrop or lighter text`);
    const html = h.design({ def: { ...CREATORS(), design: { text_color: "#ffffff", backdrop: "paper" } }, canEdit: true, form: { id: "f", key: "creators", name: "Creators" } });
    assert.match(html, /data-contrast-badge="low"[^>]*class="[^"]*bg-\[#fee2e2\] text-\[#991b1b\]/);
  });
  it("draws every control the design lists, with the design's limits", () => {
    const html = h.design({ def: CREATORS(), canEdit: true, form: { id: "f", key: "creators", name: "Creators" } });
    for (const l of ["Big centre pop-up", "Full-height side panel", "Card on the page", "Its own page"]) assert.ok(html.includes(l), l);
    assert.equal((html.match(/role="radio"/g) || []).length, 9, "the 3 x 3 text grid");
    for (const t of ["Left (recommended)", "Centre", "Right", "One column", "Two columns", "Phones always use one column, full width.", "Upload a photo", "From the brand library, or upload. Faces never sit under text."]) assert.ok(html.includes(t), t);
    for (const [label, max] of [["Title bar", 40], ["Headline", 24], ["Italic ending", 20], ["Reason 1", 44], ["Send button", 24], ["Dismiss link", 16], ["Small print by the button", 60]]) {
      assert.ok(new RegExp(`${label}[\\s\\S]{0,400}?maxLength="${max}"|maxlength="${max}"`).test(html), `${label} ${max}`);
    }
    for (const n of ["Night", "Ink", "Moss", "Clay", "Paper", "White", "Sand", "Orange"]) assert.match(html, new RegExp(`aria-label="${n}"`), n);
    assert.match(html, /aria-label="Custom text colour"/);
  });
  it("the preview frame loads the marketing field kit, sandboxed, with no network", () => {
    const doc = h.kitSrcDoc("https://admin.usemingla.com");
    assert.match(doc, /<script src="https:\/\/admin\.usemingla\.com\/forms-kit\/forms-kit\.js">/);
    assert.match(doc, /connect-src 'none'/);
    assert.match(doc, /form-action 'none'/);
    assert.match(readSrc("components/forms/FormPreviewFrame.jsx"), /sandbox="allow-scripts"/);
    const sandboxes = readSrc("components/forms/FormPreviewFrame.jsx").match(/sandbox="[^"]*"/g) || [];
    assert.ok(sandboxes.length >= 2 && sandboxes.every((x) => x === 'sandbox="allow-scripts"'), "scripts only: never allow-same-origin");
    const build = readSrc("../scripts/build-forms-kit.mjs");
    assert.match(build, /mingla-marketing/);
    assert.match(build, /components\/forms\/kit\/forms-kit-entry\.tsx/);
    assert.equal(h.previewForm({ id: "f", key: "k", name: "N" }, CREATORS()).preview, true, "the kit renders a preview form: Send never submits");
  });
  it("designOf keeps every value inside the design's limits and lists", () => {
    const d = h.M.designOf({ layout: "weird", text_pos: "centre", text_color: "red", backdrop: "neon", tick: "x", head: "x".repeat(99), reasons: ["a"] });
    assert.deepEqual([d.layout, d.text_pos, d.text_color, d.backdrop, d.tick, d.head.length, d.reasons.length], ["centre", "centre-centre", "#ffffff", "night", "orange", 24, 3]);
  });
});

describe("#4452 T-7.4d photo uploads (§1.6)", () => {
  it("over 8 MB is refused before anything is read; 6 MB is accepted", () => {
    assert.equal(h.M.photoPrecheck({ type: "image/jpeg", size: 8 * 1024 * 1024 + 1 }), "That photo is over 8 MB. Pick a smaller one.");
    assert.equal(h.M.photoPrecheck({ type: "image/jpeg", size: 6 * 1024 * 1024 }), null);
    assert.equal(h.M.photoPrecheck({ type: "image/gif", size: 10 }), "Use a JPG, PNG or WebP photo.");
  });
  it("stored as a JPEG with a 2400 px long edge, re-encoded at 0.75 when over 5 MiB, then refused; plus a 600 px _thumb", () => {
    assert.deepEqual(h.M.fitEdge(6000, 4000, 2400), { width: 2400, height: 1600 });
    assert.deepEqual(h.M.fitEdge(1200, 800, 2400), { width: 1200, height: 800 });
    const src = readSrc("services/formsService.js");
    assert.match(src, /let main = await encode\(bitmap, PHOTO_LONG_EDGE, 0\.85\);/);
    assert.match(src, /if \(main\.size > PHOTO_STORED_MAX\) main = await encode\(bitmap, PHOTO_LONG_EDGE, 0\.75\);/);
    assert.match(src, /if \(main\.size > PHOTO_STORED_MAX\) throw new FormsError\("photo_too_large", PHOTO_TOO_BIG_AFTER\);/);
    assert.match(src, /encode\(bitmap, PHOTO_THUMB_EDGE, 0\.8\)/);
    assert.match(src, /`\$\{user\.id\}\/forms\/\$\{id\}_thumb\.jpg`/);
    assert.equal(h.M.PHOTO_STORED_MAX, 5 * 1024 * 1024);
    assert.doesNotMatch(src, /render\/image/, "no Supabase Image Transformations (#1643)");
  });
});

describe("#4452 T-AUTO automation timing, stop rules and branches (risky path)", () => {
  it("an email before any wait is a confirmation; after a wait, a follow-up; a branch path inherits its waits", () => {
    let flow = FLOW();
    const branch = { ...h.F.newStep("branch", flow), id: "br1" };
    flow = h.F.insertStep(flow, [], 3, branch);
    const inYes = { ...h.F.newStep("email", flow), id: "yes1" };
    flow = h.F.insertStep(flow, ["br1", "yes"], 0, inYes);
    const early = { ...h.F.newStep("email", flow), id: "early" };
    flow = h.F.insertStep(flow, [], 0, early);
    const kinds = h.F.kindsOf(flow);
    assert.deepEqual(kinds, { early: "confirmation", welcome: "confirmation", nudge: "follow_up", yes1: "follow_up" });
  });
  it("adding into a branch path, updating and removing (a branch goes with both paths)", () => {
    let flow = FLOW();
    flow = h.F.insertStep(flow, [], 1, { id: "brx", type: "branch", cond: { on: "booked", op: "is", value: "yes" }, yes: [], no: [] });
    flow = h.F.insertStep(flow, ["brx", "no"], 0, { id: "tm", type: "team", name: "Team", to: "creators_inbox", include_answers: true });
    assert.equal(h.F.findStep(flow.steps, "tm").name, "Team");
    flow = h.F.updateStep(flow, "tm", { name: "Ping", id: "hacked", type: "email" });
    assert.deepEqual([h.F.findStep(flow.steps, "tm").name, h.F.findStep(flow.steps, "tm").type], ["Ping", "team"], "an edit never changes a step's id or type");
    flow = h.F.removeStep(flow, "brx");
    assert.equal(h.F.findStep(flow.steps, "tm"), null);
    assert.deepEqual(flow.steps.map((s) => s.id), ["welcome", "w2", "nudge"]);
  });
  it("new ids are unique across the whole tree (F-2)", () => {
    const flow = FLOW();
    const ids = new Set(h.F.allIds(flow.steps));
    for (let i = 0; i < 200; i += 1) {
      const id = h.F.mintId("email", [...ids]);
      assert.ok(!ids.has(id) && /^[a-z0-9_-]{2,40}$/.test(id));
      ids.add(id);
    }
  });
  it("a new wait is 2 days at 10:00 their time, weekends counted; waits over 90 days are refused", () => {
    const w = h.F.newStep("wait", FLOW());
    assert.deepEqual([w.n, w.unit, w.at10, w.skip_weekends], [2, "days", true, false]);
    const flow = FLOW();
    flow.steps[1] = { ...flow.steps[1], n: 13, unit: "weeks" };
    assert.ok(h.M.publishReview(CREATORS(), flow, "x").errors.some((e) => e.code === "waits_over_90_days"));
    assert.equal(h.F.totalWaitDays(flow.steps), 91);
  });
  it("stop rules: unsubscribe is always on, replied is Coming soon (off), booked and stage default on", () => {
    assert.deepEqual(h.F.normalizeStops({ booked: false, replied: true, unsub: false, stage: false }), { booked: false, replied: false, unsub: true, stage: false });
    assert.deepEqual(h.F.normalizeStops(null), { booked: true, replied: false, unsub: true, stage: true });
    const rules = Object.fromEntries(h.F.STOP_RULES.map((r) => [r.id, r]));
    assert.equal(rules.unsub.locked && rules.unsub.always, true);
    assert.equal(rules.replied.locked && rules.replied.soon, true);
  });
  it("a pipeline move needs the card on (F-4)", () => {
    const flow = FLOW();
    flow.steps.push({ id: "mv", type: "stage", stage: "contacted" });
    assert.ok(h.M.publishReview(CREATORS(), flow, "x").errors.some((e) => e.code === "stage_needs_card"));
  });
  it("the email step uses the SAME EmailBodyEditor with the form's tokens, and Send me this email", () => {
    const src = readSrc("components/forms/AutomationsTab.jsx");
    assert.match(src, /import \{ EmailBodyEditor \} from "\.\.\/email\/EmailBodyEditor";/);
    assert.match(src, /<EmailBodyEditor value=\{step\.doc \|\| \[\]\}[^\n]*tokens=\{tokens\} \/>/);
    assert.match(src, /Buttons above the footer/);
    assert.match(src, /Show their answers in the email/);
    assert.match(src, /Send me this email/);
    assert.match(src, /Test the whole flow/);
    assert.equal(h.F.SAVED_TOAST, "Saved. People already in the flow keep the emails they were sent; new steps apply from their next step.");
  });
});

describe("#4452 T-7.5c Results", () => {
  const results = { label: "creator", goal: "call_booked", funnel: { ad_clicks: null, shown: 400, started: 120, sent: 60, calls_booked: 0, approved: 0 } };
  it("each step's % of the previous one; bars at least 3%; real zeros stay 0", () => {
    const steps = h.M.funnelSteps(results);
    assert.deepEqual(steps.map((s) => [s.label, s.value, s.pct]), [
      ["Ad clicks", null, null], ["Pop-up or page shown", 400, null], ["Started the form", 120, 30],
      ["Sent: Creator lead", 60, 50], ["Booked a call", 0, 0], ["Approved", 0, null],
    ]);
    assert.ok(steps.every((s) => s.width >= 3));
    assert.equal(steps.find((s) => s.id === "shown").width, 100);
  });
  it('spend is "—" when the Ads engine has none, and nothing says Illustrative', () => {
    assert.equal(h.M.money(undefined, "USD"), "—");
    assert.equal(h.M.perUnit(1000, 0, "USD"), "—");
    assert.equal(h.M.perUnit(1000, 4, "USD"), "$2.50");
    const src = readSrc("components/forms/ResultsTab.jsx");
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /Illustrative/);
    assert.match(src, /SPEND_UNMATCHED/);
    assert.equal(h.M.SPEND_UNMATCHED, "Spend not in the Ads engine for this campaign");
  });
});

describe("#4452 A1-T-6 Submissions are the Leads list with the form filter", () => {
  it("Results renders LeadsList with exactly {form_id}", () => {
    const src = readSrc("components/forms/ResultsTab.jsx");
    assert.match(src, /const fixed = \{ form_id: form\.id \};/);
    assert.match(src, /<LeadsList [^\n]*fixed=\{fixed\}/);
    assert.match(src, /#\/inbound\?form=\$\{form\.id\}/, "Open in Leads");
    assert.match(readSrc("pages/FormsPage.jsx"), /<LeadsList [^\n]*fixed=\{\{ sources: \["form"\] \}\}/);
  });
});

describe("#4452 T-7.8 Google conversions", () => {
  it("Ready for host_lead, Create for the 5 new kinds, never a resource name", () => {
    const kinds = { host_lead: { ready: true } };
    for (const k of ["creator_lead", "local_lead", "host_call_booked", "creator_call_booked", "local_call_booked"]) kinds[k] = { ready: false };
    const html = h.google({ data: { connected: true, kinds } });
    assert.match(html, /data-google-kind="host_lead"[\s\S]*?Ready/);
    assert.equal((html.match(/>Create</g) || []).length, 5);
    assert.doesNotMatch(html, /customers\/|conversionActions\//);
    assert.match(readSrc("services/formsService.js"), /fn\("admin-ad-google-provision-conversion", \{ lane: "consumer", kind \}\)/);
  });
  it("only admins see it", () => {
    assert.match(readSrc("pages/FormsPage.jsx"), /\{data\?\.is_admin && <GoogleConversionsCard \/>\}/);
  });
});

describe("#4452 T-7.0 view-only members", () => {
  it("every edit control is disabled, and the page says to ask for the Website editor role", () => {
    const html = h.fields({ def: CREATORS(), canEdit: false, form: { template: "creators" } });
    const buttons = html.match(/<button[^>]*>/g) || [];
    const editButtons = buttons.filter((b) => /data-add-field|aria-label="(Move|Remove)/.test(b));
    assert.ok(editButtons.length > 10);
    assert.ok(editButtons.every((b) => /disabled=""/.test(b)), "every add, move and remove is disabled");
    assert.match(readSrc("components/forms/formsUi.jsx"), /export const READ_ONLY_WORDS = "Ask an admin for the Website editor role";/);
    assert.match(readSrc("components/forms/FormBuilder.jsx"), /\{!form\.can_edit && <ReadOnlyHint \/>\}/);
  });
  it("growth and the Website role can open Forms and Website pages; others cannot", async () => {
    const { canOpenPage } = await import("../lib/access.js");
    const growth = { status: "active", role: "growth", areas: ["role_home", "crm", "beta_leads", "email_drafts"] };
    const website = { status: "active", role: "website", areas: ["role_home", "website"] };
    const nobody = { status: "active", role: "x", areas: ["role_home"] };
    for (const page of ["forms", "website-pages"]) {
      assert.equal(canOpenPage(growth, page), true, `growth ${page}`);
      assert.equal(canOpenPage(website, page), true, `website ${page}`);
      assert.equal(canOpenPage(nobody, page), false, `nobody ${page}`);
    }
  });
});

// #4452 B19: a failed forms-admin call ("Send me a test", "Test the whole flow")
// shows plain words, never the client library's raw "Failed to send a request
// to the Edge Function". FAILS-ON-REVERT: putting `error.message` back into the
// fn() throw, or `e.message` back into the flow test's toast, fails these.
describe("#4452 B19 a failed forms-admin call reads in plain English", () => {
  const RAW = "Failed to send a request to the Edge Function";
  it("an unreachable function says so plainly; the server's own message wins when it sent one", () => {
    const fetchError = Object.assign(new Error(RAW), { name: "FunctionsFetchError" });
    assert.equal(h.M.functionErrorWords(fetchError, null), h.M.FUNCTION_UNREACHABLE);
    assert.doesNotMatch(h.M.FUNCTION_UNREACHABLE, /Edge Function/);
    assert.equal(h.M.functionErrorWords(new Error("x"), { error: "publish_first", message: "Publish the form and its emails first." }), "Publish the form and its emails first.");
    assert.equal(h.M.functionErrorWords(new Error(RAW), { error: "server" }), "Something on the server failed. Try again.");
    assert.equal(h.M.functionErrorWords(new Error(RAW), { error: "validation" }), "That did not go through. Try again.");
    assert.equal(h.M.functionErrorWords(new Error(RAW), null), "That did not go through. Try again.");
  });
  it("the service throws those words, and every forms-admin toast goes through formsErrorWords", () => {
    const svc = readSrc("services/formsService.js");
    assert.match(svc, /throw new FormsError\(code, functionErrorWords\(error, payload\)\);/);
    assert.doesNotMatch(svc, /error\.message \|\| "That did not go through\."/);
    const auto = readSrc("components/forms/AutomationsTab.jsx");
    assert.doesNotMatch(auto, /title: e\.message/);
    assert.match(auto, /const res = await testWholeFlow\(form\.id\);[\s\S]{0,200}title: formsErrorWords\(e\)/);
  });
});

describe("#4452 follow-up B22 publish check 5 with no emails", () => {
  const TEAM_ONLY = () => ({ v: 1, steps: [{ id: "t1", type: "team", name: "Team alert", to: "creators_inbox", include_answers: true }] });
  it("passes as \"No emails to test\" when the flow sends the person nothing", () => {
    for (const flow of [null, { v: 1, steps: [] }, TEAM_ONLY()]) {
      const c = h.M.publishReview(CREATORS(), flow, null).checks.find((x) => x.id === "tested");
      assert.equal(c.ok, true, JSON.stringify(flow));
      assert.equal(c.title, "No emails to test");
    }
    const html = h.publish({ form: { id: "f" }, def: CREATORS(), flow: TEAM_ONLY(), review: h.M.publishReview(CREATORS(), TEAM_ONLY(), null), canEdit: true });
    assert.match(html, /data-check="tested" data-ok="yes"/);
    assert.match(html, /No emails to test/);
  });
  it("still needs a test when an email reaches the person", () => {
    const c = h.M.publishReview(CREATORS(), FLOW(), null).checks.find((x) => x.id === "tested");
    assert.equal(c.ok, false);
    assert.equal(c.title, "You sent yourself a test");
    const branchOnly = { v: 1, steps: [{ id: "b1", type: "branch", cond: { on: "booked", op: "is", value: "yes" }, yes: [], no: [FLOW().steps[0]] }] };
    assert.equal(h.M.publishReview(CREATORS(), branchOnly, null).checks.find((x) => x.id === "tested").ok, false, "an email inside a branch counts");
  });
});

describe("#4452 follow-up B23 a refused save marks the step", () => {
  const PROD = () => ({ v: 1, steps: [{ id: "emktrwbj", type: "email", name: "New email", to: "person", from: "creators", reply_to: "team", subject: "Hi {first_name}", doc: [{ id: "emktrwbjb", type: "rich_text", html: "<p>Hi {first_name},</p>" }], show_answers: false, action_bar: "auto" }] });
  it("bad_step:<id> names the step with the reason the contract gives", () => {
    const flow = PROD();
    delete flow.steps[0].to;
    const r = h.M.flowSaveErrors(JSON.stringify([{ code: "bad_step:emktrwbj", path: "steps" }]), flow, CREATORS());
    assert.deepEqual(r.byStep, { emktrwbj: "Pick who it goes to." });
    assert.deepEqual(r.general, []);
  });
  it("a bad_step with no matching step, and flow-wide codes, become plain general lines", () => {
    const r = h.M.flowSaveErrors(JSON.stringify([{ code: "bad_step:emktrwbjb", path: "steps" }, { code: "too_many_steps", path: "steps" }]), PROD(), CREATORS());
    assert.deepEqual(r.byStep, {});
    assert.deepEqual(r.general, ["A step could not be saved. Remove it and add it again.", "The flow has more than 30 steps."]);
  });
  it("unknown tokens, stage moves and follow-ups without consent land on their steps", () => {
    const flow = FLOW();
    flow.steps[2].subject = "Hi {nickname}";
    flow.steps.push({ id: "mv", type: "stage", stage: "contacted" });
    const noConsent = { ...CREATORS(), fields: CREATORS().fields.filter((f) => f.type !== "consent") };
    const r = h.M.flowSaveErrors(JSON.stringify([
      { code: "unknown_token:nickname", path: "steps" }, { code: "stage_needs_card", path: "steps" }, { code: "follow_up_needs_consent", path: "steps" },
    ]), flow, noConsent);
    assert.equal(r.byStep.nudge, "Unknown merge field {nickname}. Pick one from Insert.");
    assert.equal(r.byStep.mv, "A pipeline move needs the pipeline card on (Settings).");
    assert.equal(r.byStep.welcome, undefined, "the confirmation is not a follow-up");
  });
  it("the card is outlined with the reason; the toast never points at Publish", () => {
    const html = h.flowList(PROD().steps, { emktrwbj: "Pick who it goes to." });
    assert.match(html, /data-flow-step="emktrwbj"[^>]*data-step-error=""/);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /data-step-error-reason="">Pick who it goes to\.</);
    assert.doesNotMatch(h.flowList(PROD().steps, {}), /data-step-error/);
    const auto = readSrc("components/forms/AutomationsTab.jsx");
    assert.doesNotMatch(auto, /See Publish/);
    assert.match(auto, /flowSaveErrors\(e\.detail, flow, def, \{ cardOn, stages \}\)/);
  });
});

describe("#4452 follow-up B24 stale toasts", () => {
  it("the no-email hints are self-closing info toasts", () => {
    const builder = readSrc("components/forms/FormBuilder.jsx");
    assert.match(builder, /e\.code === "no_email_steps"\) addToast\(\{ variant: "info"/);
    assert.doesNotMatch(builder, /variant: "error", title: e\.code === "no_email_steps"/);
    assert.equal(readSrc("components/forms/AutomationsTab.jsx").includes('trackStale(addToast({ variant: "info", title: "Save changes first'), true);
  });
  it("a successful save closes the save-error toasts it made stale", () => {
    const auto = readSrc("components/forms/AutomationsTab.jsx");
    assert.match(auto, /await publishAutomation\(form\.id, saved\.draft_rev\);\s*setStepErrors\(\{\}\);\s*staleToasts\.current\.splice\(0\)\.forEach\(\(id\) => removeToast\?\.\(id\)\);/);
    assert.match(auto, /trackStale\(addToast\(\{\s*variant: "error",\s*title: ids\.length/);
  });
});

describe("#4452 B27 archive and unarchive refresh the public site", () => {
  let svc; let calls;
  before(async () => {
    svc = await buildHarness(`export * from "../../services/formsService.js";`, {
      name: "issue4452-b27",
      stubs: {
        "lib/supabase": `export const supabase = { rpc: async (name, args) => { globalThis.__b27.push(["rpc", name]); return { data: { ok: true }, error: null }; }, functions: { invoke: async () => ({ data: {}, error: null }) } };`,
        "/crmService": "export const fetchConfig = async () => ({});",
        "/websitePagesService": `export const revalidatePages = async () => { globalThis.__b27.push(["revalidate"]); if (globalThis.__b27fail) throw new Error("x"); return true; };`,
      },
    });
  });
  const run = async (fn) => { globalThis.__b27 = []; globalThis.__b27fail = false; await fn(); calls = globalThis.__b27; };
  it("archiveForm asks the site to refresh after the archive RPC", async () => {
    await run(() => svc.archiveForm("f1"));
    assert.deepEqual(calls, [["rpc", "admin_form_archive"], ["revalidate"]]);
  });
  it("unarchiveForm asks the site to refresh after the unarchive RPC", async () => {
    await run(() => svc.unarchiveForm("f1"));
    assert.deepEqual(calls, [["rpc", "admin_form_unarchive"], ["revalidate"]]);
  });
  it("publishForm refreshes too, and a failed refresh is reported, never swallowed", async () => {
    await run(() => svc.publishForm("f1", 3));
    assert.deepEqual(calls, [["rpc", "admin_form_publish"], ["revalidate"]]);
    globalThis.__b27 = []; globalThis.__b27fail = true;
    const out = await svc.archiveForm("f1");
    assert.equal(out.refreshed, false);
  });
  it("the callers use the refreshed flag; the false 'within a minute' copy is gone", () => {
    assert.doesNotMatch(readSrc("components/forms/PublishTab.jsx"), /within a minute/);
    assert.match(readSrc("components/forms/PublishTab.jsx"), /siteRefreshWarning/);
    assert.match(readSrc("pages/FormsPage.jsx"), /const \{ refreshed \} = await archiveForm/);
  });
});

describe("#4452 B28 an archived form can be unarchived", () => {
  it("the list shows Unarchive on archived rows only, and Archive on the others", () => {
    const rows = [{ id: "a", name: "Old", status: "archived", subs_7d: 0 }, { id: "b", name: "Cur", status: "live", live_version: 1, subs_7d: 0 }];
    const html = h.table({ rows, canEdit: true, onUnarchive: () => {} });
    assert.match(html, /aria-label="Unarchive Old"/);
    assert.doesNotMatch(html, /aria-label="Unarchive Cur"/);
    assert.doesNotMatch(html, /aria-label="Archive Old"/);
    assert.match(html, /aria-label="Archive Cur"/);
  });
  it("the list confirms, goes through unarchiveForm, and says it comes back as a draft", () => {
    const src = readSrc("pages/FormsPage.jsx");
    assert.match(src, /const \{ refreshed \} = await unarchiveForm\(unarchiving\.id\)/);
    assert.match(src, /title="Unarchive this form\?"/);
    assert.match(h.M.UNARCHIVED_TOAST, /as a draft/);
    assert.match(h.M.unarchiveQuestion("X"), /comes back as a draft/);
  });
  it("the builder banner has an Unarchive button wired to unarchiveForm and no longer points at a missing list action", () => {
    const src = readSrc("components/forms/FormBuilder.jsx");
    assert.match(src, /data-archived-banner/);
    assert.match(src, />Unarchive<\/Button>/);
    assert.match(src, /await unarchiveForm\(formId\)/);
    assert.doesNotMatch(src, /unarchive it from the list/);
  });
});
