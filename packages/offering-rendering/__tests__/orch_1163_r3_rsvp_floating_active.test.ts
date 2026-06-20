// ORCH-1163-R3 [rsvp-shared-body / floating-active] — regression (implementor-owned).
//
// Seth, on the R2 dev build: (1) the last section scrolls UNDER the floating
// Going/Maybe/Can't bar (occlusion); (2) the floating Going/Maybe buttons are
// DORMANT (rendered disabled whenever contactReady is false — and the contact + +1
// forms that would satisfy contactReady live ONLY in the inline §5 box, so from the
// floating bar there is no path forward); (3) tapping a floating button must collect
// the guest's name/email/phone AND each +1's, exactly like the inline box, then
// proceed. ONE decision owner, two entry points (inline box + floating bar).
//
// THE FIX (this test pins it, FAIL-ON-REVERT):
//   §1 — the floating bar forces contactReady (contactReadyOverride) so Going/Maybe
//        paint ENABLED, and routes through the onFloating* entry handlers.
//   §2 — the floating handlers: when contactReady is FALSE they open the details
//        modal (pendingDecision set); when TRUE they fall straight through to the
//        inline behavior (Going → confirm dialog; Maybe/Can't → submitDirect).
//   §3 — Continue inside the modal dispatches the PINNED decision: going →
//        setConfirmOpen(true); maybe → submitDirect("maybe"); not_going →
//        submitDirect("not_going") — disabled until contactReady.
//   §4 — the body renders {state.detailsModal} next to confirmDialog/successPopup;
//        the details modal re-hosts the SAME contactForm/guestForms (shared state);
//        the guestForms are OMITTED for Can't-go.
//   §5 — the inline RsvpDecisionBox is UNDISTURBED (real contactReady, inline
//        handlers) and both testID anchors (orch-1163-rsvp-inline-box +
//        orch-1157-rsvp-floating-dock) stay.
//   §6 — bar clearance is MEASURED per surface (onLayout) — business/web shell inset
//        is max(floor, measured + 24 + 16 + safeAreaBottom); consumer scroll
//        paddingBottom for isRsvp is floatBarBottom + measuredBarHeight + FLOAT_GAP.
//   §7 — RSVP stays ticketless: no price / Reserve / Get tickets / cart / checkout
//        anywhere in the new modal or the body (I-PROPOSED-1157-RSVP-NO-CHECKOUT).
//
// Deno source-contract style (the established offering-rendering pattern — these
// component files pull react-native; there is no renderer bed here, so the contract
// is asserted on the source). Comments are stripped so prose that merely NAMES a
// token never satisfies an assertion.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const bodyRaw = await read("../RsvpOfferingBody.tsx");
const body = strip(bodyRaw);
const modal = strip(await read("../RsvpDetailsModal.tsx"));
const barrel = await read("../index.ts");
const foundationRsvp = strip(
  await read("../../../mingla-business/src/components/event/FoundationRsvpPreview.tsx"),
);
const publicEventPage = strip(
  await read("../../../mingla-business/src/components/event/PublicEventPage.tsx"),
);
const consumer = strip(
  await read("../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx"),
);

// ── §1 — the floating bar forces contactReady + routes the floating handlers ──
Deno.test("ORCH-1163-R3 §1 — floating bar renders ENABLED buttons routed through the floating handlers", () => {
  // The DecisionUnit accepts a contactReadyOverride + explicit on* handler overrides.
  assertStringIncludes(body, "contactReadyOverride");
  assert(
    /contactReady=\{contactReadyOverride \?\? state\.contactReady\}/.test(body),
    "DecisionUnit must use contactReadyOverride ?? state.contactReady (real readiness on the inline box)",
  );
  assert(
    /onGoing=\{onGoing \?\? state\.onGoingTap\}/.test(body),
    "DecisionUnit onGoing must default to the inline state.onGoingTap when no override",
  );
  // The FLOATING BAR forces contactReady and wires the onFloating* handlers.
  assert(
    /RsvpOfferingFloatingBar[\s\S]*?<DecisionUnit[\s\S]*?contactReadyOverride[\s\S]*?onGoing=\{state\.onFloatingGoing\}[\s\S]*?onMaybe=\{state\.onFloatingMaybe\}[\s\S]*?onNotGoing=\{state\.onFloatingNotGoing\}/.test(
      body,
    ),
    "RsvpOfferingFloatingBar must force contactReady + wire onFloatingGoing/Maybe/NotGoing",
  );
});

