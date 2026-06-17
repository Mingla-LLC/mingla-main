/**
 * RsvpPublicBody — public RSVP page body (buyer-web + business iOS/Android + the
 * business-web draft preview), recomposed to Direction C "Momentum" by ORCH-1156
 * [rsvp-public-redesign].
 *
 * The Going / Maybe / Can't public surface for an event_type='rsvp' row, mounted
 * by PublicEventPage when event.event_type === 'rsvp'. Reuses the SAME ORCH-1138
 * ParallaxCoverShell (immersive cover, X · Share · Mute chrome, brand palette +
 * bold fonts, hero) so an RSVP page looks like a sibling of the ticketed page —
 * but it carries NO ticket tiers, NO checkout, NO money.
 *
 * Direction C (ORCH-1156): the gravitational center is the SHARED
 * `RsvpMomentumDecision` unit — going COUNT + capacity METER + an ANONYMOUS
 * faceless attendee cluster + the Going/Maybe/Can't decision, theme-accent driven
 * ("loudness dial"). The decision is the thumb-zone HERO: a floating-dock at the
 * bottom on phone (<1024px), a sticky right panel on desktop (≥1024px). Party-type
 * vibe chips + "You're invited" kicker (color inherits the title) lead the body.
 *
 * do NOT merge back into the ticket/checkout path — RSVP has zero tickets + no
 * money gate; the CTA writes a Going/Maybe/Not-going row via public-submit-rsvp,
 * never an order, and never navigates to /checkout. NO price / Reserve / cart /
 * checkout affordance anywhere (I-PROPOSED-1156-RSVP-NO-CHECKOUT-AFFORDANCE).
 * Social proof is honest: count + meter + faceless cluster ONLY — no guest
 * names/faces, no public maybe/waitlist count (I-PROPOSED-1156-RSVP-SOCIAL-PROOF-
 * ANON-ONLY; constitution rule 9).
 *
 * Anon-tolerant: a logged-out link guest supplies name + email + phone (all three
 * REQUIRED — A4-NEW); a logged-in app user skips the form. All states handled
 * (open / full / waitlist / pending / going / maybe / not_going / submitting /
 * error) — no dead ends. Android: opaque card fills
 * (ANDROID_GLASS_USES_OPAQUE_FALLBACK), honored inside RsvpMomentumDecision.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import {
  ParallaxCoverShell,
  RsvpMomentumDecision,
  offeringSurfaceStyles,
  normalizeCityCountry,
  useResponsiveLayout,
} from "@mingla/offering-rendering";
import {
  resolveRsvpCta,
  boldFontFamily,
  type PublicEventProps,
  type PublicBrandProps,
  type ThemePalette,
  type ResolvedTheme,
  type RsvpCtaState,
} from "@mingla/event-rendering";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s()-]{7,20}$/;

/** What the public RSVP body needs from the resolved event (RSVP host-control). */
export interface RsvpPublicConfig {
  capacity: number | null;
  goingCount: number;
  allowPlusOnes: boolean;
  plusOnesMax: number;
  waitlistEnabled: boolean;
  manualApproval: boolean;
}

export interface RsvpPublicBodyProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpPublicConfig;
  /** true → logged-in app user (skip the contact form). */
  isLoggedIn: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
  /**
   * ORCH-1150 R2 D-7b — scroll runway. A short RSVP page (no ticket tiers) sits
   * under an ~80%-tall pinned-cover spacer, so with a zero bottom inset the body
   * barely exceeds the viewport ⇒ near-zero scroll travel ⇒ the (correctly
   * pinned) cover dominates and content reads as "stuck behind the cover." A
   * positive `contentBottomInset` adds the runway so the body scrolls UP and OVER
   * the cover — parity with the trip / experience / ticketed routes. ORCH-1156
   * also reserves clearance for the phone floating decision dock. Forwarded to
   * the shared cover shell's `contentBottomInset`. Defaults to a positive value
   * so the runway exists even if a caller forgets to pass it.
   */
  contentBottomInset?: number;
  /**
   * Convention parity with FoundationEventPreview / trip / experience callers.
   * Forwarded to the shell so a caller could later add scroll-aware dock reveal.
   */
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (event: LayoutChangeEvent) => void;
  /**
   * Submits the RSVP. Returns the resolved server state so the body can reflect
   * pending / waitlist / going / maybe. Throws on error (the body shows an inline
   * error, never a dead end).
   */
  onSubmit: (input: {
    rsvpStatus: "going" | "not_going" | "maybe";
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    plusCount: number;
  }) => Promise<{
    status: "going" | "not_going" | "waitlisted" | "maybe";
    approvalStatus: "pending" | "approved";
  }>;
  safeAreaTop?: number;
  /** Bottom safe-area inset for the phone floating decision dock. */
  safeAreaBottom?: number;
  testID?: string;
}

