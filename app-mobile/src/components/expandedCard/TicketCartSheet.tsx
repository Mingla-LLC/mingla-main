/**
 * TicketCartSheet — consumer-app multi-tier ticket cart, mirroring the public
 * business buyer cart (J-C1 / `mingla-business/app/checkout/[eventId]/index.tsx`)
 * within 8pt visual tolerance.
 *
 * Per ORCH-0847 [Consumer ticket purchase parity with public business page]:
 *   - SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0847_CONSUMER_TICKET_PURCHASE_PARITY.md` §4.1
 *   - Design verdict: `Mingla_Artifacts/specs/DESIGN_ORCH-0847_PHASE_C_TICKET_CART_SHEET.md`
 *
 * Replaces the prior `TicketClaimConfirmModal` single-ticket confirmation.
 *
 * Layout (top → bottom, per design §3):
 *   1. Header: "Get tickets" title + close (×)
 *   2. Section label: "SELECT YOUR TICKETS"
 *   3. Tier rows (one per visible+available ticket, sorted by displayOrder),
 *      rendered via `<QuantityRow>` from `@mingla/offering-rendering` with a
 *      dark-mode theme override + `ConsumerCartCard` host wrapper.
 *   4. Required purchase-terms checkbox; account marketing stays outside checkout.
 *   5. Booking contact recap (profile/auth seed, booking-local Change editor).
 *   6. Sticky bottom bar: Subtotal label + value, primary CTA.
 *
 * 7 states handled (per design §5): loading, empty, sold_out, sales_closed,
 * populated_empty_cart, populated_cart, submitting.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

// ORCH-1016 REWORK-4 (FIX A) — import the gorhom scroll host re-export so this
// sheet scrolls via the SAME proven ROOT-CAUSE wiring as
// ExpandedBusinessEventSheet / ConsumerTripDetailScreen: a BARE scrollMode="scroll"
// so BaseBottomSheet's own gorhom BottomSheetScrollView is the DIRECT child of
// BottomSheetContent, with {header}{body}{stickyFooter} as scroll children. Any
// wrapper prop (header/stickyFooter/bodyContainerStyle) nests the scroll one
// BottomSheetView level deeper → viewport==content → frozen (RW3.1).
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
// ORCH-1016 REWORK-4 (FIX A) — single source of truth for the floating
// GlassBottomNav footprint. The sticky CTA bar carries this clearance so the
// buy/Continue button always sits ABOVE Mingla's bottom nav (the on-device bug:
// the CTA was blocked by the nav because the footer only padded insets.bottom).
import { BOTTOM_NAV_CONTENT_HEIGHT } from "../../hooks/useAppLayout";

import {
  type PublicTicketProps,
  QuantityRow,
  type QuantityRowTheme,
  type TripTierLike,
} from "@mingla/offering-rendering";
import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import { discountReasonCopy } from "@mingla/offering-rendering/discountReasonCopy";
import { saleLimitedCopy } from "@mingla/offering-rendering/saleLimitedCopy";
import {
  checkoutReviewReasonCopy,
  ticketQuoteFeesAndTaxCents,
} from "@mingla/offering-rendering/ticketQuoteCopy";
// #3372 — naira reads "₦", not "NGN", in the cart (the shared #3341 rule).
// Deep specifier, not the barrel, so suites that mock the barrel stay untouched.
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
import { installmentReassuranceText } from "@mingla/offering-rendering/installmentReassurance";

// issue #2265 — TYPE ONLY. A value import here would pull the Stripe native SDK
// into the cart sheet's module graph; `import type` is erased at compile time.
import type {
  NativeCheckoutOutcome,
  NativeCheckoutPhase,
} from "../../payments/nativeCheckoutFlow";
import {
  PURCHASE_TERMS_DISCLOSURE_TEXT,
  PURCHASE_TERMS_DISCLOSURE_VERSION,
  PURCHASE_TERMS_LABEL_JOINER,
  PURCHASE_TERMS_LABEL_PREFIX,
  PURCHASE_TERMS_LABEL_PRIVACY,
  PURCHASE_TERMS_LABEL_SUFFIX,
  PURCHASE_TERMS_LABEL_TERMS,
} from "../../constants/consentDisclosure";
import { LEGAL_URLS } from "../../constants/urls";
import { recordConsent } from "../../services/consentService";
import { Icon } from "../ui/Icon";
// ORCH-1025 [Seamless native consumer cart] — the buyer billing-address +
// "Calculate tax" gate (CartTaxPreview) is RETIRED. Tax is computed server-side
// from the venue (ORCH-1006, ticket-checkout-create v130), and the all-in price
// is already available per tier client-side (PublicTicketProps.priceAllInGbp,
// from pg_public_event_tier_allin). The cart now shows the all-in total upfront
// and goes straight to the native PaymentSheet — no address typed.
import { ConsumerCartCard } from "./ConsumerCartCard";
import { EventDayChooser, type EventDayChooserStatus } from "./EventDayChooser";
import type { PublicEventOccurrenceLike } from "../../hooks/usePublicEventBySlug";
import { type CartLineSeed, useTicketCart } from "../../hooks/useTicketCart";
import { useTicketQuote } from "../../hooks/useTicketQuote";
import { formatOccurrenceLine } from "../../utils/eventDateDisplay";
import {
  type ByDateMap,
  byDateForDates,
  byDateTotal,
  cartLineQuantities,
  dayLimitedQuantities,
  ticketCoversAnyDate,
  evenByDate,
  uniformQuantity,
  withDateQuantity,
} from "./ticketCartByDate";
import { postHogService } from "../../services/postHogService";
import { PhoneInput } from "../onboarding/PhoneInput";
import {
  COUNTRIES,
  getCountryByCode,
  type PhoneInputTheme,
} from "@mingla/phone-input";
import { resolveUserPhoneE164 } from "@mingla/card-identity/phone.mjs";
import {
  EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY,
  explorerCheckoutContactSeedDecision,
  explorerCheckoutContactFieldsForEditor,
  validateExplorerCheckoutContact,
  type ExplorerCheckoutContactField,
  type ExplorerCheckoutContactSeedAuthority,
  type ExplorerCheckoutContactSnapshot,
} from "../../payments/explorerCheckoutContact.mjs";
import { ConsumerIntakeForm } from "./ConsumerIntakeForm";
import {
  buildIntakeFormData,
  createIntakeUploadSessionId,
  revokeTripIntakeFileClaim,
  type IntakeAnswerValue,
  type IntakeFormData,
  type IntakeSchema,
  uploadTripIntakeFile,
  validateAnswerAgainstSchema,
} from "../../services/tripIntakeSchemaService";

// ORCH-1138 [content-sized cart] — the cart sheet now SIZES TO ITS CONTENT via
// gorhom's dynamic sizing (`enableDynamicSizing` + `maxDynamicContentSize` set on
// the BaseBottomSheet below), so a short single-ticket cart is a SHORT sheet
// (CTA anchored at the content bottom, no tall empty gap) and a long multi-tier /
// intake cart grows up to the 92% cap and then scrolls. This `["92%"]` value is
// retained as the MAX detent (the upper bound the dynamic snap is clamped to via
// `MAX_DYNAMIC_FRACTION`), NOT a fixed open height.
//
// PRIOR (ORCH-0847 Phase C, operator 2026-05-15): a FIXED `["92%"]` snap. Because
// the whole cart (header + body + CTA) renders as ONE BottomSheetScrollView
// content block (scrollMode="scroll", no header/stickyFooter props), the fixed
// 92% viewport left a large empty bottom gap whenever the content was shorter
// than 92% of the screen (Seth, consumer device 2026-06-15). Dynamic sizing
// removes that gap while preserving the ORCH-1016/1043 scroll-to-Pay behavior for
// tall carts (the CTA stays a scroll child; on a tall cart it is reached by
// scrolling, exactly as before).
const SHEET_SNAP_POINTS = ["92%"];
// The dynamic content snap is clamped to this fraction of the window height so a
// tall cart caps at the same ~92% ceiling instead of growing to full screen.
const MAX_DYNAMIC_FRACTION = 0.92;

/**
 * Dark-mode theme tokens for the consumer cart sheet's QuantityRow. Mirrors
 * the design verdict §4 (white-alpha on the `#15181f` sheet canvas).
 */
const CONSUMER_TICKET_CART_THEME: QuantityRowTheme = {
  accent: "#eb7825",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textSecondary: "rgba(255, 255, 255, 0.72)",
  textTertiary: "rgba(255, 255, 255, 0.52)",
  textQuaternary: "rgba(255, 255, 255, 0.32)",
  stepperBg: "rgba(255, 255, 255, 0.06)",
  stepperBorder: "rgba(255, 255, 255, 0.12)",
  semanticWarning: "#f59e0b",
  semanticError: "#ef4444",
  saleBannerBg: "rgba(245, 158, 11, 0.12)",
  saleBannerBorder: "rgba(245, 158, 11, 0.32)",
  soldOutBg: "rgba(239, 68, 68, 0.16)",
  soldOutBorder: "rgba(239, 68, 68, 0.32)",
};

const CHECKOUT_CONTACT_PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: "#15181f",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textTertiary: "rgba(255, 255, 255, 0.52)",
  borderDefault: "rgba(255, 255, 255, 0.14)",
  borderFocused: "#eb7825",
  borderError: "#ef4444",
  searchBackground: "rgba(255, 255, 255, 0.06)",
  rowPressedBackground: "rgba(255, 255, 255, 0.04)",
  divider: "rgba(255, 255, 255, 0.08)",
  accessoryBackground: "rgba(21, 24, 31, 0.95)",
  accessoryBorder: "rgba(255, 255, 255, 0.08)",
  accent: "#eb7825",
  errorText: "#ef4444",
};

