/**
 * /e/{brandSlug}/{eventSlug} — public event page route.
 *
 * Resolves a LiveEvent by URL (brand-scoped slug). Renders PublicEventPage
 * with state-variant branched rendering.
 *
 * Per Cycle 6 spec §3.2.1.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed cover image on the public event share-link page; the X close + share buttons + clock overlap with the cover photo at the top is the intended banner-style buyer aesthetic (matches /b/ + /t/ + /checkout/* pattern). Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 17-PUBLIC-EVENT-PAGE.png).

import React, { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

// META-ORCH-1187 LEG 2 — buyer-web public-offering view capture (web-only).
// ISSUE-865 WP-C — ad click-id capture + PageView/ViewContent pixels (web-only).
import {
  captureAdClickIds,
  captureWeb,
  fireAdPageView,
  fireAdViewContent,
} from "../../../src/analytics/webAnalytics";
import {
  captureBuyerWebPublicPageViewed,
  resolveBuyerWebPublicLifecycle,
} from "../../../src/analytics/publicParityWebAdapter";
import { buildAdViewContentPayload } from "../../../src/analytics/adViewContentPayload";

import { space, color } from "../../../src/constants/designSystem";
import { usePublicEventBySlug } from "../../../src/hooks/usePublicEvents";
import { PublicEventPage } from "../../../src/components/event/PublicEventPage";
import { PublicEventNotFound } from "../../../src/components/event/PublicEventNotFound";
import {
  BuyerConnectionNotice,
  preloadBuyerConnectionNotice,
} from "../../../src/components/buyer/BuyerConnectionNotice";
import { isConnectionFailure } from "../../../src/services/connectionFailure";
// issue #3284 — the refund ladder's chunk starts with this page's data fetch.
import { loadOfferingRefundLadder } from "@mingla/offering-rendering/LazyOfferingRefundLadder";
import { PublicGlassProvider } from "../../../src/components/offering/PublicGlassProvider";
import { useWebDocumentTitle } from "../../../src/hooks/useWebDocumentTitle";

function PublicEventRouteBody(): React.ReactElement {
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    eventSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const eventSlug = Array.isArray(params.eventSlug)
    ? params.eventSlug[0]
    : params.eventSlug;

  const publicEventQuery = usePublicEventBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof eventSlug === "string" ? eventSlug : null,
  );
  // #4490 fix 3 (N104) — name the event in the tab (it kept the venue's title
  // when opened from a venue's What's on).
  const titleEvent = publicEventQuery.data?.event;
  const titleBrand = publicEventQuery.data?.brand;
  useWebDocumentTitle(
    titleEvent !== undefined && titleEvent !== null
      ? `${titleEvent.name}${titleBrand?.displayName ? ` · ${titleBrand.displayName}` : ""} on Mingla`
      : null,
  );
  const routeState = resolveBuyerWebPublicLifecycle({
    hasData: publicEventQuery.data !== null &&
      publicEventQuery.data !== undefined,
    isLoading: publicEventQuery.isLoading,
    isFetching: publicEventQuery.isFetching,
    isError: publicEventQuery.isError,
    isStale: publicEventQuery.isStale,
  });
  // issue #3284 — start the refund ladder's chunk in the same mount that starts the
  // page data fetch above, so when the data lands the body usually paints the
  // ladder on its first frame. Nothing waits on it: if the data wins, the body
  // shows the ladder's reserved space until the chunk arrives. Never at module
  // evaluation, so no other route fetches it.
  useEffect(() => {
    loadOfferingRefundLadder().catch(() => undefined);
  }, []);

  // META-ORCH-1187 LEG 2 — fire `web_public_offering_viewed` once on mount
  // (top of the web acquisition funnel). Web-only (no-op on native).
  const viewFiredRef = useRef<boolean>(false);
  const parityViewFiredRef = useRef<boolean>(false);
  const adViewContentFiredRef = useRef<boolean>(false);
  useEffect(() => {
    if (viewFiredRef.current) return;
    viewFiredRef.current = true;
    captureWeb("web_public_offering_viewed", {
      offering_type: "event",
      brand_slug: typeof brandSlug === "string" ? brandSlug : null,
      slug: typeof eventSlug === "string" ? eventSlug : null,
    });
    // ISSUE-865 WP-C — capture ad click-ids off the landing URL (first-party,
    // no PII) + fire the consent-gated PageView/ViewContent pixels (no-op until
    // consent). All web-only + fail-open; never blocks the page.
    captureAdClickIds({
      pageType: "event",
      brandSlug: typeof brandSlug === "string" ? brandSlug : null,
      entitySlug: typeof eventSlug === "string" ? eventSlug : null,
    });
    fireAdPageView();
  }, [brandSlug, eventSlug]);

  useEffect(() => {
    const detail = publicEventQuery.data;
    if (
      adViewContentFiredRef.current ||
      detail === null ||
      detail === undefined
    ) {
      return;
    }
    const tickets = Array.isArray(detail.tickets) ? detail.tickets : [];
    const currency =
      detail.event.displayCurrency ??
      detail.event.currency ??
      tickets.find((ticket) => ticket.currency)?.currency;
    const valuesMajor = [
      typeof detail.event.displayPriceCents === "number"
        ? detail.event.displayPriceCents / 100
        : null,
      ...tickets.map(
        (ticket) =>
          ticket.priceAllInGbp ?? ticket.priceGbp ?? (ticket.isFree ? 0 : null),
      ),
    ];
    const payload = buildAdViewContentPayload({
      contentId: detail.event.id,
      brandId: detail.event.brandId,
      currency,
      valuesMajor,
      freeWhenUnpriced: detail.event.event_type === "rsvp",
    });
    if (payload === null) return;
    adViewContentFiredRef.current = true;
    fireAdViewContent(payload);
  }, [publicEventQuery.data]);

  useEffect(() => {
    const detail = publicEventQuery.data;
    if (parityViewFiredRef.current || detail === null || detail === undefined) {
      return;
    }
    parityViewFiredRef.current = true;
    void captureBuyerWebPublicPageViewed({
      target: {
        kind: "event",
        entityKind: detail.event.event_type === "rsvp" ? "rsvp" : "event",
        entityId: detail.event.id,
        brandSlug: detail.event.brandSlug,
        eventSlug: detail.event.eventSlug,
      },
      state: routeState,
    });
  }, [publicEventQuery.data, routeState]);

  // #4518 — fetch the designed notice once the page is idle (best effort).
  useEffect(preloadBuyerConnectionNotice, []);

  // #4518 — one notice for a page that could not load. Kept on screen while
  // Try again re-reads (the query stays in error until it succeeds), so the
  // buyer sees "Trying again…" rather than a spinner swap.
  if (routeState === "error" || (routeState === "loading" && publicEventQuery.isError)) {
    return (
      <View style={styles.noticeHost}>
        <BuyerConnectionNotice
          variant={isConnectionFailure(publicEventQuery.error) ? "connection" : "server"}
          onRetry={() => publicEventQuery.refetch()}
          testID="public-event-connection-notice"
        />
      </View>
    );
  }

  if (routeState === "loading") {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading event...</Text>
      </View>
    );
  }

  if (publicEventQuery.data === null || publicEventQuery.data === undefined) {
    return <PublicEventNotFound />;
  }

  return (
    <PublicEventPage
      event={publicEventQuery.data.event}
      brand={publicEventQuery.data.brand}
      bookable={publicEventQuery.data.bookable}
      terminalSource={publicEventQuery.data.terminalSource}
      // ══ issue #2209 ═══════════════════════════════════════════════════════
      // THE DAYS. `PublicEventDetail` has carried `occurrences` +
      // `multiDatePricingMode` since #2160 and this route — the ONLY production
      // mount of PublicEventPage — never passed them, so the props defaulted to
      // the empty list and "per_day" on every shared link. A guest opening a
      // two-day event saw "Date TBD / Multi-date (no dates yet)" and got no day
      // picker, because #2160 moved the occurrence read OUT of the component
      // (it used to fetch them itself, #2135) and into a prop nobody handed it.
      //
      // Threading them here is the whole client half of #2209: the eyebrow
      // renders the real days and MultiDateDayChooser mounts with something to
      // choose between. A single-date event's detail carries exactly one
      // occurrence and "per_day", which is what the props already defaulted to
      // in every way that reaches the render — that page is unchanged.
      occurrences={publicEventQuery.data.occurrences}
      multiDatePricingMode={publicEventQuery.data.multiDatePricingMode}
      allDaysPass={publicEventQuery.data.allDaysPass}
      onRetryOccurrences={async () => {
        const result = await publicEventQuery.refetch();
        return result.isSuccess;
      }}
      // issue #3284 — the refund terms ride the SAME bundle as the days above.
      refundPolicyState={publicEventQuery.data.refundPolicyState}
      // issue #3314 — and so does the organiser's "Hide remaining count".
      bundleHideRemainingCount={publicEventQuery.data.hideRemainingCount}
    />
  );
}

const styles = StyleSheet.create({
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
    backgroundColor: color.canvas,
  },
  noticeHost: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  stateText: {
    color: color.text2,
    fontSize: 14,
    textAlign: "center",
  },
});

// issue #4420 — the Host app's real glass for the shared public page.
export default function PublicEventRoute(): React.ReactElement {
  return (
    <PublicGlassProvider>
      <PublicEventRouteBody />
    </PublicGlassProvider>
  );
}
