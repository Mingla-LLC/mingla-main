// ORCH-1163-R2 [rsvp-shared-body / floating-parity] — regression (implementor-owned).
//
// The public RSVP page is now STRUCTURALLY IDENTICAL to the standard event page:
//   (1) FLOATING BAR — the Going/Maybe/Can't control is the separate
//       <RsvpOfferingFloatingBar> (parallel to <EventOfferingFloatingBar>), pinned
//       by the surface with zIndex:6 as a ParallaxCoverShell sibling EXACTLY like the
//       event `floatWrap`. This fixes the business-on-top / web-under layering (the
//       old RSVP dock had NO zIndex, so the web body's CONTENT_Z=2 stacking context
//       painted over it).
//   (2) SINGLE-OWNER INLINE BOX — the inline §5 decision is ONE <RsvpDecisionBox>
//       (parallel to <EventTicketBox>), rendered inline on phone AND in the desktop
//       sticky panel (hideDecisionBox on desktop like hideTicketBox). The inline box
//       + floating bar read ONE lifted useRsvpOfferingState.
//   (3) IDENTICAL SHELL/SCROLL/INSET — contentBottomInset is
//       `FLOATING_BAR_CLEARANCE + insets.bottom` on phone / 0 on desktop, byte-equal
//       to the event page on all three surfaces.
//
// Deno source-contract style (the established offering-rendering pattern). These
// assertions FAIL-ON-REVERT:
//   - drop zIndex:6 from the RSVP floatWrap → §1 fails.
//   - re-fork the inline box (delete RsvpDecisionBox) → §2 fails.
//   - revert the RSVP contentBottomInset to the bespoke spacing.xxl runway → §3 fails.
//   - swap the consumer RSVP float out of nativeFloatWrap → §4 fails.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const body = await read("../RsvpOfferingBody.tsx");
const barrel = await read("../index.ts");
const foundationRsvp = await read(
  "../../../mingla-business/src/components/event/FoundationRsvpPreview.tsx",
);
const publicEventPage = await read(
  "../../../mingla-business/src/components/event/PublicEventPage.tsx",
);
const consumer = await read(
  "../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
);

// Strip comments so prose that merely NAMES a token never satisfies an assertion.
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ── §1 — FLOATING BAR: zIndex:6 parity with the event floatWrap ──
Deno.test("ORCH-1163-R2 §1 — RSVP floating bar pinned with zIndex:6 (event floatWrap parity)", () => {
  const fnd = strip(foundationRsvp);
  // The surface exposes a `floatWrap` style with the event-identical positioning.
  assertStringIncludes(fnd, "floatWrap:");
  // It MUST carry zIndex:6 — the load-bearing layering fix (business-on-top /
  // web-under). A floatWrap block with bottom:24 + zIndex:6 (whitespace-tolerant).
  assert(
    /floatWrap:\s*\{[\s\S]*?bottom:\s*24[\s\S]*?zIndex:\s*6[\s\S]*?\}/.test(fnd),
    "FoundationRsvpPreview floatWrap must be { ... bottom:24 ... zIndex:6 } (event parity)",
  );
  // The OLD un-z-indexed full-width bottom dock panel is GONE.
  assert(
    !/floatingDock:/.test(fnd),
    "the old floatingDock (bottom:0, no zIndex) panel must be removed",
  );
  // The phone pins the shared floating bar inside that wrapper.
  assertStringIncludes(fnd, "styles.floatWrap");
  assertStringIncludes(fnd, "<RsvpOfferingFloatingBar");
});

// ── §1b — the event page floatWrap is the zIndex:6 reference (parity anchor) ──
Deno.test("ORCH-1163-R2 §1b — event page floatWrap is zIndex:6 (the parity reference)", () => {
  const evt = strip(publicEventPage);
  assert(
    /floatWrap:\s*\{[\s\S]*?zIndex:\s*6[\s\S]*?\}/.test(evt),
    "PublicEventPage floatWrap must be zIndex:6 (the RSVP bar mirrors this)",
  );
});

