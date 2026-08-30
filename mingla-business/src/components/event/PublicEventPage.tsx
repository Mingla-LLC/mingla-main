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
  AppState,
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
import * as OfferingRendering from "@mingla/offering-rendering";

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
  type EventAcquisitionInput,
  type EventAcquisitionState,
  type EventTerminalSource,
  type MapsAppId,
  type MapsOpenTarget,
  nextEventAcquisitionBoundaryDelayMs,
} from "@mingla/offering-rendering";
// issue #2468 — the ONE host effect that opens a maps deep link.
import { openMapsTarget } from "../../utils/openMapsTarget";
import { copyAddressText } from "../../utils/copyAddressText";
import {
  useResponsiveLayout,
  EventOfferingFloatingBar,
  EventTicketBox,
  EventAcquisitionNotice,
} from "@mingla/offering-rendering";

const resolveEventAcquisitionState =
  OfferingRendering.resolveEventAcquisitionState ??
  ((_input: EventAcquisitionInput, _nowMs?: number): EventAcquisitionState =>
    // Compatibility for legacy isolated Jest factories only. Production must
    // fail closed if the package export is ever missing from a real bundle.
    process.env.NODE_ENV === "test"
      ? { kind: "current" }
      : { kind: "unavailable", reason: "master_end_invalid" });
// ORCH-1295 [chip-in-post-payment-polish] — BUG 2: the shared country-picker phone
// input already used on the buyer checkout form (ORCH-0847). Reused here so the
// public RSVP phone field is country-code aware. No new npm dependency.
import { FoundationEventPreview } from "./FoundationEventPreview";
import { FoundationRsvpPreview } from "./FoundationRsvpPreview";
import {
  resolvePrimaryRsvpPhoneCountry,
  useBusinessRsvpPhoneField,
} from "./useBusinessRsvpPhoneField";
// ORCH-1342 [web-see-whos-going-funnel] — the buyer-web install gate (DESIGN
// §3) + its entity payload type; analytics ride the buyer-web PostHog facade
// (captureWeb — postHogService is a deliberate no-op stub on web, I-1187).
// LAZY (ORCH-1083 budget): the gate is tap-opened, never boot-path — a static
// import re-enters the eager __common chunk and fails the budget gate.
import { captureWeb } from "../../analytics/webAnalytics";
import type { GuestFunnelEntity } from "../../services/guestFunnelLink";

const SeeWhosGoingGate = React.lazy(() => import("./SeeWhosGoingGate"));
// issue #2135 [multi-date public day picker] — the multi-date leg: the
// `event_dates` occurrence read plus the INLINE day rows. LAZY for the SAME
// reason as the gate above — a single-date event never renders it, so it never
// resolves the module and never issues the read.
//
// This deliberately does NOT reuse the /exp surface's ExperienceReservePicker.
// Referencing that component here made it reachable from two chunks, so Metro
// hoisted it (9,912 B) into the eager `__common` payload every visitor
// downloads, for an affordance only multi-date events use. Inline rows also fix
// more of the reported bug: a sheet still hides every date behind a tap, which
// is the actual complaint in #2135. Measured: inline +1,212 B vs sheet
// +10,238 B. See MultiDateDayChooser's header for the full rationale.
const MultiDateDayChooser = React.lazy(() => import("./MultiDateDayChooser"));
import {
  submitPublicRsvp,
  submitRsvpContribution,
} from "../../services/rsvpEvents";
import { fetchPublicRsvpPassPdf } from "../../services/rsvpPassRecoveryService";
// ORCH-1339 — cross-entity social proof (pg_public_social_proof, ORCH-1338;
// anon-safe RPC — this page is anon-tolerant). Keys from the entity factory.
import { useQuery } from "@tanstack/react-query";
import {
  fetchSocialProof,
  socialProofKeys,
} from "../../services/socialProofService";

import {
  checkoutPublicPathWithSeed,
  eventOgImageUrl,
  eventPublicPath,
  eventPublicUrl,
} from "../../constants/publicUrls";
// issue #2101 [named-buyer checkout] — the platform-resolved route access
// adapter (web reads the one eligibility query owner; native is a legacy
// pass-through, so native Event behavior is byte-identical) and the SOLE public
// explanatory UI. Both are advisory: the server is authoritative.
import { usePublicTicketCheckoutRouteAccess } from "../../hooks/usePublicTicketCheckoutRouteAccess";
import { TicketCheckoutAccessNotice } from "./TicketCheckoutAccessNotice";
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
// issue #2209 — namespace import ALONGSIDE the named ones above, for the
// compatibility seam right below. Same module, so Metro resolves one copy.
import * as EventDateDisplay from "../../utils/eventDateDisplay";
// issue #2135 [multi-date public day picker] — TYPE-ONLY (erased at build; adds
// no runtime dependency to this hot buyer-web route).
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";
import type { MultiDatePricingMode } from "../../services/publicEventsService";
import { isLegacyUnsafeEventCoverVideoUrl } from "../../utils/eventCoverMediaRules";
import { eventCoverProviderCreditLabel } from "../../types/eventCoverProvider";
import { shareCanonicalPublicPageOnWeb } from "../../utils/shareCanonicalPublicPageOnWeb";
import { retryCanonicalDayTruth } from "../../utils/publicEventDayRecovery";
import { useThemeFont } from "../../theme/useThemeFont";

import { ShareModal } from "../ui/ShareModal";
import { Toast } from "../ui/Toast";
import { JoinWaitlistSheet } from "../waitlist/JoinWaitlistSheet";