type SubmitPhase = "idle" | "submitting";

export const RsvpPublicBody: React.FC<RsvpPublicBodyProps> = ({
  event,
  brand,
  palette,
  theme,
  config,
  isLoggedIn,
  muted,
  onToggleMute,
  onClose,
  onShare,
  onOpenBrand,
  onOpenMaps,
  onSubmit,
  // ORCH-1150 R2 D-7b — default to a positive runway so the short RSVP page
  // always clears the pinned cover + the phone floating dock even if the caller
  // omits the prop.
  contentBottomInset = 96,
  onScroll,
  onScrollViewLayout,
  safeAreaTop = 0,
  safeAreaBottom = 0,
  testID,
}) => {
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);
  const { isDesktop } = useResponsiveLayout();

  // Contact capture (anon link guest). Logged-in users skip these.
  const [guestName, setGuestName] = useState<string>("");
  const [guestEmail, setGuestEmail] = useState<string>("");
  const [guestPhone, setGuestPhone] = useState<string>("");
  const [plusCount, setPlusCount] = useState<number>(0);

  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // The guest's resolved own state after a successful submit (null = not yet).
  const [guestStatus, setGuestStatus] = useState<
    "going" | "not_going" | "waitlisted" | "maybe" | null
  >(null);
  const [guestApproval, setGuestApproval] = useState<
    "pending" | "approved" | null
  >(null);

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

  const emailValid = EMAIL_RE.test(guestEmail.trim());
  const phoneValid = PHONE_RE.test(guestPhone.trim());
  const nameValid = guestName.trim().length > 0;
  // A4-NEW: link guests must enter name + valid email + valid phone before Going.
  const contactReady = isLoggedIn || (nameValid && emailValid && phoneValid);

  const submit = useCallback(
    async (rsvpStatus: "going" | "not_going" | "maybe"): Promise<void> => {
      if (phase === "submitting") return;
      // A4-NEW: Going AND Maybe both require a reachable guest (a Maybe must be
      // updatable). Declining (not_going) needs no contact.
      if ((rsvpStatus === "going" || rsvpStatus === "maybe") && !contactReady) {
        setErrorMsg("Add your name, email, and phone to RSVP.");
        return;
      }
      setErrorMsg(null);
      setPhase("submitting");
      if (Platform.OS !== "web") {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
          () => undefined,
        );
      }
      try {
        const result = await onSubmit({
          rsvpStatus,
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
          guestPhone: guestPhone.trim(),
          plusCount: config.allowPlusOnes ? plusCount : 0,
        });
        setGuestStatus(result.status);
        setGuestApproval(result.approvalStatus);
      } catch (err) {
        const code = err instanceof Error ? err.message : String(err);
        if (code.includes("rsvp_contact_required")) {
          setErrorMsg("Add your name, email, and phone to RSVP.");
        } else if (code.includes("rsvp_phone_invalid")) {
          setErrorMsg("Enter a valid phone number.");
        } else if (code.includes("rsvp_full")) {
          setErrorMsg("This event just filled up.");
        } else if (code.includes("rsvp_not_open")) {
          setErrorMsg("RSVPs are closed for this event.");
        } else {
          setErrorMsg("Couldn't save your RSVP. Try again.");
        }
      } finally {
        setPhase("idle");
      }
    },
    [
      phase,
      contactReady,
      onSubmit,
      guestName,
      guestEmail,
      guestPhone,
      plusCount,
      config.allowPlusOnes,
    ],
  );

  const cityCountry =
    normalizeCityCountry(event.venueName) ??
    normalizeCityCountry(event.address);
  const venueAddressLabel =
    event.format === "online"
      ? "Online event"
      : (event.address ?? event.venueName ?? "Location shared on RSVP");
  const venueMapsQuery =
    event.venueName === null
      ? null
      : [event.venueName, event.address].filter(Boolean).join(", ");
  const canOpenVenueMaps =
    venueMapsQuery !== null &&
    venueMapsQuery.trim().length > 0 &&
    onOpenMaps !== undefined;

  const submitting = phase === "submitting";

  const goingResolved = guestStatus === "going" && guestApproval === "approved";
  const pendingResolved = guestApproval === "pending";
  const notGoingResolved = guestStatus === "not_going";
  const waitlistedResolved = guestStatus === "waitlisted";
  // ORCH-1150 R2 D-10: a resolved (non-binding) Maybe. NOT a terminal dead end —
  // a Maybe can still upgrade to Going or decline.
  const maybeResolved = guestStatus === "maybe";

  // Resolved-state subcopy (ORCH-1156 keeps the honest ORCH-1150 R2 response copy;
  // the headline now lives in the kicker/momentum, so this reads as the micro line
  // beneath the decision). "You're marked as Maybe — we'll keep you posted."
  const subcopy: string | null =
    pendingResolved
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

  // The contact form shows only for a logged-out guest in an unresolved,
  // contact-eligible state (same gate as ORCH-1150).
  const showContactForm =
    !isLoggedIn &&
    !goingResolved &&
    !pendingResolved &&
    !waitlistedResolved &&
    !maybeResolved &&
    !(ctaState === "full" && !config.waitlistEnabled);

  // ── the contact-capture block (anon link guest) ──
  const contactForm = showContactForm ? (
    <View style={[styles.formCard, surface.card]} testID="orch-1156-rsvp-contact">
      <Text style={[styles.formMicro, surface.tertiaryText]}>
        We'll only use this to update you about this event.
      </Text>
      <RsvpField
        label="Your name"
        value={guestName}
        onChangeText={setGuestName}
        placeholder="First and last name"
        palette={palette}
        surface={surface}
        invalid={guestName.length > 0 && !nameValid}
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
        surface={surface}
        invalid={guestEmail.length > 0 && !emailValid}
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
        surface={surface}
        invalid={guestPhone.length > 0 && !phoneValid}
        invalidMsg="Enter a valid phone number"
        keyboardType="phone-pad"
        autoCapitalize="none"
        testID="orch-1150-rsvp-phone"
      />
    </View>
  ) : null;

  const errorNode =
    errorMsg !== null ? (
      <Text style={styles.errorText} testID="orch-1150-rsvp-error">
        {errorMsg}
      </Text>
    ) : null;

  // The shared Direction-C decision (Going / Maybe / Can't). testIDs preserve the
  // ORCH-1150 contract IDs so existing guards stay green; the buttons now live in
  // the shared RsvpMomentumDecision unit.
  const decision = (
    <RsvpMomentumDecision
      palette={palette}
      theme={theme}
      goingCount={config.goingCount}
      capacity={config.capacity}
      ctaState={ctaState}
      guestStatus={guestStatus}
      guestApproval={guestApproval}
      partyTypes={event.partyTypes}
      allowPlusOnes={config.allowPlusOnes}
      plusOnesMax={config.plusOnesMax}
      plusCount={plusCount}
      onPlusChange={setPlusCount}
      waitlistEnabled={config.waitlistEnabled}
      submitting={submitting}
      contactReady={contactReady}
      onGoing={() => void submit("going")}
      onMaybe={() => void submit("maybe")}
      onNotGoing={() => void submit("not_going")}
      variant={isDesktop ? "sticky-panel" : "floating-dock"}
      showMomentum={isDesktop}
      hostRow={isDesktop ? desktopHostRow(palette, surface, boldFamily, brand) : undefined}
      micro={subcopy ?? undefined}
      goingTestID="orch-1150-rsvp-going"
      maybeTestID="orch-1150-rsvp-maybe"
      notGoingTestID="orch-1150-rsvp-not-going"
    />
  );

  // The momentum unit + kicker + chips, rendered INLINE in the phone body (on
  // desktop they live in the sticky panel via showMomentum above).
  const inlineMomentum = !isDesktop ? (
    <RsvpMomentumDecision
      palette={palette}
      theme={theme}
      goingCount={config.goingCount}
      capacity={config.capacity}
      ctaState={ctaState}
      guestStatus={guestStatus}
      guestApproval={guestApproval}
      partyTypes={event.partyTypes}
      allowPlusOnes={false}
      plusOnesMax={0}
      plusCount={0}
      onPlusChange={() => undefined}
      waitlistEnabled={config.waitlistEnabled}
      submitting={submitting}
      contactReady={contactReady}
      onGoing={() => undefined}
      onMaybe={() => undefined}
      onNotGoing={() => undefined}
      variant="inline"
      showMomentum
      micro={undefined}
      testID="orch-1156-rsvp-inline-momentum"
    />
  ) : null;

  // Desktop sticky right panel (host + momentum + decision + any error). Built
  // as a node so the cover-shell opening tag stays clean (no nested View inside
  // the tag — keeps the bare body View the FIRST shell child for the layering
  // safety-net test).
  const stickyPanelNode = isDesktop ? (
    <View style={styles.deskPanelInner}>
      {decision}
      {errorNode}
    </View>
  ) : null;

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      <ParallaxCoverShell
        palette={palette}
        theme={theme}
        coverMediaUrl={event.coverMediaUrl}
        coverMediaType={
          event.coverMediaType === "video"
            ? "video"
            : event.coverMediaType === "gif"
              ? "gif"
              : event.coverMediaUrl !== null
                ? "image"
                : null
        }
        coverHue={event.coverHue}
        entranceAnimationKey={`rsvp:${event.id}`}
        muted={muted}
        onToggleMute={onToggleMute}
        showMute={event.coverMediaType === "video"}
        onClose={onClose}
        onShare={onShare}
        heroEyebrow={
          event.dateLine.length > 0 ? (
            <Text style={styles.heroEyebrow}>{event.dateLine}</Text>
          ) : undefined
        }
        heroTitle={
          <Text style={[styles.heroTitle, { fontFamily: boldFamily }]}>
            {event.name.length > 0 ? event.name : "Untitled event"}
          </Text>
        }
        stickyPanel={stickyPanelNode}
        contentBottomInset={contentBottomInset}
        safeAreaTop={safeAreaTop}
        onScroll={onScroll}
        onScrollViewLayout={onScrollViewLayout}
        testID={testID}
      >
        <View>{/* Brand chip */}
          <Brand
            brand={brand}
            surface={surface}
            boldFamily={boldFamily}
            onOpenBrand={onOpenBrand}
          />

          {/* Direction-C kicker + party chips + momentum unit (phone inline). */}
          {inlineMomentum}

          {/* Contact form (anon) — gates Going/Maybe via contactReady. */}
          {contactForm}
          {/* Inline error sits with the form on phone; desktop shows it in panel. */}
          {!isDesktop ? errorNode : null}

          {/* Date + venue facts */}
          {event.dateSubline !== null && event.dateSubline.length > 0 ? (
            <View style={[styles.factRow, surface.card]}>
              <Text style={[styles.factGlyph, { color: palette.accent }]}>◴</Text>
              <Text style={[styles.factText, surface.secondaryText]}>
                {event.dateSubline}
              </Text>
            </View>
          ) : null}
          <Venue
            event={event}
            palette={palette}
            surface={surface}
            boldFamily={boldFamily}
            cityCountry={cityCountry}
            venueAddressLabel={venueAddressLabel}
            venueMapsQuery={venueMapsQuery}
            canOpenVenueMaps={canOpenVenueMaps}
            onOpenMaps={onOpenMaps}
          />

          {/* About */}
          {event.description.trim().length > 0 ? (
            <View style={[styles.aboutCard, surface.card]}>
              <Text
                style={[styles.aboutTitle, surface.primaryText, { fontFamily: boldFamily }]}
              >
                About
              </Text>
              <Text style={[styles.aboutBody, surface.secondaryText]}>
                {event.description.trim()}
              </Text>
            </View>
          ) : null}
        </View>
      </ParallaxCoverShell>

      {/* ORCH-1156 — the Going/Maybe/Can't decision as the thumb-zone HERO: a
          floating dock pinned to the bottom on phone (<1024px), above the safe
          area. Hidden on desktop (the sticky panel carries the decision).
          I-PROPOSED-1156-RSVP-DECISION-IS-HERO. */}
      {!isDesktop ? (
        <View
          style={[
            styles.floatingDock,
            {
              backgroundColor: palette.page,
              borderTopColor: palette.panelBorder,
              paddingBottom: 12 + safeAreaBottom,
            },
          ]}
          testID="orch-1156-rsvp-floating-dock"
        >
          {decision}
        </View>
      ) : null}
    </View>
  );
};

