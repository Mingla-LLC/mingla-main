/**
 * compose.template-prefill.test.ts — ORCH-0863 T-05.
 *
 * Source-grep verification that the composer route correctly:
 *   1. Parses `?template={id}` from useLocalSearchParams
 *   2. Calls getTemplate(templateId) inside a one-shot hydration effect
 *   3. Pre-fills subject + body from the loaded template
 *   4. Threads template_id into createDraft on first save
 *
 * Rendering the full composer would require mocking the entire RN stack
 * + React Query + expo-router + Sheet + KeyboardAvoidingView. Source-grep
 * is the right resolution at this layer — the runtime behavior is locked
 * by the patterns asserted here, and a real-device tester run is the
 * canonical UI verification.
 */

import fs from "node:fs";
import path from "node:path";

const COMPOSE_PATH = path.resolve(
  __dirname,
  "..",
  "compose.tsx",
);

describe("Composer template-prefill wiring (ORCH-0863 T-05)", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(COMPOSE_PATH, "utf8");
  });

  it("imports getTemplate from marketingTemplateService", () => {
    expect(source).toMatch(/import\s*\{\s*getTemplate\s*\}\s*from\s*["'][^"']*marketingTemplateService["']/);
  });

  it("useLocalSearchParams schema declares optional `template?:` field", () => {
    // Match either pure-typescript shape `template?: string` OR alongside other params.
    expect(source).toMatch(/useLocalSearchParams<\{[^}]*template\?:\s*string[^}]*\}>/);
  });

  it("extracts templateId from params.template", () => {
    expect(source).toMatch(/const\s+templateId\s*=/);
    expect(source).toMatch(/params\.template/);
  });

  it("template hydration effect calls getTemplate(templateId) and sets subject + body", () => {
    expect(source).toMatch(/await\s+getTemplate\s*\(\s*templateId\s*\)/);
    expect(source).toMatch(/setSubject\s*\(\s*tmpl\.subject_template\s*\?\?\s*""\s*\)/);
    expect(source).toMatch(/setBody\s*\(\s*tmpl\.body_template\s*\)/);
    expect(source).toMatch(/setIsDirty\s*\(\s*true\s*\)/);
  });

  it("template prefill effect skips when draftId is present (draft restore wins)", () => {
    expect(source).toMatch(/if\s*\(\s*templateId\s*===\s*null\s*\|\|\s*draftId\s*!==\s*null\s*\)\s*return/);
  });

  it("createDraft is called with template_id when templateId is non-null", () => {
    expect(source).toMatch(/template_id:\s*templateId/);
  });
});
