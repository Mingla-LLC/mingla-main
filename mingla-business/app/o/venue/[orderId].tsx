/**
 * `/o/venue/[orderId]` — Issue #1793 (#1767 Phase 4): the guest's order, after
 * they have paid for it.
 *
 * ANON-TOLERANT, and it has to be: a diner has no account. The route sits
 * outside `(tabs)/`, calls NO auth hook, imports no AuthContext, and never
 * redirects to sign-in. `/o/` is already on `PUBLIC_BUYER_ROUTE_PREFIXES`
 * (`coldLoadAuthGates.ts`), so the root gate lets a logged-out visitor through
 * without any change to that frozen list — the nesting under `/o/` was chosen
 * partly for that reason. Authorisation is by POSSESSION: `?bst=` is the
 * plaintext buyer status token, hash-matched server-side by
 * `venue-order-status` (P-24), which returns 403 on a mismatch and 404 on an id
 * it does not know.
 *
 * IT IS THE LANDING FOR BOTH PROVIDER RAILS. The hosted-checkout `success_url`
 * and the NG redirect both point here now (Phase 2 pointed the NG arm at
 * `/pay/callback`, which no route in this app serves — the SPA catch-all
 * rewrites it to the shell, the client router matches nothing, and a guest who
 * had just paid landed on "Hmm, that's not a real page" with their token
 * thrown away in a query string). One landing surface, whichever rail they rode.
 *
 * The card polls, because the WEBHOOK is the truth and a redirect is only a
 * hint. Until it lands the page says it is confirming — never that the payment
 * failed, and never that it succeeded.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createThemePalette,
  offeringSurfaceStyles,
  resolveTheme,
} from "@mingla/offering-rendering";
import type { VenueOrderLiveStatus } from "@mingla/brand-rendering/venueOrdering";

/**
 * The status card, and the transport it needs, behind a LAZY boundary — and
 * pointed at the SAME module the venue page's ordering surface uses.
 *
 * Two routes importing one status card from two modules is a module two chunks
 * share, and Metro hoists anything two chunks share into `__common` — the
 * payload every visitor downloads before anything renders, ordering venue or
 * not. Measured at +31 KB before this was collapsed, against a 12 KB per-PR
 * allowance (ORCH-1083). One module, one async chunk, downloaded only by
 * someone who has actually ordered something.
 */
const LazyOrderStatusView = React.lazy(() =>
  import("../../../src/components/venueOrdering/BuyerVenueOrderingSlots")
    .then((module) => ({ default: module.BuyerVenueOrderStatusView })),
);
const orderingTransport = () =>
  import("../../../src/services/venueOrderingService");

/** The webhook is the truth; this is how long the page waits politely for it. */
const POLL_INTERVAL_MS = 3000;