// ── desktop sticky-panel host row (avatar + "Hosted by X") ──
const desktopHostRow = (
  palette: ThemePalette,
  surface: ReturnType<typeof offeringSurfaceStyles>,
  boldFamily: string,
  brand: PublicBrandProps | null,
): React.ReactNode => (
  <View style={styles.deskHostRow}>
    <View style={styles.deskHostTextCol}>
      <Text style={[styles.brandKicker, surface.tertiaryText]}>Hosted by</Text>
      <Text style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}>
        {brand?.displayName ?? "Brand"}
      </Text>
    </View>
  </View>
);

const Brand: React.FC<{
  brand: PublicBrandProps | null;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  boldFamily: string;
  onOpenBrand?: (brandSlug: string) => void;
}> = ({ brand, surface, boldFamily, onOpenBrand }) => {
  const tappable = brand?.slug !== undefined && onOpenBrand !== undefined;
  return (
    <Pressable
      style={[styles.brandRow, surface.card]}
      disabled={!tappable}
      accessibilityRole={tappable ? "button" : undefined}
      accessibilityLabel={
        brand?.displayName !== undefined
          ? `View ${brand.displayName}`
          : undefined
      }
      onPress={() => {
        if (brand?.slug !== undefined) onOpenBrand?.(brand.slug);
      }}
      testID="orch-1156-rsvp-brand"
    >
      <View style={styles.brandTextCol}>
        <Text style={[styles.brandKicker, surface.tertiaryText]}>Hosted by</Text>
        <Text
          style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}
        >
          {brand?.displayName ?? "Brand"}
        </Text>
      </View>
    </Pressable>
  );
};

