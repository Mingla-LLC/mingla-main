/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — Phase 4 implementor happy-path
 * regression test for intakeSchemaService.
 *
 * Verifies that:
 *   (A) Happy path — createEmptyIntakeSchema → add 3 questions of mixed
 *       types via createBlankQuestion → validateIntakeSchemaClient returns
 *       null (valid schema).
 *   (B) Adversarial-edge for the 20-question cap — building a 21-question
 *       schema causes validateIntakeSchemaClient to return
 *       `schema_question_count_invalid`.
 *
 * fails-on-revert proof: comment out the 20-question CHECK in
 * validateIntakeSchemaClient and re-run — test (B) must FAIL because
 * 21 questions would be accepted. See implementation report Phase 4
 * §Regression Tests for the commit hash.
 *
 * Per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5
 * gate. This file is the IMPLEMENTOR-authored happy-path; the
 * TESTER-authored adversarial regression test ships separately.
 */

/* eslint-disable import/first */
import { describe, expect, jest, test } from "@jest/globals";

// Stub the supabase service to keep the test running in node without
// expo-constants / AsyncStorage. The pure-validator code under test does
// not call supabase.
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
  validateIntakeSchemaClient,
  type IntakeQuestion,
} from "../intakeSchemaService";

describe("ORCH-0880 intakeSchemaService — happy path", () => {
  test("createEmptyIntakeSchema returns valid empty shell", () => {
    const schema = createEmptyIntakeSchema();
    expect(schema.schema_version_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(schema.questions).toEqual([]);
    expect(validateIntakeSchemaClient(schema)).toBeNull();
  });

  test("schema with 3 mixed-type questions validates cleanly", () => {
    const schema = createEmptyIntakeSchema();
    const q1 = createBlankQuestion("short_text", 0);
    q1.label = "Passport number";
    q1.required = true;
    const q2 = createBlankQuestion("single_choice", 1);
    q2.label = "Dietary preference";
    q2.required = false;
    q2.options = ["Vegetarian", "Vegan", "No restrictions"];
    const q3 = createBlankQuestion("date", 2);
    q3.label = "Date of birth";
    q3.required = true;
    schema.questions = [q1, q2, q3];

    expect(validateIntakeSchemaClient(schema)).toBeNull();
  });

  test("schema with all 7 question types validates cleanly", () => {
    const schema = createEmptyIntakeSchema();
    const types: IntakeQuestion["type"][] = [
      "short_text",
      "long_text",
      "single_choice",
      "multi_choice",
      "date",
      "number",
      "file_upload",
    ];
    schema.questions = types.map((type, i) => {
      const q = createBlankQuestion(type, i);
      q.label = `Question ${i + 1}`;
      return q;
    });
    expect(validateIntakeSchemaClient(schema)).toBeNull();
  });
});

describe("ORCH-0880 intakeSchemaService — 20-question cap", () => {
  test("schema with exactly 20 questions is valid", () => {
    const schema = createEmptyIntakeSchema();
    schema.questions = Array.from({ length: 20 }).map((_, i) => {
      const q = createBlankQuestion("short_text", i);
      q.label = `Question ${i + 1}`;
      return q;
    });
    expect(validateIntakeSchemaClient(schema)).toBeNull();
  });

  test("schema with 21 questions FAILS with schema_question_count_invalid", () => {
    // This test is the fails-on-revert anchor. validateIntakeSchemaClient's
    // 20-question guard is the line of defense; reverting that block makes
    // this test pass instead of fail.
    const schema = createEmptyIntakeSchema();
    schema.questions = Array.from({ length: 21 }).map((_, i) => {
      const q = createBlankQuestion("short_text", i);
      q.label = `Question ${i + 1}`;
      return q;
    });
    const err = validateIntakeSchemaClient(schema);
    expect(err).not.toBeNull();
    expect(err?.code).toBe("schema_question_count_invalid");
  });
});

describe("ORCH-0880 intakeSchemaService — per-type validation", () => {
  test("single_choice with <2 options FAILS", () => {
    const schema = createEmptyIntakeSchema();
    const q = createBlankQuestion("single_choice", 0);
    q.label = "Pick one";
    q.options = ["Only one"];
    schema.questions = [q];
    const err = validateIntakeSchemaClient(schema);
    expect(err).not.toBeNull();
    expect(err?.code).toBe("schema_choice_options_invalid");
  });

  test("file_upload with max_files=10 (above cap of 5) FAILS", () => {
    const schema = createEmptyIntakeSchema();
    const q = createBlankQuestion("file_upload", 0);
    q.label = "Upload";
    q.max_files = 10;
    schema.questions = [q];
    const err = validateIntakeSchemaClient(schema);
    expect(err).not.toBeNull();
    expect(err?.code).toBe("schema_file_upload_max_files_invalid");
  });

  test("duplicate question IDs FAIL with schema_duplicate_question_id", () => {
    const schema = createEmptyIntakeSchema();
    const q1 = createBlankQuestion("short_text", 0);
    q1.label = "A";
    const q2 = createBlankQuestion("short_text", 1);
    q2.label = "B";
    q2.id = q1.id; // force collision
    schema.questions = [q1, q2];
    const err = validateIntakeSchemaClient(schema);
    expect(err).not.toBeNull();
    expect(err?.code).toBe("schema_duplicate_question_id");
  });
});
