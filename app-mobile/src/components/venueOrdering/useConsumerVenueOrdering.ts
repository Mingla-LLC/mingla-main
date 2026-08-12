/**
 * Issue #1793 (#1767 Phase 4) — guest ordering on the CONSUMER app.
 *
 * This hook is the app's half of the rail: the network, the sitting's memory,
 * and the native payment step. Every pixel it feeds comes from the shared
 * renderers under `@mingla/brand-rendering/venueOrdering`, and every money
 * number it holds arrived from `venue-order-create`. It computes none of them.
 *
 * ANON-SAFE. No `useAuth`, no sign-in, no gate. A diner has no account, and the
 * whole rail is anon-capable by contract. A signed-in user's Bearer rides along
 * through the shared client and becomes `buyer_user_id`; that is the only
 * difference between the two, and it is invisible.
 *
 * THE PAYMENT STEP LIVES HERE, DELIBERATELY. SPEC #1788 P-61 SET-B says the
 * ordering renderers may sell but may never touch money — no provider SDK, no
 * payment-sheet name, no fee arithmetic — and that the payment step belongs in
 * separately-named host components the gate is never pointed at. This is that
 * component. The wiring below mirrors `useReserveTable` exactly (the connected-
 * account re-init, the wallet config, the cancel branch), because a second,
 * subtly different payment integration is how one of them silently stops
 * rendering Apple Pay.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStripePaymentSheet } from "@mingla/payments-native";
import type { PaymentSheetInitInput } from "@mingla/payments-native";
import { initStripe } from "@stripe/stripe-react-native";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type VenueOrderingCartApi,
  type VenueOrderingConfig,
  type VenueOrderLiveStatus,
  type VenueOrderModifierGroup,
  type VenueOrderPreview,
  type VenueOrderSitting,
  parseVenueOrderSitting,
  serialiseVenueOrderSitting,
  useVenueOrderingCart,
  venueOrderShouldAskPartySize,
  venueOrderSittingKey,
  venueOrderingQueryKeys,
} from "@mingla/brand-rendering/venueOrdering";
import { VENUE_ORDERING_UNAVAILABLE } from "@mingla/brand-rendering/venueOrdering/venueOrderingWire";
import type { PublicMenuGroup } from "@mingla/brand-rendering";

import {
  createVenueOrder,
  fetchVenueMenuModifiers,
  fetchVenueOrderStatus,
  fetchVenueOrderingState,
  previewVenueOrder,
  type VenueOrderRequest,
  VenueOrderError,
  venueOrderGuestAction,
} from "../../services/venueOrderingService";
import { buildApplePayCartItems } from "../../payments/applePayCartItem";

const MERCHANT_DISPLAY_NAME = "Mingla";
const MERCHANT_IDENTIFIER = "merchant.com.mingla.app.v2";
const URL_SCHEME = "com.mingla.app.v2";
const RETURN_URL = `${URL_SCHEME}://stripe-redirect`;
/**
 * The in-app browser's interception sentinel for the NG rail. It matches the
 * `callbackUrl` `venue-order-create` hands the provider, so the browser closes
 * the instant the guest is sent back and the page itself is never fetched on
 * native. The webhook remains the truth; the poll below is what waits for it.
 */
const NG_RETURN_PREFIX = "https://business.usemingla.com/o/venue/";
const STATUS_POLL_INTERVAL_MS = 4000;
const SETTLE_POLL_INTERVAL_MS = 1500;
const SETTLE_POLL_MAX_ATTEMPTS = 17;

const isGooglePayTestEnv = (): boolean =>
  process.env.EAS_BUILD_PROFILE !== "production";

export interface ConsumerVenueOrderingInput {
  brandSlug: string;
  venueSlug: string;
  /** `?spot=` off the printed QR. Null ⇒ a counter-pickup guest (D-3a). */
  spotCode: string | null;
  /** `?src=` — HOW they arrived, recorded apart from WHERE they sit (D-3a). */
  entrySource: string | null;
  menu: PublicMenuGroup[];
  /** True when the guest arrived expecting to order (a code, or src=qr). */
  scanned: boolean;
}

export interface ConsumerVenueOrdering {
  config: VenueOrderingConfig;
  configReady: boolean;
  scanned: boolean;
  modifiersByItemId: Record<string, VenueOrderModifierGroup[]>;
  cart: VenueOrderingCartApi;
  preview: VenueOrderPreview | null;
  previewStatus: "idle" | "loading" | "ready" | "error";
  previewError: string | null;
  submitting: boolean;
  submitError: string | null;
  submit: () => void;
  live: VenueOrderLiveStatus | null;
  actionPending: boolean;
  actionError: string | null;
  cancelOrder: () => void;
  requestRefund: () => void;
  orderMore: () => void;
  askPartySize: boolean;
  tipRemembered: boolean;
}

