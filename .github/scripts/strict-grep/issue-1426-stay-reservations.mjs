#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const files = {
  shell: "mingla-business/src/components/stay/StaySuiteShell.tsx",
  module: "mingla-business/src/components/stay/StayReservationsModule.tsx",
  detail:
    "mingla-business/src/components/stay/StayReservationManagementDetail.tsx",
  hook: "mingla-business/src/hooks/useStayStaffReservations.ts",
  service: "mingla-business/src/services/stayReservationService.ts",
  edge: "supabase/functions/stay-reservations/index.ts",
  migration:
    "supabase/migrations/20270203001426_issue_1426_stay_staff_reservations.sql",
  notifications:
    "supabase/migrations/20270131013816_issue_1389_stay_notifications_and_sweep.sql",
};

const required = {
  shell: ["StayReservationsModule", "<StayReservationsModule venueId={venueId} />"],
  module: [
    'id: "needs_response"',
    'id: "awaiting_payment"',
    'id: "confirmed"',
    'id: "cancelled"',
    'id: "reconciliation"',
    "StayReservationManagementDetail",
  ],
  detail: [
    'label="Approve all"',
    'label="Decline all"',
    ">Review cancellation</Text>",
    'label="Confirm cancellation"',
    'label="Refund to guest"',
    'label="Amount retained"',
    'label="Inventory reopened"',
    'label="Payout effect"',
    "dependencyRoomLineId === line.lineId",
  ],
  hook: [
    "stayStaffReservationKeys.venue(input.venueId)",
    "stayStaffReservationKeys.group(group.groupId)",
    "stayGuestKeys.all",
    "stay:staff:approve:",
    "stay:staff:decline:",
    "stay:staff:cancel:",
  ],
  service: [
    'action: "list_staff_groups"',
    'action: "get_staff_group"',
    'action: "cancel_preview"',
    'action: "cancel"',
  ],
  edge: [
    '"list_staff_groups"',
    '"get_staff_group"',
    '"issue_1426_list_staff_stay_reservations"',
    '"issue_1426_staff_group_projection"',
    '"issue_1426_manage_request"',
    '"issue_1426_cancel_preview"',
    '"issue_1426_cancel"',
  ],
  migration: [
    "public.issue_1426_has_stay_permission",
    "'stay.' || v_action",
    "RETURN v_base AND (v_overrides->>v_key)::boolean",
    "public.issue_1426_list_staff_stay_reservations",
    "public.issue_1426_staff_group_projection",
    "public.issue_1426_manage_request",
    "public.issue_1388_manage_request",
    "public.issue_1426_cancel_preview",
    "public.issue_1389_cancel_preview",
    "'retainedAmountMinor'",
    "'inventoryRelease'",
    "'payoutEffect'",
    "public.issue_1426_cancel",
    "public.issue_1389_cancel",
    "FROM public, anon",
    "TO authenticated, service_role",
  ],
  notifications: [
    "stay_reservation_event_notification",
    "stay_request_received",
    "stay_payment_required",
    "stay_reservation_confirmed",
    "stay_refund_succeeded",
    "STAY_NOTIFICATIONS",
  ],
};

function check(source) {
  const failures = [];
  for (const [key, needles] of Object.entries(required)) {
    for (const needle of needles) {
      if (!source[key]?.includes(needle)) {
        failures.push(`${files[key]} missing ${JSON.stringify(needle)}`);
      }
    }
  }

  const clientSource = [source.module, source.detail, source.hook, source.service]
    .join("\n");
  if (/\.from\(\s*["']stay_/u.test(clientSource)) {
    failures.push("Stay staff UI bypasses the managed RPC boundary");
  }
  if (/mark[_A-Za-z]*(paid|refunded)/iu.test(clientSource)) {
    failures.push("Stay staff UI contains a client-owned paid/refunded action");
  }
  if (
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.feature_flags/iu.test(
      source.migration ?? "",
    )
  ) {
    failures.push(`${files.migration} changes launch flags`);
  }
  if ((source.edge ?? "").includes('"issue_1389_cancel_preview"')) {
    failures.push(`${files.edge} bypasses the permission-safe cancel wrapper`);
  }
  return failures;
}

function load() {
  return Object.fromEntries(
    Object.entries(files).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

if (process.argv.includes("--self-test")) {
  const good = Object.fromEntries(
    Object.entries(required).map(([key, needles]) => [key, needles.join("\n")]),
  );
  const baseline = check(good);
  if (baseline.length > 0) {
    console.error(`issue-1426 self-test fixture invalid:\n${baseline.join("\n")}`);
    process.exit(2);
  }
  let reversions = 0;
  for (const [key, needles] of Object.entries(required)) {
    const bad = { ...good, [key]: good[key].replaceAll(needles[0], "") };
    if (check(bad).length === 0) {
      console.error(`issue-1426 self-test missed ${key} reversion`);
      process.exit(1);
    }
    reversions += 1;
  }
  const directWrite = {
    ...good,
    module: `${good.module}\nsupabase.from("stay_reservation_groups")`,
  };
  if (check(directWrite).length === 0) process.exit(1);
  reversions += 1;
  const flagFlip = {
    ...good,
    migration: `${good.migration}\nUPDATE public.feature_flags SET is_enabled = true`,
  };
  if (check(flagFlip).length === 0) process.exit(1);
  reversions += 1;
  const oldCancel = {
    ...good,
    edge: `${good.edge}\n"issue_1389_cancel_preview"`,
  };
  if (check(oldCancel).length === 0) process.exit(1);
  reversions += 1;
  console.log(`issue-1426 self-test PASS (${reversions} reversions)`);
  process.exit(0);
}

try {
  const failures = check(load());
  if (failures.length > 0) {
    console.error(
      [
        "I-1426-STAY-STAFF-RESERVATIONS violation:",
        ...failures.map((failure) => `- ${failure}`),
        "Restore the permission-safe grouped Stay management boundary; keep provider money and launch flags server-owned.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log("I-1426-STAY-STAFF-RESERVATIONS PASS");
} catch (error) {
  console.error(`I-1426-STAY-STAFF-RESERVATIONS inconclusive: ${error.message}`);
  process.exit(2);
}
