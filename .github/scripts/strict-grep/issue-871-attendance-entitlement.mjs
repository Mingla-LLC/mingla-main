#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith(".github")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const files = {
  foundation: "supabase/migrations/20270302000871_issue_0871_attendance_claim_foundation.sql",
  roster: "supabase/migrations/20270302000872_issue_0871_entitled_guest_roster.sql",
  hook: "app-mobile/src/hooks/useEventGuestList.ts",
  shell: "app-mobile/app/index.tsx",
  mobileVersion: "app-mobile/app.json",
  businessVersion: "mingla-business/app.json",
  claimSheet: "app-mobile/src/components/AttendanceClaimSheet.tsx",
  guestSheet: "app-mobile/src/components/EventGuestListSheet.tsx",
  claimService: "app-mobile/src/services/attendanceClaimService.ts",
  deepLink: "app-mobile/src/utils/attendanceClaimDeepLink.ts",
  eventScreen: "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  tripScreen: "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
  experienceScreen: "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
  eventConfirmation: "mingla-business/app/checkout/[eventId]/confirm.tsx",
  tripConfirmation: "mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx",
  experienceConfirmation: "mingla-business/app/checkout-experience/[experienceEventId]/confirm.tsx",
  backfill: "supabase/functions/attendance-claim-backfill/index.ts",
};

const rules = [
  ["ISSUE871_PEER_ROSTER_EXACT_ENTITLEMENT", "roster", /r\.user_id = v_viewer[\s\S]*o\.buyer_user_id = v_viewer[\s\S]*RAISE EXCEPTION 'attendance_required'/],
  ["ISSUE871_ATOMIC_PROOF_BOUND_CLAIM", "foundation", /pg_advisory_xact_lock[\s\S]*FOR UPDATE[\s\S]*fixed_digest_equal[\s\S]*attendance_claim_token_digest = NULL/],
  ["ISSUE871_DENIAL_PURGES_IDENTITIES", "hook", /denial\.purge[\s\S]*removeQueries[\s\S]*pages: terminalState \? \[\]/],
  ["ISSUE871_205_ROW_100_100_5", "roster", /NULLIF\(btrim\(p\.avatar_url\), ''\)[\s\S]*p\.created_at ASC[\s\S]*p\.row_id ASC[\s\S]*LIMIT v_limit \+ 1 OFFSET v_offset/],
];

