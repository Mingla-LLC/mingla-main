/**
 * Issue #1793 (#1767 Phase 4) — guest ordering on BUYER WEB.
 *
 * The web half of the rail: the network, the sitting's memory, and the hosted
 * payment redirect. Same shared renderers as the consumer app, same shared wire
 * contract, same shared rules. The one genuine fork is the payment STEP — a
 * hosted redirect here, a native payment sheet there — which is a payment-rail
 * fork and not a UX one, exactly as `bookingBody` already is on this page.
 *
 * ANON-SAFE: no `useAuth`, no `isAuthReady`, no sign-in redirect. `/b/` is on
 * the public buyer-route allowlist and a diner has no account.
 *
 * THE PAYMENT STEP LIVES HERE, DELIBERATELY. SPEC #1788 P-61 SET-B says the
 * ordering renderers may sell but may never touch money, and that the payment
 * step belongs in host-owned files the gate is never pointed at. This is one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";

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

const STATUS_POLL_INTERVAL_MS = 5000;

/**
 * `window.localStorage` behind every guard there is.
 *
 * A browser in private mode throws on ACCESS, not only on write; a native build
 * of this same app has no `window` at all; and a full storage quota throws on
 * `setItem`. All three land in the same honest place — the sitting is simply not
 * remembered, and the guest is asked once more. Nothing here is load-bearing for
 * money: the sitting holds ids and tokens, and the server owns the truth.
 */
const webStorage = {
  get(key: string): string | null {
    if (Platform.OS !== "web" || typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode / quota — the sitting is simply not remembered. */
    }
  },
};

export interface BuyerVenueOrderingInput {
  brandSlug: string;
  venueSlug: string;
  /** `?spot=` off the printed QR. Null ⇒ a counter-pickup guest (D-3a). */
  spotCode: string | null;
  /** `?src=` — HOW they arrived, recorded apart from WHERE they sit. */
  entrySource: string | null;
  menu: PublicMenuGroup[];
  /** True when the guest arrived expecting to order (a code, or `src=qr`). */
  scanned: boolean;
}

export interface BuyerVenueOrdering {
  config: VenueOrderingConfig;
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

export function useBuyerVenueOrdering(
  input: BuyerVenueOrderingInput,
): BuyerVenueOrdering {
  const configQuery = useQuery({
    queryKey: [
      "venueOrderingState",
      input.brandSlug,
      input.venueSlug,
      input.spotCode,
    ],
    queryFn: () =>
      fetchVenueOrderingState({
        brandSlug: input.brandSlug,
        venueSlug: input.venueSlug,
        spotCode: input.spotCode,
      }),
    staleTime: 60_000,
  });
  const config = configQuery.data ?? VENUE_ORDERING_UNAVAILABLE;

  const menuItemIds = useMemo(
    () => input.menu.flatMap((group) => group.items.map((item) => item.id)),
    [input.menu],
  );
  const modifiersQuery = useQuery({
    queryKey: ["venueOrderingModifiers", input.venueSlug, menuItemIds.length],
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
  useEffect(() => {
    if (sittingKey === null) return;
    setSitting(parseVenueOrderSitting(webStorage.get(sittingKey), Date.now()));
  }, [sittingKey]);

  const persistSitting = useCallback(
    (next: Omit<VenueOrderSitting, "expiresAt">): void => {
      const now = Date.now();
      setSitting({ ...next, expiresAt: now + 4 * 60 * 60 * 1000 });
      if (sittingKey === null) return;
      webStorage.set(sittingKey, serialiseVenueOrderSitting(next, now));
    },
    [sittingKey],
  );

  const cart = useVenueOrderingCart({
    config,
    rememberedTip: sitting?.tip ?? null,
    initialBuyer: { name: sitting?.buyerName ?? "" },
  });

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
   * The PRICING SIGNATURE — everything that can change a number, and nothing
   * that cannot. The preview is keyed on it, so a basket edit INVALIDATES the
   * previous answer instead of leaving a stale total beside a live Pay button.
   * The failure that prevents is a guest tapping "Pay £24.50" and being charged
   * £31. The contact triple is excluded on purpose: it moves no number, and
   * including it would re-price on every keystroke.
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
    queryKey: ["venueOrderPreview", priceSignature],
    queryFn: () => previewVenueOrder(request),
    enabled: cart.state.lines.length > 0 && config.state === "on",
    staleTime: 0,
    gcTime: 0,
    retry: 0,
  });

  const previewStatus: BuyerVenueOrdering["previewStatus"] =
    cart.state.lines.length === 0
      ? "idle"
      : previewQuery.isPending || previewQuery.isFetching
      ? "loading"
      : previewQuery.isError
      ? "error"
      : previewQuery.data !== undefined
      ? "ready"
      : "loading";

  const [live, setLive] = useState<VenueOrderLiveStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** A returning guest lands on their last round rather than an empty menu. */
  useEffect(() => {
    if (sitting === null || live !== null) return;
    if (sitting.orderId === null || sitting.buyerStatusToken === null) return;
    void fetchVenueOrderStatus(sitting.orderId, sitting.buyerStatusToken).then(
      (status) => {
        if (status === null) return;
        setLive(status);
        cart.setView("status");
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitting]);

  useEffect(() => {
    if (live === null) return () => undefined;
    const settled = live.fulfillmentStatus === "delivered" ||
      live.fulfillmentStatus === "cancelled" ||
      live.fulfillmentStatus === "refunded";
    const token = sitting?.buyerStatusToken ?? null;
    if (settled || token === null) return () => undefined;
    const orderId = live.orderId;
    const handle = setInterval(() => {
      void fetchVenueOrderStatus(orderId, token).then((status) => {
        if (status !== null) setLive(status);
      });
    }, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [live, sitting?.buyerStatusToken]);

  // P-23 — one key per basket. Stable across a retry of the SAME basket (so a
  // double-tap cannot buy dinner twice) and fresh the moment the basket changes
  // (so a retry cannot hand back the previous order).
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
            "That order is already in. Refresh to see how it's doing.",
          );
          return;
        }
        // PERSISTED BEFORE THE REDIRECT, always. A hosted checkout takes the
        // guest off this page and the browser may never come back to it; the
        // sitting handle and the tokens have to survive that, or a guest who
        // reopens the venue page mid-meal starts a second sitting and is asked
        // to tip all over again.
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

        // Both providers land the guest on the ORDER'S OWN page, which is where
        // the status card lives — one return leg, whichever rail they rode.
        const url = created.hostedUrl;
        if (url === "") {
          setSubmitError("Your card wasn't charged. Try again.");
          return;
        }
        if (Platform.OS === "web" && typeof window !== "undefined") {
          // Same-tab assignment, the house pattern for every other buyer-web
          // payment surface. `Linking.openURL` on web resolves to
          // `window.open(url, "_blank", "noopener")` — a popup, after an await,
          // which is precisely the shape a popup blocker eats.
          window.location.assign(url);
          return;
        }
        await Linking.openURL(url);
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
    idempotencyKeyFor,
    persistSitting,
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
    setSubmitError(null);
    cart.setView("browse");
  }, [cart]);

  return {
    config,
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
