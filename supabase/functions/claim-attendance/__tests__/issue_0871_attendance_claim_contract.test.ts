// Executable handler/shared/mobile/web contract for issue #871.
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  attendanceClaimUrls,
  decodeOrderClaimToken,
  hmacOrderClaimDigest,
  mintOrderClaimToken,
  normalizeAttendanceEvent,
  parseAttendanceClaimLinkRequest,
  parseAttendanceClaimRequest,
} from "../../_shared/attendanceClaim.ts";
import {
  attendanceClaimAuthAction,
  attendanceClaimReviewModalPolicy,
  createAttendanceClaimSingleFlight,
  parseAttendanceClaimUrl,
  rosterDenialPolicy,
} from "../../../../app-mobile/src/utils/attendanceClaimDeepLink.ts";

const eventId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const token = "A".repeat(43);
const root = new URL("../../../../", import.meta.url);
const read = (path: string): string =>
  Deno.readTextFileSync(new URL(path, root));

Deno.test("#871 handler boundary accepts only the exact entity/token contracts", () => {
  assertEquals(
    parseAttendanceClaimRequest({
      version: 1,
      kind: "order",
      eventId,
      sourceId,
      token,
    })?.kind,
    "order",
  );
  assertEquals(
    parseAttendanceClaimRequest({
      version: 1,
      kind: "rsvp",
      eventId,
      sourceId,
      token,
    })?.kind,
    "rsvp",
  );
  assertEquals(
    parseAttendanceClaimRequest({
      version: 1,
      kind: "ticket",
      eventId,
      sourceId,
      token,
    }),
    null,
  );
  assertEquals(
    parseAttendanceClaimRequest({
      version: 1,
      kind: "order",
      eventId,
      sourceId,
      token: token.slice(1),
    }),
    null,
  );
  assertEquals(
    parseAttendanceClaimRequest({
      version: 1,
      kind: "order",
      eventId,
      sourceId,
      token,
      extra: true,
    }),
    null,
  );
  assertEquals(
    parseAttendanceClaimLinkRequest({
      checkoutSessionId: eventId,
      buyerStatusToken: "b".repeat(32),
    })?.checkoutSessionId,
    eventId,
  );
  assertEquals(
    parseAttendanceClaimLinkRequest({
      checkoutSessionId: eventId,
      buyerStatusToken: "short",
    }),
    null,
  );
});

Deno.test("#871 order tokens are exact random 32-byte values with pepper-bound digests", async () => {
  const minted = mintOrderClaimToken();
  assertEquals(minted.token.length, 43);
  assertEquals(decodeOrderClaimToken(minted.token)?.length, 32);
  assertEquals(decodeOrderClaimToken(`${minted.token}A`), null);
  const one = await hmacOrderClaimDigest(minted.raw, "pepper-one");
  const repeat = await hmacOrderClaimDigest(minted.raw, "pepper-one");
  const other = await hmacOrderClaimDigest(minted.raw, "pepper-two");
  assertEquals(one, repeat);
  assertNotEquals(one, other);
});

Deno.test("#871 native and HTTPS fragment forms parse identically and reject ambiguity", () => {
  const urls = attendanceClaimUrls({ kind: "order", eventId, sourceId, token });
  assertEquals(parseAttendanceClaimUrl(urls.appClaimUrl)?.sourceId, sourceId);
  assertEquals(parseAttendanceClaimUrl(urls.webClaimUrl)?.sourceId, sourceId);
  assertEquals(parseAttendanceClaimUrl(`${urls.appClaimUrl}&extra=1`), null);
  assertEquals(
    parseAttendanceClaimUrl(urls.appClaimUrl.replace("#", "?")),
    null,
  );
});

Deno.test("#871 web landing validates the exact fragment before registered-scheme launch", () => {
  const landing = read("mingla-business/app/attendance/claim.tsx");
  assertStringIncludes(landing, "TOKEN.test(token)");
  assertStringIncludes(landing, "[...params.keys()].some");
  assertStringIncludes(landing, "window.history.replaceState");
  assertStringIncludes(landing, "com.mingla.app.v2://attendance-claim#");
});

Deno.test("#871 relation normalization fails closed on malformed Supabase shapes", () => {
  assertEquals(
    normalizeAttendanceEvent({
      status: "scheduled",
      visibility: "public",
      deleted_at: null,
      event_type: "event",
      brands: [{ deleted_at: null }],
    })?.event_type,
    "event",
  );
  assertEquals(
    normalizeAttendanceEvent({ status: "scheduled", brands: [] }),
    null,
  );
});

