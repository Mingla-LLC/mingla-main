/**
 * #4490 Explorer W4 — the native checkout per venue offer (spec 06 §3 W4).
 *
 * One dark sheet on `BaseBottomSheet` (opaque on Android, §8), driven by the
 * pure reducer `payments/venueOfferCheckoutFlow.ts`; the payment leg is
 * `payments/venueOfferCheckoutRunner.ts`. Opened from a venue page pane (the
 * W3 seam, `openVenueOfferCheckout`) for Entry, Group package, Private hire,
 * By the hour and Plan, or from Purchases straight at Pay ("Pay to hold your
 * date", "Pay the rest").
 *
 * Money and security (spec 06 W4 rules): every amount on screen is the
 * server's (`quote`, the booking, the plan's own price); the user's session
 * is the only identity sent; tokens are dropped by the service; the recovery
 * pointer goes down before the payment page opens; server codes become §6
 * words. The sheet cannot be dismissed while a step or the payment page is in
 * flight; dismissed after a hold, the places stay held until the hold time
 * and then go back on sale (the server's own rule).
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import * as WebBrowser from "expo-web-browser";
import { initStripe } from "@stripe/stripe-react-native";
import { isStripeGooglePayTestEnv, useStripePaymentSheet } from "@mingla/payments-native";
import { waitForPaymentPageClosed, type AppStateLike } from "@mingla/payments-native/paymentPageReturn";
import type { VenueFeaturePlanView, VenuePlanCharge } from "@mingla/brand-rendering/venueFeaturePage";
import {
  entryDateLabel,
  holdUntilText,
  parseEntryOfferDetail,
  venueClock,
  venueOfferErrorCopy,
  type EntryOfferDetail,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import { parsePackageOfferDetail, type PackageOfferDetail } from "@mingla/brand-rendering/venueOffers/packageModel";
import { parseHireOfferDetail, type HireOfferDetail } from "@mingla/brand-rendering/venueOffers/hireModel";

import { fontWeights, radius, spacing, typography } from "../../constants/designSystem";
import { purchaseKeys } from "../../hooks/queryKeys";
import { buildApplePayCartItems } from "../../payments/applePayCartItem";
import { resolveExplorerCheckoutContact } from "../../payments/explorerCheckoutContact.mjs";
import {
  clearVenueCheckoutRecoveryFor,
  createVenueCheckoutRecoveryPointer,
  persistVenueCheckoutRecovery,
} from "../../payments/nativeCheckoutRecovery";
import {
  initialVenueCheckoutState,
  isVenueCheckoutBusy,
  resumedVenueCheckoutState,
  payLabel,
  requestSentLine,
  VENUE_CHECKOUT_COPY as COPY,
  venueCheckoutCartKey,
  venueCheckoutProgress,
  venueCheckoutUuid,
  venueOfferCheckoutReducer,
  type VenueCheckoutBookingRef,
  type VenueCheckoutKind,
  type VenueCheckoutStep,
  type VenuePayMode,
} from "../../payments/venueOfferCheckoutFlow";
import { runVenuePayment, type VenuePaymentDeps } from "../../payments/venueOfferCheckoutRunner";
import { venueOfferCheckoutService } from "../../services/venueOfferCheckoutService";
import { getVenueBooking, VenuePurchaseError } from "../../services/venuePurchaseService";
import { useAppStore } from "../../store/appStore";
import { returnToStart } from "../../hooks/useReturnToStartOnSignOut";
import { PURCHASE_SHEET_BACKGROUND, PURCHASE_SHEET_COLORS as C, PURCHASE_SHEET_HANDLE } from "../purchases/purchaseSheetTheme";
import { PURCHASE_SHEET_KEYBOARD_TOOLBAR } from "../purchases/SheetKeyboardDoneBar";
import { BaseBottomSheet, BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { venueOfferAvailabilityKeys } from "./useVenueOfferAvailability";
import { captureVenueCheckoutFinished, type VenueCheckoutOutcome } from "./venueBookAnalytics";
import {
  checkoutToday,
  Chip,
  EntryChoose,
  GroupChoose,
  HireChoose,
  HourChoose,
  Label,
  Notice,
  PlanChoose,
  venueOfferCheckoutKeys,
  type ChooseReport,
} from "./VenueCheckoutChoose";
import {
  bookingRefFrom,
  checkoutTitle,
  choiceFingerprint,
  guestBody,
  guestDetailsProblem,
  guestFingerprint,
  parseVenueReviewQuote,
  payNowMinor,
  planDueFrom,
  planRefFrom,
  planReviewRows,
  quoteBodyFor,
  resumeTitle,
  reviewRows,
  type VenueGuestDetails,
  type VenueReviewQuote,
} from "./venueCheckoutModel";
import { venueMoneyText } from "./venueMoneyText";
import {
  dropVenueCheckout,
  holdVenueCheckout,
  venueCheckoutHomeKey,
  venueCheckoutRouteFor,
  type VenueCheckoutSnapshot,
} from "./venueCheckoutResume";

/** Opened from a venue page pane. */
export interface VenueCheckoutFromVenue {
  readonly from: "venue";
  readonly kind: VenueCheckoutKind;
  readonly brandSlug: string;
  readonly venueSlug: string;
  readonly venueId: string;
  readonly venueName: string;
  /** The offer tapped (the plan for Plans). */
  readonly offerId: string | null;
  readonly plans?: readonly VenueFeaturePlanView[];
  readonly currencyCode: string;
  readonly exponent: number;
  readonly timezone: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  /** The typical-crowd curve key for the W7 when-line; null hides the crowd part. */
  readonly category: string | null;
}

/** Opened from Purchases straight at Pay. */
export interface VenueCheckoutFromPurchases {
  readonly from: "purchases";
  readonly kind: Exclude<VenueCheckoutKind, "plan">;
  readonly booking: VenueCheckoutBookingRef;
  /** The pay modes the booking allows, with the server's amounts (`payModes`); empty = the server decides (balance). */
  readonly payOptions: ReadonlyArray<{ mode: VenuePayMode; amountMinor: number }>;
  /** #4490 06-W4 fix 2 (W4-R1): the server's reason everything is due now (`fullNowReason`). */
  readonly fullNowReason?: "balance_due_passed" | "deposit_covers_total" | null;
  readonly venueId: string;
  readonly venueName: string;
  readonly currencyCode: string;
  readonly exponent: number;
  readonly timezone: string | null;
}