export default function BuyerVenueOrderRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    orderId?: string | string[];
    bst?: string | string[];
  }>();
  const orderId = Array.isArray(params.orderId)
    ? params.orderId[0]
    : params.orderId;
  const rawToken = Array.isArray(params.bst) ? params.bst[0] : params.bst;
  const token = typeof rawToken === "string" ? rawToken : "";

  const [live, setLive] = useState<VenueOrderLiveStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const theme = useMemo(() => resolveTheme(null, null), []);
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);

  const refresh = useCallback(async (): Promise<VenueOrderLiveStatus | null> => {
    if (typeof orderId !== "string" || token === "") return null;
    const { fetchVenueOrderStatus } = await orderingTransport();
    const status = await fetchVenueOrderStatus(orderId, token);
    if (status !== null) setLive(status);
    setLoaded(true);
    return status;
  }, [orderId, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (live === null) return () => undefined;
    const settled = live.paymentStatus !== "pending" &&
      (live.fulfillmentStatus === "delivered" ||
        live.fulfillmentStatus === "cancelled" ||
        live.fulfillmentStatus === "refunded");
    if (settled) return () => undefined;
    const handle = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [live, refresh]);

  /**
   * D-7a — the guest's way out, on this surface too.
   *
   * The cancel token is NOT in the URL: the redirect carries only the read
   * token, so a link a guest forwards to a friend can show the order and can
   * never refund it. A guest on their own device still holds the cancel token
   * in the sitting the venue page wrote before it sent them off to pay; this
   * page reads it from the same place.
   */
  const cancelToken = useMemo((): string | null => {
    if (Platform.OS !== "web" || typeof window === "undefined") return null;
    try {
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key === null || !key.startsWith("mingla.venueOrderSitting.")) {
          continue;
        }
        const raw = window.localStorage.getItem(key);
        if (raw === null) continue;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.orderId === orderId &&
          typeof parsed.guestCancelToken === "string") {
          return parsed.guestCancelToken;
        }
      }
    } catch {
      return null;
    }
    return null;
  }, [orderId]);

  const guestAction = useCallback(
    (action: "cancel" | "request_refund"): void => {
      if (typeof orderId !== "string" || cancelToken === null) {
        setActionError(
          "Open this from the device you ordered on, or ask a member of staff.",
        );
        return;
      }
      setActionError(null);
      setActionPending(true);
      void orderingTransport()
        .then(({ venueOrderGuestAction }) =>
          venueOrderGuestAction({
            orderId,
            guestCancelToken: cancelToken,
            action,
          })
        )
        .then(() => refresh())
        .catch((error: unknown) => {
          // The rail's own failures already carry the exact sentence a guest
          // should read (P-29); anything else gets an honest generic.
          const message = error instanceof Error && error.name === "VenueOrderError"
            ? error.message
            : "That didn't go through. Try again.";
          setActionError(message);
        })
        .finally(() => setActionPending(false));
    },
    [cancelToken, orderId, refresh],
  );

  const body = (): React.ReactElement => {
    if (typeof orderId !== "string" || token === "") {
      return (
        <StateCard
          palette={palette}
          title="We can't open this order"
          note="Use the link from your receipt, or ask a member of staff."
        />
      );
    }
    if (!loaded) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={[styles.loadingText, { color: palette.secondaryText }]}>
            Fetching your order…
          </Text>
        </View>
      );
    }
    if (live === null) {
      return (
        <StateCard
          palette={palette}
          title="We can't open this order"
          note="The link may have expired. Ask a member of staff and they'll sort you out."
        />
      );
    }
    return (
      <React.Suspense
        fallback={
          <View style={styles.loading}>
            <ActivityIndicator />
          </View>
        }
      >
        <LazyOrderStatusView
          palette={palette}
          surface={surface}
          live={live}
          actionPending={actionPending}
          actionError={actionError}
          onCancel={() => guestAction("cancel")}
          onRequestRefund={() => guestAction("request_refund")}
        />
      </React.Suspense>
    );
  };

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <Text style={[styles.heading, { color: palette.primaryText }]}>
          Your order
        </Text>
        {body()}
        <Pressable
          onPress={() => router.replace("/")}
          accessibilityRole="button"
          accessibilityLabel="Back to Mingla"
          style={styles.homeBtn}
        >
          <Text style={[styles.homeLabel, { color: palette.accent }]}>
            Back to Mingla
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const StateCard: React.FC<{
  palette: ReturnType<typeof createThemePalette>;
  title: string;
  note: string;
}> = ({ palette, title, note }) => (
  <View style={styles.stateCard}>
    <Text style={[styles.stateTitle, { color: palette.primaryText }]}>
      {title}
    </Text>
    <Text style={[styles.stateNote, { color: palette.secondaryText }]}>
      {note}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  host: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    gap: 16,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  heading: { fontSize: 24, lineHeight: 30, fontWeight: "900" },
  loading: { alignItems: "center", gap: 12, paddingVertical: 56 },
  loadingText: { fontSize: 15 },
  stateCard: { gap: 8, paddingVertical: 24 },
  stateTitle: { fontSize: 18, lineHeight: 24, fontWeight: "800" },
  stateNote: { fontSize: 15, lineHeight: 21 },
  homeBtn: { minHeight: 44, justifyContent: "center" },
  homeLabel: { fontSize: 15, fontWeight: "800" },
});
