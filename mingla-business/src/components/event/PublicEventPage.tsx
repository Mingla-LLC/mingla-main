/**
 * PublicEventPage — adapter for the shared @mingla/offering-rendering package.
 *
 * ORCH-1138 Leg 2 [public event page redesign] — re-architected onto the shared
 * Direction-A foundation (@mingla/offering-rendering via the shared
 * PublicEventPage's FOUNDATION mode): immersive parallax cover, body-level fixed
 * chrome (X · Share · Mute), brand-themed palette + bold fonts, City,Country
 * venue + "Where you'll be" block, date/time facts, a SELECTABLE ticket-TIER
 * radiogroup, a desktop sticky ticket panel, and the float→dock single CTA — all
 * built around the SAME resolveOfferingCta state. Mirrors the SHIPPED trip route
 * (app/t/[brandSlug]/[tripSlug].tsx) 1:1.
 *
 * This adapter:
 *   - Fetches auth + brand list via existing mingla-business hooks
 *   - Computes viewerRole (organizer/anonymous)
 *   - Maps LiveEvent + Brand types to the package's prop contract
 *   - Resolves the brand theme → palette → bold fonts (useThemeFont pair)
 *   - Builds the desktop sticky panel (EventTicketBox) + the float/dock
 *     EventOfferingFloatingBar — both from @mingla/offering-rendering (ORCH-1167)
 *     — off the SAME resolveOfferingCta the page computes (one owner)
 *   - Owns share/mute/checkout navigation (checkout target UNCHANGED — N7)
 *   - Mounts ShareModal + Toast + JoinWaitlistSheet + web SEO <Head>
 *
 * Checkout target is unchanged (N7): tapping Get-tickets routes to the existing
 * public checkout for event.id — now via the ORCH-1167 cart seed
 * (checkoutPublicPathWithSeed(event.id, …)) — no address, no taxCalculationId.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  PublicEventPage as SharedPublicEventPage,
  type PublicBrandProps,
  type PublicEventCallbacks,
  type PublicEventProps,
  type PublicTicketProps,
  type ViewerRole,
  type CtaState,
  type OfferingVariant,
  resolveTheme,
  resolveOfferingCta,
  computeOfferingVariant,
  createThemePalette,
  boldFontFamily,
  buildStaticMapUrl,
  type ChipInResult,
} from "@mingla/offering-rendering";
import {
  useResponsiveLayout,
  EventOfferingFloatingBar,
  EventTicketBox,
  type RsvpPhoneFieldRenderer,
} from "@mingla/offering-rendering";
// ORCH-1295 [chip-in-post-payment-polish] — BUG 2: the shared country-picker phone
// input already used on the buyer checkout form (ORCH-0847). Reused here so the
// public RSVP phone field is country-code aware. No new npm dependency.
import {
  PhoneInput,
  COUNTRIES,
  getCountryByCode,
  type PhoneInputTheme,
  type PhoneInputIconName,
} from "@mingla/phone-input";
import { composeE164 } from "../../utils/phone";
import { Icon } from "../ui/Icon";

import { FoundationEventPreview } from "./FoundationEventPreview";
import { FoundationRsvpPreview } from "./FoundationRsvpPreview";
import { submitPublicRsvp, submitRsvpContribution } from "../../services/rsvpEvents";

import {
  checkoutPublicPathWithSeed,
  eventOgImageUrl,
  eventPublicUrl,
} from "../../constants/publicUrls";
import { useAuth } from "../../context/AuthContext";
import { useBrandList, type Brand } from "../../store/currentBrandStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { TicketStub } from "../../store/draftEventStore";
import {
  formatDraftDateLine,
  formatDraftDateSubline,
  formatDraftDatesList,
  formatEventDoorsTimes,
} from "../../utils/eventDateDisplay";
import { isLegacyUnsafeEventCoverVideoUrl } from "../../utils/eventCoverMediaRules";
import { eventCoverProviderCreditLabel } from "../../types/eventCoverProvider";
import { useThemeFont } from "../../theme/useThemeFont";

import { ShareModal } from "../ui/ShareModal";
import { Toast } from "../ui/Toast";
import { JoinWaitlistSheet } from "../waitlist/JoinWaitlistSheet";

interface PublicEventPageAdapterProps {
  event: LiveEvent;
  brand: Brand | null;
  /**
   * ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — when false, this is a
   * PAID event whose brand cannot charge yet; the CTA is the non-tappable
   * "Booking unavailable" strip (no dead-end checkout 409). Defaults to true.
   */
  bookable?: boolean;
}

const mapTicket = (t: TicketStub): PublicTicketProps => ({
  id: t.id,
  name: t.name,
  description: t.description ?? null,
  priceGbp: t.priceGbp ?? null,
  priceAllInGbp: t.priceAllInGbp ?? null,
  currency: t.currency ?? null,
  isFree: t.isFree,
  isUnlimited: t.isUnlimited,
  capacity: t.capacity ?? null,
  visibility:
    t.visibility === "hidden"
      ? "hidden"
      : t.visibility === "disabled"
        ? "disabled"
        : "visible",
  passwordProtected: t.passwordProtected,
  password: t.password ?? null,
  saleStartAt: t.saleStartAt ?? null,
  saleEndAt: t.saleEndAt ?? null,
  approvalRequired: t.approvalRequired,
  waitlistEnabled: t.waitlistEnabled,
  availableAt:
    t.availableAt === "door"
      ? "door"
      : t.availableAt === "both"
        ? "both"
        : "online",
  displayOrder: typeof t.displayOrder === "number" ? t.displayOrder : 0,
});

