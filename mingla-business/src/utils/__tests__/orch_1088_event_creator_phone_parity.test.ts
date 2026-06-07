import { describe, expect, jest, test } from "@jest/globals";
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
    expect(source).toContain("canUseStoredBrandForWeb");
    expect(source).toContain("CreateRouteTerminalState");
    expect(source).toContain('"signed_out"');
    expect(source).toContain('"auth_timeout"');
    expect(source).toContain('"auth_error"');
    expect(source).toContain('"brand_timeout"');
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
    expect(source).toContain("This phone browser could not finish brand setup quickly enough.");
    expect(source).toContain("Create or select a brand before starting an event.");
    expect(source).toContain("This browser cannot save drafts right now.");
    expect(source).toContain("Getting your brand ready");
    expect(source).toContain("Loading local drafts");
  });

  test("web Reanimated shim supports route-wide animation/list imports before /event/create recovery renders", () => {
    const shim = repoFile("src/shims/reactNativeReanimatedWebStub.js");
    const createRoute = repoFile("app/event/create.tsx");
    const ariOrb = repoFile("src/components/ari/AriOrb.tsx");
    const packageJson = repoFile("package.json");

    expect(ariOrb).toContain("Easing.bezier(0.4, 0.0, 0.2, 1)");
    expect(packageJson).toContain("react-native-draggable-flatlist");
    expect(shim).toContain("RNEasing?.bezier");
    expect(shim).toContain("const bezier");
    expect(shim).toContain("bezier,");
    expect(shim).toContain("const runOnUI");
    expect(shim).toContain("runOnUI,");
    expect(createRoute).toContain("Sign in to create an event.");
    expect(createRoute).toContain("We could not finish sign-in.");
    expect(createRoute).toContain("Create or select a brand before starting an event.");
    expect(createRoute).not.toContain("AriOrb");
    expect(createRoute).not.toContain('from "../../src/components/ari');
  });

  test("web Reanimated shim exports callable Easing.bezier at runtime", () => {
    jest.isolateModules(() => {
      jest.doMock("react-native", () => ({
        Animated: {
          View: "View",
          Text: "Text",
          ScrollView: "ScrollView",
          Image: "Image",
          createAnimatedComponent: (component: unknown) => component,
        },
        Easing: {
          linear: (value: number) => value,
          cubic: (value: number) => value * value * value,
          in: (easing: (value: number) => number) => easing,
          out: (easing: (value: number) => number) => easing,
          inOut: (easing: (value: number) => number) => easing,
        },
      }));

      const shim = require(join(
        REPO_ROOT,
        "mingla-business",
        "src/shims/reactNativeReanimatedWebStub.js",
      ));
      const easing = shim.Easing.bezier(0.4, 0.0, 0.2, 1);
      const uiWorkletResult = shim.runOnUI((value: number) => value + 1)(41);

      expect(typeof shim.Easing.bezier).toBe("function");
      expect(typeof easing).toBe("function");
      expect(typeof shim.runOnUI).toBe("function");
      expect(easing(0.5)).toBe(0.5);
      expect(uiWorkletResult).toBe(42);
    });
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

  test("phone-web cover image upload is browser-safe while video stays degraded", () => {
    const source = repoFile("src/components/ui/CoverPicker.tsx");

    expect(source).toContain("isPhoneWeb");
    expect(source).toContain("Device image uploads are available in this browser.");
    expect(source).toContain("Video cover uploads are available on desktop or in the app for now.");
    expect(source).toContain("disabled={uploading || disabled}");
    expect(source).toContain("disabled={uploading || disabled || isPhoneWeb}");
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
