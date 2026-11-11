// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4382 Wave 5 — Explorer Help & Support, driven behaviourally and
// pinned at the wiring:
//   * create: issue_4382_create_customer_ticket arguments with p_app
//     'explorer', the topic, the typed words, the attachment ids;
//     client_meta keeps only app/device keys — a location never leaves;
//     a voice note or screenshot alone is enough, nothing at all is refused;
//   * limits: 10 screenshots, voice notes 3 s to 5 min and 15 MB;
//   * "Your requests" = requester is me, never an internal ticket;
//   * a closed request swaps the composer for "Start a new request";
//   * deep links: mingla://support/<id> and the explorer.support_* pushes
//     open `/support/<id>`; a bare or malformed link opens Help & Support;
//     +native-intent serves the `support` segment;
//   * Profile shows Help & Support to everyone, coach step 12 targets it,
//     Account settings → Contact support opens it, the beta feedback files
//     are gone, the support address is support@usemingla.com everywhere,
//     and every locale carries the support strings;
//   * the thread's Product banner follows issue_4382_ticket_product_stage:
//     "Passed to our product team", "Product team: being built", "Product
//     team: final checks"; no stage, no banner; a failed read never blocks.
//
// FAILS-ON-REVERT: adding a location key to buildSupportClientMeta's
// allowlist, switching p_app away from 'explorer', returning 'composer' for
// a closed request, deleting the `case 'support'` in parseDeepLink or the
// explorer.support_* fallback, or restoring <BetaFeedbackButton in
// ProfilePage fails here.
// MINGLA-INVARIANT: I-4382-EXPLORER-SUPPORT-NO-LOCATION | issue #4382 | Help & Support client_meta carries only app_version, os, os_version, device_model and source_screen; the Explorer app never reads or sends a location with a support request.