const mapLiveEventToPublicEvent = (event: LiveEvent): PublicEventProps => {
  const coverVideoUnsafe = isLegacyUnsafeEventCoverVideoUrl(
    event.coverMediaUrl,
    event.coverMediaType,
  );
  const safeCoverMediaUrl = coverVideoUnsafe ? null : event.coverMediaUrl;
  const safeCoverMediaType = coverVideoUnsafe ? null : event.coverMediaType;
  const coverCredit = eventCoverProviderCreditLabel({
    provider: coverVideoUnsafe ? null : event.coverMediaProvider,
    credit: coverVideoUnsafe ? null : event.coverMediaCredit,
  });
  return {
    id: event.id,
    name: event.name,
    brandId: event.brandId,
    brandSlug: event.brandSlug,
    eventSlug: event.eventSlug,
    description: event.description,
    dateLine: formatDraftDateLine(event),
    dateSubline: formatDraftDateSubline(event),
    datesList: formatDraftDatesList(event),
    status:
      event.status === "cancelled"
        ? "cancelled"
        : event.status === "ended"
          ? "ended"
          : event.status === "scheduled" || event.status === "live"
            ? "published"
            : "published",
    endedAt: event.endedAt ?? null,
    format:
      event.format === "online"
        ? "online"
        : event.format === "hybrid"
          ? "hybrid"
          : "in-person",
    venueName: event.venueName ?? null,
    address: event.address ?? null,
    hideAddressUntilTicket: Boolean(event.hideAddressUntilTicket),
    // ORCH-1162 Bug 2 — thread the venue geo so the shared renderer can draw the
    // "Where you'll be" map (business native preview). null → text-card fallback.
    locationGeo: event.locationGeo ?? null,
    // ORCH-1167 [event-page-canonical] — city-level privacy centroid (merged from
    // pg_public_event_by_slug in detailFromRow). The EventOfferingBody host feeds
    // whichever geo the privacy gate left present (cityGeo when the street is
    // hidden, locationGeo when public). null → text venue card (rule 9).
    cityGeo: event.cityGeo ?? null,
    coverHue: event.coverHue,
    coverMediaUrl: safeCoverMediaUrl,
    coverMediaType:
      safeCoverMediaType === "image" ||
      safeCoverMediaType === "video" ||
      safeCoverMediaType === "gif"
        ? safeCoverMediaType
        : null,
    coverCredit,
    tickets: event.tickets.map(mapTicket),
    currency: event.currency ?? "GBP",
    // ORCH-1157 [rsvp-public-redesign] — surface canonical party types (ORCH-0824)
    // for the Direction-C RSVP vibe chips. LiveEvent already carries these from
    // the view mapper; default `[]` for legacy persisted rows (rule 9 — no fake).
    partyTypes: event.partyTypes ?? [],
    vibeTags: event.vibeTags ?? [],
    // ORCH-1167 [event-page-canonical] — music-genre pills (third pills group).
    musicGenres: event.musicGenres ?? [],
    themeOverrides: event.themeOverrides ?? null,
  };
};

const mapBrandToPublicBrand = (
  brand: Brand | null,
): PublicBrandProps | null => {
  if (brand === null) return null;
  return {
    id: brand.id,
    slug: brand.slug,
    displayName: brand.displayName ?? "Brand",
    photo: brand.photo,
    theme: brand.theme ?? null,
  };
};

const openMapsForQuery = (query: string): void => {
  const encoded = encodeURIComponent(query);
  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  const platformUrl =
    Platform.OS === "ios"
      ? `maps://?q=${encoded}`
      : Platform.OS === "android"
        ? `geo:0,0?q=${encoded}`
        : googleUrl;

  void Linking.openURL(platformUrl).catch(() => {
    void Linking.openURL(googleUrl).catch(() => undefined);
  });
};

// ORCH-1295 [chip-in-post-payment-polish] — BUG 2: seed the guest phone picker's
// initial country. Guest's device locale first (they enter their OWN number),
// then a brand-currency hint (the brand's settlement currency is a country
// proxy), then "US". Mirrors buyer.tsx's locale-first resolveInitialCountry.
const CURRENCY_DEFAULT_COUNTRY: Record<string, string> = {
  NGN: "NG",
  GBP: "GB",
  USD: "US",
  CAD: "CA",
  AUD: "AU",
  EUR: "IE",
  ZAR: "ZA",
  KES: "KE",
  GHS: "GH",
};
const resolveGuestPhoneCountry = (currency?: string | null): string => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale.split("-")[1]?.toUpperCase();
    if (region && COUNTRIES.some((c) => c.code === region)) return region;
  } catch {
    // Intl unavailable — fall through to the currency hint.
  }
  const byCurrency = currency ? CURRENCY_DEFAULT_COUNTRY[currency.toUpperCase()] : undefined;
  if (byCurrency && COUNTRIES.some((c) => c.code === byCurrency)) return byCurrency;
  return "US";
};

const canonicalUrl = (event: LiveEvent): string =>
  eventPublicUrl({
    brandSlug: event.brandSlug,
    eventSlug: event.eventSlug,
  });

function ctaUnavailableLabel(cta: CtaState): string {
  return cta.kind === "unavailable" ? cta.title : "Booking unavailable";
}

