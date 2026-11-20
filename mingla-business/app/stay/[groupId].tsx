// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StayReservationDetail } from "@mingla/brand-rendering/StayReservationDetail";
import {
  type StayPaymentSession,
} from "@mingla/brand-rendering/stayGuest";
import { formatStayMoney } from "@mingla/brand-rendering/stayGuestMoney";
import {
  createThemePalette,
  resolveTheme,
} from "@mingla/offering-rendering";

import { captureWeb } from "../../src/analytics/webAnalytics";
import {
  captureBuyerWebPublicPageViewed,
  resolveBuyerWebPublicLifecycle,
} from "../../src/analytics/publicParityWebAdapter";
import { StayStripePayment } from "../../src/components/stay/StayStripePayment";
import { useStayReservationGroup } from "../../src/hooks/useStayGuest";
import { VenueClaimCard, parseVenueHandoff } from "../../src/components/venue/offers/VenueAppHandoff";
import { StayGuestError, stayGuestService } from "../../src/services/stayGuestService";
import { StayOtherContactNotice } from "../../src/components/stay/StayOtherContactNotice";
import { SecurePaymentHandoff } from "../../src/components/offering/LazyPublicParts";
import { useAuth } from "../../src/context/AuthContext";
import { useBrandMessage } from "../../src/components/brandContact/useBrandMessage";
import { usePublicBrandIdentity } from "../../src/hooks/usePublicBrandEnquiry";
import { showAlert } from "../../src/components/ui/showAlert";

