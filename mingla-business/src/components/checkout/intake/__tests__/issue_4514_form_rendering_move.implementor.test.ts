/**
 * #4514 wave 1 — the trip intake question renderers MOVED (not copied) to
 * packages/form-rendering (C11), and trip checkout draws them from there with
 * the business app's own primitives injected.
 *
 * FAILS-ON-REVERT: restoring IntakeQuestionRenderers.tsx, importing the
 * renderers from an app path again, copying a ui primitive into the package, or
 * dropping the injected primitives makes a named assertion RED.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The native date picker ships untranspiled ESM; the renderers only need it to resolve.
jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: () => null }));

import {
  formStylesFor,
  IntakeFormRenderer,
  IntakeQuestionDate,
  IntakeQuestionShell,
} from "@mingla/form-rendering";
import { businessFormPrimitives } from "../formRenderingPrimitives";
import { Icon } from "../../../ui/Icon";
import { WebDateTimeInput } from "../../../ui/WebDateTimeInput";
import { color } from "../../../../constants/designSystem";

const ROOT = path.resolve(__dirname, "../../../../../..");
const PKG = path.join(ROOT, "packages/form-rendering");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

describe("#4514 — the renderers live in @mingla/form-rendering", () => {
  test("the old business renderer file is gone (moved, not copied)", () => {
    expect(
      existsSync(path.join(ROOT, "mingla-business/src/components/checkout/intake/IntakeQuestionRenderers.tsx")),
    ).toBe(false);
  });

  test("trip checkout imports the renderer from the package and injects the business primitives", () => {
    const src = read("mingla-business/app/checkout-trip/[tripEventId]/intake.tsx");
    expect(src).toContain('import { IntakeFormRenderer } from "@mingla/form-rendering"');
    expect(src).toContain("primitives={businessFormPrimitives}");
    expect(src).toContain("renderFileUpload=");
    expect(src).not.toContain("IntakeQuestionRenderers");
  });

  test("the package is props-only: no app source, no ui primitive copy, no file picker", () => {
    const files = readdirSync(PKG).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(path.join(PKG, f), "utf8");
      expect(src).not.toMatch(/from\s+["'][^"']*(mingla-business|app-mobile|\/src\/)/);
      expect(src).not.toMatch(/GlassCard|expo-document-picker|expo-image-picker/);
    }
  });

  test("the injected primitives are the business app's own components and tokens", () => {
    expect(businessFormPrimitives.Icon).toBe(Icon);
    expect(businessFormPrimitives.WebDateTimeInput).toBe(WebDateTimeInput);
    expect(businessFormPrimitives.tokens.color).toBe(color);
  });

  test("the package exports the renderers, and styles are built once per token set", () => {
    expect(typeof IntakeFormRenderer).toBe("function");
    expect(typeof IntakeQuestionDate).toBe("function");
    expect(typeof IntakeQuestionShell).toBe("function");
    expect(formStylesFor(businessFormPrimitives.tokens)).toBe(formStylesFor(businessFormPrimitives.tokens));
  });
});
