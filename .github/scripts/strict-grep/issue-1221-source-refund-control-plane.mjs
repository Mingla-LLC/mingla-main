#!/usr/bin/env node
/**
 * Issue #1221 — typed Venue/RSVP refund control-plane guard.
 *
 * Keeps the source refund implementation on its two-leg, server-owned path:
 * buyer refunds never implicitly reverse the Stripe application fee, raw guest
 * credentials never reach storage, browser Admin code uses only Edge Functions,
 * and the actor/provider regression suites remain present.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MIGRATION =
  "supabase/migrations/20270131001221_issue_1221_source_refund_control_plane.sql";
const FORBIDDEN_MIGRATION = [
  "20270130",
  "001221_issue_1221_source_refund_control_plane.sql",
].join("");
const REQUIRED_FILES = [
  MIGRATION,
  "supabase/functions/_shared/sourceRefundControlPlane.ts",
  "supabase/functions/_shared/sourceRefundNotifications.ts",
  "supabase/functions/_shared/sourceRefundNotificationRecipient.ts",
  "supabase/functions/_shared/stripeWebhookRouter.ts",
  "supabase/functions/_shared/paystackRefundRouter.ts",
  "supabase/functions/venue-reservation-cancel/index.ts",
  "supabase/functions/source-refund-attention/index.ts",
  "supabase/functions/notify-dispatch/index.ts",
  "supabase/functions/notify-outbox-drain/index.ts",
  "supabase/functions/admin-source-refund-operations/index.ts",
  "supabase/functions/admin-source-refund-action/index.ts",
  "supabase/functions/_shared/__tests__/issue_1221_source_refund_control_plane.test.ts",
  "supabase/functions/_shared/__tests__/issue_1221_source_refund_control_plane.tester.adversarial.test.ts",
  "supabase/functions/source-refund-sweep/__tests__/issue_1221_source_refund_sweep.test.ts",
  "supabase/functions/source-refund-sweep/__tests__/issue_1221_source_refund_sweep.tester.adversarial.test.ts",
  "supabase/functions/source-refund-attention/__tests__/issue_1221_source_refund_attention.test.ts",
  "supabase/functions/source-refund-attention/__tests__/issue_1221_source_refund_attention.tester.adversarial.test.ts",
  "supabase/functions/admin-source-refund-operations/__tests__/issue_1221_admin_source_refund_operations.test.ts",
  "supabase/functions/admin-source-refund-operations/__tests__/issue_1221_admin_source_refund_operations.tester.adversarial.test.ts",
  "supabase/functions/admin-source-refund-action/__tests__/issue_1221_source_refund_attention_recovery.test.ts",
  "supabase/functions/admin-source-refund-action/__tests__/issue_1221_source_refund_attention_recovery.tester.adversarial.test.ts",
  "supabase/functions/notify-dispatch/__tests__/issue_1221_source_refund_safe_boundary.test.ts",
  "supabase/functions/notify-dispatch/__tests__/issue_1221_source_refund_safe_boundary.tester.adversarial.test.ts",
  "supabase/functions/notify-outbox-drain/__tests__/issue_1221_dual_pool.test.ts",
  "supabase/functions/notify-outbox-drain/__tests__/issue_1221_dual_pool.tester.adversarial.test.ts",
  "supabase/functions/notify-outbox-drain/__tests__/issue_1221_service_role_authorization.test.ts",
  "supabase/migrations/__tests__/issue_1221_source_refund_control_plane.test.sql",
  "supabase/migrations/__tests__/issue_1221_source_refund_control_plane.tester.adversarial.test.sql",
  "app-mobile/src/components/activity/__tests__/issue_1221_reservation_refund_states.test.tsx",
  "app-mobile/src/components/activity/__tests__/issue_1221_reservation_refund_states.tester.adversarial.test.tsx",
  "mingla-business/src/components/refunds/__tests__/issue_1221_source_refund_surfaces.test.tsx",
  "mingla-business/src/components/refunds/__tests__/issue_1221_source_refund_surfaces.tester.adversarial.test.tsx",
  "mingla-admin/src/__tests__/issue1221_refund_operations.test.js",
  "mingla-admin/src/__tests__/issue1221_refund_operations.tester.adversarial.test.js",
  "mingla-admin/src/pages/RefundOperationsPage.jsx",
  "mingla-admin/src/services/refundOperationsService.js",
  "app-mobile/src/components/activity/SourceRefundAttentionSheet.tsx",
  "mingla-business/app/reserve/[brandId]/manage.tsx",
];

function requireText(files, file, needles, failures) {
  const source = files[file];
  if (source == null) {
    failures.push(`missing required #1221 artifact: ${file}`);
    return;
  }
  for (const needle of needles) {
    if (!source.includes(needle)) {
      failures.push(`${file} is missing required contract marker: ${needle}`);
    }
  }
}

export function evaluateIssue1221(files, migrationNames, trackedEntries = []) {
  const failures = [];
  for (const file of REQUIRED_FILES) {
    if (files[file] == null) {
      failures.push(`missing required #1221 artifact: ${file}`);
    }
  }

  const issueMigrations = migrationNames.filter((name) =>
    name.includes("issue_1221_source_refund_control_plane") &&
    name.endsWith(".sql")
  );
  if (
    issueMigrations.length !== 1 ||
    issueMigrations[0] !== path.basename(MIGRATION)
  ) {
    failures.push(
      `#1221 must own exactly ${path.basename(MIGRATION)}; found: ${
        issueMigrations.join(", ") || "none"
      }`,
    );
  }
  for (const entry of trackedEntries) {
    if (
      entry.path.replaceAll("\\", "/").includes(FORBIDDEN_MIGRATION) ||
      entry.text?.includes(FORBIDDEN_MIGRATION)
    ) {
      failures.push(
        `#1221 forbidden migration path/reference detected: ${entry.path}`,
      );
    }
  }

  requireText(files, MIGRATION, [
    "CREATE TABLE public.source_refunds",
    "CREATE TABLE public.source_refund_attempts",
    "CREATE TABLE public.source_refund_events",
    "CREATE TABLE public.source_refund_legacy_adoption_exceptions",
    "CREATE TABLE public.source_refund_ledger_allocations",
    "CREATE TABLE public.admin_source_refund_query_snapshots",
    "CREATE OR REPLACE FUNCTION public.claim_source_refund_operations",
    "CREATE OR REPLACE FUNCTION public.record_source_refund_provider_event",
    "CREATE OR REPLACE FUNCTION public.adopt_legacy_venue_paystack_refund_attempts",
    "CREATE OR REPLACE FUNCTION public.assert_legacy_venue_paystack_adoption_ready",
    "CREATE OR REPLACE FUNCTION public.admin_list_source_refund_operations",
    "WITH candidates AS MATERIALIZED",
    "FOR UPDATE SKIP LOCKED",
    "CREATE TABLE public.source_refund_notification_deliveries",
    "CREATE OR REPLACE FUNCTION public.admin_request_source_refund_attention_recovery",
    "CREATE OR REPLACE FUNCTION public.resolve_source_refund_notification_recipient",
    "CREATE OR REPLACE FUNCTION public.classify_source_refund_notification_failure",
    "attention_generation",
    "'afterRecipientHmac',v_after_recipient_hmac",
    "inserted_delivery AS (",
    "':buyer:'||source_rows.channel",
    "attentionDeliveryState",
    "a.id=p_actor_user_id",
    "p_outcome='payload_changed'",
    "x-source-refund-recipient-kid",
    "x-source-refund-recipient-key-b64",
    "source_refund_notification_recipient:v1",
  ], failures);
  const migration = files[MIGRATION] ?? "";
  const adminListStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_list_source_refund_operations",
  );
  const adminListEnd = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1221_raise_query_too_broad",
    adminListStart,
  );
  const adminListDefinition =
    adminListStart >= 0 && adminListEnd > adminListStart
      ? migration.slice(adminListStart, adminListEnd)
      : "";
  if (
    /p_cursor_updated_at|p_cursor_id|p_snapshot_at/.test(adminListDefinition) ||
    /\(\s*(?:sr|i)\.updated_at\s*,\s*(?:sr|i)\.id\s*\)\s*</.test(
      adminListDefinition,
    )
  ) {
    failures.push(
      "SC-27 later pages must never restore mutable live (updated_at,id) seek",
    );
  }
  requireText(
    files,
    "supabase/migrations/__tests__/issue_1221_source_refund_control_plane.tester.adversarial.test.sql",
    [
      "SC27_EXECUTABLE_UNSEEN_ROW_UPDATE",
      "SC27_LIVE_SEEK_REVERSION_PROTECTED",
      "sc27_snapshot_membership_order_or_exactly_once_failed",
    ],
    failures,
  );

  const shared = files[
    "supabase/functions/_shared/sourceRefundControlPlane.ts"
  ] ?? "";
  requireText(files, "supabase/functions/_shared/sourceRefundControlPlane.ts", [
    "refund_application_fee: false",
    "stripe.applicationFees.createRefund",
    '"application_fee_reversal"',
    "mingla_source_refund:",
    "reconcileAdoptedPaystackAttempt",
    "attempt.merchantNote",
    "attempt.reconcileOnly",
  ], failures);
  if (shared.includes("refund_application_fee: true")) {
    failures.push(
      "typed source refunds must never use refund_application_fee:true; the fee is an exact second leg",
    );
  }

  requireText(
    files,
    "supabase/functions/_shared/sourceRefundNotifications.ts",
    [
      "buildSourceRefundRecipientRows",
      'from("brand_team_members")',
      '"brand_owner"',
      '"brand_admin"',
      '"finance_manager"',
      '.select("name,contact_email,contact_phone")',
      "sourceRefundPayloadFingerprint",
      "SOURCE_REFUND_SENDER_PROFILE_KEY",
      "templateRevision",
      "function jcs(",
    ],
    failures,
  );
  requireText(
    files,
    "supabase/functions/_shared/sourceRefundNotificationRecipient.ts",
    [
      "source_refund_notification_recipient:v1\\0",
      "HMAC",
      "v1:${input.key.kid}",
    ],
    failures,
  );

  const venueCancelFile =
    "supabase/functions/venue-reservation-cancel/index.ts";
  const venueCancel = files[venueCancelFile] ?? "";
  for (
    const retired of [
      "createPaystackRefund",
      "record_paystack_refund_outcome",
      "pg_resume_my_paystack_reservation_refund",
      "stripe.refunds.create",
      "stripe.applicationFees.createRefund",
    ]
  ) {
    if (venueCancel.includes(retired)) {
      failures.push(
        `${venueCancelFile} raw source contains retired venue refund symbol: ${retired}`,
      );
    }
  }
  if (
    /\bpayment_status\s*(?::|=)\s*["']refunded["']/.test(venueCancel)
  ) {
    failures.push(
      `${venueCancelFile} must not own a direct terminal refunded projection`,
    );
  }
  const venuePrepare = venueCancel.indexOf(
    '"pg_prepare_my_venue_cancellation_refund"',
  );
  const venueRunner = venueCancel.indexOf("await runSourceRefundOperation(");
  if (
    venuePrepare < 0 || venueRunner < 0 || venuePrepare >= venueRunner
  ) {
    failures.push(
      `${venueCancelFile} must prepare durable typed work before running it`,
    );
  }
  const terminalOwnerStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.record_source_refund_provider_event",
  );
  const terminalOwnerEnd = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.pg_prepare_my_venue_cancellation_refund",
    terminalOwnerStart,
  );
  const terminalOwner = terminalOwnerStart >= 0 &&
      terminalOwnerEnd > terminalOwnerStart
    ? migration.slice(terminalOwnerStart, terminalOwnerEnd)
    : "";
  if (
    !terminalOwner.includes("p_next_state='processed'") ||
    !terminalOwner.includes(
      "UPDATE public.reservations SET payment_status='refunded'",
    )
  ) {
    failures.push(
      "verified database processed transition must own the venue terminal projection",
    );
  }

  const rsvpRefund =
    files["supabase/functions/rsvp-contribution-refund/index.ts"] ?? "";
  if (
    rsvpRefund.includes("stripe.refunds.create") ||
    rsvpRefund.includes("stripe.applicationFees.createRefund")
  ) {
    failures.push(
      "supabase/functions/rsvp-contribution-refund/index.ts must prepare typed work, never call a refund provider directly",
    );
  }

  const create =
    files["supabase/functions/venue-reservation-create/index.ts"] ??
      "";
  const rawGuestTokenWrites = [
    ...create.matchAll(/\bguest_cancel_token\s*:\s*(\S+)/g),
  ].filter((match) => match[1] !== "null" && match[1] !== "null,");
  if (rawGuestTokenWrites.length > 0) {
    failures.push(
      "venue creation must persist only the guest cancellation token hash",
    );
  }
  requireText(files, "supabase/functions/venue-reservation-create/index.ts", [
    "guest_cancel_token: null",
    "guest_cancel_token_hash:",
    "sha256Hex",
  ], failures);

  const stripeRouter = files[
    "supabase/functions/_shared/stripeWebhookRouter.ts"
  ] ?? "";
  if (
    stripeRouter.indexOf("if (sourceRefundId)") < 0 ||
    stripeRouter.indexOf("if (sourceRefundId)") >
      stripeRouter.indexOf("preserve legacy audit-only")
  ) {
    failures.push(
      "Stripe typed source-refund routing must run before legacy fallback",
    );
  }
  const paystackRouter = files[
    "supabase/functions/_shared/paystackRefundRouter.ts"
  ] ?? "";
  if (
    paystackRouter.indexOf("if (typedMatch)") < 0 ||
    paystackRouter.indexOf("if (typedMatch)") >
      paystackRouter.indexOf("localRefundId")
  ) {
    failures.push(
      "Paystack typed source-refund routing must run before legacy fallback",
    );
  }

  const adminBrowser = [
    files["mingla-admin/src/pages/RefundOperationsPage.jsx"] ?? "",
    files["mingla-admin/src/services/refundOperationsService.js"] ?? "",
  ].join("\n");
  for (
    const banned of [
      '.from("source_refunds")',
      '.from("payment_webhook_events")',
      '.from("admin_source_refund_query_snapshots")',
      '.rpc("admin_',
    ]
  ) {
    if (adminBrowser.includes(banned)) {
      failures.push(
        `Admin browser refund operations must use Edge only; found ${banned}`,
      );
    }
  }
  requireText(files, "mingla-admin/src/services/refundOperationsService.js", [
    "supabase.functions.invoke(",
    '"admin-source-refund-operations"',
    '"admin-source-refund-action"',
    "appendCapturedQueuePage",
  ], failures);
  requireText(files, "mingla-admin/src/pages/RefundOperationsPage.jsx", [
    "appendCapturedQueuePage(current, page)",
    "correct_attention_contact",
    "reclaim_confirmed_unsent",
    "invalidate_and_resend_attention",
    "contact updated — invalidate and resend required",
    "Attention deliveries",
  ], failures);
  if (
    (files["mingla-admin/src/pages/RefundOperationsPage.jsx"] ?? "").includes(
      "JSON.stringify(selected",
    )
  ) {
    failures.push(
      "Admin source-refund detail must not JSON-dump protected rows",
    );
  }
  requireText(
    files,
    "mingla-admin/src/__tests__/issue1221_refund_operations.tester.adversarial.test.js",
    [
      "SC27_EXECUTABLE_UNSEEN_ROW_UPDATE",
      "ISSUE_1221_LIVE_SEEK_REVERSION",
      "SC27_MUTABLE_LIVE_SEEK_SKIPPED_UNSEEN_ROW",
    ],
    failures,
  );

  const adminEdge = files[
    "supabase/functions/admin-source-refund-operations/index.ts"
  ] ?? "";
  requireText(
    files,
    "supabase/functions/admin-source-refund-operations/index.ts",
    [
      "ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET",
      "createAdminSourceRefundOperationsHandler",
      "if (import.meta.main)",
      'name: "HMAC"',
      "value.length > 1024",
      "no-store, private",
      'from("admin_users")',
      "decodeCursor(body.cursor)",
      "allowedEnumValues",
    ],
    failures,
  );
  if (/EXPO_PUBLIC|NEXT_PUBLIC|VITE_/.test(adminEdge)) {
    failures.push(
      "Admin cursor HMAC material must never use a client-visible environment prefix",
    );
  }
  if (
    adminEdge.indexOf("if (!context.isActiveAdmin || !context.rpc)") < 0 ||
    adminEdge.indexOf("await decodeCursor(") < 0 ||
    adminEdge.indexOf("if (!context.isActiveAdmin || !context.rpc)") >
      adminEdge.indexOf("await decodeCursor(")
  ) {
    failures.push("Admin authorization must complete before cursor parsing");
  }
  requireText(
    files,
    "supabase/functions/admin-source-refund-operations/__tests__/issue_1221_admin_source_refund_operations.tester.adversarial.test.ts",
    [
      "SC27_EXECUTABLE_UNSEEN_ROW_UPDATE",
      "issue-1221-live-seek-reversion",
      "SC27_MUTABLE_LIVE_SEEK_SKIPPED_UNSEEN_ROW",
    ],
    failures,
  );

  const attention = files[
    "supabase/functions/source-refund-attention/index.ts"
  ] ?? "";
  requireText(files, "supabase/functions/source-refund-attention/index.ts", [
    '"mode", "refundId", "currency", "accountNumber", "bankId"',
    "exactPaystackIdentity",
    "sourceRefundClientIp",
    '"attention_temporarily_unavailable"',
    "keyRing.ipCurrent",
    "getPaystackRefund(providerRefundId)",
    "retryPaystackRefundWithCustomerDetails",
    '"record_source_refund_provider_event"',
  ], failures);
  if (
    attention.includes("pg_guest_venue_refund_summary") ||
    attention.includes("body.guestToken")
  ) {
    failures.push(
      "source attention must never reuse reservation cancel/status authority",
    );
  }
  if (
    attention.indexOf("getPaystackRefund(providerRefundId)") < 0 ||
    attention.indexOf(
        "const result = await retryPaystackRefundWithCustomerDetails",
      ) < 0 ||
    attention.indexOf("getPaystackRefund(providerRefundId)") >
      attention.indexOf(
        "const result = await retryPaystackRefundWithCustomerDetails",
      )
  ) {
    failures.push("Paystack attention must GET and prove identity before POST");
  }
  if (
    /console\.(?:log|info|warn|error)/.test(attention) ||
    /\.(?:insert|upsert)\s*\(/.test(attention)
  ) {
    failures.push(
      "Paystack attention bank details must remain request-local and must not be logged or inserted",
    );
  }

  if (files["mingla-business/app/reserve/[brandId]/refund.tsx"] != null) {
    failures.push(
      "obsolete reserve/[brandId]/refund route must not be restored",
    );
  }
  requireText(files, "supabase/functions/admin-source-refund-action/index.ts", [
    "createAdminSourceRefundActionHandler",
    "admin_request_source_refund_attention_recovery",
    "attention_recovery_conflict",
    "topLevelJsonKeys",
    "4096",
    "if (import.meta.main)",
    "X-Source-Refund-Recipient-Hmac",
    "X-Source-Refund-Recipient-Kid",
    "X-Source-Refund-Recipient-Key-B64",
    "sourceRefundRecipientFingerprint",
    '.eq("id", authData.user.id)',
  ], failures);
  const adminActionSource =
    files["supabase/functions/admin-source-refund-action/index.ts"] ?? "";
  if (
    adminActionSource.includes('.from("source_refunds")') ||
    adminActionSource.includes('.from("reservation_checkout_sessions")') ||
    adminActionSource.includes('.from("event_rsvp_contributions")')
  ) {
    failures.push(
      "Admin recovery must never read raw protected recipient sources outside the resolver/database boundary",
    );
  }
  requireText(files, "supabase/functions/notify-dispatch/index.ts", [
    'outcome: "accepted"',
    'outcome: "retryable"',
    'outcome: "terminal_unsent"',
    'outcome: "ambiguous_parked"',
    'outcome: "source_dispatch_failed"',
  ], failures);
  const drain = files["supabase/functions/notify-outbox-drain/index.ts"] ?? "";
  requireText(files, "supabase/functions/notify-outbox-drain/index.ts", [
    "const GENERIC_RESERVE = 15",
    "const SOURCE_RESERVE = 10",
    "dualPoolBorrowLimits",
    "readBoundedSuccessEnvelope",
    "if (total > 1024)",
    '"claim_notification_outbox"',
    '"claim_source_refund_notification_outbox"',
    'p_certainty: "derive"',
    "actualPayloadFingerprint",
    'outcome: "payload_changed"',
    "constantTimeEqual(authHeader, `Bearer ${key}`)",
  ], failures);
  const drainAuth = drain.indexOf(
    "constantTimeEqual(authHeader, `Bearer ${key}`)",
  );
  const drainClient = drain.indexOf("createClient(url, key");
  const drainClaim = drain.indexOf('"claim_notification_outbox"');
  if (
    drain.includes('.startsWith("Bearer ")') ||
    drainAuth < 0 ||
    drainClient < 0 ||
    drainClaim < 0 ||
    drainAuth >= drainClient ||
    drainClient >= drainClaim
  ) {
    failures.push(
      "notify-outbox-drain must require exact constant-time service bearer equality before client creation and claim RPCs",
    );
  }
  if (drain.includes('"mark_source_refund_notification_provider_io"')) {
    failures.push(
      "drain must not mark provider I/O before the source adapter boundary",
    );
  }
  for (
    const [file, markers] of [
      [
        "supabase/functions/admin-source-refund-action/__tests__/issue_1221_source_refund_attention_recovery.test.ts",
        [
          "correct_attention_contact",
          "reclaim_confirmed_unsent",
          "invalidate_and_resend_attention",
        ],
      ],
      [
        "supabase/functions/admin-source-refund-action/__tests__/issue_1221_source_refund_attention_recovery.tester.adversarial.test.ts",
        ["duplicate", "oversized", "free_text_reason"],
      ],
      [
        "supabase/functions/notify-dispatch/__tests__/issue_1221_source_refund_safe_boundary.test.ts",
        [
          "provider I/O",
          "source-refund-email",
          "preserves exact provider bytes and identity headers",
        ],
      ],
      [
        "supabase/functions/notify-dispatch/__tests__/issue_1221_source_refund_safe_boundary.tester.adversarial.test.ts",
        ["do-not-leak", "binding status/outcome matrix"],
      ],
      [
        "supabase/functions/notify-outbox-drain/__tests__/issue_1221_dual_pool.test.ts",
        ["15 generic and 10 source", "interleave", "JCS-stable"],
      ],
      [
        "supabase/functions/notify-outbox-drain/__tests__/issue_1221_dual_pool.tester.adversarial.test.ts",
        ["both pools independently", "1 KiB", "before recipient resolution"],
      ],
      [
        "supabase/functions/notify-outbox-drain/__tests__/issue_1221_service_role_authorization.test.ts",
        [
          "exact service-role bearer",
          "attacker-controlled-junk",
          "assertEquals(calls, [])",
        ],
      ],
    ]
  ) requireText(files, file, markers, failures);
  requireText(
    files,
    "app-mobile/src/components/activity/SourceRefundAttentionSheet.tsx",
    [
      "We couldn&apos;t confirm the text was sent.",
      "Continue here or contact Mingla Support.",
    ],
    failures,
  );
  requireText(
    files,
    "mingla-business/app/reserve/[brandId]/manage.tsx",
    [
      "We couldn&apos;t confirm your text was sent.",
      "Support and reference this refund:",
      "{refund.refund_id}",
    ],
    failures,
  );
  return failures;
}

function readRepo() {
  const files = {};
  for (
    const file of [
      ...REQUIRED_FILES,
      "supabase/functions/venue-reservation-cancel/index.ts",
      "supabase/functions/rsvp-contribution-refund/index.ts",
      "supabase/functions/venue-reservation-create/index.ts",
      "mingla-admin/src/pages/RefundOperationsPage.jsx",
      "mingla-admin/src/services/refundOperationsService.js",
      "mingla-business/app/reserve/[brandId]/refund.tsx",
    ]
  ) {
    const absolute = path.join(ROOT, file);
    if (fs.existsSync(absolute)) {
      files[file] = fs.readFileSync(absolute, "utf8");
    }
  }
  const migrationNames = fs.readdirSync(path.join(ROOT, "supabase/migrations"));
  const tracked = spawnSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "buffer",
  });
  const trackedEntries = tracked.status === 0
    ? tracked.stdout.toString("utf8").split("\0").filter(Boolean).map(
      (file) => {
        const absolute = path.join(ROOT, file);
        let text = "";
        try {
          const content = fs.readFileSync(absolute);
          if (!content.includes(0)) text = content.toString("utf8");
        } catch {
          // Missing tracked paths are handled by their owning guards.
        }
        return { path: file, text };
      },
    )
    : [];
  return { files, migrationNames, trackedEntries };
}

function finish(failures, label = "") {
  if (failures.length) {
    console.error(`FAIL issue-1221 source refund control plane${label}`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`PASS issue-1221 source refund control plane${label}`);
}

if (process.argv.includes("--self-test")) {
  const real = readRepo();
  const baseline = evaluateIssue1221(real.files, real.migrationNames);
  if (baseline.length) finish(baseline, " self-test baseline");
  const forbiddenPathFailures = evaluateIssue1221(
    real.files,
    real.migrationNames,
    [{ path: `supabase/migrations/${FORBIDDEN_MIGRATION}`, text: "" }],
  );
  const forbiddenReferenceFailures = evaluateIssue1221(
    real.files,
    real.migrationNames,
    [{ path: "fixture.txt", text: `reference=${FORBIDDEN_MIGRATION}` }],
  );
  for (const failures of [forbiddenPathFailures, forbiddenReferenceFailures]) {
    if (!failures.some((failure) => failure.includes("forbidden migration"))) {
      finish(["issue1221_migration_reference_guard_rejects_20270130 escaped"]);
    }
  }
  for (
    const requiredTest of REQUIRED_FILES.filter((file) =>
      file.includes("/__tests__/issue_1221_") &&
      (file.includes("source_refund_attention_recovery") ||
        file.includes("source_refund_safe_boundary") ||
        file.includes("issue_1221_dual_pool") ||
        file.includes("issue_1221_service_role_authorization"))
    )
  ) {
    const missingTestMutation = { ...real.files };
    delete missingTestMutation[requiredTest];
    if (
      !evaluateIssue1221(missingTestMutation, real.migrationNames).some(
        (failure) =>
          failure.includes(`missing required #1221 artifact: ${requiredTest}`),
      )
    ) {
      finish([`mandatory #1221 test path deletion escaped: ${requiredTest}`]);
    }
  }
  const mutated = { ...real.files };
  mutated["supabase/functions/_shared/sourceRefundControlPlane.ts"] = mutated[
    "supabase/functions/_shared/sourceRefundControlPlane.ts"
  ].replace("refund_application_fee: false", "refund_application_fee: true");
  const mutationFailures = evaluateIssue1221(mutated, real.migrationNames);
  if (
    !mutationFailures.some((failure) =>
      failure.includes("refund_application_fee:true")
    )
  ) {
    finish(["self-test mutation escaped the exact two-leg Stripe guard"]);
  }
  const liveSeekMutation = { ...real.files };
  liveSeekMutation[MIGRATION] = liveSeekMutation[MIGRATION].replace(
    "FROM public.admin_source_refund_query_snapshot_items i",
    "FROM public.source_refunds i " +
      "WHERE (i.updated_at,i.id)<(p_cursor_updated_at,p_cursor_id)",
  );
  const liveSeekFailures = evaluateIssue1221(
    liveSeekMutation,
    real.migrationNames,
  );
  if (
    !liveSeekFailures.some((failure) =>
      failure.includes("mutable live (updated_at,id) seek")
    )
  ) {
    finish(["self-test mutation escaped the SC-27 mutable live-seek guard"]);
  }
  const commentOnlyLegacyMutation = { ...real.files };
  commentOnlyLegacyMutation[
    "supabase/functions/venue-reservation-cancel/index.ts"
  ] += "\n// createPaystackRefund\n";
  if (
    !evaluateIssue1221(commentOnlyLegacyMutation, real.migrationNames).some(
      (failure) => failure.includes("raw source contains retired"),
    )
  ) {
    finish(["comment-only legacy venue symbol escaped the raw-source guard"]);
  }
  const directTerminalMutation = { ...real.files };
  directTerminalMutation[
    "supabase/functions/venue-reservation-cancel/index.ts"
  ] += '\nconst forbiddenProjection = { payment_status: "refunded" };\n';
  if (
    !evaluateIssue1221(directTerminalMutation, real.migrationNames).some(
      (failure) => failure.includes("direct terminal refunded projection"),
    )
  ) {
    finish(["direct venue terminal projection escaped the raw-source guard"]);
  }
  const runnerBeforePrepareMutation = { ...real.files };
  const venueSource = runnerBeforePrepareMutation[
    "supabase/functions/venue-reservation-cancel/index.ts"
  ];
  runnerBeforePrepareMutation[
    "supabase/functions/venue-reservation-cancel/index.ts"
  ] = venueSource.replace(
    '"pg_prepare_my_venue_cancellation_refund"',
    '"pg_prepare_my_venue_cancellation_refund_removed"',
  ).replace(
    "const prepared = userId",
    "await runSourceRefundOperation({} as never, {} as never);\n    const prepared = userId",
  );
  if (
    !evaluateIssue1221(runnerBeforePrepareMutation, real.migrationNames).some(
      (failure) => failure.includes("prepare durable typed work before"),
    )
  ) {
    finish(["runner-before-prepare venue mutation escaped the ordering guard"]);
  }
  for (
    const choice of [
      "correct_attention_contact",
      "reclaim_confirmed_unsent",
      "invalidate_and_resend_attention",
    ]
  ) {
    const adminChoiceMutation = { ...real.files };
    adminChoiceMutation["mingla-admin/src/pages/RefundOperationsPage.jsx"] =
      adminChoiceMutation["mingla-admin/src/pages/RefundOperationsPage.jsx"]
        .replaceAll(choice, "removed_recovery_action");
    if (
      !evaluateIssue1221(adminChoiceMutation, real.migrationNames).some(
        (failure) => failure.includes(choice),
      )
    ) {
      finish([`Admin recovery choice deletion escaped guard: ${choice}`]);
    }
  }
  const hmacMutation = { ...real.files };
  hmacMutation[MIGRATION] = hmacMutation[MIGRATION].replaceAll(
    "'afterRecipientHmac',v_after_recipient_hmac",
    "'afterRecipientHmac',NULL",
  );
  if (
    !evaluateIssue1221(hmacMutation, real.migrationNames).some(
      (failure) => failure.includes("afterRecipientHmac"),
    )
  ) {
    finish(["corrected-recipient HMAC reversion escaped guard"]);
  }
  const currentKeyMutation = { ...real.files };
  currentKeyMutation["supabase/functions/admin-source-refund-action/index.ts"] =
    currentKeyMutation[
      "supabase/functions/admin-source-refund-action/index.ts"
    ].replaceAll(
      "X-Source-Refund-Recipient-Key-B64",
      "X-Source-Refund-Recipient-Key-Removed",
    );
  if (
    !evaluateIssue1221(currentKeyMutation, real.migrationNames).some(
      (failure) => failure.includes("X-Source-Refund-Recipient-Key-B64"),
    )
  ) {
    finish(["current recipient key regeneration reversion escaped guard"]);
  }
  const rawRecipientReadMutation = { ...real.files };
  rawRecipientReadMutation[
    "supabase/functions/admin-source-refund-action/index.ts"
  ] += '\nservice.from("source_refunds").select("*");\n';
  if (
    !evaluateIssue1221(rawRecipientReadMutation, real.migrationNames).some(
      (failure) => failure.includes("raw protected recipient sources"),
    )
  ) {
    finish(["raw recipient source read escaped Admin recovery guard"]);
  }
  const payloadMutation = { ...real.files };
  payloadMutation["supabase/functions/_shared/sourceRefundNotifications.ts"] =
    payloadMutation["supabase/functions/_shared/sourceRefundNotifications.ts"]
      .replace("function jcs(", "function jsonStringifyReversion(");
  if (
    !evaluateIssue1221(payloadMutation, real.migrationNames).some(
      (failure) => failure.includes("function jcs("),
    )
  ) {
    finish(["JCS payload fingerprint reversion escaped guard"]);
  }
  const weakDrainAuthMutation = { ...real.files };
  weakDrainAuthMutation["supabase/functions/notify-outbox-drain/index.ts"] =
    weakDrainAuthMutation[
      "supabase/functions/notify-outbox-drain/index.ts"
    ].replace(
      "if (!constantTimeEqual(authHeader, `Bearer ${key}`)) {",
      'if (!authHeader.startsWith("Bearer ")) {',
    );
  if (
    !evaluateIssue1221(weakDrainAuthMutation, real.migrationNames).some(
      (failure) => failure.includes("exact constant-time service bearer"),
    )
  ) {
    finish(["weak notify drain bearer-prefix restoration escaped guard"]);
  }
  const uiTest = path.join(
    ROOT,
    "mingla-admin/src/__tests__/issue1221_refund_operations.tester.adversarial.test.js",
  );
  const revertedUi = spawnSync(process.execPath, [uiTest], {
    cwd: ROOT,
    env: { ...process.env, ISSUE_1221_LIVE_SEEK_REVERSION: "1" },
    encoding: "utf8",
  });
  if (revertedUi.status === 0) {
    finish([
      "SC-27 executable Admin test stayed green under live-seek reversion",
    ]);
  }
  const restoredUi = spawnSync(process.execPath, [uiTest], {
    cwd: ROOT,
    env: { ...process.env, ISSUE_1221_LIVE_SEEK_REVERSION: "0" },
    encoding: "utf8",
  });
  if (restoredUi.status !== 0) {
    finish([
      "SC-27 executable Admin test did not pass after immutable paging restore",
      restoredUi.stderr || restoredUi.stdout,
    ]);
  }
  console.log("PASS issue-1221 source refund control plane self-test");
} else {
  const real = readRepo();
  finish(
    evaluateIssue1221(real.files, real.migrationNames, real.trackedEntries),
  );
}
