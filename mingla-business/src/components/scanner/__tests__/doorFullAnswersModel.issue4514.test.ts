/**
 * #4514 wave 6 — "See all answers": the server read is read defensively, and
 * the host switch off (line_only) never yields the full answers.
 */
import { readDoorFullAnswers } from "../doorFullAnswersModel";

const definition = {
  questions: [
    { id: "q1", position: 0, type: "single_choice", label: "Performing?", required: true, options: [{ id: "yes", label: "Yes" }] },
    { id: "q2", position: 1, type: "number", label: "Group", required: false },
  ],
};

describe("#4514 door full answers read", () => {
  it("reads the answered version and the stored answers for the read-only renderer", () => {
    const v = readDoorFullAnswers({
      state: "answered",
      formName: "Performers",
      fromOrderOf: "Quinn B.",
      isCurrentVersion: false,
      definition,
      answers: { q1: "yes", q2: 4, q3: { x: 1 } },
    });
    expect(v).toEqual({
      state: "answered",
      formName: "Performers",
      fromOrderOf: "Quinn B.",
      answeredAt: null,
      isCurrentVersion: false,
      definition,
      answers: { q1: "yes", q2: "4" },
    });
  });

  it("the switch off reads the marked line only, never full answers", () => {
    const v = readDoorFullAnswers({
      state: "line_only",
      formName: "Performers",
      line: { state: "answered", items: [{ label: "Performing", value: "Yes" }] },
      definition,
      answers: { q1: "yes" },
    });
    expect(v).toEqual({ state: "line_only", formName: "Performers", line: "Performing: Yes" });
    expect(v).not.toHaveProperty("answers");
  });

  it("not answered, no form and the rate limit are their own states", () => {
    expect(readDoorFullAnswers({ state: "not_answered", formName: "F" })).toEqual({ state: "not_answered", formName: "F" });
    expect(readDoorFullAnswers({ state: "no_form" })).toEqual({ state: "no_form" });
    expect(readDoorFullAnswers({ state: "rate_limited" })).toEqual({ state: "rate_limited" });
  });

  it("anything unreadable throws (the sheet shows its retry state, never a blank)", () => {
    expect(() => readDoorFullAnswers(null)).toThrow("door_answers_unreadable");
    expect(() => readDoorFullAnswers({ state: "answered" })).toThrow("door_answers_unreadable");
    expect(() => readDoorFullAnswers({ state: "weird" })).toThrow("door_answers_unreadable");
  });
});