Deno.test("#871 secure auth transition resumes only the retained signed-out intent", () => {
  assertEquals(attendanceClaimAuthAction(undefined, null, true), "none");
  assertEquals(attendanceClaimAuthAction(null, eventId, true), "resume");
  assertEquals(attendanceClaimAuthAction(null, eventId, false), "none");
  assertEquals(attendanceClaimAuthAction(eventId, null, true), "clear");
  assertEquals(attendanceClaimAuthAction(eventId, sourceId, true), "clear");
});

Deno.test("#871 root arbitration and offering actions cannot leave dead or stacked sheets", () => {
  const shell = read("app-mobile/app/index.tsx");
  assertEquals(shell.match(/<AttendanceClaimSheet/g)?.length, 1);
  for (
    const closer of [
      "setViewingTrip(null)",
      "setViewingFriendProfileId(null)",
      "setShowPaywall(false)",
      "setShowPreferences(false)",
      "setShowCollabPreferences(false)",
      "setShowAccountSettings(false)",
      "setShowShareModal(false)",
    ]
  ) assertStringIncludes(shell, closer);
  assertStringIncludes(shell, "InteractionManager.runAfterInteractions");
  assertStringIncludes(shell, "requestAnimationFrame");
  assertStringIncludes(shell, "beginAttendanceClaimPresentation");
  const suppressionStart = shell.match(
    /const beginAttendanceClaimPresentation = useCallback\(\(\): void => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1] ?? "";
  assertStringIncludes(
    suppressionStart,
    "setAttendanceClaimPresentationPending(true)",
  );
  assert(!suppressionStart.includes("cancelPlaceReviewRequest()"));
  assert(!suppressionStart.includes("dismissReview()"));
  assert(
    (shell.match(/beginAttendanceClaimPresentation\(\)/g)?.length ?? 0) >= 3,
    "cold, warm, and auth-resume claim paths must all begin suppression",
  );
  assertStringIncludes(
    shell,
    "attendanceClaimPresentationPending || attendanceClaimVisible",
  );
  assertStringIncludes(shell, "reviewModalPolicy.render && activeReviewTarget");
  assertStringIncludes(shell, "visible={reviewModalPolicy.visible}");
  const suppressionClose = shell.match(
    /const closeAttendanceClaimPresentation = useCallback\(\(\): void => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1] ?? "";
  assertStringIncludes(suppressionClose, "setAttendanceClaimVisible(false)");
  assertStringIncludes(
    suppressionClose,
    "setAttendanceClaimPresentationPending(false)",
  );

  const event = read(
    "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  );
  const trip = read("app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx");
  const experience = read(
    "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
  );
  assertStringIncludes(event, "detailScrollRef.current?.scrollTo");
  assertStringIncludes(event, "RSVP options are ready.");
  assertStringIncludes(trip, "detailScrollRef.current?.scrollTo");
  assertStringIncludes(trip, "Trip package options are ready.");
  assertStringIncludes(
    experience,
    "requestAnimationFrame(() => beginBooking())",
  );
});

Deno.test("#871 review modal policy suppresses open/rearmed targets and recovers after claim close", () => {
  const alreadyOpenAtIntake = attendanceClaimReviewModalPolicy(
    true,
    true,
    true,
    false,
  );
  assertEquals(alreadyOpenAtIntake, { render: false, visible: false });

  const scheduledPeriodicRearm = attendanceClaimReviewModalPolicy(
    true,
    true,
    true,
    false,
  );
  assertEquals(scheduledPeriodicRearm, { render: false, visible: false });

  const voluntaryTargetArrival = attendanceClaimReviewModalPolicy(
    true,
    true,
    false,
    true,
  );
  assertEquals(voluntaryTargetArrival, { render: false, visible: false });

  const scheduledRecoveryAfterClose = attendanceClaimReviewModalPolicy(
    false,
    true,
    true,
    false,
  );
  assertEquals(scheduledRecoveryAfterClose, { render: true, visible: true });
  const voluntaryRecoveryAfterClose = attendanceClaimReviewModalPolicy(
    false,
    true,
    false,
    true,
  );
  assertEquals(voluntaryRecoveryAfterClose, { render: true, visible: true });
});

Deno.test("#871 post-claim probe distinguishes authorization, privacy and recovery", () => {
  const sheet = read("app-mobile/src/components/AttendanceClaimSheet.tsx");
  const service = read("app-mobile/src/services/attendanceClaimService.ts");
  assertStringIncludes(sheet, 'rosterState === "authorized"');
  assertStringIncludes(sheet, 'rosterState === "private"');
  assertStringIncludes(sheet, ': "route_error"');
  assertStringIncludes(service, 'return "private"');
  assertStringIncludes(service, 'return "unavailable"');
  assertStringIncludes(service, 'return "error"');
});

Deno.test("#871 later-page authorization denial requires immediate identity purge", () => {
  assertEquals(rosterDenialPolicy("attendance_required", true), {
    purge: true,
    revoked: true,
  });
  assertEquals(rosterDenialPolicy("guest_list_private", true), {
    purge: true,
    revoked: true,
  });
  assertEquals(rosterDenialPolicy("event_not_available", false), {
    purge: true,
    revoked: false,
  });
  assertEquals(rosterDenialPolicy(null, true), {
    purge: false,
    revoked: false,
  });
});

Deno.test("#871 delivery is provider-idempotent and RSVP delivery preserves pass access", () => {
  const backfill = read(
    "supabase/functions/attendance-claim-backfill/index.ts",
  );
  const rsvpNotify = read("supabase/functions/rsvp-notify/index.ts");
  assertStringIncludes(backfill, '"idempotency-key": input.deliveryKey');
  assertStringIncludes(backfill, "const payload = JSON.stringify");
  assertStringIncludes(backfill, "response = await request()");
  assertStringIncludes(backfill, 'return "ambiguous"');
  assertStringIncludes(backfill, "delivery.attempt_count");
  assertStringIncludes(backfill, 'finalStatus = "failed_terminal"');
  assertStringIncludes(backfill, 'rsvpRecoveryUrl("primary"');
  assertStringIncludes(rsvpNotify, "rsvpRecoveryUrl");
  assertStringIncludes(rsvpNotify, "attendanceClaimUrls");
});

Deno.test("#871 exact analytics events live at real boundaries with coarse payloads only", () => {
  const sources = [
    read("app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx"),
    read("app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx"),
    read(
      "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
    ),
    read("app-mobile/src/components/EventGuestListSheet.tsx"),
    read("app-mobile/src/components/AttendanceClaimSheet.tsx"),
  ].join("\n");
  const required = [
    "social_proof_teaser_impression",
    "guest_list_gate_opened",
    "guest_list_unlock_cta_tapped",
    "attendance_claim_started",
    "attendance_claim_completed",
    "guest_list_authorization_result",
    "guest_list_opened",
    "guest_list_page_loaded",
    "guest_list_access_revoked",
  ];
  for (const event of required) {
    assertStringIncludes(sources, `capture("${event}"`);
  }
  for (
    const redundant of [
      "attendance_claim_state",
      "attendance_claim_link_state",
      "guest_roster_state",
    ]
  ) {
    assert(
      !sources.includes(redundant),
      `${redundant} would double-count the exact events`,
    );
  }
  const forbiddenPayload =
    /\b(event_id|eventId|source_id|sourceId|token|url|fragment|email|phone|name|username|avatar|profile_id|profileId|checkoutSessionId)\s*:/;
  const capture = /capture\("([a-z_]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  for (const match of sources.matchAll(capture)) {
    if (required.includes(match[1])) {
      assert(
        !forbiddenPayload.test(match[2]),
        `${match[1]} contains a forbidden identifier field`,
      );
    }
  }
});

Deno.test("#871 inherited request timeout keeps one submission in flight until settlement", async () => {
  const service = read("app-mobile/src/services/attendanceClaimService.ts");
  assert(
    !service.includes("Promise.race"),
    "claim service must inherit the global aborting timeout",
  );
  assert(
    !service.includes("setTimeout"),
    "claim service must not release UI before the request settles",
  );

  const singleFlight = createAttendanceClaimSingleFlight();
  let calls = 0;
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = singleFlight.run(async () => {
    calls += 1;
    await pending;
  });
  const second = singleFlight.run(async () => {
    calls += 1;
  });
  assertEquals(first, second);
  assertEquals(calls, 1);
  assert(singleFlight.isActive());
  release();
  await first;
  assert(!singleFlight.isActive());
  await singleFlight.run(async () => {
    calls += 1;
  });
  assertEquals(calls, 2);
});

Deno.test("#871 all three confirmation routes prepare every observed finalization and terminate", () => {
  for (
    const path of [
      "mingla-business/app/checkout/[eventId]/confirm.tsx",
      "mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx",
      "mingla-business/app/checkout-experience/[experienceEventId]/confirm.tsx",
    ]
  ) {
    const source = read(path);
    assert(
      (source.match(/prepareAttendanceClaim/g)?.length ?? 0) >= 4,
      `${path} lacks sync + realtime + retry preparation`,
    );
    assert(
      source.indexOf("prepareAttendanceClaim(payload.checkoutSessionId") <
        source.indexOf("onOrderReady:"),
    );
    assert(
      source.indexOf("onOrderReady:") <
        source.lastIndexOf(
          "prepareAttendanceClaim(pendingSession.checkoutSessionId",
        ),
    );
    assertStringIncludes(source, '"error"');
    assertStringIncludes(source, '"terminal"');
    assertStringIncludes(source, '"rate"');
    assertStringIncludes(source, "webClaimUrl");
  }
});
