import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadVenueGuestScreens } from "./guest/venueGuestOwner";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { SecurePaymentHandoff } from "../offering/LazyPublicParts";
import {
  captureWeb,
  getStoredClickAttribution,
} from "../../analytics/webAnalytics";
import {
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
  type PhoneInputTheme,
} from "@mingla/phone-input";
// issue #3380 — the ONE phone rule set, by deep specifier (never a barrel mock).
import {
  parsePhoneEntry,
  resolvePhoneStartCountry,
} from "@mingla/phone-input/phoneNumber";
import { type ThemePalette } from "@mingla/offering-rendering";
import type { PublicVenueReservationBar } from "@mingla/brand-rendering/PublicVenueScreen";
import {
  radius,
  space,
  type,
  color,
} from "../../constants/designSystem";
import { BUYER_CLAIM_COPY } from "../../constants/buyerClaimCopy";
import { usePublicVenueAvailability } from "../../hooks/usePublicVenueAvailability";
import {
  createGuestVenueReservation,
  GuestReservationReviewError,
  previewGuestVenueReservation,
  type GuestReservationPreview,
} from "../../services/venueGuestReservationService";
import { guestReservationFailureCopy } from "./venueGuestReservationErrorCopy";
import { venueBarDayLabel, venueReservationBarCopy } from "./venueReservationBar";
import {
  captureVenueOrganicEvent,
  getVenueOrganicJourneyToken,
} from "../../services/venueOrganicCaptureService";
import { runBuyerVenueOrganicCapture } from "../../services/venueOrganicCapturePolicy";
import { devicePhoneRegion } from "../../utils/devicePhoneRegion";
import { phoneStartCountryForCurrency } from "../../utils/phoneStartCountryForCurrency";
import { composeE164 } from "../../utils/phone";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { BuyerClaimCard } from "../offering/LazyPublicParts";
import { mintClaimLinkHandoff } from "../../services/claimLinkService";
import { accentIcon, accentOutline } from "@mingla/offering-rendering/themeAccentStyle";
import { opaqueAccentWashColor } from "@mingla/offering-rendering/themePalette";
// issue #4420 — the shared decide controls (date strip, stepper, chips).
import {
  OfferingChipRow,
  OfferingChoiceChip,
  OfferingDateStrip,
  OfferingPanel,
  OfferingPanelRow,
  OfferingStepper,
} from "@mingla/offering-rendering/OfferingDecideParts";
import { OfferingSubLabel } from "@mingla/offering-rendering/OfferingSectionTitle";
import type { VenueFeatureTablesView } from "@mingla/brand-rendering/venueFeaturePage";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import {
  confirmGuestVenueReservation,
} from "../../services/venueGuestReservationService";
import type { GuestTableOption } from "../../services/venueTableGuestService";
// #4490 P5 — the seat map and the waitlist form load only when a guest opens them.
// Both come from the ONE Guest venue owner (guest/venueGuestOwner.ts).
const VenueFloorPick = React.lazy(async () => ({
  default: (await loadVenueGuestScreens()).VenueFloorPick,
}));
const GuestWaitlistForm = React.lazy(async () => ({
  default: (await loadVenueGuestScreens()).GuestWaitlistForm,
}));
const optionKey = (o: Pick<GuestTableOption, "tableIds">): string => [...o.tableIds].sort().join("+");
import {
  clearPending,
  readPendingForVenue,
  savePending,
  type PendingTableBooking,
} from "./offers/tablePendingReturn";
import {
  isBigParty,
  optionTitle,
  partyDetail,
  partyRange,
  pickMoneyLines,
  tableGuestErrorCopy,
  windowChoices,
} from "./offers/tablePickModel";

const DiscountReasonText = React.lazy(() =>
  import("@mingla/offering-rendering/DiscountReasonText").then((module) => ({
    default: module.DiscountReasonText,
  })),
);

interface GuestVenueReservationProps {
  venueId: string;
  brandId: string;
  currency: string | null;
  /**
   * issue #3380 — the venue's country (ISO alpha-2), when a host has it. The
   * phone picker starts here; without it, on the country the venue CHARGES in
   * (`currency`: a naira venue opens on +234, a dollar venue on +1). Only when
   * neither names a country does the visitor's own browser region decide.
   */
  countryCode?: string | null;
  analyticsSurface: "buyer_web" | "business_preview";
  /**
   * issue #1564 — the page's RESOLVED palette, handed down by the booking slot.
   *
   * THE BUG THIS CLOSES. Every other pixel of the public venue page is themed
   * from this palette, and the Stay booking body (`BuyerStayGuestExperience`)
   * has always received it — but the table-reservation body hardcoded Mingla
   * orange `#eb7825` and the near-black `#0c0e12`. Restaurants therefore got
   * the broken half of a themed page: a brand in blue opened a reservation
   * form with an orange focus ring. Once a VENUE can pick its own colours that
   * stops being a subtle mismatch and becomes a jarring one, so it is fixed
   * here rather than left to be discovered.
   *
   * The `table` branch of `PublicVenueBookingSlotContext` already carried
   * `palette` (via `PublicVenueThemedContext`) — nothing was plumbed, only
   * ignored.
   */
  palette: ThemePalette;
  /**
   * #4453 milestone 5 — a Mingla website's pre-fill (already re-validated by
   * the route): the date, the time and the party size the guest picked on the
   * site. A time is selected only once Mingla's own slots show it open.
   */
  initialDate?: string | null;
  initialTime?: string | null;
  initialPartySize?: number | null;
  /**
   * issue #4420 wave 2 (D-V3) — set by the page's Reservations tab. The page's
   * glass bar then carries the live pick and the one next step: Continue
   * (pick → your details), then Confirm & pay. Without it (the reserve sheet,
   * the host preview) the form keeps its own in-body button.
   */
  onReservationBarChange?: (bar: PublicVenueReservationBar | null) => void;
  /**
   * #4490 P5 — the venue's tables block (party cap, pick a table, seating
   * areas, big-party request, guest waitlist). Absent = today's flow, up to 12.
   */
  tables?: VenueFeatureTablesView | null;
  /** #4490 P5 — for the floor's room shapes and the page the guest returns to. */
  brandSlug?: string | null;
  venueSlug?: string | null;
  venueName?: string | null;
}
const INVALID_PHONE_COPY = "Enter a valid phone number.";

/**
 * #4490 fix 2 (N56) — the guest's private manage page for a free table
 * booking: the id and token ride in the fragment (never sent to a server).
 */
export function guestReservationManageHref(
  brandId: string,
  reservationId: string | null | undefined,
  token: string | null,
): string | null {
  if (typeof reservationId !== "string" || reservationId.length === 0 || token === null || token.length === 0) return null;
  return `/reserve/${encodeURIComponent(brandId)}/manage#reservationId=${encodeURIComponent(reservationId)}&token=${encodeURIComponent(token)}`;
}
const INVALID_NAME_COPY = "Enter your name.";
const INVALID_EMAIL_COPY = "Enter a valid email address.";
const RESERVATION_FAILURE_COPY =
  "We couldn’t start your reservation. Check your details and try again.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatMoney = (minor: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
};

const dateOptions = (): { value: string; label: string }[] => {
  const now = new Date();
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + index,
    );
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      label:
        index === 0
          ? "Today"
          : date.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            }),
    };
  });
};

/**
 * issue #4420 — quick picks for the existing free-text occasion field (the
 * guest can still type any occasion below). Nothing new reaches the server:
 * the chosen words fill the same `occasion` string.
 */
const VENUE_OCCASIONS = ["Birthday", "Date night", "Anniversary", "Business"] as const;

/** issue #4420 — "TODAY / 16 / Nov" tile text for a YYYY-MM-DD date value. */
export const venueDateTileParts = (
  value: string,
  index: number,
): { top: string; big: string; bottom: string } => {
  const [y, m, d] = value.split("-").map((part) => Number(part));
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const top =
    index === 0
      ? "Today"
      : index === 1
        ? "Tmrw"
        : date.toLocaleDateString("en-GB", { weekday: "short" });
  return {
    top,
    big: String(date.getDate()),
    bottom: date.toLocaleDateString("en-GB", { month: "short" }),
  };
};

