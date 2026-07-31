#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const paths = {
  migration: "supabase/migrations/20270204001447_issue_1447_rsvp_admission.sql",
  submit: "supabase/functions/public-submit-rsvp/index.ts",
  notify: "supabase/functions/rsvp-notify/index.ts",
  dispatcher: "supabase/functions/_shared/notifyV2.ts",
  scanEdge: "supabase/functions/scan-rsvp/index.ts",
  passEdge: "supabase/functions/rsvp-pass-fetch/index.ts",
  popup: "packages/offering-rendering/RsvpSuccessPopup.tsx",
  body: "packages/offering-rendering/RsvpOfferingBody.tsx",
  explorer: "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  calendar: "app-mobile/src/components/activity/RsvpPassSheet.tsx",
  explorerRsvpService: "app-mobile/src/services/rsvpDeckService.ts",
  publicRsvpService: "mingla-business/src/services/rsvpEvents.ts",
  detail: "mingla-business/app/rsvp/[id]/index.tsx",
  scanner: "mingla-business/app/rsvp/[id]/scanner/index.tsx",
  ticketScanner: "mingla-business/app/event/[id]/scanner/index.tsx",
  home: "mingla-business/src/components/home/LiveOfferingCard.tsx",
  door: "mingla-business/src/components/scanners/ScannerHome.tsx",
  console: "mingla-business/src/components/rsvp/RsvpGuestConsole.tsx",
  recoveryRoute: "mingla-business/app/rsvp/pass.tsx",
  happy: "supabase/migrations/__tests__/issue_1447_rsvp_admission.test.ts",
  workflow: ".github/workflows/issue-1447-rsvp-admission-tests.yml",
};

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}
function forbid(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}
function ordered(source, tokens, label, failures) {
  let cursor = -1;
  for (const token of tokens) {
    cursor = source.indexOf(token, cursor + 1);
    if (cursor < 0) {
      failures.push(`${label}: missing/out-of-order ${token}`);
      return;
    }
  }
}