// ORCH-1167-R2 (change 6) — clearance under the scroll content so the last section
// clears the persistent floating Get-tickets bar: the bar's own height (~56) + its
// 24px bottom offset + a small breathing gap. The device safe-area bottom is added
// on top by the caller.
const FLOATING_BAR_CLEARANCE = 96;

export const PublicEventPage: React.FC<PublicEventPageAdapterProps> = ({
  event,
  brand,
  bookable = true,
}) => {
  const router = useRouter();
  // ORCH-1295 [chip-in-post-payment-polish] — BUG 1: the chip-in web return lands
  // here as `?contribution=paid` (or `=cancel`). Read it to show a gift-framed
  // return banner (the shared chip-in panel mounts are gated on a live RSVP status
  // that a fresh page load no longer has, so the confirmation must live here).
  const routeParams = useLocalSearchParams<{ contribution?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userBrands = useBrandList();
  const { isDesktop } = useResponsiveLayout();

  // ORCH-1291 [rsvp-chip-in] — the last-submitted guest contact, captured at RSVP
  // so an anon web chip-in can supply guestEmail to rsvp-contribution-create.
  const lastRsvpContactRef = useRef<{ name: string; email: string } | null>(null);

  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const [waitlistTicketId, setWaitlistTicketId] = useState<string | null>(null);
  // ORCH-1138 — cover-video sound state (default muted). The chrome Mute button
  // toggles EventCoverMedia's muted state via this.
  const [muted, setMuted] = useState<boolean>(true);
  // ORCH-1167 [event-page-canonical] — the inline ticket-box per-tier quantities
  // (REPLACES the ORCH-1138 single-select radiogroup). The shared EventOfferingBody
  // reads/writes this; in-box Proceed + the floating bar carry it into the cart
  // (pre-populated, editable) at the checkout cart step (i). Empty → nothing picked.
  const [ticketQuantities, setTicketQuantities] = useState<Record<string, number>>(
    {},
  );

  const viewerRole: ViewerRole = useMemo(() => {
    if (user === null) return "anonymous";
    const owns = userBrands.some((b) => b.id === event.brandId);
    return owns ? "organizer" : "anonymous";
  }, [user, userBrands, event.brandId]);

  const publicEvent = useMemo(() => mapLiveEventToPublicEvent(event), [event]);
  const publicBrand = useMemo(() => mapBrandToPublicBrand(brand), [brand]);
  const resolvedTheme = useMemo(
    () =>
      resolveTheme(
        publicBrand?.theme ?? null,
        publicEvent.themeOverrides ?? null,
      ),
    [publicBrand?.theme, publicEvent.themeOverrides],
  );
  // ORCH-1138 — palette + surface + bold fonts (mirror the trip route). The bold
  // family is required or native bold no-ops (a loaded custom font ignores
  // fontWeight); load BOTH the base + bold families on demand.
  const palette = useMemo(() => createThemePalette(resolvedTheme), [resolvedTheme]);
  const boldFamily = boldFontFamily(resolvedTheme);
  useThemeFont(resolvedTheme.fontFamilyValue);
  useThemeFont(boldFamily);

  // ORCH-1167 [event-page-canonical] — the server-proxied static map URL for the
  // "Where you'll be" section. PRIVACY: the RPC already enforces the gate server-
  // side (locationGeo null + cityGeo set when the street is hidden), so the host
  // simply feeds whichever geo is present — exact pin when public, city-level
  // centroid when hidden. null on no geo → text venue card (rule 9). Online events
  // never render a map (the body shows the "Online" card).
  const staticMapUrl = useMemo<string | null>(() => {
    if (publicEvent.format === "online") return null;
    const geo = publicEvent.locationGeo ?? publicEvent.cityGeo ?? null;
    if (geo === null) return null;
    return buildStaticMapUrl({
      lat: geo.lat,
      lng: geo.lng,
      accentHex: palette.accent,
      // city-level when only cityGeo present (no exact pin leak); zoomed when exact.
      zoom: publicEvent.locationGeo !== null && publicEvent.locationGeo !== undefined ? 14 : 11,
      height: 180,
    });
  }, [publicEvent.format, publicEvent.locationGeo, publicEvent.cityGeo, palette.accent]);

  // ORCH-1167-R2 (change 4) — the floating Get-tickets bar is now PERSISTENT on
  // phone/native: it stays pinned/visible the whole scroll (Seth-directed; it was
  // regressing — anchored to the BODY TOP it vanished right after the cover). Both
  // the floating bar AND the in-box Proceed coexist (Seth-directed). The bar
  // reflects the live Σ-all-in total + taps through to the SAME cart step (i).
  // `onScroll`/`onScrollViewLayout` are still forwarded to the shell (parallax),
  // and `onDockLayout` still measures the box (kept for parity), but visibility no
  // longer hides on dock — the bar is always shown (phone) / hidden (desktop).
  const handleDockLayout = useCallback((_e: LayoutChangeEvent): void => {
    // No-op for visibility now (the bar is persistent); retained so the body's
    // onTicketBoxLayout has a sink and future float→dock can re-enable cleanly.
  }, []);
  const handleScroll = useCallback(
    (_e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      // Forwarded to the shell for parallax; no visibility math.
    },
    [],
  );
  const handleScrollLayout = useCallback((_e: LayoutChangeEvent): void => {
    // Forwarded to the shell; no visibility math.
  }, []);
  const floatingPillVisible = true;

  const waitlistTicket = useMemo(
    () =>
      publicEvent.tickets.find((ticket) => ticket.id === waitlistTicketId) ??
      null,
    [publicEvent.tickets, waitlistTicketId],
  );

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const dismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // ORCH-1138 — the page-level variant (cancelled / password-gate keep the shared
  // renderer's dedicated LEGACY render; everything else gets the FOUNDATION page).
  const pageVariant: OfferingVariant = useMemo(
    () => computeOfferingVariant(publicEvent, false),
    [publicEvent],
  );

  // ORCH-1167 — the page-level buy-state (resolveOfferingCta — one owner), now
  // computed over ALL visible tickets (the inline box owns per-tier selection).
  // Drives the state banner only; the inline box + floating bar resolve their own
  // CTA from the shared EventOfferingBody/Bar (same single owner, same payload).
  const offeringCta = useMemo(
    () =>
      resolveOfferingCta({
        variant: computeOfferingVariant(publicEvent, false),
        bookable,
        tickets: publicEvent.tickets.filter((t) => t.visibility !== "hidden"),
        currency: publicEvent.currency,
      }),
    [publicEvent, bookable],
  );

  const handleChangeTicketQuantity = useCallback(
    (ticketTypeId: string, qty: number): void => {
      setTicketQuantities((prev) => {
        const next = { ...prev };
        if (qty <= 0) delete next[ticketTypeId];
        else next[ticketTypeId] = qty;
        return next;
      });
    },
    [],
  );

  // ORCH-1167 — in-box Proceed + the floating bar both call this. It REPLACES the
  // /checkout/[eventId] tier-PICKER push: it carries the selected quantities into
  // the cart step (i) PRE-POPULATED (still editable there) via the `seed` param.
  // Waitlist routes to the waitlist sheet; a not-bookable paid brand toasts.
  const handleProceedToCart = useCallback((): void => {
    const anySelected = Object.values(ticketQuantities).some((q) => q > 0);
    if (offeringCta.kind === "waitlist" && !anySelected) {
      const wlTicket = publicEvent.tickets.find(
        (t) => t.visibility !== "hidden" && t.waitlistEnabled,
      );
      if (wlTicket !== undefined) setWaitlistTicketId(wlTicket.id);
      return;
    }
    if (!bookable) {
      showToast(
        "Booking unavailable right now — the organizer is finishing payment setup.",
      );
      return;
    }
    // ORCH-1167-R3 (change 3) — the empty-selection early-return is REMOVED: the
    // on-sale button is always tappable, and tapping at 0 selected pushes to the
    // cart step (i) where the buyer picks/edits quantities. An empty seed encodes
    // to nothing → the bare /checkout/[eventId] cart path. The genuinely non-
    // purchasable states never reach here (their CTA resolves tappable:false).
    router.push(
      checkoutPublicPathWithSeed(event.id, ticketQuantities) as never,
    );
  }, [
    offeringCta.kind,
    ticketQuantities,
    publicEvent.tickets,
    bookable,
    router,
    event.id,
    showToast,
  ]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof brand?.slug === "string" && brand.slug.length > 0) {
      router.replace(`/b/${brand.slug}` as never);
    } else if (event.brandSlug.length > 0) {
      router.replace(`/b/${event.brandSlug}` as never);
    } else {
      router.replace("/" as never);
    }
  }, [router, brand?.slug, event.brandSlug]);

  const handleShare = useCallback((): void => {
    setShareModalVisible(true);
  }, []);

  const handleToggleMute = useCallback((): void => {
    setMuted((m) => !m);
  }, []);

  const callbacks: PublicEventCallbacks = useMemo(
    () => ({
      onClose: handleClose,
      onShare: handleShare,
      onBuyTicket: (_ticketId: string) => {
        if (!bookable) {
          showToast(
            "Booking unavailable right now — the organizer is finishing payment setup.",
          );
          return;
        }
        router.push(checkoutPublicPathWithSeed(event.id, {}) as never);
      },
      onClaimFreeTicket: (_ticketId: string) => {
        if (!bookable) {
          showToast(
            "Booking unavailable right now — the organizer is finishing payment setup.",
          );
          return;
        }
        router.push(checkoutPublicPathWithSeed(event.id, {}) as never);
      },
      onJoinWaitlist: (ticketId: string) => {
        setWaitlistTicketId(ticketId);
      },
      onRequestApproval: (_ticketId: string) => {
        showToast("Approval flow lands Cycle 10 + B4.");
      },
      onOpenBrand: (brandSlug: string) => {
        router.push(`/b/${brandSlug}` as never);
      },
      onOpenMaps: openMapsForQuery,
      onUnlockPassword: (password: string): boolean => {
        // [TRANSITIONAL] Frontend stub validation against ticket.password —
        // B4 wires real backend verification (hashed comparison).
        const validPasswords = event.tickets
          .filter((t) => t.passwordProtected && t.password !== null)
          .map((t) => t.password as string);
        return validPasswords.includes(password);
      },
    }),
    [
      router,
      event.id,
      event.tickets,
      showToast,
      handleClose,
      handleShare,
      bookable,
    ],
  );

  // ORCH-1138 — state banner (sold-out / sales-ended / pre-sale / not-bookable),
  // rendered above the body by the shared FOUNDATION body. Driven by the same
  // offeringCta state (one owner) so the banner never disagrees with the CTA.
  const stateBanner =
    offeringCta.kind === "unavailable" ? (
      <View style={[styles.banner, { backgroundColor: palette.card }]}>
        <Text style={[styles.bannerText, { color: palette.secondaryText }]}>
          {offeringCta.title}
        </Text>
      </View>
    ) : null;

  // ORCH-1167-R2 (change 5) — DESKTOP WEB two-column reflow. On wide web the
  // primary content (cover/name/pills/about/where-you'll-be) stays in the left
  // column and the TICKET BOX moves into the STICKY right panel (the shared
  // EventTicketBox — one owner, same Σ-all-in math + same onProceedToCart → cart
  // step (i)). Phones + both native apps keep the inline box (hideTicketBox=false,
  // stickyPanel=null → single column). The off-screen floating CTA is the shared
  // EventOfferingFloatingBar (phone only; hidden on desktop). `offeringCta` is kept
  // only for the page-level state banner (one owner, never disagrees).
  void ctaUnavailableLabel; // retained import; legacy callers removed.
  const stickyPanel = isDesktop ? (
    <View style={[styles.deskPanel, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}>
      <View style={[styles.deskAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.deskInner}>
        <EventTicketBox
          event={publicEvent}
          bookable={bookable}
          palette={palette}
          theme={resolvedTheme}
          variant={pageVariant}
          ticketQuantities={ticketQuantities}
          onChangeTicketQuantity={handleChangeTicketQuantity}
          onProceedToCart={handleProceedToCart}
          submitting={false}
          showHeading
          testID="orch-1167-event-desktop-ticket-box"
        />
      </View>
    </View>
  ) : null;

  // ORCH-1150 — RSVP branch. An event_type='rsvp' row has zero tickets + no
  // checkout; it renders the Going/Not-going RsvpPublicBody and returns early.
  // The ticketed path below is BYTE-IDENTICAL (untouched) for every non-RSVP row.
  const isRsvp = event.event_type === "rsvp";
  const rsvpSubmit = useCallback(
    // ORCH-1163 — extended to carry per-guest plus-one contacts (§H) and to surface
    // the persisted rsvpId + signed confirmationToken (§I) back to the body (the
    // success popup + Calendar QR). The single write owner (submitPublicRsvp →
    // public-submit-rsvp) is unchanged.
    async (input: {
      rsvpStatus: "going" | "not_going" | "maybe";
      guestName: string;
      guestEmail: string;
      guestPhone: string;
      plusCount: number;
      guests: Array<{ name: string; email: string; phone: string }>;
    }): Promise<{
      status: "going" | "not_going" | "waitlisted" | "maybe";
      approvalStatus: "pending" | "approved";
      rsvpId: string;
      confirmationToken: string | null;
    }> => {
      // ORCH-1291 [rsvp-chip-in] — remember the just-submitted guest contact so an
      // anon web chip-in (a SEPARATE voluntary action AFTER the free RSVP) can
      // supply guestEmail to rsvp-contribution-create (the edge fn requires it for
      // anon buyers). The chip-in panel only shows AFTER going/pending, so this ref
      // is always populated by the time onChipIn fires.
      lastRsvpContactRef.current = {
        name: input.guestName,
        email: input.guestEmail,
      };
      return submitPublicRsvp({
        eventId: event.id,
        rsvpStatus: input.rsvpStatus,
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        guestPhone: input.guestPhone,
        plusCount: input.plusCount,
        guests: input.guests,
      });
    },
    [event.id],
  );

  // ORCH-1291 [rsvp-chip-in] — the buyer-web payment hand-off for a voluntary
  // gift. surface:'web' → the edge fn returns a hosted Stripe Checkout URL (or a
  // Paystack authorization URL for NGN); we navigate the browser there and report
  // 'redirecting' to the shared body. A logged-in web viewer rides the client JWT
  // (user_id resolved server-side); an anon guest supplies the remembered
  // name/email. Present (non-null) → the shared body renders the guest chip-in
  // panel on web; the post-return thank-you (contributionState='paid') is a
  // web-return follow-up validated at TEST.
  const handleChipIn = useCallback(
    async ({ amountCents }: { amountCents: number }): Promise<ChipInResult> => {
      const contact = lastRsvpContactRef.current;
      const res = await submitRsvpContribution({
        eventId: event.id,
        amountCents,
        surface: "web",
        guestName: contact?.name,
        guestEmail: contact?.email,
      });
      const redirectUrl =
        res.kind === "requires_web_redirect"
          ? res.hostedCheckoutUrl
          : res.kind === "requires_paystack_redirect"
            ? res.authorizationUrl
            : null;
      if (redirectUrl !== null && typeof window !== "undefined") {
        window.location.assign(redirectUrl);
        return { kind: "redirecting" };
      }
      // surface:'web' never returns requires_native_payment; a missing redirect
      // URL is a real failure → surface it (the panel maps it to gift-framed copy).
      throw new Error("contribution_create_failed");
    },
    [event.id],
  );

  // ── ORCH-1295 [chip-in-post-payment-polish] — BUG 1: the post-payment web return
  // banner. Read `?contribution=paid|cancel` ONCE, then strip the param (web) so a
  // refresh / back doesn't re-trigger it. Gift-framed; NO ticket/tax/purchase words. ──
  const contributionParam = Array.isArray(routeParams.contribution)
    ? routeParams.contribution[0]
    : routeParams.contribution;
  const [returnBanner, setReturnBanner] = useState<"paid" | "cancel" | null>(
    contributionParam === "paid"
      ? "paid"
      : contributionParam === "cancel"
        ? "cancel"
        : null,
  );
  const returnBannerHandledRef = useRef<boolean>(false);
  useEffect(() => {
    if (returnBannerHandledRef.current) return;
    if (contributionParam !== "paid" && contributionParam !== "cancel") return;
    returnBannerHandledRef.current = true;
    setReturnBanner(contributionParam);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("contribution");
        url.searchParams.delete("contrib");
        window.history.replaceState(
          null,
          "",
          url.pathname + url.search + url.hash,
        );
      } catch {
        // Stripping the param is a nicety; the banner already shows from state.
      }
    }
  }, [contributionParam]);

  // ── ORCH-1295 [chip-in-post-payment-polish] — BUG 2: the country-code-aware guest
  // phone field. Reuses @mingla/phone-input (as on the buyer checkout form). The
  // hook owns country + local-digits state; here we render the picker + compose
  // the E.164 value the RSVP submit expects. ──
  const defaultPhoneCountry = useMemo(
    () => resolveGuestPhoneCountry(event.currency ?? null),
    [event.currency],
  );
  const phoneFieldTheme = useMemo<PhoneInputTheme>(
    () => ({
      backgroundPrimary: palette.page,
      textPrimary: palette.primaryText,
      textTertiary: palette.tertiaryText,
      borderDefault: palette.panelBorder,
      borderFocused: palette.accent,
      borderError: "#ef4444",
      searchBackground: palette.card,
      rowPressedBackground: palette.accentWash,
      divider: palette.panelBorder,
      accessoryBackground: palette.page,
      accessoryBorder: palette.panelBorder,
      accent: palette.accent,
      errorText: "#ef4444",
    }),
    [palette],
  );
  const renderRsvpPhoneField = useCallback<RsvpPhoneFieldRenderer>(
    ({ countryCode, localDigits, onChangeCountry, onChangeLocalDigits, invalid, disabled }) => (
      <View style={styles.rsvpPhoneFieldWrap}>
        <Text style={[styles.rsvpPhoneFieldLabel, { color: palette.tertiaryText }]}>
          Phone
        </Text>
        <PhoneInput
          value={localDigits}
          countryCode={countryCode}
          onChangePhone={(next: string) => {
            const dial = getCountryByCode(countryCode)?.dialCode ?? "+1";
            onChangeLocalDigits(next, composeE164(dial, next) ?? "");
          }}
          onChangeCountry={(nextIso: string) => {
            const dial = getCountryByCode(nextIso)?.dialCode ?? "+1";
            onChangeCountry(nextIso, composeE164(dial, localDigits) ?? "");
          }}
          error={invalid ? "Enter a valid phone number" : null}
          disabled={disabled}
          iconRenderer={(name: PhoneInputIconName, iconProps: { size: number; color: string }) => {
            const iconName =
              name === "chevronDown"
                ? "chevD"
                : name === "checkmark"
                  ? "check"
                  : name === "close"
                    ? "close"
                    : "search";
            return <Icon name={iconName} size={iconProps.size} color={iconProps.color} />;
          }}
          labels={{
            phonePlaceholder: "Phone number",
            countryButtonAccessibilityLabel: (name: string) =>
              `Country code, ${name}, tap to change`,
            phoneInputAccessibilityLabel: "Phone number",
            doneButton: "Done",
            pickerTitle: "Select Country",
            pickerSearchPlaceholder: "Search country or dial code",
            pickerCloseAccessibilityLabel: "Close country picker",
          }}
          theme={phoneFieldTheme}
        />
      </View>
    ),
    [palette, phoneFieldTheme],
  );

  // ORCH-1157 Issue 4 [doors] — derive the tz-aware doors labels from the live
  // event's master start/end instants (event_dates). REAL-DATA-ONLY.
  const rsvpDoors = useMemo(
    () =>
      formatEventDoorsTimes(
        event.masterStartAtUtc ?? null,
        event.masterEndAtUtc ?? null,
        event.timezone ?? null,
      ),
    [event.masterStartAtUtc, event.masterEndAtUtc, event.timezone],
  );

  if (isRsvp) {
    return (
      <View style={[styles.host, { backgroundColor: palette.page }]}>
        {Platform.OS === "web" ? (
          <Head>
            <title>
              {event.name} · {brand?.displayName ?? "Mingla"}
            </title>
            <meta
              name="description"
              content={event.description.slice(0, 160) || event.name}
            />
            <meta property="og:title" content={event.name} />
            <meta property="og:url" content={canonicalUrl(event)} />
            <link rel="canonical" href={canonicalUrl(event)} />
          </Head>
        ) : null}

        <FoundationRsvpPreview
          event={publicEvent}
          brand={publicBrand}
          palette={palette}
          theme={resolvedTheme}
          config={{
            capacity: event.rsvpCapacity ?? null,
            goingCount: event.rsvpGoingCount ?? 0,
            allowPlusOnes: event.rsvpAllowPlusOnes ?? false,
            plusOnesMax: event.rsvpPlusOnesMax ?? 0,
            waitlistEnabled: event.rsvpWaitlistEnabled ?? false,
            manualApproval: event.rsvpApprovalMode === "manual",
            // ORCH-1157 Issue 4 [doors] — start_at/end_at (event_dates) → tz-aware
            // doors labels. No new field/schema.
            doorsOpenLabel: rsvpDoors.open,
            doorsCloseLabel: rsvpDoors.close,
            // ORCH-1291 [rsvp-chip-in] — the chip-in config surfaced by the anon
            // view (report §10.A). enabled=true lights up the shared body's guest
            // panel on web; settlement currency drives its Intl amount formatting.
            rsvp_contribution_enabled: event.rsvpContributionEnabled ?? false,
            rsvp_contribution_suggested_cents:
              event.rsvpContributionSuggestedCents ?? null,
            rsvp_contribution_min_cents: event.rsvpContributionMinCents ?? null,
            settlementCurrency: event.currency ?? "USD",
            hostShortName: brand?.displayName ?? undefined,
          }}
          onChipIn={handleChipIn}
          // ORCH-1295 [chip-in-post-payment-polish] — BUG 2: inject the country-code-
          // aware guest phone field on buyer web (native surfaces keep the plain field).
          renderPhoneField={renderRsvpPhoneField}
          defaultPhoneCountry={defaultPhoneCountry}
          isLoggedIn={user !== null}
          muted={muted}
          onToggleMute={handleToggleMute}
          onClose={handleClose}
          onShare={handleShare}
          onOpenBrand={(slug: string) => router.push(`/b/${slug}` as never)}
          onOpenMaps={openMapsForQuery}
          staticMapUrl={staticMapUrl}
          onSubmit={rsvpSubmit}
          // ORCH-1163-R3 — this FLOATING_BAR_CLEARANCE + insets.bottom expression is
          // the scroll-runway FLOOR (byte-identical to the event page). The RSVP bar
          // is TALLER + variable than the event Get-tickets bar, so FoundationRsvpPreview
          // onLayout-MEASURES the real bar height and takes the MAX of this floor and
          // `measured + 24 + 16 + safeAreaBottom` — that measured override does the
          // real clearance work so the last section always clears the bar even when
          // the micro subcopy wraps. 0 on desktop (sticky panel owns clearance).
          contentBottomInset={isDesktop ? 0 : FLOATING_BAR_CLEARANCE + insets.bottom}
          onScroll={handleScroll}
          onScrollViewLayout={handleScrollLayout}
          safeAreaTop={insets.top}
          safeAreaBottom={insets.bottom}
          testID="orch-1150-rsvp-public"
        />

        <ShareModal
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={canonicalUrl(event)}
          title={event.name}
          description={event.description.slice(0, 200)}
        />

        <View style={styles.toastWrap} pointerEvents="box-none">
          <Toast
            visible={toast.visible}
            kind="info"
            message={toast.message}
            onDismiss={dismissToast}
          />
        </View>

        {/* ORCH-1295 [chip-in-post-payment-polish] — BUG 1: post-payment web return
            banner. A guest who chipped in on Stripe/Paystack lands back here; show a
            clear gift-framed confirmation (or a neutral canceled state) instead of a
            silent page. Dismissible; the param is stripped so a refresh won't repeat it. */}
        {returnBanner !== null ? (
          <View
            style={[styles.returnBannerWrap, { paddingTop: insets.top + 12 }]}
            pointerEvents="box-none"
          >
            <View
              style={[
                styles.returnBannerCard,
                // ORCH-1297 [chip-in-banner-opacity] — the banner sits in an absolute
                // overlay OVER the cover image. `palette.card` is a TRANSLUCENT token
                // (rgba alpha 0.10/0.72) so the cover bled through and hurt legibility.
                // `palette.page` is the guaranteed-OPAQUE 6-digit hex the palette is
                // built on (and the exact opaque fill RsvpChipInPanel uses on Android),
                // so the cover can no longer show through on web or native; border kept.
                { backgroundColor: palette.page, borderColor: palette.panelBorder },
              ]}
              testID="orch-1295-chipin-return-banner"
            >
              <View style={styles.returnBannerText}>
                <Text
                  style={[
                    styles.returnBannerTitle,
                    { color: palette.primaryText, fontFamily: boldFamily },
                  ]}
                >
                  {returnBanner === "paid"
                    ? "Thanks for chipping in 💛"
                    : "Payment canceled"}
                </Text>
                <Text style={[styles.returnBannerBody, { color: palette.secondaryText }]}>
                  {returnBanner === "paid"
                    ? `Your gift to ${brand?.displayName ?? "the host"} came through — your RSVP's all set.`
                    : "No charge was made. Your RSVP is still confirmed."}
                </Text>
              </View>
              <Pressable
                onPress={() => setReturnBanner(null)}
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                hitSlop={10}
                style={styles.returnBannerClose}
                testID="orch-1295-chipin-return-banner-dismiss"
              >
                <Text style={[styles.returnBannerCloseText, { color: palette.tertiaryText }]}>
                  ✕
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      {/* Web-only by design (not transitional): iOS native skips Head metadata —
          buyer traffic for public event pages arrives via web URL, so HTML
          <Head> SEO/meta tags are only meaningful on web. */}
      {Platform.OS === "web" ? (
        <Head>
          <title>
            {event.name} · {brand?.displayName ?? "Mingla"}
          </title>
          <meta
            name="description"
            content={event.description.slice(0, 160) || event.name}
          />
          <meta property="og:title" content={event.name} />
          <meta
            property="og:description"
            content={event.description.slice(0, 200) || event.name}
          />
          <meta property="og:url" content={canonicalUrl(event)} />
          <meta
            property="og:image"
            content={eventOgImageUrl({
              eventId: event.id,
              coverMediaUrl: event.coverMediaUrl,
            })}
          />
          <meta property="og:type" content="event" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={event.name} />
          <meta
            name="twitter:description"
            content={event.description.slice(0, 200) || event.name}
          />
          <meta
            name="twitter:image"
            content={eventOgImageUrl({
              eventId: event.id,
              coverMediaUrl: event.coverMediaUrl,
            })}
          />
          <link rel="canonical" href={canonicalUrl(event)} />
        </Head>
      ) : null}

      {/* ORCH-1138 Leg 2 — the cancelled / password-gate page-level states keep the
          shared renderer's dedicated LEGACY render (those variants have no
          buyable body); everything else renders the Direction-A FOUNDATION page
          (FoundationEventPreview, composed in the APP layer; ORCH-1169 merged
          the rendering packages into one @mingla/offering-rendering). */}
      {pageVariant === "cancelled" || pageVariant === "password-gate" ? (
        <SharedPublicEventPage
          event={publicEvent}
          brand={publicBrand}
          viewerRole={viewerRole}
          callbacks={callbacks}
          theme={resolvedTheme}
        />
      ) : (
        <FoundationEventPreview
          event={publicEvent}
          brand={publicBrand}
          variant={pageVariant}
          bookable={bookable}
          palette={palette}
          theme={resolvedTheme}
          muted={muted}
          onToggleMute={handleToggleMute}
          onClose={handleClose}
          onShare={handleShare}
          onOpenBrand={(slug: string) => router.push(`/b/${slug}` as never)}
          onOpenMaps={openMapsForQuery}
          staticMapUrl={staticMapUrl}
          stateBanner={stateBanner}
          stickyPanel={stickyPanel}
          onScroll={handleScroll}
          onScrollViewLayout={handleScrollLayout}
          safeAreaTop={insets.top}
          // ORCH-1167-R2 (change 6) — bottom inset so the LAST content fully clears
          // the screen bottom on phone/native: the floating Get-tickets bar height
          // + its 24px bottom offset + the device safe-area. Desktop hides the bar
          // (the shell's own desktop scroll padding handles clearance), so 0 there.
          contentBottomInset={isDesktop ? 0 : FLOATING_BAR_CLEARANCE + insets.bottom}
          // ORCH-1167-R2 (change 5) — desktop relocates the box to the sticky panel.
          hideTicketBox={isDesktop}
          ticketQuantities={ticketQuantities}
          onChangeTicketQuantity={handleChangeTicketQuantity}
          onProceedToCart={handleProceedToCart}
          onDockLayout={handleDockLayout}
          testID="orch-1167-event-foundation"
        />
      )}

      {/* ORCH-1167 — FLOATING Get-tickets bar (phone): the shared
          EventOfferingFloatingBar, shown ONLY while the in-page ticket box is
          off-screen. Hidden on desktop + on the cancelled/password legacy page.
          Reflects the live Σ-all-in total + calls the SAME onProceedToCart the
          in-box Proceed calls (copy never diverges — one owner). */}
      {pageVariant !== "cancelled" &&
      pageVariant !== "password-gate" &&
      !isDesktop &&
      floatingPillVisible ? (
        <View style={styles.floatWrap} pointerEvents="box-none">
          <EventOfferingFloatingBar
            event={publicEvent}
            variant={pageVariant}
            bookable={bookable}
            palette={palette}
            theme={resolvedTheme}
            ticketQuantities={ticketQuantities}
            onProceedToCart={handleProceedToCart}
            testID="orch-1167-event-floating-bar"
          />
        </View>
      ) : null}

      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(event)}
        title={event.name}
        description={event.description.slice(0, 200)}
      />

      <JoinWaitlistSheet
        visible={waitlistTicket !== null}
        eventId={event.id}
        ticket={waitlistTicket}
        onClose={() => setWaitlistTicketId(null)}
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={dismissToast}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    position: "relative",
  },
  banner: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  // ORCH-1167 — the floating Get-tickets bar wrapper (phone, off-screen-box only).
  floatWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    zIndex: 6,
  },
  // ORCH-1167-R2 (change 5) — the DESKTOP sticky right-panel frame hosting the
  // EventTicketBox (mirrors the trip page's deskPanel pattern).
  deskPanel: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  deskAccent: {
    height: 4,
  },
  deskInner: {
    padding: 20,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 24,
    paddingHorizontal: 16,
    zIndex: 5,
  },
  // ORCH-1295 [chip-in-post-payment-polish] — BUG 1 post-payment web return banner.
  // Pinned top, above the parallax chrome (zIndex 6 in the shell), dismissible.
  returnBannerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    zIndex: 20,
  },
  returnBannerCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  returnBannerText: { flex: 1, minWidth: 0 },
  returnBannerTitle: { fontSize: 15, fontWeight: "900", letterSpacing: -0.2 },
  returnBannerBody: { fontSize: 13, lineHeight: 18, fontWeight: "600", marginTop: 3 },
  returnBannerClose: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  returnBannerCloseText: { fontSize: 16, fontWeight: "800" },
  // ORCH-1295 — BUG 2 injected phone field wrapper (matches the RSVP form's field
  // label spacing so the country-picker input aligns with the name/email fields).
  rsvpPhoneFieldWrap: { marginBottom: 12 },
  rsvpPhoneFieldLabel: { fontSize: 12, fontWeight: "700", marginBottom: 5 },
});