const Venue: React.FC<{
  event: PublicEventProps;
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  boldFamily: string;
  cityCountry: string | null;
  venueAddressLabel: string;
  venueMapsQuery: string | null;
  canOpenVenueMaps: boolean;
  onOpenMaps?: (query: string) => void;
}> = ({
  event,
  palette,
  surface,
  boldFamily,
  cityCountry,
  venueAddressLabel,
  venueMapsQuery,
  canOpenVenueMaps,
  onOpenMaps,
}) => (
  <Pressable
    style={[styles.factRow, surface.card]}
    disabled={!canOpenVenueMaps}
    accessibilityRole={canOpenVenueMaps ? "button" : undefined}
    accessibilityLabel={
      canOpenVenueMaps ? `Open ${venueAddressLabel} in maps` : undefined
    }
    onPress={() => {
      if (canOpenVenueMaps && venueMapsQuery !== null) onOpenMaps?.(venueMapsQuery);
    }}
  >
    <Text style={[styles.factGlyph, { color: palette.accent }]}>◎</Text>
    <View style={styles.factCol}>
      {event.venueName !== null && event.venueName.length > 0 ? (
        <Text style={[styles.factText, surface.primaryText, { fontFamily: boldFamily }]}>
          {event.venueName}
        </Text>
      ) : null}
      <Text style={[styles.factSub, surface.secondaryText]}>
        {cityCountry ?? venueAddressLabel}
      </Text>
    </View>
  </Pressable>
);