const resolveContactPhoneCountry = (
  phone: string,
  countryHint: string | null | undefined,
): string => {
  const normalizedHint = countryHint?.trim().toUpperCase() ?? "";
  const hintedCountry = getCountryByCode(normalizedHint);
  if (hintedCountry !== undefined && phone.startsWith(hintedCountry.dialCode)) {
    return hintedCountry.code;
  }
  const matchedCountry = [...COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((country) => phone.startsWith(country.dialCode));
  if (matchedCountry !== undefined) return matchedCountry.code;
  if (hintedCountry !== undefined) return hintedCountry.code;
  return "US";
};

const splitContactPhone = (phone: string, countryCode: string): string => {
  const dialCode = getCountryByCode(countryCode)?.dialCode;
  return dialCode !== undefined && phone.startsWith(dialCode)
    ? phone.slice(dialCode.length)
    : "";
};

/**
 * Format a major-unit value (e.g., 12.5 for £12.50) into a currency string.
 * Used by QuantityRow's `formatCurrency` prop.
 */
const formatMajorCurrency = (value: number, currency: string): string => {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(value),
      currency,
    );
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

/**
 * Format a cents value into a currency string. Used for the sticky bar
 * subtotal display.
 */
const formatCentsCurrency = (cents: number, currency: string): string => {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(cents / 100),
      currency,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

const formatInstallmentDueDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
};

const isTicketSalesEnded = (ticket: PublicTicketProps): boolean => {
  if (ticket.saleEndAt === null) return false;
  const end = new Date(ticket.saleEndAt).getTime();
  return Number.isFinite(end) && end <= Date.now();
};

/**
 * A ticket is "available for purchase" on the consumer cart if:
 *   - visibility is not "hidden" (door-only / direct-link tiers stay hidden)
 *   - availableAt !== "door" (online checkout only)
 *
 * Mirrors public J-C1 filter at `mingla-business/app/checkout/[eventId]/index.tsx:56-57`.
 */
const isVisibleForConsumer = (ticket: PublicTicketProps): boolean =>
  ticket.visibility !== "hidden" && ticket.availableAt !== "door";

export interface TicketCartCheckoutPayload {
  lines: Array<{
    ticketTypeId: string;
    quantity: number;
    paymentPlanChoice: "full" | "installments";
    byDate?: Record<string, number>;
  }>;
  marketingOptIn: boolean;
  /** Explicit purchase-terms act carried independently of marketing consent. */
  purchaseTermsAccepted: boolean;
  /** Booking-local contact snapshot; editing never writes the account profile. */
  buyer: ExplorerCheckoutContactSnapshot;
  /**
   * ORCH-1025 — the displayed all-in total (sum of per-tier server `all_in_cents`
   * × qty, in cents). Carried for the paid/free checkout branch + telemetry ONLY;
   * the authoritative charge is the PaymentIntent amount the backend computes
   * from the same `compute_all_in_cents` engine (WYSIWYP parity by construction).
   * The cart no longer sends `address` or `taxCalculationId` — tax is sourced at
   * the venue server-side, so the buyer never types an address.
   */
  totalCents: number;
  /** #3872 — exact server quote accepted by the buyer. */
  discountCode: string | null;
  quoteDigest: string;
  quoteListDigest: string;
  /**
   * ORCH-1016 REWORK (D2) — per-tier trip intake answers for selected tiers
   * that carry an intake schema. Empty array when no selected tier has a
   * schema (the common case) so non-intake checkouts add nothing to the body.
   */
  intakeFormData: IntakeFormData[];
  /** Private upload draft bound server-side to accepted file claims. */
  intakeUploadSessionId?: string;
  /** #2230: omitted for every single-date/trip/experience checkout. */
  eventDateIds?: string[];
}

export interface TicketCartMultiDaySelection {
  status: EventDayChooserStatus;
  occurrences: readonly PublicEventOccurrenceLike[];
  selectedEventDateIds: readonly string[];
  pricingMode: "per_day" | "all_days";
  allDaysPass?: boolean;
  timezone: string;
  onToggle: (eventDateId: string) => void;
  onRetry: () => void;
}

export interface TicketCartSheetProps {
  visible: boolean;
  eventId: string;
  /** From `usePublicEventTickets(eventId)`. `undefined` = loading. */
  tickets: ReadonlyArray<PublicTicketProps> | undefined;
  /**
   * ORCH-1016 REWORK (D2) — per-tier trip intake schemas keyed by
   * ticket_type_id (from `useTripIntakeSchemas(eventId)`). Empty/undefined when
   * the trip requires no intake (the common case) → no intake step renders.
   */
  intakeSchemasByTier?: Map<string, IntakeSchema>;
  /** Event currency fallback (used until a line is added). */
  fallbackCurrency: string;
  /** Seed the cart with this tier at quantity 1 on open. */
  initialTicketTypeId: string | null;
  /**
   * ORCH-1138 rework (§4.C.6) — seed the cart line at this quantity on open
   * (the open-daily PARTY SIZE → cart quantity; I-1, never a new line item).
   * Defaults to 1 → byte-identical to every existing caller (events/trips).
   */
  initialQuantity?: number;
  /**
   * ORCH-1167 [event-page-canonical] — seed MULTIPLE tiers at once on open from
   * the inline ticket box on the canonical event page ({ ticketTypeId: qty }).
   * When present (non-empty) it TAKES PRECEDENCE over `initialTicketTypeId`/
   * `initialQuantity`: every listed tier is seeded (each capped by its capacity)
   * so the cart lands PRE-POPULATED + editable (parity with the buyer-web cart
   * step). Absent/empty → byte-identical single-tier seed (every existing caller).
   */
  initialQuantities?: Record<string, number>;
  /** Auth-derived pre-fill (read-only display). */
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  /** Profile country used only to seed the booking phone picker. */
  buyerCountryCode?: string | null;
  /** #3682 — brand name for Follow disclosure; omitted → "this brand". */
  brandName?: string | null;
  /** #3682 — signed-in account id when auto-follow can run; null for guests. */
  buyerUserId?: string | null;
  /** True while the upstream `runNativeCheckout` is in flight. */
  isSubmitting: boolean;
  /**
   * issue #2265 — what the in-flight checkout is doing right now, so the CTA can
   * NAME it instead of showing a bare spinner. Non-null only while `isSubmitting`.
   *
   * This sheet is the surface the buyer committed on, and it now stays mounted
   * for the whole checkout (the three consumer screens used to call
   * `setCartVisible(false)` one line BEFORE the work started, so every pending
   * treatment below — the spinner, the disabled controls, the refused close —
   * had never rendered a frame in production).
   *
   * Invariant: I-PROPOSED-CHECKOUT-PENDING-SURFACE-SURVIVES.
   */
  pendingPhase?: NativeCheckoutPhase | null;
  /** Server-confirmed v2 terminal/recovery state. */
  terminalOutcome?: NativeCheckoutOutcome | null;
  /** Optional post-confirmation action owned by the calling listing surface. */
  successFooter?: React.ReactNode;
  /**
   * True when this cart is rendered inline below Mingla's floating nav. When the
   * parent group is already hosted in an overlay carrier, the nav is behind the
   * modal window and the CTA only needs OS safe-area clearance.
   */
  clearFloatingNav?: boolean;
  /**
   * ORCH-1182 — the plan tiers (keyed by ticketTypeId) the buyer is paying for
   * OVER TIME, carrying the per-tier all-in + installment schedule. The cart sums
   * the qty-scaled deposit (tripTierDepositTodayCents) over its OWN live cart
   * quantities → the sticky-bar "Due today" tracks the cart (qty 2 of a €500 /
   * 25% tier = €250, not the stale €125 unit deposit). When present (a pay-over-
   * time plan cart) the sticky bar shows BOTH a "Total" line (the qty-scaled all-
   * in) AND a "Due today" line. Absent / empty (events / no-plan / pay-in-full) →
   * the existing single all-in line, byte-identical. The trip detail screen builds
   * this from the SAME tiers it already derives the per-tile note from.
   *
   * Supersedes the prior ORCH-1130 `dueTodayCents` scalar (which carried the
   * qty-1 unit deposit → the ORCH-1182 display bug). The cart owns the qty scaling
   * here so it can never diverge from the cart's own line state.
   */
  planTiersByTicketId?: Record<string, TripTierLike>;
  /**
   * ORCH-1181 — per-package installment sub-line copy keyed by ticketTypeId
   * (ready-formatted, e.g. "From $125.00 today · pay over time"). The trip detail
   * screen computes these from the SAME projected per-tier deposit it already
   * derives, ONLY for plan packages when pay-over-time is the active cart choice.
   * Absent / empty → no tile carries a note (events / no-plan / pay-in-full),
   * byte-identical to today. The cart sheet never computes the deposit itself.
   */
  installmentNoteByTicketId?: Record<string, string>;
  /**
   * #2230 — interactive multi-day decision inside this purchase container.
   * null/omitted preserves the existing single-date tree and payload exactly.
   */
  multiDaySelection?: TicketCartMultiDaySelection | null;
  /**
   * issue #3314 — true ⇒ no "N left" caption on any tier (the organiser's
   * "Hide remaining count"). Omitted ⇒ unchanged for trip/experience carts.
   */
  hideRemainingCount?: boolean;
  /** Money-affecting reservation choices included in the authoritative quote. */
  quoteEventDateId?: string | null;
  quoteBookedStartAt?: string | null;
  quoteBookedEndAt?: string | null;
  quotePartySize?: number | null;
  onCancel: () => void;
  /** Available only after server truth says a new attempt is safe. */
  onTerminalRetry?: () => void;
  onCheckout: (payload: TicketCartCheckoutPayload) => void;
}

export const TicketCartSheet: React.FC<TicketCartSheetProps> = ({
  visible,
  eventId,
  tickets,
  fallbackCurrency,
  initialTicketTypeId,
  initialQuantity = 1,
  initialQuantities,
  intakeSchemasByTier,
  buyerName,
  buyerEmail,
  buyerPhone,
  buyerCountryCode = null,
  buyerUserId = null,
  isSubmitting,
  pendingPhase = null,
  terminalOutcome = null,
  successFooter = null,
  clearFloatingNav = true,
  planTiersByTicketId,
  installmentNoteByTicketId,
  multiDaySelection = null,
  hideRemainingCount = false,
  quoteEventDateId = null,
  quoteBookedStartAt = null,
  quoteBookedEndAt = null,
  quotePartySize = null,
  onCancel,
  onTerminalRetry,
  onCheckout,
}) => {
  const { t } = useTranslation("discounts");
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // ORCH-1138 — clamp the dynamic content snap to ~92% of the window so a tall
  // cart caps at the prior ceiling (then scrolls) while a short cart sizes to its
  // own content height.
  const maxDynamicContentSize = useMemo(
    () => Math.round(windowHeight * MAX_DYNAMIC_FRACTION),
    [windowHeight],
  );
  const { lines, totals, setLineQuantity, reset } =
    useTicketCart(fallbackCurrency);
  const [sameTicketsForEveryDate, setSameTicketsForEveryDate] =
    useState<boolean>(true);
  const [byDateByTicket, setByDateByTicket] = useState<
    Record<string, ByDateMap>
  >({});
  // #3859 — purchase acceptance is a required checkout act. Explorer's
  // account-level marketing remains on separately and has no cart control.
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [consentHintVisible, setConsentHintVisible] = useState<boolean>(false);
  const signedInBuyer =
    typeof buyerUserId === "string" && buyerUserId.length > 0;
  // #3859 P1 — Explorer checkout is authenticated. A missing id means auth is
  // unresolved or expired, never that native should expose buyer-web's
  // anonymous identity form.
  const sessionRequired = visible && !signedInBuyer && terminalOutcome === null;
  // ORCH-1025 — "What's included" breakdown panel expand/collapse.
  const [breakdownOpen, setBreakdownOpen] = useState<boolean>(false);
  const [discountCode, setDiscountCode] = useState("");
  const [dismissedSaleNotices, setDismissedSaleNotices] = useState<string[]>(
    [],
  );
  const [highlightUnchosen, setHighlightUnchosen] = useState<boolean>(false);
  // ORCH-1016 REWORK (D2) — per-tier intake answers + per-tier per-question
  // validation errors. Keyed by ticket_type_id → { [questionId]: value/error }.
  const [intakeAnswers, setIntakeAnswers] = useState<
    Record<string, Record<string, IntakeAnswerValue>>
  >({});
  const [intakeErrors, setIntakeErrors] = useState<
    Record<string, Record<string, string>>
  >({});
  const intakeUploadSessionRef = React.useRef<string>(
    createIntakeUploadSessionId(),
  );
  const lastOpenSeedRef = React.useRef<string | null>(null);
  const contactSeedAuthorityRef =
    React.useRef<ExplorerCheckoutContactSeedAuthority>(
      EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.awaitingAccount,
    );
  const initialContactValidation = useMemo(
    () =>
      validateExplorerCheckoutContact({
        name: buyerName,
        email: buyerEmail,
        phone: buyerPhone,
      }),
    [buyerEmail, buyerName, buyerPhone],
  );
  const [contactSnapshot, setContactSnapshot] =
    useState<ExplorerCheckoutContactSnapshot>(
      initialContactValidation.normalized,
    );
  const [contactDraft, setContactDraft] =
    useState<ExplorerCheckoutContactSnapshot>(
      initialContactValidation.normalized,
    );
  const [contactEditorVisible, setContactEditorVisible] = useState<boolean>(
    !initialContactValidation.isValid,
  );
  const [contactEditAll, setContactEditAll] = useState<boolean>(false);
  const [contactFieldsToEdit, setContactFieldsToEdit] = useState<
    ExplorerCheckoutContactField[]
  >(explorerCheckoutContactFieldsForEditor(initialContactValidation, false));
  const [contactTouched, setContactTouched] = useState<
    Partial<Record<ExplorerCheckoutContactField, boolean>>
  >({});
  const initialPhoneCountry = resolveContactPhoneCountry(
    initialContactValidation.normalized.phone,
    buyerCountryCode,
  );
  const [contactPhoneCountry, setContactPhoneCountry] =
    useState<string>(initialPhoneCountry);
  const [contactPhoneLocal, setContactPhoneLocal] = useState<string>(() =>
    splitContactPhone(
      initialContactValidation.normalized.phone,
      initialPhoneCountry,
    ),
  );
  const contactValidation = useMemo(
    () => validateExplorerCheckoutContact(contactSnapshot),
    [contactSnapshot],
  );
  const contactDraftValidation = useMemo(
    () => validateExplorerCheckoutContact(contactDraft),
    [contactDraft],
  );

  // Tiers in the cart (qty > 0) that carry an intake schema.
  const selectedSchemaTiers = useMemo<
    Array<{ tierId: string; tierName: string; schema: IntakeSchema }>
  >(() => {
    if (intakeSchemasByTier === undefined || intakeSchemasByTier.size === 0) {
      return [];
    }
    return lines
      .filter((l) => l.quantity > 0)
      .map((l) => {
        const schema = intakeSchemasByTier.get(l.ticketTypeId);
        if (schema === undefined) return null;
        return {
          tierId: l.ticketTypeId,
          tierName: l.ticketName,
          schema,
        };
      })
      .filter(
        (t): t is { tierId: string; tierName: string; schema: IntakeSchema } =>
          t !== null,
      );
  }, [lines, intakeSchemasByTier]);

  const quoteEventDateIds = useMemo(
    () =>
      multiDaySelection === null
        ? []
        : multiDaySelection.occurrences
            .filter((day) =>
              multiDaySelection.selectedEventDateIds.includes(day.id),
            )
            .map((day) => day.id),
    [multiDaySelection],
  );
  // issue #3281 decision 7 — only a per-day cart with 2+ chosen dates can split.
  const canSplitByDate =
    multiDaySelection !== null &&
    multiDaySelection.allDaysPass !== true &&
    multiDaySelection.pricingMode !== "all_days" &&
    quoteEventDateIds.length >= 2;
  const perDateActive = canSplitByDate && !sameTicketsForEveryDate;
  const perDateIds = perDateActive ? quoteEventDateIds : null;
  const quoteLines = useMemo(
    () =>
      lines
        .filter((line) => line.quantity > 0)
        .map((line) => ({
          ticketTypeId: line.ticketTypeId,
          ...(perDateIds !== null
            ? cartLineQuantities(
                line,
                byDateByTicket[line.ticketTypeId],
                perDateIds,
              )
            : dayLimitedQuantities(
                tickets?.find((t) => t.id === line.ticketTypeId)
                  ?.validOccurrenceIds,
                line.quantity,
                quoteEventDateIds,
                multiDaySelection?.pricingMode !== "all_days" &&
                  multiDaySelection?.allDaysPass !== true,
              )),
          paymentPlanChoice:
            planTiersByTicketId?.[line.ticketTypeId] !== undefined
              ? ("installments" as const)
              : ("full" as const),
        }))
        .filter((line) => line.quantity > 0),
    [
      byDateByTicket,
      lines,
      multiDaySelection?.allDaysPass,
      multiDaySelection?.pricingMode,
      perDateIds,
      planTiersByTicketId,
      quoteEventDateIds,
      tickets,
    ],
  );
  const quoteInput = useMemo(
    () => ({
      eventId,
      // A quote prices the cart; it does not record account-level marketing
      // state. The checkout submission below remains the single owner of that
      // already-established Explorer account setting.
      buyer: contactValidation.normalized,
      lines: quoteLines,
      eventDateId: quoteEventDateId,
      eventDateIds: quoteEventDateIds,
      bookedStartAt: quoteBookedStartAt,
      bookedEndAt: quoteBookedEndAt,
      partySize: quotePartySize,
      discountCode: discountCode.trim().length > 0 ? discountCode.trim() : null,
    }),
    [
      contactValidation.normalized,
      discountCode,
      eventId,
      quoteBookedEndAt,
      quoteBookedStartAt,
      quoteEventDateId,
      quoteEventDateIds,
      quoteLines,
      quotePartySize,
    ],
  );
  const { query: quoteQuery, isDebouncing: quoteIsDebouncing } =
    useTicketQuote(quoteInput);
  const quote = quoteQuery.data ?? null;
  const quoteIsLoading =
    quoteLines.length > 0 && (quoteIsDebouncing || quoteQuery.isFetching);
  const quoteIsReady = quote !== null && !quoteIsLoading && !quoteQuery.isError;
  const isFreeQuote = quoteIsReady && quote.buyerTotalCents === 0;
  // #4174 — "Due today" is a pay-over-time line only. The server marks a plan
  // quote with a non-null `installmentSchedule` (Stripe and Paystack) and, on
  // Paystack, also the locked `installmentChargeSchedule`. `dueTodayNetCents`
  // is the PRE-FEE base, so comparing it with the all-in `buyerTotalCents`
  // flagged every fee-bearing no-plan cart ("Total $10.45 / Due today $10.00").
  const quoteIsPaymentPlan =
    quote !== null &&
    (quote.installmentChargeSchedule !== undefined ||
      (quote.installmentSchedule !== null &&
        typeof quote.installmentSchedule === "object" &&
        !Array.isArray(quote.installmentSchedule)));
  const showsDueToday = quoteIsReady && quoteIsPaymentPlan;

  // META-ORCH-0991 Wave A — open/close is owned by BaseBottomSheet
  // (declarative `visible`). The prior sheetRef + snapToIndex/close effect is
  // removed; the primitive replicates that exact open/close pattern internally.

  // Seed the tapped tier(s) on open; reset cart + opt-in on close.
  // ORCH-1167 — when `initialQuantities` (the inline-box multi-tier selection) is
  // present it TAKES PRECEDENCE: every listed tier is seeded (capped by capacity).
  // Else the byte-identical single-tier seed runs (every existing caller).
  const multiSeed = useMemo<Record<string, number>>(
    () =>
      initialQuantities !== undefined &&
      Object.keys(initialQuantities).length > 0
        ? initialQuantities
        : {},
    [initialQuantities],
  );
  const multiSeedKey = useMemo<string>(
    () =>
      Object.entries(multiSeed)
        .filter(([, q]) => q > 0)
        .map(([id, q]) => `${id}:${q}`)
        .sort()
        .join(","),
    [multiSeed],
  );

  useEffect(() => {
    if (!signedInBuyer) {
      contactSeedAuthorityRef.current =
        EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.awaitingAccount;
      setContactEditorVisible(false);
      setContactEditAll(false);
      setContactTouched({});
      return;
    }
    const validation = validateExplorerCheckoutContact({
      name: buyerName,
      email: buyerEmail,
      phone: buyerPhone,
    });
    const seedDecision = explorerCheckoutContactSeedDecision(
      contactSeedAuthorityRef.current,
      visible,
      validation.isValid,
    );
    contactSeedAuthorityRef.current = seedDecision.nextAuthority;
    if (!seedDecision.shouldApply) return;

    const phoneCountry = resolveContactPhoneCountry(
      validation.normalized.phone,
      buyerCountryCode,
    );
    setContactSnapshot(validation.normalized);
    setContactDraft(validation.normalized);
    setContactEditorVisible(!validation.isValid);
    setContactEditAll(false);
    setContactFieldsToEdit(
      explorerCheckoutContactFieldsForEditor(validation, false),
    );
    // Account/profile hydration is not a buyer validation attempt. Missing
    // fields render for completion, but stay neutral until blur, Save, or the
    // checkout CTA makes validation actionable.
    setContactTouched({});
    setContactPhoneCountry(phoneCountry);
    setContactPhoneLocal(
      splitContactPhone(validation.normalized.phone, phoneCountry),
    );
  }, [
    buyerCountryCode,
    buyerEmail,
    buyerName,
    buyerPhone,
    signedInBuyer,
    visible,
  ]);

  useEffect(() => {
    if (visible && tickets) {
      const useMulti = multiSeedKey.length > 0;
      const thisKey = useMulti ? multiSeedKey : initialTicketTypeId;
      if (thisKey !== null && lastOpenSeedRef.current !== thisKey) {
        lastOpenSeedRef.current = thisKey;
        const seedOne = (ticketId: string, qty: number): void => {
          const seedTicket = tickets.find((t) => t.id === ticketId);
          if (seedTicket === undefined) return;
          const seed: CartLineSeed = {
            ticketTypeId: seedTicket.id,
            ticketName: seedTicket.name,
            unitPriceCents: Math.round((seedTicket.priceGbp ?? 0) * 100),
            currency: seedTicket.currency ?? fallbackCurrency,
            isFree: seedTicket.isFree,
          };
          const seedQty = Math.max(1, Math.floor(qty));
          const cap =
            seedTicket.isUnlimited || seedTicket.capacity == null
              ? seedQty
              : Math.max(1, Math.min(seedQty, seedTicket.capacity));
          setLineQuantity(seed, cap);
        };
        if (useMulti) {
          for (const [ticketId, qty] of Object.entries(multiSeed)) {
            if (qty > 0) seedOne(ticketId, qty);
          }
        } else if (initialTicketTypeId !== null) {
          seedOne(initialTicketTypeId, initialQuantity);
        }
      }
    }
    if (!visible) {
      lastOpenSeedRef.current = null;
      reset();
      setTermsAccepted(false);
      setConsentHintVisible(false);
      setHighlightUnchosen(false);
      setDiscountCode("");
      setDismissedSaleNotices([]);
      setSameTicketsForEveryDate(true);
      setByDateByTicket({});
      setIntakeAnswers({});
      setIntakeErrors({});
      intakeUploadSessionRef.current = createIntakeUploadSessionId();
    }
  }, [
    visible,
    initialTicketTypeId,
    initialQuantity,
    multiSeed,
    multiSeedKey,
    tickets,
    fallbackCurrency,
    setLineQuantity,
    reset,
  ]);

  /**
   * THE ONE GUARDED FUNNEL for every dismissal this sheet can suffer.
   *
   * `BaseBottomSheet` dismisses by FOUR routes, and only two of them are
   * controlled by props (#2264 tester):
   *
   *   1. swipe down          → `enablePanDownToClose` (prop, disarmed below)
   *   2. backdrop press      → `backdropPressBehavior` (prop, disarmed below)
   *   3. Android hardware back (`BaseBottomSheet.tsx:524`) → calls `onClose()`
   *                            DIRECTLY. No prop can stop it.
   *   4. RN-Modal `onRequestClose` (`:984`)                → same.
   *
   * Routes 3 and 4 are therefore guarded ONLY by what `onClose` is pointed at.
   * It must stay `handleCancel` — never `onCancel` — or a pending checkout
   * becomes dismissable by the Android back button while both prop guards, and
   * a test asserting only those props, stay perfectly green.
   *
   * Invariant: I-PROPOSED-CHECKOUT-PENDING-SURFACE-SURVIVES.
   */
  const handleCancel = useCallback((): void => {
    if (isSubmitting) return;
    onCancel();
  }, [isSubmitting, onCancel]);

  const handleContactChange = useCallback((): void => {
    contactSeedAuthorityRef.current =
      EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.buyerOwned;
    const phoneCountry = resolveContactPhoneCountry(
      contactSnapshot.phone,
      buyerCountryCode,
    );
    setContactDraft(contactSnapshot);
    setContactPhoneCountry(phoneCountry);
    setContactPhoneLocal(
      splitContactPhone(contactSnapshot.phone, phoneCountry),
    );
    setContactFieldsToEdit(
      explorerCheckoutContactFieldsForEditor(contactValidation, true),
    );
    setContactTouched({});
    setContactEditAll(true);
    setContactEditorVisible(true);
  }, [buyerCountryCode, contactSnapshot, contactValidation]);

  const handleContactSave = useCallback((): void => {
    setContactTouched({ name: true, email: true, phone: true });
    if (!contactDraftValidation.isValid) {
      setContactFieldsToEdit((current) => [
        ...new Set([...current, ...contactDraftValidation.invalidFields]),
      ]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setContactSnapshot(contactDraftValidation.normalized);
    setContactDraft(contactDraftValidation.normalized);
    setContactEditorVisible(false);
    setContactEditAll(false);
  }, [contactDraftValidation]);

  const handleContactCancel = useCallback((): void => {
    if (!contactValidation.isValid) return;
    setContactDraft(contactSnapshot);
    setContactEditorVisible(false);
    setContactEditAll(false);
    setContactTouched({});
  }, [contactSnapshot, contactValidation.isValid]);

  const setTierAnswers = useCallback(
    (tierId: string, next: Record<string, IntakeAnswerValue>): void => {
      setIntakeAnswers((prev) => ({ ...prev, [tierId]: next }));
      // Clear the tier's surfaced errors as the buyer edits.
      setIntakeErrors((prev) => {
        if (prev[tierId] === undefined) return prev;
        const copy = { ...prev };
        delete copy[tierId];
        return copy;
      });
    },
    [],
  );

  const checkoutPayloadFor = useCallback(
    (acceptedQuote: TicketQuote): TicketCartCheckoutPayload => {
      const intakeFormData = buildIntakeFormData(
        selectedSchemaTiers.map((tier) => tier.tierId),
        intakeSchemasByTier ?? new Map<string, IntakeSchema>(),
        intakeAnswers,
      );
      return {
        lines: quoteLines,
        marketingOptIn: true,
        purchaseTermsAccepted: termsAccepted,
        buyer: contactValidation.normalized,
        totalCents: acceptedQuote.buyerTotalCents,
        discountCode:
          discountCode.trim().length > 0 ? discountCode.trim() : null,
        quoteDigest: acceptedQuote.quoteDigest,
        quoteListDigest: acceptedQuote.quoteListDigest,
        intakeFormData,
        ...(intakeFormData.length > 0
          ? { intakeUploadSessionId: intakeUploadSessionRef.current }
          : {}),
        ...(quoteEventDateIds.length > 0
          ? { eventDateIds: quoteEventDateIds }
          : {}),
      };
    },
    [
      contactValidation.normalized,
      discountCode,
      intakeAnswers,
      intakeSchemasByTier,
      quoteEventDateIds,
      quoteLines,
      selectedSchemaTiers,
      termsAccepted,
    ],
  );

  const handleConfirm = useCallback((): void => {
    // ORCH-1025 — no taxPreview gate: the buyer can pay immediately. The cart is
    // unblocked the moment it has lines (and any required intake is valid).
    if (isSubmitting || !quoteIsReady || quote === null) return;
    // #3859 P1 — buyer web owns anonymous identity collection. Native waits
    // for the existing root auth flow to restore a signed-in account.
    if (!signedInBuyer) return;
    if (multiDaySelection !== null) {
      const validIds = new Set(
        multiDaySelection.occurrences.map((day) => day.id),
      );
      const selectedIds = [
        ...new Set(multiDaySelection.selectedEventDateIds),
      ].filter((id) => validIds.has(id));
      if (multiDaySelection.status !== "ready") return;
      // issue #3281 — an all-days pass has nothing to choose: the server
      // expands the pass to every upcoming date (ticket-checkout-create).
      const pass =
        multiDaySelection.allDaysPass === true ||
        multiDaySelection.pricingMode === "all_days";
      if (!pass) {
        if (selectedIds.length === 0) {
          // ⚠️ DELETE THIS AND a guest buys a day they never chose.
          setHighlightUnchosen(true);
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Error,
          );
          return;
        }
      }
    }
    if (totals.isEmpty) return;
    if (!contactValidation.isValid || contactEditorVisible) {
      const validation = contactEditorVisible
        ? contactDraftValidation
        : contactValidation;
      setContactEditorVisible(true);
      if (!contactEditorVisible) {
        setContactEditAll(false);
        setContactFieldsToEdit(
          explorerCheckoutContactFieldsForEditor(validation, false),
        );
      } else if (!validation.isValid) {
        setContactFieldsToEdit((current) => [
          ...new Set([...current, ...validation.invalidFields]),
        ]);
      }
      setContactTouched({ name: true, email: true, phone: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (!termsAccepted) {
      setConsentHintVisible(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // ORCH-1016 REWORK (D2) — required-field validation BEFORE payment.
    // Mirrors the business validator AND the edge fn's required gate so the
    // buyer never reaches the PaymentSheet (or a server 400) with a required
    // intake question unanswered.
    if (selectedSchemaTiers.length > 0) {
      const nextErrors: Record<string, Record<string, string>> = {};
      for (const tier of selectedSchemaTiers) {
        const tierAnswers = intakeAnswers[tier.tierId] ?? {};
        const errs = validateAnswerAgainstSchema(tier.schema, tierAnswers);
        if (errs.length > 0) {
          nextErrors[tier.tierId] = errs.reduce<Record<string, string>>(
            (acc, e) => {
              acc[e.question_id] = e.error;
              return acc;
            },
            {},
          );
        }
      }
      if (Object.keys(nextErrors).length > 0) {
        setIntakeErrors(nextErrors);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Non-blocking audit write — purchase acceptance is transactional only.
    void recordConsent({
      source: "checkout",
      disclosureText: PURCHASE_TERMS_DISCLOSURE_TEXT,
      disclosureVersion: PURCHASE_TERMS_DISCLOSURE_VERSION,
      scopes: ["transactional"],
      phone: contactValidation.normalized.phone,
      email: contactValidation.normalized.email,
      userId: signedInBuyer ? buyerUserId : null,
      eventId,
    }).catch(() => undefined);
    onCheckout(checkoutPayloadFor(quote));
  }, [
    totals.isEmpty,
    isSubmitting,
    contactValidation,
    contactDraftValidation,
    contactEditorVisible,
    termsAccepted,
    signedInBuyer,
    buyerUserId,
    eventId,
    checkoutPayloadFor,
    selectedSchemaTiers,
    intakeAnswers,
    intakeSchemasByTier,
    quote,
    quoteIsReady,
    multiDaySelection,
    onCheckout,
  ]);

  // Derived render-state per design §5.
  const visibleTickets = useMemo<PublicTicketProps[]>(() => {
    if (!tickets) return [];
    return [...tickets]
      .filter(isVisibleForConsumer)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [tickets]);

  const allSoldOut =
    visibleTickets.length > 0 &&
    visibleTickets.every((t) => !t.isUnlimited && (t.capacity ?? 0) <= 0);

  const allUnavailable =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) =>
        t.visibility === "disabled" ||
        isTicketSalesEnded(t) ||
        (!t.isUnlimited && (t.capacity ?? 0) <= 0),
    );

  const renderState = (():
    "loading" | "empty" | "sold_out" | "sales_closed" | "populated" => {
    if (tickets === undefined) return "loading";
    if (visibleTickets.length === 0) return "empty";
    if (allSoldOut) return "sold_out";
    if (allUnavailable) return "sales_closed";
    return "populated";
  })();

  const selectedDayCount =
    multiDaySelection === null
      ? 0
      : new Set(multiDaySelection.selectedEventDateIds).size;
  const dayTruthUnavailable =
    multiDaySelection !== null && multiDaySelection.status !== "ready";
  const treatAsAllDaysPass =
    multiDaySelection !== null &&
    (multiDaySelection.allDaysPass === true ||
      multiDaySelection.pricingMode === "all_days");
  const missingRequiredDay =
    multiDaySelection !== null && !treatAsAllDaysPass && selectedDayCount === 0;

  const ctaLabel = missingRequiredDay
    ? "Pick at least one day above"
    : totals.isEmpty
      ? "Add tickets above"
      : isFreeQuote
        ? "Get tickets"
        : "Continue to Payment";
  const ctaDisabled =
    dayTruthUnavailable ||
    (!missingRequiredDay && totals.isEmpty) ||
    isSubmitting ||
    !signedInBuyer ||
    contactEditorVisible ||
    !contactValidation.isValid ||
    !termsAccepted ||
    !quoteIsReady;
  const ctaPressDisabled =
    isSubmitting ||
    !signedInBuyer ||
    dayTruthUnavailable ||
    (!missingRequiredDay && totals.isEmpty) ||
    !quoteIsReady;

  // issue #2265 — the pending vocabulary. The old treatment was a bare spinner
  // (and, on the screen's fallback CTA, nothing at all but `disabled`), which is
  // indistinguishable from broken. Every phase says what is being waited on.
  const pendingCtaLabel = ((): string => {
    switch (pendingPhase) {
      case "creating":
        return isFreeQuote
          ? "Getting your ticket…"
          : "Setting up your payment…";
      case "opening_payment_page":
        return "Opening the payment page…";
      case "presenting_sheet":
        return Platform.OS === "ios"
          ? "Opening Apple Pay…"
          : "Opening payment…";
      case "confirming_payment":
        return "Confirming your payment…";
      default:
        // Defensive only — a submitting sheet with no phase should not happen.
        return "Working…";
    }
  })();

  const subtotalValueText =
    missingRequiredDay || dayTruthUnavailable || totals.isEmpty
      ? "—"
      : quoteIsLoading
        ? "Updating…"
        : quoteQuery.isError || quote === null
          ? "—"
          : formatCentsCurrency(
              quote.planTotalBuyerCents ?? quote.buyerTotalCents,
              quote.currency,
            );
  // The all-in Total is the single-line label when no plan; the upper line of the
  // two-line bar when paying over time.
  const subtotalLabelText = showsDueToday ? "Total" : "Subtotal";
  const dueTodayValueText =
    quote === null
      ? "—"
      : formatCentsCurrency(
          quote.installmentChargeSchedule !== undefined
            ? quote.buyerTotalCents
            : quote.dueTodayNetCents,
          quote.currency,
        );
  const codeOutcome = quote?.codeOutcome ?? null;
  const appliedCodeDiscount =
    quote?.discounts.find((discount) => discount.kind === "code") ?? null;
  const codeFeedback =
    codeOutcome?.status === "rejected" && codeOutcome.reason !== null
      ? t(`code.${codeOutcome.reason}`, {
          code: discountCode.trim().toUpperCase(),
          required:
            codeOutcome.required === null || quote === null
              ? undefined
              : formatCentsCurrency(codeOutcome.required, quote.currency),
          with: codeOutcome.with ?? undefined,
          defaultValue: discountReasonCopy({
            reason: codeOutcome.reason,
            code: discountCode.trim().toUpperCase(),
            required:
              codeOutcome.required === null || quote === null
                ? null
                : formatCentsCurrency(codeOutcome.required, quote.currency),
            withName: codeOutcome.with,
          }),
        })
      : codeOutcome?.status === "applied" && codeOutcome.replaced.length > 0
        ? t("code.replaced", {
            code: discountCode.trim().toUpperCase(),
            names: codeOutcome.replaced.join(", "),
            defaultValue: `${discountCode.trim().toUpperCase()} applied instead of ${codeOutcome.replaced.join(
              ", ",
            )}.`,
          })
        : null;
  const activeSaleNotices = (quote?.notices ?? []).filter(
    (notice) => !dismissedSaleNotices.includes(notice.discountId),
  );
  const reviewQuote =
    terminalOutcome?.outcome === "review" ? terminalOutcome.review.quote : null;
  const discountAnalyticsRef = React.useRef(new Set<string>());
  useEffect(() => {
    if (quote === null || !quoteIsReady) return;
    const captureOnce = (
      event: string,
      suffix: string,
      properties: Readonly<Record<string, string | number>>,
    ): void => {
      const key = `${quote.quoteDigest}:${event}:${suffix}`;
      if (discountAnalyticsRef.current.has(key)) return;
      discountAnalyticsRef.current.add(key);
      postHogService.capture(event, properties);
    };
    if (
      discountCode.trim().length > 0 &&
      quote.codeOutcome.status === "applied"
    ) {
      captureOnce("discount_code_applied", "code", {
        surface: "explorer_cart",
      });
    }
    if (
      discountCode.trim().length > 0 &&
      quote.codeOutcome.status === "rejected" &&
      quote.codeOutcome.reason !== null
    ) {
      captureOnce("discount_code_rejected", quote.codeOutcome.reason, {
        reason: quote.codeOutcome.reason,
        surface: "explorer_cart",
      });
    }
    const automaticCount = quote.discounts.filter(
      (row) => row.kind === "automatic",
    ).length;
    if (automaticCount > 0) {
      captureOnce("discount_auto_applied", String(automaticCount), {
        count: automaticCount,
        surface: "explorer_cart",
      });
    }
    for (const notice of quote.notices) {
      captureOnce("sale_limited_shown", notice.discountId, {
        surface: "explorer_cart",
      });
    }
  }, [discountCode, quote, quoteIsReady]);
  useEffect(() => {
    if (terminalOutcome?.outcome !== "review") return;
    const key = `review:${terminalOutcome.review.detail}`;
    if (discountAnalyticsRef.current.has(key)) return;
    discountAnalyticsRef.current.add(key);
    postHogService.capture("checkout_review_required", {
      detail: terminalOutcome.review.detail,
      surface: "explorer_cart",
    });
  }, [terminalOutcome]);
  const handleReviewAccept = useCallback((): void => {
    if (reviewQuote === null || isSubmitting) return;
    onCheckout(checkoutPayloadFor(reviewQuote));
  }, [checkoutPayloadFor, isSubmitting, onCheckout, reviewQuote]);

  // ORCH-1016 REWORK-4 (FIX A) — the CTA bar must clear BOTH the OS home
  // indicator AND Mingla's floating GlassBottomNav. This sheet renders BELOW the
  // visible nav (no wrapInRNModal), so the nav height is additive on top of the
  // safe-area inset for inline uses. Overlay-carried uses skip the nav height
  // because the whole sheet group already renders above the app nav. Previously
  // only `insets.bottom + 16`, so the buy/Continue button was blocked by the nav
  // on-device.
  const stickyBarStyle = useMemo(
    () => [
      styles.stickyBar,
      {
        paddingBottom:
          (clearFloatingNav ? BOTTOM_NAV_CONTENT_HEIGHT : 0) +
          Math.max(insets.bottom, 16),
      },
    ],
    [clearFloatingNav, insets.bottom],
  );

  // META-ORCH-0991 Wave A — migrated onto BaseBottomSheet. Header is the fixed
  // `header` slot; the scroll/message body is `children`; the sticky CTA bar is
  // `stickyFooter`. scrollMode='scroll' only for the populated state (gorhom
  // BottomSheetScrollView owns the pan-safe scroll); other states use 'view'.
  // The dark #15181f background + rgba(255,255,255,0.35)/width-44 handle are
  // preserved via per-consumer backgroundStyle/handleStyle. The sticky bar keeps
  // its own paddingBottom: insets.bottom+16 (parity floor, SPEC §7.2).
  const header = (
    <View style={styles.headerRow}>
      <Text
        style={styles.headerTitle}
        numberOfLines={multiDaySelection === null ? 1 : undefined}
        allowFontScaling
      >
        {terminalOutcome?.outcome === "succeeded"
          ? (terminalOutcome.title ?? "You’re booked")
          : terminalOutcome?.outcome === "pending"
            ? terminalOutcome.title
            : terminalOutcome?.outcome === "canceled"
              ? "Payment canceled"
              : terminalOutcome?.outcome === "review"
                ? t("review.title", { defaultValue: "Your total changed" })
                : terminalOutcome?.outcome === "failed"
                  ? "Payment needs attention"
                  : "Get tickets"}
      </Text>
      <Pressable
        style={styles.closeIcon}
        accessibilityLabel="Close"
        accessibilityRole="button"
        hitSlop={12}
        onPress={handleCancel}
        disabled={isSubmitting}
      >
        <Icon name="close" size={20} color="rgba(255,255,255,0.65)" />
      </Pressable>
    </View>
  );

  const seedForTicket = (ticket: PublicTicketProps): CartLineSeed => ({
    ticketTypeId: ticket.id,
    ticketName: ticket.name,
    unitPriceCents: Math.round((ticket.priceGbp ?? 0) * 100),
    currency: ticket.currency ?? fallbackCurrency,
    isFree: ticket.isFree,
  });
  // issue #3281 — says which days a listed ticket covers. Explorer has no
  // scope line on the event page yet, so the cart is where a guest sees it.
  const dayScopeLabelFor = (ticket: PublicTicketProps): string | null => {
    const days = multiDaySelection?.occurrences.filter((day) =>
      ticket.validOccurrenceIds?.includes(day.id),
    );
    if (multiDaySelection == null || days == null || days.length === 0) return null;
    if (days.length === multiDaySelection.occurrences.length) return null;
    return days.length === 1
      ? formatOccurrenceLine(days[0], multiDaySelection.timezone)
      : `${days.length} of ${multiDaySelection.occurrences.length} dates`;
  };
  const renderQuantityRow = (
    ticket: PublicTicketProps,
    key: string,
    quantity: number,
    onQuantityChange: (next: number) => void,
  ): React.ReactElement => (
    <QuantityRow
      key={key}
      ticket={{ ...ticket, dayScopeLabel: dayScopeLabelFor(ticket) }}
      quantity={quantity}
      onQuantityChange={onQuantityChange}
      CardComponent={ConsumerCartCard}
      renderPlusIcon={(iconProps: { size: number; color: string }) => (
        <Icon name="add" size={iconProps.size} color={iconProps.color} />
      )}
      formatCurrency={formatMajorCurrency}
      theme={CONSUMER_TICKET_CART_THEME}
      fallbackCurrency={fallbackCurrency}
      installmentNote={installmentNoteByTicketId?.[ticket.id] ?? null}
      allowUnboundedNameWrap={multiDaySelection !== null}
      hideRemainingCount={hideRemainingCount}
    />
  );
  const setTicketByDate = (
    ticket: PublicTicketProps,
    dateId: string,
    next: number,
  ): void => {
    const byDate = withDateQuantity(byDateByTicket[ticket.id], dateId, next);
    setByDateByTicket((current) => ({ ...current, [ticket.id]: byDate }));
    setLineQuantity(
      seedForTicket(ticket),
      byDateTotal(byDateForDates(byDate, quoteEventDateIds)),
    );
  };
  const handleSameTicketsForEveryDate = (on: boolean): void => {
    setSameTicketsForEveryDate(on);
    // Rebuilt from the cart each time, so a removed ticket keeps no saved counts.
    const nextByDate: Record<string, ByDateMap> = {};
    for (const ticket of visibleTickets) {
      const line = lines.find((l) => l.ticketTypeId === ticket.id);
      if (line === undefined) continue;
      if (on) {
        setLineQuantity(
          seedForTicket(ticket),
          uniformQuantity(
            byDateForDates(byDateByTicket[ticket.id], quoteEventDateIds),
          ),
        );
      } else {
        // A listed ticket starts only on the chosen dates it covers: its other
        // rows are hidden, so a count there could never be cleared.
        nextByDate[ticket.id] = evenByDate(
          quoteEventDateIds.filter((id) =>
            ticketCoversAnyDate(ticket.validOccurrenceIds, [id]),
          ),
          line.quantity,
        );
        setLineQuantity(
          seedForTicket(ticket),
          byDateTotal(nextByDate[ticket.id]),
        );
      }
    }
    setByDateByTicket(nextByDate);
  };
  // A changed date selection is the one edit that bypasses the steppers, so the
  // cart follows the map here. Dropping below two dates returns to uniform.
  useEffect(() => {
    if (sameTicketsForEveryDate) return;
    if (!canSplitByDate) setSameTicketsForEveryDate(true);
    for (const ticket of visibleTickets) {
      // A reselected date can bring back a line that dropped to zero.
      const inCart =
        lines.find((l) => l.ticketTypeId === ticket.id)?.quantity ?? 0;
      const total = byDateTotal(
        byDateForDates(byDateByTicket[ticket.id], quoteEventDateIds),
      );
      if (total !== inCart) setLineQuantity(seedForTicket(ticket), total);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSplitByDate, quoteEventDateIds]);
  // issue #3281 — a line can't stay on a ticket none of the chosen dates admit.
  useEffect(() => {
    for (const line of lines) {
      const ticket = visibleTickets.find((t) => t.id === line.ticketTypeId);
      if (
        ticket !== undefined &&
        line.quantity > 0 &&
        !ticketCoversAnyDate(ticket.validOccurrenceIds, quoteEventDateIds)
      ) {
        setLineQuantity(seedForTicket(ticket), 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, quoteEventDateIds, visibleTickets]);
  const ticketRows = perDateActive && multiDaySelection !== null
    ? multiDaySelection.occurrences
        .filter((day) => quoteEventDateIds.includes(day.id))
        .map((day) => (
          <View
            key={day.id}
            style={styles.perDateBlock}
            testID={`issue-3281-date-${day.id}`}
          >
            <Text style={styles.perDateHeading}>
              {formatOccurrenceLine(day, multiDaySelection.timezone) ??
                "This date"}
            </Text>
            {visibleTickets
              .filter((ticket) =>
                ticketCoversAnyDate(ticket.validOccurrenceIds, [day.id]),
              )
              .map((ticket) => (
              <View key={`${day.id}-${ticket.id}`}>
                {ticket.maxPurchaseQty != null && ticket.maxPurchaseQty > 0 ? (
                  <Text style={styles.perDateHint}>
                    {`Up to ${ticket.maxPurchaseQty} per date`}
                  </Text>
                ) : null}
                {renderQuantityRow(
                  ticket,
                  `${day.id}-${ticket.id}-row`,
                  byDateByTicket[ticket.id]?.[day.id] ?? 0,
                  (next) => setTicketByDate(ticket, day.id, next),
                )}
              </View>
            ))}
          </View>
        ))
    : visibleTickets
        .filter((ticket) =>
          ticketCoversAnyDate(ticket.validOccurrenceIds, quoteEventDateIds),
        )
        .map((ticket) => {
        const line = lines.find((l) => l.ticketTypeId === ticket.id);
        return renderQuantityRow(
          ticket,
          ticket.id,
          line?.quantity ?? 0,
          (next) => setLineQuantity(seedForTicket(ticket), next),
        );
      });

  const terminalBody =
    terminalOutcome === null ? null : (
      <View
        style={styles.terminalBody}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="explorer-checkout-terminal-state"
      >
        <Text style={styles.terminalTitle}>
          {terminalOutcome.outcome === "succeeded"
            ? (terminalOutcome.title ?? "You’re booked")
            : terminalOutcome.outcome === "pending"
              ? terminalOutcome.title
              : terminalOutcome.outcome === "canceled"
                ? "Payment canceled"
                : terminalOutcome.outcome === "review"
                  ? t("review.title", { defaultValue: "Your total changed" })
                  : "Payment needs attention"}
        </Text>
        {terminalOutcome.outcome === "review" ? (
          <>
            <Text style={styles.terminalMessage}>
              {checkoutReviewReasonCopy(terminalOutcome.review.detail)}
            </Text>
            <View style={styles.reviewTotals}>
              {quote !== null ? (
                <Text style={styles.reviewOldTotal}>
                  {formatCentsCurrency(quote.buyerTotalCents, quote.currency)}
                </Text>
              ) : null}
              <Text style={styles.reviewNewTotal}>
                {reviewQuote === null
                  ? "—"
                  : formatCentsCurrency(
                      reviewQuote.buyerTotalCents,
                      reviewQuote.currency,
                    )}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.terminalMessage}>
            {terminalOutcome.outcome === "succeeded"
              ? "Your booking is confirmed and your tickets are ready."
              : terminalOutcome.outcome === "pending"
                ? terminalOutcome.message
                : terminalOutcome.outcome === "canceled"
                  ? "No completed or pending payment was found. You can review your booking and try again."
                  : terminalOutcome.message}
          </Text>
        )}
        {terminalOutcome.outcome === "succeeded" ? successFooter : null}
      </View>
    );

  const sessionRequiredBody = sessionRequired ? (
    <View
      style={styles.bodyMessageWrap}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="explorer-checkout-session-required"
    >
      <ActivityIndicator color="rgba(255,255,255,0.65)" />
      <Text style={styles.bodyMessage}>Checking your session…</Text>
      <Text style={styles.sessionRequiredMessage}>
        Sign in again to continue your booking.
      </Text>
    </View>
  ) : null;

  const body =
    terminalBody ??
    sessionRequiredBody ??
    (renderState === "loading" ? (
      <View style={styles.bodyMessageWrap}>
        <ActivityIndicator color="rgba(255,255,255,0.65)" />
        <Text style={styles.bodyMessage}>Loading tickets…</Text>
      </View>
    ) : renderState === "empty" ? (
      <View style={styles.bodyMessageWrap}>
        <Text style={styles.bodyMessage}>
          No tickets available for this event.
        </Text>
      </View>
    ) : renderState === "sold_out" ? (
      <View style={styles.bodyMessageWrap}>
        <Text style={styles.bodyMessage}>Sold out. Check back later.</Text>
      </View>
    ) : renderState === "sales_closed" ? (
      <View style={styles.bodyMessageWrap}>
        <Text style={styles.bodyMessage}>
          This event isn’t taking new tickets.
        </Text>
      </View>
    ) : (
      <>
        {multiDaySelection !== null ? (
          <EventDayChooser
            occurrences={multiDaySelection.occurrences}
            selectedEventDateIds={multiDaySelection.selectedEventDateIds}
            pricingMode={multiDaySelection.pricingMode}
            allDaysPass={
              multiDaySelection.allDaysPass === true ||
              multiDaySelection.pricingMode === "all_days"
            }
            isPaid={visibleTickets.some((ticket) => !ticket.isFree)}
            timezone={multiDaySelection.timezone}
            status={multiDaySelection.status}
            highlightUnchosen={highlightUnchosen}
            rowsDisabled={
              isSubmitting ||
              (multiDaySelection.status !== "ready" &&
                multiDaySelection.status !== "offline")
            }
            retryDisabled={isSubmitting}
            onToggle={(eventDateId) => {
              setHighlightUnchosen(false);
              void Haptics.selectionAsync();
              multiDaySelection.onToggle(eventDateId);
            }}
            onRetry={multiDaySelection.onRetry}
          />
        ) : null}
        <Text style={styles.sectionLabel}>SELECT YOUR TICKETS</Text>
        {canSplitByDate ? (
          <View
            style={styles.sameTicketsRow}
            testID="issue-3281-same-tickets-switch"
          >
            <Text style={styles.sameTicketsLabel}>
              Same tickets for every date
            </Text>
            <Switch
              value={sameTicketsForEveryDate}
              onValueChange={handleSameTicketsForEveryDate}
              disabled={isSubmitting}
              accessibilityLabel="Same tickets for every date"
            />
          </View>
        ) : null}
        {multiDaySelection !== null ? (
          <View
            pointerEvents={dayTruthUnavailable ? "none" : "auto"}
            style={dayTruthUnavailable ? styles.unavailableTickets : undefined}
            accessibilityElementsHidden={dayTruthUnavailable}
            importantForAccessibility={
              dayTruthUnavailable ? "no-hide-descendants" : "auto"
            }
          >
            {ticketRows}
          </View>
        ) : (
          ticketRows
        )}

        <View style={styles.discountSection}>
          <Text style={styles.sectionLabel}>
            {t("code.label", { defaultValue: "DISCOUNT CODE" })}
          </Text>
          {codeOutcome?.status === "applied" && appliedCodeDiscount !== null ? (
            <View style={styles.discountAppliedRow}>
              <View style={styles.discountAppliedCopy}>
                <Text style={styles.discountAppliedName}>
                  {appliedCodeDiscount.name}
                </Text>
                <Text style={styles.discountAppliedSaving}>
                  {t("code.saving", {
                    amount: formatCentsCurrency(
                      appliedCodeDiscount.amountMinor,
                      quote?.currency ?? fallbackCurrency,
                    ),
                    defaultValue: `Saving ${formatCentsCurrency(
                      appliedCodeDiscount.amountMinor,
                      quote?.currency ?? fallbackCurrency,
                    )}`,
                  })}
                </Text>
              </View>
              <Pressable
                onPress={() => setDiscountCode("")}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel={t("code.remove", {
                  defaultValue: "Remove discount code",
                })}
              >
                <Text style={styles.discountRemove}>
                  {t("code.remove_short", { defaultValue: "Remove" })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.discountInputRow}>
              <TextInput
                value={discountCode}
                onChangeText={setDiscountCode}
                placeholder={t("code.placeholder", {
                  defaultValue: "Enter a code",
                })}
                placeholderTextColor="rgba(255,255,255,0.36)"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!isSubmitting}
                accessibilityLabel={t("code.input_label", {
                  defaultValue: "Discount code",
                })}
                style={styles.discountInput}
              />
              {quoteIsLoading && discountCode.trim().length > 0 ? (
                <ActivityIndicator color="#eb7825" />
              ) : null}
            </View>
          )}
          {codeFeedback !== null ? (
            <Text
              style={
                codeOutcome?.status === "rejected"
                  ? styles.discountError
                  : styles.discountMessage
              }
              accessibilityLiveRegion="polite"
            >
              {codeFeedback}
            </Text>
          ) : null}
          {quoteQuery.isError ? (
            <View style={styles.quoteError} accessibilityRole="alert">
              <Text style={styles.discountError}>
                {quoteQuery.error.message === "rate_limited"
                  ? t("code.rate_limited", {
                      defaultValue: "Too many tries. Wait a few minutes.",
                    })
                  : t("quote.error", {
                      defaultValue: "Couldn’t get your price.",
                    })}
              </Text>
              <Pressable
                onPress={() => void quoteQuery.refetch()}
                accessibilityRole="button"
              >
                <Text style={styles.quoteRetry}>
                  {t("quote.retry", { defaultValue: "Try again" })}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {activeSaleNotices.map((notice) => {
            const quoteLine = quote?.lines.find(
              (line) => line.ticketTypeId === notice.lineRef,
            );
            const ticket = tickets?.find((row) => row.id === notice.lineRef);
            const sale = quote?.discounts.find(
              (discount) => discount.discountId === notice.discountId,
            );
            const name = sale?.name ?? ticket?.saleName ?? "sale";
            const currentQuantity = quoteLine?.quantity ?? 0;
            return (
              <View
                key={`${notice.discountId}:${notice.lineRef}`}
                style={styles.saleNotice}
              >
                <Text style={styles.saleNoticeText}>
                  {saleLimitedCopy(name, notice.remaining)}
                </Text>
                <View style={styles.saleNoticeActions}>
                  {notice.remaining > 0 &&
                  ticket !== undefined &&
                  !perDateActive ? (
                    <Pressable
                      onPress={() => {
                        postHogService.capture("sale_limited_choice", {
                          choice: "reduce",
                          surface: "explorer_cart",
                        });
                        const seed: CartLineSeed = {
                          ticketTypeId: ticket.id,
                          ticketName: ticket.name,
                          unitPriceCents: Math.round(
                            (ticket.priceGbp ?? 0) * 100,
                          ),
                          currency: ticket.currency ?? fallbackCurrency,
                          isFree: ticket.isFree,
                        };
                        setLineQuantity(seed, notice.remaining);
                      }}
                      accessibilityRole="button"
                      style={styles.saleNoticeButton}
                    >
                      <Text style={styles.saleNoticeButtonText}>
                        {t("sale_limited.buy", {
                          count: notice.remaining,
                          sale: name,
                          defaultValue: `Buy ${notice.remaining} at ${name}`,
                        })}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => {
                      postHogService.capture("sale_limited_choice", {
                        choice: "keep",
                        surface: "explorer_cart",
                      });
                      setDismissedSaleNotices((current) => [
                        ...current,
                        notice.discountId,
                      ]);
                    }}
                    accessibilityRole="button"
                    style={styles.saleNoticeButton}
                  >
                    <Text style={styles.saleNoticeButtonText}>
                      {t("sale_limited.keep", {
                        count: currentQuantity,
                        defaultValue: `Keep ${currentQuantity} at list`,
                      })}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        {/* #3859 — purchase terms only; Explorer marketing has no cart toggle. */}
        <Pressable
          onPress={() => {
            setTermsAccepted((v) => {
              const next = !v;
              if (next) setConsentHintVisible(false);
              return next;
            });
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: termsAccepted }}
          accessibilityLabel={PURCHASE_TERMS_DISCLOSURE_TEXT}
          disabled={isSubmitting}
          style={({ pressed }) => [
            styles.checkboxRow,
            pressed && styles.checkboxRowPressed,
          ]}
        >
          <View
            style={[
              styles.checkboxBox,
              termsAccepted && styles.checkboxBoxChecked,
              consentHintVisible && !termsAccepted && styles.checkboxBoxFlash,
            ]}
          >
            {termsAccepted ? (
              <Icon name="check" size={14} color="#ffffff" />
            ) : null}
          </View>
          <Text style={styles.checkboxLabel}>
            {PURCHASE_TERMS_LABEL_PREFIX}
            <Text
              style={styles.checkboxLink}
              onPress={(event) => {
                event.stopPropagation();
                void Linking.openURL(LEGAL_URLS.termsOfService);
              }}
              accessibilityRole="link"
              accessibilityLabel="Open Mingla Terms of Service"
            >
              {PURCHASE_TERMS_LABEL_TERMS}
            </Text>
            {PURCHASE_TERMS_LABEL_JOINER}
            <Text
              style={styles.checkboxLink}
              onPress={(event) => {
                event.stopPropagation();
                void Linking.openURL(LEGAL_URLS.privacyPolicy);
              }}
              accessibilityRole="link"
              accessibilityLabel="Open Mingla Privacy Policy"
            >
              {PURCHASE_TERMS_LABEL_PRIVACY}
            </Text>
            {PURCHASE_TERMS_LABEL_SUFFIX}
          </Text>
        </Pressable>
        {consentHintVisible && !termsAccepted ? (
          <Text style={styles.consentRequiredHint}>
            Please agree to continue.
          </Text>
        ) : null}

        {/* #3859 — deterministic, booking-local Explorer contact. */}
        <ConsumerCartCard style={styles.recapCard}>
          <View style={styles.contactHeader}>
            <Text style={styles.recapSectionLabel}>
              CONTACT FOR THIS BOOKING
            </Text>
            {!contactEditorVisible ? (
              <Pressable
                onPress={handleContactChange}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Change contact for this booking"
                style={({ pressed }) => [
                  styles.contactChangeButton,
                  pressed && styles.contactButtonPressed,
                ]}
              >
                <Text style={styles.contactChangeLabel}>Change</Text>
              </Pressable>
            ) : null}
          </View>
          {contactEditorVisible ? (
            <View style={styles.contactEditor}>
              {contactFieldsToEdit.includes("name") ? (
                <View style={styles.contactField}>
                  <Text style={styles.contactFieldLabel}>Full name</Text>
                  <TextInput
                    value={contactDraft.name}
                    onChangeText={(name) => {
                      contactSeedAuthorityRef.current =
                        EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.buyerOwned;
                      setContactDraft((current) => ({ ...current, name }));
                    }}
                    onBlur={() =>
                      setContactTouched((current) => ({
                        ...current,
                        name: true,
                      }))
                    }
                    editable={!isSubmitting}
                    autoCapitalize="words"
                    autoComplete="name"
                    accessibilityLabel="Full name for this booking"
                    style={[
                      styles.contactTextInput,
                      contactTouched.name &&
                        !contactDraftValidation.valid.name &&
                        styles.contactTextInputError,
                    ]}
                  />
                  {contactTouched.name && !contactDraftValidation.valid.name ? (
                    <Text style={styles.contactError}>
                      Enter the full name for this booking.
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {contactFieldsToEdit.includes("email") ? (
                <View style={styles.contactField}>
                  <Text style={styles.contactFieldLabel}>Email</Text>
                  <TextInput
                    value={contactDraft.email}
                    onChangeText={(email) => {
                      contactSeedAuthorityRef.current =
                        EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.buyerOwned;
                      setContactDraft((current) => ({ ...current, email }));
                    }}
                    onBlur={() =>
                      setContactTouched((current) => ({
                        ...current,
                        email: true,
                      }))
                    }
                    editable={!isSubmitting}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    accessibilityLabel="Email for this booking"
                    style={[
                      styles.contactTextInput,
                      contactTouched.email &&
                        !contactDraftValidation.valid.email &&
                        styles.contactTextInputError,
                    ]}
                  />
                  {contactTouched.email &&
                  !contactDraftValidation.valid.email ? (
                    <Text style={styles.contactError}>
                      Enter a valid email address.
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {contactFieldsToEdit.includes("phone") ? (
                <View style={styles.contactField}>
                  <Text style={styles.contactFieldLabel}>Mobile number</Text>
                  <PhoneInput
                    pickerPresentation="overlay"
                    value={contactPhoneLocal}
                    countryCode={contactPhoneCountry}
                    onChangePhone={(phone) => {
                      contactSeedAuthorityRef.current =
                        EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.buyerOwned;
                      setContactPhoneLocal(phone);
                      setContactDraft((current) => ({
                        ...current,
                        phone:
                          resolveUserPhoneE164(phone, contactPhoneCountry) ??
                          "",
                      }));
                    }}
                    onChangeCountry={(countryCode) => {
                      contactSeedAuthorityRef.current =
                        EXPLORER_CHECKOUT_CONTACT_SEED_AUTHORITY.buyerOwned;
                      setContactPhoneCountry(countryCode);
                      setContactDraft((current) => ({
                        ...current,
                        phone:
                          resolveUserPhoneE164(
                            contactPhoneLocal,
                            countryCode,
                          ) ?? "",
                      }));
                    }}
                    onBlur={() =>
                      setContactTouched((current) => ({
                        ...current,
                        phone: true,
                      }))
                    }
                    error={
                      contactTouched.phone &&
                      !contactDraftValidation.valid.phone
                        ? "Select a country and enter a valid mobile number."
                        : null
                    }
                    disabled={isSubmitting}
                    theme={CHECKOUT_CONTACT_PHONE_THEME}
                    required
                    smartEntry
                    maxLength={40}
                    testID="explorer-checkout-contact-phone"
                    countryButtonAccessibilityLabel="Select mobile number country"
                    phoneInputAccessibilityLabel="Mobile number for this booking"
                  />
                </View>
              ) : null}
              <View style={styles.contactEditorActions}>
                {contactEditAll && contactValidation.isValid ? (
                  <Pressable
                    onPress={handleContactCancel}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel contact changes"
                    style={({ pressed }) => [
                      styles.contactCancelButton,
                      pressed && styles.contactButtonPressed,
                    ]}
                  >
                    <Text style={styles.contactCancelLabel}>Cancel</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={handleContactSave}
                  disabled={isSubmitting}
                  accessibilityRole="button"
                  accessibilityLabel="Save contact for this booking"
                  style={({ pressed }) => [
                    styles.contactSaveButton,
                    pressed && styles.contactButtonPressed,
                  ]}
                >
                  <Text style={styles.contactSaveLabel}>
                    Save for this booking
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.contactRecap}>
              <Text style={styles.contactName}>{contactSnapshot.name}</Text>
              <Text style={styles.contactDetail}>{contactSnapshot.email}</Text>
              <Text style={styles.contactDetail}>{contactSnapshot.phone}</Text>
              <Text style={styles.contactHelper}>
                We’ll send booking updates and receipts here.
              </Text>
            </View>
          )}
        </ConsumerCartCard>

        {/* ORCH-1016 REWORK (D2) — per-tier trip intake forms. Only renders for
            selected tiers that carry an intake schema; the no-schema path shows
            nothing here. */}
        {selectedSchemaTiers.length > 0 ? (
          <View style={styles.intakeSection}>
            <Text style={styles.sectionLabel}>BEFORE YOU GO</Text>
            {selectedSchemaTiers.map((tier) => (
              <ConsumerIntakeForm
                key={tier.tierId}
                schema={tier.schema}
                tierName={tier.tierName}
                answers={intakeAnswers[tier.tierId] ?? {}}
                onAnswersChange={(next) => setTierAnswers(tier.tierId, next)}
                validationErrors={intakeErrors[tier.tierId]}
                disabled={isSubmitting}
                onUpload={(file) =>
                  uploadTripIntakeFile({
                    eventId,
                    ticketTypeId: tier.tierId,
                    schemaVersionId: tier.schema.schema_version_id,
                    uploadSessionId: intakeUploadSessionRef.current,
                    ...file,
                  })
                }
                onRemove={(claimId) =>
                  revokeTripIntakeFileClaim({
                    claimId,
                    uploadSessionId: intakeUploadSessionRef.current,
                  })
                }
              />
            ))}
          </View>
        ) : null}

        {quote?.installmentChargeSchedule !== undefined ? (
          <View style={styles.installmentQuoteCard}>
            <Text style={styles.sectionLabel}>PAYMENT PLAN</Text>
            <View style={styles.installmentQuoteRow}>
              <Text style={styles.installmentQuoteLabel}>Today</Text>
              <View style={styles.installmentQuoteAmountWrap}>
                <Text style={styles.installmentQuoteAmount}>
                  {formatCentsCurrency(quote.buyerTotalCents, quote.currency)}
                </Text>
                <Text style={styles.installmentQuoteFees}>Includes fees &amp; tax</Text>
              </View>
            </View>
            {quote.installmentChargeSchedule.payments.map((payment) => (
              <View key={payment.ordinal} style={styles.installmentQuoteRow}>
                <Text style={styles.installmentQuoteLabel}>
                  {formatInstallmentDueDate(payment.dueAt)}
                </Text>
                <View style={styles.installmentQuoteAmountWrap}>
                  <Text style={styles.installmentQuoteAmount}>
                    {formatCentsCurrency(payment.buyerTotalCents, quote.currency)}
                  </Text>
                  <Text style={styles.installmentQuoteFees}>Includes fees &amp; tax</Text>
                </View>
              </View>
            ))}
            <Text style={styles.installmentQuoteReassurance}>
              {installmentReassuranceText({
                depositFormatted: formatCentsCurrency(
                  quote.buyerTotalCents,
                  quote.currency,
                ),
                remainingFormatted: formatCentsCurrency(
                  quote.installmentChargeSchedule.payments.reduce(
                    (sum, payment) => sum + payment.buyerTotalCents,
                    0,
                  ),
                  quote.currency,
                ),
                collection: "auto_card_or_pay_link",
              })}
            </Text>
          </View>
        ) : null}

        {/* ORCH-1025 — "What's included" breakdown. Replaces the retired
            billing-address + Calculate-tax form (CartTaxPreview). Shows the
            all-in total upfront with a tappable breakdown. Only the truthful,
            server-derived figures are shown: the base "Tickets" subtotal, the
            combined "Fees & tax" delta (all-in − base), and the all-in total.
            The public RPC exposes no VAT/service-fee SPLIT, so we never fabricate
            separate numbers — when an all-in delta exists we add the qualitative
            "Includes VAT & fees" note (G-3). Hidden for free-only carts. */}
        {!missingRequiredDay &&
        !dayTruthUnavailable &&
        !totals.isEmpty &&
        quote !== null ? (
          <View style={styles.breakdownWrap}>
            <Pressable
              onPress={() => setBreakdownOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: breakdownOpen }}
              accessibilityLabel="What's included"
              disabled={isSubmitting}
              style={({ pressed }) => [
                styles.breakdownHeader,
                pressed && styles.breakdownHeaderPressed,
              ]}
            >
              <Text style={styles.breakdownTitle}>What’s included</Text>
              <Icon
                name={breakdownOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color="rgba(255,255,255,0.55)"
              />
            </Pressable>
            {breakdownOpen ? (
              <View style={styles.breakdownBody}>
                {quote.lines.map((line) => (
                  <View key={line.ticketTypeId} style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>
                      {line.ticketName} × {line.quantity}
                    </Text>
                    <View style={styles.breakdownPricePair}>
                      {line.lineListCents > line.lineNetCents ? (
                        <Text style={styles.breakdownListValue}>
                          {formatCentsCurrency(
                            line.lineListCents,
                            quote.currency,
                          )}
                        </Text>
                      ) : null}
                      <Text style={styles.breakdownValue}>
                        {formatCentsCurrency(line.lineNetCents, quote.currency)}
                      </Text>
                    </View>
                  </View>
                ))}
                {quote.discounts.map((discount) => (
                  <View key={discount.discountId} style={styles.breakdownRow}>
                    <Text style={styles.breakdownDiscountLabel}>
                      {discount.name}
                    </Text>
                    <Text style={styles.breakdownDiscountValue}>
                      −
                      {formatCentsCurrency(
                        discount.amountMinor,
                        quote.currency,
                      )}
                    </Text>
                  </View>
                ))}
                {ticketQuoteFeesAndTaxCents(quote) > 0 ? (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Fees &amp; tax</Text>
                    <Text style={styles.breakdownValue}>
                      {formatCentsCurrency(
                        ticketQuoteFeesAndTaxCents(quote),
                        quote.currency,
                      )}
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.breakdownRow, styles.breakdownTotalRow]}>
                  <Text style={styles.breakdownTotalLabel}>Total</Text>
                  <Text style={styles.breakdownTotalValue}>
                    {formatCentsCurrency(quote.buyerTotalCents, quote.currency)}
                  </Text>
                </View>
                {ticketQuoteFeesAndTaxCents(quote) > 0 ? (
                  <Text style={styles.breakdownNote}>
                    Includes VAT &amp; fees
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </>
    ));

  const stickyFooter =
    terminalOutcome?.outcome === "review" ? (
      <View style={stickyBarStyle}>
        <Pressable
          onPress={handleReviewAccept}
          disabled={reviewQuote === null || isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Accept the new total and pay"
          style={({ pressed }) => [
            styles.ctaButton,
            (reviewQuote === null || isSubmitting) && styles.ctaButtonDisabled,
            pressed && styles.ctaButtonPressed,
          ]}
        >
          <Text style={styles.ctaLabel}>
            {reviewQuote === null
              ? "Review unavailable"
              : `Pay ${formatCentsCurrency(
                  reviewQuote.buyerTotalCents,
                  reviewQuote.currency,
                )}`}
          </Text>
        </Pressable>
        <Pressable
          onPress={onTerminalRetry}
          disabled={isSubmitting || onTerminalRetry === undefined}
          accessibilityRole="button"
          accessibilityLabel="Back to tickets"
          style={styles.reviewBackButton}
        >
          <Text style={styles.reviewBackLabel}>Back to tickets</Text>
        </Pressable>
      </View>
    ) : terminalOutcome !== null ? (
      <View style={stickyBarStyle}>
        <Pressable
          onPress={
            (terminalOutcome.outcome === "canceled" &&
              terminalOutcome.retryable === true) ||
            (terminalOutcome.outcome === "failed" &&
              terminalOutcome.retryable === true)
              ? onTerminalRetry
              : handleCancel
          }
          disabled={
            ((terminalOutcome.outcome === "canceled" &&
              terminalOutcome.retryable === true) ||
              (terminalOutcome.outcome === "failed" &&
                terminalOutcome.retryable === true)) &&
            onTerminalRetry === undefined
          }
          accessibilityRole="button"
          accessibilityLabel={
            (terminalOutcome.outcome === "canceled" &&
              terminalOutcome.retryable === true) ||
            (terminalOutcome.outcome === "failed" &&
              terminalOutcome.retryable === true)
              ? "Review booking and try again"
              : "Close"
          }
          style={({ pressed }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
          ]}
        >
          <Text style={styles.ctaLabel}>
            {(terminalOutcome.outcome === "canceled" &&
              terminalOutcome.retryable === true) ||
            (terminalOutcome.outcome === "failed" &&
              terminalOutcome.retryable === true)
              ? "Review and try again"
              : "Close"}
          </Text>
        </Pressable>
      </View>
    ) : sessionRequired ? (
      <View style={stickyBarStyle}>
        <Pressable
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
          ]}
        >
          <Text style={styles.ctaLabel}>Close</Text>
        </Pressable>
      </View>
    ) : renderState === "populated" ? (
      <View style={stickyBarStyle}>
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>{subtotalLabelText}</Text>
          <Text style={styles.subtotalValue} accessibilityLiveRegion="polite">
            {subtotalValueText}
          </Text>
        </View>
        {/* ORCH-1182 — pay-over-time carts show the qty-scaled deposit DUE TODAY
            on a second line beneath the all-in Total (mirrors the business
            buyer.tsx / payment.tsx two-line pattern). Hidden for no-plan carts. */}
        {showsDueToday ? (
          <View style={styles.dueTodayRow}>
            <Text style={styles.dueTodayLabel}>Due today</Text>
            <Text style={styles.dueTodayValue}>{dueTodayValueText}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={handleConfirm}
          disabled={ctaPressDisabled}
          accessibilityRole="button"
          accessibilityLabel={isSubmitting ? pendingCtaLabel : ctaLabel}
          accessibilityState={{
            disabled: ctaPressDisabled,
            busy: isSubmitting,
          }}
          style={({ pressed }) => [
            styles.ctaButton,
            ctaDisabled && styles.ctaButtonDisabled,
            pressed && !ctaDisabled && styles.ctaButtonPressed,
          ]}
        >
          {isSubmitting ? (
            // issue #2265 — spinner AND a sentence. A spinner alone tells the
            // buyer something is happening; it does not tell them WHAT, and on a
            // 25-second Paystack confirmation that difference is the bug.
            <View style={styles.ctaPendingRow}>
              <ActivityIndicator color="#ffffff" />
              <Text
                style={[styles.ctaLabel, styles.ctaPendingLabel]}
                numberOfLines={1}
                allowFontScaling
              >
                {pendingCtaLabel}
              </Text>
            </View>
          ) : (
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          )}
        </Pressable>
      </View>
    ) : renderState === "empty" ||
      renderState === "sold_out" ||
      renderState === "sales_closed" ? (
      <View style={stickyBarStyle}>
        <Pressable
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
          ]}
        >
          <Text style={styles.ctaLabel}>Close</Text>
        </Pressable>
      </View>
    ) : undefined;

  // ORCH-1016 REWORK-4 (FIX A) — mirror ExpandedBusinessEventSheet /
  // ConsumerTripDetailScreen's PROVEN scroll wiring (RW3.2):
  //   scrollMode="view"  → BaseBottomSheet passes children straight into
  //                        BottomSheetContent (no extra nesting),
  //   <BottomSheetScrollView flex:1>  → the gorhom scroll host as a flex:1
  //                        DIRECT child of BottomSheetContent (so a tall cart +
  //                        intake form physically scrolls at runtime),
  //   {stickyFooter}     → the CTA bar as a SIBLING View BELOW the scroll host
  //                        (NOT BaseBottomSheet's `stickyFooter` prop, which
  //                        routed the sheet into the frozen nested branch).
  // The CTA bar (stickyBarStyle) carries the needed bottom clearance for its
  // host mode. The non-populated states (loading/empty/sold-out) render their
  // centered message body inside the same scroll host — nothing to scroll there,
  // but the wiring stays uniform.
  // ORCH-1016 ROOT-CAUSE FIX: BARE scrollMode="scroll" so the gorhom
  // BottomSheetScrollView is the DIRECT child of BottomSheetContent (the only
  // structure gorhom constrains to the snap height). The header + body + Pay CTA
  // are scroll children — the long billing form now scrolls to reach Pay. The nav
  // is hidden (`hidesBottomNav`) so the CTA isn't covered. (Was scrollMode="view"
  // + header + bodyContainerStyle + injected scroll → wrapped scroll → viewport ==
  // content → frozen, so the form never reached Pay.)
  return (
    <BaseBottomSheet
      visible={visible}
      onClose={handleCancel}
      theme="dark"
      snapPoints={SHEET_SNAP_POINTS}
      // ORCH-1138 [content-sized cart] — size the sheet to its scroll content
      // (header + body + CTA all live in the single BottomSheetScrollView), so a
      // short cart is a short sheet with the CTA anchored at the content bottom
      // and no large empty gap. `maxDynamicContentSize` caps the growth at ~92%
      // of the window; beyond that gorhom keeps the sheet at the cap and the inner
      // scrollable scrolls (preserving the ORCH-1016/1043 scroll-to-Pay behavior).
      enableDynamicSizing
      maxDynamicContentSize={maxDynamicContentSize}
      // issue #2265 (DISC-C) — a pending state that refuses the close BUTTON but
      // yields to a SWIPE is not a pending state. These two props disarm routes
      // 1 and 2; routes 3 and 4 (Android hardware back, RN-Modal
      // onRequestClose) bypass props entirely and are guarded by
      // `onClose={handleCancel}` below — see handleCancel's own comment. All
      // four, or none.
      // Invariant: I-PROPOSED-CHECKOUT-PENDING-SURFACE-SURVIVES.
      enablePanDownToClose={!isSubmitting}
      backdropPressBehavior={isSubmitting ? "none" : "close"}
      backgroundStyle={styles.sheetBackground}
      handleStyle={styles.handleIndicator}
      accessibilityLabel="Get tickets"
      scrollMode="scroll"
      hidesBottomNav
      scrollProps={{
        contentContainerStyle: styles.scrollContent,
        showsVerticalScrollIndicator: false,
      }}
    >
      {header}
      {body}
      {stickyFooter}
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#15181f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
    width: 44,
  },
  content: {
    flex: 1,
    paddingTop: 12,
    // No horizontal padding here — each section applies its own so the
    // sticky bar can span edge-to-edge with its own internal padding.
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
    paddingHorizontal: 24,
  },
  headerTitle: {
    flex: 1,
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  closeIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  // Body — error/loading/empty/sold_out/sales_closed
  bodyMessageWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 12,
  },
  bodyMessage: {
    fontSize: 15,
    color: "rgba(255, 255, 255, 0.65)",
    textAlign: "center",
    lineHeight: 22,
  },
  sessionRequiredMessage: {
    maxWidth: 280,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255, 255, 255, 0.65)",
    textAlign: "center",
  },
  scrollContent: {
    paddingHorizontal: 24,
    // Breathing room above the (separately nav-cleared) sticky CTA footer.
    paddingBottom: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.52)",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  unavailableTickets: { opacity: 0.45 },
  sameTicketsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sameTicketsLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
    marginRight: 12,
  },
  perDateBlock: { marginBottom: 12 },
  perDateHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
  },
  perDateHint: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.52)",
    marginBottom: 4,
  },
  discountSection: {
    marginTop: 16,
  },
  discountInputRow: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  discountInput: {
    flex: 1,
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 15,
  },
  discountAppliedRow: {
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(34, 197, 94, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.30)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  discountAppliedCopy: { flex: 1 },
  discountAppliedName: {
    color: "rgba(255,255,255,0.96)",
    fontSize: 14,
    fontWeight: "700",
  },
  discountAppliedSaving: {
    color: "#86efac",
    fontSize: 12,
    marginTop: 2,
  },
  discountRemove: {
    color: "#eb7825",
    fontSize: 13,
    fontWeight: "700",
  },
  discountMessage: {
    color: "rgba(255,255,255,0.70)",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  discountError: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  quoteError: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  quoteRetry: {
    color: "#eb7825",
    fontSize: 13,
    fontWeight: "700",
  },
  saleNotice: {
    marginTop: 10,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.32)",
    gap: 10,
  },
  saleNoticeText: {
    color: "#fde68a",
    fontSize: 13,
    lineHeight: 19,
  },
  saleNoticeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  saleNoticeButton: {
    minHeight: 38,
    borderRadius: 10,
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  saleNoticeButtonText: {
    color: "rgba(255,255,255,0.90)",
    fontSize: 12,
    fontWeight: "700",
  },
  // Marketing opt-in
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
    marginTop: 4,
  },
  checkboxRowPressed: {
    opacity: 0.7,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.72)",
    lineHeight: 20,
  },
  checkboxLink: {
    color: "#eb7825",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  checkboxBoxFlash: {
    borderColor: "#ef4444",
  },
  consentRequiredHint: {
    marginTop: 6,
    fontSize: 12,
    color: "#ef4444",
    fontWeight: "500",
  },
  // Buyer recap
  recapCard: {
    marginTop: 12,
  },
  // ORCH-1016 REWORK (D2) — intake section
  intakeSection: {
    marginTop: 16,
  },
  recapSectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.55)",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  contactHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  contactChangeButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  contactChangeLabel: {
    color: "#eb7825",
    fontSize: 14,
    fontWeight: "700",
  },
  contactEditor: {
    gap: 14,
  },
  contactField: {
    gap: 6,
  },
  contactFieldLabel: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 13,
    fontWeight: "600",
  },
  contactTextInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderRadius: 12,
    paddingHorizontal: 14,
    color: "rgba(255, 255, 255, 0.96)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    fontSize: 15,
  },
  contactTextInputError: {
    borderColor: "#ef4444",
  },
  contactError: {
    color: "#ef4444",
    fontSize: 12,
    lineHeight: 17,
  },
  contactEditorActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
  },
  contactCancelButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  contactCancelLabel: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 14,
    fontWeight: "600",
  },
  contactSaveButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: "#eb7825",
  },
  contactSaveLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  contactButtonPressed: {
    opacity: 0.72,
  },
  contactRecap: {
    gap: 4,
  },
  contactName: {
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 16,
    fontWeight: "700",
  },
  contactDetail: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 14,
    lineHeight: 20,
  },
  contactHelper: {
    marginTop: 6,
    color: "rgba(255, 255, 255, 0.45)",
    fontSize: 12,
    lineHeight: 17,
  },
  // ORCH-1025 — "What's included" breakdown panel
  breakdownWrap: {
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    overflow: "hidden",
  },
  breakdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  breakdownHeaderPressed: {
    opacity: 0.7,
  },
  breakdownTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.88)",
  },
  breakdownBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 8,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  breakdownLabel: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.62)",
  },
  breakdownValue: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.88)",
  },
  breakdownPricePair: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  breakdownListValue: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.42)",
    textDecorationLine: "line-through",
  },
  breakdownDiscountLabel: {
    fontSize: 14,
    color: "#86efac",
  },
  breakdownDiscountValue: {
    fontSize: 14,
    color: "#86efac",
    fontWeight: "600",
  },
  breakdownTotalRow: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.10)",
  },
  breakdownTotalLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.96)",
  },
  breakdownTotalValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.96)",
  },
  breakdownNote: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.45)",
    marginTop: 2,
  },
  installmentQuoteCard: {
    marginTop: 18,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    gap: 12,
  },
  installmentQuoteRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
  },
  installmentQuoteLabel: {
    flex: 1,
    fontSize: 14,
    color: "rgba(255,255,255,0.68)",
  },
  installmentQuoteAmountWrap: { alignItems: "flex-end" },
  installmentQuoteAmount: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(255,255,255,0.96)",
  },
  installmentQuoteFees: {
    fontSize: 11,
    color: "rgba(255,255,255,0.48)",
    marginTop: 2,
  },
  installmentQuoteReassurance: {
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(255,255,255,0.68)",
    marginTop: 4,
  },
  // Sticky bottom bar
  stickyBar: {
    paddingTop: 12,
    paddingHorizontal: 24,
    backgroundColor: "rgba(21, 24, 31, 0.94)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  subtotalLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.55)",
  },
  subtotalValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.96)",
    letterSpacing: -0.3,
  },
  // ORCH-1182 — the second "Due today" line for a pay-over-time cart. The accent
  // value makes the deposit the visual hero (it's the amount charged now) while
  // the all-in Total sits above as the reference figure.
  dueTodayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  dueTodayLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.72)",
  },
  dueTodayValue: {
    fontSize: 17,
    fontWeight: "700",
    color: "#eb7825",
    letterSpacing: -0.2,
  },
  terminalBody: {
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  terminalTitle: {
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 10,
  },
  terminalMessage: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 16,
    lineHeight: 24,
  },
  reviewTotals: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
  },
  reviewOldTotal: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 17,
    textDecorationLine: "line-through",
  },
  reviewNewTotal: {
    color: "rgba(255,255,255,0.96)",
    fontSize: 24,
    fontWeight: "700",
  },
  reviewBackButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  reviewBackLabel: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "600",
  },
  ctaButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaButtonDisabled: {
    opacity: 0.5,
  },
  ctaButtonPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
  // issue #2265 — spinner + phase sentence, centred as one unit.
  ctaPendingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPendingLabel: {
    marginLeft: 10,
    flexShrink: 1,
  },
});

export default TicketCartSheet;

// Suppress unused-platform-import warning if Platform stays unused after edits.
void Platform;
