// Executable handler/shared/mobile/web contract for issue #871.
import {
  assert,
  assertEquals,
  assertMatch,
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
  const issueCall = dispatcher.indexOf(
    '"issue_order_attendance_claim_proof_v2"',
  );
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
    "p_generation: pepperRing.current.generation",
  );
  assertStringIncludes(
    dispatcher.slice(issueCall, providerCall),
    "p_allow_retry_rotation: false",
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
  assertStringIncludes(source, "resolveAttendanceClaimPepperRing");
  assertStringIncludes(source, "issue_order_attendance_claim_proof_v2");
  assertStringIncludes(source, "p_generation: pepperRing.current.generation");
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

/**
 * #2323 [TEST-MOD-APPROVED #2323] — WHY THIS TEST WAS EDITED, AND WHAT WAS NOT
 * WEAKENED.
 *
 * This case used to count `prepareAttendanceClaim` occurrences inside each
 * confirmation route (>= 4) and pin their textual order. That counted a
 * LOCATION, not a guarantee — and the location was the bug. Both of the call
 * sites it counted hung off the PAID Stripe return leg (the `?cs=` sync
 * confirm, and an `onOrderReady` that only ever subscribes because that same
 * effect ran). A FREE reservation reaches /confirm through neither, so it had
 * NO mint at all — and the count still read 4 and this test still passed.
 *
 * MEASURED on production 2026-08-19: free_completed orders 9, armed 0;
 * paid_completed 5, armed 1. Instrumented on the DEPLOYED screen holding a
 * completed free order (desktop Chrome and a real Galaxy A72): ZERO
 * `attendance-claim-link` requests. The founder's ticket was unreachable.
 *
 * #2323 replaced the three per-route copies with ONE owner,
 * `mingla-business/src/hooks/useAttendanceClaimArm.ts`, which mints from the
 * ORDER rather than from the arrival path. So the assertions move to where the
 * guarantee now lives:
 *
 *   - the OWNER mints, keeps one mint per checkout session, and still exposes
 *     every terminal phase plus a retry;
 *   - each ROUTE hands its finalized order to that owner, and every
 *     finalization leg — sync, realtime, and (new) free — puts the possession
 *     proof ON the order, which is exactly what makes the mint reachable from
 *     that leg. Drop the proof from any one leg and that leg stops minting.
 *
 * NOT WEAKENED — every one of the following makes a named assertion below fail:
 * deleting the sync leg's proof, deleting the realtime leg's proof, deleting
 * the free leg's proof, unhooking a route from the owner, dropping the retry
 * wiring, or removing a phase from the owner. The ordering guarantee (sync
 * precedes the realtime subscription, which precedes the realtime mint) is
 * kept verbatim, now expressed over the legs that feed the owner.
 *
 * The behaviour itself is proven by EXECUTION, not by this file:
 * `mingla-business/src/hooks/__tests__/issue2323FreeOrderArm.render.test.tsx`
 * mounts the owner and drives sync, realtime, retry, free, a second checkout
 * session, and all four terminal phases.
 */
Deno.test("#871 all three confirmation routes prepare every observed finalization and terminate", () => {
  // The ONE owner: it mints, it mints ONCE per checkout session, and it still
  // terminates in every phase the card renders copy for.
  const owner = read("mingla-business/src/hooks/useAttendanceClaimArm.ts");
  assertStringIncludes(owner, "createAttendanceClaimLink(sessionId, token)");
  assertStringIncludes(owner, "const retry = useCallback");
  // ONE mint per checkout session — asserted as the GUARD, not as an
  // identifier name, so a rename is allowed and a deleted guard is not.
  assertMatch(
    owner,
    /if \(\w+\.current === \w+\.sessionId\) return;/,
    "the owner must refuse to re-mint a checkout session it already minted",
  );
  assertMatch(
    owner,
    /\w+\.current = \w+\.sessionId;/,
    "the owner must record which checkout session it minted",
  );
  // Every terminal phase, asserted as the MAPPING rather than as the token.
  //
  // The tokens alone were decoration and this was MEASURED: the previous
  // version of this case asserted '"rate"' / '"terminal"' / '"error"' appear
  // in the file, and a revert that broke the rate_limited mapping outright
  // still passed, because the words survive in the phase type union. Behaviour
  // is proven by execution in issue2323FreeOrderArm.render.test.tsx; this pins
  // the branch so it cannot silently disappear.
  assertMatch(
    owner,
    /code === "rate_limited"\s*\?\s*"rate"/,
    "a rate-limited mint must land on the rate phase",
  );
  assertMatch(
    owner,
    /code === "invalid" \|\| code === "ineligible"\s*\?\s*"terminal"\s*:\s*"error"/,
    "invalid/ineligible must be terminal and everything else must be a retryable error",
  );

  // Slice a named region so an assertion cannot be satisfied by the token
  // appearing somewhere else entirely in the file.
  const region = (src: string, from: string, to: string, why: string): string => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert(a > -1 && b > a, `could not locate ${why}`);
    return src.slice(a, b);
  };

  for (
    const path of [
      "mingla-business/app/checkout/[eventId]/confirm.tsx",
      "mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx",
      "mingla-business/app/checkout-experience/[experienceEventId]/confirm.tsx",
    ]
  ) {
    const source = read(path);

    // The route hands its finalized order to the owner. Without this the route
    // mints nothing at all, on any leg.
    assert(
      /useAttendanceClaimArm\(result, \w+\)/.test(source),
      `${path} does not hand its order to the attendance-claim owner`,
    );

    // SYNC leg — the `?cs=` confirm that finalizes the order in-line.
    assertStringIncludes(
      region(source, "recordResult({", "});", `${path} sync recordResult`),
      "buyerStatusToken: payload.buyerStatusToken",
      `${path} sync confirm records the order WITHOUT the possession proof, so nothing can mint from it`,
    );

    // REALTIME leg — the webhook backup landing through onOrderReady.
    assertStringIncludes(
      region(source, "onOrderReady:", "setRealtimePending(false)", `${path} onOrderReady`),
      "buyerStatusToken: pendingSession.buyerStatusToken",
      `${path} realtime finalization records the order WITHOUT the possession proof, so nothing can mint from it`,
    );

    // Ordering, verbatim in meaning: the sync leg precedes the realtime
    // subscription, which precedes the realtime leg's own finalization.
    assert(
      source.indexOf("buyerStatusToken: payload.buyerStatusToken") <
        source.indexOf("onOrderReady:"),
      `${path} sync leg no longer precedes the realtime subscription`,
    );
    assert(
      source.indexOf("onOrderReady:") <
        source.lastIndexOf("buyerStatusToken: pendingSession.buyerStatusToken"),
      `${path} realtime finalization no longer follows the subscription`,
    );

    // RETRY leg.
    assertStringIncludes(source, "const retryAttendanceClaim = attendanceClaim.retry;");

    // #2217 moved the presentation of the minted link out of a second card and
    // into the ONE app card (DownloadMinglaCta), which now owns the deep-link
    // open, the device-aware store fallback and every phase's copy. What is
    // pinned here is that the mint is HANDED to the card rather than dropped
    // on the floor.
    assertStringIncludes(source, "<DownloadMinglaCta");
    assertStringIncludes(source, "claimPhase={attendanceClaim.phase}");
    assertStringIncludes(source, "link.appClaimUrl");
    assertStringIncludes(source, "onRetryClaim={retryAttendanceClaim}");
  }

  // FREE leg — the arrival #2323 proved had no mint at all. It finalizes in
  // buyer.tsx and lands on /confirm with no query string, so the possession
  // proof has to ride the order or the ticket is unreachable forever.
  for (
    const path of [
      "mingla-business/app/checkout/[eventId]/buyer.tsx",
      "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
      "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
    ]
  ) {
    assertStringIncludes(
      region(read(path), "recordResult({", "});", `${path} free recordResult`),
      "buyerStatusToken: result.buyerStatusToken",
      `${path} free reservation records the order WITHOUT the possession proof — this is issue #2323 itself`,
    );
  }
});

