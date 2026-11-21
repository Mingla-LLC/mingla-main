/**
 * #4514 fix wave (review finding 1, contract C5) — Export on the Responses page
 * is event manager and up, answers only: it reads `biz_brand_form_responses_export`
 * (event_manager+) and never the guest roster export (`brand-people-export` ->
 * `biz_export_brand_people`, brand_admin+), so an event manager's tap is never a
 * dead tap. The pg17 suite pins the server ranks (T-FIX-RANK); the button gate is
 * pinned here.
 *
 * FAILS-ON-REVERT: routing Export through `brand-people-export` again, or dropping
 * the leading tab / carriage return guard, turns a case red.
 */

const rpc = jest.fn();
const invoke = jest.fn();
const share = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Share: { share: (...a: unknown[]) => share(...a) },
}));

import { answersCsvFilename, buildAnswersCsv, exportFormAnswers } from "../brandFormsExportService";
import { MIN_RANK } from "../../utils/permissionGates";

const feed = {
  formId: "f1",
  eventId: "e1",
  columns: [{ key: "1:q1", versionId: "v1", version: 1, questionId: "q1", label: "Act", type: "short_text" }],
  rows: [{
    responseId: "r1", version: 1, submittedAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:00:00Z",
    verified: true, values: { "1:q1": "\t=HYPERLINK(1)" },
  }],
};

const responsesPage = {
  form: { id: "f1", name: "Open mic", status: "live", liveVersionId: "v1", doorFullAnswers: true },
  mode: "required_step",
  versions: {},
  total: 1,
  answeredCount: 1,
  counts: {},
  rows: [{
    responseId: "r1", versionId: "v1", version: 1, earlierVersion: false, answers: {}, source: "link",
    verified: true, viaLink: true, editCount: 0, submittedAt: "2026-11-19T10:00:00Z",
    updatedAt: "2026-11-19T10:00:00Z", subject: { kind: "rsvp", id: "rsvp-1", name: "Amara" }, holder: null,
  }],
  notAnswered: [],
};

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
  share.mockReset();
  rpc.mockImplementation((name: string) =>
    Promise.resolve(name === "biz_brand_form_responses_export"
      ? { data: feed, error: null }
      : { data: responsesPage, error: null }));
  share.mockResolvedValue({ action: "sharedAction" });
});

describe("Export on the Responses page (C5)", () => {
  it("the button shows from event manager, the rank the answers-only feed accepts", () => {
    expect(MIN_RANK.EXPORT_FORM_RESPONSES).toBe(40); // event_manager
  });

  it("reads the answers-only feed and never the roster export", async () => {
    const method = await exportFormAnswers({ formId: "f1", formName: "Open mic", eventId: "e1" });
    expect(method).toBe("shared");
    expect(rpc).toHaveBeenCalledWith("biz_brand_form_responses_export", { p_form_id: "f1", p_event_id: "e1" });
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("biz_export_brand_people");
    expect(invoke).not.toHaveBeenCalled();
    const csv: string = share.mock.calls[0][0].message;
    expect(csv.split("\r\n")[0]).toBe("Name,Answered,Updated,Form version,Verified,Act (v1)");
    expect(csv).toContain("Amara,");
    // A guest-written answer starting with a tab is kept as text.
    expect(csv).toContain("'\t=HYPERLINK(1)");
  });

  it("a refused feed throws a sentence the host can act on", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "brand_form_forbidden" } });
    await expect(exportFormAnswers({ formId: "f1", formName: "Open mic", eventId: "e1" })).rejects.toThrow();
    expect(share).not.toHaveBeenCalled();
  });
});

describe("answers CSV", () => {
  it("every leading = + - @, tab or carriage return is text; quotes and commas are escaped", () => {
    const csv = buildAnswersCsv(
      { ...feed, rows: ["=1", "+1", "-1", "@1", "\t1", "\r1", 'a,"b"'].map((v, i) => ({ ...feed.rows[0], responseId: `r${i}`, values: { "1:q1": v } })) },
      new Map(),
    );
    expect(csv).toContain(",'=1\r\n");
    expect(csv).toContain(",'+1\r\n");
    expect(csv).toContain(",'-1\r\n");
    expect(csv).toContain(",'@1\r\n");
    expect(csv).toContain(",'\t1\r\n");
    expect(csv).toContain(',"\'\r1"\r\n');
    expect(csv).toContain(',"a,""b"""\r\n');
  });

  it("the file name is the form's slug and the date", () => {
    expect(answersCsvFilename("Open Mic!", new Date(2026, 10, 19))).toBe("open-mic-answers-2026-11-19.csv");
  });
});
