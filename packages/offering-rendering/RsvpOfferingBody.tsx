/**
 * RsvpOfferingBody — ORCH-1163 [rsvp-shared-body] · LEG 2 of META-ORCH-1166.
 *
 * THE ONE shared, shell-agnostic body for the public RSVP page (event_type='rsvp').
 * Rendered byte-identically on buyer-web + business iOS/Android + consumer iOS/
 * Android. Promotes the forked `RsvpPublicBody` (web/business) + the
 * `ConsumerEventDetailScreen` RSVP hand-mirror (consumer) into ONE component,
 * mirroring how ORCH-1167's `EventOfferingBody` did it for the standard event.
 *
 * SHELL-AGNOSTIC (SPEC §A.2, mandatory): this is a PURE CONTENT body. It hosts NO
 * scroll root and NO cover host — it MUST NOT wrap `ParallaxCoverShell` (that
 * re-triggers the consumer gorhom freeze). Each surface composes its own proven
 * scroll + parallax-cover scaffold AROUND this body and renders sections 2–8 as
 * CHILDREN inside its scroll container:
 *   • buyer-web + business native → inside ParallaxCoverShell (RN ScrollView).
 *   • consumer → inside BaseBottomSheet's gorhom BottomSheetScrollView.
 * The cover (section 1) is a pinned sibling the surface owns; the floating decision
 * dock (section 9) is exposed as <RsvpOfferingDecisionDock> for the surface to pin.
 *
 * Pure-presentational, props-only, NO app-src imports (I-MOR-0827-PACKAGE-ISOLATION).
 * Renders on react-native-web AND native RN.
 *
 * Canonical 9-section order (SPEC §0):
 *   1. Cover            (surface scaffold — pinned sibling, not here)
 *   2. Event Name       (bold title)
 *   3. Date & Time      (FULL-WIDTH solid-fill row — orch-1167-date-row parity)
 *   4. Pills row        (format → ALL vibes → ALL party-types → ALL music-genres;
 *                        NO tickets-left; party chips PROMOTED here from the momentum)
 *   5. DECISION BOX     (INLINE <RsvpDecisionBox> — parallel to EventTicketBox: the
 *                        Going/Maybe/Can't selector + contact + per-guest plus-one
 *                        mini-forms; rendered inline on phone AND in the desktop
 *                        sticky panel — ONE instance pattern, `hideDecisionBox` on
 *                        desktop exactly like EventTicketBox's `hideTicketBox`)
 *   6. Presented By     (brand card → onOpenBrand)
 *   7. About            (collapsible read-more/show-less)
 *   8. Where you'll be  (server-proxied static map; city-level when hidden)
 *   9. Floating button  (<RsvpOfferingFloatingBar> — a SEPARATE clean floating
 *                        segmented bar mirroring EventOfferingFloatingBar; the
 *                        surface pins it absolute-bottom with zIndex:6 as a sibling
 *                        of ParallaxCoverShell, exactly like the event floatWrap.
 *                        <RsvpOfferingDecisionDock> is retained as a back-compat
 *                        alias of the floating bar.)
 *
 * ORCH-1163-R2 [rsvp-shared-body / floating-parity] — the RSVP page is now made
 * STRUCTURALLY IDENTICAL to the standard event page (EventOfferingBody): the inline
 * decision is the single-owner <RsvpDecisionBox> (parallel to <EventTicketBox>),
 * and the floating control is the separate <RsvpOfferingFloatingBar> the surface
 * pins with zIndex:6 (parallel to <EventOfferingFloatingBar> + the floatWrap). Both
 * read ONE lifted decision state (useRsvpOfferingState) so the inline box + floating
 * bar never diverge. The decision LOGIC stays in RsvpMomentumDecision (single owner).
 */

import type RsvpGuestPartyBlockType from "./RsvpGuestPartyBlock";
import type { RsvpGuestTextInputComponent } from "./RsvpGuestPartyBlock";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  boldFontFamily,
  offeringSurfaceStyles,
  opaqueSurfaceColor,
  type ThemePalette,
} from "./themePalette";
import { Globe, MapPin } from "./LucideIcons";
import { OfferingFactRows, sameLine } from "./OfferingFactRows";
import {
  PresentedByFollowerCount,
  type FollowerCountLabels,
} from "./PresentedByFollowerCount";
// ORCH-1292 — resolve party/vibe/music slugs to canonical labels at the pills row.
import { taxonomyLabel } from "./taxonomyLabels";
import { resolveRsvpCta, type RsvpCtaState } from "./offeringCta";
// ORCH-1340 — the 1338 frozen avatar-sample entry type (avatarUrl only, no names).
import { type SocialProofSampleEntry } from "./socialProofTypes";
import { type PublicBrandProps, type PublicEventProps } from "./types";
import { type ResolvedTheme } from "./designTokens";
// #3372 — naira chip-in copy shows "₦", not "NGN" (#3341 rule).
import { withCurrencyGlyph } from "./currencyGlyph";
import {
  chipInRefusalFloorCents,
  chipInWholeUnitFloorCents,
} from "./chipInRefusal";
import { normalizeCityCountry } from "./normalizeCityCountry";
// issue #2468 — the ONE privacy gate + label composer for the venue card.
import {
  canOpenMapsTarget,
  selectVenueMapsTarget,
  type MapsAppId,
  type MapsOpenTarget,
} from "./mapsDeepLink";
// issue #2508 — the shared "which map app?" chooser + copy-address button, fed
// the ALREADY-gated target so an unrevealed RSVP address exposes neither.
import {
  MapsAppChooserDialog,
  useVenueMapsActions,
  VenueCopyAddressButton,
} from "./VenueMapsActions";
import { RsvpMomentumDecision } from "./RsvpMomentumDecision";
// Guest-facing copy that follows the event's real settings + the "what is still
// missing" hint shown next to a decision tap that could not go through.
import {
  buildRsvpValidationHint,
  rsvpAudienceMicrocopy,
  rsvpContactIssues,
  type RsvpContactFieldKey,
  type RsvpContactIssue,
} from "./rsvpGuestCopy";
// Type-only: the snapshot parser stays out of this shared (eager) chunk; only
// the web page that restores a reply pays for it.
import type { RsvpGuestSnapshot } from "./rsvpGuestSnapshot";
import type {
  RsvpFriendOption,
  RsvpGuestLookup,
  RsvpGuestLookupResult,
  RsvpGuestPayload,
  RsvpPartyGuest,
  RsvpSubmittedGuest,
} from "./rsvpGuestParty";
import type {
  RsvpAnonymousRecovery,
  RsvpConfirmationDetails,
  RsvpPassCredential,
  RsvpFormHandoffSlot,
} from "./RsvpSuccessPopup";
import type { ChipInPanelState } from "./RsvpChipInPanel";
import type { OfferingAddOnsSlot } from "./OfferingAddOnsBlock";
import { accentFill, accentIcon, themeFontFace } from "./themeAccentStyle";
import { StaticMapImage } from "./StaticMapFrame";
// issue #4518 — the brand photo takes the picture road (one fallback).
import { OfferingRoutedImage } from "./useOfferingImageUri";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s()-]{7,20}$/;
const ABOUT_COLLAPSE_THRESHOLD = 160;
export const rsvpErrorMessageForCode = (code: string): string => {
  if (code === "rsvp_event_ended")
    return "This event has ended. RSVPs are closed.";
  if (code === "rsvp_date_unavailable")
    return "RSVPs are unavailable right now. Try again later.";
  if (code.includes("rsvp_already_exists"))
    return "You've already RSVP'd with this email. Check that inbox for your RSVP.";
  if (code.includes("rsvp_full")) return "This event just filled up.";
  if (code.includes("rsvp_not_open")) return "RSVPs are closed for this event.";
  if (code.includes("form_changed"))
    return "The questions changed. Review your answers and try again.";
  if (code.includes("form_answers_required"))
    return "Answer the required questions to continue.";
  if (code.includes("form_answers_invalid"))
    return "Review your answers and try again.";
  if (code.includes("rsvp_guest_count_mismatch"))
    return "Re-check each guest's details.";
  if (
    code.includes("rsvp_guest_contact_required") ||
    code.includes("rsvp_contact_required")
  )
    return "Add your name, email and phone.";
  if (
    code.includes("rsvp_guest_phone_invalid") ||
    code.includes("rsvp_phone_invalid")
  )
    return "That phone number looks off.";
  return "Couldn't save your RSVP. Try again.";
};
/** #3380 — a signed-in guest whose account has no usable phone number. */
export const RSVP_ADD_ACCOUNT_PHONE_COPY =
  "Add your phone number to confirm your RSVP.";
/** #3380 — a phone was sent and the server still lacks contact: the email is missing. */
export const RSVP_ACCOUNT_EMAIL_MISSING_COPY =
  "Your account needs an email address to RSVP. Add one to your profile, then try again.";
const RsvpGoingConfirmDialog = React.lazy(
  () => import("./RsvpGoingConfirmDialog"),
);
const RsvpDetailsModal = React.lazy(() => import("./RsvpDetailsModal"));
const RsvpChipInPanel = React.lazy(() => import("./RsvpChipInPanel"));
const RsvpSuccessPopup = React.lazy(() => import("./RsvpSuccessPopup"));
// issue #4508 — the "Who's coming with you?" block only mounts once the host allows
// guests, so its code rides its own chunk instead of the eager boot payload.
// N-7: if that chunk fails to load (offline, a stale deploy) its slot reads
// "Couldn't load the guest section. Try again" and the rest of the RSVP still
// works; tapping it makes a fresh loader (`retry`).
const loadGuestBlock = (retry: () => void) =>
  React.lazy<typeof RsvpGuestPartyBlockType>(() =>
    import("./RsvpGuestPartyBlock").catch(() => ({
      default: (p: { palette: ThemePalette }) => (
        <Pressable
          style={[styles.guestSlot, offeringSurfaceStyles(p.palette).card]}
          onPress={retry}
          accessibilityRole="button"
        >
          <Text style={{ color: p.palette.secondaryText }}>
            Couldn't load the guest section. Try again
          </Text>
        </Pressable>
      ),
    })),
  );
// Only a refused submit needs the guest error lines, so they load on demand.
// issue #3281 S6 — the same on-demand module answers RSVP add-on refusals.
const guestErrorLine = (code: string): Promise<string | null> =>
  import("./rsvpAddOnErrors").then(
    (m) => m.rsvpRefusalLine(code),
    () => null,
  );

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface RsvpOfferingConfig {
  capacity: number | null;
  /**
   * Real confirmed-going headcount. issue #3827 going-box — `null` = withheld
   * (private list) or not known yet; never coerced to 0 for any decision.
   */
  goingCount: number | null;
  /** issue #3827 going-box — guests on the host's own list (going number only). */
  extraGuestCount?: number;
  /** issue #3827 going-box — the server's full flag (real count only). */
  capacityFull?: boolean;
  allowPlusOnes: boolean;
  plusOnesMax: number;
  waitlistEnabled: boolean;
  manualApproval: boolean;
  doorsOpenLabel?: string | null;
  doorsCloseLabel?: string | null;
  // ORCH-1291 [rsvp-chip-in] — voluntary contribution config (all optional so
  // free RSVPs are unaffected; the chip-in panel renders only when enabled).
  rsvp_contribution_enabled?: boolean;
  rsvp_contribution_suggested_cents?: number | null;
  rsvp_contribution_min_cents?: number | null;
  /** Brand settlement currency for the chip-in Intl formatting (GBP/USD/NGN…).
   *  issue #1014: may be null — a chip-in-enabled event always has a
   *  resolvable settlement currency (publish forces it), so null means the
   *  chip-in panel stays hidden (defense) instead of formatting in a
   *  fabricated USD. */
  settlementCurrency?: string | null;
  /** Brand display name for the "Chip in for {host}" copy (fallback "the host"). */
  hostShortName?: string;
  // ORCH-1339 [momentum-card-cross-entity] — the two D2 display gates
  // (SERVER-authoritative; both default-absent = false so existing surfaces are
  // unaffected until they thread the payload values).
  /** Suppress the whole guest cluster block (disks + see-who's-going) (D2). */
  privateGuestList?: boolean;
  /** Hide scarcity: null DISPLAY capacity → "Open invite" + fixed low meter (D2). */
  hideRemainingCount?: boolean;
  // ORCH-1340 [card-real-avatars] — the avatar sample + affordance seam.
  /** Server-filtered avatar sample (1338 frozen shape — no names can ride it).
   * Photos fill the leading cluster disks; absent/[] keeps the glyph cluster. */
  guestSample?: ReadonlyArray<SocialProofSampleEntry>;
  /** Present ⇒ the momentum cluster gains its "See who's going" affordance
   * (ORCH-1341/1342 wire handlers). Absent ⇒ inert cluster, no dead tap. */
  onSeeWhosGoing?: () => void;
  /**
   * events.visibility + events.rsvp_discoverable. Drive the line under the
   * decision buttons so a public, feed-listed event no longer tells guests
   * "Anyone with the link can RSVP." Absent ⇒ the link-only line (the only
   * claim that is true without knowing the setting).
   */
  visibility?: "public" | "unlisted" | "private" | null;
  discoverable?: boolean | null;
}

// ORCH-1291 — the payment hand-off contract (DESIGN §1.3). The body is
// payment-SDK-agnostic (I-MOR-0827); the surface handler opens the native
// PaymentSheet / Paystack browser (→ "paid") or navigates to a hosted page
// (→ "redirecting"). It throws Error(code) on failure; the body maps code → copy.
export type ChipInResult = { kind: "paid" } | { kind: "redirecting" };

// ORCH-1295 [chip-in-post-payment-polish] — BUG 2: country-code-aware phone.
// This package is host-agnostic (I-MOR-0827): the phone-with-country-picker
// widget (@mingla/phone-input) is HOST-SUPPLIED (it needs the host's icon set +
// i18n labels), so the SURFACE injects it via this render-prop. The COUNTRY +
// LOCAL-DIGITS state is lifted into useRsvpOfferingState (single owner) so the
// injected field stays fully controlled and never diverges across the two
// contact-form mounts (inline body + floating-bar details modal). The surface
// owns E.164 composition and passes the composed value back. When the prop is
// absent (native surfaces today) the body renders the existing plain phone
// field — ZERO regression.
import type {
  RsvpPhoneFieldRenderArgs,
  RsvpPhoneFieldRenderer,
  RsvpPlainFieldProps,
} from "./rsvpPhoneFieldTypes";
export type { RsvpPhoneFieldRenderArgs, RsvpPhoneFieldRenderer };

