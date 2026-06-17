/**
 * RsvpPublicBody — ORCH-1150 [RSVP ticketless event] public page body.
 *
 * The Going / Not-going public surface for an event_type='rsvp' row, mounted by
 * PublicEventPage when event.event_type === 'rsvp'. Reuses the SAME ORCH-1138
 * ParallaxCoverShell (immersive cover, X · Share · Mute chrome, brand palette +
 * bold fonts, hero) so an RSVP page looks like a sibling of the ticketed page —
 * but it carries NO ticket tiers, NO checkout, NO money. Guests reply Going or
 * Not going; the host gets capacity / +1 / waitlist / approval.
 *
 * do NOT merge back into the ticket/checkout path — RSVP has zero tickets + no
 * money gate; the CTA writes a Going/Not-going row via public-submit-rsvp, never
 * an order, and never navigates to /checkout. See SPEC §6.
 *
 * Anon-tolerant: a logged-out link guest supplies name + email + phone (all
 * three REQUIRED — A4-NEW); a logged-in app user skips the form (profile
 * supplies contact + push). All states handled (open / full / waitlist /
 * pending / going / not_going / submitting / error) — no dead ends.
 * Android: opaque card fills (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
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
// ORCH-1150 R2 D-10: per-icon NAMED imports (never a `import *` barrel — that
// defeats tree-shake + blows the ORCH-1083 web bundle budget). Real lib on
// native; the ORCH-1137 metro web shim maps these three to real DOM-SVG glyphs.
import { Check, HelpCircle, X } from "lucide-react-native";

import {
  ParallaxCoverShell,
  offeringSurfaceStyles,
  normalizeCityCountry,
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
   * ORCH-1150 R2 D-7b — scroll runway. A short RSVP page (no ticket tiers, no
   * docked CTA) sits under an ~80%-tall pinned-cover spacer, so with a zero
   * bottom inset the body barely exceeds the viewport ⇒ near-zero scroll travel
   * ⇒ the (correctly pinned) cover dominates and content reads as "stuck behind
   * the cover." A positive `contentBottomInset` adds the runway so the body
   * scrolls UP and OVER the cover — parity with the trip / experience / ticketed
   * routes. Forwarded straight to `<ParallaxCoverShell contentBottomInset>`
   * (→ ScrollView `paddingBottom`). Defaults to a positive value so the runway
   * exists even if a caller forgets to pass it.
   */
  contentBottomInset?: number;
  /**
   * Convention parity with FoundationEventPreview / trip / experience callers.
   * RSVP has no float→dock CTA pill, so these have no runtime effect today — they
   * exist so the RSVP caller matches the shared shell's prop contract and the
   * regression guard can assert full parity.
   */
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (event: LayoutChangeEvent) => void;
  /**
   * Submits the RSVP. Returns the resolved server state so the body can reflect
   * pending / waitlist / going. Throws on error (the body shows an inline error,
   * never a dead end).
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
  // always clears the pinned cover even if the caller omits the prop.
  contentBottomInset = 48,
  onScroll,
  onScrollViewLayout,
  safeAreaTop = 0,
  testID,
}) => {
  const surface = offeringSurfaceStyles(palette);
  const boldFamily = boldFontFamily(theme);

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

  // ---- the RSVP action card (the heart of the page) -----------------------
  const submitting = phase === "submitting";

  const goingResolved = guestStatus === "going" && guestApproval === "approved";
  const pendingResolved = guestApproval === "pending";
  const notGoingResolved = guestStatus === "not_going";
  const waitlistedResolved = guestStatus === "waitlisted";
  // ORCH-1150 R2 D-10: a resolved (non-binding) Maybe. NOT a terminal dead end —
  // a Maybe can still upgrade to Going or decline.
  const maybeResolved = guestStatus === "maybe";

  const headline: string =
    pendingResolved
      ? "Awaiting host approval"
      : waitlistedResolved
        ? "You're on the waitlist"
        : goingResolved
          ? "You're going"
          : maybeResolved
            ? "You're marked as Maybe"
            : notGoingResolved
              ? "You said you can't make it"
              : ctaState === "full"
                ? "This event is full"
                : "Are you going?";

  const subcopy: string | null =
    pendingResolved
      ? "The host reviews each RSVP — we'll notify you the moment you're approved."
      : waitlistedResolved
        ? "A spot opened? We'll text and email you automatically."
        : goingResolved
          ? "We'll let you know if anything about the event changes."
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
                  : null;

  // Whether the Going button is the waitlist-join variant.
  const goingIsWaitlist =
    ctaState === "waitlist" && !waitlistedResolved && !goingResolved;
  const goingDisabled =
    submitting ||
    goingResolved ||
    pendingResolved ||
    waitlistedResolved ||
    (ctaState === "full" && !config.waitlistEnabled) ||
    (!isLoggedIn && !contactReady);
  const goingLabel = goingIsWaitlist
    ? submitting
      ? "Joining…"
      : "Join waitlist"
    : submitting
      ? "Saving…"
      : "Going";

  // ORCH-1150 R2 D-10: Maybe is disabled while submitting or once the guest has
  // resolved to a BINDING state (going / pending / waitlisted). It stays
  // available from the open + not_going states (so a decline can flip to Maybe).
  const maybeDisabled =
    submitting || goingResolved || pendingResolved || waitlistedResolved || maybeResolved;

  const showContactForm =
    !isLoggedIn &&
    !goingResolved &&
    !pendingResolved &&
    !waitlistedResolved &&
    !maybeResolved &&
    !(ctaState === "full" && !config.waitlistEnabled);

  const actionCard = (
    <View
      style={[styles.rsvpCard, surface.card]}
      testID="orch-1150-rsvp-card"
    >
      <Text
        style={[styles.rsvpHeadline, surface.primaryText, { fontFamily: boldFamily }]}
      >
        {headline}
      </Text>
      {subcopy !== null ? (
        <Text style={[styles.rsvpSub, surface.secondaryText]}>{subcopy}</Text>
      ) : null}

      {showContactForm ? (
        <View style={styles.formBlock}>
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
      ) : null}

      {config.allowPlusOnes &&
      !goingResolved &&
      !pendingResolved &&
      !waitlistedResolved &&
      !maybeResolved ? (
        <View style={[styles.plusRow, surface.card]}>
          <Text style={[styles.plusLabel, surface.secondaryText]}>
            Bringing extras?
          </Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setPlusCount((c) => Math.max(0, c - 1))}
              disabled={plusCount <= 0}
              accessibilityRole="button"
              accessibilityLabel="Remove one extra guest"
              style={[styles.stepBtn, { borderColor: palette.panelBorder }]}
              testID="orch-1150-rsvp-plus-minus"
            >
              <Text style={[styles.stepGlyph, { color: palette.accent }]}>–</Text>
            </Pressable>
            <Text
              style={[styles.stepCount, surface.primaryText, { fontFamily: boldFamily }]}
            >
              +{plusCount}
            </Text>
            <Pressable
              onPress={() =>
                setPlusCount((c) => Math.min(config.plusOnesMax, c + 1))
              }
              disabled={plusCount >= config.plusOnesMax}
              accessibilityRole="button"
              accessibilityLabel="Add one extra guest"
              style={[styles.stepBtn, { borderColor: palette.panelBorder }]}
              testID="orch-1150-rsvp-plus-plus"
            >
              <Text style={[styles.stepGlyph, { color: palette.accent }]}>+</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {errorMsg !== null ? (
        <Text style={styles.errorText} testID="orch-1150-rsvp-error">
          {errorMsg}
        </Text>
      ) : null}

      {/* ORCH-1150 R2 D-10: the three-button RSVP CTA — Going · Maybe · Not going.
          Each button is flex:1 (equal width). Going = filled accent (primary),
          Maybe = accent-wash secondary, Not going = outlined tertiary. Icons are
          per-icon lucide imports (Check / HelpCircle / X). Android fills are
          opaque (ANDROID_GLASS_USES_OPAQUE_FALLBACK). */}
      {!goingResolved && !pendingResolved && !notGoingResolved && !maybeResolved ? (
        <View style={styles.ctaRow}>
          <Pressable
            onPress={() => void submit("going")}
            disabled={goingDisabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: goingDisabled }}
            accessibilityLabel={goingLabel}
            style={[
              styles.ctaBtn,
              goingDisabled
                ? { backgroundColor: palette.card, borderColor: palette.panelBorder, borderWidth: 1 }
                : { backgroundColor: palette.accent },
            ]}
            testID="orch-1150-rsvp-going"
          >
            <Check
              size={19}
              color={goingDisabled ? palette.tertiaryText : palette.accentText}
            />
            <Text
              style={[
                styles.ctaBtnText,
                {
                  color: goingDisabled ? palette.tertiaryText : palette.accentText,
                  fontFamily: boldFamily,
                },
              ]}
            >
              {goingLabel}
            </Text>
          </Pressable>
          {!waitlistedResolved ? (
            <Pressable
              onPress={() => void submit("maybe")}
              disabled={maybeDisabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: maybeDisabled }}
              accessibilityLabel="Maybe"
              style={[
                styles.ctaBtn,
                {
                  backgroundColor: palette.accentWash,
                  borderColor: palette.accent,
                  borderWidth: 1,
                  opacity: maybeDisabled ? 0.5 : 1,
                },
              ]}
              testID="orch-1150-rsvp-maybe"
            >
              <HelpCircle size={19} color={palette.accent} />
              <Text
                style={[
                  styles.ctaBtnText,
                  { color: palette.accent, fontFamily: boldFamily },
                ]}
              >
                Maybe
              </Text>
            </Pressable>
          ) : null}
          {!waitlistedResolved ? (
            <Pressable
              onPress={() => void submit("not_going")}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Not going"
              style={[styles.ctaBtn, { borderColor: palette.panelBorder, borderWidth: 1 }]}
              testID="orch-1150-rsvp-not-going"
            >
              <X size={19} color={palette.secondaryText} />
              <Text style={[styles.ctaBtnText, surface.secondaryText]}>
                Can't go
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* ORCH-1150 R2 D-10: a resolved not_going OR maybe can upgrade to Going.
          A Maybe can additionally still decline (never a dead end). */}
      {notGoingResolved || maybeResolved ? (
        <View style={styles.ctaRow}>
          <Pressable
            onPress={() => void submit("going")}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Switch to Going"
            style={[styles.ctaBtn, { backgroundColor: palette.accent }]}
            testID="orch-1150-rsvp-switch-going"
          >
            <Check size={19} color={palette.accentText} />
            <Text
              style={[
                styles.ctaBtnText,
                { color: palette.accentText, fontFamily: boldFamily },
              ]}
            >
              {maybeResolved ? "Switch to Going" : "Actually, I'm going"}
            </Text>
          </Pressable>
          {maybeResolved ? (
            <Pressable
              onPress={() => void submit("not_going")}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Can't make it"
              style={[styles.ctaBtn, { borderColor: palette.panelBorder, borderWidth: 1 }]}
              testID="orch-1150-rsvp-maybe-decline"
            >
              <X size={19} color={palette.secondaryText} />
              <Text style={[styles.ctaBtnText, surface.secondaryText]}>
                Can't go
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
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
      contentBottomInset={contentBottomInset}
      safeAreaTop={safeAreaTop}
      onScroll={onScroll}
      onScrollViewLayout={onScrollViewLayout}
      testID={testID}
    >
      <View>
        {/* Brand chip */}
        <Pressable
          onPress={() => {
            if (brand?.slug !== undefined) onOpenBrand?.(brand.slug);
          }}
          disabled={brand?.slug === undefined || onOpenBrand === undefined}
          accessibilityRole={onOpenBrand !== undefined ? "button" : undefined}
          accessibilityLabel={
            brand?.displayName !== undefined
              ? `View ${brand.displayName}`
              : "View brand"
          }
          style={[styles.brandRow, surface.card]}
        >
          <View style={styles.brandTextCol}>
            <Text style={[styles.brandKicker, surface.tertiaryText]}>
              Hosted by
            </Text>
            <Text
              style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}
            >
              {brand?.displayName ?? "Brand"}
            </Text>
          </View>
        </Pressable>

        {actionCard}

        {/* Date + venue facts */}
        {event.dateSubline !== null && event.dateSubline.length > 0 ? (
          <View style={[styles.factRow, surface.card]}>
            <Text style={[styles.factGlyph, { color: palette.accent }]}>◴</Text>
            <Text style={[styles.factText, surface.secondaryText]}>
              {event.dateSubline}
            </Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => {
            if (canOpenVenueMaps && venueMapsQuery !== null) {
              onOpenMaps?.(venueMapsQuery);
            }
          }}
          disabled={!canOpenVenueMaps}
          accessibilityRole={canOpenVenueMaps ? "button" : undefined}
          accessibilityLabel={
            canOpenVenueMaps ? `Open ${venueAddressLabel} in maps` : undefined
          }
          style={[styles.factRow, surface.card]}
        >
          <Text style={[styles.factGlyph, { color: palette.accent }]}>◎</Text>
          <View style={styles.factCol}>
            {event.venueName !== null && event.venueName.length > 0 ? (
              <Text
                style={[styles.factText, surface.primaryText, { fontFamily: boldFamily }]}
              >
                {event.venueName}
              </Text>
            ) : null}
            <Text style={[styles.factSub, surface.secondaryText]}>
              {cityCountry ?? venueAddressLabel}
            </Text>
          </View>
        </Pressable>

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
  );
};

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
    marginBottom: 12,
    overflow: "hidden",
  },
  brandTextCol: { flex: 1 },
  brandKicker: { fontSize: 11, letterSpacing: 0.4, marginBottom: 2 },
  brandName: { fontSize: 16, fontWeight: "800" },
  rsvpCard: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    overflow: "hidden",
  },
  rsvpHeadline: { fontSize: 22, fontWeight: "900", marginBottom: 4 },
  rsvpSub: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  formBlock: { marginTop: 8 },
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
  plusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
    marginBottom: 4,
    overflow: "hidden",
  },
  plusLabel: { fontSize: 14, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center" },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: { fontSize: 20, fontWeight: "800", lineHeight: 22 },
  stepCount: { fontSize: 16, fontWeight: "800", minWidth: 40, textAlign: "center" },
  errorText: { color: "#e5484d", fontSize: 13, marginTop: 10, marginBottom: 2 },
  ctaRow: { flexDirection: "row", marginTop: 14, gap: 10 },
  // ORCH-1150 R2 D-10: equal-width (flex:1) RSVP CTA buttons. overflow:'hidden'
  // clips the opaque Android fill under the rounded corners (no translucent fill).
  ctaBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 14,
    paddingVertical: 15,
    overflow: "hidden",
  },
  ctaBtnText: { fontSize: 15, fontWeight: "900" },
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
});
