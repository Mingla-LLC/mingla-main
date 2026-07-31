// Issue #1447 implementor-owned happy-path regression.
// [TEST-MOD-APPROVED ORCH-1447] Paths follow the production bundle splits.
// Source-contract style keeps the test deterministic while the migration's
// executable concurrency/RLS probes run in the repository's fresh-DB CI lane.

import {
  constantTimeHexEqual,
  deriveRsvpRecoveryToken,
  sha256Hex,
} from "../../functions/_shared/rsvpPass.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};
const read = (relative: string): Promise<string> =>
  Deno.readTextFile(new URL(relative, import.meta.url));

const migration = await read("../20270204001447_issue_1447_rsvp_admission.sql");
const submit = await read("../../functions/public-submit-rsvp/index.ts");
const notify = await read("../../functions/rsvp-notify/index.ts");
const dispatcher = await read("../../functions/_shared/notifyV2.ts");
const popup = await read(
  "../../../packages/offering-rendering/RsvpSuccessPopup.tsx",
);
const passEdge = await read("../../functions/rsvp-pass-fetch/index.ts");
const calendarPass = await read(
  "../../../app-mobile/src/components/activity/RsvpPassSheet.tsx",
);
const publicRsvpService = await read(
  "../../../mingla-business/src/services/rsvpPassRecoveryService.ts",
);
const explorer = await read(
  "../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
);
const scanner = await read(
  "../../../mingla-business/src/components/rsvp/RsvpAdmissionScanner.native.tsx",
);
const consoleSource = await read(
  "../../../mingla-business/src/components/rsvp/RsvpGuestConsole.tsx",
);
const homeSource = await read("../../../mingla-business/app/(tabs)/home.tsx");
const liveCard = await read(
  "../../../mingla-business/src/components/home/LiveOfferingCard.tsx",
);

function admitsExactlyOnce(source: string): boolean {
  return source.includes("qr_code=p_qr_payload FOR UPDATE") &&
    source.includes("SET checked_in_at=v_now, checked_in_by=v_actor") &&
    source.includes("rsvp_scan_events_primary_success_once") &&
    source.includes("rsvp_scan_events_guest_success_once");
}

Deno.test("auto-approved anonymous primary plus two guests", () => {
  assert(
    submit.includes(
      'result.status === "going" && result.approvalStatus === "approved"',
    ),
    "credentials must be gated to going+approved",
  );
  assert(
    submit.includes("passEntities.map((entity)"),
    "response must map every party entity",
  );
  assert(
    submit.includes("pdfFetchRef: entity.entityId"),
    "each entity needs its own PDF reference",
  );
  assert(
    migration.includes("UNIQUE(notification_id, channel)"),
    "each channel needs one child row",
  );
  assert(
    notify.includes("buildRsvpPassPdf"),
    "eligible email must use the shared PDF renderer",
  );
  assert(
    dispatcher.includes("attachments: [input.attachment]"),
    "eligible email must attach the PDF",
  );
  assert(
    popup.includes("eligibleCredentials.map"),
    "success must select each party pass",
  );
  assert(
    admitsExactlyOnce(migration),
    "primary and plus-one credentials must scan exactly once",
  );
  assert(
    consoleSource.includes("plusCheckedInCount"),
    "guest console must reconcile party check-ins",
  );
});

Deno.test("signed-in Explorer contact and pass contract", () => {
  for (
    const token of [
      "initialGuestEmail:",
      "initialGuestPhone:",
      "requirePrimaryContact: user !== null",
      "rsvp_acknowledgement_viewed",
      "rsvp_pass_viewed",
      "rsvp_pass_pdf_requested",
      "rsvp_pass_pdf_result",
    ]
  ) assert(explorer.includes(token), `Explorer wiring missing ${token}`);
  assert(
    submit.includes(
      'guestEmail = verifiedUserEmail || p.email?.trim() || guestEmail || ""',
    ),
    "verified bearer email must override body input",
  );
  assert(
    submit.includes('.select("display_name,email,phone")'),
    "profile phone must hydrate server-side",
  );
  assert(
    migration.includes("submit_event_rsvp_with_delivery"),
    "write and queue intents must be atomic",
  );
});

Deno.test("reviewed pass presentation and representation contracts", () => {
  assert(popup.includes("You’re on the list"), "accepted title must match founder rendering");
  assert(popup.includes("Math.min(650"), "success modal must cap its height");
  assert(popup.includes("ScrollView"), "capped success modal must remain scrollable");
  assert(
    calendarPass.indexOf("issue-1447-calendar-party-tabs") <
      calendarPass.indexOf("Show at door"),
    "party tabs must render above Show at door",
  );
  for (const token of [
    "fetchRsvpPartyPasses",
    "issue-1447-calendar-rsvp-download",
    "issue-1447-calendar-rsvp-share",
    'scrollMode="scroll"',
    "selectedCredential.qrCode",
  ]) assert(calendarPass.includes(token), `Explorer saved pass missing ${token}`);
  for (const token of [
    '"Content-Type": "application/pdf"',
    '"application/json"',
    "new Response(bytes",
  ]) assert(passEdge.includes(token), `pass endpoint missing ${token}`);
  assert(
    publicRsvpService.includes('headers: { Accept: "application/json" }') &&
      publicRsvpService.includes('headers: { Accept: "application/pdf" }'),
    "buyer/recovery clients must negotiate metadata and PDF explicitly",
  );
});