/**
 * Pre-#4508 guest shape (name + email + phone). Kept exported for callers that
 * still type it; the form now sends RsvpGuestPayload (number only).
 */
export interface RsvpGuestContact {
  name: string;
  email: string;
  phone: string;
  phoneCountryIso?: string | null;
}

export interface RsvpSubmitResult {
  status: "going" | "not_going" | "waitlisted" | "maybe";
  approvalStatus: "pending" | "approved";
  rsvpId: string;
  confirmationToken: string | null;
  acknowledgement?:
    "accepted" | "pending_approval" | "waitlisted" | "maybe" | "not_going";
  credentials?: RsvpPassCredential[];
  anonymousRecovery?: RsvpAnonymousRecovery[];
  claim?: { shortUrl: string | null; code?: string | null } | null;
  /** issue #4508 — each guest with its invite link (public-submit-rsvp `guests[]`). */
  guests?: RsvpSubmittedGuest[];
  /** issue #3281 S6 — the add-ons stored with this RSVP (public-submit-rsvp `rsvpAddOns`). */
  rsvpAddOns?: ReadonlyArray<{ name: string; quantity: number }>;
}

export interface RsvpOfferingBodyProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  isLoggedIn: boolean;
  /** Actual auth identity, not a boolean: account A and B are different owners. */
  replyIdentity?: string | null;
  recoveryNotice?: string | null;
  initialGuestName?: string;
  initialGuestEmail?: string;
  initialGuestPhone?: string;
  /** Explorer requires complete email+phone snapshots even when authenticated. */
  requirePrimaryContact?: boolean;
  /**
   * #3380 — whether the signed-in viewer's account already has a phone number
   * (the server fills name, email and phone from the account and refuses the
   * RSVP when the phone is missing). `false` ⇒ the guest is asked for a phone
   * (inline and in the Going confirm step) before anything is sent. `true`,
   * `null` or absent ⇒ nothing is asked up front; if the server still answers
   * `rsvp_contact_required`, the phone field is revealed then. Ignored for
   * anonymous guests and when `requirePrimaryContact` is set.
   */
  accountPhoneOnFile?: boolean | null;
  onDownloadPass?: (
    credential: RsvpPassCredential,
    recovery: RsvpAnonymousRecovery | null,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  /** Public buyer web uses claim; Explorer keeps its signed-in QR pass. */
  passPresentation?: "qr" | "claim";
  onOpenClaim?: (url: string | null) => void;
  renderClaimBody?: () => React.ReactNode;
  onSubmit: (input: {
    rsvpStatus: "going" | "not_going" | "maybe";
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    guestPhoneCountryIso?: string | null;
    plusCount: number;
    /** issue #4508 — number-only guests (`{ phone, phoneCountryIso }`). */
    guests: RsvpGuestPayload[];
  }) => Promise<RsvpSubmitResult>;
  /** #4541 — host-rendered brand-form questions, kept out of this package's app imports. */
  questionsNode?: React.ReactNode;
  /**
   * #4541 R1.3 — host-rendered "After they RSVP" hand-off, drawn in the success
   * popup (RsvpSuccessPopup `formHandoff`). Absent: no block.
   */
  formHandoff?: RsvpFormHandoffSlot;
  /** Only required_step blocks Going/Maybe. Optional questions are still shown. */
  questionsRequired?: boolean;
  /** True once every currently visible required question has an answer. */
  questionsReady?: boolean;
  /**
   * issue #3281 S6 — the host-rendered RSVP add-on picker, given the party size
   * (the guest plus their plus-ones). Drawn after the questions, above the
   * decision, and in the details sheet. Absent: no picker.
   */
  addOnsNode?: (partySize: number) => React.ReactNode;
  /** issue #3281 S6 — false while the guest's add-on picks don't fit their party. */
  addOnsReady?: boolean;
  /** issue #3281 S2 — "Add at checkout:" on the RSVP card; null or absent shows none. */
  addOns?: OfferingAddOnsSlot | null;
  /** issue #3281 S2 — the RSVP reader's `rsvpAddOns` for that list. */
  rsvpAddOns?: unknown;
  /**
   * issue #4508 1.2a — the live match under the guest number field (the
   * surface calls public-submit-rsvp `guest_lookup`). Throws Error(code) on
   * failure. Absent ⇒ no lookup: a valid number previews as not on Mingla.
   */
  guestLookup?: RsvpGuestLookup;
  /**
   * issue #4508 R2 — the surface's text input for the guest section's search
   * field. Explorer passes its bottom-sheet-aware input so the keyboard never
   * covers the field; absent ⇒ react-native's TextInput (Host, buyer web).
   */
  guestInputComponent?: RsvpGuestTextInputComponent;
  /**
   * issue #4508 T1 — "Get the app" on the signed-out "Bring someone" card:
   * the surface's app download / deep link for this event. Absent ⇒ the card
   * shows no button.
   */
  onGetApp?: () => void;
  /**
   * issue #4508 1.4 — the signed-in inviter's friends (get_user_circle).
   * Absent ⇒ no "Or from your friends" section (signed out, or a surface that
   * does not offer it).
   */
  guestFriends?: ReadonlyArray<RsvpFriendOption>;
  guestFriendsLoading?: boolean;
  guestFriendsError?: string | null;
  onRetryGuestFriends?: () => void;
  /**
   * issue #4508 1.15 / 1.24 — copy a ready-made message. Absent on native ⇒ no
   * Copy button there (web copies through the clipboard API itself).
   */
  onCopyText?: (text: string) => void | Promise<void>;
  /**
   * issue #4508 1.15 — share a ready-made message. Absent ⇒ the system share
   * sheet on native and navigator.share (clipboard fallback) on web.
   */
  onShareText?: (text: string) => void | Promise<void>;
  onOpenBrand?: (brandSlug: string) => void;
  /**
   * #3682 Follow contract (a) — optional Follow control rendered as a sibling of
   * the Presented-by identity pressable (never nested inside it). Hosts pass a
   * Follow control ReactNode so this package stays free of a brand↔offering
   * import cycle. Absent ⇒ identity-only card (today).
   */
  presentedByFollow?: React.ReactNode;
  /** #3682 — server count for the Presented-by card; unavailable stays hidden. */
  presentedByFollowerCount?: number | null;
  presentedByFollowerCountLoading?: boolean;
  presentedByFollowerCountLabels?: FollowerCountLabels;
  /** issue #2468 — carries the stored coordinate, not just the text label.
   *  issue #2508 — plus the app the guest picked (undefined ⇒ nothing asked). */
  onOpenMaps?: (target: MapsOpenTarget, app?: MapsAppId) => void;
  /** issue #2508 — copies the gated address text. Absent ⇒ no copy button. */
  onCopyAddress?: (text: string) => void | Promise<void>;
  /** Server-proxied static map URL (city-level when address hidden); null → no map. */
  staticMapUrl?: string | null;
  contentBottomInset?: number;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (event: LayoutChangeEvent) => void;
  safeAreaTop?: number;
  safeAreaBottom?: number;
  /**
   * ORCH-1163-R2 — desktop two-column reflow (PARITY with EventOfferingBody's
   * `hideTicketBox`). When true (web ≥ DESKTOP_BREAKPOINT) the inline §5 decision
   * box is relocated to the STICKY right panel by the surface (which renders the
   * SAME <RsvpDecisionBox> there), so the in-body section 5 collapses to nothing
   * here — exactly one decision-box instance paints. Phones + both native apps
   * keep the inline box (false). The `orch-1163-rsvp-inline-box` anchor stays in
   * source for the canonical-order gate.
   */
  hideDecisionBox?: boolean;
  /**
   * #4508 round 9 — the address a pass holder sees (a claimed guest's pass
   * row). Present ⇒ it replaces "Address shared after you RSVP".
   */
  passHolderAddress?: string | null;
  /**
   * issue #4420 — true when the surface prints the title on its cover (the
   * premium ParallaxCoverShell frame). Absent ⇒ false (Explorer).
   */
  identityOnCover?: boolean;
  /**
   * issue #4420 — the "when" fact's Add to calendar action. The surface
   * passes it ONLY when the public data carries a real start AND end
   * (offeringCalendarEntry); absent ⇒ no action.
   */
  onAddToCalendar?: () => void;
  // ORCH-1291 [rsvp-chip-in] — the surface's payment hand-off for a voluntary
  // gift. Absent → the chip-in panel never renders (feature dark on that
  // surface). Present + config.rsvp_contribution_enabled + a going guest → the
  // panel appears in the success popup + the inline §5.5 section.
  onChipIn?: (input: { amountCents: number }) => Promise<ChipInResult>;
  /**
   * ORCH-1291 — lets a WEB return (contribution=paid) or the business preview
   * drive the terminal chip-in state without a callback round-trip. Default
   * 'idle'. When 'paid', both mounts render the thank-you.
   */
  contributionState?: "idle" | "paid";
  /**
   * ORCH-1295 [chip-in-post-payment-polish] — BUG 2: the surface's country-code-
   * aware phone field. Absent → the plain phone text field renders (native
   * fallback, zero regression). Present → it replaces the phone field in the
   * guest contact form; the hook owns the country + local-digits state.
   */
  renderPhoneField?: RsvpPhoneFieldRenderer;
  /** ISO 3166-1 alpha-2 seed for the phone picker's initial country. */
  defaultPhoneCountry?: string;
  onAcquisitionClosed?: (kind: "ended" | "unavailable") => void;
  /**
   * Scrolls the page so `node` (a contact field, or the wrapper of an injected
   * phone field) is on screen. Called when a Going / Maybe / Can't go tap could
   * not go through because details are missing. The surface owns the scroll
   * view, so it owns the scroll. Absent on web ⇒ the body scrolls the DOM node
   * itself; absent on native ⇒ the floating bar keeps its details modal.
   */
  onRevealField?: (node: unknown) => void;
  /**
   * An anonymous guest's own reply restored after a full-page round trip (the
   * chip-in payment redirect). Seeds the resolved state so the page shows
   * "You're going" and the pass instead of a fresh invite. Setting it back to
   * null (the host could not verify it) returns the page to the invite.
   */
  restoredRsvp?: RsvpGuestSnapshot | null;
  /** Called with the reply the server just accepted, for the host to keep. */
  onRsvpResolved?: (snapshot: RsvpGuestSnapshot) => void;
  /**
   * #3416 D1 — while the host could not confirm a restored pass (network error),
   * re-checks it. Present ⇒ "Try again" sits where "View your pass" would.
   */
  onRecoveryRetry?: (() => void) | null;
  testID?: string;
}

/** The reveal/focus handles for one contact field (a TextInput or a wrapper View). */
type RsvpFieldHandle = {
  focus?: (options?: { preventScroll?: boolean }) => void;
  querySelector?: (
    selector: string,
  ) => { focus?: (options?: { preventScroll?: boolean }) => void } | null;
  scrollIntoView?: (options?: { block?: string; behavior?: string }) => void;
};

// ───────────────────────────────────────────────────────────────────────────
// Shared state machine. The body owns submit/contact/guests/dialog state and
// exposes the decision dock node for the surface to pin (section 9).
// ───────────────────────────────────────────────────────────────────────────

interface RsvpDecisionState {
  surface: ReturnType<typeof offeringSurfaceStyles>;
  boldFamily: string;
  ctaState: RsvpCtaState;
  /** issue #3827 going-box — server full flag (or the legacy compute). */
  capacityFull: boolean;
  guestStatus: "going" | "not_going" | "waitlisted" | "maybe" | null;
  guestApproval: "pending" | "approved" | null;
  submitting: boolean;
  contactReady: boolean;
  decisionReady: boolean;
  plusCount: number;
  errorNode: React.ReactNode;
  subcopy: string | null;
  onGoingTap: () => void;
  onMaybe: () => void;
  onNotGoing: () => void;
  // ORCH-1163-R3 — floating-bar entry handlers. Distinct from the inline handlers:
  // when contact details are NOT yet ready, these open the self-sufficient details
  // modal (asking name/email/phone + per-guest +1 forms) instead of surfacing a
  // dead error, then dispatch the pending decision on Continue. When details ARE
  // ready, they fall straight through to the inline behavior (confirm/submit).
  onFloatingGoing: () => void;
  onFloatingMaybe: () => void;
  onFloatingNotGoing: () => void;
  /** "Add your name and email above to RSVP." after a blocked tap; else null. */
  validationHint: string | null;
  /** "View your pass" for a going guest whose pass is known; else null. */
  passAction: { label: string; onPress: () => void; testID?: string } | null;
  /** #3416 D1 — "Try again" while a restored pass could not be confirmed; else null. */
  recoveryAction: {
    label: string;
    onPress: () => void;
    testID?: string;
  } | null;
  /** #3416 FINDING-1 — a signed-in guest's existing reply is not known yet: no live decision. */
  replyLocked: boolean;
  /** The INLINE decision block, so the surface can hide the floating copy while it is on screen. */
  inlineDecisionRef: React.RefObject<View | null>;
  floatingDecisionRef: React.RefObject<View | null>;
  recoveryHint: boolean;
  /** A decision tap was blocked by missing details (the hint is showing). */
  decisionAttempted: boolean;
}

export interface RsvpOfferingState extends RsvpDecisionState {
  contactForm: React.ReactNode;
  guestForms: React.ReactNode;
  questionsNode: React.ReactNode;
  /** issue #3281 S6 — the RSVP add-on picker (null when the surface has none). */
  addOnsNode: React.ReactNode;
  confirmDialog: React.ReactNode;
  successPopup: React.ReactNode;
  // ORCH-1163-R3 — the floating-bar details modal (portal <Modal>, gorhom-safe).
  // Rendered ONCE in RsvpOfferingBody next to confirmDialog/successPopup.
  detailsModal: React.ReactNode;
  // ORCH-1291 [rsvp-chip-in] — the inline §5.5 chip-in panel node (gated on a
  // GOING guest + config-enabled + onChipIn present; null otherwise). The
  // success-popup mount is injected directly into successPopup above (both read
  // the ONE lifted chip-in state slice).
  chipInInlinePanel: React.ReactNode;
}