// ── §2 — floating handlers: open the modal when NOT ready, fall through when ready ──
Deno.test("ORCH-1163-R3 §2 — floating handlers open the details modal when contactReady is false", () => {
  // onFloatingGoing: ready → onGoingTap(); else pendingDecision='going' + open.
  assert(
    /onFloatingGoing[\s\S]*?if \(contactReady\)[\s\S]*?onGoingTap\(\)[\s\S]*?setPendingDecision\("going"\)[\s\S]*?setDetailsOpen\(true\)/.test(
      body,
    ),
    "onFloatingGoing must call onGoingTap when ready, else set pendingDecision='going' + open modal",
  );
  // onFloatingMaybe: ready → submitDirect('maybe'); else pending='maybe' + open.
  assert(
    /onFloatingMaybe[\s\S]*?if \(contactReady\)[\s\S]*?submitDirect\("maybe"\)[\s\S]*?setPendingDecision\("maybe"\)[\s\S]*?setDetailsOpen\(true\)/.test(
      body,
    ),
    "onFloatingMaybe must submitDirect('maybe') when ready, else open modal pinned to maybe",
  );
  // onFloatingNotGoing: logged-in OR ready → submitDirect('not_going'); else open.
  assert(
    /onFloatingNotGoing[\s\S]*?if \(isLoggedIn \|\| contactReady\)[\s\S]*?submitDirect\("not_going"\)[\s\S]*?setPendingDecision\("not_going"\)[\s\S]*?setDetailsOpen\(true\)/.test(
      body,
    ),
    "onFloatingNotGoing must submitDirect when logged-in/ready, else open modal pinned to not_going",
  );
  // The three handlers are EXPOSED on the state for the floating bar to consume.
  assertStringIncludes(body, "onFloatingGoing,");
  assertStringIncludes(body, "onFloatingMaybe,");
  assertStringIncludes(body, "onFloatingNotGoing,");
});

// ── §3 — Continue dispatches the PINNED decision; disabled until contactReady ──
Deno.test("ORCH-1163-R3 §3 — modal Continue dispatches the pending decision (going→dialog; maybe/not_going→submit)", () => {
  assert(
    /onDetailsContinue[\s\S]*?if \(!contactReady\) return/.test(body),
    "onDetailsContinue must early-return until contactReady (no dead dispatch)",
  );
  assert(
    /decision === "going"[\s\S]*?setConfirmOpen\(true\)/.test(body),
    "Continue on a 'going' decision must open the confirm dialog (setConfirmOpen(true))",
  );
  assert(
    /decision === "maybe"[\s\S]*?submitDirect\("maybe"\)/.test(body),
    "Continue on a 'maybe' decision must submitDirect('maybe')",
  );
  assert(
    /decision === "not_going"[\s\S]*?submitDirect\("not_going"\)/.test(body),
    "Continue on a 'not_going' decision must submitDirect('not_going')",
  );
  // Cancel clears state WITHOUT clearing typed values (no setGuestName/setGuestEmail
  // reset in closeDetails).
  assert(
    /closeDetails[\s\S]*?setDetailsOpen\(false\)[\s\S]*?setPendingDecision\(null\)/.test(body),
    "closeDetails must clear detailsOpen + pendingDecision (and never reset typed values)",
  );
});

// ── §4 — the body renders the details modal; modal re-hosts the SHARED forms ──
Deno.test("ORCH-1163-R3 §4 — body renders state.detailsModal; modal re-hosts shared forms; +1s omitted for Can't-go", () => {
  // The body mounts {state.detailsModal} next to confirmDialog + successPopup.
  assert(
    /\{state\.confirmDialog\}[\s\S]*?\{state\.successPopup\}[\s\S]*?\{state\.detailsModal\}/.test(body),
    "RsvpOfferingBody must render {state.detailsModal} alongside confirmDialog + successPopup",
  );
  // detailsModal is built from the SAME contactForm + guestForms nodes (shared state).
  assert(
    /<RsvpDetailsModal[\s\S]*?contactForm=\{contactForm\}/.test(body),
    "detailsModal must re-host the SAME contactForm node (shared state syncs with the inline box)",
  );
  // guestForms OMITTED for Can't-go.
  assert(
    /guestForms=\{pendingDecision !== "not_going" \? guestForms : null\}/.test(body),
    "detailsModal must omit guestForms when pendingDecision is 'not_going' (Can't-go needs no +1s)",
  );
  // The modal is a portal <Modal> with a scrollable content area (gorhom-safe; the
  // tall +1 forms need scroll) — and it is its OWN file so the body hosts NO scroll
  // root (shell-agnostic §A.2).
  assertStringIncludes(modal, "<Modal");
  assertStringIncludes(modal, "<ScrollView");
  assert(
    !body.includes("<ScrollView") && !body.includes("<BottomSheetScrollView"),
    "the BODY file must host NO scroll root (the modal owns the scroll, in its own file)",
  );
  assertStringIncludes(modal, 'testID="orch-1163-rsvp-details-modal"');
  assertStringIncludes(modal, 'testID="orch-1163-rsvp-details-continue"');
  // Barrel exports it.
  assertStringIncludes(barrel, "RsvpDetailsModal");
  // Continue is disabled until ready (continueEnabled wired from contactReady).
  assert(
    /const disabled = !continueEnabled \|\| submitting/.test(modal),
    "the Continue button must be disabled until continueEnabled (contactReady) + not submitting",
  );
});

