// #4420 — the business-web eager `__common` chunk holds every module two or
// more lazy chunks (routes or import() targets) reach. These on-intent pieces
// were each reached statically from a second chunk, so Metro hoisted them into
// the boot payload every visitor downloads (+85 KB over main on this branch).
// Each now loads through one dynamic boundary. A static import coming back
// re-hoists it; bundle-baseline-movement measures that after a full export,
// this names the file that did it in a jest run.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

const APP_ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string =>
  readFileSync(path.join(APP_ROOT, rel), "utf8");

// A static `import ... from "<spec>"` (types excluded) or `export ... from`.
const staticImportOf = (source: string, spec: RegExp): boolean =>
  [...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm)].some(
    (match) => spec.test(match[1] ?? ""),
  );

const CASES: ReadonlyArray<{ file: string; spec: RegExp; why: string }> = [
  { file: "app/event/[id]/edit.tsx", spec: /\/EditPublishedScreen$/, why: "published editor" },
  { file: "app/rsvp/[id]/edit.tsx", spec: /\/EditPublishedScreen$/, why: "published editor" },
  { file: "src/components/event/EditPublishedScreen.tsx", spec: /\/ChangeSummaryModal$/, why: "review sheet" },
  { file: "src/components/trip/EditPublishedTripScreen.tsx", spec: /\/ChangeSummaryModal$/, why: "review sheet" },
  { file: "src/components/event/DraftEventFoundationPreview.tsx", spec: /\/MultiDateDayChooser$/, why: "day chooser" },
  { file: "app/event/[id]/index.tsx", spec: /\/EventManageMenu$/, why: "manage menu" },
  { file: "src/hooks/useGlobalSearchSheet.ts", spec: /\/sheetState$/, why: "search engine" },
  { file: "src/services/discountBlastService.ts", spec: /\/discountService$/, why: "discount service" },
  { file: "src/services/offeringInvitePlanService.ts", spec: /\/manualGroupService$/, why: "manual groups" },
  { file: "app/checkout/[eventId]/buyer.tsx", spec: /\/consentDisclosure$/, why: "consent body" },
  { file: "app/checkout-trip/[tripEventId]/buyer.tsx", spec: /\/consentDisclosure$/, why: "consent body" },
  { file: "app/checkout-experience/[experienceEventId]/buyer.tsx", spec: /\/consentDisclosure$/, why: "consent body" },
  { file: "app/pay/door/[code].tsx", spec: /\/consentDisclosure$/, why: "consent body" },
  { file: "src/components/ticketLinks/TicketLinkLanding.tsx", spec: /\/consentDisclosure$/, why: "consent body" },
];

describe("#4420 on-intent modules stay out of the eager __common chunk", () => {
  test.each(CASES)("$file does not statically import the $why", ({ file, spec }) => {
    expect(staticImportOf(read(file), spec)).toBe(false);
  });

  test("the lazy wrappers really defer their module", () => {
    expect(read("src/components/event/LazyEditPublishedScreen.tsx")).toMatch(
      /import\("\.\/EditPublishedScreen"\)/,
    );
    expect(read("src/components/event/LazyChangeSummaryModal.tsx")).toMatch(
      /import\("\.\/ChangeSummaryModal"\)/,
    );
  });

  test("the split modules carry no imports of their own", () => {
    for (const file of ["src/lib/search/recents.ts", "src/constants/purchaseTermsDisclosure.ts"]) {
      expect(read(file)).not.toMatch(/^\s*import\s/m);
    }
  });

  test("the old module paths still export every moved name", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const consent = require("../src/constants/consentDisclosure") as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const purchase = require("../src/constants/purchaseTermsDisclosure") as Record<string, unknown>;
    for (const [name, value] of Object.entries(purchase)) expect(consent[name]).toBe(value);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sheetState = require("../src/lib/search/sheetState") as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const recents = require("../src/lib/search/recents") as Record<string, unknown>;
    expect(sheetState.pushRecent).toBe(recents.pushRecent);
  });
});
