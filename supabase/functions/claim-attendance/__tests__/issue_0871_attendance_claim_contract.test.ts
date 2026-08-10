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
  shouldIssueOrderAttendanceClaimForNotification,
} from "../../_shared/attendanceClaim.ts";
import {
  attendanceClaimAuthAction,
  attendanceClaimReviewModalPolicy,
  createAttendanceClaimSingleFlight,
  parseAttendanceClaimUrl,
  rosterDenialPolicy,
} from "../../../../app-mobile/src/utils/attendanceClaimDeepLink.ts";
import {
  attendanceAppUrlFromFragment,
  openAttendanceClaimWithFallback,
} from "../../../../mingla-business/src/utils/attendanceClaimDeepLink.ts";

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

Deno.test("#871 order proof issuance belongs only to eligible confirmation email attempts", () => {
  const eligible = {
    templateKey: "buyer_ticket_confirmation",
    buyerUserId: null,
    paymentStatus: "paid",
  };
  assertEquals(
    shouldIssueOrderAttendanceClaimForNotification({
      ...eligible,
      channel: "sms",
    }),
    false,
  );
  assertEquals(
    shouldIssueOrderAttendanceClaimForNotification({
      ...eligible,
      channel: "email",
    }),
    true,
  );
  assertEquals(
    shouldIssueOrderAttendanceClaimForNotification({
      ...eligible,
      channel: "email",
    }),
    true,
  );
  assertEquals(
    shouldIssueOrderAttendanceClaimForNotification({
      ...eligible,
      channel: "email",
      buyerUserId: eventId,
    }),
    false,
  );

  const dispatcher = read(
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
  );
  const emailBranch = dispatcher.indexOf('notification.channel === "email"');
  const issueCall = dispatcher.indexOf('"issue_order_attendance_claim_proof"');
  const providerCall = dispatcher.indexOf(
    "sendResendEmailWithAttachment",
    issueCall,
  );
  assert(
    emailBranch < issueCall && issueCall < providerCall,
    "proof must be minted immediately within email delivery",
  );
  assertStringIncludes(
    dispatcher.slice(issueCall, providerCall),
    "p_allow_retry_rotation: true",
  );

  const foundation = read(
    "supabase/migrations/20270302000871_issue_0871_attendance_claim_foundation.sql",
  );
  assertStringIncludes(foundation, "attendance_claim_token_digest = p_digest");
  assertStringIncludes(
    foundation,
    "fixed_digest_equal(v_expected, p_proof_digest)",
  );
});

Deno.test("#871 anonymous browser link acquisition supports preflight and retry rotation", () => {
  const source = read("supabase/functions/attendance-claim-link/index.ts");
  assertStringIncludes(source, 'req.method === "OPTIONS"');
  assertStringIncludes(source, "ticketCorsHeaders");
  assertStringIncludes(source, "claimJson(status, body, ticketCorsHeaders)");
  assertStringIncludes(source, "p_allow_retry_rotation: true");
});

Deno.test("#871 RSVP pass attendance CTA uses exact public live eligibility", () => {
  const source = read("supabase/functions/rsvp-notify/index.ts");
  for (
    const contract of [
      '.select("status,visibility,deleted_at,event_type,brands(deleted_at)")',
      'event.visibility === "public"',
      'event.event_type === "rsvp"',
      '["scheduled", "live"].includes(event.status)',
      "brand?.deleted_at === null",
    ]
  ) assertStringIncludes(source, contract);
});

Deno.test("#871 native and HTTPS fragment forms parse identically and reject ambiguity", () => {
  const urls = attendanceClaimUrls({ kind: "order", eventId, sourceId, token });
  assertEquals(parseAttendanceClaimUrl(urls.appClaimUrl)?.sourceId, sourceId);
  assertEquals(parseAttendanceClaimUrl(urls.webClaimUrl)?.sourceId, sourceId);
  assertEquals(parseAttendanceClaimUrl(`${urls.appClaimUrl}&extra=1`), null);
  assertEquals(
    parseAttendanceClaimUrl(`${urls.appClaimUrl}&token=${token}`),
    null,
  );
  assertEquals(parseAttendanceClaimUrl(`${urls.appClaimUrl}&v=2`), null);
  assertEquals(
    parseAttendanceClaimUrl(urls.appClaimUrl.replace("#", "?")),
    null,
  );
});

Deno.test("#871 web landing validates the exact fragment before registered-scheme launch", () => {
  const landing = read("mingla-business/app/attendance/claim.tsx");
  assertStringIncludes(landing, "window.history.replaceState");
  assertStringIncludes(landing, "autoAttemptedRef.current");
  const fragment =
    attendanceClaimUrls({ kind: "order", eventId, sourceId, token })
      .webClaimUrl.split("#")[1] ?? "";
  assert(
    attendanceAppUrlFromFragment(fragment)?.startsWith("com.mingla.app.v2://"),
  );
  assertEquals(
    attendanceAppUrlFromFragment(`${fragment}&token=${token}`),
    null,
  );
  assertEquals(attendanceAppUrlFromFragment(`${fragment}&v=2`), null);
});

