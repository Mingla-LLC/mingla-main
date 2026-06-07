import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

const sourceBetween = (source: string, startToken: string, endToken: string): string => {
  const start = source.indexOf(startToken);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endToken, start + startToken.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("ORCH-1096 business web Marketing Composer parity", () => {
  test("phone compose no longer uses the stripped ORCH-1095 Subject/Message shell", () => {
    const injector = stripComments(repoFile("scripts/inject-mobile-blur-css.mjs"));

    const composeBranch = sourceBetween(
      injector,
      'if(path==="/marketing/campaigns/compose")',
      'if(path==="/hub/trips")',
    );

    expect(composeBranch).toContain("renderMarketingComposerRoute");
    expect(composeBranch).not.toContain('placeholder="What should buyers know?"');
    expect(composeBranch).not.toContain('placeholder="Write your blast..."');
    expect(composeBranch).not.toContain('btn("/marketing","Return to marketing",true)');
  });

  test("browser composer runtime exposes real workflow states and data contracts", () => {
    const runtimePath = join(
      REPO_ROOT,
      "mingla-business",
      "scripts/mobile-web-marketing-composer-runtime.js",
    );
    expect(existsSync(runtimePath)).toBe(true);
    const runtime = readFileSync(runtimePath, "utf8");

    for (const marker of [
      "data-orch-1096-browser-composer",
      "data-orch-1096-audience-picker",
      "data-orch-1096-template-drawer",
      "data-orch-1096-personalization-chip",
      "data-orch-1096-event-chip",
      "data-orch-1096-preview",
      "data-orch-1096-save-draft",
      "data-orch-1096-schedule-picker",
      "data-orch-1096-review",
      "contenteditable=\"true\"",
    ]) {
      expect(runtime).toContain(marker);
    }

    for (const serviceContract of [
      "marketing_campaigns",
      "marketing_audiences",
      "marketing_templates",
      "events_with_master_date_view",
      "createDraft",
      "updateDraft",
      "scheduleSend",
    ]) {
      expect(runtime).toContain(serviceContract);
    }
  });

  test("ORCH-1095 route protections remain while compose gets a distinct real runtime", () => {
    const injector = stripComments(repoFile("scripts/inject-mobile-blur-css.mjs"));

    expect(injector).toContain('data-orch-1095-light-route-entry="true"');
    expect(injector).toContain('status==="interactive"&&isLightRoute(path)');
    expect(injector).toContain('"/hub/events":"interactive"');
    expect(injector).toContain('"/hub/trips":"interactive"');
    expect(injector).toContain('"/marketing":"interactive"');
    expect(injector).toContain('"/account":"interactive"');
    expect(injector).toContain('"/hub/experiences":"blocked"');
    expect(injector).toContain('"/ari":"blocked"');
    expect(injector).toContain('"/connect-account-management":"blocked"');
    expect(injector).toContain('renderMarketingComposerRoute(path,session,chosen,uid,email);return');
  });

  test("native/provider modules and provider-specific payout copy stay out of browser composer", () => {
    const runtime = repoFile("scripts/mobile-web-marketing-composer-runtime.js");
    const webPicker = stripComments(repoFile("src/components/marketing/ComposerV2/SchedulePickerSheet.tsx"));
    const nativePicker = repoFile("src/components/marketing/ComposerV2/SchedulePickerSheet.native.tsx");
    const webEditor = repoFile("src/components/marketing/ComposerV2/richEditor.tsx");
    const nativeEditor = repoFile("src/components/marketing/ComposerV2/richEditor.native.ts");

    for (const forbidden of [
      "@react-native-community/datetimepicker",
      "react-native-pell-rich-editor",
      "react-native-webview",
      "expo-image-picker",
      "expo-file-system",
      "@stripe/connect-js",
      "@stripe/react-connect-js",
      "Connect Stripe",
      "Payments & Stripe",
      "Stripe account",
    ]) {
      expect(runtime).not.toContain(forbidden);
    }

    expect(webPicker).toContain('type="date"');
    expect(webPicker).toContain('type="time"');
    expect(webPicker).not.toContain("@react-native-community/datetimepicker");
    expect(nativePicker).toContain("@react-native-community/datetimepicker");
    expect(webEditor).toContain("@tiptap/react");
    expect(nativeEditor).toContain("react-native-pell-rich-editor");
    expect(nativeEditor).not.toContain("@tiptap/react");
  });
});