export function useConsumerVenueOrdering(
  input: ConsumerVenueOrderingInput,
): ConsumerVenueOrdering {
  const { initPaymentSheet, presentPaymentSheet, isPaymentSheetSupported } =
    useStripePaymentSheet();

  // ── the honest public state (this issue's migration) ──────────────────────
  const configQuery = useQuery({
    queryKey: venueOrderingQueryKeys.state(
      input.brandSlug,
      input.venueSlug,
      input.spotCode,
    ),
    queryFn: () =>
      fetchVenueOrderingState({
        brandSlug: input.brandSlug,
        venueSlug: input.venueSlug,
        spotCode: input.spotCode,
      }),
    staleTime: 60_000,
  });
  // ONE owner for "we could not resolve this venue's ordering", shared with
  // buyer web: an unresolved state renders no ordering affordance and makes no
  // claim, which is the page exactly as it was before Phase 4.
  const config: VenueOrderingConfig = configQuery.data ?? VENUE_ORDERING_UNAVAILABLE;

  const menuItemIds = useMemo(
    () => input.menu.flatMap((group) => group.items.map((item) => item.id)),
    [input.menu],
  );
  const modifiersQuery = useQuery({
    queryKey: venueOrderingQueryKeys.modifiers(input.venueSlug, menuItemIds),
    queryFn: () => fetchVenueMenuModifiers(menuItemIds),
    enabled: config.state === "on" && menuItemIds.length > 0,
    staleTime: 300_000,
  });

  // ── the SITTING: ids and tokens only, expiring. Never a server record. ────
  const sittingKey = venueOrderSittingKey({
    venueId: config.venueId,
    spotCode: input.spotCode,
  });
  const [sitting, setSitting] = useState<VenueOrderSitting | null>(null);
  const [sittingLoaded, setSittingLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (sittingKey === null) {
      setSittingLoaded(true);
      return () => undefined;
    }
    void AsyncStorage.getItem(sittingKey)
      .then((raw) => {
        if (cancelled) return;
        setSitting(parseVenueOrderSitting(raw, Date.now()));
        setSittingLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSittingLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sittingKey]);

  const persistSitting = useCallback(
    (next: Omit<VenueOrderSitting, "expiresAt">): void => {
      const now = Date.now();
      setSitting({ ...next, expiresAt: now + 4 * 60 * 60 * 1000 });
      if (sittingKey === null) return;
      void AsyncStorage.setItem(
        sittingKey,
        serialiseVenueOrderSitting(next, now),
      ).catch(() => undefined);
    },
    [sittingKey],
  );

  const cart = useVenueOrderingCart({
    config,
    rememberedTip: sitting?.tip ?? null,
    initialBuyer: { name: sitting?.buyerName ?? "" },
  });

  // ── the request. ONE shape, priced by the server and charged by the server.
  const request: VenueOrderRequest = useMemo(
    () => ({
      spotCode: config.spotState === "ok" ? input.spotCode : null,
      venueId: config.venueId,
      sessionId: sitting?.sessionId ?? null,
      lines: cart.state.lines,
      buyer: cart.state.buyer,
      partySizeClaimed: cart.state.partySize,
      tipBps: cart.state.tip.bps,
      tipFlatCents: cart.state.tip.flatCents,
      entrySource: input.entrySource,
    }),
    [
      cart.state.buyer,
      cart.state.lines,
      cart.state.partySize,
      cart.state.tip.bps,
      cart.state.tip.flatCents,
      config.spotState,
      config.venueId,
      input.entrySource,
      input.spotCode,
      sitting?.sessionId,
    ],
  );

  /**
   * The PRICING SIGNATURE — everything that can change a number.
   *
   * The preview is keyed on it, so a basket edit invalidates the previous
   * answer INSTEAD of leaving a stale total on screen next to a live Pay
   * button. That is the whole reason the key is granular: the failure it
   * prevents is a guest tapping "Pay £24.50" and being charged £31.
   *
   * The contact triple is NOT in it — those change no number, and re-pricing on
   * every keystroke in the name field would be a request per character.
   */
  const priceSignature = useMemo(
    () =>
      JSON.stringify({
        lines: cart.state.lines.map((line) => ({
          i: line.menuItemId,
          q: line.quantity,
          m: [...line.modifierIds].sort(),
        })),
        tip: cart.state.tip,
        spot: config.spotState === "ok" ? input.spotCode : null,
        venue: config.venueId,
      }),
    [
      cart.state.lines,
      cart.state.tip,
      config.spotState,
      config.venueId,
      input.spotCode,
    ],
  );

  const previewQuery = useQuery({
    queryKey: venueOrderingQueryKeys.preview(priceSignature),
    queryFn: () => previewVenueOrder(request),
    enabled: cart.state.lines.length > 0 && config.state === "on",
    // A price is a claim about right now. Never served from cache to a
    // different basket, and never retried into a silent stale answer.
    staleTime: 0,
    gcTime: 0,
    retry: 0,
  });

  const previewStatus: ConsumerVenueOrdering["previewStatus"] =
    cart.state.lines.length === 0
      ? "idle"
      : previewQuery.isPending || previewQuery.isFetching
      ? "loading"
      : previewQuery.isError
      ? "error"
      : previewQuery.data !== undefined
      ? "ready"
      : "loading";

  // ── the live order ────────────────────────────────────────────────────────
  const [live, setLive] = useState<VenueOrderLiveStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * OQ-2, made real across an ASYNC read. The sitting resolves at least one
   * render after the cart reducer was seeded, so the remembered tip has to be
   * applied when it lands — and applied only to what the guest has not already
   * answered. Without this a table's second round shows an unselected tip row
   * under a heading that says the answer is remembered, which is the surface
   * contradicting itself even though the SERVER still charges the right tip.
   */
  useEffect(() => {
    if (sitting === null) return;
    cart.hydrateSitting(sitting.tip, sitting.buyerName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitting?.sessionId, sitting?.tip.bps, sitting?.tip.flatCents]);

  /** A returning guest lands on their last round rather than an empty menu. */
  useEffect(() => {
    if (!sittingLoaded || sitting === null) return;
    if (sitting.orderId === null || sitting.buyerStatusToken === null) return;
    if (live !== null) return;
    void fetchVenueOrderStatus(sitting.orderId, sitting.buyerStatusToken).then(
      (status) => {
        if (status === null) return;
        setLive(status);
        cart.setView("status");
      },
    );
    // Runs once per resolved sitting; `cart` identity is stable enough for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitting, sittingLoaded]);

  /** While an order is unserved its card updates itself. */
  useEffect(() => {
    if (live === null) return () => undefined;
    const settled = live.fulfillmentStatus === "delivered" ||
      live.fulfillmentStatus === "cancelled" ||
      live.fulfillmentStatus === "refunded";
    if (settled) return () => undefined;
    const orderId = live.orderId;
    const token = sitting?.buyerStatusToken ?? null;
    if (token === null) return () => undefined;
    const handle = setInterval(() => {
      void fetchVenueOrderStatus(orderId, token).then((status) => {
        if (status !== null) setLive(status);
      });
    }, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [live, sitting?.buyerStatusToken]);

  const pollUntilPaid = useCallback(
    async (orderId: string, token: string): Promise<void> => {
      for (let attempt = 0; attempt < SETTLE_POLL_MAX_ATTEMPTS; attempt++) {
        const status = await fetchVenueOrderStatus(orderId, token);
        if (status !== null) {
          setLive(status);
          if (status.paymentStatus !== "pending") return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, SETTLE_POLL_INTERVAL_MS)
        );
      }
    },
    [],
  );

  // P-23 — a per-tap idempotency key that survives a retry of THE SAME basket
  // and changes the moment the basket does. A key reused across a changed
  // basket would hand the guest back their previous order; a fresh key on every
  // tap of the same basket would let a double-tap buy dinner twice.
  const keyRef = useRef<{ signature: string; key: string } | null>(null);
  const idempotencyKeyFor = useCallback((signature: string): string => {
    if (keyRef.current !== null && keyRef.current.signature === signature) {
      return keyRef.current.key;
    }
    const key = `vo-${Date.now().toString(36)}-${
      Math.random().toString(36).slice(2, 12)
    }`;
    keyRef.current = { signature, key };
    return key;
  }, []);

  const submit = useCallback((): void => {
    if (submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    void (async () => {
      try {
        const created = await createVenueOrder(
          request,
          idempotencyKeyFor(priceSignature),
        );
        if (created.kind === "already_created") {
          setSubmitError(
            "That order is already in. Pull down to see how it's doing.",
          );
          return;
        }
        persistSitting({
          sessionId: created.sessionId,
          orderId: created.orderId,
          buyerStatusToken: created.buyerStatusToken,
          guestCancelToken: created.guestCancelToken,
          tip: cart.state.tip,
          partySizeClaimed: cart.state.partySize,
          buyerName: cart.state.buyer.name.trim(),
        });

        if (created.kind === "free_completed") {
          cart.roundSettled();
          const status = await fetchVenueOrderStatus(
            created.orderId,
            created.buyerStatusToken,
          );
          if (status !== null) setLive(status);
          return;
        }

        if (created.kind === "requires_paystack_redirect") {
          cart.roundSettled();
          try {
            await WebBrowser.openAuthSessionAsync(
              created.authorizationUrl,
              NG_RETURN_PREFIX,
            );
          } catch {
            // The guest may have paid before the browser errored. The webhook is
            // the truth either way, so poll regardless rather than declaring a
            // failure we cannot prove.
          }
          await pollUntilPaid(created.orderId, created.buyerStatusToken);
          return;
        }

        if (created.kind === "requires_web_redirect") {
          setSubmitError("Something went wrong. Nothing has been charged.");
          return;
        }

        // ── the native payment sheet ───────────────────────────────────────
        if (!isPaymentSheetSupported) {
          setSubmitError(
            "Card payment isn't available on this device. Nothing has been charged.",
          );
          return;
        }
        // Connect direct charge: the SDK is re-initialised for THIS order's
        // connected account, or the confirm hits the platform context and the
        // connected-account secret is rejected (ORCH-0844).
        if (created.publishableKey !== "" && created.connectedAccountId !== null) {
          await initStripe({
            publishableKey: created.publishableKey,
            stripeAccountId: created.connectedAccountId,
            merchantIdentifier: MERCHANT_IDENTIFIER,
            urlScheme: URL_SCHEME,
          });
        }
        const walletConfig: Pick<
          PaymentSheetInitInput,
          "applePay" | "googlePay"
        > = {
          applePay: {
            merchantCountryCode: "US",
            cartItems: buildApplePayCartItems(
              config.venueName,
              created.totalCents,
              "Order",
            ),
          },
          googlePay: {
            merchantCountryCode: "US",
            testEnv: isGooglePayTestEnv(),
            currencyCode: created.currency.toLowerCase(),
          },
        };
        const initResult = await initPaymentSheet({
          merchantDisplayName: MERCHANT_DISPLAY_NAME,
          paymentIntentClientSecret: created.clientSecret,
          returnURL: RETURN_URL,
          ...walletConfig,
        });
        if (initResult.error) {
          setSubmitError(
            initResult.error.localizedMessage ?? initResult.error.message ??
              "Your card wasn't charged. Try again.",
          );
          return;
        }
        const presentResult = await presentPaymentSheet();
        if (presentResult.error) {
          if (presentResult.error.code !== "Canceled") {
            setSubmitError(
              presentResult.error.localizedMessage ??
                presentResult.error.message ??
                "Your card wasn't charged. Try again.",
            );
          }
          // A cancel is not a failure and says nothing: the basket is still
          // there and the guest can tap Pay again.
          return;
        }
        cart.roundSettled();
        await pollUntilPaid(created.orderId, created.buyerStatusToken);
      } catch (error) {
        setSubmitError(
          error instanceof VenueOrderError
            ? error.message
            : "Something went wrong. Nothing has been charged.",
        );
      } finally {
        setSubmitting(false);
      }
    })();
  }, [
    cart,
    config.venueName,
    idempotencyKeyFor,
    initPaymentSheet,
    isPaymentSheetSupported,
    persistSitting,
    pollUntilPaid,
    presentPaymentSheet,
    priceSignature,
    request,
    submitting,
  ]);

  const guestAction = useCallback(
    (action: "cancel" | "request_refund"): void => {
      const orderId = live?.orderId ?? null;
      const token = sitting?.guestCancelToken ?? null;
      if (orderId === null || token === null) return;
      setActionError(null);
      setActionPending(true);
      void venueOrderGuestAction({ orderId, guestCancelToken: token, action })
        .then(async () => {
          const status = await fetchVenueOrderStatus(
            orderId,
            sitting?.buyerStatusToken ?? "",
          );
          if (status !== null) setLive(status);
        })
        .catch((error: unknown) => {
          setActionError(
            error instanceof VenueOrderError
              ? error.message
              : "That didn't go through. Try again.",
          );
        })
        .finally(() => setActionPending(false));
    },
    [live?.orderId, sitting?.buyerStatusToken, sitting?.guestCancelToken],
  );

  const orderMore = useCallback((): void => {
    // Another round on the SAME sitting. The tip is NOT re-asked (OQ-2) — the
    // session already carries it — and the party size is not asked again either.
    setSubmitError(null);
    cart.setView("browse");
  }, [cart]);

  return {
    config,
    configReady: configQuery.isSuccess,
    scanned: input.scanned,
    modifiersByItemId: modifiersQuery.data ?? {},
    cart,
    preview: previewQuery.data ?? null,
    previewStatus,
    previewError: previewQuery.error instanceof VenueOrderError
      ? previewQuery.error.message
      : previewQuery.isError
      ? "We couldn't price that order. Nothing has been charged."
      : null,
    submitting,
    submitError,
    submit,
    live,
    actionPending,
    actionError,
    cancelOrder: () => guestAction("cancel"),
    requestRefund: () => guestAction("request_refund"),
    orderMore,
    askPartySize: venueOrderShouldAskPartySize(sitting),
    tipRemembered: sitting !== null,
  };
}