Deno.test("ineligible responses and historical admission evidence stay private and durable", () => {
  for (const token of [
    "const passEligible",
    'confirmationToken: passEligible ? result.confirmationToken ?? null : null',
    'anonymousRecovery: userId === null && passEligible',
    'passEligible && typeof result.rsvpId === "string"',
  ]) assert(submit.includes(token), `status-safe response missing ${token}`);
  assert(
    !migration.includes("NEW.checked_in_at := NULL") &&
      !migration.includes("checked_in_at=NULL,checked_in_by=NULL"),
    "credential revocation must preserve historical check-in truth",
  );
  assert(
    migration.includes(
      "requested_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT",
    ),
    "event deletion must not cascade-delete scan audit",
  );
  assert(
    migration.includes("CREATE OR REPLACE FUNCTION public.fetch_user_rsvp_party_passes") &&
      migration.includes("r.user_id=auth.uid() OR g.matched_user_id=auth.uid()"),
    "whole-party credential read must be self-authorized",
  );
});

Deno.test("authorized scan is online, typed, PII-minimal, and fail-closed", () => {
  for (
    const token of [
      "rsvp_scan_attempted",
      "rsvp_scan_result",
      "AccessibilityInfo.announceForAccessibility",
      "Scan RSVP guests",
      "Already checked in",
      "Different RSVP event",
      "RSVP not approved",
    ]
  ) assert(scanner.includes(token), `scanner state missing ${token}`);
  assert(
    migration.indexOf("scanner_not_authorized") <
      migration.indexOf("regexp_match"),
    "authorization must precede payload lookup",
  );
  assert(
    !migration.includes("'qrPayload'"),
    "scan audit must not persist the QR payload",
  );
});

Deno.test("operator surfaces show truthful and complete RSVP states", () => {
  assert(
    homeSource.includes('checkedInValue: query?.isError ? "Unavailable" : "—"') &&
      homeSource.includes('checkedInValue: "—"'),
    "Home must not fabricate a checked-in count while summary truth is unavailable",
  );
  assert(
    !liveCard.includes('metrics.checkedInValue ?? "0"'),
    "live RSVP card must not fall back to a fabricated zero",
  );
  assert(
    !consoleSource.includes("radiusTokens.pill") &&
      consoleSource.includes("radiusTokens.full"),
    "guest console must use a real radius token",
  );
  for (const token of [
    "Checking pass…",
    "You're offline. Reconnect and scan again.",
    'AppState.addEventListener("change"',
    "active={isAppActive}",
  ]) assert(scanner.includes(token), `scanner lifecycle state missing ${token}`);
  assert(
    !scanner.includes("summary.data?.checkedIn ?? 0"),
    "scanner chrome must not fabricate a checked-in zero while loading",
  );
});

Deno.test("recovery HMAC is deterministic, entity-scoped, and constant-time comparable", async () => {
  const input = {
    entityId: "11111111-1111-4111-8111-111111111111",
    createdAtIso: "2026-07-31T12:00:00.000Z",
    pepper: "issue-1447-test-pepper-with-more-than-32-characters",
  };
  const token = await deriveRsvpRecoveryToken(input);
  const replay = await deriveRsvpRecoveryToken(input);
  const other = await deriveRsvpRecoveryToken({
    ...input,
    entityId: "22222222-2222-4222-8222-222222222222",
  });
  assert(
    token === replay,
    "same entity/timestamp must rebuild the delivery token",
  );
  assert(token !== other, "a recovery token must not cross entities");
  const hash = await sha256Hex(token);
  assert(
    constantTimeHexEqual(hash, await sha256Hex(replay)),
    "valid recovery hash must match",
  );
  assert(
    !constantTimeHexEqual(hash, await sha256Hex(other)),
    "cross-entity recovery hash must fail",
  );
});

Deno.test("true-source reversion is rejected", () => {
  assert(
    admitsExactlyOnce(migration),
    "baseline scanner contract must be valid",
  );
  const reverted = migration.replaceAll(
    "SET checked_in_at=v_now, checked_in_by=v_actor",
    "SET checked_in_at=NULL, checked_in_by=NULL",
  );
  assert(
    !admitsExactlyOnce(reverted),
    "deleting the atomic check-in write must turn the test red",
  );
  assert(
    !popup.replace("You’re on the list", "You're going!").includes("You’re on the list"),
    "reverting the founder-approved title must turn presentation proof red",
  );
  assert(
    calendarPass.replace('testID="issue-1447-calendar-rsvp-share"', "").includes(
      'testID="issue-1447-calendar-rsvp-share"',
    ) === false,
    "deleting native Share must turn saved-pass proof red",
  );
});
