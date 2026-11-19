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
// The owner also renders the file upload question (native pickers); not under test here.
jest.mock("../IntakeQuestionFileUpload", () => ({ IntakeQuestionFileUpload: () => null }));

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

  test("trip checkout draws the package renderer through the one lazy owner, with the business primitives injected", () => {
    const src = read("mingla-business/app/checkout-trip/[tripEventId]/intake.tsx");
    // wave 2b: the screen loads the owner on demand (keeps the renderers out of
    // the eager Host web bundle) and hands it the file upload callbacks.
    expect(src).toContain('import("../../../src/components/checkout/intake/formRenderingPrimitives")');
    expect(src).toContain("<BusinessIntakeForm");
    expect(src).toContain("fileUpload={{");
    expect(src).not.toContain("IntakeQuestionRenderers");
    // No static value import of the renderers or the owner from the screen.
    expect(src).not.toMatch(/import\s+(?!type\b)[^;]*from\s+"@mingla\/form-rendering"/);
    expect(src).not.toMatch(/import\s+(?!type\b)[^;]*from\s+"[^"]*formRenderingPrimitives"/);
    const owner = read("mingla-business/src/components/checkout/intake/formRenderingPrimitives.tsx");
    expect(owner).toMatch(/import\s*\{\s*IntakeFormRenderer,[^}]*\}\s*from\s*"@mingla\/form-rendering"/);
    expect(owner).toContain("primitives={businessFormPrimitives}");
    expect(owner).toContain("renderFileUpload=");
  });

  test("no Host module imports the renderers or their owner statically (they would be hoisted into the eager bundle)", () => {
    const bizRoot = path.join(ROOT, "mingla-business");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (name.name === "node_modules" || name.name === "__tests__" || name.name.startsWith(".")) continue;
        const full = path.join(dir, name.name);
        if (name.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name.name)) continue;
        const rel = path.relative(bizRoot, full);
        // The owner itself and the file upload question it renders are the chunk.
        if (rel.endsWith("checkout/intake/formRenderingPrimitives.tsx")) continue;
        if (rel.endsWith("checkout/intake/IntakeQuestionFileUpload.tsx")) continue;
        const src = readFileSync(full, "utf8");
        if (/import\s+(?!type\b)[^;]*?from\s+"(?:@mingla\/form-rendering|[^"]*\/formRenderingPrimitives|[^"]*\/IntakeQuestionFileUpload)"/.test(src)) {
          offenders.push(rel);
        }
      }
    };
    walk(path.join(bizRoot, "app"));
    walk(path.join(bizRoot, "src"));
    expect(offenders).toEqual([]);
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