const check = (sources) => {
  const failures = [];
  for (const [marker, key, pattern] of rules) {
    if (!pattern.test(sources[key])) failures.push(`${marker} failed in ${files[key]}`);
  }
  if ((sources.shell.match(/<AttendanceClaimSheet/g) ?? []).length !== 1) {
    failures.push("attendance claim sheet must have exactly one mounted source instance");
  }
  const mobile = JSON.parse(sources.mobileVersion).expo.version;
  const business = JSON.parse(sources.businessVersion).expo.version;
  if (mobile !== business) failures.push(`release version parity failed: ${mobile} != ${business}`);

  const analytics = [
    sources.claimSheet, sources.guestSheet, sources.eventScreen,
    sources.tripScreen, sources.experienceScreen, sources.eventConfirmation,
    sources.tripConfirmation, sources.experienceConfirmation,
  ].join("\n");
  const exactEvents = [
    "social_proof_teaser_impression", "guest_list_gate_opened",
    "guest_list_unlock_cta_tapped", "attendance_claim_started",
    "attendance_claim_completed", "guest_list_authorization_result",
    "guest_list_opened", "guest_list_page_loaded", "guest_list_access_revoked",
  ];
  for (const event of exactEvents) {
    if (!analytics.includes(`capture("${event}"`)) {
      failures.push(`ISSUE871_EXACT_COARSE_ANALYTICS missing ${event}`);
    }
  }
  for (const redundant of ["attendance_claim_state", "attendance_claim_link_state", "guest_roster_state"]) {
    if (analytics.includes(redundant)) {
      failures.push(`ISSUE871_EXACT_COARSE_ANALYTICS redundant ${redundant}`);
    }
  }
  const forbiddenPayload = /\b(event_id|eventId|source_id|sourceId|token|url|fragment|email|phone|name|username|avatar|profile_id|profileId|checkoutSessionId)\s*:/;
  const captures = /capture\("([a-z_]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  for (const match of analytics.matchAll(captures)) {
    if (exactEvents.includes(match[1]) && forbiddenPayload.test(match[2])) {
      failures.push(`ISSUE871_EXACT_COARSE_ANALYTICS forbidden payload in ${match[1]}`);
    }
  }
  const suppressionStart = sources.shell.match(
    /const beginAttendanceClaimPresentation = useCallback\(\(\): void => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1] ?? "";
  const suppressionClose = sources.shell.match(
    /const closeAttendanceClaimPresentation = useCallback\(\(\): void => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1] ?? "";
  if (!/setAttendanceClaimPresentationPending\(true\)/.test(suppressionStart) ||
      /cancelPlaceReviewRequest\(\)|dismissReview\(\)/.test(suppressionStart) ||
      (sources.shell.match(/beginAttendanceClaimPresentation\(\)/g) ?? []).length < 3 ||
      !/attendanceClaimPresentationPending \|\| attendanceClaimVisible/.test(sources.shell) ||
      !/attendanceClaimReviewModalPolicy\(\s*attendanceClaimSuppressesReview,\s*activeReviewTarget !== null,\s*\)/.test(sources.shell) ||
      !/reviewModalPolicy\.render && activeReviewTarget/.test(sources.shell) ||
      !/visible=\{voluntaryPlaceReview \? true : showReviewModal\}/.test(sources.shell) ||
      !/setAttendanceClaimVisible\(false\)[\s\S]*setAttendanceClaimPresentationPending\(false\)/.test(suppressionClose) ||
      !/render: !attendanceClaimVisible && hasActiveReviewTarget/.test(sources.deepLink)) {
    failures.push("ISSUE871_REVIEW_MODAL_CONTINUOUS_SUPPRESSION open/rearm/voluntary/recovery policy missing");
  }
  if (/Promise\.race|setTimeout/.test(sources.claimService)) {
    failures.push("ISSUE871_INHERITED_CLAIM_TIMEOUT local timeout wrapper detected");
  }
  if (!/next_attempt_at/.test(sources.foundation) ||
      !/v_attempt_count >= 5/.test(sources.foundation) ||
      !/provider_ambiguous/.test(sources.foundation) ||
      !/const payload = JSON\.stringify[\s\S]*response = await request\(\)[\s\S]*return "ambiguous"/.test(sources.backfill)) {
    failures.push("ISSUE871_DELIVERY_RETRY_COHERENCE retry/backoff/ambiguity contract missing");
  }
  if (!/attendance_claim_attempts_outcome_check[\s\S]*attendance_claim_attempts_lifecycle_check[\s\S]*attendance_claim_attempt_already_terminal/.test(sources.foundation)) {
    failures.push("ISSUE871_ATTEMPT_TERMINAL_LIFECYCLE schema enforcement missing");
  }
  return failures;
};

const sources = Object.fromEntries(Object.entries(files).map(([key, relative]) => [
  key,
  fs.readFileSync(path.join(root, relative), "utf8"),
]));

if (process.argv.includes("--self-test")) {
  const failures = [];
  if (check(sources).length) failures.push("good fixture failed");
  for (const [marker, key] of rules) {
    const broken = { ...sources, [key]: "intentionally reverted" };
    if (!check(broken).some((failure) => failure.includes(marker))) {
      failures.push(`${marker} revert was not detected`);
    }
  }
  for (const [marker, key, replacement] of [
    ["ISSUE871_EXACT_COARSE_ANALYTICS", "claimSheet", "analytics removed"],
    ["ISSUE871_REVIEW_MODAL_CONTINUOUS_SUPPRESSION", "shell", "review suppression removed"],
    ["ISSUE871_REVIEW_MODAL_CONTINUOUS_SUPPRESSION", "deepLink", "review policy removed"],
    ["ISSUE871_INHERITED_CLAIM_TIMEOUT", "claimService", "Promise.race setTimeout"],
    ["ISSUE871_DELIVERY_RETRY_COHERENCE", "backfill", "delivery retry removed"],
    ["ISSUE871_ATTEMPT_TERMINAL_LIFECYCLE", "foundation", "attempt constraints removed"],
  ]) {
    const broken = { ...sources, [key]: replacement };
    if (!check(broken).some((failure) => failure.includes(marker))) {
      failures.push(`${marker} revert was not detected`);
    }
  }
  for (const [name, shell] of [
    ["open target", sources.shell.replace("reviewModalPolicy.render && activeReviewTarget", "activeReviewTarget")],
    ["scheduled re-arm", sources.shell.replace("voluntaryPlaceReview ? true : showReviewModal", "voluntaryPlaceReview ? true : false")],
    ["voluntary arrival", sources.shell.replace("voluntaryPlaceReview ? true : showReviewModal", "false ? true : showReviewModal")],
    ["post-close recovery", sources.shell.replace("setAttendanceClaimPresentationPending(false);", "// suppression remains stuck")],
  ]) {
    const broken = { ...sources, shell };
    if (!check(broken).some((failure) => failure.includes("ISSUE871_REVIEW_MODAL_CONTINUOUS_SUPPRESSION"))) {
      failures.push(`ISSUE871_REVIEW_MODAL_CONTINUOUS_SUPPRESSION ${name} revert was not detected`);
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("issue #871 strict guard self-test passed (good + fourteen critical reverts)");
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("issue #871 attendance entitlement strict guard passed");
