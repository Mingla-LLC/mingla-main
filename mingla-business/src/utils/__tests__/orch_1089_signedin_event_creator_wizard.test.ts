import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CURRENT_BRAND_QUERY_ERROR,
  hasCurrentBrandRecoveryQueryError,
} from "../currentBrandRecoveryErrors";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

const stripCommentLines = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    .join("\n");

describe("ORCH-1089 signed-in Event Creator wizard parity", () => {
  // [TEST-MOD-APPROVED ORCH-1098] The static /home stand-in (and its Create
  // reopen marker) was retired by ORCH-1098 Stage 3 — the real Expo Event
  // Creator wizard now boots directly on phone browsers. The static-Home marker
  // test was removed; the current-brand recovery contract below is the
  // load-bearing ORCH-1089 assertion and is preserved.

  test("current-brand recovery classifies brand/account query failures as retryable errors", () => {
    expect(hasCurrentBrandRecoveryQueryError(true, false)).toBe(true);
    expect(hasCurrentBrandRecoveryQueryError(false, true)).toBe(true);
    expect(hasCurrentBrandRecoveryQueryError(false, false)).toBe(false);
    expect(CURRENT_BRAND_QUERY_ERROR).toContain("load your brand data");

    const source = repoFile("src/hooks/useCurrentBrandRecovery.ts");
    expect(source).toContain("brandsQuery.isError");
    expect(source).toContain("creatorAccount.isError");
    expect(source).toContain("hasQueryError ? CURRENT_BRAND_QUERY_ERROR : errorMessage");
    expect(source).toContain("DEFAULT_BRAND_SAVE_ERROR");
  });

  test("create route uses brand-error recovery before no-brand and mints exactly one draft per mount", () => {
    const source = repoFile("app/event/create.tsx");
    const brandErrorIndex = source.indexOf("currentBrandRecovery.isError");
    const noBrandIndex = source.indexOf('? "no_brand"');
    const draftMintMatches = source.match(/createDraft\(currentBrandId\)/g) ?? [];

    expect(source).toContain("CreateRouteTerminalState");
    expect(source).toContain('"brand_error"');
    expect(source).toContain('"no_brand"');
    expect(brandErrorIndex).toBeGreaterThan(-1);
    expect(noBrandIndex).toBeGreaterThan(brandErrorIndex);
    expect(source).toContain("if (startedRef.current) return;");
    expect(draftMintMatches).toHaveLength(1);
    expect(source).toContain("router.replace(`/event/${draft.id}/edit?step=0` as never)");
  });

  test("web missing-draft edit recovery never routes to full tabs Home", () => {
    const source = repoFile("app/event/[id]/edit.tsx");

    expect(source).toContain("safeEventsExitRoute");
    expect(source).toContain('Platform.OS === "web" ? "/home#hub-events"');
    expect(source).toContain("setMissingDraftTimedOut(true)");
    expect(source).toContain("We could not load this draft.");
    expect(source).not.toContain('router.replace("/(tabs)/home" as never)');
  });

  test("the real Step 1-7 wizard remains wired and provider-neutral", () => {
    const wizard = repoFile("src/components/event/EventCreatorWizard.tsx");
    const step1 = repoFile("src/components/event/CreatorStep1Basics.tsx");
    const step2 = repoFile("src/components/event/CreatorStep2When.tsx");
    const step3 = repoFile("src/components/event/CreatorStep3Where.tsx");
    const step4 = repoFile("src/components/event/CreatorStep4Cover.tsx");
    const step5 = repoFile("src/components/event/CreatorStep5Tickets.tsx");
    const step6 = repoFile("src/components/event/CreatorStep6Settings.tsx");
    const step7 = repoFile("src/components/event/CreatorStep7Preview.tsx");
    const ticketTierSheet = repoFile("src/components/event/TicketTierEditSheet.tsx");
    const stripeBlockedCard = repoFile("src/components/offering/StripeBlockedCard.tsx");

    for (const token of [
      "CreatorStep1Basics",
      "CreatorStep2When",
      "CreatorStep3Where",
      "CreatorStep4Cover",
      "CreatorStep5Tickets",
      "CreatorStep6Settings",
      "CreatorStep7Preview",
      "label=\"Continue\"",
      "onPublishDraft",
    ]) {
      expect(wizard).toContain(token);
    }

    expect(step1).toContain('accessibilityLabel="Event name"');
    expect(step1).toContain('accessibilityLabel="Event description"');
    expect(step2).toContain('type="date"');
    expect(step2).toContain('type="time"');
    expect(step2).toContain("showPicker");
    expect(step3).toContain("MapboxAddressInput");
    expect(step4).toContain("CoverPickerSheet");
    expect(step5).toContain("TicketTierEditSheet");
    expect(ticketTierSheet).toContain('type="datetime-local"');
    expect(step6).toContain("Visibility");
    expect(step7).toContain("StripeBlockedCard");
    expect(wizard).toContain("Connect a bank to publish paid tickets.");
    expect(stripCommentLines(stripeBlockedCard)).not.toContain("Connect Stripe");
  });

  test("web shim and phone-web cover degradation stay in place for route-wide imports", () => {
    const coverPicker = repoFile("src/components/ui/CoverPicker.tsx");
    const sheetWeb = repoFile("src/components/ui/Sheet.web.tsx");
    const reanimatedWebStub = repoFile("src/shims/reactNativeReanimatedWebStub.js");

    expect(coverPicker).toContain("isPhoneWeb");
    expect(coverPicker).toContain("Device image uploads are available in this browser.");
    expect(coverPicker).toContain("Video cover uploads are available on desktop or in the app for now.");
    expect(sheetWeb).toContain('from "./SheetMobile"');
    expect(reanimatedWebStub).toContain("const bezier");
    expect(reanimatedWebStub).toContain("const runOnUI");
  });
});
