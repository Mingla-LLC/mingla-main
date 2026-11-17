// #4420 — the business-web eager `__common` chunk holds every module two or
// more lazy chunks reach. Fourteen on-intent modules were hoisted into the boot
// payload every visitor downloads; each now loads through one dynamic boundary
// and the split-out modules keep their old public paths.
//
// [TEST-MOD-APPROVED #4420] — the structural half (which files may not
// statically import which module, the lazy import() wrappers, the import-free
// split modules) moved to the I-4420-HOST-WIRING strict-grep gate, which
// I-PROPOSED-1047-NO-SOLE-SOURCE-PIN names as the home for a structural rule.
// What stays here executes the modules.
//
// FAILS ON REVERT: an old module path stops re-exporting a moved name, or a
// moved name stops being the same value.
import { describe, expect, test } from "@jest/globals";

describe("#4420 on-intent module split keeps the old paths working", () => {
  test("consentDisclosure still re-exports every purchaseTermsDisclosure name, by identity", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const consent = require("../src/constants/consentDisclosure") as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const purchase = require("../src/constants/purchaseTermsDisclosure") as Record<string, unknown>;
    expect(Object.keys(purchase).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(purchase)) expect(consent[name]).toBe(value);
  });

  test("sheetState still re-exports pushRecent from the recents module, by identity", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sheetState = require("../src/lib/search/sheetState") as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const recents = require("../src/lib/search/recents") as Record<string, unknown>;
    expect(typeof recents.pushRecent).toBe("function");
    expect(sheetState.pushRecent).toBe(recents.pushRecent);
  });
});
