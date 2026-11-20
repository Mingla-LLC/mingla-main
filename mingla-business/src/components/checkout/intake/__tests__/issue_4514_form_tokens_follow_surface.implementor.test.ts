/**
 * #4514 x #4518 — the form-rendering package draws text and line colours from
 * the surface tokens at render time, so a host palette reaches every question.
 *
 * FAILS-ON-REVERT: freezing `tokens` to designSystem `color` at module scope
 * (the pre-#4518 shape) makes "follows the active palette" RED.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: () => null }));
jest.mock("../IntakeQuestionFileUpload", () => ({ IntakeQuestionFileUpload: () => null }));
// Wave 5: the lazy owner also exports the checkout step (expo-router); not under test here.
jest.mock("../CheckoutQuestionsStep", () => ({ CheckoutQuestionsStep: () => null, PurchaseFormHandoff: () => null }));

import { formStylesFor } from "@mingla/form-rendering";
import { businessFormPrimitives } from "../formRenderingPrimitives";
import {
  activeSurfaceTokens,
  setActiveSurfaceTokens,
} from "../../../../theme/surfaceTokens";

const ROOT = path.resolve(__dirname, "../../../../../..");

describe("form tokens follow the surface palette", () => {
  test("the injected text colour tracks the active palette and restores", () => {
    const base = activeSurfaceTokens();
    const before = businessFormPrimitives.tokens.color.text1;
    setActiveSurfaceTokens({ ...base, color: { ...base.color, text1: "#123456" } });
    try {
      expect(businessFormPrimitives.tokens.color.text1).toBe("#123456");
      const sheet = formStylesFor(businessFormPrimitives.tokens);
      expect(JSON.stringify(sheet.textInput)).toContain("#123456");
    } finally {
      setActiveSurfaceTokens(null);
    }
    expect(businessFormPrimitives.tokens.color.text1).toBe(before);
  });

  test("the package and file upload import no frozen design-system colour", () => {
    const pkg = readFileSync(path.join(ROOT, "packages/form-rendering/QuestionRenderers.tsx"), "utf8");
    expect(pkg).not.toMatch(/constants\/designSystem/);
    const up = readFileSync(
      path.join(ROOT, "mingla-business/src/components/checkout/intake/IntakeQuestionFileUpload.tsx"),
      "utf8",
    );
    expect(up).toMatch(/color, themedStyles\s*}\s*from "\.\.\/\.\.\/\.\.\/theme\/surfaceTokens"/);
    expect(up).toMatch(/const styles = themedStyles\(/);
  });
});
