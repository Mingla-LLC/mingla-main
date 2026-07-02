/**
 * META-ORCH-1255(R2) [web bundle budget] — implementor happy-path regression
 * guard (append-only).
 *
 * The ORCH-1083 CI gate caps the EAGER `__common` web chunk at 2,250,000
 * bytes. Leg B/C import topology hoisted ~57 KB of route-scoped code into the
 * boot path four ways; each guard below pins the deferral fix in SOURCE so a
 * revert fails HERE before it fails (10+ minutes later) in the export gate.
 *
 * fails-on-revert: TRUE LINE-DELETION of any fix (restoring the old barrel /
 * shared-file / static import) fails the matching test — verified in the R2
 * section of IMPLEMENTATION_META-ORCH-1255_LEG_C.md.
 */

import * as fs from "fs";
import * as path from "path";

const repo = path.join(__dirname, "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(repo, rel), "utf8");

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("R2-1 — venue public page must NOT value-import the brand-rendering barrel", () => {
  const pageSrc = stripComments(
    read("mingla-business/src/components/venue/PublicVenuePage.tsx"),
  );

  test("PublicMenuSections comes from the DEEP specifier (own module)", () => {
    expect(pageSrc).toContain(
      'from "@mingla/brand-rendering/PublicMenuSections"',
    );
  });

  test("any barrel import is type-only (erased — cannot drag PublicBrandPage into __common)", () => {
    // Every remaining `from "@mingla/brand-rendering"` import in this file
    // must be `import type` — a VALUE barrel import re-hoists the ~27 KB
    // PublicBrandPage module into the eager __common chunk.
    const barrelImports = pageSrc.match(
      /import\s+(type\s+)?\{[^}]*\}\s+from\s+"@mingla\/brand-rendering"/g,
    );
    for (const imp of barrelImports ?? []) {
      expect(imp).toMatch(/^import\s+type\s/);
    }
  });

  test("the renderer module exists and PublicBrandPage.tsx no longer carries the menu pane", () => {
    const menuSections = read(
      "packages/brand-rendering/PublicMenuSections.tsx",
    );
    expect(menuSections).toContain("export { MenuTab as PublicMenuSections }");
    const brandPage = read("packages/brand-rendering/PublicBrandPage.tsx");
    expect(brandPage).not.toContain("const MenuTab");
    expect(brandPage).not.toContain("const formatMenuPrice");
  });
});

describe("R2-2 — deck-readiness setup lives OUTSIDE the wizard file", () => {
  test("VenueDeckReadinessSetup is its own module", () => {
    const setup = read(
      "mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx",
    );
    expect(setup).toContain("export function VenueDeckReadinessSetup(");
  });

  test("the wizard file no longer defines the setup (it imports it)", () => {
    const wizard = read(
      "mingla-business/src/components/venue/VenueCreatorWizard.tsx",
    );
    expect(wizard).not.toContain("export function VenueDeckReadinessSetup");
    expect(wizard).toContain('from "./VenueDeckReadinessSetup"');
  });

  test("the resume route imports the setup module, NOT the wizard file", () => {
    const route = stripComments(read("mingla-business/app/venue/deck-readiness.tsx"));
    expect(route).toContain('from "../../src/components/venue/VenueDeckReadinessSetup"');
    expect(route).not.toContain('from "../../src/components/venue/VenueCreatorWizard"');
  });
});

describe("R2-3 — TicketTierEditSheet is a lazy on-demand chunk", () => {
  const step5 = stripComments(
    read("mingla-business/src/components/event/CreatorStep5Tickets.tsx"),
  );

  test("React.lazy dynamic import, no static import", () => {
    expect(step5).toMatch(
      /React\.lazy\(\(\)\s*=>\s*\n?\s*import\("\.\/TicketTierEditSheet"\)/,
    );
    expect(step5).not.toMatch(
      /import\s+\{\s*TicketTierEditSheet\s*\}\s+from/,
    );
  });

  test("Suspense wrapper keeps the closed-sheet behavior (fallback null)", () => {
    expect(step5).toContain("<Suspense fallback={null}>");
    expect(step5).toContain("<TicketTierEditSheet");
  });
});

describe("R2-4 — the per-brand reservation-settings LIST hook is its own module", () => {
  test("list hook module exists; detail/mutation module no longer defines it", () => {
    const listHook = read(
      "mingla-business/src/hooks/useBrandReservationSettingsList.ts",
    );
    expect(listHook).toContain("export function useBrandReservationSettingsList(");
    const detail = read(
      "mingla-business/src/hooks/useVenueReservationSettings.ts",
    );
    expect(detail).not.toContain("export function useBrandReservationSettingsList");
  });

  test("VenueCardList consumes the split module", () => {
    const cardList = stripComments(
      read("mingla-business/src/components/venue/VenueCardList.tsx"),
    );
    expect(cardList).toContain(
      'from "../../hooks/useBrandReservationSettingsList"',
    );
    expect(cardList).not.toContain(
      'from "../../hooks/useVenueReservationSettings"',
    );
  });
});