Deno.test("#871 buyer app-first launch falls back only while the browser remains visible", async () => {
  const links = {
    appClaimUrl: "app://claim",
    webClaimUrl: "https://example.test/claim",
  };
  const calls: string[] = [];
  let scheduled: (() => void) | null = null;
  let listener: (() => void) | null = null;
  const doc = {
    visibilityState: "visible",
    addEventListener: (_type: "visibilitychange", next: () => void) => {
      listener = next;
    },
    removeEventListener: () => undefined,
  };
  await openAttendanceClaimWithFallback(
    links,
    (url) => {
      calls.push(url);
      return Promise.resolve();
    },
    doc,
    (callback) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
  );
  assertEquals(calls, [links.appClaimUrl]);
  (scheduled as (() => void) | null)?.();
  assertEquals(calls, [links.appClaimUrl, links.webClaimUrl]);

  calls.length = 0;
  scheduled = null;
  await openAttendanceClaimWithFallback(
    links,
    (url) => {
      calls.push(url);
      return Promise.resolve();
    },
    doc,
    (callback) => {
      scheduled = callback;
      return 2 as unknown as ReturnType<typeof setTimeout>;
    },
  );
  doc.visibilityState = "hidden";
  (listener as (() => void) | null)?.();
  (scheduled as (() => void) | null)?.();
  assertEquals(calls, [links.appClaimUrl]);
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
  assertStringIncludes(shell, "setAttendanceClaimInvalid(intent === null)");
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
  assertStringIncludes(
    shell,
    "visible={voluntaryPlaceReview ? true : showReviewModal}",
  );
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
  const alreadyOpenAtIntake = attendanceClaimReviewModalPolicy(true, true);
  assertEquals(alreadyOpenAtIntake, { render: false });

  const scheduledPeriodicRearm = attendanceClaimReviewModalPolicy(true, true);
  assertEquals(scheduledPeriodicRearm, { render: false });

  const voluntaryTargetArrival = attendanceClaimReviewModalPolicy(true, true);
  assertEquals(voluntaryTargetArrival, { render: false });

  const scheduledRecoveryAfterClose = attendanceClaimReviewModalPolicy(
    false,
    true,
  );
  assertEquals(scheduledRecoveryAfterClose, { render: true });
  const voluntaryRecoveryAfterClose = attendanceClaimReviewModalPolicy(
    false,
    true,
  );
  assertEquals(voluntaryRecoveryAfterClose, { render: true });
});

Deno.test("#871 post-claim probe distinguishes authorization, privacy and recovery", () => {
  const sheet = read("app-mobile/src/components/AttendanceClaimSheet.tsx");
  const service = read("app-mobile/src/services/attendanceClaimService.ts");
  assertStringIncludes(sheet, 'rosterState === "authorized"');
  assertStringIncludes(sheet, 'rosterState === "private"');
  assertStringIncludes(sheet, ': "route_error"');
  assertStringIncludes(
    sheet,
    'backdropPressBehavior={submitting ? "none" : "close"}',
  );
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
    assertStringIncludes(
      source,
      "openAttendanceClaimWithFallback(link, Linking.openURL)",
    );
    assertStringIncludes(
      source,
      "Your tickets are confirmed. We couldn’t prepare the Mingla link.",
    );
    assertStringIncludes(
      source,
      "Your tickets are confirmed. Guest-list access isn’t available for this order.",
    );
    assertStringIncludes(
      source,
      "Your tickets are confirmed. Try the Mingla link again in a few minutes.",
    );
    assertStringIncludes(source, "styles.attendanceClaimCard");
    assertStringIncludes(source, "MINGLA_APP_ICON");
    assertStringIncludes(source, 'accessibilityLabel="Mingla app icon"');
  }
});

Deno.test("#871 guest sheet exposes close, party size, offline recovery and actionable unlock", () => {
  const sheet = read("app-mobile/src/components/EventGuestListSheet.tsx");
  assertStringIncludes(sheet, 'accessibilityLabel="Close guest list"');
  assertStringIncludes(sheet, "width: 44");
  assertStringIncludes(sheet, "const party = `party of ${guest.partySize}`");
  assertStringIncludes(sheet, "Retry after reconnect");
  assertStringIncludes(sheet, 'color: "#111827"');
  assert(
    sheet.indexOf("onClose();", sheet.indexOf("const handleAttendanceAction")) <
      sheet.indexOf(
        "onAttendanceAction?.();",
        sheet.indexOf("const handleAttendanceAction"),
      ),
  );
});
