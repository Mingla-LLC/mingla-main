import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

const stripCommentLines = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    .join("\n");

describe("ORCH-1088 business web event creator phone parity", () => {
  test("/event/create has bounded terminal states before minting a draft", () => {
    const source = repoFile("app/event/create.tsx");
    const terminalIndex = source.indexOf("const terminalState");
    const mintIndex = source.indexOf("useDraftEventStore.getState().createDraft");

    expect(source).toContain("ROUTE_BOOT_TIMEOUT_MS");
    expect(source).toContain("DRAFT_HYDRATION_TIMEOUT_MS");
    expect(source).toContain("CreateRouteTerminalState");
    expect(source).toContain('"signed_out"');
    expect(source).toContain('"auth_timeout"');
    expect(source).toContain('"auth_error"');
    expect(source).toContain('"brand_error"');
    expect(source).toContain('"no_brand"');
    expect(source).toContain('"draft_hydration_timeout"');
    expect(source).toContain("console.warn(\"[event/create] terminal-state\"");
    expect(terminalIndex).toBeGreaterThan(-1);
    expect(mintIndex).toBeGreaterThan(terminalIndex);
  });

  test("/event/create shows locked user-facing recovery copy", () => {
    const source = repoFile("app/event/create.tsx");

    expect(source).toContain("Sign in to create an event.");
    expect(source).toContain("We could not finish sign-in.");
    expect(source).toContain("Create or select a brand before starting an event.");
    expect(source).toContain("This browser cannot save drafts right now.");
    expect(source).toContain("Getting your brand ready");
    expect(source).toContain("Loading local drafts");
  });

  test("edit-route exits are static-safe on web and missing drafts terminate", () => {
    const source = repoFile("app/event/[id]/edit.tsx");

    expect(source).toContain("safeEventsExitRoute");
    expect(source).toContain('Platform.OS === "web" ? "/home#hub-events"');
    expect(source).toContain("MISSING_DRAFT_TIMEOUT_MS");
    expect(source).toContain("missing-draft-timeout");
    expect(source).toContain("We could not load this draft.");
    expect(source).not.toContain('router.replace("/(tabs)/hub/events" as never);');
  });

  test("static Home keeps only Create closed unless the reopen marker is present", () => {
    const source = repoFile("public/home.html");
    const createIsReopened =
      source.includes('href="/event/create"') || source.includes("href='/event/create'");

    if (createIsReopened) {
      expect(source).toContain("data-orch-1088-create-reopened");
    } else {
      expect(source).toContain('href="#create-event"');
      expect(source).toContain('data-shell-link="create-event"');
    }
    expect(source).not.toContain("Stripe account");
    expect(source).not.toContain("/_expo/static/js/");
  });

  test("phone-web cover upload is honestly degraded while provider/color paths remain", () => {
    const source = repoFile("src/components/ui/CoverPicker.tsx");

    expect(source).toContain("isPhoneWeb");
    expect(source).toContain("Device cover uploads are available on desktop or in the app for now.");
    expect(source).toContain("disabled={uploading || disabled || isPhoneWeb}");
    expect(source).toContain("GIFs, stock photos, and color covers");
    expect(source).toContain("searchGiphyEventCovers");
    expect(source).toContain("searchPexelsEventCovers");
  });

  test("paid publish path stays provider-neutral", () => {
    const wizard = repoFile("src/components/event/EventCreatorWizard.tsx");
    const preview = repoFile("src/components/event/CreatorStep7Preview.tsx");
    const stripeBlockedCard = repoFile("src/components/offering/StripeBlockedCard.tsx");

    expect(wizard).toContain("Connect a bank to publish paid tickets.");
    expect(preview).toContain("StripeBlockedCard");
    expect(stripeBlockedCard).toContain("Connect a bank");
    expect(stripCommentLines(stripeBlockedCard)).not.toContain("Connect Stripe");
  });
});