Deno.test("#871 (via #2217) the app card still terminates every claim phase", () => {
  const card = read("mingla-business/src/components/checkout/DownloadMinglaCta.tsx");
  assertStringIncludes(
    card,
    "Your tickets are confirmed. We couldn’t prepare the Mingla link.",
  );
  assertStringIncludes(
    card,
    "Your tickets are confirmed. Guest-list access isn’t available for this order.",
  );
  assertStringIncludes(
    card,
    "Your tickets are confirmed. Try the Mingla link again in a few minutes.",
  );
  assertStringIncludes(card, "Preparing your Mingla link…");
  assertStringIncludes(card, "openAttendanceClaimWithFallback(");
  // The claim link is an ENHANCEMENT: the button must render and reach a store
  // in EVERY phase, including the ones that never produce a link.
  //
  // #2323 [TEST-MOD-APPROVED #2323] — the two assertions below replace
  //   assertStringIncludes(card, "if (claimAppUrl === null)");
  //   assertStringIncludes(card, "void Linking.openURL(target.ctaUrl);");
  //
  // The second of those pinned the DEFECT issue #2326 exists to delete. On
  // buyer-web react-native-web expands `Linking.openURL(url)` into
  // `window.open(url, '_blank', 'noopener')` — the null-returning feature
  // string ORCH-1381/1382 banned from this repository, arriving through a
  // library instead of a call site, and with NO popup-blocked fallback, so a
  // blocked open was a completely silent dead tap. Measured on the deployed
  // screen (desktop Chrome and a real Galaxy A72): the handler fired, the
  // gesture was live, and nothing happened.
  //
  // STRONGER, NOT WEAKER. The first assertion no longer merely proves a string
  // exists — it proves the no-claim-link branch NAVIGATES, and to the store
  // target. The second bans the shape that could not navigate, and pins the
  // package's ONE external-open owner in its place.
  assertMatch(
    card,
    /if \(claimAppUrl === null[^)]*\)\s*\{\s*\n\s*void navigateFromTap\(target\.ctaUrl\);/,
    "the no-claim-link branch must navigate to the store target, synchronously",
  );
  assertStringIncludes(card, "openExternal(url);");
  assertStringIncludes(card, "openAppScheme(url);");
  assert(
    !/Linking\.openURL\(target\.ctaUrl\)/.test(card),
    "the store target must not be opened through Linking.openURL — on buyer-web that is window.open(…, 'noopener'), which cannot report a blocked popup and leaves the tap dead",
  );
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
