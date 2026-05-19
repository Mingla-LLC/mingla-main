/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — Phase 4 second implementor
 * happy-path regression test for answer validation.
 *
 * Mirrors the buyer-fill route's Continue gate (the route calls
 * validateAnswerAgainstSchema before allowing navigation to /payment).
 * If this function lets a required-question-with-empty-answer pass, the
 * buyer would land on /payment without filling intake → ticket-checkout-
 * create's server-side gate would still reject with HTTP 400
 * `intake_form_required`, but the client UX would be broken.
 *
 * Covers:
 *   (A) all-required-filled → returns empty errors[]
 *   (B) required short_text missing → returns question_id in errors[]
 *   (C) required multi_choice empty → returns question_id in errors[]
 *   (D) required file_upload empty → returns question_id in errors[]
 *   (E) optional questions skipped → does NOT show up in errors[]
 *   (F) number out-of-range → returns question_id with min/max error
 *   (G) single_choice with value NOT in options → returns error
 *
 * fails-on-revert proof: comment out the `q.required && isAnswerEmpty(...)`
 * branch in validateAnswerAgainstSchema → tests B/C/D MUST FAIL because
 * required-empty answers would be accepted. Captured at HEAD
 * fcd97a66f662028e81b26867ab8203bd3420fa5c (Phase 4 pre-test commit).
 *
 * Per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5
 * gate. This is the SECOND implementor-authored happy-path test; the
 * tester-authored adversarial regression test ships separately.
 */

/* eslint-disable import/first */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
  },
}));

import {
  createEmptyIntakeSchema,
  createBlankQuestion,
  validateAnswerAgainstSchema,
  type IntakeQuestion,
  type IntakeFileAnswer,
} from "../intakeSchemaService";

function buildSchemaWithMixedTypes(): {
  schema: ReturnType<typeof createEmptyIntakeSchema>;
  qShort: IntakeQuestion;
  qChoice: IntakeQuestion;
  qMulti: IntakeQuestion;
  qNumber: IntakeQuestion;
  qFile: IntakeQuestion;
  qOptionalDate: IntakeQuestion;
} {
  const schema = createEmptyIntakeSchema();
  const qShort = createBlankQuestion("short_text", 0);
  qShort.label = "Passport number";
  qShort.required = true;

  const qChoice = createBlankQuestion("single_choice", 1);
  qChoice.label = "T-shirt size";
  qChoice.required = true;
  qChoice.options = ["S", "M", "L"];

  const qMulti = createBlankQuestion("multi_choice", 2);
  qMulti.label = "Dietary restrictions";
  qMulti.required = true;
  qMulti.options = ["Vegetarian", "Vegan", "Gluten-free"];

  const qNumber = createBlankQuestion("number", 3);
  qNumber.label = "Age";
  qNumber.required = true;
  qNumber.min = 18;
  qNumber.max = 99;
  qNumber.integer_only = true;

  const qFile = createBlankQuestion("file_upload", 4);
  qFile.label = "Passport photo";
  qFile.required = true;
  qFile.max_files = 1;

  const qOptionalDate = createBlankQuestion("date", 5);
  qOptionalDate.label = "Date of birth";
  qOptionalDate.required = false;

  schema.questions = [qShort, qChoice, qMulti, qNumber, qFile, qOptionalDate];
  return { schema, qShort, qChoice, qMulti, qNumber, qFile, qOptionalDate };
}

describe("ORCH-0880 validateAnswerAgainstSchema — happy path (A)", () => {
  test("all required filled → empty errors[]", () => {
    const { schema, qShort, qChoice, qMulti, qNumber, qFile } =
      buildSchemaWithMixedTypes();
    const validFile: IntakeFileAnswer = {
      path: "events/event/order/qFile/passport.jpg",
      filename: "passport.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
    };
    const errors = validateAnswerAgainstSchema(schema, {
      [qShort.id]: "AB1234567",
      [qChoice.id]: "M",
      [qMulti.id]: ["Vegetarian"],
      [qNumber.id]: "32",
      [qFile.id]: [validFile],
    });
    expect(errors).toEqual([]);
  });
});

