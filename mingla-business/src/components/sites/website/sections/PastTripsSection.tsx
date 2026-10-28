import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useWebsite } from "../WebsiteContext";
import { Banner, Body, Card, CardTitle, Chip, Hint, ListBox, MiniButton, Row, SectionHead, Skeleton, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { BrandSiteContentConflict, usePastTrips, useSetPastTripHidden, type PastTrip } from "../../../../sites/contentApi";
import { formatTripDates } from "../../../../sites/websiteCopy";
import { BrandSitesError } from "../../../../services/brandSitesService";

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Past trips, §37 answer 3) — the brand's ended
 * Mingla trips. Trip details are Mingla's (read-only here); owners and admins
 * can leave a trip off the website's "Trips we've run" — display only, the
 * trip itself never changes.
 */
export function PastTripsSection(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, toast } = ctx;
  const router = useRouter();
  const past = usePastTrips(controller.siteId);
  const hide = useSetPastTripHidden(controller.siteId);
  const canHide = past.data?.can_hide === true;
  const trips = past.data?.trips ?? [];

  const toggle = (trip: PastTrip) => {
    if (!past.data?.revision) return;
    hide.mutate({ offeringId: trip.id, hidden: !trip.hidden, revision: past.data.revision }, {
      onSuccess: () => toast(!trip.hidden
        ? `${trip.title} is hidden from your website (after you publish)`
        : `${trip.title} shows on your website again (after you publish)`, "success"),
      onError: (error) => toast(error instanceof BrandSiteContentConflict
        ? "Someone changed this list just now. Here is the latest."
        : error instanceof BrandSitesError ? error.message : "That didn’t save. Try again.", "error"),
    });
  };

  if (past.isLoading) {
    return <View><SectionHead ref={headingRef} phone={phone} title="Past trips" /><Skeleton height={64} style={{ marginBottom: 2 }} /><Skeleton height={64} /></View>;
  }
  if (past.isError) {
    return (
      <View>
        <SectionHead ref={headingRef} phone={phone} title="Past trips" />
        <Card>
          <CardTitle>Your past trips couldn&apos;t be loaded</CardTitle>
          <Hint>{past.error instanceof BrandSitesError ? past.error.message : "Check your connection and try again."}</Hint>
          <WButton label="Try again" size="sm" onPress={() => { void past.refetch(); }} style={{ alignSelf: "flex-start", marginTop: 12 }} />
        </Card>
      </View>
    );
  }
  if (trips.length === 0) {
    return (
      <View testID="website-past">
        <SectionHead ref={headingRef} phone={phone} title="Past trips" />
        <Card style={styles.empty}>
          <WebsiteIcon name="clock" size={30} color={ui.t2} />
          <CardTitle style={styles.center}>No past trips yet</CardTitle>
          <Body style={styles.emptyBody}>When a Mingla trip ends, it moves here and onto your &quot;Trips we&apos;ve run&quot; section by itself.</Body>
        </Card>
      </View>
    );
  }
  return (
    <View testID="website-past">
      <SectionHead ref={headingRef} phone={phone} title="Past trips" subtitle={"These come from your ended Mingla trips and show in “Trips we've run”."} />
      <Banner tone="info" icon="lock" title="Read-only here · Mingla trips are the one source of truth, so the website, your Mingla page and the apps always agree." body="Hide a trip here to leave it off your website. To change its details, edit the trip." />
      <ListBox>
        {trips.map((trip) => (
          <Row key={trip.id} testID={`past-row-${trip.id}`}>
            {trip.cover_url ? <Image source={{ uri: trip.cover_url }} style={styles.thumb} accessibilityIgnoresInvertColors /> : <View style={styles.thumb} />}
            <View style={styles.grow}>
              <Text style={styles.title} numberOfLines={2}>{trip.title}</Text>
              <Text style={styles.sub}>{[
                formatTripDates(trip.start_at, trip.end_at, trip.timezone),
                trip.travellers ? `${trip.travellers} ${trip.travellers === 1 ? "traveller" : "travellers"}` : null,
                "Ended",
              ].filter(Boolean).join(" · ")}</Text>
            </View>
            <Chip label={trip.hidden ? "Hidden" : "Shown"} tone={trip.hidden ? "neutral" : "ok"} testID={`past-status-${trip.id}`} />
            <MiniButton
              icon={trip.hidden ? "eyeoff" : "eye"}
              label={`${trip.hidden ? "Show" : "Hide"} ${trip.title} on the website`}
              onPress={() => toggle(trip)}
              disabled={!canHide || hide.isPending}
              testID={`past-toggle-${trip.id}`}
            />
            <WButton label="Open trip" icon="ext" size="sm" onPress={() => router.push(`/trip/${trip.id}` as never)} testID={`past-open-${trip.id}`} />
          </Row>
        ))}
      </ListBox>
      {!canHide ? (
        <View style={styles.ask}>
          <Hint>Only brand admins and owners can hide past trips.</Hint>
          <WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("past_trip")} loading={ctx.asking} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 150 },
  center: { textAlign: "center" },
  empty: { alignItems: "center", paddingVertical: 40, paddingHorizontal: 24, gap: 10 },
  emptyBody: { textAlign: "center", maxWidth: 440 },
  thumb: { width: 56, height: 42, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)" },
  title: { fontSize: 14, fontWeight: "600", color: ui.t1 },
  sub: { fontSize: 12.5, lineHeight: 17, color: ui.t3 },
  ask: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 10 },
});
