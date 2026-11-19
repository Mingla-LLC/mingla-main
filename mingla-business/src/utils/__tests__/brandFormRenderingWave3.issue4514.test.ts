/**
 * #4514 wave 3 — the shared renderer's rules now live in @mingla/form-rendering
 * (the wave 2 preview adapter is deleted): "Show only if" on option ids, the
 * "Shown to door staff" line, the full-answers line, the answers' display text,
 * and the brand header's data and fallbacks.
 *
 * FAILS-ON-REVERT: dropping the "visible source" check lets a question whose
 * source is hidden show; dropping the door line from the helper turns a case red.
 */

import fs from "fs";
import path from "path";

import {
  ANSWERS_SEEN_LINE,
  answerDisplayText,
  brandHeaderFromServer,
  brandInitial,
  hasDoorQuestions,
  hueFromAccent,
  missingRequiredIds,
  rendererSchema,
  SHOWN_TO_DOOR_STAFF,
  visibleQuestions,
} from "../../../../packages/form-rendering/brandFormRules";
import { LINK_COPY } from "../../components/forms/link/brandFormLinkCopy";

const def = {
  questions: [
    { id: "q1", position: 0, type: "single_choice" as const, label: "Perform?", required: true, show_at_door: true,
      options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
    { id: "q2", position: 1, type: "single_choice" as const, label: "Solo?", required: true,
      show_if: { question_id: "q1", option_id: "yes" },
      options: [{ id: "solo", label: "Solo" }, { id: "band", label: "Band" }] },
    { id: "q4", position: 2, type: "short_text" as const, label: "Song?", required: true,
      show_if: { question_id: "q2", option_id: "solo" } },
    { id: "q3", position: 3, type: "multi_choice" as const, label: "Gear", required: false,
      options: [{ id: "mic", label: "Mic" }, { id: "amp", label: "Amp" }] },
  ],
};

describe("renderer rules in the package", () => {
  it("a question shows only while its source has that option, and only while the source shows", () => {
    expect(visibleQuestions(def, { q1: "yes" }).map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(visibleQuestions(def, { q1: "yes", q2: "solo" }).map((q) => q.id)).toEqual(["q1", "q2", "q4", "q3"]);
    // q2 answered "solo" but q2 itself is hidden: q4 must not show.
    expect(visibleQuestions(def, { q1: "no", q2: "solo" }).map((q) => q.id)).toEqual(["q1", "q3"]);
    expect(missingRequiredIds(def, { q1: "yes" })).toEqual(["q2"]);
    expect(missingRequiredIds(def, { q1: "no", q2: "solo" })).toEqual([]);
  });

  it("door questions carry the door line; the full-answers line is the contract's words", () => {
    const schema = rendererSchema(def, {});
    expect(schema.questions[0]?.helper).toBe(SHOWN_TO_DOOR_STAFF);
    expect(schema.questions[1]?.helper).toBeUndefined();
    expect(SHOWN_TO_DOOR_STAFF).toBe("Shown to door staff");
    expect(ANSWERS_SEEN_LINE).toBe("The host and their door staff can see your answers.");
    expect(hasDoorQuestions(def)).toBe(true);
  });

  it("reads answers as labels for read-only views", () => {
    expect(answerDisplayText(def.questions[0], "yes")).toBe("Yes");
    expect(answerDisplayText(def.questions[3], ["amp", "mic"])).toBe("Amp, Mic");
    expect(answerDisplayText(def.questions[3], [])).toBeNull();
    expect(answerDisplayText(def.questions[0], null)).toBeNull();
    expect(LINK_COPY.notAnswered).toBe("Not answered");
  });
});

describe("brand header data", () => {
  it("maps the server header; a video or GIF cover (no poster) draws the accent fallback", () => {
    expect(brandHeaderFromServer({ displayName: "Ndoto", photo: "https://x/p.png",
      coverMediaUrl: "https://x/c.jpg", coverMediaType: "image", accent: "#ff6600" }))
      .toEqual({ displayName: "Ndoto", photo: "https://x/p.png", coverUrl: "https://x/c.jpg", accent: "#ff6600", coverHue: 24 });
    expect(brandHeaderFromServer({ displayName: "Ndoto", coverMediaUrl: "https://x/v.mp4", coverMediaType: "video" }).coverUrl)
      .toBeNull();
    expect(brandHeaderFromServer({ displayName: "Ndoto", photo: "", accent: "orange" }))
      .toEqual({ displayName: "Ndoto", photo: null, coverUrl: null, accent: null, coverHue: 25 });
    expect(brandHeaderFromServer(null).displayName).toBe("");
  });

  it("no logo gives the first letter; a hue comes from the accent", () => {
    expect(brandInitial(" ndoto ")).toBe("N");
    expect(brandInitial("")).toBe("•");
    expect(hueFromAccent("#3b82f6")).toBe(217);
    expect(hueFromAccent(null, 40)).toBe(40);
  });
});

describe("the wave 2 adapters are gone", () => {
  it("the preview adapter and the business header file are gone; the answers CSV (C5, event manager export) lives in the export service, not the pure helpers", () => {
    const root = path.join(__dirname, "../../..");
    for (const rel of ["src/utils/brandFormPreview.ts", "src/components/forms/BrandFormHeader.tsx"]) {
      expect(fs.existsSync(path.join(root, rel))).toBe(false);
    }
    const responses = fs.readFileSync(path.join(root, "src/utils/brandFormResponses.ts"), "utf8");
    expect(responses).not.toContain("buildAnswersCsv");
    expect(responses).not.toContain("[TRANSITIONAL]");
  });
});