/**
 * #3440 F3 — reply state (reply, approval, pass, open pass popup) that only
 * renders for the reply context (event + identity) that wrote it.
 *
 * A context switch still resets these values during render, but that reset is
 * a set of queued state updates, and React can replay an older queued update
 * over it (observed: switching events while the old event's verification was
 * still pending painted event A's "You're going" and pass on event B). Tagging
 * each value with its writer makes a value written for another context
 * unrenderable, whatever the update queue does: it reads as `unowned` (the
 * current context's own restored value, or nothing) instead.
 */
function useReplyOwnedState<T>(
  contextRef: { readonly current: object },
  context: object,
  unowned: T,
): [T, (next: T) => void] {
  const [slot, setSlot] = useState<{ owner: object; value: T }>(() => ({
    owner: context,
    value: unowned,
  }));
  const set = useCallback(
    (next: T): void => {
      // The writer is the context current when the write happens; every async
      // writer in this hook is already fenced by isCurrent().
      setSlot({ owner: contextRef.current, value: next });
    },
    [contextRef],
  );
  return [slot.owner === context ? slot.value : unowned, set];
}

/**
 * The single source of RSVP decision/submit/dialog state. The SURFACE calls this
 * ONCE and passes the result to BOTH <RsvpOfferingBody> and
 * <RsvpOfferingDecisionDock> so the inline box and the pinned floating dock share
 * one state machine (no duplicate writes). Shell-agnostic: it holds no scroll/cover.
 */