// ── §5 — the inline box is UNDISTURBED + the testID anchors stay ──
Deno.test("ORCH-1163-R3 §5 — inline box keeps real contactReady + inline handlers; anchors intact", () => {
  // The inline RsvpDecisionBox renders its DecisionUnit with NO contactReadyOverride
  // and NO floating handler overrides → it uses state.contactReady + onGoingTap etc.
  assert(
    /export const RsvpDecisionBox[\s\S]*?<DecisionUnit[\s\S]*?showMomentum\s*\n?\s*testID="orch-1157-rsvp-inline-momentum"/.test(
      body,
    ),
    "the inline RsvpDecisionBox DecisionUnit must NOT pass contactReadyOverride/onFloating* (keeps inline behavior)",
  );
  // Both canonical anchors stay.
  assertStringIncludes(body, 'testID ?? "orch-1163-rsvp-inline-box"');
  assertStringIncludes(body, 'testID ?? "orch-1157-rsvp-floating-dock"');
});

// ── §6 — bar clearance is MEASURED per surface (no occlusion) ──
Deno.test("ORCH-1163-R3 §6a — business/web shell inset is max(floor, measured floatWrap height)", () => {
  // The floatWrap is onLayout-measured and the shell inset takes the MAX of the
  // adapter floor and measured + 24 + 16 + safeAreaBottom.
  assertStringIncludes(foundationRsvp, "onFloatWrapLayout");
  assert(
    /onLayout=\{onFloatWrapLayout\}/.test(foundationRsvp),
    "the floatWrap must carry onLayout={onFloatWrapLayout}",
  );
  assert(
    /floatBarHeight \+ 24 \+ 16 \+ safeAreaBottom/.test(foundationRsvp),
    "measured inset must be floatBarHeight + 24 + 16 + safeAreaBottom",
  );
  assert(
    /Math\.max\(contentBottomInset, measuredBottomInset\)/.test(foundationRsvp),
    "the shell inset must be Math.max(contentBottomInset floor, measuredBottomInset)",
  );
  assertStringIncludes(foundationRsvp, "contentBottomInset={resolvedBottomInset}");
});

Deno.test("ORCH-1163-R3 §6b — consumer RSVP scroll paddingBottom is measured (floatBarBottom + measured + FLOAT_GAP)", () => {
  // The nativeFloatWrap onLayout stores the RSVP bar height; the scroll padding for
  // isRsvp is floatBarBottom + measuredBarHeight + FLOAT_GAP (event branch unchanged).
  assertStringIncludes(consumer, "setRsvpFloatBarHeight");
  assert(
    /rsvpFloatBarHeight > 0[\s\S]*?floatBarBottom \+ rsvpFloatBarHeight \+ FLOAT_GAP/.test(consumer),
    "rsvpBarClearance must be floatBarBottom + rsvpFloatBarHeight + FLOAT_GAP when measured",
  );
  assert(
    /scrollPaddingBottom = isRsvp \? rsvpBarClearance : reserveBarClearance/.test(consumer),
    "the scroll paddingBottom must branch isRsvp → rsvpBarClearance, else the event reserveBarClearance",
  );
  assert(
    /paddingBottom: scrollPaddingBottom/.test(consumer),
    "the BottomSheetScrollView contentContainerStyle must use scrollPaddingBottom",
  );
  // Event branch floor 177 is unchanged.
  assertStringIncludes(consumer, "const reserveBarClearance = 177 + insets.bottom");
});

// ── §6c — the business/web floor expression stays byte-identical to the event page ──
Deno.test("ORCH-1163-R3 §6c — RSVP shell inset FLOOR stays the event-parity expression", () => {
  // R2 contract preserved: the floor is FLOATING_BAR_CLEARANCE + insets.bottom (the
  // measured override in FoundationRsvpPreview does the real clearance work).
  const insetExpr = "contentBottomInset={isDesktop ? 0 : FLOATING_BAR_CLEARANCE + insets.bottom}";
  const count = publicEventPage.split(insetExpr).length - 1;
  assert(count >= 2, `event + RSVP bodies must both use the floor expr (found ${count})`);
});

// ── §7 — RSVP stays ticketless (no checkout affordance in the new surfaces) ──
Deno.test("ORCH-1163-R3 §7 — I-PROPOSED-1157-RSVP-NO-CHECKOUT-AFFORDANCE holds in the modal + body", () => {
  const forbidden = ["Reserve", "Get tickets", "Get Tickets", "/checkout", "/cart", "price", "Price"];
  for (const tok of forbidden) {
    assert(
      !modal.includes(tok),
      `the details modal must carry NO checkout affordance (found '${tok}')`,
    );
  }
  // The body adds no price/Reserve either (the §0-4 pills already exclude tickets-left).
  assert(!body.includes("Get tickets") && !body.includes("Reserve"), "the body must add no Reserve/Get-tickets affordance");
});
