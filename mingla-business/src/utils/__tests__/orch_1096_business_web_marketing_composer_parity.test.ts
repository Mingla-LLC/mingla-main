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

  test("phone schedule review rejects past or current scheduled times before review and confirm", () => {
    const runtime = repoFile("scripts/mobile-web-marketing-composer-runtime.js");
    const validation = sourceBetween(runtime, "function validationMessage()", "function syncFieldsFromDom()");
    const review = sourceBetween(runtime, "function openReview(mode)", "function confirmSchedule()");
    const confirm = sourceBetween(runtime, "function confirmSchedule()", "function formatScheduledLabel()");

    expect(runtime).toContain("function scheduledTimeIsFuture()");
    expect(runtime).toContain("date.getTime() > Date.now()");
    expect(validation).toContain("Pick a send time in the future.");
    expect(validation).toContain("!scheduledTimeIsFuture()");
    expect(review).toContain('state.scheduledFor = new Date(date.value + "T" + time.value).toISOString();');
    expect(review).toContain("validationMessage()");
    expect(confirm).toContain("syncFieldsFromDom()");
    expect(confirm).toContain("validationMessage()");
    expect(confirm).toContain('state.activePanel = "composer";');
  });

  test("phone schedule cancels draft autosave and blocks post-schedule draft-only PATCH races", () => {
    const runtime = repoFile("scripts/mobile-web-marketing-composer-runtime.js");
    const cancelHelper = sourceBetween(runtime, "function cancelPendingAutosave()", "function autosaveBlocked()");
    const autosaveHelper = sourceBetween(runtime, "function autosaveBlocked()", "function loadAudiences()");
    const markDirty = sourceBetween(runtime, "function markDirty()", "function updateStatusOnly()");
    const saveDraft = sourceBetween(runtime, "function saveDraft(showSuccess, options)", "function insertHtml(html)");
    const confirm = sourceBetween(runtime, "function confirmSchedule()", "function formatScheduledLabel()");

    expect(cancelHelper).toContain("clearTimeout(saveTimer)");
    expect(cancelHelper).toContain("saveTimer = null");
    expect(autosaveHelper).toContain("state.submitting");
    expect(autosaveHelper).toContain('state.activePanel === "success"');
    expect(markDirty).toContain("cancelPendingAutosave()");
    expect(markDirty).toContain("autosaveBlocked()");
    expect(markDirty).toContain("saveDraft(false, { autosave: true })");
    expect(saveDraft).toContain("options && options.autosave && autosaveBlocked()");
    expect(saveDraft).toContain("cancelPendingAutosave()");
    expect(confirm).toContain("cancelPendingAutosave()");
    expect(confirm).toContain("state.submitting = true");
    expect(confirm).toContain('state.activePanel = "success"');
  });

  test("ORCH-1096 CI guard pins past-date and autosave-race regressions", () => {
    const guard = repoFile("scripts/ci/orch-1096-business-web-marketing-composer-parity.mjs");

    expect(guard).toContain("Pick a send time in the future.");
    expect(guard).toContain("scheduledTimeIsFuture");
    expect(guard).toContain("cancelPendingAutosave");
    expect(guard).toContain("autosaveBlocked");
    expect(guard).toContain("saveDraft(false, { autosave: true })");
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