import { color } from "../../src/constants/designSystem";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function StayReservationRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const raw = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const groupId = typeof raw === "string" && UUID.test(raw) ? raw : null;
  const query = useStayReservationGroup(groupId);
  const theme = useMemo(() => resolveTheme(null, null), []);
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<StayPaymentSession | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const router = useRouter();
  const { user, signOut } = useAuth();
  // issue #4420 wave 2 (D-S7) — the booking belongs to another contact.
  const otherContactView =
    query.error instanceof StayGuestError &&
    query.error.code === "stay_group_other_contact"
      ? query.error.otherContact
      : null;
  const otherContact =
    otherContactView?.maskedEmail ??
    (query.error instanceof StayGuestError &&
    query.error.code === "stay_group_other_contact"
      ? query.error.maskedEmail
      : null);
  // issue #4420 wave 2 (D-S7) — "Email me the booking link again": the server
  // re-sends it to the booking's OWN address; the guest is told the mask only.
  const [resending, setResending] = useState(false);
  const resendLink = async (): Promise<void> => {
    if (groupId === null || resending) return;
    setResending(true);
    captureWeb("stay_other_contact_resend", { surface: "buyer_web", group_id: groupId });
    try {
      const sent = await stayGuestService.resendGuestLink(groupId);
      showAlert(`Sent to ${sent.maskedEmail}`, undefined, undefined, { kind: "success" });
    } catch (caught) {
      showAlert(
        caught instanceof StayGuestError && caught.code === "stay_resend_not_available"
          ? "This booking has no link to send again. Ask the property instead."
          : "We couldn't send the link just now. Try again in a few minutes.",
      );
    } finally {
      setResending(false);
    }
  };
  // "Ask {Stay} to change the email" — the brand's own enquiry thread.
  const otherBrandQuery = usePublicBrandIdentity(otherContactView?.brandSlug ?? null);
  const otherBrand = otherBrandQuery.data ?? null;
  const otherBrandTarget = useMemo(
    () =>
      otherBrand === null
        ? null
        : {
            id: otherBrand.id,
            name: otherBrand.name,
            slug: otherBrand.slug,
            theme: resolveTheme(otherBrand.theme, null),
          },
    [otherBrand],
  );
  const otherBrandMessage = useBrandMessage({
    brand: otherBrandTarget,
    viewer: { userId: user?.id ?? null, name: null },
    entry: "brand_page",
  });
  const groupViewFired = useRef(false);
  const parityViewFired = useRef(false);
  const routeState = resolveBuyerWebPublicLifecycle({
    hasData: query.data !== null && query.data !== undefined,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    isStale: query.isStale,
  });

  useEffect(() => {
    const group = query.data;
    if (!group || groupViewFired.current) return;
    groupViewFired.current = true;
    captureWeb("stay_group_viewed", {
      surface: "buyer_web",
      brand_id: group.brandId,
      venue_id: group.venueId,
      group_id: group.groupId,
      state: group.state,
    });
  }, [query.data]);

  useEffect(() => {
    const group = query.data;
    if (!group || parityViewFired.current) return;
    parityViewFired.current = true;
    void captureBuyerWebPublicPageViewed({
      target: {
        kind: "stay",
        entityId: group.groupId,
        groupId: group.groupId,
      },
      state: routeState,
    });
  }, [query.data, routeState]);

  if (groupId === null) {
    return (
      <View style={styles.invalid}>
        <Text style={styles.invalidTitle}>Stay reservation not found</Text>
      </View>
    );
  }

  const pay = async (): Promise<void> => {
    const group = query.data;
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const session = await stayGuestService.createPayment(group);
      captureWeb("stay_payment_started", {
        surface: "buyer_web",
        brand_id: group.brandId,
        venue_id: group.venueId,
        group_id: group.groupId,
        provider: session.provider,
      });
      if (session.provider === "paystack") {
        // issue #4420 wave 2 (§2.4) — same-tab handoff with a fallback link.
        setHandoffUrl(session.authorizationUrl);
      } else {
        setPayment(session);
      }
    } catch (caught) {
      captureWeb("stay_payment_failed", {
        surface: "buyer_web",
        brand_id: group.brandId,
        venue_id: group.venueId,
        group_id: group.groupId,
      });
      setError(
        caught instanceof Error ? caught.message : "Payment could not start.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={[styles.host, { backgroundColor: palette.page }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <Text style={[styles.eyebrow, { color: palette.accent }]}>MINGLA STAY</Text>
      {otherContact !== null ? (
        <StayOtherContactNotice
          palette={palette}
          maskedEmail={otherContact}
          currentEmail={user?.email ?? null}
          stayName={otherContactView?.venueName ?? null}
          reference={otherContactView?.publicReference ?? null}
          onResend={otherContactView?.resendable === true ? () => void resendLink() : null}
          resending={resending}
          onAskHost={
            otherBrandMessage.available && otherBrandTarget !== null
              ? () => {
                  captureWeb("stay_other_contact_ask_host", {
                    surface: "buyer_web",
                    group_id: groupId,
                  });
                  otherBrandMessage.open();
                }
              : null
          }
          onSignInOther={() => {
            captureWeb("stay_other_contact_sign_in", { surface: "buyer_web", group_id: groupId });
            void signOut().finally(() => {
              router.replace(
                `/auth?next=${encodeURIComponent(`/stay/${groupId}`)}` as never,
              );
            });
          }}
        />
      ) : handoffUrl !== null ? (
        <SecurePaymentHandoff
          url={handoffUrl}
          palette={palette}
          holdLine="Your rooms are held while you pay."
          onBack={() => setHandoffUrl(null)}
          testID="issue-4420-stay-group-secure-payment"
        />
      ) : payment?.provider === "stripe" && query.data ? (
        <View style={[styles.payment, { backgroundColor: palette.card }]}>
          <Text style={[styles.paymentTitle, { color: palette.primaryText }]}>
            Pay {formatStayMoney(payment.amountMinor, payment.currencyCode)}
          </Text>
          <StayStripePayment
            session={payment}
            groupId={query.data.groupId}
            accent={palette.accent}
            palette={palette}
            onComplete={() => {
              captureWeb("stay_payment_completed", {
                surface: "buyer_web",
                brand_id: query.data?.brandId ?? null,
                venue_id: query.data?.venueId ?? null,
                group_id: query.data?.groupId ?? groupId,
                provider: "stripe",
              });
              setPayment(null);
              void query.refetch();
            }}
          />
        </View>
      ) : (
        <StayReservationDetail
          group={query.data ?? null}
          loading={query.isLoading}
          error={error ?? (query.isError ? "This reservation could not load." : null)}
          palette={palette}
          busy={busy}
          onRetry={() => {
            void query.refetch();
          }}
          onPay={pay}
          onCancelPreview={async (group, selectedLineIds) => {
            setBusy(true);
            setError(null);
            try {
              const preview = await stayGuestService.cancelPreview(
                group,
                selectedLineIds,
              );
              captureWeb("stay_cancellation_previewed", {
                surface: "buyer_web",
                brand_id: group.brandId,
                venue_id: group.venueId,
                group_id: group.groupId,
                line_count: selectedLineIds.length,
              });
              return preview;
            } catch (caught) {
              captureWeb("stay_cancellation_failed", {
                surface: "buyer_web",
                brand_id: group.brandId,
                venue_id: group.venueId,
                group_id: group.groupId,
                stage: "preview",
              });
              throw caught;
            } finally {
              setBusy(false);
            }
          }}
          onCancel={async (preview, reason) => {
            setBusy(true);
            setError(null);
            try {
              await stayGuestService.cancel(preview, reason);
              captureWeb("stay_cancellation_completed", {
                surface: "buyer_web",
                group_id: preview.groupId,
                line_count: preview.selectedLineIds.length,
              });
              await query.refetch();
            } catch (caught) {
              captureWeb("stay_cancellation_failed", {
                surface: "buyer_web",
                group_id: preview.groupId,
                stage: "confirm",
              });
              setError(
                caught instanceof Error
                  ? caught.message
                  : "Cancellation could not be completed.",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {/* #4490 Explorer W1: the app card (signed-in page; kind stay_group). */}
      {query.data ? (
        <VenueClaimCard
          handoff={parseVenueHandoff(query.data)}
          kind="booking"
          email={user?.email ?? null}
          phone={null}
          analyticsSurface="stay_reservation"
          brandSlug={null}
          venueSlug={null}
        />
      ) : null}
      {query.isFetching && !query.isLoading ? (
        <ActivityIndicator color={palette.accent} />
      ) : null}
      {otherBrandMessage.overlays}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 18, gap: 16 },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  payment: { padding: 20, borderRadius: 18, gap: 16 },
  paymentTitle: { fontSize: 24, lineHeight: 30, fontWeight: "900" },
  invalid: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.canvas,
  },
  invalidTitle: { color: color.textStrong, fontSize: 20, fontWeight: "800" },
});
