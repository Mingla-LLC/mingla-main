/**
 * #4490 P2-5 — the Overview header for a venue that sells (`ov`, `ov-first`,
 * `ov-review`, `ov-loading`, `ov-error`). Feature-driven: it shows only when
 * a booking feature is on (Entry in this build), above the venue intelligence
 * content, which stays below unchanged.
 *  - nothing live yet: the first-run checklist with one next action;
 *  - selling: four tiles from the venue's day;
 *  - in review: a warning banner, setup stays usable.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useBrandHours } from "../../../../hooks/useBrandHours";
import { useVenueDay } from "../../../../hooks/useVenueDay";
import { useVenueListing } from "../../../../hooks/useVenueListings";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import type { VenueModule } from "../../../../types/venueReservation";
import type { VenueFeatureSet } from "../../../../types/venueFeatures";
import { sellStepMeta, spacesRequired, spacesStepMeta } from "../featureSetupModel";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { KpiTile } from "../../../ui/KpiTile";
import { Skeleton } from "../../../ui/Skeleton";
import { RequestsWaitingCard } from "../requests/RequestsWaitingCard";
import { dayNumbers } from "./todayModel";
import { TodayMoneyTiles } from "./TodayMoneyTiles";
import { dayDateLabel } from "../../../ui/fieldModels";

export interface VenueTodayOverviewProps {
  brandId: string | null;
  venueId: string | null;
  activeSpaceCount: number;
  /** #4490 N17: the checklist follows the venue's features, not Entry. */
  features?: VenueFeatureSet | null;
  canManageOffers: boolean;
  onOpenModule: (module: VenueModule) => void;
  /** #4490 P4 — show requests waiting on the host (Requests is in the nav). */
  showRequests?: boolean;
}

interface Step {
  key: string;
  title: string;
  meta: string;
  done: boolean;
  action?: { label: string; module: VenueModule };
}