export function violations(files) {
  const failures = [];
  const sql = files.migration ?? "";
  for (const token of [
    "ADD COLUMN IF NOT EXISTS checked_in_at",
    "pass_recovery_token_hash text",
    "CREATE TABLE IF NOT EXISTS public.rsvp_scan_events",
    "num_nonnulls(rsvp_id, guest_id) <= 1",
    "CREATE TABLE IF NOT EXISTS public.rsvp_notification_deliveries",
    "UNIQUE(notification_id, channel)",
    "FOR UPDATE SKIP LOCKED",
    "CREATE OR REPLACE FUNCTION public.submit_event_rsvp_with_delivery",
    "PERFORM public.enqueue_rsvp_acknowledgement(v_rsvp_id)",
    "PERFORM public.enqueue_rsvp_pass(v_rsvp_id,p_qr_token_pepper)",
    "CREATE OR REPLACE FUNCTION public.biz_rsvp_scan",
    "scanner_not_authorized",
    "qr_code=p_qr_payload FOR UPDATE",
    "v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved'",
    "SET checked_in_at=v_now, checked_in_by=v_actor",
    "rsvp_scan_events_primary_success_once",
    "rsvp_scan_events_guest_success_once",
    "'* * * * *'",
    "CREATE OR REPLACE FUNCTION public.fetch_user_rsvp_party_passes",
    "r.user_id=auth.uid() OR g.matched_user_id=auth.uid()",
    "requested_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT",
  ]) need(sql, token, "migration admission/delivery contract", failures);
  forbid(sql, "NEW.checked_in_at := NULL", "check-in history preservation", failures);
  forbid(sql, "checked_in_at=NULL,checked_in_by=NULL", "check-in history preservation", failures);
  forbid(sql, "requested_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE", "scan audit preservation", failures);
  ordered(sql, [
    "IF v_actor IS NULL OR NOT (",
    "regexp_match(COALESCE(p_qr_payload,''),",
    "SELECT * INTO v_rsvp",
  ], "scanner authorizes before credential lookup", failures);
  for (const token of [
    "REVOKE ALL ON public.rsvp_scan_events FROM PUBLIC, anon, authenticated",
    "REVOKE ALL ON FUNCTION public.biz_rsvp_scan(uuid,text) FROM PUBLIC, anon, service_role",
    "GRANT EXECUTE ON FUNCTION public.biz_rsvp_scan(uuid,text) TO authenticated",
  ]) need(sql, token, "deny-by-default scanner grants", failures);

  const submit = files.submit ?? "";
  for (const token of [
    'admin.rpc("submit_event_rsvp_with_delivery"',
    "verifiedUserEmail",
    '.select("display_name,email,phone")',
    "provisionPassEntities",
    "const passEligible",
    "passEligible && typeof result.rsvpId",
    "userId === null && passEligible",
    'confirmationToken: passEligible ? result.confirmationToken ?? null : null',
    'guestEmail = verifiedUserEmail || p.email?.trim() || guestEmail || ""',
    'result.status === "going" && result.approvalStatus === "approved"',
    'entityType: entity.role',
    "pdfFetchRef: entity.entityId",
    'acknowledgement: result.approvalStatus === "pending"',
  ]) need(submit, token, "status-safe submit response", failures);
  forbid(submit, "guestEmail = guestEmail || verifiedUserEmail", "verified email authority", failures);

  const notify = files.notify ?? "";
  for (const token of [
    '"claim_rsvp_notification_deliveries"',
    "dispatchRsvpChannel(",
    "buildRsvpPassPdf",
    'claim.channel === "sms"',
    "!recoveryLink",
    'event: "rsvp_notification_channel_result"',
  ]) need(notify, token, "durable per-channel worker", failures);
  need(files.dispatcher ?? "", 'client.rpc("can_send"', "unified can_send chokepoint", failures);
  need(files.dispatcher ?? "", "attachments: [input.attachment]", "email PDF attachment", failures);

  for (const token of ["RATE_MAX", 'caller.rpc("biz_rsvp_scan"', "qrPayload.length > 512"])
    need(files.scanEdge ?? "", token, "authenticated scan edge", failures);
  for (const token of [
    '"Referrer-Policy": "no-referrer"',
    "constantTimeHexEqual",
    'entityType !== "primary" && entityType !== "guest"',
    'error: "not_owner_or_bad_recovery_token"',
    'error: "not_pass_eligible"',
    "buildRsvpPassPdf",
    '"Content-Type": "application/pdf"',
    '"application/json"',
    "new Response(bytes",
  ]) need(files.passEdge ?? "", token, "owner/recovery-gated PDF", failures);

  for (const token of [
    'testID="issue-1447-rsvp-pass-block"',
    "Download RSVP invite PDF",
    "RSVP QR code for",
    "You’re on the list",
    "ScrollView",
    "Math.min(650",
  ]) need(files.popup ?? "", token, "existing success modal pass insertion", failures);
  forbid(files.popup ?? "", "Email sent", "founder-hidden delivery rows", failures);
  forbid(files.popup ?? "", "Text sent", "founder-hidden delivery rows", failures);
  need(files.body ?? "", "requirePrimaryContact", "Explorer contact completion", failures);
  need(files.explorer ?? "", 'requirePrimaryContact: user !== null', "Explorer contact completion wiring", failures);
  for (const token of [
    "fetchRsvpPartyPasses",
    'testID="issue-1447-calendar-party-tabs"',
    'testID="issue-1447-calendar-rsvp-download"',
    'testID="issue-1447-calendar-rsvp-share"',
    'scrollMode="scroll"',
    'value={selectedCredential.qrCode}',
  ]) need(files.calendar ?? "", token, "Explorer whole-party saved pass", failures);
  for (const token of [
    'supabase.rpc("fetch_user_rsvp_party_passes"',
    'Accept: "application/pdf"',
    'startsWith("application/pdf")',
  ]) need(files.explorerRsvpService ?? "", token, "Explorer canonical pass fetch", failures);
  for (const token of [
    'headers: { Accept: "application/json" }',
    'headers: { Accept: "application/pdf" }',
    "Promise<{ filename: string; blob: Blob }>",
  ]) need(files.publicRsvpService ?? "", token, "explicit RSVP pass representations", failures);

  ordered(files.detail ?? "", [
    'label="Scan guests"', 'label="Guests"', 'label="Scanners"',
  ], "founder RSVP action order", failures);
  for (const token of [
    "rsvp_scan_attempted", "rsvp_scan_result", "Scan RSVP guests",
    "AccessibilityInfo.announceForAccessibility", "fetchRsvpCheckinSummary",
  ]) need(files.scanner ?? "", token, "native RSVP scanner states", failures);
  forbid(files.scanner ?? "", "offlineQueued", "RSVP scanner fail-closed truth", failures);
  forbid(files.ticketScanner ?? "", "scanRsvp", "paid ticket scanner isolation", failures);
  need(files.home ?? "", 'mode?: "tickets" | "rsvp"', "LiveOfferingCard RSVP truth", failures);
  need(files.home ?? "", 'isRsvp ? "Scan guests"', "LiveOfferingCard RSVP CTA", failures);
  need(files.door ?? "", "RSVP ·", "Door Home RSVP discriminator", failures);
  for (const token of ["Not checked in", "Checked in", "plusCheckedInCount"])
    need(files.console ?? "", token, "guest-console check-in truth/filters", failures);
  for (const token of [
    "window.location.hash",
    'meta.content = "no-referrer"',
    "fetchPublicRsvpPassMetadata",
    "fetchPublicRsvpPassPdf",
    "Try again",
  ])
    need(files.recoveryRoute ?? "", token, "fragment recovery page", failures);

  for (const token of [
    "auto-approved anonymous primary plus two guests",
    "signed-in Explorer contact and pass contract",
    "true-source reversion is rejected",
  ]) need(files.happy ?? "", token, "append-only happy-path regression", failures);
  for (const token of [
    "issue-1447-rsvp-admission.mjs --self-test",
    "issue-1447-rsvp-admission.mjs",
    "issue_1447_rsvp_admission.test.ts",
    "deno test --allow-read",
  ]) need(files.workflow ?? "", token, "blocking #1447 CI", failures);
  forbid(files.workflow ?? "", "continue-on-error:", "blocking #1447 CI", failures);
  return failures;
}

