/**
 * META-ORCH-1104 Phase 1 — web-degradation quarantine regression (I-1104-NO-KBC-ON-WEB).
 *
 * The business app exports to web (Expo Web). The native keyboard library
 * (react-native-keyboard-controller) has NO web entry point (ORCH-0892-A §7.3)
 * and breaks the web bundle when imported. This adversarial test pins the
 * quarantine: NO support file resolved on web may import that module — only the
 * `.native` sibling may.
 *
 * This mirrors the Phase-0 strict-grep gate at the unit level so the guarantee
 * ships IN the Phase-1 PR diff and fails fast in jest.
 *
 * # Fails-on-revert
 * Add a static import of the native keyboard module to SupportThread.tsx (the
 * web variant), SupportThreadCore.tsx, or app/support/[ticketId].tsx → the
 * matching assertion goes RED. The .native sibling SHOULD pull it in (asserted
 * positively).
 *
 * New sibling file (append-only safe).
 */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const KBC = "react-native-keyboard-controller";
const COMPONENTS = path.resolve(__dirname, "..");
const APP_SUPPORT = path.resolve(__dirname, "..", "..", "..", "..", "app", "support");

/** True if any physical line both names the module AND looks like an import/require. */
function hasKbcImport(file: string): boolean {
  const text = fs.readFileSync(file, "utf8");
  return text.split(/\r?\n/).some(
    (line) => line.includes(KBC) && /\b(import|require\()/.test(line),
  );
}

describe("META-ORCH-1104 support web quarantine (I-1104-NO-KBC-ON-WEB)", () => {
  test("SupportThread.tsx (web variant) does NOT import the native keyboard module", () => {
    expect(hasKbcImport(path.join(COMPONENTS, "SupportThread.tsx"))).toBe(false);
  });

  test("SupportThreadCore.tsx (shared core) does NOT import the native keyboard module", () => {
    expect(hasKbcImport(path.join(COMPONENTS, "SupportThreadCore.tsx"))).toBe(
      false,
    );
  });

  test("app/support/[ticketId].tsx route does NOT import the native keyboard module", () => {
    expect(hasKbcImport(path.join(APP_SUPPORT, "[ticketId].tsx"))).toBe(false);
  });

  test("SupportThread.native.tsx (native variant) DOES import the native keyboard module", () => {
    expect(hasKbcImport(path.join(COMPONENTS, "SupportThread.native.tsx"))).toBe(
      true,
    );
  });
});