describe("ORCH-0880 validateAnswerAgainstSchema — required missing (B, C, D)", () => {
  test("required short_text empty → errors includes question_id", () => {
    const { schema, qShort, qChoice, qMulti, qNumber, qFile } =
      buildSchemaWithMixedTypes();
    const validFile: IntakeFileAnswer = {
      path: "events/event/order/qFile/passport.jpg",
      filename: "passport.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
    };
    const errors = validateAnswerAgainstSchema(schema, {
      [qShort.id]: "",
      [qChoice.id]: "M",
      [qMulti.id]: ["Vegetarian"],
      [qNumber.id]: "32",
      [qFile.id]: [validFile],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.question_id === qShort.id)).toBe(true);
  });

  test("required multi_choice empty array → errors includes question_id", () => {
    const { schema, qShort, qChoice, qMulti, qNumber, qFile } =
      buildSchemaWithMixedTypes();
    const validFile: IntakeFileAnswer = {
      path: "events/event/order/qFile/passport.jpg",
      filename: "passport.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
    };
    const errors = validateAnswerAgainstSchema(schema, {
      [qShort.id]: "AB1234567",
      [qChoice.id]: "M",
      [qMulti.id]: [],
      [qNumber.id]: "32",
      [qFile.id]: [validFile],
    });
    expect(errors.some((e) => e.question_id === qMulti.id)).toBe(true);
  });

  test("required file_upload empty array → errors includes question_id", () => {
    const { schema, qShort, qChoice, qMulti, qNumber, qFile } =
      buildSchemaWithMixedTypes();
    const errors = validateAnswerAgainstSchema(schema, {
      [qShort.id]: "AB1234567",
      [qChoice.id]: "M",
      [qMulti.id]: ["Vegetarian"],
      [qNumber.id]: "32",
      [qFile.id]: [],
    });
    expect(errors.some((e) => e.question_id === qFile.id)).toBe(true);
  });
});

describe("ORCH-0880 validateAnswerAgainstSchema — optional skipped (E)", () => {
  test("optional date not provided → does NOT appear in errors", () => {
    const { schema, qShort, qChoice, qMulti, qNumber, qFile, qOptionalDate } =
      buildSchemaWithMixedTypes();
    const validFile: IntakeFileAnswer = {
      path: "events/event/order/qFile/passport.jpg",
      filename: "passport.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
    };
    const errors = validateAnswerAgainstSchema(schema, {
      [qShort.id]: "AB1234567",
      [qChoice.id]: "M",
      [qMulti.id]: ["Vegetarian"],
      [qNumber.id]: "32",
      [qFile.id]: [validFile],
      // qOptionalDate intentionally omitted
    });
    expect(errors.some((e) => e.question_id === qOptionalDate.id)).toBe(false);
  });
});

describe("ORCH-0880 validateAnswerAgainstSchema — type-specific rules (F, G)", () => {
  test("number below min → errors includes Must be at least", () => {
    const { schema, qShort, qChoice, qMulti, qNumber, qFile } =
      buildSchemaWithMixedTypes();
    const validFile: IntakeFileAnswer = {
      path: "events/event/order/qFile/passport.jpg",
      filename: "passport.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
    };
    const errors = validateAnswerAgainstSchema(schema, {
      [qShort.id]: "AB1234567",
      [qChoice.id]: "M",
      [qMulti.id]: ["Vegetarian"],
      [qNumber.id]: "10", // below min 18
      [qFile.id]: [validFile],
    });
    const numErr = errors.find((e) => e.question_id === qNumber.id);
    expect(numErr).toBeDefined();
    expect(numErr?.error).toMatch(/at least/i);
  });

  test("single_choice with value NOT in options → errors", () => {
    const { schema, qShort, qChoice, qMulti, qNumber, qFile } =
      buildSchemaWithMixedTypes();
    const validFile: IntakeFileAnswer = {
      path: "events/event/order/qFile/passport.jpg",
      filename: "passport.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
    };
    const errors = validateAnswerAgainstSchema(schema, {
      [qShort.id]: "AB1234567",
      [qChoice.id]: "XXL", // not in [S, M, L]
      [qMulti.id]: ["Vegetarian"],
      [qNumber.id]: "32",
      [qFile.id]: [validFile],
    });
    expect(errors.some((e) => e.question_id === qChoice.id)).toBe(true);
  });

  test("multi_choice with value NOT in options → errors", () => {
    const { schema, qShort, qChoice, qMulti, qNumber, qFile } =
      buildSchemaWithMixedTypes();
    const validFile: IntakeFileAnswer = {
      path: "events/event/order/qFile/passport.jpg",
      filename: "passport.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
    };
    const errors = validateAnswerAgainstSchema(schema, {
      [qShort.id]: "AB1234567",
      [qChoice.id]: "M",
      [qMulti.id]: ["Vegetarian", "ParaglidingDiet"], // 2nd not in options
      [qNumber.id]: "32",
      [qFile.id]: [validFile],
    });
    expect(errors.some((e) => e.question_id === qMulti.id)).toBe(true);
  });
});