function readFiles() {
  return Object.fromEntries(Object.entries(paths).map(([key, rel]) => [
    key, fs.readFileSync(path.join(root, rel), "utf8"),
  ]));
}

function selfTest() {
  const valid = readFiles();
  const baseline = violations(valid);
  if (baseline.length) throw new Error(`self-test baseline invalid:\n${baseline.join("\n")}`);
  const reversions = [
    ["migration", "qr_code=p_qr_payload FOR UPDATE", "qr_code=p_qr_payload", "FOR UPDATE"],
    ["migration", "SET checked_in_at=v_now, checked_in_by=v_actor", "SET checked_in_at=NULL, checked_in_by=NULL", "checked_in_at"],
    ["submit", 'result.status === "going" && result.approvalStatus === "approved"', 'result.status === "going"', "approvalStatus"],
    ["submit", 'guestEmail = verifiedUserEmail || p.email?.trim() || guestEmail || ""', 'guestEmail = guestEmail || verifiedUserEmail || p.email?.trim() || ""', "verified email"],
    ["migration", "requested_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT", "requested_event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE", "scan audit preservation"],
    ["migration", "pass_recovery_token_hash=NULL,pass_recovery_token_created_at=NULL", "pass_recovery_token_hash=NULL,pass_recovery_token_created_at=NULL,checked_in_at=NULL,checked_in_by=NULL", "check-in history"],
    ["dispatcher", 'client.rpc("can_send"', 'client.rpc("send_anyway"', "can_send"],
    ["dispatcher", "attachments: [input.attachment]", "attachments: []", "email PDF"],
    ["detail", 'label="Scan guests"', 'label="Guests"', "action order"],
    ["popup", "Download RSVP invite PDF", "Email sent", "founder-hidden"],
    ["popup", "You’re on the list", "You're going!", "You’re on the list"],
    ["popup", "Math.min(650", "Math.min(900", "Math.min(650"],
    ["calendar", 'testID="issue-1447-calendar-rsvp-share"', 'testID="issue-1447-calendar-rsvp-download-2"', "calendar-rsvp-share"],
    ["explorerRsvpService", 'Accept: "application/pdf"', 'Accept: "application/json"', "application/pdf"],
    ["publicRsvpService", 'headers: { Accept: "application/pdf" }', 'headers: { Accept: "application/json" }', "application/pdf"],
    ["ticketScanner", "scanTicket(event.id, scan.data)", "scanRsvp(event.id, scan.data)", "ticket scanner isolation"],
    ["workflow", "issue_1447_rsvp_admission.test.ts", "issue_1447_rsvp_admission.disabled.ts", "issue_1447_rsvp_admission.test.ts"],
  ];
  for (const [key, before, after, expected] of reversions) {
    if (!valid[key].includes(before)) throw new Error(`self-test fixture missing: ${before}`);
    const broken = { ...valid, [key]: valid[key].replaceAll(before, after) };
    if (!violations(broken).some((failure) => failure.includes(expected))) {
      throw new Error(`true-source reversion not caught: ${expected}`);
    }
  }
  console.log(`issue-1447 self-test PASS (${reversions.length} true-source reversions)`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("issue-1447 RSVP admission gate PASS (eligibility, scan, recovery, delivery, exact-shape UI, ticket isolation)");
}