export type VenueCheckoutOpen = VenueCheckoutFromVenue | VenueCheckoutFromPurchases;

type ParsedOffer =
  | { kind: "group_package"; offer: PackageOfferDetail }
  | { kind: "private_hire"; offer: HireOfferDetail }
  | { kind: "entry_like"; offer: EntryOfferDetail };

export interface VenueOfferCheckoutSheetProps {
  readonly open: VenueCheckoutOpen | null;
  readonly onClose: () => void;
  /** #4490 06-W4 fix 1 (W4-N4): the checkout kept when the session ended, back after signing in again (same account). */
  readonly resume?: VenueCheckoutSnapshot | null;
}

const appStateForPage = (): AppStateLike => AppState as unknown as AppStateLike;

/** Analytics never break a payment (rule: guarded). No amount, name or email. */
function reportFinished(venueId: string, offerKind: string, outcome: VenueCheckoutOutcome): void {
  try {
    captureVenueCheckoutFinished({ venueId, offerKind, outcome });
  } catch {
    // Analytics must never change what happens to a payment.
  }
}

const OFFER_KIND_FOR: Record<VenueCheckoutKind, string> = {
  entry: "entry",
  group_package: "group_package",
  private_hire: "private_hire",
  by_the_hour: "by_the_hour",
  plan: "membership",
};

export function VenueOfferCheckoutSheet({ open, onClose, resume }: VenueOfferCheckoutSheetProps): React.ReactElement | null {
  if (open === null) return null;
  // A new session (cart key, keys, choices) per opening; a resumed one carries its own.
  return (
    <CheckoutSession
      key={open.from === "venue" ? `${open.kind}:${open.offerId}` : `pay:${open.booking.id}`}
      open={open}
      onClose={onClose}
      resume={resume !== undefined && resume !== null && venueCheckoutHomeKey(resume.open) === venueCheckoutHomeKey(open) ? resume : null}
    />
  );
}

