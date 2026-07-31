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

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
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

import { boldFontFamily, offeringSurfaceStyles, type ThemePalette } from "./themePalette";
import { Calendar, Globe, MapPin, Minus, Plus } from "./LucideIcons";
// ORCH-1292 — resolve party/vibe/music slugs to canonical labels at the pills row.
import { taxonomyLabel } from "./taxonomyLabels";
import { resolveRsvpCta, type RsvpCtaState } from "./offeringCta";
// ORCH-1340 — the 1338 frozen avatar-sample entry type (avatarUrl only, no names).
import { type SocialProofSampleEntry } from "./socialProofTypes";
import { type PublicBrandProps, type PublicEventProps } from "./types";
import { type ResolvedTheme } from "./designTokens";
import { normalizeCityCountry } from "./normalizeCityCountry";
import { RsvpMomentumDecision } from "./RsvpMomentumDecision";
import type { RsvpConfirmationDetails } from "./RsvpSuccessPopup";
import type { ChipInPanelState } from "./RsvpChipInPanel";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s()-]{7,20}$/;
const ABOUT_COLLAPSE_THRESHOLD = 160;
const RsvpGoingConfirmDialog = React.lazy(() => import("./RsvpGoingConfirmDialog"));
const RsvpDetailsModal = React.lazy(() => import("./RsvpDetailsModal"));
const RsvpChipInPanel = React.lazy(() => import("./RsvpChipInPanel"));
const RsvpSuccessPopup = React.lazy(() => import("./RsvpSuccessPopup"));

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface RsvpOfferingConfig {
  capacity: number | null;
  goingCount: number;
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
export interface RsvpPhoneFieldRenderArgs {
  /** ISO 3166-1 alpha-2 country code (controlled by the hook). */
  countryCode: string;
  /** National digits only (controlled by the hook). */
  localDigits: string;
  /** New country picked → surface passes the freshly-composed E.164 too. */
  onChangeCountry: (isoCode: string, composedE164: string) => void;
  /** Digits edited → surface passes the freshly-composed E.164 too. */
  onChangeLocalDigits: (digits: string, composedE164: string) => void;
  /** True when the composed value is present but not a valid phone number. */
  invalid: boolean;
  /** Brand palette so the injected field matches the themed RSVP form. */
  palette: ThemePalette;
  /** Disable while a submit is in flight. */
  disabled: boolean;
}
export type RsvpPhoneFieldRenderer = (
  args: RsvpPhoneFieldRenderArgs,
) => React.ReactNode;

export interface RsvpGuestContact {
  name: string;
  email: string;
  phone: string;
}

export interface RsvpSubmitResult {
  status: "going" | "not_going" | "waitlisted" | "maybe";
  approvalStatus: "pending" | "approved";
  rsvpId: string;
  confirmationToken: string | null;
  acknowledgement?: "accepted" | "pending_approval" | "waitlisted" | "maybe" | "not_going";
  credentials?: RsvpPassCredential[];
  anonymousRecovery?: RsvpAnonymousRecovery[];
}

export interface RsvpPassCredential {
  entityType: "primary" | "guest";
  entityId: string;
  displayName: string;
  qrCode: string | null;
  pdfFetchRef: string;
}
export interface RsvpAnonymousRecovery {
  entityType: "primary" | "guest";
  entityId: string;
  recoveryToken: string | null;
  recoveryUrl: string | null;
}

export interface RsvpOfferingBodyProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  isLoggedIn: boolean;
  initialGuestName?: string;
  initialGuestEmail?: string;
  initialGuestPhone?: string;
  /** Explorer requires complete email+phone snapshots even when authenticated. */
  requirePrimaryContact?: boolean;
  onDownloadPass?: (
    credential: RsvpPassCredential,
    recovery: RsvpAnonymousRecovery | null,
  ) => Promise<void>;
  onSubmit: (input: {
    rsvpStatus: "going" | "not_going" | "maybe";
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    plusCount: number;
    guests: RsvpGuestContact[];
  }) => Promise<RsvpSubmitResult>;
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
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
  testID?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Shared state machine. The body owns submit/contact/guests/dialog state and
// exposes the decision dock node for the surface to pin (section 9).
// ───────────────────────────────────────────────────────────────────────────

interface RsvpDecisionState {
  surface: ReturnType<typeof offeringSurfaceStyles>;
  boldFamily: string;
  ctaState: RsvpCtaState;
  guestStatus: "going" | "not_going" | "waitlisted" | "maybe" | null;
  guestApproval: "pending" | "approved" | null;
  submitting: boolean;
  contactReady: boolean;
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
}

export interface RsvpOfferingState extends RsvpDecisionState {
  contactForm: React.ReactNode;
  guestForms: React.ReactNode;
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
    setGuestName((current) => current.trim() || props.initialGuestName || "");
  }, [props.initialGuestName]);
  useEffect(() => {
    setGuestEmail((current) => current.trim() || props.initialGuestEmail || "");
  }, [props.initialGuestEmail]);
  useEffect(() => {
    setGuestPhone((current) => current.trim() || props.initialGuestPhone || "");
  }, [props.initialGuestPhone]);
  // ORCH-1295 — country + local-digits state for the injected picker (unused when
  // renderPhoneField is absent). Lifted here so the field stays controlled across
  // BOTH contact-form mounts (inline body + details modal) without divergence.
  const [phoneCountry, setPhoneCountry] = useState<string>(
    defaultPhoneCountry ?? "US",
  );
  const [phoneLocalDigits, setPhoneLocalDigits] = useState("");
  const [guests, setGuests] = useState<RsvpGuestContact[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [guestStatus, setGuestStatus] = useState<
    "going" | "not_going" | "waitlisted" | "maybe" | null
  >(null);
  const [guestApproval, setGuestApproval] = useState<"pending" | "approved" | null>(
    null,
  );

  // FLOW A — Going confirmation dialog + success popup state (body-owned).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [successDetails, setSuccessDetails] = useState<RsvpConfirmationDetails | null>(
    null,
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
    const preselect = chipSuggestedCents ??
      ((chipCurrency || "").toUpperCase() === "NGN" ? 2500 * 100 : 10 * 100);
    return chipMinCents !== null ? Math.max(preselect, chipMinCents) : preselect;
  })();
  const [chipAmountCents, setChipAmountCents] = useState<number>(chipDefaultAmount);
  const [chipInState, setChipInState] = useState<ChipInPanelState>(
    contributionState === "paid" ? "success" : "idle",
  );
  const [chipError, setChipError] = useState<string | null>(null);

  const capacityFull =
    config.capacity !== null && config.goingCount >= config.capacity;

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
  const primaryValid =
    (isLoggedIn && props.requirePrimaryContact !== true) || primaryContactComplete;
  const plusCount = config.allowPlusOnes ? guests.length : 0;
  const guestsValid = guests.every(
    (g) =>
      g.name.trim().length > 0 &&
      EMAIL_RE.test(g.email.trim()) &&
      PHONE_RE.test(g.phone.trim()),
  );
  // A4-NEW (extended §H.6): primary + every plus-one must be reachable.
  const contactReady = primaryValid && guestsValid;

  const mapErrorCode = useCallback((code: string): string => {
    if (code.includes("rsvp_full")) return "This event just filled up.";
    if (code.includes("rsvp_not_open")) return "RSVPs are closed for this event.";
    if (code.includes("rsvp_guest_count_mismatch"))
      return "Re-check each guest's details.";
    if (
      code.includes("rsvp_guest_contact_required") ||
      code.includes("rsvp_contact_required")
    )
      return "Add your name, email and phone.";
    if (code.includes("rsvp_guest_phone_invalid") || code.includes("rsvp_phone_invalid"))
      return "That phone number looks off.";
    return "Couldn't save your RSVP. Try again.";
  }, []);

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
  }, [event.address, event.format, event.hideAddressUntilTicket, event.venueName]);

  const runSubmit = useCallback(
    async (rsvpStatus: "going" | "not_going" | "maybe"): Promise<RsvpSubmitResult | null> => {
      const submittedGuests = rsvpStatus === "not_going" ? [] : guests;
      const result = await onSubmit({
        rsvpStatus,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim(),
        guestPhone: guestPhone.trim(),
        plusCount: rsvpStatus === "not_going" ? 0 : plusCount,
        guests: submittedGuests.map((g) => ({
          name: g.name.trim(),
          email: g.email.trim(),
          phone: g.phone.trim(),
        })),
      });
      setGuestStatus(result.status);
      setGuestApproval(result.approvalStatus);
      return result;
    },
    [guests, onSubmit, guestName, guestEmail, guestPhone, plusCount],
  );

  // Maybe / Not-going → record DIRECTLY (no dialog).
  const submitDirect = useCallback(
    async (rsvpStatus: "not_going" | "maybe"): Promise<void> => {
      if (submitting) return;
      if (rsvpStatus === "maybe" && !contactReady) {
        setErrorMsg("Add your name, email, and phone to RSVP.");
        return;
      }
      setErrorMsg(null);
      setSubmitting(true);
      try {
        await runSubmit(rsvpStatus);
      } catch (err) {
        setErrorMsg(mapErrorCode(err instanceof Error ? err.message : String(err)));
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, contactReady, runSubmit, mapErrorCode],
  );

  // Going → open the confirmation dialog (when contactReady); else surface errors.
  const onGoingTap = useCallback((): void => {
    if (submitting) return;
    if (!contactReady) {
      setErrorMsg("Add your name, email, and phone to RSVP.");
      return;
    }
    setErrorMsg(null);
    setConfirmError(null);
    setConfirmOpen(true);
  }, [submitting, contactReady]);

  // ── ORCH-1163-R3 — floating-bar entry handlers ──
  // The floating bar forces contactReady=true on its DecisionUnit so the buttons
  // are never disabled into a dead end; readiness is enforced HERE instead. If the
  // guest already has details (inline box / a prior modal), fall straight through
  // to the inline behavior; otherwise open the self-sufficient details modal with
  // the decision pinned, to dispatch once the contact + +1 forms are filled.
  const onFloatingGoing = useCallback((): void => {
    if (submitting) return;
    if (contactReady) {
      onGoingTap();
      return;
    }
    setErrorMsg(null);
    setPendingDecision("going");
    setDetailsOpen(true);
  }, [submitting, contactReady, onGoingTap]);

  const onFloatingMaybe = useCallback((): void => {
    if (submitting) return;
    if (contactReady) {
      void submitDirect("maybe");
      return;
    }
    setErrorMsg(null);
    setPendingDecision("maybe");
    setDetailsOpen(true);
  }, [submitting, contactReady, submitDirect]);

  const onFloatingNotGoing = useCallback((): void => {
    if (submitting) return;
    // Can't-go needs no +1s and no contact gate for a logged-in guest. Anon guests
    // still need a reachable identity so the host can attribute the decline.
    if (isLoggedIn || contactReady) {
      void submitDirect("not_going");
      return;
    }
    setErrorMsg(null);
    setPendingDecision("not_going");
    setDetailsOpen(true);
  }, [submitting, isLoggedIn, contactReady, submitDirect]);

  // Continue inside the details modal — dispatch the pinned decision. Disabled in
  // the UI until contactReady, so values are valid here.
  const closeDetails = useCallback((): void => {
    setDetailsOpen(false);
    setPendingDecision(null);
  }, []);
  const onDetailsContinue = useCallback((): void => {
    if (!contactReady) return;
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
  }, [contactReady, pendingDecision, submitDirect]);

  const onConfirmGoing = useCallback(async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setConfirmError(null);
    try {
      const result = await runSubmit("going");
      if (result === null) return;
      setConfirmOpen(false);
      setSuccessDetails({
        eventName: event.name,
        dateLine: event.dateLine,
        venueLine: venueLineForPopup,
        guestName: isLoggedIn
          ? (brand !== null ? guestName.trim() || "You" : guestName.trim() || "You")
          : guestName.trim() || guestEmail.trim() || "Guest",
        status:
          result.status === "waitlisted"
            ? "waitlisted"
            : result.approvalStatus === "pending"
              ? "pending"
              : "going",
        plusGuests: guests.map((g) => ({ name: g.name.trim() })),
        confirmationToken: result.confirmationToken,
        credentials: result.credentials ?? [],
        anonymousRecovery: result.anonymousRecovery ?? [],
      });
    } catch (err) {
      setConfirmError(mapErrorCode(err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    runSubmit,
    event.name,
    event.dateLine,
    venueLineForPopup,
    isLoggedIn,
    brand,
    guestName,
    guestEmail,
    guests,
    mapErrorCode,
  ]);

  // ── ORCH-1291 — server-code → gift-framed copy (DESIGN §4.7). ──
  const fmtChipWhole = useCallback((cents: number): string => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: chipCurrency || "USD",
        maximumFractionDigits: 0,
      }).format(cents / 100);
    } catch {
      return `${Math.round(cents / 100)} ${chipCurrency}`;
    }
  }, [chipCurrency]);

  const runChipIn = useCallback(async (): Promise<void> => {
    if (onChipIn == null) return;
    if (chipInState === "submitting") return;
    if (chipAmountCents <= 0) {
      setChipError("Enter an amount to chip in.");
      setChipInState("error");
      return;
    }
    if (chipMinCents !== null && chipAmountCents < chipMinCents) {
      setChipError(`Add at least ${fmtChipWhole(chipMinCents)}.`);
      setChipInState("error");
      return;
    }
    setChipInState("submitting");
    setChipError(null);
    try {
      const result = await onChipIn({ amountCents: chipAmountCents });
      // "redirecting" → the surface is navigating to a hosted page; HOLD
      // submitting until it leaves (on return the surface passes
      // contributionState='paid'). "paid" → native sheet / paystack verified.
      if (result.kind === "paid") {
        setChipInState("success");
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      if (code.includes("brand_cannot_collect")) {
        setChipInState("paused");
        setChipError(null);
      } else if (code.includes("amount_below_min")) {
        setChipError(
          chipMinCents !== null ? `Add at least ${fmtChipWhole(chipMinCents)}.` : "Add a little more.",
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
  }, [onChipIn, chipInState, chipAmountCents, chipMinCents, fmtChipWhole]);

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
              : config.manualApproval
                ? "The host approves each guest after you reply."
                : "Anyone with the link can RSVP.";

  const showContactForm =
    (!isLoggedIn ||
      (props.requirePrimaryContact === true && !primaryContactComplete)) &&
    !goingResolved &&
    !pendingResolved &&
    !waitlistedResolved &&
    !maybeResolved &&
    !(ctaState === "full" && !config.waitlistEnabled);

  // ── per-guest plus-one stepper + contact mini-forms (§H.5) ──
  const showGuestStepper =
    config.allowPlusOnes &&
    !goingResolved &&
    !pendingResolved &&
    !waitlistedResolved &&
    !maybeResolved &&
    !(ctaState === "full" && !config.waitlistEnabled);

  const addGuest = useCallback(() => {
    setGuests((g) =>
      g.length < config.plusOnesMax
        ? [...g, { name: "", email: "", phone: "" }]
        : g,
    );
  }, [config.plusOnesMax]);
  const removeGuest = useCallback(() => {
    setGuests((g) => (g.length > 0 ? g.slice(0, -1) : g));
  }, []);
  const updateGuest = useCallback(
    (i: number, field: keyof RsvpGuestContact, value: string) => {
      setGuests((g) =>
        g.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)),
      );
    },
    [],
  );

  const contactForm = showContactForm ? (
    <View style={[styles.formCard, surface.card]} testID="orch-1157-rsvp-contact">
      <Text style={[styles.formMicro, surface.tertiaryText]}>
        We'll only use this to update you about this event.
      </Text>
      <RsvpField
        label="Your name"
        value={guestName}
        onChangeText={setGuestName}
        placeholder="First and last name"
        palette={palette}
        invalid={guestName.length > 0 && guestName.trim().length === 0}
        invalidMsg="Required"
        autoCapitalize="words"
        testID="orch-1150-rsvp-name"
      />
      <RsvpField
        label="Email"
        value={guestEmail}
        onChangeText={setGuestEmail}
        placeholder="you@email.com"
        palette={palette}
        invalid={guestEmail.length > 0 && !EMAIL_RE.test(guestEmail.trim())}
        invalidMsg="Enter a valid email"
        keyboardType="email-address"
        autoCapitalize="none"
        testID="orch-1150-rsvp-email"
      />
      {/* ORCH-1295 [chip-in-post-payment-polish] — BUG 2: the surface may inject a
          country-code-aware phone field (@mingla/phone-input). Absent → the plain
          text field (native fallback, unchanged). */}
      {renderPhoneField
        ? renderPhoneField({
            countryCode: phoneCountry,
            localDigits: phoneLocalDigits,
            onChangeCountry: (isoCode, composedE164) => {
              setPhoneCountry(isoCode);
              setGuestPhone(composedE164);
            },
            onChangeLocalDigits: (digits, composedE164) => {
              setPhoneLocalDigits(digits);
              setGuestPhone(composedE164);
            },
            invalid: guestPhone.length > 0 && !PHONE_RE.test(guestPhone.trim()),
            palette,
            disabled: submitting,
          })
        : (
          <RsvpField
            label="Phone"
            value={guestPhone}
            onChangeText={setGuestPhone}
            placeholder="+1 555 123 4567"
            palette={palette}
            invalid={guestPhone.length > 0 && !PHONE_RE.test(guestPhone.trim())}
            invalidMsg="Enter a valid phone number"
            keyboardType="phone-pad"
            autoCapitalize="none"
            testID="orch-1150-rsvp-phone"
          />
        )}
    </View>
  ) : null;

  const guestForms = showGuestStepper ? (
    <View style={[styles.guestBlock, surface.card]} testID="orch-1163-rsvp-guests">
      <View style={styles.guestHeaderRow}>
        <Text style={[styles.guestHeaderLabel, surface.secondaryText]}>
          Bringing extras?
        </Text>
        <View style={styles.stepperRow}>
          <Pressable
            onPress={removeGuest}
            disabled={guests.length <= 0}
            accessibilityRole="button"
            accessibilityLabel="Remove one extra guest"
            style={[styles.stepBtn, { borderColor: palette.panelBorder, opacity: guests.length <= 0 ? 0.4 : 1 }]}
            testID="orch-1157-rsvp-plus-minus"
          >
            <Minus size={18} color={palette.accent} />
          </Pressable>
          <Text style={[styles.stepCount, { color: palette.primaryText, fontFamily: boldFamily }]}>
            +{guests.length}
          </Text>
          <Pressable
            onPress={addGuest}
            disabled={guests.length >= config.plusOnesMax}
            accessibilityRole="button"
            accessibilityLabel="Add one extra guest"
            style={[styles.stepBtn, { borderColor: palette.panelBorder, opacity: guests.length >= config.plusOnesMax ? 0.4 : 1 }]}
            testID="orch-1157-rsvp-plus-plus"
          >
            <Plus size={18} color={palette.accent} />
          </Pressable>
        </View>
      </View>
      {guests.map((g, i) => (
        <View key={`guest-${i}`} style={styles.guestRow}>
          <Text style={[styles.guestRowTitle, surface.tertiaryText]}>
            Guest {i + 1}
          </Text>
          <RsvpField
            label="Name"
            value={g.name}
            onChangeText={(v) => updateGuest(i, "name", v)}
            placeholder="First and last name"
            palette={palette}
            invalid={g.name.length > 0 && g.name.trim().length === 0}
            invalidMsg="Required"
            autoCapitalize="words"
            testID={`orch-1163-rsvp-guest-${i}-name`}
          />
          <RsvpField
            label="Email"
            value={g.email}
            onChangeText={(v) => updateGuest(i, "email", v)}
            placeholder="guest@email.com"
            palette={palette}
            invalid={g.email.length > 0 && !EMAIL_RE.test(g.email.trim())}
            invalidMsg="Enter a valid email"
            keyboardType="email-address"
            autoCapitalize="none"
            testID={`orch-1163-rsvp-guest-${i}-email`}
          />
          <RsvpField
            label="Phone"
            value={g.phone}
            onChangeText={(v) => updateGuest(i, "phone", v)}
            placeholder="+1 555 123 4567"
            palette={palette}
            invalid={g.phone.length > 0 && !PHONE_RE.test(g.phone.trim())}
            invalidMsg="Enter a valid phone number"
            keyboardType="phone-pad"
            autoCapitalize="none"
            testID={`orch-1163-rsvp-guest-${i}-phone`}
          />
        </View>
      ))}
    </View>
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
        plusGuests={guests.map((g) => ({ name: g.name.trim() }))}
        submitting={submitting}
        errorText={confirmError}
        onConfirm={() => void onConfirmGoing()}
        onCancel={() => setConfirmOpen(false)}
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
          minCents={chipMinCents}
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
  const popupChipEligible = chipFeatureOn &&
    successDetails !== null &&
    successDetails.status !== "waitlisted";

  const successPopup = (
    <Suspense fallback={null}>
      <RsvpSuccessPopup
        visible={successDetails !== null}
        palette={palette}
        theme={theme}
        details={successDetails}
        showCalendarNudge={isLoggedIn}
        onDownloadPass={props.onDownloadPass}
        onClose={() => setSuccessDetails(null)}
        chipInPanel={popupChipEligible ? buildChipPanel("orch-1291-rsvp-chipin-panel-popup") : undefined}
      />
    </Suspense>
  );

  // Inline §5.5 mount — SAME {going} gate (SC-2). Rendered between the §5
  // decision box and the §6 brand card by the body below.
  const chipInInlinePanel: React.ReactNode = chipFeatureOn && guestStatus === "going"
    ? buildChipPanel("orch-1291-rsvp-chipin-panel-inline")
    : null;

  // ── ORCH-1163-R3 — floating-bar details modal (extracted to RsvpDetailsModal,
  // a portal <Modal> mirroring RsvpGoingConfirmDialog so the BODY file hosts NO
  // scroll root — shell-agnostic invariant §A.2). Re-hosts the SAME contactForm /
  // guestForms nodes (shared state → values sync with the inline §5 box). The +1
  // forms are omitted for Can't-go. Continue is disabled until contactReady. ──
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
        errorNode={errorNode}
        continueLabel={detailsContinueLabel}
        continueEnabled={contactReady}
        submitting={submitting}
        onContinue={onDetailsContinue}
        onCancel={closeDetails}
      />
    </Suspense>
  );

  return {
    surface,
    boldFamily,
    ctaState,
    guestStatus,
    guestApproval,
    submitting,
    contactReady,
    plusCount,
    errorNode,
    subcopy,
    onGoingTap,
    onMaybe: () => void submitDirect("maybe"),
    onNotGoing: () => void submitDirect("not_going"),
    onFloatingGoing,
    onFloatingMaybe,
    onFloatingNotGoing,
    contactForm,
    guestForms,
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
      // ORCH-1340 — the avatar sample + the see-who's-going affordance seam
      // (the floating-bar mount keeps showMomentum=false, so no cluster there).
      guestSample={config.guestSample ?? []}
      onSeeWhosGoing={config.onSeeWhosGoing}
      waitlistEnabled={config.waitlistEnabled}
      submitting={state.submitting}
      contactReady={contactReadyOverride ?? state.contactReady}
      onGoing={onGoing ?? state.onGoingTap}
      onMaybe={onMaybe ?? state.onMaybe}
      onNotGoing={onNotGoing ?? state.onNotGoing}
      variant="floating-dock"
      showMomentum={showMomentum}
      micro={state.subcopy ?? undefined}
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
    <DecisionUnit
      palette={palette}
      theme={theme}
      config={config}
      state={state}
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

export const RsvpOfferingFloatingBar: React.FC<RsvpOfferingFloatingBarProps> = ({
  palette,
  theme,
  config,
  state,
  testID,
}) => (
  // ORCH-1163-R3 — the floating bar is SELF-SUFFICIENT: force contactReady so
  // Going/Maybe are never disabled into a dead end, and route through the floating
  // entry handlers (which open the details modal when contact info is missing).
  // The inline RsvpDecisionBox is untouched (real contactReady + inline handlers).
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
    testID={testID ?? "orch-1157-rsvp-floating-dock"}
  />
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
  const { event, brand, palette, theme, config, onOpenBrand, onOpenMaps, staticMapUrl = null, hideDecisionBox = false, testID, state } =
    props;
  const { surface, boldFamily } = state;
  const [aboutCollapsed, setAboutCollapsed] = useState(true);

  const toggleAbout = useCallback(() => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
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
    normalizeCityCountry(event.venueName) ?? normalizeCityCountry(event.address);
  const hiddenAreaLabel =
    normalizeCityCountry(event.address) ??
    cityCountry ??
    "Address shared after you RSVP";
  const venueAddressLabel =
    event.format === "online"
      ? "Online event"
      : addressRevealed
        ? event.address ?? event.venueName ?? "Location shared on RSVP"
        : hiddenAreaLabel;
  const addressUnlockCaption: string | null =
    event.format === "online" || addressRevealed
      ? null
      : "Full address shared once you're going";
  const venueMapsQuery =
    !addressRevealed || event.venueName === null
      ? null
      : [event.venueName, event.address].filter(Boolean).join(", ");
  const canOpenVenueMaps =
    venueMapsQuery !== null && venueMapsQuery.trim().length > 0 && onOpenMaps !== undefined;

  const aboutText = event.description.trim();
  const canCollapseAbout = aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
  const aboutCollapsedNow = canCollapseAbout && aboutCollapsed;

  return (
    <View testID={testID}>
      {/* FLOW A modals — all <Modal> (portal to root), gorhom-safe regardless of
          where in the tree they mount. The surface need not re-pin them.
          ORCH-1163-R3 — detailsModal hosts the floating-bar's self-sufficient
          name/email/phone + +1 forms (same shared state as the inline §5 box). */}
      {state.confirmDialog}
      {state.successPopup}
      {state.detailsModal}

      {/* (2) Event name lead block. */}
      <View style={styles.leadBlock}>
        <Text style={[styles.title, surface.primaryText, { fontFamily: boldFamily }]}>
          {event.name.length > 0 ? event.name : "Untitled event"}
        </Text>
      </View>

      {/* (3) Date & time — FULL-WIDTH solid-fill row (orch-1167-date-row parity). */}
      {event.dateLine.length > 0 ||
      (event.dateSubline !== null && event.dateSubline.length > 0) ? (
        <View
          style={[styles.dateRow, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}
          testID="orch-1167-date-row"
        >
          <Calendar size={18} color={palette.accent} />
          <View style={styles.dateTextCol}>
            {event.dateLine.length > 0 ? (
              <Text
                style={[styles.dateLine, { color: palette.primaryText, fontFamily: boldFamily }]}
                testID="orch-1167-date-line"
              >
                {event.dateLine}
              </Text>
            ) : null}
            {event.dateSubline !== null && event.dateSubline.length > 0 ? (
              <Text style={[styles.dateSubline, { color: palette.secondaryText, fontFamily: boldFamily }]}>
                {event.dateSubline}
              </Text>
            ) : null}
            {doorsLine !== null ? (
              <Text
                style={[styles.dateSubline, { color: palette.secondaryText, fontFamily: boldFamily }]}
                testID="orch-1157-rsvp-doors"
              >
                {doorsLine}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* (4) Pills row — format → vibes → party-types → music-genres. NO tickets-left. */}
      <View style={styles.pillsRow} testID="orch-1167-pills-row">
        <Pill palette={palette} font={boldFamily}>{formatLabel}</Pill>
        {vibeTags.map((tag, i) => (
          <Pill key={`vibe-${i}`} palette={palette} font={boldFamily}>{taxonomyLabel(tag)}</Pill>
        ))}
        {partyTypes.map((tag, i) => (
          <Pill key={`party-${i}`} palette={palette} font={boldFamily}>{taxonomyLabel(tag)}</Pill>
        ))}
        {musicGenres.map((tag, i) => (
          <Pill key={`music-${i}`} palette={palette} font={boldFamily}>{taxonomyLabel(tag)}</Pill>
        ))}
      </View>

      {/* (5) DECISION BOX — INLINE single-owner <RsvpDecisionBox> (parallel to
          EventTicketBox): contact form (anon) + per-guest mini-forms + the shared
          decision (Going → confirm dialog). ORCH-1163-R2 (change 2): on desktop web
          (hideDecisionBox=true) the box is relocated to the sticky right panel by
          the surface (the SAME <RsvpDecisionBox>), so it does not paint a second
          time inline. Phones + both native apps keep the inline box. The
          `orch-1163-rsvp-inline-box` testID anchor stays in source for the
          canonical-order gate (rendered by RsvpDecisionBox). */}
      {hideDecisionBox ? null : (
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
      {state.chipInInlinePanel !== null ? (
        <View style={styles.section} testID="orch-1291-rsvp-chipin-section">
          {state.chipInInlinePanel}
        </View>
      ) : null}

      {/* (6) Presented By — brand card → onOpenBrand. */}
      <View style={styles.section}>
        <Pressable
          onPress={() => {
            if (brand?.slug !== undefined) onOpenBrand?.(brand.slug);
          }}
          disabled={brand?.slug === undefined || onOpenBrand === undefined}
          accessibilityRole={onOpenBrand !== undefined ? "button" : undefined}
          accessibilityLabel={brand?.displayName !== undefined ? `View ${brand.displayName}` : "View brand"}
          style={[styles.brandRow, surface.card]}
          testID="orch-1157-rsvp-brand"
        >
          <View style={[styles.brandTile, { backgroundColor: palette.accent }]}>
            {brand?.photo !== undefined && brand.photo.length > 0 ? (
              <Image source={{ uri: brand.photo }} style={styles.brandPhoto} resizeMode="cover" />
            ) : (
              <View style={styles.brandInitialWrap}>
                <Text style={[styles.brandInitial, { color: palette.accentText, fontFamily: boldFamily }]}>
                  {(brand?.displayName?.trim()[0] ?? "•").toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.brandTextCol}>
            <Text style={[styles.brandKicker, surface.tertiaryText]}>Presented by</Text>
            <Text style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}>
              {brand?.displayName ?? "Brand"}
            </Text>
          </View>
          {onOpenBrand !== undefined ? (
            <Text style={[styles.brandCta, { color: palette.accent }]}>View</Text>
          ) : null}
        </Pressable>
      </View>

      {/* (7) About — collapsible. */}
      {aboutText.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>About</Text>
          <Text
            style={[styles.about, surface.secondaryText]}
            numberOfLines={aboutCollapsedNow ? 3 : undefined}
            ellipsizeMode="tail"
          >
            {aboutText}
          </Text>
          {canCollapseAbout ? (
            <Pressable onPress={toggleAbout} accessibilityRole="button" style={styles.aboutToggleRow}>
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
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            Where you&rsquo;ll be
          </Text>
          <View style={[styles.venueCard, surface.card]}>
            <View style={[styles.venueDisk, { backgroundColor: palette.accent }]}>
              <Globe size={18} color={palette.accentText} />
            </View>
            <View style={styles.venueTextCol}>
              <Text style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}>Online</Text>
              <Text style={[styles.venueAddr, surface.secondaryText]}>
                Link shared with guests who RSVP.
              </Text>
            </View>
          </View>
        </View>
      ) : event.venueName !== null || cityCountry !== null ? (
        <View style={styles.section}>
          <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
            Where you&rsquo;ll be
          </Text>
          {staticMapUrl !== null ? (
            <Image
              source={{ uri: staticMapUrl }}
              style={[styles.whereMap, { borderColor: palette.panelBorder }]}
              resizeMode="cover"
              testID="orch-1167-where-map"
            />
          ) : null}
          <Pressable
            onPress={() => {
              if (canOpenVenueMaps && venueMapsQuery !== null) onOpenMaps?.(venueMapsQuery);
            }}
            disabled={!canOpenVenueMaps}
            accessibilityRole={canOpenVenueMaps ? "button" : undefined}
            style={[styles.venueCard, surface.card]}
          >
            <View style={[styles.venueDisk, { backgroundColor: palette.accent }]}>
              <MapPin size={18} color={palette.accentText} />
            </View>
            <View style={styles.venueTextCol}>
              {event.venueName !== null && event.venueName.length > 0 ? (
                <Text style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}>
                  {event.venueName}
                </Text>
              ) : null}
              <Text style={[styles.venueAddr, surface.secondaryText]}>
                {venueAddressLabel.length > 0 ? venueAddressLabel : cityCountry ?? venueAddressLabel}
              </Text>
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
              <View style={[styles.venuePill, { backgroundColor: palette.accent }]}>
                <Text style={[styles.venuePillText, { color: palette.accentText }]}>Open maps</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// Sub-components.
// ───────────────────────────────────────────────────────────────────────────

const Pill: React.FC<{ palette: ThemePalette; font: string; children: React.ReactNode }> = ({
  palette,
  font,
  children,
}) => (
  <View style={[styles.pill, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}>
    <Text style={[styles.pillText, { color: palette.primaryText, fontFamily: font }]}>{children}</Text>
  </View>
);

const RsvpField: React.FC<{
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  palette: ThemePalette;
  invalid: boolean;
  invalidMsg: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  testID?: string;
}> = ({
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
}) => {
  const surface = offeringSurfaceStyles(palette);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, surface.tertiaryText]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.tertiaryText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={label}
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
};

const styles = StyleSheet.create({
  leadBlock: { marginBottom: 4 },
  title: { fontSize: 32, lineHeight: 35, fontWeight: "900", letterSpacing: -0.5 },
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
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 13, fontWeight: "700" },
  section: { marginTop: 24 },
  secTitle: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 12 },
  about: { fontSize: 16, lineHeight: 23 },
  aboutToggleRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  aboutToggle: { fontSize: 14, fontWeight: "700" },
  // contact + per-guest forms
  formCard: { borderRadius: 16, padding: 16, marginBottom: 14, overflow: "hidden" },
  formMicro: { fontSize: 12, marginBottom: 10 },
  guestBlock: { borderRadius: 16, padding: 16, marginBottom: 14, overflow: "hidden" },
  guestHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  guestHeaderLabel: { fontSize: 14, fontWeight: "700" },
  guestRow: { marginTop: 10 },
  guestRowTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, marginBottom: 6, marginTop: 6 },
  stepperRow: { flexDirection: "row", alignItems: "center" },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: { fontSize: 20, fontWeight: "800", lineHeight: 22 },
  stepCount: { fontSize: 16, fontWeight: "800", minWidth: 40, textAlign: "center" },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "700", marginBottom: 5 },
  fieldInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 13 : 10, fontSize: 15 },
  fieldError: { color: "#e5484d", fontSize: 12, marginTop: 4 },
  errorText: { color: "#e5484d", fontSize: 13, marginTop: 10 },
  // brand
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  brandTile: { width: 42, height: 42, borderRadius: 999, overflow: "hidden" },
  brandPhoto: { width: "100%", height: "100%" },
  brandInitialWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  brandInitial: { fontSize: 18, fontWeight: "900" },
  brandTextCol: { flexShrink: 1, flexGrow: 1 },
  brandKicker: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  brandName: { fontSize: 15, fontWeight: "800", marginTop: 1 },
  brandCta: { fontSize: 13, fontWeight: "800" },
  // where
  whereMap: { width: "100%", height: 180, borderRadius: 14, borderWidth: 1, backgroundColor: "#000", marginBottom: 12 },
  venueCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14 },
  venueDisk: { width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  venueGlyph: { fontSize: 18, fontWeight: "900" },
  venueTextCol: { flex: 1, minWidth: 0 },
  venueName: { fontSize: 15, fontWeight: "800" },
  venueAddr: { fontSize: 13, marginTop: 2 },
  venueUnlockCaption: { fontSize: 12, marginTop: 4 },
  venuePill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  venuePillText: { fontSize: 12, fontWeight: "800" },
});

export default RsvpOfferingBody;
