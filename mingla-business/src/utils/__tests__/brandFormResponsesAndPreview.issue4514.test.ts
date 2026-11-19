/**
 * #4514 wave 2 — the Responses page's pure helpers (Summary bars, how an
 * answer reads, the answers CSV) and the builder preview's "Show only if".
 *
 * FAILS-ON-REVERT: dropping the formula guard, the hidden-answer drop or the
 * option-label mapping turns a case red.
 */

import type { BrandFormExport, BrandFormResponseRow, BrandFormResponsesPage } from "../../services/brandFormsService";
import { BRAND_FORM_SCHEMA, type BrandFormDefinition } from "../brandFormDefinition";
import { missingRequired, previewSchema, visibleAnswers, visibleQuestions } from "../brandFormPreview";
import { answerText, answersCsvFilename, buildAnswersCsv, subjectName, summarize, summaryDefinition } from "../brandFormResponses";

const def: BrandFormDefinition = {
  schema: BRAND_FORM_SCHEMA,
  title: "Open mic",
  questions: [
    {
      id: "q1",
      position: 0,
      type: "single_choice",
      label: "Would you like to perform?",
      required: true,
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    },
    {
      id: "q2",
      position: 1,
      type: "short_text",
      label: "What will you do?",
      required: true,
      show_if: { question_id: "q1", option_id: "yes" },
      show_at_door: true,
      help: "A few words",
    },
  ],
};

describe("preview: Show only if", () => {
  it("shows a dependent question only after its answer, and drops its answer when hidden", () => {
    expect(visibleQuestions(def, {}).map((q) => q.id)).toEqual(["q1"]);
    expect(visibleQuestions(def, { q1: "Yes" }).map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(visibleQuestions(def, { q1: "No" }).map((q) => q.id)).toEqual(["q1"]);
    expect(visibleAnswers(def, { q1: "No", q2: "A song" })).toEqual({ q1: "No" });
  });

  it("never requires a hidden question", () => {
    expect(missingRequired(def, {})).toBe(true);
    expect(missingRequired(def, { q1: "No" })).toBe(false);
    expect(missingRequired(def, { q1: "Yes" })).toBe(true);
    expect(missingRequired(def, { q1: "Yes", q2: "A song" })).toBe(false);
  });

  it("draws a door question with 'Shown to door staff' under its help", () => {
    const schema = previewSchema(def, { q1: "Yes" });
    expect(schema.questions[1]?.helper).toBe("A few words\nShown to door staff");
    expect(schema.questions[0]?.options).toEqual(["Yes", "No"]);
  });
});

const row = (over: Partial<BrandFormResponseRow> = {}): BrandFormResponseRow => ({
  responseId: "r1",
  versionId: "v1",
  version: 1,
  earlierVersion: false,
  answers: { q1: "yes", q2: "A song" },
  source: "page",
  verified: true,
  viaLink: false,
  editCount: 0,
  submittedAt: "2026-11-19T10:00:00Z",
  updatedAt: "2026-11-19T10:00:00Z",
  subject: { kind: "rsvp", id: "x", name: "Amara N." },
  ...over,
});

describe("Responses helpers", () => {
  it("reads option ids as their labels", () => {
    const q1 = def.questions[0];
    if (q1 === undefined) throw new Error("fixture");
    expect(answerText(q1, "yes")).toBe("Yes");
    expect(answerText(q1, undefined)).toBe("");
    expect(answerText({ ...q1, type: "multi_choice" }, ["yes", "no"])).toBe("Yes, No");
  });

  it("builds a bar per option from the server counts, and the latest answers for text", () => {
    const summaries = summarize(def, { q1: { yes: 3, no: 1 } }, [row(), row({ responseId: "r2", answers: { q1: "no" } })]);
    expect(summaries[0]?.bars).toEqual([
      { optionId: "yes", label: "Yes", count: 3, share: 1 },
      { optionId: "no", label: "No", count: 1, share: 1 / 3 },
    ]);
    expect(summaries[0]?.answeredTotal).toBe(4);
    expect(summaries[1]?.samples).toEqual([{ name: "Amara N.", text: "A song" }]);
    expect(summaries[1]?.conditionNote).toBe("Asked only after Q1 is Yes");
  });

  it("picks the live version's definition for the Summary", () => {
    const page = {
      form: { id: "f", name: "n", status: "live", liveVersionId: "v2", doorFullAnswers: true },
      versions: { v1: { version: 1, definition: { ...def, title: "old" } }, v2: { version: 2, definition: def } },
    } as unknown as BrandFormResponsesPage;
    expect(summaryDefinition(page)?.title).toBe("Open mic");
  });

  it("names a guest without a name instead of leaving a blank", () => {
    expect(subjectName(row({ subject: { kind: "rsvp", id: null, name: "  " } }))).toBe("Guest");
    expect(subjectName(row({ subject: { kind: "user", id: null, name: null } }))).toBe("Mingla guest");
  });
});

describe("answers CSV", () => {
  const feed: BrandFormExport = {
    columns: [
      { key: "1:q1", version: 1, questionId: "q1", label: "Would you like to perform?", type: "single_choice" },
      { key: "1:q2", version: 1, questionId: "q2", label: "What will you do?", type: "short_text" },
    ],
    rows: [
      {
        responseId: "r1",
        version: 1,
        submittedAt: "2026-11-19T10:00:00Z",
        updatedAt: "2026-11-19T10:05:00Z",
        verified: true,
        values: { "1:q1": "Yes", "1:q2": "=HYPERLINK(\"http://x\"), and \"quotes\"" },
      },
    ],
  };

  it("has one column per question and version, quoted per RFC 4180", () => {
    const csv = buildAnswersCsv(feed, new Map([["r1", "Amara N."]]));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Name,Answered,Updated,Form version,Verified,Would you like to perform? (v1),What will you do? (v1)");
    expect(lines[1]).toContain("Amara N.,2026-11-19T10:00:00Z");
  });

  it("keeps a typed formula from running in a spreadsheet", () => {
    const csv = buildAnswersCsv(feed, new Map());
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://x\"\"), and \"\"quotes\"\"\"");
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it("names the file from the form and the date", () => {
    expect(answersCsvFilename("Open Mic: Sign-up!", new Date(2026, 10, 19))).toBe("open-mic-sign-up-answers-2026-11-19.csv");
    expect(answersCsvFilename("???", new Date(2026, 10, 19))).toBe("form-answers-2026-11-19.csv");
  });
});