const RsvpField: React.FC<{
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  palette: ThemePalette;
  surface: ReturnType<typeof offeringSurfaceStyles>;
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
  surface,
  invalid,
  invalidMsg,
  keyboardType = "default",
  autoCapitalize = "none",
  testID,
}) => (
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

const styles = StyleSheet.create({
  host: { flex: 1, position: "relative" },
  heroEyebrow: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 6,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 8,
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 34,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 10,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    overflow: "hidden",
  },
  brandTextCol: { flex: 1 },
  brandKicker: { fontSize: 11, letterSpacing: 0.4, marginBottom: 2 },
  brandName: { fontSize: 16, fontWeight: "800" },
  deskPanelInner: { width: "100%" },
  deskHostRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  deskHostTextCol: { flex: 1 },
  formCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    overflow: "hidden",
  },
  formMicro: { fontSize: 12, marginBottom: 10 },
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
  errorText: { color: "#e5484d", fontSize: 13, marginTop: 10, marginBottom: 2 },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    overflow: "hidden",
  },
  factGlyph: { fontSize: 18, marginRight: 12 },
  factCol: { flex: 1 },
  factText: { fontSize: 14, fontWeight: "600" },
  factSub: { fontSize: 13, marginTop: 2 },
  aboutCard: { borderRadius: 16, padding: 16, marginBottom: 10, overflow: "hidden" },
  aboutTitle: { fontSize: 15, fontWeight: "800", marginBottom: 8 },
  aboutBody: { fontSize: 14, lineHeight: 21 },
  // ORCH-1156 — phone floating decision dock (sticky bottom, thumb zone). Opaque
  // page fill + a hairline top border; safe-area inset added at runtime.
  floatingDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
