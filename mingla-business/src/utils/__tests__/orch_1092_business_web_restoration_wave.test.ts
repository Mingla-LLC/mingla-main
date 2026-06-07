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
  test("static Home reopens only the approved ORCH-1092 routes with markers", () => {
    const source = repoFile("public/home.html");

    for (const [route, marker] of [
      ["/hub/events", "data-orch-1092-hub-events-reopened"],
      ["/hub/trips", 'data-orch-1094-core-route="hub-trips"'],
      ["/marketing", "data-orch-1092-marketing-overview-reopened"],
      ["/marketing/campaigns/compose", "data-orch-1092-compose-shell-reopened"],
      ["/account", "data-orch-1092-account-reopened"],
    ]) {
      expect(source).toContain(`href="${route}"`);
      expect(source).toContain(marker);
    }

    for (const route of ["/hub/experiences", "/ari", "/connect-account-management"]) {
      expect(source).not.toContain(`href="${route}"`);
    }

    expect(source).toContain('href="#hub-experiences"');
    expect(source).toContain('href="#payout-account"');
    expect(source).toContain('data-shell-link="payout-account"');
    expect(source).not.toContain("data-orch-1092-payout-session-reopened");
  });

  test("payout and seller copy stay provider-neutral", () => {
    const home = repoFile("public/home.html");
    const brandPayout = repoFile("src/utils/brandPayout.ts");
    const brandPayments = repoFile("src/components/brand/BrandPaymentsView.tsx");

    expect(home).toContain("Payout account");
    expect(home).toContain("generated secure session");
    expect(home).not.toContain("Stripe account");
    expect(home).not.toContain("Connect Stripe");
    expect(home).not.toContain("Payments & Stripe");
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

  test("reopened web routes have a bounded signed-out recovery fallback", () => {
    const rootLayout = repoFile("app/_layout.tsx");

    for (const route of [
      "/hub/events",
      "/hub/trips",
      "/marketing",
      "/marketing/campaigns/compose",
      "/account",
    ]) {
      expect(rootLayout).toContain(route);
    }
    expect(rootLayout).toContain("ORCH_1092_SIGNED_OUT_ROUTES");
    expect(rootLayout).toContain("Sign in to open");
    expect(rootLayout).toContain("Return to Home");
    expect(rootLayout).toContain('Platform.OS === "web"');
    expect(rootLayout).toContain("user === null");
    expect(rootLayout).toContain("shouldShowOuterOrch1092Recovery");
    expect(rootLayout).toContain("hasStoredSupabaseWebSession");
    expect(rootLayout).toContain("SUPABASE_AUTH_STORAGE_KEY");
    expect(rootLayout).toContain("window.location.assign(\"/home\")");
  });
});