export const useRsvpOfferingState = (
  props: RsvpOfferingBodyProps,
): RsvpOfferingState => {
  const { event, brand, palette, theme, config, isLoggedIn, onSubmit } = props;
  const { onChipIn, contributionState } = props;
  // ORCH-1295 [chip-in-post-payment-polish] — BUG 2 phone injection (see prop docs).
  const { renderPhoneField, defaultPhoneCountry } = props;
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);
  const boldFace = themeFontFace(boldFamily);

  const contextKey = JSON.stringify([
    event.id,
    props.replyIdentity ?? null,
    isLoggedIn,
  ]);
  const contextRef = useRef({ key: contextKey, eventId: event.id });
  if (contextRef.current.key !== contextKey)
    contextRef.current = { key: contextKey, eventId: event.id };
  const context = contextRef.current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    () => mounted.current && contextRef.current === context,
    [context],
  );
  // #3416 FINDING-1 — for a signed-in viewer a recovery notice means their own
  // reply is still being read from the server (or that read failed). Until it is
  // known nothing may submit: a re-submit would reset an approved guest.
  const replyLocked = isLoggedIn && props.recoveryNotice != null;
  const focusDecisionRequested = useRef(false);
  const acceptedRevision = useRef(0);

  const [guestName, setGuestName] = useState(props.initialGuestName ?? "");
  const [guestEmail, setGuestEmail] = useState(props.initialGuestEmail ?? "");
  // `guestPhone` remains the single submitted value (a composed E.164 when the
  // country picker is injected, else the raw text the guest typed).
  const [guestPhone, setGuestPhone] = useState(props.initialGuestPhone ?? "");
  // Explorer can finish resolving the signed-in profile after this shared hook
  // mounts. Adopt those canonical values only while the guest has not typed a
  // replacement; once the three fields are complete the completion form folds
  // away and the existing RSVP shape remains unchanged.
  useEffect(() => {
    setGuestName(
      (current: string) => current.trim() || props.initialGuestName || "",
    );
  }, [props.initialGuestName]);
  useEffect(() => {
    setGuestEmail(
      (current: string) => current.trim() || props.initialGuestEmail || "",
    );
  }, [props.initialGuestEmail]);
  useEffect(() => {
    setGuestPhone(
      (current: string) => current.trim() || props.initialGuestPhone || "",
    );
  }, [props.initialGuestPhone]);
  // ORCH-1295 — country + local-digits state for the injected picker (unused when
  // renderPhoneField is absent). Lifted here so the field stays controlled across
  // BOTH contact-form mounts (inline body + details modal) without divergence.
  const [phoneCountry, setPhoneCountry] = useState<string | null>(
    defaultPhoneCountry ?? null,
  );
  const [phoneRawValue, setPhoneRawValue] = useState(
    props.initialGuestPhone ?? "",
  );
  // issue #4508 — the people the inviter is bringing (number or friend), the
  // guest number draft (country + raw digits + composed E.164), its live
  // lookup, and the friends search text. One owner for both form mounts.
  const [guests, setGuests] = useState<RsvpPartyGuest[]>([]);
  const [guestNumberCountry, setGuestNumberCountry] = useState<string | null>(
    defaultPhoneCountry ?? null,
  );
  const [guestNumberRaw, setGuestNumberRaw] = useState("");
  const [guestNumberE164, setGuestNumberE164] = useState("");
  const [guestLookupState, setGuestLookupState] = useState<
    | { phone: string; state: "checking" }
    | { phone: string; state: "done"; result: RsvpGuestLookupResult }
    | { phone: string; state: "failed"; code?: string }
    | null
  >(null);
  const [guestLookupNonce, setGuestLookupNonce] = useState(0);
  // N-7: bumped by "Try again" when the guest block's chunk failed to load.
  const [guestBlockTry, setGuestBlockTry] = useState(0);
  const RsvpGuestPartyBlock = useMemo(
    () => loadGuestBlock(() => setGuestBlockTry((n: number) => n + 1)),
    [guestBlockTry],
  );
  const [friendQuery, setFriendQuery] = useState("");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [primaryPhoneTouched, setPrimaryPhoneTouched] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // issue #3827 going-box — the server refused a reply because the event is
  // full (`rsvp_full`). Some reads carry no full flag (an unlisted private
  // RSVP), so the page learns it here and switches into the full state: Going
  // disabled and a "Full" chip, never a tap that refuses again.
  const [serverSaidFull, setServerSaidFull] = useState(false);
  // #3380 — the server refused a signed-in reply for a missing (or unusable)
  // account phone, so the phone field is now shown even though the surface did
  // not know up front.
  const [serverAskedPhone, setServerAskedPhone] = useState(false);
  // An anonymous guest's reply restored after the chip-in redirect seeds the
  // resolved state, so the returning page shows their reply, not a fresh invite.
  const restoredRsvp = props.restoredRsvp ?? null;
  const [guestStatus, setGuestStatus] = useReplyOwnedState<
    "going" | "not_going" | "waitlisted" | "maybe" | null
  >(contextRef, context, restoredRsvp?.guestStatus ?? null);
  const [guestApproval, setGuestApproval] = useReplyOwnedState<
    "pending" | "approved" | null
  >(contextRef, context, restoredRsvp?.guestApproval ?? null);
  // The last confirmed Going details (pass QR + recovery), kept after the
  // success popup closes so "View your pass" can reopen it.
  const [passDetails, setPassDetails] =
    useReplyOwnedState<RsvpConfirmationDetails | null>(
      contextRef,
      context,
      restoredRsvp?.details ?? null,
    );
  const currentPassRef = useRef(passDetails);
  currentPassRef.current = passDetails;
  // True while the resolved state on screen came from `restoredRsvp` and the
  // guest has not replied again since.
  const stateFromRestoreRef = useRef(restoredRsvp !== null);
  useLayoutEffect(() => {
    if (restoredRsvp !== null) {
      if (stateFromRestoreRef.current || guestStatus === null) {
        setGuestStatus(restoredRsvp.guestStatus);
        setGuestApproval(restoredRsvp.guestApproval);
        setPassDetails(restoredRsvp.details);
        stateFromRestoreRef.current = true;
      }
      return;
    }
    if (stateFromRestoreRef.current) {
      // The host could not verify the restored reply: back to the invite.
      setGuestStatus(null);
      setGuestApproval(null);
      setPassDetails(null);
      // Only the still-restored reply owns this popup; a new accepted reply
      // flips the flag before any older verification can reach this effect.
      focusDecisionRequested.current = successDetails !== null;
      setSuccessDetails(null);
      stateFromRestoreRef.current = false;
    }
    // Only a change of the restored snapshot itself re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredRsvp]);

  // FLOW A — Going confirmation dialog + success popup state (body-owned).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [successDetails, setSuccessDetails] =
    useReplyOwnedState<RsvpConfirmationDetails | null>(
      contextRef,
      context,
      null,
    );
  const [successClaim, setSuccessClaim] = useReplyOwnedState<{
    email: string | null;
    phoneLast4: string | null;
    shortUrl: string | null;
  } | null>(contextRef, context, null);
  const visiblePassRef = useRef(successDetails);
  // The pass popup the last render showed, read before this render replaces it.
  const lastVisiblePass = visiblePassRef.current;
  visiblePassRef.current = successDetails;
  const downloadPass = useCallback(
    async (
      credential: RsvpPassCredential,
      recovery: RsvpAnonymousRecovery | null,
    ): Promise<void> => {
      const ownsPass = () =>
        isCurrent() &&
        successDetails !== null &&
        visiblePassRef.current === successDetails;
      if (ownsPass())
        await props.onDownloadPass?.(credential, recovery, ownsPass);
    },
    [isCurrent, successDetails, props.onDownloadPass],
  );

  // ORCH-1163-R3 — floating-bar details modal. The floating bar has no form host,
  // so when a guest taps a floating decision with no contact details, we open this
  // modal (which re-hosts the SAME contactForm/guestForms nodes — shared state, so
  // values sync with the inline §5 box), then dispatch the pending decision on
  // Continue. `pendingDecision` is the decision awaiting its details.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<
    "going" | "maybe" | "not_going" | null
  >(null);
  // ── ORCH-1291 [rsvp-chip-in] — voluntary contribution state slice (lifted so
  // the success-popup mount + the inline §5.5 mount never diverge/double-charge). ──
  // issue #1014 — NULL passthrough, no fabricated USD: when neither the config
  // nor the event resolves a currency the chip-in feature is forced OFF below
  // (chipFeatureOn) and the panel builder returns null.
  const chipCurrency: string | null =
    config.settlementCurrency ?? event.currency ?? null;
  const chipMinCents = config.rsvp_contribution_min_cents ?? null;
  const chipSuggestedCents = config.rsvp_contribution_suggested_cents ?? null;
  const chipDefaultAmount = ((): number => {
    const preselect =
      chipSuggestedCents ??
      ((chipCurrency || "").toUpperCase() === "NGN" ? 2500 * 100 : 10 * 100);
    return chipMinCents !== null
      ? Math.max(preselect, chipMinCents)
      : preselect;
  })();
  const [chipAmountCents, setChipAmountCents] =
    useState<number>(chipDefaultAmount);
  const [chipInState, setChipInState] = useState<ChipInPanelState>(
    contributionState === "paid" ? "success" : "idle",
  );
  const [chipError, setChipError] = useState<string | null>(null);
  // #3645 — a floor the server named that is above the host minimum (the
  // payment provider's minimum charge). Once known, it is checked here and
  // shown as the panel's minimum.
  const [chipServerFloorCents, setChipServerFloorCents] = useState<
    number | null
  >(null);
  const chipEffectiveMinCents: number | null =
    chipServerFloorCents !== null &&
    (chipMinCents === null || chipServerFloorCents > chipMinCents)
      ? chipServerFloorCents
      : chipMinCents;
  const [renderedContext, setRenderedContext] = useState(context);
  if (renderedContext !== context) {
    acceptedRevision.current += 1;
    // Adjust before children commit: old credentials never paint in the new
    // event/account, even when a surface reuses the mounted hook.
    // Whether the context being left had its pass popup open (the value this
    // render sees for the NEW context is already unowned).
    focusDecisionRequested.current =
      renderedContext.eventId === event.id && lastVisiblePass !== null;
    setRenderedContext(context);
    setGuestName(props.initialGuestName ?? "");
    setGuestEmail(props.initialGuestEmail ?? "");
    setGuestPhone(props.initialGuestPhone ?? "");
    setPhoneRawValue(props.initialGuestPhone ?? "");
    setPhoneCountry(defaultPhoneCountry ?? null);
    setGuests([]);
    setGuestNumberCountry(defaultPhoneCountry ?? null);
    setGuestNumberRaw("");
    setGuestNumberE164("");
    setGuestLookupState(null);
    setFriendQuery("");
    setShowValidationErrors(false);
    setPrimaryPhoneTouched(false);
    setSubmitting(false);
    setErrorMsg(null);
    setServerAskedPhone(false);
    setGuestStatus(restoredRsvp?.guestStatus ?? null);
    setGuestApproval(restoredRsvp?.guestApproval ?? null);
    setPassDetails(restoredRsvp?.details ?? null);
    stateFromRestoreRef.current = restoredRsvp !== null;
    setConfirmOpen(false);
    setConfirmError(null);
    setSuccessDetails(null);
    setDetailsOpen(false);
    setPendingDecision(null);
    setChipAmountCents(chipDefaultAmount);
    setChipInState("idle");
    setChipError(null);
    // #3645 — a floor learned on another event (maybe another currency)
    // never carries over.
    setChipServerFloorCents(null);
  }
  const handleAcquisitionError = useCallback(
    (code: string): boolean => {
      const kind =
        code === "rsvp_event_ended"
          ? "ended"
          : code === "rsvp_date_unavailable"
            ? "unavailable"
            : null;
      if (kind === null) return false;
      setConfirmOpen(false);
      setDetailsOpen(false);
      setPendingDecision(null);
      setSuccessDetails(null);
      setChipInState("idle");
      setChipError(null);
      setSubmitting(false);
      props.onAcquisitionClosed?.(kind);
      return true;
    },
    [props.onAcquisitionClosed],
  );

  // issue #3827 going-box (R-5) — the server's real-count flag wins; the
  // legacy compute is for older servers only. A withheld (null) count with no
  // flag is NOT full here; the server still enforces capacity at submit.
  const capacityFull =
    serverSaidFull ||
    (config.capacityFull ??
      (config.capacity !== null &&
        config.goingCount !== null &&
        config.goingCount >= config.capacity));

  const ctaState: RsvpCtaState = useMemo(
    () =>
      resolveRsvpCta({
        capacityFull,
        waitlistEnabled: config.waitlistEnabled,
        manualApproval: config.manualApproval,
        guestStatus,
        guestApproval,
      }).state,
    [
      capacityFull,
      config.waitlistEnabled,
      config.manualApproval,
      guestStatus,
      guestApproval,
    ],
  );

  const primaryContactComplete =
    guestName.trim().length > 0 &&
    EMAIL_RE.test(guestEmail.trim()) &&
    PHONE_RE.test(guestPhone.trim());
  // #3380 — a signed-in guest whose account has no phone must add one (the
  // server fills name and email from the account, but refuses without a phone).
  // Only for the account-filled path: anonymous guests and Explorer's
  // `requirePrimaryContact` path already ask for every field.
  const accountFilledContact =
    isLoggedIn && props.requirePrimaryContact !== true;
  const signedInPhoneNeeded =
    accountFilledContact &&
    (props.accountPhoneOnFile === false || serverAskedPhone);
  const signedInPhoneReady = PHONE_RE.test(guestPhone.trim());
  const primaryValid =
    (accountFilledContact && (!signedInPhoneNeeded || signedInPhoneReady)) ||
    primaryContactComplete;
  const plusCount = config.allowPlusOnes ? guests.length : 0;
  // issue #4508 — every person in the party was checked when added (a valid
  // number or a friend), so the party itself is always ready to send.
  const guestsValid = true;
  // A4-NEW (extended §H.6): primary + every plus-one must be reachable.
  const contactReady = primaryValid && guestsValid;
  const questionsRequired = props.questionsRequired === true;
  const questionsReady = !questionsRequired || props.questionsReady === true;
  // issue #3281 S6 — the add-on picks are their own readiness term, last.
  const addOnsReady = props.addOnsReady !== false;
  const decisionReady = contactReady && questionsReady && addOnsReady;

  const mapErrorCode = useCallback(rsvpErrorMessageForCode, []);

  const venueLineForPopup = useMemo(() => {
    const city =
      normalizeCityCountry(event.address) ??
      normalizeCityCountry(event.venueName) ??
      null;
    if (event.format === "online") return "Online event";
    if (!event.hideAddressUntilTicket && event.venueName !== null) {
      return [event.venueName, event.address].filter(Boolean).join(", ");
    }
    return event.venueName ?? city ?? "Location shared on RSVP";
  }, [
    event.address,
    event.format,
    event.hideAddressUntilTicket,
    event.venueName,
  ]);

  const reportResolved = useCallback(
    (
      result: RsvpSubmitResult,
      details: RsvpConfirmationDetails | null,
    ): void => {
      if (!isCurrent()) return;
      props.onRsvpResolved?.({
        version: 1,
        eventId: event.id,
        rsvpId: result.rsvpId,
        guestStatus: result.status,
        guestApproval: result.approvalStatus,
        details,
        savedAtMs: Date.now(),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event.id, props.onRsvpResolved, isCurrent],
  );

  const runSubmit = useCallback(
    async (
      rsvpStatus: "going" | "not_going" | "maybe",
    ): Promise<RsvpSubmitResult | null> => {
      if (!isCurrent() || replyLocked) return null;
      const submittedGuests = rsvpStatus === "not_going" ? [] : guests;
      const result = await onSubmit({
        rsvpStatus,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim(),
        guestPhone: guestPhone.trim(),
        guestPhoneCountryIso: guestPhone.trim() ? phoneCountry : null,
        plusCount: rsvpStatus === "not_going" ? 0 : plusCount,
        // #4508 round 8: each guest carries its payload (set when added).
        guests: config.allowPlusOnes ? submittedGuests.map((g) => g.payload) : [],
      });
      if (!isCurrent()) return null;
      stateFromRestoreRef.current = false;
      acceptedRevision.current += 1;
      setGuestStatus(result.status);
      setGuestApproval(result.approvalStatus);
      if (result.status !== "going") {
        setPassDetails(null);
        setSuccessDetails(null);
        setSuccessClaim(null);
      }
      return result;
    },
    [
      guests,
      config.allowPlusOnes,
      onSubmit,
      guestName,
      guestEmail,
      guestPhone,
      phoneCountry,
      plusCount,
      isCurrent,
      replyLocked,
    ],
  );

  // #3380 — the server refused a signed-in (account-filled) reply because the
  // account has no usable phone. Show the phone field from now on and return the
  // copy for it; null for every other code and for anonymous guests (unchanged).
  const askForAccountPhone = useCallback(
    (code: string): string | null => {
      if (!accountFilledContact) return null;
      if (code !== "rsvp_contact_required" && code !== "rsvp_phone_invalid")
        return null;
      setServerAskedPhone(true);
      setPrimaryPhoneTouched(true);
      const sentPhone = guestPhone.trim().length > 0;
      if (!sentPhone) return RSVP_ADD_ACCOUNT_PHONE_COPY;
      return code === "rsvp_contact_required"
        ? RSVP_ACCOUNT_EMAIL_MISSING_COPY
        : rsvpErrorMessageForCode(code);
    },
    [accountFilledContact, guestPhone],
  );

  // ── what is still missing, in on-screen order (primary, then each +1) ──
  const primaryNameRef = useRef<TextInput | null>(null);
  const primaryEmailRef = useRef<TextInput | null>(null);
  // A TextInput, or the wrapper View around a host-injected phone field.
  const primaryPhoneRef = useRef<TextInput | View | null>(null);
  const inlineDecisionRef = useRef<View | null>(null);
  const floatingDecisionRef = useRef<View | null>(null);
  useEffect(() => {
    if (!focusDecisionRequested.current) return;
    focusDecisionRequested.current = false;
    // A mounted floating control is the surface's visible shortcut. Otherwise
    // use the existing inline/desktop owner, never an input or removed pass CTA.
    const node = floatingDecisionRef.current ?? inlineDecisionRef.current;
    if (node === null) return;
    if (Platform.OS === "web") {
      const element = node as unknown as {
        setAttribute?: (key: string, value: string) => void;
        focus?: (options: { preventScroll: boolean }) => void;
      };
      element.setAttribute?.("tabindex", "-1");
      element.focus?.({ preventScroll: true });
    } else {
      const tag = findNodeHandle(node);
      if (tag !== null) AccessibilityInfo.setAccessibilityFocus?.(tag);
    }
  });
  const contactIssues: RsvpContactIssue[] = useMemo(() => {
    const issues = rsvpContactIssues({
      primary: { name: guestName, email: guestEmail, phone: guestPhone },
      primaryRequired: !(isLoggedIn && props.requirePrimaryContact !== true),
      // issue #4508 — guests carry no fields to finish.
      guests: [],
      emailPattern: EMAIL_RE,
      phonePattern: PHONE_RE,
    });
    // #3380 — the account fills name and email; only the phone is asked for.
    if (signedInPhoneNeeded && !signedInPhoneReady) {
      issues.unshift({
        guestIndex: null,
        field: "phone",
        problem: guestPhone.trim().length === 0 ? "missing" : "invalid",
      });
    }
    if (renderPhoneField === undefined) return issues;
    // The injected phone field only reports a composed number once it is valid,
    // so "typed something that is not a number yet" must read as invalid.
    return issues.map((issue) => {
      if (issue.field !== "phone" || issue.problem !== "missing") return issue;
      const raw = issue.guestIndex === null ? phoneRawValue : "";
      return raw.trim().length > 0
        ? { ...issue, problem: "invalid" as const }
        : issue;
    });
  }, [
    guestName,
    guestEmail,
    guestPhone,
    isLoggedIn,
    props.requirePrimaryContact,
    renderPhoneField,
    phoneRawValue,
    signedInPhoneNeeded,
    signedInPhoneReady,
  ]);
  const validationHint = showValidationErrors && !contactReady
    ? buildRsvpValidationHint(contactIssues)
    : showValidationErrors && !questionsReady
      ? "Answer the required questions to continue."
      : showValidationErrors && !addOnsReady
        ? "Pick fewer add-ons to continue."
        : (props.recoveryNotice ?? null);
  const recoveryHint =
    validationHint !== null && validationHint === props.recoveryNotice;
  useEffect(() => {
    if (Platform.OS !== "web" && recoveryHint && validationHint !== null) {
      AccessibilityInfo.announceForAccessibility?.(validationHint);
    }
  }, [recoveryHint, validationHint]);
  // Web can always scroll the DOM itself; native needs the surface's scroll view.
  const canRevealFields =
    Platform.OS === "web" || props.onRevealField !== undefined;

  // Bring the first unfinished field on screen and put the cursor in it. The
  // hint stays next to the tapped control, so the guest sees both.
  const revealFirstIssue = useCallback((): void => {
    const first = contactIssues[0];
    if (first === undefined) return;
    const target =
      first.guestIndex === null
        ? first.field === "name"
          ? primaryNameRef.current
          : first.field === "email"
            ? primaryEmailRef.current
            : primaryPhoneRef.current
        : null;
    if (target === null || target === undefined) return;
    // RN TextInput / View refs (and, on web, the DOM element behind them).
    const handle = target as unknown as RsvpFieldHandle;
    try {
      // Focus synchronously inside the tap so mobile Safari opens the keyboard.
      // On web a wrapper View is a <div> (which also has .focus()), so reach
      // the <input> inside it rather than focusing the unfocusable wrapper.
      const tagName = (target as unknown as { tagName?: unknown }).tagName;
      const isWebWrapper =
        Platform.OS === "web" &&
        typeof handle.querySelector === "function" &&
        tagName !== "INPUT" &&
        tagName !== "TEXTAREA";
      if (isWebWrapper) {
        handle.querySelector?.("input")?.focus?.({ preventScroll: true });
      } else if (typeof handle.focus === "function") {
        handle.focus(
          Platform.OS === "web" ? { preventScroll: true } : undefined,
        );
      }
    } catch {
      // Focus is a nicety; the scroll + hint below still guide the guest.
    }
    if (props.onRevealField !== undefined) {
      props.onRevealField(handle);
    } else if (
      Platform.OS === "web" &&
      typeof handle.scrollIntoView === "function"
    ) {
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
          true;
      handle.scrollIntoView({
        block: "center",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
    if (Platform.OS !== "web") {
      const hint = buildRsvpValidationHint(contactIssues);
      if (hint !== null) AccessibilityInfo?.announceForAccessibility?.(hint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactIssues, props.onRevealField]);

  // Maybe / Not-going → record DIRECTLY (no dialog).
  const submitDirect = useCallback(
    async (rsvpStatus: "not_going" | "maybe"): Promise<void> => {
      if (submitting || !isCurrent()) return;
      if (
        (rsvpStatus === "maybe" && !decisionReady) ||
        // #3380 — the server refuses every status without an account phone.
        (signedInPhoneNeeded && !signedInPhoneReady)
      ) {
        // The hint beside the tapped control replaces the old error line that
        // rendered far below the fields (and under the floating bar).
        setShowValidationErrors(true);
        setErrorMsg(null);
        if (!contactReady) revealFirstIssue();
        return;
      }
      setErrorMsg(null);
      setSubmitting(true);
      try {
        const result = await runSubmit(rsvpStatus);
        if (result !== null) reportResolved(result, null);
      } catch (err) {
        if (!isCurrent()) return;
        const code = err instanceof Error ? err.message : String(err);
        handleAcquisitionError(code);
        if (code.includes("rsvp_full")) setServerSaidFull(true);
        const guestLine = await guestErrorLine(code);
        if (!isCurrent()) return;
        setErrorMsg(
          guestLine ?? askForAccountPhone(code) ?? mapErrorCode(code),
        );
      } finally {
        if (isCurrent()) setSubmitting(false);
      }
    },
    [
      submitting,
      contactReady,
      decisionReady,
      signedInPhoneNeeded,
      signedInPhoneReady,
      askForAccountPhone,
      runSubmit,
      mapErrorCode,
      handleAcquisitionError,
      revealFirstIssue,
      reportResolved,
      isCurrent,
    ],
  );

  // Going → open the confirmation dialog (when contactReady); else surface errors.
  const onGoingTap = useCallback((): void => {
    if (submitting || !isCurrent() || replyLocked) return;
    if (!decisionReady) {
      // #3380 — a signed-in guest who only lacks a phone is asked for it inside
      // the confirm step (the dialog shows the phone field).
      const phoneAskedInConfirm =
        !contactReady && signedInPhoneNeeded && guestsValid && questionsReady &&
        addOnsReady;
      if (!phoneAskedInConfirm) {
        setShowValidationErrors(true);
        setErrorMsg(null);
        if (!contactReady) revealFirstIssue();
        return;
      }
    }
    setErrorMsg(null);
    setConfirmError(null);
    setConfirmOpen(true);
  }, [
    submitting,
    contactReady,
    decisionReady,
    questionsReady,
    addOnsReady,
    signedInPhoneNeeded,
    guestsValid,
    revealFirstIssue,
    isCurrent,
    replyLocked,
  ]);

  // ── ORCH-1163-R3 — floating-bar entry handlers ──
  // The floating bar forces contactReady=true on its DecisionUnit so the buttons
  // are never disabled into a dead end; readiness is enforced HERE instead. If the
  // guest already has details (inline box / a prior modal), fall straight through
  // to the inline behavior; otherwise open the self-sufficient details modal with
  // the decision pinned, to dispatch once the contact + +1 forms are filled.
  const onFloatingGoing = useCallback((): void => {
    if (submitting || !isCurrent()) return;
    if (decisionReady) {
      onGoingTap();
      return;
    }
    if (contactReady && (!questionsReady || !addOnsReady)) {
      setShowValidationErrors(true);
      setErrorMsg(null);
      setPendingDecision("going");
      setDetailsOpen(true);
      return;
    }
    if (signedInPhoneNeeded && guestsValid) {
      // #3380 — only the account phone is missing: the confirm step asks for it.
      onGoingTap();
      return;
    }
    if (canRevealFields) {
      // Missing details on web / a surface that can scroll: the same guidance as
      // the inline tap (scroll to the first unfinished field + the hint beside
      // this control). The details modal below stays for surfaces that cannot.
      onGoingTap();
      return;
    }
    setErrorMsg(null);
    setPendingDecision("going");
    setDetailsOpen(true);
  }, [
    submitting,
    contactReady,
    decisionReady,
    questionsReady,
    addOnsReady,
    signedInPhoneNeeded,
    guestsValid,
    canRevealFields,
    onGoingTap,
    isCurrent,
  ]);

  const onFloatingMaybe = useCallback((): void => {
    if (submitting || !isCurrent()) return;
    if (decisionReady) {
      void submitDirect("maybe");
      return;
    }
    if (contactReady && (!questionsReady || !addOnsReady)) {
      setShowValidationErrors(true);
      setErrorMsg(null);
      setPendingDecision("maybe");
      setDetailsOpen(true);
      return;
    }
    if (canRevealFields) {
      void submitDirect("maybe");
      return;
    }
    setErrorMsg(null);
    setPendingDecision("maybe");
    setDetailsOpen(true);
  }, [
    submitting,
    contactReady,
    decisionReady,
    questionsReady,
    addOnsReady,
    canRevealFields,
    submitDirect,
    isCurrent,
  ]);

  const onFloatingNotGoing = useCallback((): void => {
    if (submitting || !isCurrent()) return;
    // Can't-go needs no +1s and no contact gate for a logged-in guest. Anon guests
    // still need a reachable identity so the host can attribute the decline.
    if (isLoggedIn || contactReady) {
      void submitDirect("not_going");
      return;
    }
    if (canRevealFields) {
      setShowValidationErrors(true);
      setErrorMsg(null);
      revealFirstIssue();
      return;
    }
    setErrorMsg(null);
    setPendingDecision("not_going");
    setDetailsOpen(true);
  }, [
    submitting,
    isLoggedIn,
    contactReady,
    canRevealFields,
    submitDirect,
    revealFirstIssue,
    isCurrent,
  ]);

  // Continue inside the details modal — dispatch the pinned decision. Disabled in
  // the UI until contactReady, so values are valid here.
  const closeDetails = useCallback((): void => {
    if (!isCurrent()) return;
    setDetailsOpen(false);
    setPendingDecision(null);
  }, [isCurrent]);
  const onDetailsContinue = useCallback((): void => {
    if (
      (pendingDecision !== "not_going" && !decisionReady) || !isCurrent()
    ) return;
    const decision = pendingDecision;
    setDetailsOpen(false);
    setPendingDecision(null);
    if (decision === "going") {
      setErrorMsg(null);
      setConfirmError(null);
      setConfirmOpen(true);
    } else if (decision === "maybe") {
      void submitDirect("maybe");
    } else if (decision === "not_going") {
      void submitDirect("not_going");
    }
  }, [decisionReady, pendingDecision, submitDirect, isCurrent]);

  const onConfirmGoing = useCallback(async (): Promise<void> => {
    if (submitting || !isCurrent()) return;
    if (signedInPhoneNeeded && !signedInPhoneReady) {
      // #3380 — nothing is sent until the phone the dialog asks for is usable.
      setPrimaryPhoneTouched(true);
      setConfirmError(
        guestPhone.trim().length === 0 && phoneRawValue.trim().length === 0
          ? RSVP_ADD_ACCOUNT_PHONE_COPY
          : "Enter a valid phone number.",
      );
      return;
    }
    setSubmitting(true);
    setConfirmError(null);
    try {
      const result = await runSubmit("going");
      if (result === null || !isCurrent()) return;
      setConfirmOpen(false);
      const details: RsvpConfirmationDetails = {
        eventName: event.name,
        dateLine: event.dateLine,
        venueLine: venueLineForPopup,
        guestName: isLoggedIn
          ? guestName.trim() || "You"
          : guestName.trim() || guestEmail.trim() || "Guest",
        status:
          result.status === "waitlisted"
            ? "waitlisted"
            : result.approvalStatus === "pending"
              ? "pending"
              : "going",
        plusGuests: guests.map((g) => ({ name: g.label })),
        addOns: result.rsvpAddOns,
        confirmationToken: result.confirmationToken,
        credentials: result.credentials ?? [],
        anonymousRecovery: result.anonymousRecovery ?? [],
        invites: result.guests ?? [],
        // issue #4508 1.15 — city-level only, so pasted text never leaks a
        // hidden address; the server supplies each guest's own invite URL.
        inviteMessage: {
          eventName: event.name,
          dateLine: event.dateLine,
          area:
            event.format === "online"
              ? null
              : (normalizeCityCountry(event.address) ??
                normalizeCityCountry(event.venueName) ??
                null),
          online: event.format === "online",
        },
      };
      setSuccessDetails(details);
      const phoneDigits = guestPhone.replace(/\D/g, "");
      setSuccessClaim({
        email: guestEmail.trim() || props.initialGuestEmail?.trim() || null,
        phoneLast4: phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null,
        shortUrl: result.claim?.shortUrl ?? null,
      });
      setPassDetails(details);
      reportResolved(result, details);
    } catch (err) {
      if (!isCurrent()) return;
      const code = err instanceof Error ? err.message : String(err);
      handleAcquisitionError(code);
      if (code.includes("rsvp_full")) setServerSaidFull(true);
      const guestLine = await guestErrorLine(code);
      if (!isCurrent()) return;
      setConfirmError(
        guestLine ?? askForAccountPhone(code) ?? mapErrorCode(code),
      );
    } finally {
      if (isCurrent()) setSubmitting(false);
    }
  }, [
    submitting,
    signedInPhoneNeeded,
    signedInPhoneReady,
    guestPhone,
    phoneRawValue,
    askForAccountPhone,
    runSubmit,
    event.name,
    event.dateLine,
    venueLineForPopup,
    isLoggedIn,
    guestName,
    guestEmail,
    guests,
    event.format,
    event.address,
    event.venueName,
    mapErrorCode,
    handleAcquisitionError,
    reportResolved,
    isCurrent,
  ]);

  // ── ORCH-1291 — server-code → gift-framed copy (DESIGN §4.7). ──
  const fmtChipWhole = useCallback(
    (cents: number): string => {
      try {
        return withCurrencyGlyph(
          new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: chipCurrency || "USD",
            maximumFractionDigits: 0,
          }).format(cents / 100),
          chipCurrency,
        );
      } catch {
        return `${Math.round(cents / 100)} ${chipCurrency}`;
      }
    },
    [chipCurrency],
  );

  const runChipIn = useCallback(async (): Promise<void> => {
    if (onChipIn == null || !isCurrent()) return;
    if (chipInState === "submitting") return;
    if (chipAmountCents <= 0) {
      setChipError("Enter an amount to chip in.");
      setChipInState("error");
      return;
    }
    if (chipEffectiveMinCents !== null && chipAmountCents < chipEffectiveMinCents) {
      setChipError(
        `Add at least ${fmtChipWhole(chipInWholeUnitFloorCents(chipEffectiveMinCents))}.`,
      );
      setChipInState("error");
      return;
    }
    setChipInState("submitting");
    setChipError(null);
    try {
      const result = await onChipIn({ amountCents: chipAmountCents });
      if (!isCurrent()) return;
      // "redirecting" → the surface is navigating to a hosted page; HOLD
      // submitting until it leaves (on return the surface passes
      // contributionState='paid'). "paid" → native sheet / paystack verified.
      if (result.kind === "paid") {
        setChipInState("success");
      }
    } catch (err) {
      if (!isCurrent()) return;
      const code = err instanceof Error ? err.message : String(err);
      if (code.includes("brand_cannot_collect")) {
        setChipInState("paused");
        setChipError(null);
      } else if (code.includes("amount_below_min")) {
        // #3645 — name the server's floor (the provider minimum can be above
        // the host's), and remember it so the next tap is checked here.
        const floor = chipInRefusalFloorCents(err, chipMinCents);
        if (floor !== null && (chipMinCents === null || floor > chipMinCents)) {
          setChipServerFloorCents(floor);
        }
        setChipError(
          floor !== null
            ? `Add at least ${fmtChipWhole(chipInWholeUnitFloorCents(floor))}.`
            : "Add a little more.",
        );
        setChipInState("error");
      } else if (code.includes("amount_invalid")) {
        setChipError("Enter an amount to chip in.");
        setChipInState("error");
      } else {
        setChipError("Couldn't process that. Try again.");
        setChipInState("error");
      }
    }
  }, [
    onChipIn,
    chipInState,
    chipAmountCents,
    chipMinCents,
    chipEffectiveMinCents,
    fmtChipWhole,
    isCurrent,
  ]);

  // ── resolved-state subcopy (carried verbatim from RsvpPublicBody) ──
  const goingResolved = guestStatus === "going" && guestApproval === "approved";
  const pendingResolved = guestApproval === "pending";
  const notGoingResolved = guestStatus === "not_going";
  const waitlistedResolved = guestStatus === "waitlisted";
  const maybeResolved = guestStatus === "maybe";

  const subcopy: string | null = pendingResolved
    ? "The host reviews each RSVP — we'll notify you the moment you're approved."
    : waitlistedResolved
      ? "A spot opened? We'll text and email you automatically."
      : goingResolved
        ? "You're in — we'll let you know if anything about the event changes."
        : maybeResolved
          ? "You're marked as Maybe — we'll keep you posted. Switch to Going anytime."
          : notGoingResolved
            ? "Changed your mind? You can switch to Going."
            : ctaState === "full"
              ? config.waitlistEnabled
                ? "Join the waitlist and we'll move you in if a spot opens."
                : "The guest list is full for now."
              : rsvpAudienceMicrocopy({
                  visibility: config.visibility,
                  discoverable: config.discoverable,
                  manualApproval: config.manualApproval,
                });

  // The reply is still open (not resolved, not a closed full list).
  const contactFormOpenState =
    !goingResolved &&
    !pendingResolved &&
    !waitlistedResolved &&
    !maybeResolved &&
    !(ctaState === "full" && !config.waitlistEnabled);
  const showContactForm =
    (!isLoggedIn ||
      (props.requirePrimaryContact === true && !primaryContactComplete)) &&
    contactFormOpenState;

  // A contact field's error state. Blank: marked once a decision tap was blocked
  // (a name that is only spaces is marked at once); filled: marked when it fails
  // its pattern (a name has none).
  const fieldError = (
    value: string,
    pattern: RegExp | null,
    blankMsg: string,
    badMsg: string,
  ) =>
    value.trim().length === 0
      ? {
          invalid:
            showValidationErrors || (pattern === null && value.length > 0),
          invalidMsg: blankMsg,
        }
      : {
          invalid: pattern !== null && !pattern.test(value.trim()),
          invalidMsg: badMsg,
        };
  // The primary phone field. "inline" is the contact card (it owns the reveal
  // ref and the historical testIDs); "confirm" (#3380) is the same controlled
  // field re-hosted in the Going confirm dialog for a signed-in guest whose
  // account has no phone — shared state, so both mounts always agree.
  const renderPrimaryPhoneField = (
    placement: "inline" | "confirm",
  ): React.ReactNode => {
    const inline = placement === "inline";
    // #3380 — when the confirm dialog's own error line already says "Add your
    // phone number to confirm your RSVP.", the field under it does not repeat
    // "Add your phone number": one message, not two.
    const dialogAsksForPhone =
      !inline && confirmError === RSVP_ADD_ACCOUNT_PHONE_COPY;
    const phoneBlankError = fieldError(
      guestPhone,
      PHONE_RE,
      "Add your phone number",
      "Enter a valid phone number",
    );
    return renderPhoneField ? (
      // The injected field exposes no ref; this wrapper is what a blocked
      // decision tap scrolls to (and, on web, focuses the input inside).
      <View
        {...(inline
          ? { ref: primaryPhoneRef as React.RefObject<View | null> }
          : {})}
        collapsable={false}
      >
        {renderPhoneField({
          countryCode: phoneCountry,
          rawValue: phoneRawValue,
          role: "primary",
          guestId: null,
          index: null,
          label: "Phone",
          testID: inline
            ? "issue-1857-rsvp-primary-phone"
            : "issue-3380-rsvp-confirm-phone",
          onChangeCountry: (isoCode, composedE164) => {
            setPhoneCountry(isoCode);
            setGuestPhone(composedE164 ?? "");
          },
          onChangeRawValue: (raw, composedE164) => {
            setPhoneRawValue(raw);
            setGuestPhone(composedE164 ?? "");
          },
          invalid:
            phoneRawValue.trim().length > 0 &&
            !PHONE_RE.test(guestPhone.trim()),
          palette,
          disabled: submitting,
          required: true,
          emptyRequired: (showValidationErrors || primaryPhoneTouched) &&
            phoneRawValue.trim().length === 0 &&
            !dialogAsksForPhone,
          onBlur: () => setPrimaryPhoneTouched(true),
        })}
      </View>
    ) : (
      <RsvpField
        {...(inline
          ? { ref: primaryPhoneRef as unknown as React.Ref<TextInput> }
          : {})}
        label="Phone"
        value={guestPhone}
        onChangeText={setGuestPhone}
        placeholder="+1 555 123 4567"
        palette={palette}
        {...(dialogAsksForPhone && guestPhone.trim().length === 0
          ? { ...phoneBlankError, invalid: false }
          : phoneBlankError)}
        keyboardType="phone-pad"
        autoCapitalize="none"
        testID={
          inline
            ? "orch-1150-rsvp-phone"
            : "issue-3380-rsvp-confirm-phone-plain"
        }
      />
    );
  };

  // #3380 — a signed-in guest whose account has no phone: name and email come
  // from the account, so only the phone is asked for.
  const signedInPhoneForm =
    !showContactForm && signedInPhoneNeeded && contactFormOpenState ? (
      <View
        style={[styles.formCard, surface.card]}
        testID="issue-3380-rsvp-account-phone"
      >
        <Text style={[styles.formMicro, surface.tertiaryText]}>
          {`Add a phone number so ${brand?.displayName?.trim() || "the host"} can reach you about this event. Your name and email come from your account.`}
        </Text>
        {renderPrimaryPhoneField("inline")}
      </View>
    ) : null;
  const contactForm = showContactForm ? (
    <View
      style={[styles.formCard, surface.card]}
      testID="orch-1157-rsvp-contact"
    >
      <Text style={[styles.formMicro, surface.tertiaryText]}>
        {isLoggedIn
          ? `We'll use this for your RSVP, and you'll follow ${brand?.displayName?.trim() || "this brand"} for new dates. Unfollow anytime.`
          : guests.length > 0
            ? "We'll email and text each of you a link to your pass."
            : "We'll email and text you a link to your pass."}
      </Text>
      <RsvpField
        ref={primaryNameRef}
        label="Your name"
        value={guestName}
        onChangeText={setGuestName}
        placeholder="First and last name"
        palette={palette}
        {...fieldError(guestName, null, "Add your name", "")}
        autoCapitalize="words"
        testID="orch-1150-rsvp-name"
        disabled={submitting}
      />
      <RsvpField
        ref={primaryEmailRef}
        label="Email"
        value={guestEmail}
        onChangeText={setGuestEmail}
        placeholder="you@email.com"
        palette={palette}
        {...fieldError(
          guestEmail,
          EMAIL_RE,
          "Add your email",
          "Enter a valid email",
        )}
        keyboardType="email-address"
        autoCapitalize="none"
        testID="orch-1150-rsvp-email"
        disabled={submitting}
      />
      {/* ORCH-1295 [chip-in-post-payment-polish] — BUG 2: the surface may inject a
          country-code-aware phone field (@mingla/phone-input). Absent → the plain
          text field (native fallback, unchanged). */}
      {renderPrimaryPhoneField("inline")}
    </View>
  ) : (
    signedInPhoneForm
  );

  // ── issue #4508 "Who's coming with you?" (replaces the per-guest stepper and
  // name / email / phone mini-forms). ──
  const showGuestStepper =
    config.allowPlusOnes &&
    config.plusOnesMax > 0 &&
    !goingResolved &&
    !pendingResolved &&
    !waitlistedResolved &&
    !maybeResolved &&
    !(ctaState === "full" && !config.waitlistEnabled);

  // The inviter's own number(s): a guest number equal to one is refused
  // before any lookup (1.3, live-case item 17). The server re-checks.

  // 1.2d — the lookup runs only on a complete valid number, debounced, and its
  // answer only ever applies to the number it was asked about.
  const guestLookup = props.guestLookup;
  const lookupSeq = useRef(0);
  useEffect(() => {
    const phone = guestNumberE164.trim();
    // A complete E.164 number (the guest model's isCompleteE164 rule).
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone) || guestLookup === undefined) {
      lookupSeq.current += 1;
      setGuestLookupState(null);
      return;
    }
    const seq = ++lookupSeq.current;
    setGuestLookupState({ phone, state: "checking" });
    const timer = setTimeout(() => {
      guestLookup(phone).then(
        (result: RsvpGuestLookupResult) => {
          if (seq === lookupSeq.current && isCurrent())
            setGuestLookupState({ phone, state: "done", result });
        },
        (e: Error) => {
          // R1: the code (e.g. rate_limited) picks the preview's words.
          if (seq === lookupSeq.current && isCurrent())
            setGuestLookupState({ phone, state: "failed", code: e?.message });
        },
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [guestNumberE164, guestLookup, guestLookupNonce, isCurrent]);

  // The number preview, add / remove handlers, number field and friends section
  // live in the lazily loaded guest block (RsvpGuestPartyBlock.tsx); this body
  // keeps only the state, the debounced lookup above and the submit payload.
  const guestForms = showGuestStepper ? (
    // N-7: the slot holds the section's height while the block loads.
    <Suspense fallback={<View style={[styles.guestSlot, surface.card]} />}>
      <RsvpGuestPartyBlock
        // issue #4508 T1 — signed out: the "Bring someone" card, never the
        // guest form (a plus-one needs a signed-in account).
        signedOut={!isLoggedIn}
        onGetApp={props.onGetApp}
        palette={palette}
        boldFamily={boldFamily}
        max={config.plusOnesMax}
        party={guests}
        setParty={setGuests}
        disabled={submitting}
        numberCountry={guestNumberCountry}
        setNumberCountry={setGuestNumberCountry}
        numberRaw={guestNumberRaw}
        setNumberRaw={setGuestNumberRaw}
        numberE164={guestNumberE164}
        setNumberE164={setGuestNumberE164}
        lookupState={guestLookupState}
        setLookupState={setGuestLookupState}
        lookupEnabled={guestLookup !== undefined}
        onRetryLookup={() => setGuestLookupNonce((n: number) => n + 1)}
        ownPhones={[guestPhone, props.initialGuestPhone ?? ""]}
        friendQuery={friendQuery}
        setFriendQuery={setFriendQuery}
        friendList={isLoggedIn ? props.guestFriends : undefined}
        friendsLoading={props.guestFriendsLoading === true}
        friendsError={props.guestFriendsError ?? null}
        onRetryFriends={props.onRetryGuestFriends ?? null}
        renderPhoneField={renderPhoneField}
        PlainField={RsvpField}
        inputComponent={props.guestInputComponent}
        testID="orch-1163-rsvp-guests"
      />
    </Suspense>
  ) : null;

  const errorNode =
    errorMsg !== null ? (
      <Text style={styles.errorText} testID="orch-1150-rsvp-error">
        {errorMsg}
      </Text>
    ) : null;

  const confirmDialog = (
    <Suspense fallback={null}>
      <RsvpGoingConfirmDialog
        visible={confirmOpen}
        palette={palette}
        theme={theme}
        brandDisplayName={brand?.displayName ?? "the host"}
        eventName={event.name.length > 0 ? event.name : "this event"}
        dateLine={event.dateLine}
        plusGuests={guests.map((g) => ({ name: g.label }))}
        guestRows={guests.map((g) => ({
          key: g.key,
          label: g.label,
          line: g.confirmLine,
        }))}
        submitting={submitting}
        errorText={confirmError}
        // #3380 — a signed-in guest with no account phone adds it right here.
        contactSlot={
          signedInPhoneNeeded ? (
            <View testID="issue-3380-rsvp-confirm-phone-slot">
              <Text style={[styles.formMicro, surface.tertiaryText]}>
                {`Add a phone number so ${brand?.displayName?.trim() || "the host"} can reach you about this event.`}
              </Text>
              {renderPrimaryPhoneField("confirm")}
            </View>
          ) : null
        }
        onConfirm={() => void onConfirmGoing()}
        onCancel={() => {
          if (isCurrent()) setConfirmOpen(false);
        }}
      />
    </Suspense>
  );

  // ── ORCH-1291 [rsvp-chip-in] — build the chip-in panel node (both mounts read
  // this ONE lifted slice). Eligible ⇔ config-enabled AND the surface wired a
  // payment hand-off. ──
  const chipHostName = config.hostShortName ?? brand?.name ?? "the host";
  // issue #1014 — chipCurrency !== null: an unresolvable settlement currency
  // hides the panel entirely (never format money in a fabricated currency).
  const chipFeatureOn =
    config.rsvp_contribution_enabled === true &&
    onChipIn != null &&
    chipCurrency !== null;
  const clearChipError = (): void => {
    if (chipInState === "error") {
      setChipInState("idle");
      setChipError(null);
    }
  };
  const buildChipPanel = (mountTestID: string): React.ReactNode => {
    // issue #1014 defense — unreachable when chipFeatureOn gates the mounts,
    // but the builder itself never renders money without a real currency.
    if (chipCurrency === null) return null;
    return (
      <Suspense fallback={null}>
        <RsvpChipInPanel
          palette={palette}
          theme={theme}
          currency={chipCurrency}
          hostShortName={chipHostName}
          suggestedCents={chipSuggestedCents}
          minCents={
            chipEffectiveMinCents === null
              ? null
              : chipInWholeUnitFloorCents(chipEffectiveMinCents)
          }
          state={chipInState}
          amountCents={chipAmountCents}
          onAmountChange={(c) => {
            setChipAmountCents(c);
            clearChipError();
          }}
          onPreset={(c) => {
            setChipAmountCents(c);
            clearChipError();
          }}
          onSubmit={() => void runChipIn()}
          errorText={chipError}
          isWeb={Platform.OS === "web"}
          testID={mountTestID}
        />
      </Suspense>
    );
  };

  // SC-2 gate (Seth-locked): the popup mount shows chip-in ONLY for a going /
  // pending-approval guest — NOT waitlisted (capacity-gated) or maybe. (The
  // DESIGN §5.5 broader set is SUPERSEDED by the SC-2 lock.)
  const popupChipEligible =
    chipFeatureOn &&
    successDetails !== null &&
    successDetails.status !== "waitlisted";

  const successPopup = (
    <Suspense fallback={null}>
      <RsvpSuccessPopup
        key={`${contextKey}:${acceptedRevision.current}`}
        visible={successDetails !== null}
        palette={palette}
        theme={theme}
        details={successDetails}
        showCalendarNudge={isLoggedIn}
        passPresentation={props.passPresentation}
        claim={
          props.passPresentation === "claim"
            ? {
                email: successClaim?.email ?? null,
                phoneLast4: successClaim?.phoneLast4 ?? null,
                shortUrl: successClaim?.shortUrl ?? null,
                onOpen: (url: string | null) => props.onOpenClaim?.(url),
              }
            : undefined
        }
        renderClaimBody={props.renderClaimBody}
        onCopyText={props.onCopyText}
        onShareText={props.onShareText}
        onDownloadPass={
          props.onDownloadPass === undefined ? undefined : downloadPass
        }
        onClose={() => {
          if (isCurrent() && visiblePassRef.current === successDetails)
            setSuccessDetails(null);
        }}
        chipInPanel={
          popupChipEligible
            ? buildChipPanel("orch-1291-rsvp-chipin-panel-popup")
            : undefined
        }
        formHandoff={props.formHandoff}
      />
    </Suspense>
  );

  // Inline §5.5 mount — SAME {going} gate (SC-2). Rendered between the §5
  // decision box and the §6 brand card by the body below.
  const chipInInlinePanel: React.ReactNode =
    chipFeatureOn && guestStatus === "going"
      ? buildChipPanel("orch-1291-rsvp-chipin-panel-inline")
      : null;

  // ── ORCH-1163-R3 — floating-bar details modal (extracted to RsvpDetailsModal,
  // a portal <Modal> mirroring RsvpGoingConfirmDialog so the BODY file hosts NO
  // scroll root — shell-agnostic invariant §A.2). Re-hosts the SAME contactForm /
  // guestForms nodes (shared state → values sync with the inline §5 box). The +1
  // forms are omitted for Can't-go. Continue is disabled until contactReady. ──
  // issue #3281 S6 — the add-on picker for this party (the guest + plus-ones).
  const addOnsNode =
    props.addOnsNode === undefined ? null : props.addOnsNode(1 + plusCount);
  const detailsContinueLabel =
    pendingDecision === "maybe"
      ? "Save as Maybe"
      : pendingDecision === "not_going"
        ? "Mark Can't go"
        : "Continue";
  const detailsModal = (
    <Suspense fallback={null}>
      <RsvpDetailsModal
        visible={detailsOpen}
        palette={palette}
        theme={theme}
        contactForm={contactForm}
        guestForms={pendingDecision !== "not_going" ? guestForms : null}
        questionsNode={
          pendingDecision !== "not_going" ? props.questionsNode ?? null : null
        }
        addOnsNode={pendingDecision !== "not_going" ? addOnsNode : null}
        errorNode={errorNode}
        continueLabel={detailsContinueLabel}
        continueEnabled={
          pendingDecision === "not_going" ? contactReady : decisionReady
        }
        submitting={submitting}
        onContinue={onDetailsContinue}
        onCancel={closeDetails}
      />
    </Suspense>
  );

  // #3416 D1 — a restored pass the host could not confirm offers a retry
  // instead; the stored QR is never the fallback.
  const onRecoveryRetry = props.onRecoveryRetry ?? null;
  const recoveryAction =
    recoveryHint && onRecoveryRetry !== null
      ? {
          label: "Try again",
          onPress: () => {
            if (isCurrent()) onRecoveryRetry();
          },
          testID: "rsvp-recovery-retry",
        }
      : null;

  // A going guest can always get back to their pass (the success popup closes,
  // and a restored reply has no popup of its own).
  const passAction =
    goingResolved &&
    passDetails !== null &&
    (props.passPresentation === "claim" ||
      passDetails.credentials.some(
        (c: RsvpPassCredential) => c.qrCode !== null,
      ))
      ? {
          label: "View your pass",
          onPress: () => {
            if (isCurrent() && currentPassRef.current === passDetails)
              setSuccessDetails(passDetails);
          },
          testID: "rsvp-view-pass",
        }
      : null;

  return {
    surface,
    boldFamily,
    ctaState,
    capacityFull,
    guestStatus,
    guestApproval,
    submitting,
    contactReady,
    decisionReady,
    plusCount,
    errorNode,
    subcopy,
    validationHint,
    passAction,
    recoveryAction,
    replyLocked,
    inlineDecisionRef,
    floatingDecisionRef,
    recoveryHint,
    decisionAttempted: showValidationErrors,
    onGoingTap,
    onMaybe: () => void submitDirect("maybe"),
    onNotGoing: () => void submitDirect("not_going"),
    onFloatingGoing,
    onFloatingMaybe,
    onFloatingNotGoing,
    contactForm,
    guestForms,
    questionsNode: props.questionsNode ?? null,
    addOnsNode,
    confirmDialog,
    successPopup,
    detailsModal,
    chipInInlinePanel,
  };
};

// ───────────────────────────────────────────────────────────────────────────
// The decision unit (shared by the inline box §0-5 + the floating dock §0-9).
// ───────────────────────────────────────────────────────────────────────────

const DecisionUnit: React.FC<{
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  state: RsvpDecisionState;
  showMomentum: boolean;
  /**
   * ORCH-1163-R3 — the floating bar forces this true so Going/Maybe paint ENABLED
   * (readiness is enforced by the floating handlers, which open the details modal).
   * The inline box omits it and uses the real `state.contactReady`. The resolved-
   * state disabling (going/pending/waitlisted/maybe) is independent of this — it
   * depends on guestStatus and stays intact.
   */
  contactReadyOverride?: boolean;
  /**
   * ORCH-1163-R3 — explicit handler overrides. The floating bar wires the
   * onFloating* entry handlers; the inline box omits these (defaults to the inline
   * onGoingTap/onMaybe/onNotGoing).
   */
  onGoing?: () => void;
  onMaybe?: () => void;
  onNotGoing?: () => void;
  /** Ref for the INLINE mount only (the floating bar's visibility gate reads it). */
  decisionRef?: React.Ref<View>;
  testID?: string;
}> = ({
  palette,
  theme,
  config,
  state,
  showMomentum,
  contactReadyOverride,
  onGoing,
  onMaybe,
  onNotGoing,
  decisionRef = undefined,
  testID,
}) => {
  return (
    <RsvpMomentumDecision
      palette={palette}
      theme={theme}
      goingCount={config.goingCount}
      capacity={config.capacity}
      ctaState={state.ctaState}
      guestStatus={state.guestStatus}
      guestApproval={state.guestApproval}
      // Party chips are PROMOTED to the canonical pills row (§0-4); never nested here.
      partyTypes={[]}
      allowPlusOnes={config.allowPlusOnes}
      plusOnesMax={config.plusOnesMax}
      plusCount={state.plusCount}
      onPlusChange={() => undefined}
      // The body owns the per-guest mini-forms; hide the bare-integer stepper.
      hideStepper
      // ORCH-1339 (D2) — forward the two server-authoritative display gates.
      privateGuestList={config.privateGuestList ?? false}
      hideRemainingCount={config.hideRemainingCount ?? false}
      // issue #3827 going-box — own-list guests (going number only) and the
      // server full flag for the capacity chip when the box is absent.
      extraGuestCount={config.extraGuestCount ?? 0}
      capacityFull={state.capacityFull}
      // ORCH-1340 — the avatar sample + the see-who's-going affordance seam
      // (the floating-bar mount keeps showMomentum=false, so no cluster there).
      guestSample={config.guestSample ?? []}
      onSeeWhosGoing={config.onSeeWhosGoing}
      waitlistEnabled={config.waitlistEnabled}
      submitting={state.submitting}
      locked={state.replyLocked}
      contactReady={contactReadyOverride ?? state.decisionReady}
      // issue #4508 1.7 — "Going" alone, "RSVP for N" with guests.
      goingIdleLabel={
        state.plusCount > 0 ? `RSVP for ${state.plusCount + 1}` : "Going"
      }
      onGoing={onGoing ?? state.onGoingTap}
      onMaybe={onMaybe ?? state.onMaybe}
      onNotGoing={onNotGoing ?? state.onNotGoing}
      variant="floating-dock"
      showMomentum={showMomentum}
      micro={state.subcopy ?? undefined}
      validationHint={state.validationHint}
      announceHint={
        !state.recoveryHint || (showMomentum && Platform.OS === "web")
      }
      secondaryAction={state.passAction ?? state.recoveryAction}
      decisionRef={decisionRef}
      goingTestID="orch-1150-rsvp-going"
      maybeTestID="orch-1150-rsvp-maybe"
      notGoingTestID="orch-1150-rsvp-not-going"
      testID={testID}
    />
  );
};

// ───────────────────────────────────────────────────────────────────────────
// (5) RsvpDecisionBox — the INLINE decision box. ORCH-1163-R2: extracted so it
// renders BOTH inline in the body (phone + native) AND inside the desktop sticky
// panel (web ≥ DESKTOP_BREAKPOINT) — ONE owner, one state, one decision-control
// copy (PARITY with EventTicketBox). Carries the contact form + per-guest plus-one
// mini-forms + the shared momentum/decision unit (showMomentum) + the error node.
// Reads the SHARED state from useRsvpOfferingState (the inline box + the floating
// bar drive one state machine — no duplicate writes). Hosts the
// `orch-1163-rsvp-inline-box` testID anchor the canonical-order gate reads.
// ───────────────────────────────────────────────────────────────────────────

export interface RsvpDecisionBoxProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  state: RsvpOfferingState;
  testID?: string;
}

export const RsvpDecisionBox: React.FC<RsvpDecisionBoxProps> = ({
  palette,
  theme,
  config,
  state,
  testID,
}) => (
  <View testID={testID ?? "orch-1163-rsvp-inline-box"}>
    {state.contactForm}
    {state.guestForms}
    {state.questionsNode}
    {state.addOnsNode}
    <DecisionUnit
      palette={palette}
      theme={theme}
      config={config}
      state={state}
      decisionRef={state.inlineDecisionRef}
      showMomentum
      testID="orch-1157-rsvp-inline-momentum"
    />
    {state.errorNode}
  </View>
);

// ───────────────────────────────────────────────────────────────────────────
// (9) RsvpOfferingFloatingBar — the floating decision control (Going/Maybe/Can't),
// surface-pinned overlay (mirrors EventOfferingFloatingBar EXACTLY). ALL THREE
// controls show together as a floating segmented bar; the surface pins it
// absolute-bottom with zIndex:6 as a sibling of ParallaxCoverShell (the event
// `floatWrap` contract). Gorhom-safe — the body never owns the scroll root or the
// bar. Takes the SHARED state from useRsvpOfferingState so the bar + the inline box
// drive ONE state machine. The decision LOGIC stays in RsvpMomentumDecision.
// ───────────────────────────────────────────────────────────────────────────

export interface RsvpOfferingFloatingBarProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  state: RsvpOfferingState;
  testID?: string;
}

export const RsvpOfferingFloatingBar: React.FC<
  RsvpOfferingFloatingBarProps
> = ({ palette, theme, config, state, testID }) => (
  // A SOLID themed card around the three buttons. Without it the page showed
  // through the gaps between them and the bar read as loose buttons laid over
  // the date card, the vibe chips and the About text.
  <View
    style={[
      styles.floatingCard,
      {
        backgroundColor:
          Platform.OS === "android"
            ? palette.page
            : opaqueSurfaceColor(palette),
        borderColor: palette.panelBorder,
      },
    ]}
    testID="rsvp-floating-decision-card"
  >
    {/* ORCH-1163-R3 — the floating bar is SELF-SUFFICIENT: force contactReady so
        Going/Maybe are never disabled into a dead end, and route through the
        floating entry handlers (which reveal the missing field, or open the
        details modal on a surface that cannot scroll to it). The inline
        RsvpDecisionBox is untouched (real contactReady + inline handlers). */}
    <DecisionUnit
      palette={palette}
      theme={theme}
      config={config}
      state={state}
      showMomentum={false}
      contactReadyOverride
      onGoing={state.onFloatingGoing}
      onMaybe={state.onFloatingMaybe}
      onNotGoing={state.onFloatingNotGoing}
      decisionRef={state.floatingDecisionRef}
      testID={testID ?? "orch-1157-rsvp-floating-dock"}
    />
  </View>
);

// Back-compat alias — RsvpOfferingDecisionDock IS the floating bar (kept so the
// barrel re-export + existing imports stay valid; the surface now pins it with the
// event-style floatWrap zIndex:6 sibling rather than a full-width bottom panel).
export type RsvpOfferingDecisionDockProps = RsvpOfferingFloatingBarProps;
export const RsvpOfferingDecisionDock = RsvpOfferingFloatingBar;

// ───────────────────────────────────────────────────────────────────────────
// The body. Renders sections 2–8 content + the inline decision box (§0-5) + the
// confirm dialog + success popup (both <Modal>, portal-safe). The surface pins the
// cover (1) + the floating dock (9). The decision STATE is passed in (lifted by the
// surface via useRsvpOfferingState) so the inline box + dock stay in sync.
// ───────────────────────────────────────────────────────────────────────────

export const RsvpOfferingBody: React.FC<
  RsvpOfferingBodyProps & { state: RsvpOfferingState }
> = (props) => {
  const {
    event,
    brand,
    palette,
    theme,
    config,
    onOpenBrand,
    presentedByFollow,
    presentedByFollowerCount,
    presentedByFollowerCountLoading = false,
    presentedByFollowerCountLabels,
    onOpenMaps,
    onCopyAddress,
    staticMapUrl = null,
    hideDecisionBox = false,
    passHolderAddress,
    identityOnCover = false,
    onAddToCalendar,
    testID,
    state,
  } = props;
  const { surface, boldFamily } = state;
  const boldFace = themeFontFace(boldFamily);
  const [aboutCollapsed, setAboutCollapsed] = useState(true);
  const acquisitionState = event.acquisitionState ?? {
    kind: "current" as const,
  };
  const acquisitionClosed = acquisitionState.kind !== "current";

  const toggleAbout = useCallback(() => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        200,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
    setAboutCollapsed((c) => !c);
  }, []);

  // ── pills (§0-4): format → vibes → party-types → music-genres. NO tickets-left. ──
  const formatLabel =
    event.format === "online"
      ? "Online"
      : event.format === "hybrid"
        ? "In-person + online"
        : "In person";
  const vibeTags = event.vibeTags ?? [];
  const partyTypes = event.partyTypes ?? [];
  const musicGenres = event.musicGenres ?? [];

  // ── date row (§0-3): doors merged into the subline-style facts below the band ──
  const doorsLine: string | null =
    config.doorsOpenLabel !== null && config.doorsOpenLabel !== undefined
      ? config.doorsCloseLabel !== null && config.doorsCloseLabel !== undefined
        ? `Doors open ${config.doorsOpenLabel} · Doors close ${config.doorsCloseLabel}`
        : `Doors open ${config.doorsOpenLabel}`
      : null;

  // ── address privacy (§0-8). The anon RPC already returns city-only when hidden;
  //    the client reveals the street once the viewer's own RSVP is going/maybe. ──
  const addressRevealed =
    !event.hideAddressUntilTicket ||
    state.guestStatus === "going" ||
    state.guestStatus === "maybe";
  const cityCountry =
    normalizeCityCountry(event.venueName) ??
    normalizeCityCountry(event.address);
  const hiddenAreaLabel =
    normalizeCityCountry(event.address) ??
    cityCountry ??
    "Address shared after you RSVP";
  const venueAddressLabel =
    event.format === "online"
      ? "Online event"
      : passHolderAddress
        ? passHolderAddress
        : addressRevealed
        ? (event.address ?? event.venueName ?? "Location shared on RSVP")
        : hiddenAreaLabel;
  const addressUnlockCaption: string | null =
    event.format === "online" || addressRevealed || passHolderAddress
      ? null
      : "Full address shared once you're going";
  /*
    issue #2468 — ONE owner for the privacy gate, the label AND the pin. The
    gate here is `!addressRevealed` (the RSVP page reveals the street once the
    viewer is going/maybe), so a viewer who has NOT revealed it can never get an
    exact-pin deep link. When the street IS hidden the anon RPC has already
    nulled `locationGeo` server-side; this is the second lock, client-side.
  */
  const venueMapsTarget = selectVenueMapsTarget({
    venueName: event.venueName,
    address: event.address,
    addressHidden: !addressRevealed,
    locationGeo: event.locationGeo,
    googlePlaceId: event.googlePlaceId ?? null,
  });
  const canOpenVenueMaps =
    canOpenMapsTarget(venueMapsTarget) && onOpenMaps !== undefined;
  /*
    issue #2508 — chooser + copy button on the SAME already-gated target. On the
    RSVP page the gate is `!addressRevealed`, so a guest who has not RSVP'd yet
    gets no copy button and no chooser, exactly as they get no maps link.
  */
  const mapsActions = useVenueMapsActions({
    target: venueMapsTarget,
    onOpenMaps,
    onCopyAddress,
  });

  // A static map that fails to load hides itself instead of leaving an empty
  // black box above the address card (the card + "Open maps" still work).
  const [mapFailed, setMapFailed] = useState(false);
  useEffect(() => setMapFailed(false), [staticMapUrl]);

  const aboutText = event.description.trim();
  const canCollapseAbout = aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
  const aboutCollapsedNow = canCollapseAbout && aboutCollapsed;

  return (
    <View testID={testID}>
      {/* FLOW A modals — all <Modal> (portal to root), gorhom-safe regardless of
          where in the tree they mount. The surface need not re-pin them.
          ORCH-1163-R3 — detailsModal hosts the floating-bar's self-sufficient
          name/email/phone + +1 forms (same shared state as the inline §5 box). */}
      {acquisitionClosed ? null : state.confirmDialog}
      {acquisitionClosed ? null : state.successPopup}
      {acquisitionClosed ? null : state.detailsModal}

      {/* (2) Event name lead block. issue #4420 — on the cover in the premium
          frame (identityOnCover), so the body does not print it twice. */}
      {identityOnCover ? null : (
        <View style={styles.leadBlock}>
          <Text
            style={[
              styles.title,
              surface.primaryText,
              boldFace,
            ]}
          >
            {event.name.length > 0 ? event.name : "Untitled event"}
          </Text>
        </View>
      )}

      {/* (3)+(4) issue #4420 — the fact rows (when, with the doors line;
          where, with the address privacy caption) and the quiet tag line
          (format → vibes → party types → music; NO tickets-left) replace the
          date band and the pills row. */}
      <OfferingFactRows
        palette={palette}
        theme={theme}
        testID="orch-1167-facts"
        facts={[
          {
            key: "when",
            icon: "calendar",
            value: event.dateLine.length > 0 ? event.dateLine : null,
            detail: event.dateSubline,
            caption: doorsLine,
            action:
              onAddToCalendar !== undefined
                ? { label: "Add to calendar", onPress: onAddToCalendar }
                : null,
          },
          event.format === "online"
            ? { key: "where", icon: "globe", value: "Online", detail: "Link shared once you RSVP" }
            : {
                key: "where",
                icon: "pin",
                value: event.venueName ?? cityCountry,
                detail: venueAddressLabel,
                caption: addressUnlockCaption,
                action: canOpenVenueMaps
                  ? { label: "Map", onPress: mapsActions.requestOpenMaps }
                  : null,
              },
        ]}
        tags={[
          formatLabel,
          ...vibeTags.map((tag: string) => taxonomyLabel(tag)),
          ...partyTypes.map((tag: string) => taxonomyLabel(tag)),
          ...musicGenres.map((tag: string) => taxonomyLabel(tag)),
        ]}
      />
      {doorsLine !== null ? <View testID="orch-1157-rsvp-doors" /> : null}
      {/* issue #3281 S2 — "Add at checkout:" for the RSVP (the page shell's slot). */}
      {props.addOns && props.rsvpAddOns !== undefined
        ? props.addOns("rsvp", props.rsvpAddOns, event.currency ?? null, palette)
        : null}

      {/* (5) DECISION BOX — INLINE single-owner <RsvpDecisionBox> (parallel to
          EventTicketBox): contact form (anon) + per-guest mini-forms + the shared
          decision (Going → confirm dialog). ORCH-1163-R2 (change 2): on desktop web
          (hideDecisionBox=true) the box is relocated to the sticky right panel by
          the surface (the SAME <RsvpDecisionBox>), so it does not paint a second
          time inline. Phones + both native apps keep the inline box. The
          `orch-1163-rsvp-inline-box` testID anchor stays in source for the
          canonical-order gate (rendered by RsvpDecisionBox). */}
      {acquisitionClosed || hideDecisionBox ? null : (
        <View style={styles.section}>
          <RsvpDecisionBox
            palette={palette}
            theme={theme}
            config={config}
            state={state}
            testID="orch-1163-rsvp-inline-box"
          />
        </View>
      )}

      {/* (5.5) ORCH-1291 [rsvp-chip-in] — the persistent inline voluntary-gift
          panel for a guest who dismissed the popup or returned later (incl. a web
          redirect return). Gated on {going} + config-enabled + onChipIn wired
          (SC-2). Inserted strictly AFTER the §5 inline box and BEFORE the §6
          brand card so the canonical-order gate's anchors keep their relative
          order; renders null in the default free flow. */}
      {!acquisitionClosed && state.chipInInlinePanel !== null ? (
        <View style={styles.section} testID="orch-1291-rsvp-chipin-section">
          {state.chipInInlinePanel}
        </View>
      ) : null}

      {/* (6) Presented By — identity Pressable + optional sibling Follow (#3682 A). */}
      <View style={styles.section} testID="presented-by-card">
        <View style={[styles.brandCard, surface.card]}>
          <Pressable
            onPress={() => {
              if (brand?.slug !== undefined) onOpenBrand?.(brand.slug);
            }}
            disabled={brand?.slug === undefined || onOpenBrand === undefined}
            accessibilityRole={onOpenBrand !== undefined ? "link" : undefined}
            accessibilityLabel={
              brand?.displayName !== undefined
                ? `${brand.displayName}. Open brand page`
                : "Open brand page"
            }
            style={styles.brandRow}
            testID="orch-1157-rsvp-brand"
          >
            <View
              style={[styles.brandTile, accentFill(palette)]}
            >
              {brand?.photo !== undefined && brand.photo.length > 0 ? (
                <OfferingRoutedImage
                  source={{ uri: brand.photo }}
                  style={styles.brandPhoto}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.brandInitialWrap}>
                  <Text
                    style={[
                      styles.brandInitial,
                      { color: palette.accentText, ...boldFace },
                    ]}
                  >
                    {(brand?.displayName?.trim()[0] ?? "•").toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.brandTextCol}>
              <Text
                style={[styles.brandKicker, { color: palette.secondaryText }]}
              >
                Presented by
              </Text>
              <Text
                style={[
                  styles.brandName,
                  surface.primaryText,
                  boldFace,
                ]}
                numberOfLines={2}
              >
                {brand?.displayName ?? "Brand"}
              </Text>
              <PresentedByFollowerCount
                count={presentedByFollowerCount}
                loading={presentedByFollowerCountLoading}
                labels={presentedByFollowerCountLabels}
                palette={palette}
                testID="rsvp-presented-by-follower-count"
              />
            </View>
            {presentedByFollow === undefined && onOpenBrand !== undefined ? (
              <Text style={[styles.brandCta, { color: palette.accent }]}>
                View
              </Text>
            ) : null}
          </Pressable>
          {presentedByFollow !== undefined ? (
            <View style={styles.brandFollowSlot}>{presentedByFollow}</View>
          ) : null}
        </View>
      </View>

      {/* (7) About — collapsible. */}
      {aboutText.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.secTitle,
              surface.primaryText,
              boldFace,
            ]}
          >
            About
          </Text>
          <Text
            style={[styles.about, surface.secondaryText]}
            numberOfLines={aboutCollapsedNow ? 3 : undefined}
            ellipsizeMode="tail"
          >
            {aboutText}
          </Text>
          {canCollapseAbout ? (
            <Pressable
              onPress={toggleAbout}
              accessibilityRole="button"
              style={styles.aboutToggleRow}
            >
              <Text style={[styles.aboutToggle, { color: palette.accent }]}>
                {aboutCollapsedNow ? "Read more" : "Show less"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* (8) Where you'll be — static map (city-level when hidden) + venue card. */}
      {event.format === "online" ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.secTitle,
              surface.primaryText,
              boldFace,
            ]}
          >
            Where you&rsquo;ll be
          </Text>
          <View style={[styles.venueCard, surface.card]}>
            <View
              style={[styles.venueDisk, accentFill(palette)]}
            >
              <Globe size={18} color={palette.accentText} />
            </View>
            <View style={styles.venueTextCol}>
              <Text
                style={[
                  styles.venueName,
                  surface.primaryText,
                  boldFace,
                ]}
              >
                Online
              </Text>
              <Text style={[styles.venueAddr, surface.secondaryText]}>
                Link shared with guests who RSVP.
              </Text>
            </View>
          </View>
        </View>
      ) : event.venueName !== null || cityCountry !== null ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.secTitle,
              surface.primaryText,
              boldFace,
            ]}
          >
            Where you&rsquo;ll be
          </Text>
          {staticMapUrl !== null && !mapFailed ? (
            <StaticMapImage
              uri={staticMapUrl}
              style={[styles.whereMap, { borderColor: palette.panelBorder }]}
              onError={() => setMapFailed(true)}
              accessibilityLabel={
                event.venueName !== null ? `Map of ${event.venueName}` : "Map"
              }
              testID="orch-1167-where-map"
            />
          ) : null}
          <Pressable
            onPress={mapsActions.requestOpenMaps}
            disabled={!canOpenVenueMaps}
            accessibilityRole={canOpenVenueMaps ? "button" : undefined}
            style={[styles.venueCard, surface.card]}
          >
            <View
              style={[styles.venueDisk, accentFill(palette)]}
            >
              <MapPin size={18} color={palette.accentText} />
            </View>
            <View style={styles.venueTextCol}>
              {event.venueName !== null && event.venueName.length > 0 ? (
                <Text
                  style={[
                    styles.venueName,
                    surface.primaryText,
                    boldFace,
                  ]}
                >
                  {event.venueName}
                </Text>
              ) : null}
              {sameLine(
                venueAddressLabel.length > 0
                  ? venueAddressLabel
                  : (cityCountry ?? venueAddressLabel),
                event.venueName,
              ) ? null : (
                <Text style={[styles.venueAddr, surface.secondaryText]}>
                  {venueAddressLabel.length > 0
                    ? venueAddressLabel
                    : (cityCountry ?? venueAddressLabel)}
                </Text>
              )}
              {addressUnlockCaption !== null ? (
                <Text
                  style={[styles.venueUnlockCaption, surface.tertiaryText]}
                  testID="orch-1157-rsvp-address-unlock-caption"
                >
                  {addressUnlockCaption}
                </Text>
              ) : null}
            </View>
            {canOpenVenueMaps ? (
              <View
                style={[styles.venuePill, accentFill(palette)]}
              >
                <Text
                  style={[styles.venuePillText, { color: palette.accentText }]}
                >
                  Open maps
                </Text>
              </View>
            ) : null}
          </Pressable>
          {/* issue #2508 — SIBLINGS of the card (nesting Pressables flattens
              the a11y subtree). Both self-hide when the target is null. */}
          <VenueCopyAddressButton
            actions={mapsActions}
            palette={palette}
            font={boldFamily}
          />
          <MapsAppChooserDialog
            actions={mapsActions}
            palette={palette}
            placeLabel={event.venueName}
            font={boldFamily}
          />
        </View>
      ) : null}
    </View>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// Sub-components.
// ───────────────────────────────────────────────────────────────────────────

const Pill: React.FC<{
  palette: ThemePalette;
  font: string;
  children: React.ReactNode;
}> = ({ palette, font, children }) => (
  <View
    style={[
      styles.pill,
      { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
    ]}
  >
    <Text
      style={[
        styles.pillText,
        { color: palette.primaryText, ...themeFontFace(font) },
      ]}
    >
      {children}
    </Text>
  </View>
);

type RsvpFieldProps = RsvpPlainFieldProps;

// forwardRef so a blocked decision tap can scroll to and focus this field.
const RsvpField = React.forwardRef<TextInput, RsvpFieldProps>(
  (
    {
      label,
      value,
      onChangeText,
      placeholder,
      palette,
      invalid,
      invalidMsg,
      keyboardType = "default",
      autoCapitalize = "none",
      testID,
      disabled = false,
      disableAutofill = false,
      onSubmitEditing,
    }: RsvpFieldProps,
    ref: React.Ref<TextInput>,
  ) => {
    const surface = offeringSurfaceStyles(palette);
    return (
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, surface.tertiaryText]}>{label}</Text>
        <TextInput
          {...{ ref }}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.tertiaryText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          accessibilityLabel={label}
          editable={!disabled}
          accessibilityState={{ disabled }}
          {...(disableAutofill
            ? {
                textContentType: "none" as const,
                autoComplete: "off" as const,
                importantForAutofill: "no" as const,
              }
            : {})}
          {...(onSubmitEditing !== undefined
            ? { onSubmitEditing, returnKeyType: "done" as const }
            : {})}
          style={[
            styles.fieldInput,
            {
              color: palette.primaryText,
              backgroundColor: palette.page,
              borderColor: invalid ? "#e5484d" : palette.panelBorder,
            },
          ]}
          testID={testID}
        />
        {invalid ? <Text style={styles.fieldError}>{invalidMsg}</Text> : null}
      </View>
    );
  },
);
RsvpField.displayName = "RsvpField";

const styles = StyleSheet.create({
  leadBlock: { marginBottom: 4 },
  // #3859 — no fixed lineHeight: the selected host font owns its native metrics.
  title: {
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    width: "100%",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  dateGlyph: { fontSize: 18, fontWeight: "900" },
  dateTextCol: { flex: 1, minWidth: 0 },
  dateLine: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  dateSubline: { fontSize: 13, fontWeight: "700", marginTop: 2 },
  pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: { fontSize: 13, fontWeight: "700" },
  // issue #4420 — the premium rhythm: sections 34pt apart, headings in the
  // host's display face at 26pt (OfferingSectionTitle's metrics).
  section: { marginTop: 34 },
  secTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 14,
  },
  about: { fontSize: 15.5, lineHeight: 25 },
  aboutToggleRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  aboutToggle: { fontSize: 14, fontWeight: "700" },
  // contact + per-guest forms
  formCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    overflow: "hidden",
  },
  formMicro: { fontSize: 12, marginBottom: 10 },
  guestBlock: {
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    overflow: "hidden",
  },
  guestHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  guestHeaderText: { flex: 1, minWidth: 0 },
  guestHeaderTitle: { fontSize: 16, fontWeight: "700" },
  guestHeaderLabel: { fontSize: 13, fontWeight: "500", marginTop: 3 },
  guestRow: { marginTop: 10 },
  guestRowTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: 6,
  },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: { fontSize: 20, fontWeight: "800", lineHeight: 22 },
  stepCount: {
    fontSize: 16,
    fontWeight: "700",
    minWidth: 30,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "700", marginBottom: 5 },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    fontSize: 15,
  },
  fieldError: { color: "#e5484d", fontSize: 12, marginTop: 4 },
  errorText: { color: "#e5484d", fontSize: 13, marginTop: 10 },
  // #4508 N-7: the guest block's slot while it loads, or if it failed to.
  guestSlot: { minHeight: 160, borderRadius: 18, marginBottom: 14, padding: 18 },
  // brand
  brandCard: {
    borderRadius: 16,
    overflow: "hidden",
    padding: 14,
  },
  brandFollowSlot: {
    marginTop: 12,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandTile: { width: 42, height: 42, borderRadius: 999, overflow: "hidden" },
  brandPhoto: { width: "100%", height: "100%" },
  brandInitialWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  brandInitial: { fontSize: 18, fontWeight: "900" },
  brandTextCol: { flexShrink: 1, flexGrow: 1 },
  brandKicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  brandName: { fontSize: 15, fontWeight: "800", marginTop: 1 },
  brandCta: { fontSize: 13, fontWeight: "800" },
  // where
  whereMap: {
    width: "100%",
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "#000",
    marginBottom: 12,
  },
  venueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
  },
  venueDisk: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  venueGlyph: { fontSize: 18, fontWeight: "900" },
  venueTextCol: { flex: 1, minWidth: 0 },
  venueName: { fontSize: 15, fontWeight: "800" },
  venueAddr: { fontSize: 13, marginTop: 2 },
  venueUnlockCaption: { fontSize: 12, marginTop: 4 },
  venuePill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  // The phone floating decision card (opaque; see RsvpOfferingFloatingBar).
  floatingCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 10,
    ...Platform.select({
      // No Android shadow under a rounded fill (opaque-glass policy); clip there.
      android: { overflow: "hidden" as const },
      // iOS drops a shadow on a view that clips, so web/iOS do not clip.
      default: {
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
      },
    }),
  },
  venuePillText: { fontSize: 12, fontWeight: "800" },
});

export default RsvpOfferingBody;
