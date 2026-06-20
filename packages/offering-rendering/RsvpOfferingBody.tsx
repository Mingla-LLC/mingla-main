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
 *   5. Going/Maybe/Not  (INLINE decision box — shared RsvpMomentumDecision + the
 *                        per-guest plus-one mini-forms; Going → confirm dialog)
 *   6. Presented By     (brand card → onOpenBrand)
 *   7. About            (collapsible read-more/show-less)
 *   8. Where you'll be  (server-proxied static map; city-level when hidden)
 *   9. Floating button  (<RsvpOfferingDecisionDock>, surface-pinned)
 */

import React, { useCallback, useMemo, useState } from "react";
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
import { resolveRsvpCta, type RsvpCtaState } from "./offeringCta";
import { type PublicBrandProps, type PublicEventProps } from "./types";
import { type ResolvedTheme } from "./designTokens";
import { normalizeCityCountry } from "./normalizeCityCountry";
import { RsvpMomentumDecision } from "./RsvpMomentumDecision";
import { RsvpGoingConfirmDialog } from "./RsvpGoingConfirmDialog";
import { RsvpSuccessPopup, type RsvpConfirmationDetails } from "./RsvpSuccessPopup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s()-]{7,20}$/;
const ABOUT_COLLAPSE_THRESHOLD = 160;

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
}

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
}

export interface RsvpOfferingBodyProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  isLoggedIn: boolean;
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
}

export interface RsvpOfferingState extends RsvpDecisionState {
  contactForm: React.ReactNode;
  guestForms: React.ReactNode;
  confirmDialog: React.ReactNode;
  successPopup: React.ReactNode;
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
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
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

  const primaryValid =
    isLoggedIn ||
    (guestName.trim().length > 0 &&
      EMAIL_RE.test(guestEmail.trim()) &&
      PHONE_RE.test(guestPhone.trim()));
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
    !isLoggedIn &&
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
            <Text style={[styles.stepGlyph, { color: palette.accent }]}>–</Text>
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
            <Text style={[styles.stepGlyph, { color: palette.accent }]}>+</Text>
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
  );

  const successPopup = (
    <RsvpSuccessPopup
      visible={successDetails !== null}
      palette={palette}
      theme={theme}
      details={successDetails}
      showCalendarNudge={isLoggedIn}
      onClose={() => setSuccessDetails(null)}
    />
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
    contactForm,
    guestForms,
    confirmDialog,
    successPopup,
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
  testID?: string;
}> = ({ palette, theme, config, state, showMomentum, testID }) => {
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
      waitlistEnabled={config.waitlistEnabled}
      submitting={state.submitting}
      contactReady={state.contactReady}
      onGoing={state.onGoingTap}
      onMaybe={state.onMaybe}
      onNotGoing={state.onNotGoing}
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
// (9) RsvpOfferingDecisionDock — the floating decision (Going/Maybe/Not-going),
// surface-pinned overlay (mirrors EventOfferingFloatingBar). The surface pins it
// absolutely at the bottom on phone (gorhom-safe — the body never owns the scroll
// root or the dock). Takes the SHARED state from useRsvpOfferingState so the dock
// and the inline box drive one state machine.
// ───────────────────────────────────────────────────────────────────────────

export interface RsvpOfferingDecisionDockProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  state: RsvpOfferingState;
  testID?: string;
}

export const RsvpOfferingDecisionDock: React.FC<RsvpOfferingDecisionDockProps> = ({
  palette,
  theme,
  config,
  state,
  testID,
}) => (
  <DecisionUnit
    palette={palette}
    theme={theme}
    config={config}
    state={state}
    showMomentum={false}
    testID={testID ?? "orch-1157-rsvp-floating-dock"}
  />
);

// ───────────────────────────────────────────────────────────────────────────
// The body. Renders sections 2–8 content + the inline decision box (§0-5) + the
// confirm dialog + success popup (both <Modal>, portal-safe). The surface pins the
// cover (1) + the floating dock (9). The decision STATE is passed in (lifted by the
// surface via useRsvpOfferingState) so the inline box + dock stay in sync.
// ───────────────────────────────────────────────────────────────────────────

export const RsvpOfferingBody: React.FC<
  RsvpOfferingBodyProps & { state: RsvpOfferingState }
> = (props) => {
  const { event, brand, palette, theme, config, onOpenBrand, onOpenMaps, staticMapUrl = null, testID, state } =
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
      {/* FLOW A modals — both <Modal> (portal to root), gorhom-safe regardless of
          where in the tree they mount. The surface need not re-pin them. */}
      {state.confirmDialog}
      {state.successPopup}

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
          <Text style={[styles.dateGlyph, { color: palette.accent }]}>◷</Text>
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
          <Pill key={`vibe-${i}`} palette={palette} font={boldFamily}>{tag}</Pill>
        ))}
        {partyTypes.map((tag, i) => (
          <Pill key={`party-${i}`} palette={palette} font={boldFamily}>{tag}</Pill>
        ))}
        {musicGenres.map((tag, i) => (
          <Pill key={`music-${i}`} palette={palette} font={boldFamily}>{tag}</Pill>
        ))}
      </View>

      {/* (5) Going / Maybe / Not-going box — INLINE. Contact form (anon) + per-guest
          mini-forms + the shared decision (Going → confirm dialog). */}
      <View style={styles.section} testID="orch-1163-rsvp-inline-box">
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
              <Text style={[styles.venueGlyph, { color: palette.accentText }]}>◯</Text>
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
              <Text style={[styles.venueGlyph, { color: palette.accentText }]}>⌖</Text>
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
