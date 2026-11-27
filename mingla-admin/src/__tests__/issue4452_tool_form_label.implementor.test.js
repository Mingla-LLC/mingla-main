// #4452 B18: the four "Free tool follow-ups" system forms (migration 20280714004452,
// template 'tool') stay in Admin > Forms but are labelled as the free tools' follow-up emails:
// a "Free tool emails" badge in the list (in place of the lead label) with a one-line hint,
// and the same badge plus the hint in the builder header.
// FAILS-ON-REVERT: removing isToolForm from the list or the builder header fails here.
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
export const archiveForm = async () => ({ refreshed: true }); export const siteRefreshWarning = () => {}; export const unarchiveForm = async () => ({ refreshed: true }); export const createForm = async () => ({}); export const duplicateForm = async () => ({});
`;

let h;
before(async () => {
  h = await buildHarness(`
import { renderToStaticMarkup as r } from "react-dom/server";
import * as M from "../../lib/formsModel.js";
import { FormsTable } from "../../pages/FormsPage.jsx";
export { M };
export const table = (p) => r(<FormsTable onEdit={() => {}} onDuplicate={() => {}} onArchive={() => {}} {...p} />);
`, {
    name: "issue4452-toolform",
    stubs: {
      "context/ToastContext": "export const useToast = () => ({ addToast() {} });",
      "services/formsService": STUB_SERVICES,
      "services/websitePagesService": "export const revalidatePages = async () => true; export const formPlacements = () => new Promise(() => {});",
      "services/leadsService": "export const listLeads = () => new Promise(() => {}); export const exportLeads = async () => ({}); export const createLeadSelection = async () => ({}); export const getLead = () => new Promise(() => {}); export const linkLeadToCard = async () => ({}); export const stopFormEmails = async () => ({});",
      "services/crmService": "export const createRecord = async () => ({}); export const newRequestKey = () => 'k';",
    },
  });
});

const row = (o) => ({ id: "f1", name: "Free tool follow-ups: Event planner", status: "draft", audience: "host", fields: 3, placements: [], subs_7d: 0, goes_to: "Leads", ...o });

describe("B18 free tool system forms are labelled", () => {
  it("the model knows a tool form by template 'tool'", () => {
    assert.equal(h.M.isToolForm({ template: "tool" }), true);
    assert.equal(h.M.isToolForm({ template: "creators" }), false);
    assert.equal(h.M.TOOL_FORM_BADGE, "Free tool emails");
  });
  it("the list shows the badge instead of the lead label, with the hint", () => {
    const html = h.table({ canEdit: true, rows: [row({ template: "tool" })] });
    assert.match(html, /data-tool-form-badge/);
    assert.match(html, /Free tool emails/);
    assert.match(html, /follow-up emails a free tool sends/i);
  });
  it("an ordinary form has no tool badge", () => {
    const html = h.table({ canEdit: true, rows: [row({ name: "Creators", template: "creators" })] });
    assert.doesNotMatch(html, /Free tool emails/);
  });
  it("the builder header carries the badge and the hint, and no tab is removed for tool forms", () => {
    const src = readSrc("components/forms/FormBuilder.jsx");
    assert.match(src, /isToolForm\(form\) && <Badge variant="info">\{TOOL_FORM_BADGE\}<\/Badge>/);
    assert.match(src, /isToolForm\(form\) \? TOOL_FORM_HINT/);
    assert.doesNotMatch(src, /filter\(\(t\) => [^\n]*isToolForm/);
  });
});