const phoneCountryKnown = (iso: string): boolean => {
  try {
    return getCountryByCode(iso) !== undefined;
  } catch {
    return false;
  }
};

const phoneStartCountry = (
  venueCountry: string | null | undefined,
  currency: string | null,
): string =>
  resolvePhoneStartCountry(
    [venueCountry, phoneStartCountryForCurrency(currency), devicePhoneRegion()],
    phoneCountryKnown,
  ) ?? "US";

export function GuestVenueReservation(
  props: GuestVenueReservationProps,
): React.ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { gcTime: Infinity } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <GuestVenueReservationBody {...props} />
    </QueryClientProvider>
  );
}

function GuestVenueReservationBody({
  venueId,
  brandId,
  currency,
  countryCode = null,
  analyticsSurface,
  palette,
  initialDate = null,
  initialTime = null,
  initialPartySize = null,
  onReservationBarChange,
  tables = null,
  brandSlug = null,
  venueSlug = null,
  venueName = null,
}: GuestVenueReservationProps): React.ReactElement {
  // #4490 P5 — the party cap is the venue's own (no more 12); above the
  // largest table or joined pair the booking becomes a request.
  const range = useMemo(() => partyRange(tables), [tables]);
  const seatingAreas = tables?.seatingAreas ?? [];
  const pickOn = tables?.pickATable === true;
  const showSeating = seatingAreas.length > 1 || pickOn;
  const [seat, setSeat] = useState<string>("any");
  const [picked, setPicked] = useState<GuestTableOption | null>(null);
  const [waitlistMode, setWaitlistMode] = useState<"tonight" | "notify" | null>(null);
  const [bigTimeUtc, setBigTimeUtc] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [pendingReturn, setPendingReturn] = useState<PendingTableBooking | null>(null);
  const [pendingState, setPendingState] = useState<"idle" | "checking" | "pending" | "error">("idle");
  const [completedTable, setCompletedTable] = useState<PendingTableBooking | null>(null);
  useEffect(() => {
    setPendingReturn(readPendingForVenue(venueId));
  }, [venueId]);
  const dates = useMemo(dateOptions, []);
  // issue #4420 wave 2 (D-V3) — with the page's bar, the booking walks two
  // steps: pick (date, party, time, occasion), then your details.
  const barOwned = onReservationBarChange !== undefined;
  const [step, setStep] = useState<"pick" | "details">("pick");
  // issue #1564 — derived from the page's palette, byte-for-byte the mapping
  // `PublicEventPage.phoneFieldTheme` already uses, so the two themed phone
  // fields in this app cannot drift. `#ef4444` stays literal on both error
  // tokens: an error is a SEMANTIC colour, not a brand one, and tinting it
  // with a red-accented venue's own hue would make an error indistinguishable
  // from the rest of the form.
  const phoneFieldTheme = useMemo<PhoneInputTheme>(
    () => ({
      backgroundPrimary: palette.page,
      textPrimary: palette.primaryText,
      textTertiary: palette.tertiaryText,
      borderDefault: palette.panelBorder,
      borderFocused: palette.accent,
      borderError: color.danger,
      searchBackground: palette.card,
      rowPressedBackground: palette.accentWash,
      divider: palette.panelBorder,
      accessoryBackground: palette.page,
      accessoryBorder: palette.panelBorder,
      accent: palette.accent,
      errorText: color.errorText,
    }),
    [palette],
  );
  // The date/time chips. `chipSelected` was `borderColor:"#eb7825"` +
  // `backgroundColor:"rgba(235,120,37,0.16)"` — the same orange, spelled twice.
  // `accentWash` IS that 0.16-ish tint, derived from the resolved accent.
  const chipTheme = useMemo(
    () => ({
      chip: { borderColor: palette.panelBorder },
      chipSelected: {
        ...accentOutline(palette, { background: palette.accentWash, opaqueBackground: opaqueAccentWashColor(palette) }),
      },
    }),
    [palette],
  );
  const [partySize, setPartySize] = useState(Math.min(initialPartySize ?? 2, partyRange(tables).max));
  const big = isBigParty(partySize, range);
  const seatSpaceId = seat !== "any" && seat !== "pick" ? seat : null;
  const [date, setDate] = useState<string | null>(
    (initialDate && dates.some((option) => option.value === initialDate) ? initialDate : null) ?? dates[0]?.value ?? null,
  );
  const [selectedUtc, setSelectedUtc] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [nameServerInvalid, setNameServerInvalid] = useState(false);
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailServerInvalid, setEmailServerInvalid] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState(() =>
    phoneStartCountry(countryCode, currency),
  );
  const [phoneLocal, setPhoneLocal] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  // issue #3380 — the venue's country can arrive after mount; follow it until
  // the guest has typed a number or picked a country of their own.
  const phoneCountryChosen = useRef(false);
  const [occasion, setOccasion] = useState("");
  const [notes, setNotes] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState("");
  const [discountCode, setDiscountCode] = useState<string | null>(null);
  const [reviewQuote, setReviewQuote] =
    useState<GuestReservationPreview | null>(null);
  // issue #4420 wave 2 (§2.4) — the hosted payment page opens in THIS tab;
  // while it does, the Secure payment step replaces the form.
  const [handoff, setHandoff] = useState<{ url: string } | null>(null);
  const [completed, setCompleted] = useState<{
    email: string | null;
    phoneLast4: string | null;
    shortUrl: string | null;
    code: string | null;
    /** #4490 fix 2 (N56): the guest's private manage page (web, free bookings). */
    manageHref?: string | null;
  } | null>(null);

  const availability = usePublicVenueAvailability(
    venueId,
    date,
    big ? range.tableMax : partySize,
    seatSpaceId,
  );
  const slots = availability.data ?? [];
  // #4453 milestone 5 — the site's chosen time, selected ONCE, and only while
  // Mingla's own slots show it open (a full or missing time is simply not picked).
  const prefillTimeUsed = useRef(false);
  useEffect(() => {
    if (prefillTimeUsed.current || !initialTime || date !== initialDate) return;
    const match = slots.find((slot) => !slot.isFull && slot.slotLocalLabel.startsWith(initialTime));
    if (match) {
      prefillTimeUsed.current = true;
      setSelectedUtc(match.slotStartUtc);
    }
  }, [slots, initialTime, initialDate, date]);
  const availabilitySettled =
    !availability.isLoading &&
    !availability.isFetching &&
    !availability.isError;
  const currentSelectedSlot = slots.find(
    (slot) => slot.slotStartUtc === selectedUtc,
  );
  const selectedSlot =
    !availability.isError && currentSelectedSlot?.isFull === false && !big
      ? currentSelectedSlot
      : big && bigTimeUtc !== null
        ? slots.find((slot) => slot.slotStartUtc === bigTimeUtc)
        : undefined;
  // #4490 P5 — the table map for the chosen time ("Pick my table").
  const tablesQuery = useQuery({
    queryKey: ["guestVenueTables", venueId, date, partySize, selectedSlot?.slotStartUtc ?? null],
    enabled: seat === "pick" && !big && selectedSlot !== undefined && date !== null,
    staleTime: 10_000,
    queryFn: async () =>
      (await loadVenueGuestScreens()).fetchGuestTables({
        venueId,
        date: date ?? "",
        partySize,
        slotStartUtc: selectedSlot?.slotStartUtc ?? "",
        spaceId: null,
      }),
  });
  const plansQuery = useQuery({
    queryKey: ["guestVenueSpacePlans", brandSlug, venueSlug],
    enabled: seat === "pick" && brandSlug !== null && venueSlug !== null,
    staleTime: 60_000,
    queryFn: async () =>
      (await loadVenueGuestScreens()).fetchGuestSpacePlans({ brandSlug: brandSlug ?? "", venueSlug: venueSlug ?? "" }),
  });
  const pickedLive =
    picked === null ? null : (tablesQuery.data ?? []).find((o) => optionKey(o) === optionKey(picked)) ?? null;
  const pickReady = seat !== "pick" || big || (pickedLive !== null && pickedLive.status === "free");
  const moneyLines = pickMoneyLines(pickedLive, partySize, (m) => formatVenueMoney(m, currency ?? "NGN", 2));
  const submissionTruthRef = useRef<{
    canSubmit: boolean;
    reservedForUtc: string | null;
    selectableSlotUtcValues: readonly string[];
  }>({ canSubmit: false, reservedForUtc: null, selectableSlotUtcValues: [] });
  submissionTruthRef.current = {
    canSubmit: availabilitySettled && selectedSlot !== undefined && !submitting && pickReady,
    reservedForUtc: selectedSlot?.slotStartUtc ?? null,
    selectableSlotUtcValues: availabilitySettled
      ? slots.filter((slot) => !slot.isFull).map((slot) => slot.slotStartUtc)
      : [],
  };
  const phoneDialCode = getCountryByCode(phoneCountry)?.dialCode ?? "+1";
  const composedPhone = composeE164(phoneDialCode, phoneLocal);
  // issue #3380 — the reservation's confirmation is TEXTED, so the number must
  // be a mobile for the country on the picker. `0803 123 4567` under +44 used
  // to compose to +448031234567 and be saved; it is now refused with a message
  // naming Nigeria, and a one-tap switch.
  const phoneCheck = parsePhoneEntry(phoneLocal, {
    countryIso: phoneCountry,
    dialCode: phoneDialCode,
    mode: "mobile",
  });
  const phoneProblem =
    phoneLocal.replace(/\D/g, "").length > 0 && !phoneCheck.ok
      ? phoneCheck
      : null;
  const normalizedPhone = phoneProblem === null ? composedPhone : null;
  const phoneErrorCopy = phoneProblem?.message ?? INVALID_PHONE_COPY;
  const suggestedPhoneCountry =
    phoneProblem?.suggestedCountryIso != null
      ? getCountryByCode(phoneProblem.suggestedCountryIso)
      : undefined;
  const normalizedName = name.trim();
  const normalizedEmail = email.trim();
  const nameInvalid = normalizedName.length < 2;
  const emailInvalid = !EMAIL_PATTERN.test(normalizedEmail);
  const contactInvalid = nameInvalid || emailInvalid;

  const previewEnabled =
    selectedSlot !== undefined && !contactInvalid && normalizedPhone !== null && !big && pickReady;
  const pickedIds = seat === "pick" && pickedLive !== null ? pickedLive.tableIds : null;
  const reservationPreview = useQuery({
    queryKey: [
      "venueReservationPreview",
      venueId,
      selectedSlot?.slotStartUtc ?? null,
      partySize,
      normalizedName,
      normalizedEmail,
      normalizedPhone,
      discountCode,
      pickedIds?.join("+") ?? null,
      seatSpaceId,
    ],
    enabled: previewEnabled,
    queryFn: () =>
      previewGuestVenueReservation({
        venueId,
        brandId,
        reservedForUtc: selectedSlot?.slotStartUtc ?? "",
        partySize,
        buyer: {
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone ?? "",
          phoneCountryIso: phoneCountry,
          marketingOptIn,
        },
        occasion: occasion.trim() || null,
        guestNotes: notes.trim() || null,
        discountCode,
        tableIds: pickedIds,
        spaceId: seatSpaceId,
      }),
    retry: false,
  });
  const activePreview = reviewQuote ?? reservationPreview.data ?? null;
  const discountAnalyticsRef = useRef(new Set<string>());

  useEffect(() => {
    if (activePreview === null || analyticsSurface !== "buyer_web") return;
    const digest =
      activePreview.quoteDigest ?? `${selectedUtc ?? "slot"}:${partySize}`;
    const captureOnce = (
      event: string,
      suffix: string,
      properties: Readonly<Record<string, string | number>>,
    ): void => {
      const key = `${digest}:${event}:${suffix}`;
      if (discountAnalyticsRef.current.has(key)) return;
      discountAnalyticsRef.current.add(key);
      captureWeb(event, properties);
    };
    if (
      discountCode !== null &&
      activePreview.codeOutcome.status === "applied"
    ) {
      captureOnce("discount_code_applied", "code", { surface: "web_deposit" });
    } else if (
      discountCode !== null &&
      activePreview.codeOutcome.status === "rejected" &&
      activePreview.codeOutcome.reason !== null
    ) {
      captureOnce("discount_code_rejected", activePreview.codeOutcome.reason, {
        reason: activePreview.codeOutcome.reason,
        surface: "web_deposit",
      });
    }
    const automaticCount = activePreview.discounts.filter(
      (row) => row.kind === "automatic",
    ).length;
    if (automaticCount > 0) {
      captureOnce("discount_auto_applied", String(automaticCount), {
        count: automaticCount,
        surface: "web_deposit",
      });
    }
  }, [activePreview, analyticsSurface, discountCode, partySize, selectedUtc]);

  useEffect(() => {
    setReviewQuote(null);
  }, [
    discountCode,
    normalizedEmail,
    normalizedName,
    normalizedPhone,
    partySize,
    selectedUtc,
  ]);

  useEffect(() => {
    setPicked(null);
  }, [date, partySize, selectedUtc, bigTimeUtc]);

  useEffect(() => {
    if (phoneCountryChosen.current) return;
    setPhoneCountry(phoneStartCountry(countryCode, currency));
  }, [countryCode, currency]);

  useEffect(() => {
    if (!availabilitySettled || selectedUtc === null) return;
    if (currentSelectedSlot?.isFull !== false) setSelectedUtc(null);
  }, [availabilitySettled, currentSelectedSlot?.isFull, selectedUtc]);

  // #4420 D-V3 — losing the time (date or party changed, the slot filled)
  // returns the guest to the pick step.
  useEffect(() => {
    if (selectedUtc === null && step === "details") setStep("pick");
  }, [selectedUtc, step]);

  useEffect(() => {
    if (availability.data === undefined) return;
    captureWeb("venue_availability_result_viewed", {
      surface: analyticsSurface,
      brand_id: brandId,
      venue_id: venueId,
    });
    runBuyerVenueOrganicCapture(analyticsSurface, () => {
      void captureVenueOrganicEvent({ brandId, venueId }, "availability_shown");
    });
  }, [analyticsSurface, availability.data, brandId, venueId]);

  const submit = async (): Promise<void> => {
    const submissionTruth = submissionTruthRef.current;
    if (!submissionTruth.canSubmit || submissionTruth.reservedForUtc === null) {
      return;
    }
    if (nameInvalid) setNameTouched(true);
    if (emailInvalid) setEmailTouched(true);
    if (selectedUtc === null || contactInvalid || normalizedPhone === null) {
      setPhoneTouched(true);
      setError(normalizedPhone === null ? phoneErrorCopy : null);
      return;
    }
    submissionTruthRef.current = {
      canSubmit: false,
      reservedForUtc: submissionTruth.reservedForUtc,
      selectableSlotUtcValues: submissionTruth.selectableSlotUtcValues,
    };
    setSubmitting(true);
    setError(null);
    captureWeb("public_venue_reservation_submitted", {
      surface: analyticsSurface,
      brand_id: brandId,
      venue_id: venueId,
      currency,
    });
    try {
      // #4490 P5 — a party bigger than any table sends a request: nothing to pay.
      if (big) {
        const requestResult = await createGuestVenueReservation({
          venueId,
          brandId,
          reservedForUtc: submissionTruth.reservedForUtc,
          partySize,
          buyer: {
            name: normalizedName,
            email: normalizedEmail,
            phone: normalizedPhone,
            phoneCountryIso: phoneCountry,
            marketingOptIn,
          },
          occasion: occasion.trim() || null,
          guestNotes: notes.trim() || null,
          attributionClickId: getStoredClickAttribution().clickId,
          organicJourneyToken: getVenueOrganicJourneyToken({ brandId, venueId }),
          requestLargeParty: true,
        });
        if (requestResult.kind === "free_completed") {
          setRequested(true);
          setCompleted({
            email: requestResult.buyerContact?.email ?? null,
            phoneLast4: requestResult.buyerContact?.phoneLast4 ?? null,
            shortUrl: requestResult.claim?.shortUrl ?? null,
            code: requestResult.claim?.code ?? null,
          });
          return;
        }
        throw new Error("large_party_failed");
      }
      let checkoutPreview = activePreview;
      if (checkoutPreview === null) {
        const refreshedPreview = await reservationPreview.refetch();
        if (refreshedPreview.error !== null) {
          throw refreshedPreview.error;
        }
        checkoutPreview = refreshedPreview.data ?? null;
      }
      if (checkoutPreview === null) {
        throw new Error("We couldn’t get the reservation price.");
      }
      const result = await createGuestVenueReservation({
        venueId,
        brandId,
        reservedForUtc: submissionTruth.reservedForUtc,
        partySize,
        buyer: {
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone,
          phoneCountryIso: phoneCountry,
          marketingOptIn,
        },
        occasion: occasion.trim() || null,
        guestNotes: notes.trim() || null,
        attributionClickId: getStoredClickAttribution().clickId,
        organicJourneyToken: getVenueOrganicJourneyToken({ brandId, venueId }),
        discountCode,
        quoteDigest: checkoutPreview.quoteDigest,
        tableIds: pickedIds,
        spaceId: seatSpaceId,
      });
      if (result.kind === "free_completed") {
        setCompleted({
          email: result.buyerContact?.email ?? null,
          phoneLast4: result.buyerContact?.phoneLast4 ?? null,
          shortUrl: result.claim?.shortUrl ?? null,
          code: result.claim?.code ?? null,
          manageHref: guestReservationManageHref(brandId, result.reservationId, result.guestCancelToken ?? null),
        });
        captureWeb("venue_reservation_completed", {
          surface: analyticsSurface,
          brand_id: brandId,
          venue_id: venueId,
          free_paid: "free",
          currency,
        });
        return;
      }
      const redirect =
        result.kind === "requires_web_redirect"
          ? result.hostedCheckoutUrl
          : result.authorizationUrl;
      if (redirect === null || redirect.length === 0) {
        throw new Error("The payment page could not open. Try again.");
      }
      // #4490 P5 — remember the booking on this device, so the guest can
      // finish it from the venue page whatever the payment page returns to.
      savePending({
        reservationDraftId: result.reservationDraftId,
        buyerStatusToken: result.buyerStatusToken,
        brandId,
        venueId,
        venuePath: brandSlug !== null && venueSlug !== null ? `/b/${brandSlug}/v/${venueSlug}?tab=reservations` : null,
        venueName,
        summary: [
          pickedLive !== null ? optionTitle(pickedLive) : null,
          date !== null ? venueBarDayLabel(date) : null,
          selectedSlot?.slotLocalLabel ?? null,
          `${partySize} ${partySize === 1 ? "guest" : "guests"}`,
        ]
          .filter(Boolean)
          .join(" · "),
        holdLine:
          moneyLines.holdTotal !== null
            ? `${moneyLines.holdTotal}. Comes off your bill.`
            : null,
        minSpendLine: moneyLines.minSpend,
        savedAt: Date.now(),
      });
      setHandoff({ url: redirect });
    } catch (caught) {
      if (caught instanceof GuestReservationReviewError) {
        if (analyticsSurface === "buyer_web") {
          captureWeb("checkout_review_required", {
            detail: "discount_changed",
            surface: "web_deposit",
          });
        }
        setReviewQuote(caught.quote);
        setError("Your discount or total changed. Review the updated amount.");
        return;
      }
      const errorCode =
        caught instanceof Error ? caught.message : RESERVATION_FAILURE_COPY;
      if (errorCode === "buyer_name_required") {
        setNameTouched(true);
        setNameServerInvalid(true);
        setError(null);
      } else if (errorCode === "buyer_email_invalid") {
        setEmailTouched(true);
        setEmailServerInvalid(true);
        setError(null);
      } else {
        // #3387 — a refusal the guest can act on gets its own sentence.
        // prettier-ignore -- #3393 source contract audits this exact refusal owner.
        // #4490 P5 — a table refusal has its own words (and refreshes the map).
        const tableCopy = tableGuestErrorCopy(errorCode);
        if (tableCopy !== null) {
          setError(tableCopy);
          setPicked(null);
          void tablesQuery.refetch();
        } else {
        setError(
          guestReservationFailureCopy(errorCode) ?? RESERVATION_FAILURE_COPY,
        );
        }
      }
      captureWeb("venue_reservation_failed", {
        surface: analyticsSurface,
        brand_id: brandId,
        venue_id: venueId,
        result_class: "create_failed",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const previewTotalLabel =
    activePreview?.requiresPayment === true
      ? formatMoney(activePreview.totalCents, activePreview.currency)
      : null;
  // ── #4420 D-V3 — report the live bar to the page (Reservations tab). ──
  const barStep: "pick" | "details" =
    step === "details" && selectedSlot !== undefined ? "details" : "pick";
  const barCopy = venueReservationBarCopy({
    step: barStep,
    dayLabel: date === null ? "Pick a date" : venueBarDayLabel(date),
    timeLabel: selectedSlot?.slotLocalLabel ?? null,
    partySize,
    occasion,
    noTables: availabilitySettled && slots.length === 0,
    totalLabel: previewTotalLabel,
    requiresPayment: activePreview?.requiresPayment ?? null,
    reviewing: reviewQuote !== null,
  });
  const barEnabled =
    barStep === "details"
      ? !submitting && !contactInvalid && availabilitySettled
      : availabilitySettled && selectedSlot !== undefined && pickReady;
  // #4490 P5 — a big party sends a request; a picked table names itself.
  const barCta = big && barStep === "details" ? "Send request" : barCopy.ctaLabel;
  const barSubtitle = big
    ? `${partySize} guests · large party request · nothing to pay now`
    : pickedLive !== null && barStep === "pick"
      ? `${partySize} ${partySize === 1 ? "guest" : "guests"} · ${optionTitle(pickedLive)}`
      : barCopy.subtitle;
  const barActionRef = useRef<() => void>(() => undefined);
  barActionRef.current =
    barStep === "details"
      ? () => void submit()
      : () => {
          if (selectedSlot !== undefined) setStep("details");
        };
  const barHidden = handoff !== null || completed !== null;
  useEffect(() => {
    if (onReservationBarChange === undefined) return;
    onReservationBarChange(
      barHidden
        ? null
        : {
            title: barCopy.title,
            subtitle: barSubtitle,
            ctaLabel: barCta,
            enabled: barEnabled,
            onPress: () => barActionRef.current(),
          },
    );
  }, [
    onReservationBarChange,
    barHidden,
    barCopy.title,
    barSubtitle,
    barCta,
    barEnabled,
  ]);
  useEffect(
    () => () => onReservationBarChange?.(null),
    [onReservationBarChange],
  );

  if (handoff !== null) {
    return (
      <SecurePaymentHandoff
        url={handoff.url}
        palette={palette}
        onBack={() => setHandoff(null)}
        testID="issue-4420-venue-secure-payment"
      />
    );
  }

  if (completed !== null) {
    const claimCode = completed.code;
    return (
      <View style={[styles.stateCard, { borderColor: palette.panelBorder }]}>
        <Text style={[styles.title, { color: palette.primaryText }]}>
          {requested ? "Request sent" : BUYER_CLAIM_COPY.venue.title}
        </Text>
        {completedTable !== null ? (
          <View testID="issue-4490-table-confirmed">
            <Text style={[styles.yourTableTitle, { color: palette.primaryText }]}>{completedTable.summary}</Text>
            {completedTable.holdLine !== null ? <Text style={[styles.body, { color: palette.secondaryText }]}>{completedTable.holdLine}</Text> : null}
            {completedTable.minSpendLine !== null ? <Text style={[styles.body, { color: palette.secondaryText }]}>{completedTable.minSpendLine}</Text> : null}
          </View>
        ) : null}
        {completedTable === null && date !== null ? (
          // #4490 N56: the same recap every other offer's booking page shows:
          // the day, time, party and table, and what the guest can do next.
          <View testID="issue-4490-table-recap">
            <Text style={[styles.yourTableTitle, { color: palette.primaryText }]}>
              {[
                venueBarDayLabel(date),
                selectedSlot?.slotLocalLabel ?? null,
                `${partySize} ${partySize === 1 ? "guest" : "guests"}`,
                pickedLive !== null && pickedLive.names.length > 0 ? pickedLive.names.join(" + ") : null,
                occasion.trim().length > 0 ? occasion.trim() : null,
              ]
                .filter((x): x is string => x !== null)
                .join(" · ")}
            </Text>
            {!requested && completed.manageHref != null ? (
              <View style={styles.manageRow}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="Manage this booking"
                  onPress={() => {
                    if (typeof window !== "undefined") window.location.assign(completed.manageHref as string);
                  }}
                  style={[styles.manageButton, { borderColor: palette.secondaryText }]}
                  testID="issue-4490-table-manage"
                >
                  <Text style={[styles.manageLabel, { color: palette.primaryText }]}>Manage booking</Text>
                </Pressable>
                <Text style={[styles.body, { color: palette.secondaryText }]}>
                  {`The same link is in your confirmation email${completed.email !== null ? ` to ${completed.email}` : ""}.`}
                </Text>
              </View>
            ) : !requested ? (
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                {`To change or cancel, use the link in your confirmation email${completed.email !== null ? ` to ${completed.email}` : ""}, or contact ${venueName ?? "the venue"}.`}
              </Text>
            ) : null}
          </View>
        ) : null}
        {requested ? (
          <Text style={[styles.body, { color: palette.secondaryText }]} testID="issue-4490-big-party-sent">
            {`${venueName ?? "The venue"} confirms large parties. Nothing to pay until they do. We'll email you their answer.`}
          </Text>
        ) : null}
        <BuyerClaimCard
          kind="booking"
          email={completed.email}
          phoneLast4={completed.phoneLast4}
          shortUrl={completed.shortUrl}
          handoff={
            claimCode === null
              ? null
              : { mint: () => mintClaimLinkHandoff(claimCode) }
          }
          textSent={completed.phoneLast4 !== null}
          analyticsSurface="guest_venue_reservation"
          fallbackEntity={{
            entityType: "event",
            brandSlug: brandId,
            entitySlug: venueId,
          }}
        />
      </View>
    );
  }

  // #4490 P5 — no table at that time is never a dead end.
  const isToday = date !== null && date === dates[0]?.value;
  const waitlistOffers =
    waitlistMode === null && (tables?.notifyMe === true || (tables?.guestWaitlist === true && isToday)) ? (
      <View style={styles.waitlistButtons}>
        {tables?.notifyMe === true && slots.length > 1 ? (
          <Button
            label="Tell me if a table opens"
            variant="secondary"
            onPress={() => setWaitlistMode("notify")}
            testID="issue-4490-notify-me"
          />
        ) : null}
        {tables?.guestWaitlist === true && isToday ? (
          <Button
            label="Join tonight's waitlist"
            variant="secondary"
            onPress={() => setWaitlistMode("tonight")}
            testID="issue-4490-join-waitlist"
          />
        ) : null}
      </View>
    ) : null;
  const checkPendingPayment = async (): Promise<void> => {
    if (pendingReturn === null) return;
    setPendingState("checking");
    try {
      const result = await confirmGuestVenueReservation({
        reservationDraftId: pendingReturn.reservationDraftId,
        buyerStatusToken: pendingReturn.buyerStatusToken,
      });
      if (result.status === "completed") {
        clearPending(pendingReturn);
        setCompletedTable(pendingReturn);
        setPendingReturn(null);
        setPendingState("idle");
        setCompleted({
          email: result.buyerContact?.email ?? null,
          phoneLast4: result.buyerContact?.phoneLast4 ?? null,
          shortUrl: result.claim?.shortUrl ?? null,
          code: result.claim?.code ?? null,
        });
        return;
      }
      setPendingState(result.status === "pending" ? "pending" : "error");
    } catch {
      setPendingState("error");
    }
  };
  const pendingCard =
    pendingReturn !== null ? (
      <View style={[styles.stateCard, { borderColor: palette.panelBorder, backgroundColor: palette.accentWash }]} testID="issue-4490-pending-return">
        <Text style={[styles.yourTableTitle, { color: palette.primaryText }]}>Finish your table booking</Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>{pendingReturn.summary}</Text>
        {pendingReturn.holdLine !== null ? <Text style={[styles.body, { color: palette.secondaryText }]}>{pendingReturn.holdLine}</Text> : null}
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {pendingState === "pending"
            ? "Your payment is still going through. Give it a minute, then check again."
            : pendingState === "error"
              ? "We couldn't confirm it yet. If you paid, your booking is safe while we check. Try again in a minute."
              : "If you paid, check it here to see your booking."}
        </Text>
        <View style={styles.waitlistButtons}>
          <Button
            label="Check my payment"
            variant="primary"
            accentColor={palette.accent}
            loading={pendingState === "checking"}
            disabled={pendingState === "checking"}
            onPress={() => void checkPendingPayment()}
            testID="issue-4490-pending-check"
          />
          <Button
            label="I didn't pay"
            variant="secondary"
            onPress={() => {
              clearPending(pendingReturn);
              setPendingReturn(null);
            }}
            testID="issue-4490-pending-dismiss"
          />
        </View>
      </View>
    ) : null;

  const showDetails = barOwned
    ? barStep === "details"
    : selectedSlot !== undefined;
  return (
    <View style={styles.host}>
      {pendingCard}
      {barOwned && barStep === "details" && selectedSlot !== undefined ? (
        <View
          style={[
            styles.yourTable,
            { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
          ]}
          testID="issue-4420-venue-your-table"
        >
          <View style={styles.yourTableCopy}>
            <OfferingSubLabel palette={palette}>Your table</OfferingSubLabel>
            <Text style={[styles.yourTableTitle, { color: palette.primaryText }]}>
              {`${date === null ? "" : `${venueBarDayLabel(date)} · `}${selectedSlot.slotLocalLabel} · ${partySize} ${partySize === 1 ? "guest" : "guests"}`}
            </Text>
            {occasion.trim().length > 0 ? (
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                {occasion.trim()}
              </Text>
            ) : null}
            {pickedLive !== null ? (
              <Text style={[styles.body, { color: palette.primaryText }]} testID="issue-4490-your-table-name">
                {optionTitle(pickedLive)}
              </Text>
            ) : null}
            {moneyLines.hold !== null ? (
              <Text style={[styles.body, { color: palette.secondaryText }]}>{moneyLines.hold}</Text>
            ) : null}
            {moneyLines.minSpend !== null ? (
              <Text style={[styles.body, { color: palette.secondaryText }]}>{moneyLines.minSpend}</Text>
            ) : null}
            {big ? (
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                {`${venueName ?? "The venue"} confirms large parties. Nothing to pay until they do.`}
              </Text>
            ) : null}
          </View>
          <Button
            label="Change"
            variant="secondary"
            size="sm"
            accessibilityLabel="Change your table"
            onPress={() => setStep("pick")}
          />
        </View>
      ) : null}
      {barOwned && barStep === "details" ? null : (
      <>
      {/* issue #4420 — the booking reads date, party size, time, then an
          optional occasion (design file → venueDef "Book"). Same state, same
          availability query, same slot guard and analytics; only the
          controls changed (date strip, stepper, time chips). */}
      <Text style={[styles.title, { color: palette.primaryText }]}>
        Find a table
      </Text>
      <OfferingSubLabel palette={palette}>Date</OfferingSubLabel>
      <OfferingDateStrip
        palette={palette}
        accessibilityLabel="Choose a date"
        testID="issue-4420-venue-date-strip"
        onPress={(value: string) => {
          setDate(value);
          setSelectedUtc(null);
        }}
        tiles={dates.map((option, index) => {
          const parts = venueDateTileParts(option.value, index);
          return {
            key: option.value,
            top: parts.top,
            big: parts.big,
            bottom: parts.bottom,
            selected: date === option.value,
            accessibilityLabel: `Select ${option.label}`,
          };
        })}
      />
      <OfferingPanel palette={palette} style={styles.partyPanel}>
        <OfferingPanelRow
          palette={palette}
          title="Party size"
          detail={partyDetail(range)}
          right={
            <OfferingStepper
              palette={palette}
              value={partySize}
              min={1}
              max={range.max}
              onChange={(next: number) => {
                setPartySize(Math.min(range.max, Math.max(1, next)));
                setSelectedUtc(null);
                setBigTimeUtc(null);
              }}
              decrementLabel="Decrease party size"
              incrementLabel="Increase party size"
              valueLabel={`${partySize} ${partySize === 1 ? "person" : "people"}`}
            />
          }
        />
      </OfferingPanel>
      {showSeating && !big ? (
        <>
          <OfferingSubLabel palette={palette}>Where would you like to sit?</OfferingSubLabel>
          <OfferingChipRow accessibilityLabel="Where would you like to sit" testID="issue-4490-seating-areas">
            {[
              { key: "any", label: "Anywhere" },
              ...seatingAreas.map((a) => ({ key: a.spaceId, label: a.name })),
              ...(pickOn ? [{ key: "pick", label: "Pick my table" }] : []),
            ].map((o) => (
              <OfferingChoiceChip
                key={o.key}
                palette={palette}
                label={o.label}
                role="button"
                selected={seat === o.key}
                accessibilityLabel={o.key === "pick" ? "Pick my table on the floor plan" : `Sit ${o.label}`}
                onPress={() => {
                  setSeat(o.key);
                  setPicked(null);
                  if (o.key !== "pick") setSelectedUtc(null);
                }}
              />
            ))}
          </OfferingChipRow>
        </>
      ) : null}
      <OfferingSubLabel palette={palette}>{big ? "Preferred time" : "Time"}</OfferingSubLabel>
      {big ? (
        <View style={[styles.stateCard, { borderColor: palette.panelBorder }]} testID="issue-4490-big-party">
          <Text style={[styles.body, { color: palette.primaryText }]}>
            {`${range.tableMax + 1} or more is a group booking. ${venueName ?? "The venue"} confirms large parties. Nothing to pay until they do.`}
          </Text>
          {slots.length === 0 ? (
            <Text style={[styles.body, { color: palette.secondaryText }]}>
              {availability.isLoading || availability.isFetching ? "Finding times…" : "No times this day. Try another date."}
            </Text>
          ) : (
            <OfferingChipRow accessibilityLabel="Choose a preferred time" testID="issue-4490-big-party-times">
              {slots.map((slot) => (
                <OfferingChoiceChip
                  key={slot.slotStartUtc}
                  palette={palette}
                  label={slot.slotLocalLabel}
                  selected={bigTimeUtc === slot.slotStartUtc}
                  accessibilityLabel={`Prefer ${slot.slotLocalLabel}`}
                  onPress={() => setBigTimeUtc(slot.slotStartUtc)}
                />
              ))}
            </OfferingChipRow>
          )}
        </View>
      ) : null}
      {big ? null : availability.isLoading || availability.isFetching ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.accent} />
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Finding open tables…
          </Text>
        </View>
      ) : availability.isError ? (
        <View style={[styles.stateCard, { borderColor: palette.panelBorder }]}>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            We couldn’t load times.
          </Text>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => {
              void availability.refetch();
            }}
          />
        </View>
      ) : slots.length === 0 ? (
        <View style={[styles.stateCard, { borderColor: palette.panelBorder }]}>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            No tables for this day.
          </Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Try another date.
          </Text>
          {waitlistOffers}
        </View>
      ) : (
        <OfferingChipRow accessibilityLabel="Choose a time" testID="issue-4420-venue-times">
          {slots.map((slot) => (
            <OfferingChoiceChip
              key={slot.slotStartUtc}
              palette={palette}
              label={slot.slotLocalLabel}
              note={slot.isFull ? "Full" : null}
              disabled={slot.isFull}
              // issue #2734 — a full time stays readable, never dimmed.
              readableWhenDisabled
              selected={
                !slot.isFull && selectedSlot?.slotStartUtc === slot.slotStartUtc
              }
              accessibilityLabel={
                slot.isFull
                  ? `${slot.slotLocalLabel}, full`
                  : `Select ${slot.slotLocalLabel}`
              }
              onPress={() => {
                if (
                  !submissionTruthRef.current.selectableSlotUtcValues.includes(
                    slot.slotStartUtc,
                  )
                ) {
                  return;
                }
                setSelectedUtc(slot.slotStartUtc);
                captureWeb("venue_reservation_slot_selected", {
                  surface: analyticsSurface,
                  brand_id: brandId,
                  venue_id: venueId,
                });
              }}
            />
          ))}
        </OfferingChipRow>
      )}
      {!big && slots.length > 0 && slots.some((slot) => slot.isFull) && !slots.every((slot) => slot.isFull) && availabilitySettled && waitlistOffers !== null ? (
        <View style={styles.waitlistNudge} testID="issue-4490-some-full">
          <Text style={[styles.body, { color: palette.secondaryText }]}>The time you want is full?</Text>
          {waitlistOffers}
        </View>
      ) : null}
      {!big && slots.length > 0 && slots.every((slot) => slot.isFull) && availabilitySettled ? (
        <View style={[styles.stateCard, { borderColor: palette.panelBorder }]} testID="issue-4490-sold-out">
          <Text style={[styles.body, { color: palette.primaryText }]}>
            {`Every time is taken for ${partySize} ${partySize === 1 ? "guest" : "guests"} on this day.`}
          </Text>
          {waitlistOffers}
        </View>
      ) : null}
      {seat === "pick" && !big && selectedSlot !== undefined ? (
        <View style={styles.pickBlock} testID="issue-4490-pick-table">
          <OfferingSubLabel palette={palette}>Pick your table</OfferingSubLabel>
          {tablesQuery.data === undefined && (tablesQuery.isLoading || tablesQuery.isFetching) ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.accent} />
              <Text style={[styles.body, { color: palette.secondaryText }]}>Loading the floor…</Text>
            </View>
          ) : tablesQuery.isError ? (
            <View style={[styles.stateCard, { borderColor: palette.panelBorder }]}>
              <Text style={[styles.body, { color: palette.secondaryText }]}>We couldn&apos;t load the tables.</Text>
              <Button label="Try again" variant="secondary" onPress={() => void tablesQuery.refetch()} />
            </View>
          ) : (tablesQuery.data ?? []).length === 0 ? (
            <View style={[styles.stateCard, { borderColor: palette.panelBorder }]}>
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                Picking a table isn&apos;t open for this time. Choose Anywhere and the venue seats you.
              </Text>
              <Button label="Choose Anywhere" variant="secondary" onPress={() => setSeat("any")} />
            </View>
          ) : (
            <>
              <React.Suspense fallback={<ActivityIndicator color={palette.accent} />}>
              <VenueFloorPick
                palette={palette}
                options={tablesQuery.data ?? []}
                spacePlans={plansQuery.data ?? {}}
                selectedKey={pickedLive !== null ? optionKey(pickedLive) : null}
                onSelect={(o) => setPicked(o)}
                money={(m) => formatVenueMoney(m, currency ?? "NGN", 2)}
              />
              </React.Suspense>
              {!(tablesQuery.data ?? []).some((o) => o.status === "free") ? (
                <Text style={[styles.body, { color: palette.secondaryText }]}>
                  Every table that fits is taken at this time. Pick another time, or choose Anywhere.
                </Text>
              ) : null}
              {pickedLive !== null ? (
                <View style={[styles.pickNote, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]} testID="issue-4490-pick-money">
                  <Text style={[styles.yourTableTitle, { color: palette.primaryText }]}>{optionTitle(pickedLive)}</Text>
                  <Text style={[styles.body, { color: palette.secondaryText }]}>
                    {`Seats up to ${pickedLive.capacity}${pickedLive.spaceName !== null ? ` · ${pickedLive.spaceName}` : ""}`}
                  </Text>
                  {moneyLines.minSpend !== null ? <Text style={[styles.body, { color: palette.primaryText }]}>{moneyLines.minSpend}</Text> : null}
                  {moneyLines.holdTotal !== null ? <Text style={[styles.body, { color: palette.primaryText }]}>{`${moneyLines.holdTotal}.`}</Text> : null}
                  {moneyLines.hold !== null ? <Text style={[styles.body, { color: palette.secondaryText }]}>{moneyLines.hold}</Text> : null}
                  {moneyLines.hold === null && moneyLines.minSpend === null ? (
                    <Text style={[styles.body, { color: palette.secondaryText }]}>Your usual booking terms apply. You&apos;ll see the price before you pay.</Text>
                  ) : null}
                </View>
              ) : (
                <Text style={[styles.body, { color: palette.secondaryText }]}>Choose an outlined table, or one from the list.</Text>
              )}
            </>
          )}
        </View>
      ) : null}
      {waitlistMode !== null && date !== null ? (
        <React.Suspense fallback={<ActivityIndicator color={palette.accent} />}>
        <GuestWaitlistForm
          palette={palette}
          venueId={venueId}
          partySize={partySize}
          date={date}
          mode={waitlistMode}
          times={windowChoices(slots.map((slot) => slot.slotLocalLabel))}
          fullTimes={windowChoices(slots.filter((slot) => slot.isFull).map((slot) => slot.slotLocalLabel))}
          currency={currency}
          countryCode={countryCode}
          onCancel={() => setWaitlistMode(null)}
        />
        </React.Suspense>
      ) : null}
      <OfferingSubLabel palette={palette} style={styles.occasionLabel}>
        Occasion · optional
      </OfferingSubLabel>
      <OfferingChipRow accessibilityLabel="Occasion" testID="issue-4420-venue-occasions">
        {VENUE_OCCASIONS.map((label) => (
          <OfferingChoiceChip
            key={label}
            palette={palette}
            label={label}
            role="button"
            selected={occasion.trim() === label}
            onPress={() => setOccasion((current) => (current.trim() === label ? "" : label))}
          />
        ))}
      </OfferingChipRow>
      </>
      )}
      {showDetails && selectedSlot !== undefined && pickReady ? (
        <View style={styles.form}>
          <Text style={[styles.label, { color: palette.tertiaryText }]}>
            NAME · REQUIRED
          </Text>
          <Input
            value={name}
            onChangeText={(next: string) => {
              setName(next);
              setNameServerInvalid(false);
            }}
            onBlur={() => setNameTouched(true)}
            placeholder="Name"
            aria-label="Name, required"
            accessibilityLabel="Name, required"
          />
          {nameTouched && (nameInvalid || nameServerInvalid) ? (
            <Text
              style={styles.fieldError}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {INVALID_NAME_COPY}
            </Text>
          ) : null}
          <Text style={[styles.label, { color: palette.tertiaryText }]}>
            EMAIL · REQUIRED
          </Text>
          <Input
            value={email}
            onChangeText={(next: string) => {
              setEmail(next);
              setEmailServerInvalid(false);
            }}
            onBlur={() => setEmailTouched(true)}
            variant="email"
            placeholder="Email"
            aria-label="Email, required"
            accessibilityLabel="Email, required"
          />
          {emailTouched && (emailInvalid || emailServerInvalid) ? (
            <Text
              style={styles.fieldError}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {INVALID_EMAIL_COPY}
            </Text>
          ) : null}
          {/* #4490 fix 2 (N53): the venue needs a number to reach the table's
              guest (the reservation writer requires one, #1857), so the field
              says so like Name and Email. */}
          <Text style={[styles.label, { color: palette.tertiaryText }]} testID="issue-4490-phone-required-label">
            PHONE · REQUIRED
          </Text>
          <PhoneInput
            // issue #3380 — formats as typed, follows a pasted +code, autofill.
            smartEntry
            required
            value={phoneLocal}
            countryCode={phoneCountry}
            onChangePhone={(next: string) => {
              if (next.length > 0) phoneCountryChosen.current = true;
              setPhoneLocal(next);
            }}
            onChangeCountry={(next: string) => {
              phoneCountryChosen.current = true;
              setPhoneCountry(next);
              setPhoneTouched(true);
            }}
            onBlur={() => setPhoneTouched(true)}
            error={
              phoneTouched && normalizedPhone === null ? phoneErrorCopy : null
            }
            disabled={submitting}
            iconRenderer={(
              name: PhoneInputIconName,
              iconProps: { size: number; color: string },
            ) => {
              const iconName =
                name === "chevronDown"
                  ? "chevD"
                  : name === "checkmark"
                    ? "check"
                    : name === "close"
                      ? "close"
                      : "search";
              return (
                <Icon
                  name={iconName}
                  size={iconProps.size}
                  color={iconProps.color}
                />
              );
            }}
            labels={{
              phonePlaceholder: "Phone number",
              countryButtonAccessibilityLabel: (countryName: string) =>
                `Country code, ${countryName}, tap to change`,
              phoneInputAccessibilityLabel: "Phone number",
              doneButton: "Done",
              pickerTitle: "Select Country",
              pickerSearchPlaceholder: "Search country or dial code",
              pickerCloseAccessibilityLabel: "Close country picker",
            }}
            theme={phoneFieldTheme}
          />
          {phoneTouched && suggestedPhoneCountry?.code !== undefined ? (
            <Pressable
              onPress={() => {
                phoneCountryChosen.current = true;
                setPhoneCountry(suggestedPhoneCountry.code);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Switch the country code to ${suggestedPhoneCountry.name} ${suggestedPhoneCountry.dialCode}`}
              hitSlop={8}
              style={styles.phoneSwitch}
            >
              <Text style={[styles.phoneSwitchText, { color: palette.accent }]}>
                {`Switch to ${suggestedPhoneCountry.flag} ${suggestedPhoneCountry.name} (${suggestedPhoneCountry.dialCode})`}
              </Text>
            </Pressable>
          ) : null}
          <Text
            style={[styles.promise, { color: palette.secondaryText }]}
            testID="venue-checkout-claim-promise"
          >
            {BUYER_CLAIM_COPY.checkoutPromise.booking}
          </Text>
          {/* #4490 N53: the occasion is the chip picked on the step before
              (carried over); no second free-text box here. */}
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes for the venue (optional)"
            accessibilityLabel="Notes for the venue"
          />
          <View style={styles.optIn}>
            <Text style={[styles.body, { color: palette.secondaryText }]}>
              Send me occasional Mingla updates
            </Text>
            <Switch
              value={marketingOptIn}
              onValueChange={setMarketingOptIn}
              accessibilityLabel="Send me occasional Mingla updates"
              testID="issue-4490-marketing-opt-in"
            />
          </View>
          {/* #4490 N118: the price area keeps one height whether it is loading or
              settled, so Confirm never slides away from under the pointer. */}
          <View style={previewEnabled ? styles.priceArea : undefined} testID="issue-4490-price-area">
          {reservationPreview.isLoading || reservationPreview.isFetching ? (
            <View style={[styles.loading, styles.priceAreaLoading, { borderColor: palette.panelBorder }]}>
              <ActivityIndicator color={palette.accent} />
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                Getting your exact price…
              </Text>
            </View>
          ) : reservationPreview.isError ? (
            <View
              style={[styles.stateCard, { borderColor: palette.panelBorder }]}
            >
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                {guestReservationFailureCopy(
                  reservationPreview.error instanceof Error
                    ? reservationPreview.error.message
                    : "",
                ) ?? "We couldn’t get the reservation price."}
              </Text>
              <Button
                label="Try again"
                variant="secondary"
                onPress={() => void reservationPreview.refetch()}
              />
            </View>
          ) : activePreview !== null ? (
            <View
              style={[styles.priceCard, { borderColor: palette.panelBorder }]}
            >
              {activePreview.requiresPayment ? (
                <>
                  <View style={styles.priceRow}>
                    <Text
                      style={[styles.body, { color: palette.secondaryText }]}
                    >
                      {pickedLive !== null && pickedLive.holdMinor !== null && pickedLive.holdMinor > 0 ? "Table hold" : "Deposit"}
                    </Text>
                    <Text
                      style={[
                        styles.priceValue,
                        { color: palette.primaryText },
                        activePreview.discountCents > 0 && styles.listPrice,
                      ]}
                    >
                      {formatMoney(
                        activePreview.depositListCents,
                        activePreview.currency,
                      )}
                    </Text>
                  </View>
                  {activePreview.discounts.map((discount) => (
                    <View key={discount.discountId} style={styles.priceRow}>
                      <Text
                        style={[styles.body, { color: palette.secondaryText }]}
                      >
                        {discount.name}
                      </Text>
                      <Text style={styles.discountValue}>
                        −
                        {formatMoney(
                          discount.amountMinor,
                          activePreview.currency,
                        )}
                      </Text>
                    </View>
                  ))}
                  {activePreview.feesAndTaxCents > 0 ? (
                    <View style={styles.priceRow}>
                      <Text
                        style={[styles.body, { color: palette.secondaryText }]}
                      >
                        Fees and tax
                      </Text>
                      <Text
                        style={[
                          styles.priceValue,
                          { color: palette.primaryText },
                        ]}
                      >
                        {formatMoney(
                          activePreview.feesAndTaxCents,
                          activePreview.currency,
                        )}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.priceRow}>
                    <Text
                      style={[
                        styles.totalLabel,
                        { color: palette.primaryText },
                      ]}
                    >
                      Total
                    </Text>
                    <Text
                      style={[
                        styles.totalLabel,
                        { color: palette.primaryText },
                      ]}
                    >
                      {formatMoney(
                        activePreview.totalCents,
                        activePreview.currency,
                      )}
                    </Text>
                  </View>
                  <View style={styles.codeRow}>
                    <Input
                      value={discountDraft}
                      onChangeText={(next: string) =>
                        setDiscountDraft(next.toUpperCase())
                      }
                      placeholder="Discount code"
                      accessibilityLabel="Discount code"
                    />
                    <Button
                      label="Apply"
                      variant="secondary"
                      disabled={discountDraft.trim().length === 0}
                      onPress={() =>
                        setDiscountCode(
                          discountDraft.replace(/[\s-]+/g, "").toUpperCase(),
                        )
                      }
                    />
                  </View>
                  {discountCode !== null &&
                  activePreview.codeOutcome.status === "rejected" &&
                  activePreview.codeOutcome.reason !== null ? (
                    <React.Suspense fallback={null}>
                      <DiscountReasonText
                        style={styles.fieldError}
                        input={{
                          reason: activePreview.codeOutcome.reason,
                          code: discountCode,
                          required:
                            activePreview.codeOutcome.required === null
                              ? null
                              : formatMoney(
                                  activePreview.codeOutcome.required,
                                  activePreview.currency,
                                ),
                          withName: activePreview.codeOutcome.with,
                        }}
                      />
                    </React.Suspense>
                  ) : null}
                  {discountCode !== null &&
                  activePreview.codeOutcome.status === "applied" ? (
                    <Button
                      label={`Remove ${discountCode}`}
                      variant="secondary"
                      onPress={() => {
                        setDiscountCode(null);
                        setDiscountDraft("");
                      }}
                    />
                  ) : null}
                </>
              ) : (
                <Text style={[styles.body, { color: palette.secondaryText }]}>
                  No deposit is required. Discount codes aren’t needed for this
                  reservation.
                </Text>
              )}
            </View>
          ) : null}
          </View>
          {error !== null ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          {barOwned ? null : (
          <Button
            label={
              big
                ? "Send request"
                : activePreview?.requiresPayment
                ? reviewQuote === null
                  ? previewTotalLabel !== null
                    ? `Confirm · ${previewTotalLabel}`
                    : "Confirm reservation"
                  : "Confirm updated total"
                : "Confirm reservation"
            }
            // ORCH-1162 Bug 3 — the primary fill takes the venue's accent, and
            // Button's own WCAG helpers pick the readable label colour for it.
            accentColor={palette.accent}
            accentGradient={accentIcon(palette).gradient ?? null}
            size="lg"
            fullWidth
            loading={submitting}
            disabled={submitting || contactInvalid || !availabilitySettled}
            onPress={() => void submit()}
          />
          )}
        </View>
      ) : null}
    </View>
  );
}

const PRICE_AREA_MIN_HEIGHT = 96;

const styles = StyleSheet.create({
  partyPanel: { marginTop: 18, marginBottom: 18 },
  occasionLabel: { marginTop: 18 },
  yourTable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 20,
  },
  yourTableCopy: { flex: 1, minWidth: 0, gap: 2 },
  yourTableTitle: { fontSize: 16, fontWeight: "700" },
  host: { gap: space[2] },
  title: { ...type.h1 },
  body: { ...type.small },
  manageRow: { gap: space[2], marginTop: space[2] },
  manageButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: 1,
  },
  manageLabel: { ...type.small, fontWeight: "600" },
  label: {
    ...type.caption,
    letterSpacing: 1.2,
    marginTop: space[2],
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: space[4] },
  party: {
    ...type.h1,
    minWidth: 36,
    textAlign: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  // issue #1564 — geometry only. Every colour on the chips now arrives from the
  // page's resolved palette (`chipTheme` above); the two orange literals that
  // used to live here are gone, and nothing in this StyleSheet may name a
  // brand colour again.
  chip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[4],
  },
  chipText: { ...type.small },
  loading: { flexDirection: "row", alignItems: "center", gap: space[2] },
  // #4490 N118 — as tall as the settled "No deposit" card, so nothing shifts.
  priceArea: { minHeight: PRICE_AREA_MIN_HEIGHT },
  priceAreaLoading: {
    minHeight: PRICE_AREA_MIN_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space[4],
  },
  stateCard: {
    gap: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space[4],
  },
  form: { gap: space[2], marginTop: space[4] },
  pickBlock: { gap: space[3], marginTop: space[4] },
  pickNote: { gap: space[1], padding: space[4], borderRadius: radius.md, borderWidth: 1 },
  waitlistNudge: { gap: space[1], marginTop: space[2] },
  waitlistButtons: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] },
  fieldError: { ...type.small, color: color.danger },
  phoneSwitch: { alignSelf: "flex-start", paddingVertical: space[1] },
  phoneSwitchText: { ...type.small, fontWeight: "600" },
  promise: { ...type.small, marginTop: space[1] },
  optIn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  error: { ...type.small, color: color.danger },
  priceCard: {
    gap: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space[4],
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  priceValue: { ...type.small, fontWeight: "600" },
  listPrice: { textDecorationLine: "line-through" },
  discountValue: { ...type.small, color: color.onPaper.success, fontWeight: "600" },
  totalLabel: { ...type.body, fontWeight: "700" },
  codeRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
});
