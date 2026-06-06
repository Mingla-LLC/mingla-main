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
      ["/marketing", "data-orch-1092-marketing-overview-reopened"],
      ["/marketing/campaigns/compose", "data-orch-1092-compose-shell-reopened"],
      ["/account", "data-orch-1092-account-reopened"],
    ]) {
      expect(source).toContain(`href="${route}"`);
      expect(source).toContain(marker);
    }

    for (const route of ["/hub/experiences", "/hub/trips", "/ari", "/connect-account-management"]) {
      expect(source).not.toContain(`href="${route}"`);
    }

    expect(source).toContain('href="#hub-experiences"');
    expect(source).toContain('href="#hub-trips"');
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
      "app/(tabs)/marketing/index.tsx",
      "app/(tabs)/marketing/campaigns/compose.tsx",
      "app/(tabs)/account.tsx",
      "src/components/marketing/ComposerV2/SchedulePickerSheet.tsx",
      "src/components/ui/ShareModal.tsx",
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
});