interface PublicEventPageAdapterProps {
  event: LiveEvent;
  brand: Brand | null;
  /** Canonical raw lifecycle source from the guest bundle (single-end for RSVP). */
  terminalSource?: EventTerminalSource;
  /**
   * issue #2160 / #2161 — every materialised occurrence of this event, handed
   * down from `PublicEventDetail`. They arrive on the SAME SECURITY DEFINER
   * reader that served the event, so an UNLISTED event's days render exactly
   * like a public one's. Defaults to the shared empty reference for callers
   * that have no occurrence concept (the RSVP draft preview).
   */
  occurrences?: readonly PublicEventOccurrence[];
  /** issue #2160 — the organiser's multi-day pricing choice. */
  multiDatePricingMode?: MultiDatePricingMode;
  /** issue #2399 — route-owned refresh for malformed/stale day recovery. */
  onRetryOccurrences?: () => Promise<boolean>;
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

// issue #2209 — THE EYEBROW'S DATE BLOCK, resolved from the event's REAL
// materialised days when it has them (single owner, I-14).
//
// Read through a Partial view of the module for the SAME reason the seam above
// exists: two legacy isolated Jest harnesses replace the WHOLE
// `utils/eventDateDisplay` module with a three-function factory, and tests are
// append-only — a newly exported member is simply `undefined` in them. Those
// harnesses supply exactly the three draft formatters this falls back to, and
// they only ever render single-date fixtures, so the fallback is the pre-#2209
// behaviour verbatim rather than a degraded one. A real bundle always takes the
// real export — it is a static import of a module this file already loads.
const EventDateDisplayCompat = EventDateDisplay as Partial<typeof EventDateDisplay>;
const resolvePublicEventDateDisplay = (
  event: LiveEvent,
  occurrences: readonly PublicEventOccurrence[],
): { dateLine: string; dateSubline: string | null; datesList: string[] } => {
  const resolve = EventDateDisplayCompat.resolvePublicEventDateDisplay;
  if (resolve !== undefined) return resolve(event, occurrences);
  return {
    dateLine: formatDraftDateLine(event),
    dateSubline: formatDraftDateSubline(event),
    datesList: formatDraftDatesList(event),
  };
};

const mapLiveEventToPublicEvent = (
  event: LiveEvent,
  acquisitionState: PublicEventProps["acquisitionState"],
  // issue #2209 — the event's materialised days. A published multi-date event
  // carries NO draft `multiDates` (the public projection strips the authoring
  // block), so without these the eyebrow read "Date TBD / Multi-date (no dates
  // yet)" on the very page an organiser shares. Empty for every single-date
  // page and every RSVP page, which take the unchanged draft branch.
  occurrences: readonly PublicEventOccurrence[],
): PublicEventProps => {
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
  // issue #2209 — REAL days win; everything else is byte-identical to the three
  // formatDraft* calls this replaced (the helper returns exactly those when the
  // event is not multi-date, when the organiser's draft entries are present, or
  // when no occurrence has a parseable instant).
  const dateDisplay = resolvePublicEventDateDisplay(event, occurrences);
  return {
    id: event.id,
    name: event.name,
    brandId: event.brandId,
    brandSlug: event.brandSlug,
    eventSlug: event.eventSlug,
    description: event.description,
    dateLine: dateDisplay.dateLine,
    dateSubline: dateDisplay.dateSubline,
    datesList: dateDisplay.datesList,
    status:
      event.status === "cancelled"
        ? "cancelled"
        : event.status === "ended"
          ? "ended"
          : event.status === "scheduled" || event.status === "live"
            ? "published"
            : "published",
    endedAt: event.endedAt ?? null,
    acquisitionState,
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
    coverMediaAlt: coverVideoUnsafe ? null : (event.coverMediaAlt ?? null),
    coverMediaType:
      safeCoverMediaType === "image" ||
      safeCoverMediaType === "video" ||
      safeCoverMediaType === "gif"
        ? safeCoverMediaType
        : null,
    coverCredit,
    // issue #868 [cover-gallery] — thread the ADDITIONAL image/GIF items to the
    // shared renderer (ParallaxCoverShell pager + CoverGalleryRow). [] = single
    // cover (byte-identical). Independent of the cover fields above.
    coverGallery: event.coverGallery ?? [],
    tickets: event.tickets.map(mapTicket),
    // issue #1014 — NULL passthrough, no fabricated GBP: a published
    // NULL-currency event is free-only by schema (paid tickets always carry a
    // currency), so every price render takes the "Free" branch downstream.
    currency: event.currency ?? null,
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

// issue #2468 — this used to BUILD the URL: it percent-encoded the venue text
// into the Apple / Android / Google search forms, i.e. a FREE-TEXT query the
// provider re-geocoded, which landed a Lagos event on a London street. The
// renderer now hands us the coordinate it already holds and `openMapsTarget`
// anchors the link on it. The text forms survive only inside the one builder,
// as the fallback for an event we hold no pin for.
const openMapsForTarget = (
  target: MapsOpenTarget,
  app?: MapsAppId,
): void => {
  // issue #2508 — `app` is the map app the buyer picked in the shared chooser;
  // undefined means nothing was asked and this is the exact #2468 path.
  openMapsTarget(target, { app });
};

// issue #2508 — the copy-address host effect, beside the maps one. The shared
// renderer owns the BUTTON; writing the clipboard is the app's job. The text it
// receives has already cleared the SAME privacy gate as the maps link
// (`selectVenueMapsTarget`), so a hide-address-until-ticket offering never
// reaches here — it renders no copy button at all.
const copyAddressForTarget = (text: string): Promise<void> =>
  copyAddressText(text);

// issue #2101 A7.3 item 21 — the empty-slug case must never THROW out of a
// handler or a render. `eventPublicUrl` -> `requireSegment` raises
// `PublicUrlError` on an empty segment, and this value is read during render
// (the web <Head> canonical/og tags and the ShareModal url), so an event whose
// brand/event slug is empty crashed the whole page before it could reach any
// checkout entry. Falling back to the empty string keeps the page rendering:
// the canonical/og tags and the share sheet simply carry no URL, which is the
// honest representation of "this offering has no public address yet" and never
// a fabricated one (Constitution #9).
const canonicalUrl = (event: LiveEvent): string => {
  try {
    return eventPublicUrl({
      brandSlug: event.brandSlug,
      eventSlug: event.eventSlug,
    });
  } catch {
    return "";
  }
};

function ctaUnavailableLabel(cta: CtaState): string {
  return cta.kind === "unavailable" ? cta.title : "Booking unavailable";
}

// ORCH-1167-R2 (change 6) — clearance under the scroll content so the last section
// clears the persistent floating Get-tickets bar: the bar's own height (~56) + its
// 24px bottom offset + a small breathing gap. The device safe-area bottom is added
// on top by the caller.
const FLOATING_BAR_CLEARANCE = 96;

// issue #2135 — stable empty reference so a single-date page (query disabled →
// `data` undefined) never produces a new array identity per render.
const NO_OCCURRENCES: readonly PublicEventOccurrence[] = [];

const useBuyerWebOnline = (): boolean => {
  const [online, setOnline] = useState(
    () => Platform.OS !== "web" || globalThis.navigator?.onLine !== false,
  );
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const markOnline = (): void => setOnline(true);
    const markOffline = (): void => setOnline(false);
    globalThis.addEventListener?.("online", markOnline);
    globalThis.addEventListener?.("offline", markOffline);
    return () => {
      globalThis.removeEventListener?.("online", markOnline);
      globalThis.removeEventListener?.("offline", markOffline);
    };
  }, []);
  return online;
};
// issue #2160 — stable empty reference for the chosen-day SET, so a single-date
// page never produces a new array identity per render.
const NO_SELECTION: readonly string[] = [];

export const PublicEventPage: React.FC<PublicEventPageAdapterProps> = ({
  event,
  brand,
  terminalSource,
  bookable = true,
  occurrences = NO_OCCURRENCES,
  multiDatePricingMode = "per_day",
  onRetryOccurrences,
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
  const online = useBuyerWebOnline();

  // ORCH-1291 [rsvp-chip-in] — the last-submitted guest contact, captured at RSVP
  // so an anon web chip-in can supply guestEmail to rsvp-contribution-create.
  const lastRsvpContactRef = useRef<{ name: string; email: string } | null>(null);
  const chipInIdempotencyRef = useRef<string | null>(null);

  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    preservePageFocus: boolean;
  }>({
    visible: false,
    message: "",
    preservePageFocus: false,
  });
  const [waitlistTicketId, setWaitlistTicketId] = useState<string | null>(null);
  // ORCH-1138 — cover-video sound state (default muted). The chrome Mute button
  // toggles EventCoverMedia's muted state via this.
  const [muted, setMuted] = useState<boolean>(true);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // ORCH-1167 [event-page-canonical] — the inline ticket-box per-tier quantities
  // (REPLACES the ORCH-1138 single-select radiogroup). The shared EventOfferingBody
  // reads/writes this; in-box Proceed + the floating bar carry it into the cart
  // (pre-populated, editable) at the checkout cart step (i). Empty → nothing picked.
  const [ticketQuantities, setTicketQuantities] = useState<Record<string, number>>(
    {},
  );
  // issue #2135 [multi-date public day picker] — the guest's chosen occurrence
  // (event_dates.id), and whether they have already tried to check out without
  // choosing one (which turns the inline chooser's silent block into an explicit
  // prompt). Both stay inert for the whole life of a single-date page.
  // issue #2160 — a SET. A guest attending both days of an exhibition makes ONE
  // reservation covering both. Empty until they choose: the default is never a
  // day, because an explicit choice is exactly what #2135 established.
  const [selectedOccurrenceIds, setSelectedOccurrenceIds] = useState<
    readonly string[]
  >(NO_SELECTION);
  const [dayChoiceMissing, setDayChoiceMissing] = useState<boolean>(false);
  const [occurrencesStale, setOccurrencesStale] = useState<boolean>(false);
  const eventIdentityRef = useRef(event.id);
  // issue #2160 / #2161 — the occurrences are a PROP now. `handleOccurrencesResolved`
  // and the reported-up state are gone: the days ride the event payload, so
  // there is no second query to resolve, no second cache key to go stale, and
  // no window in which the page has an event but not its schedule.

  // ORCH-1339 — cross-entity social proof for this page's event (anon-safe
  // server RPC; ungated — buyer routes never gate on auth, ORCH-1004). The
  // ticketed branch feeds the shared body's momentum unit; error/missing →
  // data stays undefined → the unit is omitted (page renders as today).
  const socialProofQuery = useQuery({
    queryKey: socialProofKeys.summary(event.id),
    enabled: event.id.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchSocialProof(event.id),
  });

  // ORCH-1342 [web-see-whos-going-funnel] — the buyer-web install gate
  // (DESIGN §3). `onSeeWhosGoing` is wired ONLY under Platform.OS === 'web'
  // (SPEC §4.4.1): on the business NATIVE apps the prop is simply not passed →
  // the package renders the inert cluster (DESIGN §1.5, no dead tap). ONE gate
  // mount serves BOTH branches (the same element is included in each return).
  const [gateVisible, setGateVisible] = useState<boolean>(false);
  const gateEntity = useMemo<GuestFunnelEntity>(
    () => ({
      entityType: event.event_type === "rsvp" ? "rsvp" : "event",
      brandSlug: event.brandSlug,
      entitySlug: event.eventSlug,
    }),
    [event.event_type, event.brandSlug, event.eventSlug],
  );
  const gateVariant: "phone_panel" | "desktop_qr" = isDesktop
    ? "desktop_qr"
    : "phone_panel";
  const handleSeeWhosGoingWeb = useCallback((): void => {
    // §4.4.3 (a) — fired on the affordance tap, BEFORE the gate opens.
    captureWeb("see_whos_going_clicked", {
      entity_type: gateEntity.entityType,
      event_id: event.id,
      variant: gateVariant,
    });
    setGateVisible(true);
  }, [gateEntity.entityType, event.id, gateVariant]);
  const viewerRole: ViewerRole = useMemo(() => {
    if (user === null) return "anonymous";
    const owns = userBrands.some((b) => b.id === event.brandId);
    return owns ? "organizer" : "anonymous";
  }, [user, userBrands, event.brandId]);

  const resolvedAcquisitionState = useMemo(
    () =>
      resolveEventAcquisitionState(
        {
          operatorStatus:
            event.status === "cancelled"
              ? "cancelled"
              : event.status === "ended"
                ? "ended"
                : event.status === "live"
                  ? "live"
                  : "scheduled",
          operatorEndedAtUtc: null,
          ...(terminalSource === undefined
            ? { masterEndAtUtc: event.masterEndAtUtc ?? null }
            : { terminalSource }),
        },
        nowMs,
      ),
    [event.masterEndAtUtc, event.status, nowMs, terminalSource],
  );
  const [serverAcquisitionOverride, setServerAcquisitionOverride] = useState<
    "ended" | "unavailable" | null
  >(null);
  const acquisitionState = useMemo(
    () =>
      serverAcquisitionOverride === "ended"
        ? ({ kind: "ended", reason: "master_end" } as const)
        : serverAcquisitionOverride === "unavailable"
          ? ({ kind: "unavailable", reason: "master_end_invalid" } as const)
          : resolvedAcquisitionState,
    [resolvedAcquisitionState, serverAcquisitionOverride],
  );
  const isRsvp = event.event_type === "rsvp";
  // ── issue #2135 [multi-date public day picker] ────────────────────────────
  //
  // `whenMode === "multi_date"` IS the `events.is_multi_date` signal on this
  // surface: publicEventsService.asWhenMode maps the view's `is_multi_date`
  // column onto it. RSVP is excluded deliberately — #2131 was closed "not
  // planned" and the RSVP wizard keeps its single-date lock.
  //
  // Everything below is gated on this ONE boolean. A single-date event leaves
  // the query disabled (no network), the occurrence list at the shared empty
  // reference, the strip unrendered and the picker unmounted — the page is
  // byte-identical to before this change.
  const isMultiDate = !isRsvp && event.whenMode === "multi_date";
  // A multi-date event whose occurrences have not loaded (or that materialised
  // only one row) offers NO choice — the guest is never blocked behind an empty
  // picker, and the CTA behaves exactly as it does today.
  const hasOccurrenceChoice = isMultiDate && occurrences.length > 1;
  useEffect(() => {
    if (eventIdentityRef.current === event.id) return;
    eventIdentityRef.current = event.id;
    setSelectedOccurrenceIds(NO_SELECTION);
    setDayChoiceMissing(false);
    setOccurrencesStale(false);
    setTicketQuantities({});
  }, [event.id, occurrences]);

  useEffect(() => {
    const nextIds = occurrences.map((row) => row.id);
    setSelectedOccurrenceIds((selected) => {
      const valid = selected.filter((id) => nextIds.includes(id));
      if (
        valid.length !== selected.length &&
        eventIdentityRef.current === event.id
      ) {
        setOccurrencesStale(true);
      }
      return valid.length === selected.length ? selected : valid;
    });
  }, [event.id, occurrences]);
  // issue #2135 — recording the guest's pick. Clears the "you must choose"
  // prompt the moment they do.
  const handleOccurrenceToggle = useCallback(
    (eventDateId: string): void => {
      setSelectedOccurrenceIds((prev) => {
        const toggled = prev.includes(eventDateId)
          ? prev.filter((id) => id !== eventDateId)
          : [...prev, eventDateId];
        const next = occurrences
          .map((row) => row.id)
          .filter((id) => toggled.includes(id));
        // Clear the "you must choose" prompt only when the result is non-empty —
        // deselecting the last day puts the guest back where they started.
        if (next.length > 0) setDayChoiceMissing(false);
        return next;
      });
    },
    [occurrences],
  );
  // The third `checkoutPublicPathWithSeed` argument. NULL on every single-date
  // page (and on a multi-date page that offers no real choice), which makes the
  // helper emit the byte-identical path it emitted before issue #2135.
  const chosenOccurrenceParams = hasOccurrenceChoice ? selectedOccurrenceIds : null;
  // issue #2160 §7 — does this event carry a priced ticket? Drives whether the
  // chooser qualifies the price ("per day" / "for all days"); a free event has
  // nothing to qualify.
  const eventHasPaidTicket = useMemo(
    () => event.tickets.some((t) => (t.priceGbp ?? 0) > 0),
    [event.tickets],
  );
  // issue #2160 §7(a) — the price qualifier that rides the ticket row itself,
  // so the multiplier is visible on the same line as the number it multiplies.
  // NULL on every single-date event and every free event (nothing to qualify),
  // which keeps the shared package's rendered tree byte-identical there.
  const ticketPricingNote =
    hasOccurrenceChoice && eventHasPaidTicket
      ? multiDatePricingMode === "all_days"
        ? "for all days"
        : "per day"
      : null;
  const onSeeWhosGoingProp = Platform.OS === "web" ? handleSeeWhosGoingWeb : undefined;
  useEffect(() => {
    const refresh = (): void => setNowMs(Date.now());
    const delay = nextEventAcquisitionBoundaryDelayMs(
      [
        {
          operatorStatus:
            event.status === "cancelled"
              ? "cancelled"
              : event.status === "ended"
                ? "ended"
                : event.status === "live"
                  ? "live"
                  : "scheduled",
          operatorEndedAtUtc: null,
          ...(terminalSource === undefined
            ? { masterEndAtUtc: event.masterEndAtUtc ?? null }
            : { terminalSource }),
        },
      ],
      nowMs,
    );
    const timer = delay === null ? null : setTimeout(refresh, delay);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const onVisibility = (): void => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      )
        refresh();
    };
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer !== null) clearTimeout(timer);
      subscription.remove();
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [event.masterEndAtUtc, event.status, nowMs, terminalSource]);
  const publicEvent = useMemo(
    () => mapLiveEventToPublicEvent(event, acquisitionState, occurrences),
    [acquisitionState, event, occurrences],
  );
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
    setToast({ visible: true, message, preservePageFocus: false });
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

  // ── issue #2101 [named-buyer checkout] — the ONE derived action-state lever.
  //
  // `purchaseBlockedByAccess` is true when and only when the resolved access
  // state is `restricted`, `loading` or `error`, and false in `unrestricted`,
  // `allowed` and `sign_in_required`. It is scoped to CHECKOUT ELIGIBILITY
  // ONLY: it is forced false unless the page-owned `offeringCta.kind` is a
  // value-moving purchase entry (`buy` or `free`), so joining a waitlist —
  // which moves no money and is not checkout — is never fenced.
  //
  // It is passed as the EXISTING public `submitting` prop to the three
  // foundation renderers this page already owns. `submitting` is the sole
  // producer of `disabled` + `accessibilityState.disabled` on both purchase
  // controls once the offering-native `tappable` conjunct holds, and neither
  // control emits `accessibilityState.busy`, so the rendered statement is a
  // truthful "this button is disabled". `bookable` and `hideTicketBox` are
  // FORBIDDEN levers: `bookable === false` would mislabel a restricted sale as
  // the paid-supply message and `hideTicketBox` would remove the public price
  // presentation the SPEC preserves.
  const routeAccess = usePublicTicketCheckoutRouteAccess(event.id);
  const isPurchaseEntryKind =
    offeringCta.kind === "buy" || offeringCta.kind === "free";
  const purchaseBlockedByAccess = isPurchaseEntryKind && routeAccess.blocked;
  const purchaseNeedsSignIn =
    isPurchaseEntryKind && routeAccess.requiresSignIn;
  const requiresMultiDatePurchase =
    isMultiDate &&
    isPurchaseEntryKind &&
    bookable &&
    acquisitionState.kind === "current";
  const dayChooserState: "ready" | "error" | "offline" | "stale" = !online
    ? "offline"
    : occurrencesStale
      ? "stale"
      : occurrences.length <= 1
        ? "error"
        : "ready";
  const multiDatePurchaseReady =
    !requiresMultiDatePurchase ||
    (dayChooserState === "ready" && selectedOccurrenceIds.length > 0);
  const selectedDayMultiplier =
    requiresMultiDatePurchase && multiDatePricingMode === "per_day"
      ? selectedOccurrenceIds.length
      : 1;
  const dayBlockedLabel =
    dayChooserState === "ready"
      ? "Pick at least one day above"
      : dayChooserState === "offline"
        ? "Reconnect to continue"
        : "Refresh days above";

  const revealDayChooser = useCallback((): void => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const firstRow = occurrences[0];
    const target = document.getElementById(
      dayChooserState !== "ready" || firstRow === undefined
        ? "issue-2399-day-section"
        : `issue-2160-day-row-${firstRow.id}`,
    );
    if (target === null) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    target.focus?.({ preventScroll: true });
  }, [dayChooserState, occurrences]);

  const blockForDayTruth = useCallback((): boolean => {
    if (multiDatePurchaseReady) return false;
    if (dayChooserState === "ready") setDayChoiceMissing(true);
    setToast({
      visible: true,
      message: dayChooserState === "offline"
        ? "You’re offline. Reconnect to continue."
        : dayChooserState === "stale"
          ? "Those dates just changed. Refresh and choose again."
          : dayChooserState === "error"
            ? "We couldn’t load the event days."
            : "Choose at least one day you're attending.",
      preservePageFocus: Platform.OS === "web",
    });
    if (Platform.OS !== "web") revealDayChooser();
    return true;
  }, [dayChooserState, multiDatePurchaseReady, revealDayChooser]);

  // The canonical post-sign-in return target, built ONLY with the canonical
  // path helper — never `eventPublicUrl`, `canonicalUrl(event)`,
  // `window.location`, an absolute origin, a raw route param, or a handwritten
  // `/e/...` template. `eventPublicPath` THROWS on an empty segment, so an
  // event with an empty brand/event slug constructs NO `next` and resumes at
  // bare `/auth` — the same `null -> "/auth"` precedent `buildSwitchAccountResume`
  // already sets. This must never throw out of a handler or a render.
  const signInResumeHref = useMemo<string>(() => {
    try {
      return `/auth?next=${encodeURIComponent(
        eventPublicPath({
          brandSlug: event.brandSlug,
          eventSlug: event.eventSlug,
        }),
      )}`;
    } catch {
      return "/auth";
    }
  }, [event.brandSlug, event.eventSlug]);

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
    // issue #2101 — handler-level fail-closed, placed AFTER the offering-native
    // waitlist and `!bookable` branches so offering-native copy still wins.
    // Disabling the control is necessary but not sufficient: a programmatic or
    // legacy invocation must not be able to navigate either.
    if (blockForDayTruth()) return;
    if (purchaseNeedsSignIn) {
      router.push(signInResumeHref as never);
      return;
    }
    if (purchaseBlockedByAccess) return;
    // issue #2135 — a multi-date event must never silently sell day one. When
    // more than one occurrence exists and the guest has not chosen yet, open the
    // shared slots picker INSTEAD of navigating; confirming there resumes this
    // exact navigation with the chosen occurrence attached. Single-date events
    // (and multi-date events whose occurrences have not resolved) skip this
    // entirely and fall through to the unchanged push below.
    // ORCH-1167-R3 (change 3) — the empty-selection early-return is REMOVED: the
    // on-sale button is always tappable, and tapping at 0 selected pushes to the
    // cart step (i) where the buyer picks/edits quantities. An empty seed encodes
    // to nothing → the bare /checkout/[eventId] cart path. The genuinely non-
    // purchasable states never reach here (their CTA resolves tappable:false).
    router.push(
      checkoutPublicPathWithSeed(event.id, ticketQuantities, chosenOccurrenceParams) as never,
    );
  }, [
    offeringCta.kind,
    ticketQuantities,
    publicEvent.tickets,
    bookable,
    router,
    event.id,
    showToast,
    purchaseNeedsSignIn,
    purchaseBlockedByAccess,
    signInResumeHref,
    chosenOccurrenceParams,
    blockForDayTruth,
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
    if (Platform.OS === "web") {
      void shareCanonicalPublicPageOnWeb({
        url: canonicalUrl(event),
        title: event.name,
        description: event.description.slice(0, 200),
      }).then((result) => {
        if (result === "copied") showToast("Link copied");
        if (result === "failed") {
          showToast("The link could not be shared. Copy it from the address bar.");
        }
      });
      return;
    }
    setShareModalVisible(true);
  }, [event, showToast]);

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
        // issue #2101 — fail-closed AFTER the offering-native branch. On the
        // password-gate legacy variant the shared package owns the tier
        // control and is passed no disable lever, so the handler itself is the
        // only in-scope fence; the notice carries the explanation.
        if (blockForDayTruth()) return;
        if (purchaseNeedsSignIn) {
          router.push(signInResumeHref as never);
          return;
        }
        if (purchaseBlockedByAccess) return;
        // issue #2135 — same day-first gate as handleProceedToCart, so no
        // entry point into checkout can skip the multi-date choice.
        router.push(
          checkoutPublicPathWithSeed(event.id, {}, chosenOccurrenceParams) as never,
        );
      },
      onClaimFreeTicket: (_ticketId: string) => {
        if (!bookable) {
          showToast(
            "Booking unavailable right now — the organizer is finishing payment setup.",
          );
          return;
        }
        // issue #2101 — fail-closed, same contract as onBuyTicket. The free
        // ticket path moves entitlement, so it is a value-moving entry.
        if (blockForDayTruth()) return;
        if (purchaseNeedsSignIn) {
          router.push(signInResumeHref as never);
          return;
        }
        if (purchaseBlockedByAccess) return;
        // issue #2135 — same day-first gate (the free path moves entitlement,
        // and a free multi-date guest must still choose their day).
        router.push(
          checkoutPublicPathWithSeed(event.id, {}, chosenOccurrenceParams) as never,
        );
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
      onOpenMaps: openMapsForTarget,
      onCopyAddress: copyAddressForTarget,
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
      purchaseNeedsSignIn,
      purchaseBlockedByAccess,
      signInResumeHref,
      chosenOccurrenceParams,
      blockForDayTruth,
    ],
  );

  // ORCH-1138 — state banner (sold-out / sales-ended / pre-sale / not-bookable),
  // rendered above the body by the shared FOUNDATION body. Driven by the same
  // offeringCta state (one owner) so the banner never disagrees with the CTA.
  const stateBanner =
    acquisitionState.kind !== "current" ? (
      <EventAcquisitionNotice
        state={acquisitionState}
        eventType={isRsvp ? "rsvp" : "event"}
        brandName={publicBrand?.displayName ?? "The organizer"}
        palette={palette}
        theme={resolvedTheme}
        focusOnMount={serverAcquisitionOverride !== null}
      />
    ) : offeringCta.kind === "unavailable" ? (
      <View style={[styles.banner, { backgroundColor: palette.card }]}>
        <Text style={[styles.bannerText, { color: palette.secondaryText }]}>
          {offeringCta.title}
        </Text>
      </View>
    ) : null;

  const handleRetryOccurrences = useCallback((): void => {
    if (onRetryOccurrences === undefined) return;
    void retryCanonicalDayTruth(
      onRetryOccurrences,
      () => {
        // A successful canonical refresh is the only event that may lower the
        // stale fence. Require an explicit fresh choice afterward.
        setSelectedOccurrenceIds(NO_SELECTION);
        setDayChoiceMissing(false);
        setOccurrencesStale(false);
      },
      () => {
        showToast("We couldn’t refresh the event days. Try again.");
      },
    );
  }, [onRetryOccurrences, showToast]);

  // issue #2399 — app-local, lazy chooser injected as the shared purchase
  // card's first child. Non-purchase states do not ask the buyer for a day.
  const multiDateDayChooser = requiresMultiDatePurchase ? (
    <React.Suspense fallback={null}>
      <MultiDateDayChooser
        timezone={event.timezone ?? "UTC"}
        palette={palette}
        fontFamily={boldFamily}
        occurrences={occurrences}
        selectedOccurrenceIds={selectedOccurrenceIds}
        pricingMode={multiDatePricingMode}
        isPaid={eventHasPaidTicket}
        highlightUnchosen={dayChoiceMissing}
        state={dayChooserState}
        onRetry={
          onRetryOccurrences === undefined ? undefined : handleRetryOccurrences
        }
        onToggle={handleOccurrenceToggle}
      />
    </React.Suspense>
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
  const stickyPanel = isDesktop && acquisitionState.kind === "current" ? (
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
          // issue #2101 — the desktop sticky-panel purchase control. This page
          // renders EventTicketBox directly, so the accessible disabled state
          // is set from here with no edit to the shared package.
          submitting={purchaseBlockedByAccess}
          showHeading
          pricingNote={ticketPricingNote}
          leadingPurchaseSection={multiDateDayChooser}
          priceMultiplier={selectedDayMultiplier}
          purchaseReady={multiDatePurchaseReady}
          purchaseBlockedLabel={dayBlockedLabel}
          testID="orch-1167-event-desktop-ticket-box"
        />
      </View>
    </View>
  ) : null;

  // ORCH-1150 — RSVP branch. An event_type='rsvp' row has zero tickets + no
  // checkout; it renders the Going/Not-going RsvpPublicBody and returns early.
  // The ticketed path below is BYTE-IDENTICAL (untouched) for every non-RSVP row.
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
      guestPhoneCountryIso?: string | null;
      plusCount: number;
      guests: Array<{ name: string; email: string; phone: string }>;
    }): Promise<{
      status: "going" | "not_going" | "waitlisted" | "maybe";
      approvalStatus: "pending" | "approved";
      rsvpId: string;
      confirmationToken: string | null;
      credentials: import("@mingla/offering-rendering").RsvpPassCredential[];
      anonymousRecovery: import("@mingla/offering-rendering").RsvpAnonymousRecovery[];
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
      const result = await submitPublicRsvp({
        eventId: event.id,
        rsvpStatus: input.rsvpStatus,
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        guestPhone: input.guestPhone,
        guestPhoneCountryIso: input.guestPhoneCountryIso,
        plusCount: input.plusCount,
        guests: input.guests,
      });
      captureWeb("rsvp_acknowledgement_viewed", {
        surface: "anonymous_web",
        status: result.status,
        approval: result.approvalStatus,
      });
      if (result.credentials.length > 0) {
        captureWeb("rsvp_pass_viewed", { surface: "anonymous_web_success" });
      }
      return result;
    },
    [event.id],
  );

  const handleDownloadRsvpPass = useCallback(async (
    credential: import("@mingla/offering-rendering").RsvpPassCredential,
    recovery: import("@mingla/offering-rendering").RsvpAnonymousRecovery | null,
  ): Promise<void> => {
    const surface = "anonymous_web_success";
    captureWeb("rsvp_pass_pdf_requested", { surface });
    try {
      const pdf = await fetchPublicRsvpPassPdf(
        credential.entityType,
        credential.entityId,
        recovery?.recoveryToken ?? null,
      );
      if (Platform.OS !== "web" || typeof document === "undefined") {
        throw new Error("rsvp_pdf_web_only");
      }
      const objectUrl = URL.createObjectURL(pdf.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = pdf.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      captureWeb("rsvp_pass_pdf_result", { surface, outcome: "success" });
    } catch (error) {
      captureWeb("rsvp_pass_pdf_result", { surface, outcome: "failure" });
      throw error;
    }
  }, [event.id]);

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
      chipInIdempotencyRef.current ??= crypto.randomUUID();
      const res = await submitRsvpContribution({
        eventId: event.id,
        amountCents,
        surface: "web",
        guestName: contact?.name,
        guestEmail: contact?.email,
        callerIdempotencyKey: chipInIdempotencyRef.current,
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
  const [returnBanner, setReturnBanner] = useState<"paid" | "cancel" | "return" | null>(
    contributionParam === "paid"
      ? "paid"
      : contributionParam === "cancel"
        ? "cancel"
        : contributionParam === "return"
          ? "return"
          : null,
  );
  const returnBannerHandledRef = useRef<boolean>(false);
  useEffect(() => {
    if (returnBannerHandledRef.current) return;
    if (
      contributionParam !== "paid" &&
      contributionParam !== "cancel" &&
      contributionParam !== "return"
    ) return;
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
  useEffect(() => {
    if (acquisitionState.kind === "current") return;
    setGateVisible(false);
    setWaitlistTicketId(null);
    setTicketQuantities({});
    setReturnBanner(null);
    setToast({ visible: false, message: "", preservePageFocus: false });
    // issue #2135 — an event that ended / was cancelled mid-session must not
    // leave an occurrence picker open over a dead page (mirrors the waitlist +
    // gate teardown above). No-op on every single-date page.
    setDayChoiceMissing(false);
    setSelectedOccurrenceIds(NO_SELECTION);
  }, [acquisitionState.kind]);

  // ── ORCH-1295 [chip-in-post-payment-polish] — BUG 2: the country-code-aware guest
  // phone field. Reuses @mingla/phone-input (as on the buyer checkout form). The
  // hook owns country + local-digits state; here we render the picker + compose
  // the E.164 value the RSVP submit expects. ──
  const defaultPhoneCountry = useMemo(
    () => resolvePrimaryRsvpPhoneCountry(event.currency ?? null),
    [event.currency],
  );
  const renderRsvpPhoneField = useBusinessRsvpPhoneField(
    palette,
    resolvedTheme,
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
            {/* issue #868 [cover-gallery] — mandate H: the RSVP web <Head> was
                missing og:image (only the event/trip SSR paths had one), so RSVP
                share cards fell back to a blank preview. ADD-ONLY: reads the
                UNCHANGED cover (eventOgImageUrl → coverMediaUrl or the
                /og/event/{id}.png fallback); the gallery is irrelevant to share. */}
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
            <meta name="twitter:card" content="summary_large_image" />
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

        <FoundationRsvpPreview
          event={publicEvent}
          brand={publicBrand}
          palette={palette}
          theme={resolvedTheme}
          stateBanner={stateBanner}
          onAcquisitionClosed={setServerAcquisitionOverride}
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
            // issue #1014 — NULL passthrough, no fabricated USD: a chip-in
            // event always has a resolvable settlement currency (publish
            // forces resolution); when null the shared body hides the panel
            // (defense — it only renders when rsvp_contribution_enabled).
            settlementCurrency: event.currency ?? null,
            hostShortName: brand?.displayName ?? undefined,
            // ORCH-1339 (D2) — the two SERVER-authoritative display gates.
            // Source binding (SPEC §4.6 / OQ-3): the LiveEvent model fields —
            // they are non-optional booleans parsed server-side on BOTH the
            // authed and the anon view paths (publicEventsService, F-4), so
            // they are always populated on this page; the socialProof payload
            // carries the same server truth and stays the fallback.
            privateGuestList:
              event.privateGuestList ??
              socialProofQuery.data?.privateGuestList ??
              false,
            hideRemainingCount:
              event.hideRemainingCount ??
              socialProofQuery.data?.hideRemainingCount ??
              false,
            // ORCH-1340 — the server-filtered avatar sample ([] until the
            // socialProof read resolves — glyph cluster meanwhile).
            guestSample: socialProofQuery.data?.sample ?? [],
            // ORCH-1342 — the web "See who's going" tap opens the install
            // gate (web-only; undefined on business native → inert cluster,
            // DESIGN §1.5). The package's own D2 gates (privateGuestList /
            // goingCount 0) keep the affordance absent when gated.
            onSeeWhosGoing:
              acquisitionState.kind === "current"
                ? { onSeeWhosGoing: onSeeWhosGoingProp }.onSeeWhosGoing
                : undefined,
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
          onOpenMaps={openMapsForTarget}
          onCopyAddress={copyAddressForTarget}
          staticMapUrl={staticMapUrl}
          onSubmit={rsvpSubmit}
          onDownloadPass={handleDownloadRsvpPass}
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
          contentKind={isRsvp ? "rsvp_event" : "event"}
          title={event.name}
          description={event.description.slice(0, 200)}
        />

        <View style={styles.toastWrap} pointerEvents="box-none">
          <Toast
            visible={toast.visible}
            kind="info"
            message={toast.message}
            onDismiss={dismissToast}
            preservePageFocusOnWeb={toast.preservePageFocus}
            onPresented={
              toast.preservePageFocus ? revealDayChooser : undefined
            }
          />
        </View>

        {/* ORCH-1295 [chip-in-post-payment-polish] — BUG 1: post-payment web return
            banner. A guest who chipped in on Stripe/Paystack lands back here; show a
            clear gift-framed confirmation (or a neutral canceled state) instead of a
            silent page. Dismissible; the param is stripped so a refresh won't repeat it. */}
        {acquisitionState.kind === "current" && returnBanner !== null ? (
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
                    : returnBanner === "return"
                      ? "Confirming your chip-in"
                      : "Payment canceled"}
                </Text>
                <Text style={[styles.returnBannerBody, { color: palette.secondaryText }]}>
                  {returnBanner === "paid"
                    ? `Your gift to ${brand?.displayName ?? "the host"} came through — your RSVP's all set.`
                    : returnBanner === "return"
                      ? "We’re checking the payment securely. Your RSVP remains confirmed while this finishes."
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

        {/* ORCH-1342 — the ONE web install gate. Conditionally rendered so the
            lazy chunk fetches ONLY on the first open (hidden ⇒ nothing in the
            tree — the COMMS-0084 no-residue posture holds by construction). */}
        {acquisitionState.kind === "current" ? (
          <>
            {gateVisible ? (
              <React.Suspense fallback={null}>
                <SeeWhosGoingGate
                  visible={gateVisible}
                  onClose={() => setGateVisible(false)}
                  entity={gateEntity}
                  eventId={event.id}
                  guestSample={socialProofQuery.data?.sample ?? []}
                  palette={palette}
                  theme={resolvedTheme}
                />
              </React.Suspense>
            ) : null}
          </>
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
          onOpenMaps={openMapsForTarget}
          onCopyAddress={copyAddressForTarget}
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
          contentBottomInset={
            isDesktop
              ? 0
              : acquisitionState.kind === "current"
                ? FLOATING_BAR_CLEARANCE + insets.bottom
                : insets.bottom + 24
          }
          // ORCH-1167-R2 (change 5) — desktop relocates the box to the sticky panel.
          hideTicketBox={isDesktop || acquisitionState.kind !== "current"}
          // issue #2160 §7(a) — the phone inline ticket box. Null on every
          // single-date and free event, so the rendered tree is unchanged there.
          pricingNote={ticketPricingNote}
          leadingPurchaseSection={multiDateDayChooser}
          priceMultiplier={selectedDayMultiplier}
          purchaseReady={multiDatePurchaseReady}
          purchaseBlockedLabel={dayBlockedLabel}
          ticketQuantities={ticketQuantities}
          onChangeTicketQuantity={handleChangeTicketQuantity}
          onProceedToCart={handleProceedToCart}
          // issue #2101 — forwarded VERBATIM by FoundationEventPreview to
          // EventOfferingBody -> EventTicketBox, which owns the PHONE inline
          // purchase control. No edit to either file is required.
          submitting={purchaseBlockedByAccess}
          onDockLayout={handleDockLayout}
          // ORCH-1339 — cross-entity social proof (server-gated payload).
          socialProof={socialProofQuery.data ?? null}
          // ORCH-1342 — web-only "See who's going" → install gate (undefined
          // on business native → inert cluster, DESIGN §1.5).
          onSeeWhosGoing={onSeeWhosGoingProp}
          {...(acquisitionState.kind === "current"
            ? {}
            : { onSeeWhosGoing: undefined })}
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
      acquisitionState.kind === "current" &&
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
            // issue #2101 — the PHONE floating purchase control, rendered
            // directly by this page.
            submitting={purchaseBlockedByAccess}
            priceMultiplier={selectedDayMultiplier}
            purchaseReady={multiDatePurchaseReady}
            purchaseBlockedLabel={dayBlockedLabel}
            testID="orch-1167-event-floating-bar"
          />
        </View>
      ) : null}

      {/* issue #2101 [named-buyer checkout] — the SOLE public explanatory UI,
          mounted EXACTLY ONCE and OUTSIDE the variant branch so it also renders
          on the cancelled / password-gate legacy variants (where the shared
          package owns the tier control and is passed no disable lever). It
          renders null for unrestricted and allowed viewers, so an ordinary
          public offering is byte-identical to today. Absolute wrap: the page's
          scroll host is flex:1, so an in-flow sibling would measure zero. */}
      <View
        style={[
          styles.accessNoticeWrap,
          { bottom: (isDesktop ? 24 : FLOATING_BAR_CLEARANCE) + insets.bottom },
        ]}
        pointerEvents="box-none"
      >
        <TicketCheckoutAccessNotice eventId={event.id} />
      </View>

      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(event)}
        contentKind={isRsvp ? "rsvp_event" : "event"}
        title={event.name}
        description={event.description.slice(0, 200)}
      />

      {acquisitionState.kind === "current" && waitlistTicket !== null ? (
        <JoinWaitlistSheet
          visible
          eventId={event.id}
          ticket={waitlistTicket}
          onClose={() => setWaitlistTicketId(null)}
        />
      ) : null}

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={dismissToast}
          preservePageFocusOnWeb={toast.preservePageFocus}
          onPresented={toast.preservePageFocus ? revealDayChooser : undefined}
        />
      </View>

      {/* ORCH-1342 — the ONE web install gate. Conditionally rendered so the
          lazy chunk fetches ONLY on the first open (hidden ⇒ nothing in the
          tree — the COMMS-0084 no-residue posture holds by construction). */}
      {acquisitionState.kind === "current" ? (
        <>
          {gateVisible ? (
            <React.Suspense fallback={null}>
              <SeeWhosGoingGate
                visible={gateVisible}
                onClose={() => setGateVisible(false)}
                entity={gateEntity}
                eventId={event.id}
                guestSample={socialProofQuery.data?.sample ?? []}
                palette={palette}
                theme={resolvedTheme}
              />
            </React.Suspense>
          ) : null}
        </>
      ) : null}
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
  // issue #2101 — the restricted-sale notice sits above the floating bar on
  // phone and above the desktop bottom gutter. `box-none` keeps the page fully
  // scrollable behind it.
  accessNoticeWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 7,
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
});