function CheckoutSession({
  open,
  onClose,
  resume,
}: {
  open: VenueCheckoutOpen;
  onClose: () => void;
  resume: VenueCheckoutSnapshot | null;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const userId = user?.id ?? null;
  const { initPaymentSheet, presentPaymentSheet, isPaymentSheetSupported } = useStripePaymentSheet();

  const [state, dispatch] = useReducer(venueOfferCheckoutReducer, undefined, () =>
    resume !== null
      ? resumedVenueCheckoutState(resume.state)
      : initialVenueCheckoutState(
      open.kind,
      venueCheckoutCartKey(),
      open.from === "purchases"
        ? { booking: open.booking, payMode: open.payOptions.some((o) => o.mode === "deposit") ? "deposit" : null }
        : null,
    ),
  );
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const send = useCallback((a: Parameters<typeof dispatch>[0]) => {
    if (mounted.current) dispatch(a);
  }, []);

  const venueName = open.venueName;
  const money = useCallback(
    (minor: number) => venueMoneyText(minor, open.currencyCode, open.exponent),
    [open.currencyCode, open.exponent],
  );
  const today = useMemo(() => checkoutToday(new Date(), open.timezone), [open.timezone]);

  // ── the offer (four kinds) ────────────────────────────────────────────
  const offerId = open.from === "venue" && open.kind !== "plan" ? open.offerId : null;
  const offerQuery = useQuery({
    queryKey: venueOfferCheckoutKeys.offer(offerId ?? "none"),
    queryFn: () =>
      venueOfferCheckoutService.offer({
        brandSlug: (open as VenueCheckoutFromVenue).brandSlug,
        venueSlug: (open as VenueCheckoutFromVenue).venueSlug,
        offeringId: offerId as string,
      }),
    enabled: offerId !== null,
    staleTime: 60_000,
    retry: false,
  });
  const parsed = useMemo((): ParsedOffer | null => {
    const raw = offerQuery.data ?? null;
    if (raw === null) return null;
    if (open.kind === "group_package") {
      const offer = parsePackageOfferDetail(raw);
      return offer === null ? null : { kind: "group_package", offer };
    }
    if (open.kind === "private_hire") {
      const offer = parseHireOfferDetail(raw);
      return offer === null ? null : { kind: "private_hire", offer };
    }
    const offer = parseEntryOfferDetail(raw);
    return offer === null ? null : { kind: "entry_like", offer };
  }, [offerQuery.data, open.kind]);
  const detail = parsed?.offer ?? null;

  // ── the choice (step 1) and the guest ─────────────────────────────────
  const [report, setReport] = useState<ChooseReport>({ choice: resume?.choice ?? null, problem: null });
  const onReport = useCallback((r: ChooseReport) => setReport(r), []);
  useEffect(() => {
    if (report.choice !== null) send({ type: "choose", choice: choiceFingerprint(report.choice) });
  }, [report.choice, send]);

  const contact = useMemo(
    () =>
      resolveExplorerCheckoutContact({
        authUserId: user?.id,
        authEmail: user?.email,
        profileId: profile?.id,
        profileDisplayName: profile?.display_name,
        profilePhone: profile?.phone,
        profileCountry: profile?.country,
      }).normalized,
    // Seeded once per session from the signed-in profile; then the guest's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [guest, setGuest] = useState<VenueGuestDetails>(
    () => resume?.guest ?? { name: contact.name, email: contact.email, phone: contact.phone },
  );
  const [guestTouched, setGuestTouched] = useState(false);
  const guestProblem = guestDetailsProblem(guest);

  const [review, setReview] = useState<VenueReviewQuote | null>(resume?.review ?? null);
  // #4490 06-W4 fix 1 (W4-N2): a plan's amount due, as the server charges it (join answer's paymentDue).
  const [planDue, setPlanDue] = useState<VenuePlanCharge | null>(resume?.planDue ?? null);

  // #4490 06-W4 fix 1 (W4-N4): the account this sheet was opened for; when its
  // session ends the sheet keeps the checkout (in memory only) for it.
  const lastUserId = useRef<string | null>(userId);
  if (userId !== null) lastUserId.current = userId;
  // A booking held before the session ended is re-read with the new session
  // (owner path) before it can be paid: confirmed, still payable, or gone.
  const [rereading, setRereading] = useState(resume !== null && resume.state.booking !== null);
  useEffect(() => {
    if (!rereading || userId === null) return;
    const held = state.booking;
    if (held === null) {
      setRereading(false);
      return;
    }
    const read =
      state.kind === "plan"
        ? venueOfferCheckoutService.membershipGet(held.id).then((raw) => {
            const isRec = raw !== null && typeof raw === "object";
            const status = isRec && typeof (raw as { status?: unknown }).status === "string" ? (raw as { status: string }).status : null;
            if (!mounted.current) return;
            setPlanDue(planDueFrom(raw));
            send({ type: "resumed", booking: isRec ? planRefFrom({ subscriptionId: held.id, status, raw }) : null, now: Date.now() });
          })
        : venueOfferCheckoutService.get(held.id).then((raw) => {
            send({ type: "resumed", booking: bookingRefFrom(raw), now: Date.now() });
          });
    void read
      .catch((e) => {
        // Not found with the new session: the hold is gone. Anything else: Pay decides (the server checks the hold).
        if (e instanceof VenuePurchaseError && (e.code === "offer_booking_not_found" || e.code === "membership_not_found")) {
          send({ type: "resumed", booking: null, now: Date.now() });
        }
      })
      .finally(() => {
        if (mounted.current) setRereading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rereading, userId]);
  const lastRaw = useRef<unknown>(null);

  // ── #4490 06-W4 fix 2 (W4-D1; spec 06 §13 item 5): a session that ends ──
  // The checkout is kept (module memory, `venueCheckoutResume`) the MOMENT the
  // session is known to be gone: a checkout call answered "session gone"
  // (`signed_out`), or the app's account went away (signed out, or another
  // account). Kept here and not on "Sign in again" alone: the forced sign-out
  // that follows clears the cache and the venue route leaves (or used to sit
  // on "Loading venue…"), which unmounts this sheet before it can react.
  const keepNow = useRef<() => void>(() => undefined);
  keepNow.current = () => {
    const accountId = lastUserId.current;
    if (accountId === null || state.phase === "booked" || state.phase === "requested") return;
    holdVenueCheckout({
      accountId,
      route: venueCheckoutRouteFor(open),
      homeKey: venueCheckoutHomeKey(open),
      open,
      state,
      choice: report.choice,
      review,
      planDue,
      guest,
    });
  };
  const keptForLoss = useRef(false);
  const sessionEnded = useCallback(() => {
    if (keptForLoss.current) return;
    keptForLoss.current = true;
    keepNow.current();
    send({ type: "session_lost" });
  }, [send]);
  // The store's own change, synchronously (before React re-renders the tree away).
  useEffect(() => {
    const store = useAppStore as unknown as {
      subscribe?: (listener: (s: { user?: { id?: string } | null }) => void) => () => void;
    };
    if (typeof store.subscribe !== "function") return undefined;
    return store.subscribe((s) => {
      const now = s.user?.id ?? null;
      if (lastUserId.current !== null && now !== lastUserId.current) sessionEnded();
    });
  }, [sessionEnded]);
  // And on the render that sees it (a store without subscribe, or a missed change).
  useEffect(() => {
    if (userId === null && lastUserId.current !== null) sessionEnded();
  }, [sessionEnded, userId]);
  // A checkout call said the session is gone while the app still thinks it is signed in.
  useEffect(() => {
    if (state.phase === "signed_out") sessionEnded();
  }, [sessionEnded, state.phase]);

  const stepFailed = useCallback(
    (step: VenueCheckoutStep, error: unknown) => {
      const code = error instanceof VenuePurchaseError ? error.code : "venue_request_failed";
      const remaining = error instanceof VenuePurchaseError ? error.remaining : null;
      send({ type: "step_failed", step, code, venueName, selectionMessage: venueOfferErrorCopy(code, remaining) });
    },
    [send, venueName],
  );

  // ── server steps, one per entry into the step's phase ──────────────────
  useEffect(() => {
    if (state.phase !== "quoting" || report.choice === null || report.choice.kind === "plan") return;
    const key = state.keys.quote?.key;
    if (key === undefined) return;
    const choice = report.choice;
    void venueOfferCheckoutService
      .quote({ body: quoteBodyFor(choice), cartKey: state.cartKey, idempotencyKey: key })
      .then((raw) => {
        const parsed = parseVenueReviewQuote(raw);
        if (parsed === null) throw new VenuePurchaseError("venue_request_failed");
        if (!mounted.current) return;
        setReview(parsed);
        send({ type: "quote_ok", quote: parsed.ref });
        // Private hire on request: "Send request" holds at once (no payment).
        if (choice.kind === "private_hire" && parsed.mode === "request") {
          send({ type: "hold_start", freshKey: venueCheckoutUuid(), guest: guestFingerprint(guest) });
        }
      })
      .catch((e) => stepFailed("quote", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "holding" || state.quote === null) return;
    const key = state.keys.hold?.key;
    if (key === undefined) return;
    const mode = review?.mode ?? "instant";
    void venueOfferCheckoutService
      .hold({ quoteId: state.quote.quoteId, guest: guestBody(guest), cartKey: state.cartKey, idempotencyKey: key })
      .then((raw) => {
        const ref = bookingRefFrom(raw);
        if (ref === null) throw new VenuePurchaseError("venue_request_failed");
        lastRaw.current = raw;
        send({ type: "hold_ok", booking: ref, mode });
      })
      .catch((e) => stepFailed("hold", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const planChoice = report.choice?.kind === "plan" ? report.choice : null;
  const plan = open.from === "venue" ? open.plans?.find((p) => p.id === planChoice?.planId) ?? null : null;
  useEffect(() => {
    if (state.phase !== "joining" || planChoice === null || plan === null) return;
    const key = state.keys.join?.key;
    if (key === undefined) return;
    void venueOfferCheckoutService
      .membershipJoin({ planId: planChoice.planId, member: guestBody(guest), startOn: planChoice.startOn, cartKey: state.cartKey, idempotencyKey: key })
      .then((joined) => {
        const requested = plan.joinMode === "request" || joined.status === "requested";
        setPlanDue(planDueFrom(joined.raw));
        send({ type: "join_ok", booking: planRefFrom(joined), mode: requested ? "request" : "instant" });
      })
      .catch((e) => stepFailed("join", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // The payment leg: a key first (hold_ok / join_ok land here without one).
  const payRunning = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase !== "paying" || state.booking === null || userId === null) return;
    const payKey = state.keys.pay;
    if (payKey === undefined || payKey.inputs.split("|")[0] !== state.booking.id) {
      send({ type: "pay_start", freshKey: venueCheckoutUuid() });
      return;
    }
    if (payRunning.current === payKey.key) return;
    payRunning.current = payKey.key;
    const booking = state.booking;
    const target = state.kind === "plan" ? "venue_membership" : "venue_offer";
    const deps: VenuePaymentDeps = {
      server: {
        pay: (i) =>
          i.target === "venue_offer"
            ? venueOfferCheckoutService.pay({ groupId: i.id, expectedVersion: i.expectedVersion, idempotencyKey: i.idempotencyKey, payMode: i.payMode })
            : venueOfferCheckoutService.memberPay({ subscriptionId: i.id, idempotencyKey: i.idempotencyKey }),
        confirm: async (t, id) => {
          if (t === "venue_offer") {
            const a = await venueOfferCheckoutService.confirmReturn(id);
            return { outcome: a.outcome, raw: a.booking };
          }
          const a = await venueOfferCheckoutService.memberConfirm(id);
          return { outcome: a.outcome, raw: a.member };
        },
        read: (t, id) => (t === "venue_offer" ? venueOfferCheckoutService.get(id) : venueOfferCheckoutService.membershipGet(id)),
      },
      openBrowser: (url) => WebBrowser.openBrowserAsync(url),
      waitForClosed: (r) => waitForPaymentPageClosed(r, { appState: r.type === "opened" ? appStateForPage() : undefined }),
      stripe: isPaymentSheetSupported
        ? {
            init: async (s) => {
              // Connect direct charge: the SDK on THIS payment's account (useReserveTable).
              await initStripe({
                publishableKey: s.publishableKey,
                stripeAccountId: s.stripeAccountId,
                merchantIdentifier: "merchant.com.mingla.app.v2",
                urlScheme: "com.mingla.app.v2",
              });
              const r = await initPaymentSheet({
                merchantDisplayName: "Mingla",
                paymentIntentClientSecret: s.clientSecret,
                returnURL: "com.mingla.app.v2://stripe-redirect",
                applePay: {
                  merchantCountryCode: "US",
                  cartItems: buildApplePayCartItems(venueName, s.amountMinor ?? 0, "Booking"),
                },
                googlePay: {
                  merchantCountryCode: "US",
                  testEnv: isStripeGooglePayTestEnv(s.publishableKey),
                  currencyCode: (s.currencyCode ?? open.currencyCode).toLowerCase(),
                },
              });
              return { error: r.error ? { code: r.error.code } : null };
            },
            present: async () => {
              const r = await presentPaymentSheet();
              return { error: r.error ? { code: r.error.code } : null };
            },
          }
        : null,
      createPointer: createVenueCheckoutRecoveryPointer,
      persistPointer: persistVenueCheckoutRecovery,
      clearPointerFor: clearVenueCheckoutRecoveryFor,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    };
    void runVenuePayment(deps, {
      target,
      id: booking.id,
      expectedVersion: booking.version,
      idempotencyKey: payKey.key,
      payMode: state.payMode,
      accountId: userId,
      holdUntil: booking.holdUntil,
      onSession: (provider) => send({ type: "pay_ok", provider }),
      onPageClosed: () => send({ type: "payment_closed" }),
    })
      .then((result) => {
        if (result.kind === "aborted") return;
        if (result.kind === "error") {
          send({ type: "step_failed", step: "pay", code: result.code, venueName, selectionMessage: venueOfferErrorCopy(result.code) });
          return;
        }
        lastRaw.current = result.raw ?? lastRaw.current;
        send({ type: "confirm_done", outcome: result.outcome, booking: bookingRefFrom(result.raw) });
      })
      .catch((e) => stepFailed("pay", e))
      .finally(() => {
        payRunning.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.keys.pay?.key]);

  // ── endings: refresh the venue page and Purchases; one analytics event ──
  const reported = useRef(false);
  const heldOnce = useRef(false);
  if (state.booking !== null) heldOnce.current = true;
  useEffect(() => {
    const ending: VenueCheckoutOutcome | null =
      state.phase === "booked"
        ? "confirmed"
        : state.phase === "requested"
          ? "requested"
          : state.notice?.code === "payment_failed"
            ? "failed"
            : state.notice?.code === "hold_expired"
              ? "expired"
              : null;
    if (ending === null) return;
    if (ending === "confirmed" || ending === "requested") {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: venueOfferAvailabilityKeys.all });
      void queryClient.invalidateQueries({ queryKey: venueOfferCheckoutKeys.all });
    }
    if (ending === "confirmed" || ending === "requested" || !reported.current) {
      reported.current = ending === "confirmed" || ending === "requested";
      reportFinished(open.venueId, OFFER_KIND_FOR[open.kind], ending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.notice?.code]);
  useEffect(() => {
    if (state.phase === "pending") void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
  }, [queryClient, state.phase]);

  // The pass on success: the owner's live read (the same key Purchases uses).
  const passQuery = useQuery({
    queryKey: purchaseKeys.venueLive(userId ?? "none", "venue_booking", state.booking?.id ?? "none"),
    queryFn: () => getVenueBooking(state.booking?.id as string),
    enabled: state.phase === "booked" && state.kind !== "plan" && userId !== null && state.booking !== null,
    staleTime: 30_000,
    retry: false,
  });
  const qrPayload = passQuery.data?.passes[0]?.qrPayload ?? null;

  // ── actions ─────────────────────────────────────────────────────────────
  const busy = isVenueCheckoutBusy(state);
  const signedOut = userId === null || state.phase === "signed_out";
  const close = useCallback(() => {
    if (busy) return;
    // Closed instead of signing in again: the kept checkout goes too.
    if (signedOut) dropVenueCheckout();
    if (heldOnce.current && !reported.current && state.phase !== "booked" && state.phase !== "requested") {
      reported.current = true;
      reportFinished(open.venueId, OFFER_KIND_FOR[open.kind], "cancelled");
    }
    onClose();
  }, [busy, onClose, open.kind, open.venueId, signedOut, state.phase]);
  // #4490 06-W4 fix 1 (W4-N4; spec 06 §13 item 5): "Sign in again" keeps this
  // checkout in memory for the account whose session ended and goes to
  // sign-in; signing in again as that account brings the guest back here.
  //
  // #4490 06-W4 fix 2 (W4-D1): when the server said the session is gone but
  // the app still holds it (revoked elsewhere, token not yet refreshed), the
  // app signs that dead session out first (the app's own sign-out, the guest's
  // tap; the app never signs out on its own), so the root shows sign-in.
  const signInAgain = (): void => {
    const accountId = lastUserId.current;
    // Kept already when the loss was seen (the state as it was then); else now.
    if (!keptForLoss.current) {
      keptForLoss.current = true;
      keepNow.current();
    }
    onClose();
    if (accountId !== null && useAppStore.getState().user !== null) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { signOutWithPrivateCleanup } = require("../../utils/authCleanup") as typeof import("../../utils/authCleanup");
        void signOutWithPrivateCleanup("venue-checkout-session-ended", accountId);
      } catch {
        // The welcome screen still follows the next auth check.
      }
    }
    returnToStart(router);
  };
  const closeSignedOut = (): void => {
    dropVenueCheckout();
    onClose();
  };
  const seeInPurchases = useCallback(() => {
    onClose();
    router.push("/purchases" as never);
  }, [onClose, router]);

  const toReview = (): void => {
    if (report.choice === null) return;
    if (open.kind === "private_hire" || open.kind === "plan") {
      setGuestTouched(true);
      if (guestProblem !== null) return;
    }
    if (report.choice.kind === "plan") {
      send({ type: "join_start", freshKey: venueCheckoutUuid(), guest: guestFingerprint(guest) });
      return;
    }
    send({ type: "quote_start", freshKey: venueCheckoutUuid() });
  };
  const pay = (): void => {
    setGuestTouched(true);
    if (state.openedAt === "choose" && guestProblem !== null) return;
    if (state.booking !== null && state.phase !== "error") {
      send({ type: "pay_start", freshKey: venueCheckoutUuid() });
      return;
    }
    send({ type: "hold_start", freshKey: venueCheckoutUuid(), guest: guestFingerprint(guest) });
  };

  // ── what the sheet says ─────────────────────────────────────────────────
  const title =
    open.from === "purchases"
      ? resumeTitle(open.booking.state)
      : state.phase === "review" || state.phase === "holding"
        ? COPY.review
        : checkoutTitle(open.kind, venueName);
  const progress = venueCheckoutProgress(state);
  // Step 1 stays on screen while it is being priced or joined, for a plan
  // until it is joined (then Review shows the server's amount due before the
  // payment page: 06-W4 fix 1, W4-N2), and for a hire request (Send request
  // holds straight from step 1).
  const hireRequest = open.kind === "private_hire" && (review === null || review.mode === "request");
  const onChooseStep =
    open.from === "venue" &&
    (state.phase === "choosing" ||
      state.phase === "quoting" ||
      state.phase === "joining" ||
      (open.kind === "plan" && state.booking === null) ||
      (hireRequest && (state.phase === "holding" || state.phase === "error" || state.phase === "review")) ||
      (state.phase === "error" && state.failedStep === "quote"));

  const body = (): React.ReactElement => {
    if (signedOut) {
      return (
        <Center title="Sign in again to book" line="Your session ended. Everything you picked is kept, and you'll come straight back here." testID="venue-checkout-signed-out" />
      );
    }
    switch (state.phase) {
      case "paying":
      case "awaiting_payment":
      case "confirming":
        return (
          <Center
            spinner
            title={state.phase === "confirming" ? "Checking your payment" : "Waiting for your payment"}
            line={state.phase === "confirming" ? COPY.pending : "Finish on the secure payment page. We'll bring you back here."}
            testID={`venue-checkout-${state.phase}`}
          />
        );
      case "pending":
        return <Center spinner title="Almost there" line={COPY.pending} testID="venue-checkout-pending" />;
      case "requested":
        return <Center ok title="Request sent" line={requestSentLine(venueName)} testID="venue-checkout-requested" />;
      case "booked":
        return (
          <View testID="venue-checkout-booked">
            <Center ok title={state.kind === "plan" ? `Welcome to ${venueName}` : COPY.booked} line={whenLine(review, open.timezone)} />
            {qrPayload !== null ? (
              <View style={styles.qr} accessible accessibilityRole="image" accessibilityLabel="Your pass. Show this at the door." testID="venue-checkout-pass">
                <QRCode value={qrPayload} size={160} />
              </View>
            ) : passQuery.isLoading ? (
              <ActivityIndicator color={C.accent} />
            ) : null}
            <Text style={styles.caption}>Your pass is also in Purchases.</Text>
          </View>
        );
      default:
        break;
    }
    return onChooseStep ? chooseBody() : reviewBody();
  };

  const notice = state.notice !== null ? (
    <Notice text={state.notice.message} tone={state.notice.code === "payment_failed" || state.notice.code === "generic" ? "error" : "warn"} testID="venue-checkout-notice" />
  ) : null;

  const chooseBody = (): React.ReactElement => {
    if (open.from !== "venue") return <View />;
    // #4490 06-W4 fix 1 (W4-N4): the picks kept across a sign-in seed step 1.
    const kept = resume?.choice ?? null;
    const venue = { lat: open.lat, lng: open.lng, category: open.category };
    let picker: React.ReactElement | null = null;
    if (open.kind === "plan") {
      picker = (
        <PlanChoose
          plans={open.plans ?? []}
          initialPlanId={kept?.kind === "plan" ? kept.planId : open.offerId}
          initialStartOn={kept?.kind === "plan" ? kept.startOn : null}
          today={today}
          money={money}
          onReport={onReport}
        />
      );
    } else if (offerQuery.isLoading) {
      picker = <ActivityIndicator color={C.accent} style={styles.loading} testID="venue-checkout-offer-loading" />;
    } else if (detail === null) {
      picker = (
        <View testID="venue-checkout-offer-error">
          <Notice text={offerQuery.error instanceof VenuePurchaseError && offerQuery.error.code === "offline" ? COPY.offline : offerQuery.isError ? COPY.generic : COPY.empty} tone="error" />
          <SecondaryButton label={COPY.tryAgain} onPress={() => void offerQuery.refetch()} testID="venue-checkout-offer-retry" />
        </View>
      );
    } else if (parsed?.kind === "group_package") {
      picker = <GroupChoose offer={parsed.offer} today={today} money={money} venue={venue} onReport={onReport} initial={kept?.kind === "group_package" ? kept : null} />;
    } else if (parsed?.kind === "private_hire") {
      picker = <HireChoose offer={parsed.offer} today={today} money={money} onReport={onReport} initial={kept?.kind === "private_hire" ? kept : null} />;
    } else if (parsed?.kind === "entry_like" && open.kind === "by_the_hour") {
      picker = <HourChoose offer={parsed.offer} today={today} venue={venue} onReport={onReport} initial={kept?.kind === "by_the_hour" ? kept : null} />;
    } else if (parsed?.kind === "entry_like" && open.kind === "entry") {
      picker = <EntryChoose offer={parsed.offer} today={today} money={money} venue={venue} onReport={onReport} initial={kept?.kind === "entry" ? kept : null} />;
    }
    return (
      <View>
        {notice}
        {detail !== null && "canCollectOnline" in detail && detail.canCollectOnline === false ? (
          <Notice text="This venue can't take payments online right now. You can still buy at the gate." />
        ) : null}
        {picker}
        {open.kind === "private_hire" || open.kind === "plan" ? (
          <GuestFields guest={guest} onChange={setGuest} problem={guestTouched ? guestProblem : null} />
        ) : null}
        {report.problem !== null && report.choice === null && !offerQuery.isLoading ? (
          <Text style={styles.caption} testID="venue-checkout-problem">{report.problem}</Text>
        ) : null}
      </View>
    );
  };

  const reviewBody = (): React.ReactElement => {
    const loading = state.phase === "quoting";
    const rows =
      review !== null
        ? reviewRows(review, open.exponent)
        : open.kind === "plan" && planDue !== null && plan !== null
          ? planReviewRows(planDue, plan.name, open.currencyCode, open.exponent)
          : [];
    const fromPurchases = open.from === "purchases" ? open : null;
    return (
      <View testID="venue-checkout-review">
        {notice}
        {review !== null ? (
          <>
            <Label>When</Label>
            <Text style={styles.when}>{whenLine(review, open.timezone)}</Text>
          </>
        ) : null}
        <Label>Price</Label>
        <View style={styles.summary} testID="venue-checkout-summary">
          {loading ? (
            <ActivityIndicator color={C.accent} testID="venue-checkout-quote-loading" />
          ) : fromPurchases !== null ? (
            <SummaryRow label={fromPurchases.booking.state === "approved_payment_required" ? "Due now" : "Left to pay"} value={money(fromPurchases.booking.amountDueNowMinor)} total />
          ) : (
            rows.map((r) => <SummaryRow key={r.label} label={r.label} value={r.value} total={r.total === true} muted={r.muted === true} />)
          )}
        </View>
        {(fromPurchases !== null ? fromPurchases.fullNowReason ?? null : review?.fullNowReason ?? null) === "balance_due_passed" ? (
          // #4490 06-W4 fix 2 (W4-R1): the offer takes a deposit, but its balance
          // date has passed, so the server asks for everything now. Say why.
          <Text style={styles.caption} testID="venue-checkout-full-now">{COPY.fullNowClose}</Text>
        ) : null}
        {review !== null && review.ref.payModes.includes("deposit") ? (
          <>
            <Label>How to pay</Label>
            <View style={styles.row}>
              <Chip
                title={COPY.halfNow}
                note={`${money(review.depositMinor ?? 0)} today`}
                selected={(state.payMode ?? "deposit") === "deposit"}
                onPress={() => send({ type: "set_pay_mode", payMode: "deposit" })}
                testID="venue-checkout-half-now"
              />
              <Chip
                title={COPY.allNow}
                note={`${money(review.ref.totalMinor)} today`}
                selected={state.payMode === "full"}
                onPress={() => send({ type: "set_pay_mode", payMode: "full" })}
                testID="venue-checkout-all-now"
              />
            </View>
          </>
        ) : null}
        {fromPurchases !== null && fromPurchases.payOptions.length > 1 ? (
          <View style={styles.row}>
            {fromPurchases.payOptions.map((o) => (
              <Chip
                key={o.mode}
                title={o.mode === "deposit" ? COPY.halfNow : COPY.allNow}
                note={`${money(o.amountMinor)} today`}
                selected={(state.payMode ?? "full") === o.mode}
                onPress={() => send({ type: "set_pay_mode", payMode: o.mode })}
                testID={`venue-checkout-resume-${o.mode}`}
              />
            ))}
          </View>
        ) : null}
        {state.booking !== null && state.booking.holdUntil !== null && state.openedAt === "choose" ? (
          <Text style={styles.caption}>{holdUntilText(state.booking.holdUntil, open.timezone)}</Text>
        ) : null}
        {state.openedAt === "choose" && open.kind !== "private_hire" && open.kind !== "plan" ? (
          <>
            <Label>Your details</Label>
            <GuestFields guest={guest} onChange={setGuest} problem={guestTouched ? guestProblem : null} />
          </>
        ) : null}
        {review?.quote.policyText ? <Text style={styles.caption}>{review.quote.policyText}</Text> : null}
      </View>
    );
  };

  const footer = (): React.ReactElement => {
    if (signedOut) {
      return lastUserId.current === null ? (
        <PrimaryButton label="Close" onPress={onClose} testID="venue-checkout-close" />
      ) : (
        <View style={styles.footerRow}>
          <SecondaryButton label="Close" onPress={closeSignedOut} testID="venue-checkout-close" />
          <PrimaryButton label="Sign in again" onPress={signInAgain} testID="venue-checkout-sign-in" />
        </View>
      );
    }
    if (rereading) return <PrimaryButton label="Waiting" onPress={() => undefined} busy testID="venue-checkout-busy" />;
    switch (state.phase) {
      case "booked":
      case "requested":
        return (
          <View style={styles.footerRow}>
            <SecondaryButton label="Done" onPress={onClose} testID="venue-checkout-done" />
            <PrimaryButton label={COPY.seeInPurchases} onPress={seeInPurchases} testID="venue-checkout-see-purchases" />
          </View>
        );
      case "pending":
        return <PrimaryButton label={COPY.seeInPurchases} onPress={seeInPurchases} testID="venue-checkout-see-purchases" />;
      case "paying":
      case "awaiting_payment":
      case "confirming":
      case "holding":
      case "joining":
      case "quoting":
        return <PrimaryButton label="Waiting" onPress={() => undefined} busy testID="venue-checkout-busy" />;
      case "error":
        return (
          <View style={styles.footerRow}>
            {state.notice?.code === "paused" ? null : (
              <SecondaryButton label="Back" onPress={() => send({ type: state.quote !== null || state.booking !== null ? "back_to_review" : "back_to_choose" })} testID="venue-checkout-back" />
            )}
            {state.notice?.code === "paused" || state.notice?.code === "selection" || state.notice?.code === "guest" ? (
              <PrimaryButton label="Close" onPress={close} testID="venue-checkout-close" />
            ) : (
              <PrimaryButton label={COPY.tryAgain} onPress={() => send({ type: "retry", freshKey: venueCheckoutUuid() })} testID="venue-checkout-retry" />
            )}
          </View>
        );
      case "review": {
        const failed = state.notice?.code === "payment_failed";
        const due =
          open.from === "purchases"
            ? (open.payOptions.find((o) => o.mode === state.payMode)?.amountMinor ?? open.booking.amountDueNowMinor)
            : review !== null
              ? payNowMinor(review, state.payMode ?? (review.ref.payModes.includes("deposit") ? "deposit" : null))
              : state.booking?.amountDueNowMinor ?? 0;
        const label = hireRequest && open.from === "venue"
          ? COPY.sendRequest
          : failed
            ? COPY.tryAgain
            : due === 0
              ? "Get my pass"
              : payLabel(money(due));
        return (
          <View style={styles.footerRow}>
            {state.openedAt === "choose" ? (
              <SecondaryButton label="Back" onPress={() => send({ type: "back_to_choose" })} testID="venue-checkout-back" />
            ) : null}
            <PrimaryButton label={label} onPress={pay} testID="venue-checkout-pay" />
          </View>
        );
      }
      default: {
        const cta = open.kind === "private_hire" ? COPY.sendRequest : open.kind === "plan" ? (plan?.joinMode === "request" ? "Ask to join" : "Join") : COPY.review;
        return (
          <PrimaryButton
            label={cta}
            onPress={toReview}
            disabled={report.choice === null}
            testID="venue-checkout-next"
          />
        );
      }
    }
  };

  return (
    <BaseBottomSheet
      visible
      onClose={close}
      accessibilityLabel={title}
      theme="dark"
      backgroundStyle={PURCHASE_SHEET_BACKGROUND}
      handleStyle={PURCHASE_SHEET_HANDLE}
      snapPoints={["92%"]}
      enableDynamicSizing={false}
      enablePanDownToClose={!busy}
      backdropPressBehavior={busy ? "none" : "close"}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      keyboardToolbar={PURCHASE_SHEET_KEYBOARD_TOOLBAR}
      android_keyboardInputMode="adjustResize"
      scrollMode="scroll"
      scrollProps={{ keyboardDismissMode: "interactive", keyboardShouldPersistTaps: "handled" }}
      topInset={insets.top}
      restingKey={state.phase}
      stickyFooter={<View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>{footer()}</View>}
      wrapInRNModal
    >
      <View style={styles.body} testID="venue-offer-checkout-sheet">
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            <Text style={styles.venue}>{venueName}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={close}
            style={({ pressed }) => [styles.closeBtn, busy && styles.dim, pressed && styles.pressed]}
            testID="venue-checkout-x"
          >
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
        </View>
        <View style={styles.steps} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {[1, 2, 3].map((n) => (
            <View key={n} style={[styles.dash, n <= progress && styles.dashOn]} />
          ))}
        </View>
        {body()}
      </View>
    </BaseBottomSheet>
  );
}

// ─── small pieces ─────────────────────────────────────────────────────────

/** "Sat 21 Nov · 17:00" from the server's quote window, in the venue's zone. */
function whenLine(review: VenueReviewQuote | null, timeZone: string | null): string {
  const w = review?.quote.window ?? null;
  if (w === null) return "";
  const start = venueClock(w.startsAt, timeZone);
  return [w.localDate ? entryDateLabel(w.localDate) : null, start].filter(Boolean).join(" · ");
}

function GuestFields({
  guest,
  onChange,
  problem,
}: {
  guest: VenueGuestDetails;
  onChange: (g: VenueGuestDetails) => void;
  problem: { field: "name" | "email" | "phone"; message: string } | null;
}): React.ReactElement {
  const field = (key: keyof VenueGuestDetails, label: string, extra: Record<string, unknown>) => (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <BottomSheetTextInput
        value={guest[key]}
        onChangeText={(v: string) => onChange({ ...guest, [key]: v })}
        style={[styles.field, problem?.field === key && styles.fieldBad]}
        placeholderTextColor={C.placeholder}
        accessibilityLabel={label}
        testID={`venue-checkout-guest-${key}`}
        {...extra}
      />
    </View>
  );
  return (
    <View testID="venue-checkout-guest">
      {field("name", "Name", { autoComplete: "name", textContentType: "name" })}
      {field("email", "Email", { autoComplete: "email", keyboardType: "email-address", autoCapitalize: "none", textContentType: "emailAddress" })}
      {field("phone", "Phone (optional)", { autoComplete: "tel", keyboardType: "phone-pad", textContentType: "telephoneNumber" })}
      {problem !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="venue-checkout-guest-problem">
          {problem.message}
        </Text>
      ) : null}
    </View>
  );
}

function SummaryRow({ label, value, total, muted }: { label: string; value: string; total?: boolean; muted?: boolean }): React.ReactElement {
  return (
    <View style={styles.sumRow}>
      <Text style={[styles.sumLabel, total === true && styles.sumTotal, muted === true && styles.muted]}>{label}</Text>
      <Text style={[styles.sumValue, total === true && styles.sumTotal, muted === true && styles.muted]}>{value}</Text>
    </View>
  );
}

function Center({ title, line, ok, spinner, testID }: { title: string; line: string; ok?: boolean; spinner?: boolean; testID?: string }): React.ReactElement {
  return (
    <View style={styles.center} testID={testID} accessibilityLiveRegion="polite">
      <View style={[styles.badge, ok === true && styles.badgeOk]}>
        {spinner === true ? <ActivityIndicator color={C.text} /> : <Text style={styles.badgeGlyph}>{ok === true ? "✓" : "!"}</Text>}
      </View>
      <Text style={styles.centerTitle}>{title}</Text>
      {line.length > 0 ? <Text style={styles.centerLine}>{line}</Text> : null}
    </View>
  );
}

function PrimaryButton({ label, onPress, busy, disabled, testID }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; testID: string }): React.ReactElement {
  const off = busy === true || disabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: busy === true, disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.primary, disabled === true && styles.dim, pressed && styles.pressed]}
      testID={testID}
    >
      {busy === true ? <ActivityIndicator color={C.text} /> : null}
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }): React.ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} testID={testID}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg - spacing.xxs, paddingBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md - spacing.xs },
  headerText: { flex: 1, gap: spacing.xxs },
  title: { ...typography.lg, fontWeight: fontWeights.bold, color: C.text },
  venue: { ...typography.sm, color: C.textSecondary },
  closeBtn: { width: 44, height: 44, borderRadius: radius.full, backgroundColor: C.tabSelected, alignItems: "center", justifyContent: "center" },
  closeGlyph: { ...typography.lg, color: C.text },
  steps: { flexDirection: "row", gap: spacing.xs + spacing.xxs, marginTop: spacing.md - spacing.xs, marginBottom: spacing.xxs },
  dash: { flex: 1, height: 3, borderRadius: radius.sm, backgroundColor: C.border },
  dashOn: { backgroundColor: C.accent },
  loading: { marginVertical: spacing.lg },
  caption: { ...typography.sm, color: C.textSecondary, marginTop: spacing.md - spacing.xs },
  when: { ...typography.md, fontWeight: fontWeights.semibold, color: C.text },
  row: { flexDirection: "row", gap: spacing.sm },
  summary: { borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: spacing.md - spacing.xxs, paddingVertical: spacing.xs + spacing.xxs, minHeight: 48, justifyContent: "center" },
  sumRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md - spacing.xs, paddingVertical: spacing.sm },
  sumLabel: { ...typography.sm, color: C.textSecondary, flex: 1 },
  sumValue: { ...typography.sm, fontWeight: fontWeights.semibold, color: C.text },
  sumTotal: { ...typography.md, fontWeight: fontWeights.bold, color: C.text },
  muted: { ...typography.xs, color: C.textMeta },
  fieldWrap: { marginTop: spacing.sm },
  fieldLabel: { ...typography.xs, fontWeight: fontWeights.semibold, color: C.textLabel, marginBottom: spacing.xs },
  field: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, backgroundColor: C.field, color: C.text, paddingHorizontal: spacing.md - spacing.xxs, ...typography.md },
  fieldBad: { borderColor: C.error },
  error: { ...typography.sm, color: C.error, marginTop: spacing.sm },
  qr: { alignSelf: "center", padding: spacing.sm + spacing.xxs, backgroundColor: C.text, borderRadius: radius.lg, marginTop: spacing.sm },
  center: { alignItems: "center", paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs + spacing.xxs },
  badge: { width: 72, height: 72, borderRadius: radius.full, backgroundColor: C.tabSelected, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  badgeOk: { backgroundColor: C.successTint },
  badgeGlyph: { ...typography.xl, fontWeight: fontWeights.bold, color: C.success },
  centerTitle: { ...typography.xl, fontWeight: fontWeights.bold, color: C.text, textAlign: "center" },
  centerLine: { ...typography.sm, color: C.textSecondary, textAlign: "center", maxWidth: 300 },
  footer: { paddingHorizontal: spacing.lg - spacing.xxs, paddingTop: spacing.md - spacing.xs, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.sheet },
  footerRow: { flexDirection: "row", gap: spacing.md - spacing.xs - spacing.xxs },
  primary: { flex: 1, minHeight: 52, borderRadius: radius.md, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md },
  primaryText: { ...typography.md, fontWeight: fontWeights.bold, color: C.text },
  secondary: { minHeight: 52, borderRadius: radius.md, backgroundColor: C.tabSelected, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  secondaryText: { ...typography.md, fontWeight: fontWeights.semibold, color: C.text },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