export function VenueTodayOverview({
  brandId,
  venueId,
  activeSpaceCount,
  features = null,
  canManageOffers,
  onOpenModule,
  showRequests = false,
}: VenueTodayOverviewProps): React.ReactElement {
  const currency = useBrandCurrency(brandId);
  const offersQuery = useVenueOffers(brandId, venueId);
  const dayQuery = useVenueDay(brandId, venueId, null, { live: true });
  const hoursQuery = useBrandHours(brandId, venueId);
  const inReview = useVenueListing(venueId).data?.claimStatus === "pending_review";

  const reviewBanner = inReview ? (
    <Banner
      tone="warning"
      title="In review"
      body="Usually 1 working day. Keep setting up: guests see your venue once it's approved."
      testID="venue-overview-in-review"
    />
  ) : null;

  if (offersQuery.isLoading || dayQuery.isLoading) {
    return (
      <View style={styles.host} testID="venue-overview-today-loading" accessibilityLabel="Loading today">
        {reviewBanner}
        <View style={styles.tiles}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.tile}>
              <Skeleton height={84} radius="md" />
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (offersQuery.isError || dayQuery.isError) {
    return (
      <View style={styles.host} testID="venue-overview-today-error">
        {reviewBanner}
        <Banner
          tone="danger"
          title="Couldn't load today"
          body="Your bookings are safe. Check your connection and try again."
          action={{
            label: "Try again",
            onPress: () => {
              void offersQuery.refetch();
              void dayQuery.refetch();
            },
          }}
        />
      </View>
    );
  }

  const offers = offersQuery.data?.offers ?? [];
  const live = offers.filter((o) => o.status === "live");
  const hoursSet = (hoursQuery.data ?? []).some((h) => !h.isClosed);

  if (live.length === 0) {
    const steps: Step[] = [
      { key: "details", title: "Venue details", meta: "Name, address, photos, contact", done: true },
      {
        key: "hours",
        title: "Opening hours",
        meta: hoursSet ? "Set" : "When guests can come",
        done: hoursSet,
        action: { label: "Set hours", module: "availability" },
      },
      {
        key: "spaces",
        title: "Add your spaces",
        meta:
          features !== null
            ? spacesStepMeta(features, activeSpaceCount)
            : activeSpaceCount > 0
              ? `${activeSpaceCount} ${activeSpaceCount === 1 ? "space" : "spaces"}`
              : "The rooms and areas guests use",
        done: activeSpaceCount > 0,
        action: { label: "Add spaces", module: "spaces" },
      },
      {
        key: "offer",
        title: "Add what you sell",
        meta:
          offers.length > 0
            ? `${offers.length} draft ${offers.length === 1 ? "offer" : "offers"}`
            : features !== null
              ? sellStepMeta(features)
              : "What guests can book or buy",
        done: offers.length > 0,
        action: { label: "Add an offer", module: "offers" },
      },
      {
        key: "publish",
        title: "Publish",
        meta: inReview ? "Mingla reviews new venues, usually within 1 working day" : "Guests can buy as soon as you publish",
        done: false,
        action: offers.length > 0 ? { label: "Open offers", module: "offers" } : undefined,
      },
    ];
    // The next step is the first not done that is required. Spaces are
    // optional unless a switched-on feature needs one (Private hire, By the
    // hour, Floor plan).
    const spacesOptional = features === null || !spacesRequired(features);
    const optional = (key: string): boolean => key === "spaces" && spacesOptional;
    const next = steps.find((s) => !s.done && !optional(s.key) && s.key !== "details");
    const left = steps.filter((s) => !s.done && !optional(s.key)).length;
    return (
      <View style={styles.host} testID="venue-overview-first-run">
        {reviewBanner}
        <Banner tone="info" title={`${left} ${left === 1 ? "step" : "steps"} to go live`} body="Guests can buy as soon as you publish." />
        <View style={styles.checklist}>
          {steps.map((s, index) => (
            <View key={s.key} style={[styles.todo, index > 0 ? styles.todoBorder : null]} testID={`venue-overview-step-${s.key}`}>
              <View style={[styles.ring, s.done ? styles.ringDone : s === next ? styles.ringNext : null]}>
                {s.done ? <Icon name="check" size={14} color={color.ink} /> : <Text style={styles.ringNumber}>{index + 1}</Text>}
              </View>
              <View style={styles.todoText}>
                <Text style={styles.todoTitle}>{s.title}</Text>
                <Text style={styles.meta}>{s.meta}</Text>
              </View>
              {s.action !== undefined && !s.done && (canManageOffers || s.key === "hours") ? (
                <Button
                  label={s.action.label}
                  variant={s === next ? "primary" : "secondary"}
                  size="sm"
                  onPress={() => onOpenModule((s.action as { module: VenueModule }).module)}
                  testID={`venue-overview-step-${s.key}-action`}
                />
              ) : null}
            </View>
          ))}
        </View>
      </View>
    );
  }

  const day = dayQuery.data;
  if (day === undefined) return <View />;
  const n = dayNumbers(day);
  const cur = n.currencyCode ?? currency;
  return (
    <View style={styles.host} testID="venue-overview-today">
      {reviewBanner}
      {showRequests ? <RequestsWaitingCard brandId={brandId} venueId={venueId} onOpenRequests={() => onOpenModule("requests")} /> : null}
      <View style={styles.tiles}>
        <View style={styles.tile}>
          <KpiTile
            label="In the venue"
            value={n.inNow}
            sub={
              n.dailyLimit !== null
                ? `of ${n.dailyLimit.toLocaleString("en-GB")} today${n.walkInLeft !== null ? ` · ${n.walkInLeft} kept for walk-ins` : ""}`
                : "today"
            }
            testID="venue-overview-tile-in"
          />
        </View>
        <View style={styles.tile}>
          <KpiTile label="Still to arrive" value={n.toArrive} sub={`${n.soldToday} sold for today`} />
        </View>
        <View style={styles.tile}>
          {(day.membersIn ?? 0) > 0 ? (
            <KpiTile label="Members in" value={day.membersIn ?? 0} sub="Checked in today" testID="venue-overview-tile-members" />
          ) : (
            <KpiTile label="Paying now" value={n.waiting} sub="Guests mid-checkout" />
          )}
        </View>
        {/* #4490 07-E: two honest money numbers, both the server's. */}
        <TodayMoneyTiles
          money={day.money}
          isToday
          currency={cur}
          dateLine={day.localDate.length > 0 ? dayDateLabel(day.localDate) : "Today"}
          onRetry={() => void dayQuery.refetch()}
          onOpenOrders={() => onOpenModule("orders")}
          tileStyle={styles.tile}
        />
      </View>
      <View style={styles.links}>
        <Button label="Open Today" variant="secondary" size="sm" onPress={() => onOpenModule("today")} testID="venue-overview-open-today" />
        <Button label="Open check-in" variant="secondary" size="sm" leadingIcon="scan" onPress={() => onOpenModule("checkin")} testID="venue-overview-open-checkin" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[3], marginBottom: space[4] },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  tile: { flexGrow: 1, flexBasis: 160, minWidth: 150, gap: space[1] },
  meter: { marginTop: space[1] },
  meta: { ...type.caption, color: color.text3 },
  links: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  checklist: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    overflow: "hidden",
  },
  todo: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], flexWrap: "wrap" },
  todoBorder: { borderTopWidth: 1, borderTopColor: color.line },
  ring: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
  },
  ringDone: { backgroundColor: color.paper, borderColor: color.paper },
  ringNext: { borderColor: color.text1, borderWidth: 2 },
  ringNumber: { ...type.caption, color: color.text2, fontWeight: "700" },
  todoText: { flex: 1, minWidth: 160, gap: 2 },
  todoTitle: { ...type.row, color: color.text1 },
});