// ── §2 — SINGLE-OWNER inline box: RsvpDecisionBox (parallel to EventTicketBox) ──
Deno.test("ORCH-1163-R2 §2 — single-owner RsvpDecisionBox (inline + sticky panel, one instance)", () => {
  // The box is its OWN exported component (parallel to EventTicketBox).
  assertStringIncludes(body, "export const RsvpDecisionBox");
  assertStringIncludes(barrel, "RsvpDecisionBox");
  // It owns the contact form + per-guest forms + the shared decision + error node.
  assert(
    /RsvpDecisionBox[\s\S]*?state\.contactForm[\s\S]*?state\.guestForms[\s\S]*?DecisionUnit[\s\S]*?state\.errorNode/.test(
      body,
    ),
    "RsvpDecisionBox must host contactForm + guestForms + DecisionUnit + errorNode",
  );
  // The body honors hideDecisionBox (PARITY with EventOfferingBody.hideTicketBox) so
  // the inline box collapses on desktop and the surface renders the SAME box in the
  // sticky panel — exactly one instance paints.
  assertStringIncludes(body, "hideDecisionBox");
  assert(
    /hideDecisionBox\s*\?\s*null\s*:\s*\(/.test(body),
    "the body must collapse the inline box when hideDecisionBox is true",
  );
  // The surface renders the SAME RsvpDecisionBox in the desktop sticky panel AND
  // passes hideDecisionBox={isDesktop} to the body (the single-instance contract).
  const fnd = strip(foundationRsvp);
  assertStringIncludes(fnd, "<RsvpDecisionBox");
  assertStringIncludes(fnd, "hideDecisionBox={isDesktop}");
  assertStringIncludes(fnd, "deskPanel:");
});

// ── §2b — the decision LOGIC stays the single owner RsvpMomentumDecision ──
Deno.test("ORCH-1163-R2 §2b — RsvpMomentumDecision remains the single decision-logic owner", () => {
  // Both the inline box (showMomentum) and the floating bar (showMomentum={false})
  // route through the ONE DecisionUnit → RsvpMomentumDecision; no forked decision.
  assertStringIncludes(body, "RsvpMomentumDecision");
  assert(
    /RsvpOfferingFloatingBar[\s\S]*?<DecisionUnit[\s\S]*?showMomentum=\{false\}/.test(
      body,
    ),
    "RsvpOfferingFloatingBar must render the shared DecisionUnit (showMomentum={false})",
  );
  // The floating bar is the value RsvpOfferingDecisionDock aliases (back-compat).
  assertStringIncludes(body, "export const RsvpOfferingDecisionDock = RsvpOfferingFloatingBar");
});

// ── §3 — IDENTICAL inset: FLOATING_BAR_CLEARANCE + insets.bottom (phone) / 0 desktop ──
Deno.test("ORCH-1163-R2 §3 — RSVP contentBottomInset byte-matches the event page", () => {
  const evt = strip(publicEventPage);
  // The event-page clearance constant exists and the RSVP branch reuses the EXACT
  // same expression (phone: FLOATING_BAR_CLEARANCE + insets.bottom; desktop: 0).
  assertStringIncludes(evt, "FLOATING_BAR_CLEARANCE");
  const insetExpr = "contentBottomInset={isDesktop ? 0 : FLOATING_BAR_CLEARANCE + insets.bottom}";
  // It must appear at least TWICE — once for the event body, once for the RSVP body.
  const count = evt.split(insetExpr).length - 1;
  assert(
    count >= 2,
    `both the event body AND the RSVP body must use '${insetExpr}' (found ${count})`,
  );
  // The bespoke RSVP-only runway is GONE.
  assert(
    !/contentBottomInset=\{insets\.bottom \+ spacing\.xxl\}/.test(evt),
    "the bespoke RSVP `insets.bottom + spacing.xxl` runway must be removed",
  );
});

// ── §4 — consumer RSVP branch: same nativeFloatWrap (zIndex:60) as the event ──
Deno.test("ORCH-1163-R2 §4 — consumer RSVP floating bar shares the event nativeFloatWrap slot", () => {
  const con = strip(consumer);
  // The RSVP branch pins the shared RsvpOfferingFloatingBar in the SAME wrapper +
  // bottom math as the standard event branch — no bespoke rsvpStyles.dock panel.
  assertStringIncludes(con, "<RsvpOfferingFloatingBar");
  assert(
    /isRsvp\s*\?\s*\([\s\S]*?styles\.nativeFloatWrap[\s\S]*?bottom:\s*floatBarBottom[\s\S]*?<RsvpOfferingFloatingBar/.test(
      con,
    ),
    "the consumer RSVP branch must pin RsvpOfferingFloatingBar in styles.nativeFloatWrap { bottom: floatBarBottom }",
  );
  // nativeFloatWrap carries the consumer z-order (parity with the event float).
  assert(
    /nativeFloatWrap:\s*\{[\s\S]*?zIndex:\s*60[\s\S]*?\}/.test(con),
    "styles.nativeFloatWrap must keep zIndex:60 (shared by both branches)",
  );
  // The bespoke rsvpStyles.dock panel is removed.
  assert(
    !/rsvpStyles\.dock/.test(con),
    "the bespoke consumer rsvpStyles.dock must be removed (event-parity wrapper now)",
  );
});
