import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

const stripCommentLines = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

describe("ORCH-1092 business web restoration wave", () => {
  // [TEST-MOD-APPROVED ORCH-1098] The static /home stand-in and its per-route
  // "reopen marker" scaffolding were RETIRED by ORCH-1098 Stage 3 (the real Expo
  // app now boots on phones, so there is no static Home to mark up). The
  // home.html-marker test was removed. The genuinely-kept ORCH-1092 work —
  // provider-neutral payout copy, browser-safe pickers, native-module
  // quarantine, and the signed-out recovery guard — is preserved below.

  test("payout and seller copy stay provider-neutral", () => {
    const brandPayout = repoFile("src/utils/brandPayout.ts");
    const brandPayments = repoFile("src/components/brand/BrandPaymentsView.tsx");

    expect(brandPayout).toContain("payoutGateStatus");
    expect(brandPayments).toContain("payout account alerts");
    expect(brandPayments).toContain("payout account management");
    expect(stripCommentLines(brandPayments)).not.toContain("Connect Stripe");
  });

  test("Composer schedule picker uses browser-native controls on web and preserves native picker split", () => {
    const webPicker = repoFile("src/components/marketing/ComposerV2/SchedulePickerSheet.tsx");
    const nativePicker = repoFile("src/components/marketing/ComposerV2/SchedulePickerSheet.native.tsx");
    const composeRoute = repoFile("app/(tabs)/marketing/campaigns/compose.tsx");

    expect(webPicker).toContain('type="date"');
    expect(webPicker).toContain('type="time"');
    expect(webPicker).toContain("showPicker");
    expect(stripCommentLines(webPicker)).not.toContain("@react-native-community/datetimepicker");
    expect(nativePicker).toContain("@react-native-community/datetimepicker");
    expect(composeRoute).toContain("SchedulePickerSheet");
  });

  test("reopened route-family source avoids native-only eager imports", () => {
    const files = [
      "app/(tabs)/hub/events.tsx",
      "app/(tabs)/hub/_layout.tsx",
      "app/(tabs)/marketing/index.tsx",
      "app/(tabs)/marketing/_layout.tsx",
      "app/(tabs)/marketing/campaigns/compose.tsx",
      "app/(tabs)/account.tsx",
      "src/components/marketing/ComposerV2/SchedulePickerSheet.tsx",
      "src/components/ui/ShareModal.tsx",
      "src/components/ui/UniversalCreatorSheet.tsx",
      "src/wrappers/KeyboardRoot.tsx",
      "src/wrappers/SmartScrollView.tsx",
    ];
    const forbidden = [
      "from \"react-native-keyboard-controller\"",
      "from \"expo-camera\"",
      "from \"expo-image-picker\"",
      "from \"expo-file-system\"",
      "from \"expo-file-system/legacy\"",
      "from \"@react-native-community/datetimepicker\"",
      "from \"@stripe/connect-js\"",
      "from \"@stripe/react-connect-js\"",
      "require(\"react-native-video-trim\")",
      "require(\"react-native-compressor\")",
    ];

    for (const file of files) {
      const source = stripCommentLines(repoFile(file));
      for (const token of forbidden) {
        expect(source).not.toContain(token);
      }
    }

    const shareModal = stripCommentLines(repoFile("src/components/ui/ShareModal.tsx"));
    expect(shareModal).toContain('React.lazy(() => import("react-native-qrcode-svg"))');
    expect(shareModal).not.toContain('import QRCode from "react-native-qrcode-svg"');
  });

  test("shared web media readers and cover picker helpers quarantine Expo picker/filesystem imports", () => {
    const webFiles = [
      "src/components/ui/CoverPicker.tsx",
      "src/components/ui/coverPickerDeviceMedia.ts",
      "src/components/ui/coverPickerFileInfo.ts",
      "src/utils/platformImagePicker.ts",
      "src/utils/platformFileSystem.ts",
      "src/services/eventCoverFileReader.ts",
      "src/services/brandCoverFileReader.ts",
      "src/services/creatorAvatarFileReader.ts",
      "src/services/brandAvatarFileReader.ts",
    ];

    for (const file of webFiles) {
      const source = stripCommentLines(repoFile(file));
      expect(source).not.toContain("expo-image-picker");
      expect(source).not.toContain("expo-file-system");
    }

    expect(repoFile("src/components/ui/coverPickerDeviceMedia.native.ts")).toContain("expo-image-picker");
    expect(repoFile("src/components/ui/coverPickerFileInfo.native.ts")).toContain("expo-file-system/legacy");
    expect(repoFile("src/services/eventCoverFileReader.native.ts")).toContain("expo-file-system");
    expect(repoFile("src/services/brandCoverFileReader.native.ts")).toContain("expo-file-system");
    expect(repoFile("src/services/creatorAvatarFileReader.native.ts")).toContain("expo-file-system");
    expect(repoFile("src/services/brandAvatarFileReader.native.ts")).toContain("expo-file-system");
    expect(repoFile("src/utils/platformImagePicker.native.ts")).toContain("expo-image-picker");
    expect(repoFile("src/utils/platformFileSystem.native.ts")).toContain("expo-file-system/legacy");
  });

  // [TEST-MOD-APPROVED ORCH-1102] The ORCH-1092 signed-out recovery CARD (a
  // dead-end "Sign in to open {route} / Return to Home" landing for 5 routes) was
  // REMOVED entirely by ORCH-1102. Operator intent: an unauthenticated user on
  // ANY web route is routed to the real sign-in screen — no card, no route list,
  // no "Return to Home" dead end. This test now asserts the stub is GONE and the
  // route-agnostic redirect is in place. The stored-session detection (which
  // distinguishes a warming session from a real logout) is preserved.
  test("unauthenticated web routes redirect to the real sign-in screen (no dead-end card)", () => {
    const rootLayout = repoFile("app/_layout.tsx");

    // The dead-end card, its route list, and the outer pre-provider stubs are GONE.
    expect(rootLayout).not.toContain("ORCH_1092_SIGNED_OUT_ROUTES");
    expect(rootLayout).not.toContain("Orch1092SignedOutRecovery");
    expect(rootLayout).not.toContain("Orch1093MobileRouteRecovery");
    expect(rootLayout).not.toContain("Sign in to open");
    expect(rootLayout).not.toContain("Return to Home");
    expect(rootLayout).not.toContain("shouldShowOuterOrch1092Recovery");
    expect(rootLayout).not.toContain('window.location.assign("/home")');

    // Route-agnostic redirect to the real sign-in screen is in place, gated on
    // the same stored-session signal that tells a warming session from a logout.
    expect(rootLayout).toContain("shouldRedirectToSignIn");
    expect(rootLayout).toContain("isWebAuthResolving");
    expect(rootLayout).toContain('<Redirect href="/" />');
    expect(rootLayout).toContain('Platform.OS === "web"');
    expect(rootLayout).toContain("hasStoredSupabaseWebSession");
    expect(rootLayout).toContain("SUPABASE_AUTH_STORAGE_KEY");
  });
});