import {
  EXPLORER_SUPPORT_TOPICS,
  MAX_SUPPORT_SCREENSHOTS,
  addScreenshots,
  buildExplorerCreateTicketArgs,
  buildSupportClientMeta,
  formatTicketNumber,
  keepOwnTickets,
  parseSupportProductStage,
  supportComposerMode,
  supportProductBannerKeys,
  supportRoutePath,
  supportStatusKind,
  upcomingNextUpdate,
  voiceNoteRefusal,
} from "../supportRequestModel.ts";
import {
  executeDeepLink,
  parseDeepLink,
  supportRoutePath as deepLinkSupportRoute,
  typeFallbackDestination,
} from "../../services/deepLinkService.ts";
import { redirectSystemPath } from "../../../app/+native-intent.tsx";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const exists = async (path: string) => {
  try {
    await Deno.stat(new URL(path, root));
    return true;
  } catch {
    return false;
  }
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const TICKET = "8f1c2a7e-4b3d-4c5e-9a1b-2c3d4e5f6a7b";

Deno.test("create arguments: p_app explorer, the topic, the words and the files", () => {
  const args = buildExplorerCreateTicketArgs({
    clientRequestId: TICKET,
    topic: "bookings_payments",
    message: "  I was charged twice for brunch.  ",
    attachmentIds: ["a1", "a2"],
    clientMeta: { app_version: "1.4.0", os: "ios", os_version: "18.1", device_model: "iPhone 15", source_screen: "profile" },
  });
  assertEquals(args, {
    p_client_request_id: TICKET,
    p_app: "explorer",
    p_topic: "bookings_payments",
    p_subject: "",
    p_message: "I was charged twice for brunch.",
    p_attachment_ids: ["a1", "a2"],
    p_client_meta: { app_version: "1.4.0", os: "ios", os_version: "18.1", device_model: "iPhone 15", source_screen: "profile" },
    p_brand_id: null,
    p_visibility: "person",
  }, "create args");
});

Deno.test("client_meta never carries a location", () => {
  const meta = buildSupportClientMeta({
    app_version: "1.4.0",
    os: "android",
    os_version: 34,
    device_model: "Pixel 8",
    source_screen: "profile",
    latitude: 6.45,
    longitude: 3.39,
    location: { lat: 1 },
    session_duration_ms: 1000,
  });
  assertEquals(Object.keys(meta).sort(), ["app_version", "device_model", "os", "os_version", "source_screen"], "only the five keys");
  assert(!/lat|lon|location|session/i.test(JSON.stringify(meta)), "no location or session in client_meta");
  assertEquals(buildSupportClientMeta({ device_model: "unknown" }), {}, "unknown values are dropped");
});

Deno.test("either words or a file is enough; nothing at all is refused; topics are fixed", () => {
  const voiceOnly = buildExplorerCreateTicketArgs({ clientRequestId: TICKET, topic: "broken", message: "  ", attachmentIds: ["voice"], clientMeta: {} });
  assertEquals(voiceOnly.p_message, "", "a voice note alone sends an empty message");
  let refused = false;
  try {
    buildExplorerCreateTicketArgs({ clientRequestId: TICKET, topic: "broken", message: " ", attachmentIds: [], clientMeta: {} });
  } catch (error) {
    refused = error.message === "message_required";
  }
  assert(refused, "an empty request is refused before the server");
  let badTopic = false;
  try {
    buildExplorerCreateTicketArgs({ clientRequestId: TICKET, topic: "payouts", message: "x", attachmentIds: [], clientMeta: {} });
  } catch (error) {
    badTopic = error.message === "invalid_topic";
  }
  assert(badTopic, "a Host topic is refused in Explorer");
  assertEquals([...EXPLORER_SUPPORT_TOPICS], ["broken", "bookings_payments", "idea", "confusing", "account", "other"], "six topics");
});

Deno.test("attachment limits: 10 screenshots; voice notes 3 s to 5 min, 15 MB", () => {
  const shot = (n: number) => ({ uri: `file:///s${n}.jpg`, width: 10, height: 10 });
  const next = addScreenshots(Array.from({ length: 8 }, (_, i) => shot(i)), [shot(8), shot(9), shot(10), shot(11)]);
  assertEquals(next.screenshots.length, MAX_SUPPORT_SCREENSHOTS, "capped at 10");
  assertEquals(next.dropped, 2, "two dropped");
  assertEquals(voiceNoteRefusal(2_999, null), "too_short", "under 3 s");
  assertEquals(voiceNoteRefusal(300_001, null), "too_long", "over 5 min");
  assertEquals(voiceNoteRefusal(60_000, 16 * 1024 * 1024), "too_large", "over 15 MB");
  assertEquals(voiceNoteRefusal(60_000, 1024), null, "a minute is fine");
});

Deno.test("Your requests keeps only mine; status, banner and closed composer", () => {
  const me = "me";
  assertEquals(
    keepOwnTickets([
      { requester_user_id: me, visibility: "person" },
      { requester_user_id: "someone", visibility: "person" },
      { requester_user_id: me, visibility: "internal" },
    ], me),
    [{ requester_user_id: me, visibility: "person" }],
    "own, non-internal only",
  );
  assertEquals(supportComposerMode("closed"), "start_new", "closed → Start a new request");
  for (const status of ["new", "open", "pending", "resolved"]) {
    assertEquals(supportComposerMode(status), "composer", `${status} keeps the reply box (a reply reopens)`);
  }
  assertEquals(supportStatusKind("pending"), "waiting_you", "pending = waiting on you");
  assertEquals(supportStatusKind("open"), "waiting_mingla", "open = waiting on Mingla");
  const now = Date.parse("2026-11-10T10:00:00Z");
  assertEquals(upcomingNextUpdate("2026-11-11T09:00:00Z", now), "2026-11-11T09:00:00Z", "future update shown");
  assertEquals(upcomingNextUpdate("2026-11-09T09:00:00Z", now), null, "past update hidden");
  assertEquals(formatTicketNumber(1045), "S-1045", "S-number");
});

Deno.test("deep links and pushes open the request thread", () => {
  assertEquals(parseDeepLink(`mingla://support/${TICKET}`), { kind: "route", path: `/support/${TICKET}` }, "mingla://support/<id>");
  assertEquals(parseDeepLink(`com.mingla.app.v2://support/${TICKET}`), { kind: "route", path: `/support/${TICKET}` }, "custom scheme");
  assertEquals(parseDeepLink("mingla://support"), { kind: "route", path: "/support" }, "bare → Help & Support");
  assertEquals(parseDeepLink("mingla://support/not-a-uuid"), { kind: "route", path: "/support" }, "malformed → Help & Support");
  for (const type of ["explorer.support_reply", "explorer.support_status_changed", "explorer.support_product_update"]) {
    assertEquals(typeFallbackDestination(type, { ticket_id: TICKET }), { kind: "route", path: `/support/${TICKET}` }, `${type} fallback`);
  }
  assertEquals(typeFallbackDestination("explorer.support_reply", {}), { kind: "route", path: "/support" }, "no id → Help & Support");
  const pushed: string[] = [];
  executeDeepLink(parseDeepLink(`mingla://support/${TICKET}`), { setCurrentPage: () => {}, openRouterPath: (p: string) => pushed.push(p) });
  assertEquals(pushed, [`/support/${TICKET}`], "the router opens the thread");
  for (const id of [TICKET, null, "x"]) {
    assertEquals(deepLinkSupportRoute(id), supportRoutePath(id), "deepLinkService and the model agree");
  }
  assertEquals(redirectSystemPath({ path: `com.mingla.app.v2://support/${TICKET}`, initial: true }), `com.mingla.app.v2://support/${TICKET}`, "native intent serves support");
});

Deno.test("Profile, Account settings and removals", async () => {
  const profile = await read("src/components/ProfilePage.tsx");
  assert(!/BetaFeedbackButton/.test(profile), "the BETA TESTER section is gone");
  assert(/router\.push\('\/support' as never\)/.test(profile), "Help & Support row opens /support");
  assert(/wireScrollStep\(12, feedbackButtonRef\)/.test(profile) && /ref=\{feedbackButtonRef\}[\s\S]{0,200}feedback:support\.row_label/.test(profile), "coach step 12 targets the Help & Support row");
  assert(!/useIsBetaTester|is_beta_tester/.test(profile), "the row is not gated on the beta flag");
  const account = await read("src/components/profile/AccountSettings.tsx");
  assert(/router\.push\("\/support\?from=account_settings"/.test(account), "Contact support opens Help & Support");
  assert(!/mailto:/.test(account), "no mailto link");
  for (const gone of [
    "src/components/BetaFeedbackButton.tsx",
    "src/components/BetaFeedbackModal.tsx",
    "src/components/FeedbackHistorySheet.tsx",
    "src/hooks/useBetaFeedback.ts",
    "src/services/betaFeedbackService.ts",
  ]) {
    assert(!(await exists(gone)), `${gone} is removed`);
  }
  const screen = await read("src/components/support/SupportNewRequestScreen.tsx");
  assert(!/expo-location|Location\./.test(screen), "the new request never reads a location");
  assert(/uploadSupportVoiceNote/.test(screen) && /issue_4382_create_customer_ticket/.test(await read("src/services/supportTicketService.ts")), "voice note + create path wired");
  assert(/kind: 'audio'/.test(await read("src/services/supportTicketService.ts")), "voice notes upload as kind audio");
  const thread = await read("src/components/support/SupportThreadScreen.tsx");
  assert(/supportComposerMode\(ticket\.status\)/.test(thread) && /feedback:support\.start_new/.test(thread), "closed thread shows Start a new request");
});

Deno.test("support@usemingla.com everywhere and every locale has the support strings", async () => {
  const english = JSON.parse(await read("src/i18n/locales/en/feedback.json"));
  const keys = Object.keys(english.support).sort();
  const locales = [];
  for await (const entry of Deno.readDir(new URL("src/i18n/locales/", root))) {
    if (entry.isDirectory) locales.push(entry.name);
  }
  assert(locales.length >= 29, "all locale folders found");
  for (const locale of locales) {
    const copy = JSON.parse(await read(`src/i18n/locales/${locale}/feedback.json`));
    assertEquals(Object.keys(copy.support ?? {}).sort(), keys, `${locale} has every support key`);
    const billing = await read(`src/i18n/locales/${locale}/billing.json`);
    assert(!/gla\.app/.test(billing), `${locale} billing uses support@usemingla.com`);
  }
  for (const file of [
    "src/components/support/HelpSupportScreen.tsx",
    "src/components/support/SupportNewRequestScreen.tsx",
    "src/components/support/SupportThreadScreen.tsx",
    "src/components/support/supportUi.tsx",
    "src/components/ProfilePage.tsx",
  ]) {
    const src = await read(file);
    for (const match of src.matchAll(/t\(\s*['`]feedback:support\.([a-z0-9_]+)['`]/g)) {
      assert(match[1] in english.support, `${file}: feedback:support.${match[1]} exists`);
    }
  }
});

Deno.test("Product banner: the stage RPC drives the approved wording", async () => {
  assertEquals(parseSupportProductStage({ stage: "being_built", board_status_label: "In Progress" }), "being_built", "being built");
  assertEquals(parseSupportProductStage({ stage: "final_checks" }), "final_checks", "final checks");
  assertEquals(parseSupportProductStage(null), null, "no stage, no banner");
  assertEquals(parseSupportProductStage({ stage: "told" }), null, "told has no banner");
  assertEquals(parseSupportProductStage("passed_to_product"), null, "a bare string is not a stage");
  const english = JSON.parse(await read("src/i18n/locales/en/feedback.json")).support;
  const words = (stage: "passed_to_product" | "being_built" | "final_checks") => {
    const keys = supportProductBannerKeys(stage);
    return [english[keys.title.replace("support.", "")], english[keys.body.replace("support.", "")]];
  };
  assertEquals(words("passed_to_product"), [
    "Passed to our product team",
    "This needs a change to the app. We'll tell you here when it's fixed.",
  ], "passed wording");
  assertEquals(words("being_built"), ["Product team: being built", "Updated automatically"], "being built wording");
  assertEquals(words("final_checks"), ["Product team: final checks", "Updated automatically"], "final checks wording");

  const service = await read("src/services/supportTicketService.ts");
  assert(service.includes("supabase.rpc('issue_4382_ticket_product_stage', { p_ticket_id: ticketId })"), "service reads the stage RPC");
  assert(/catch \(stageError\) \{\s*console\.warn\('\[Support\] reading the Product stage failed:'/.test(service), "a failed stage read never blocks the thread");
  const screen = await read("src/components/support/SupportThreadScreen.tsx");
  assert(screen.includes("supportProductBannerKeys(data.productStage)"), "thread maps the stage to copy");
  assert(screen.includes('testID="support-thread-product-banner"'), "thread renders the Product banner");
});

Deno.test("a file that never finished uploading is not a closed request", async () => {
  const service = await read("src/services/supportTicketService.ts");
  assert(service.includes("if (fields.token === 'attachment_not_uploaded') throw new SupportReplyError('failed', 'attachment_not_uploaded');"), "the reply maps the not-uploaded refusal");
  assert(!service.includes("fields.token === 'ticket_closed' || status === 409)"), "a bare 409 no longer means closed");
  const thread = await read("src/components/support/SupportThreadScreen.tsx");
  const create = await read("src/components/support/SupportNewRequestScreen.tsx");
  assert(thread.includes("error.message === 'attachment_not_uploaded'") && create.includes("error.message === 'attachment_not_uploaded'"), "both screens say so");
  const english = JSON.parse(await read("src/i18n/locales/en/feedback.json")).support;
  assertEquals(english.not_uploaded, "A screenshot didn't finish uploading. Remove it, add it again and send.", "wording");
});

Deno.test("a reopen shows as a system line in the thread", async () => {
  const screen = await read("src/components/support/SupportThreadScreen.tsx");
  assert(screen.includes("if (message.message_type === 'system') {"), "system rows render on their own");
  assert(screen.includes("t('feedback:support.reopened_marker')"), "the reopen line is translated");
  const service = await read("src/services/supportTicketService.ts");
  assert(service.includes("content, created_at, message_type, sender_display_name_snapshot"), "the thread reads message_type");
});

