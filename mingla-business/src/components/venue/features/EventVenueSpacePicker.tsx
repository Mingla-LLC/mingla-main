/**
 * #4490 P1-10 — "Where: venue and space" in the event and experience
 * creators (reconciliation conflict 61). Links the event to one of the
 * brand's venues, and optionally a space there, through
 * `issue_4490_set_event_venue`. The venue's page then lists it under
 * "What's on" when Events here is on. Each pick saves straight away and says
 * so; a refusal says why and keeps the previous link.
 *
 * Hidden when the brand has no venue. Before the draft exists on the server
 * (no event id yet) it explains that the pick unlocks after the first save.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useAuth } from "../../../context/AuthContext";
import { venueFeatureKeys } from "../../../hooks/venueFeatureKeys";
import { useVenueListings } from "../../../hooks/useVenueListings";
import { useVenueSpaces } from "../../../hooks/useVenueSpaces";
import {
  VenueFeatureError,
  fetchEventVenueLink,
  setEventVenue,
} from "../../../services/venueFeaturesService";
import { GlassCard } from "../../ui/GlassCard";
import { SpacePicker } from "../../ui/SpacePicker";
import { venueWriteErrorCopy } from "./venueFeaturesCopy";

const NO_VENUE = "none";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventVenueSpacePickerProps {
  brandId: string | null;
  /** The event / experience row id; null until the draft is saved. */
  eventId: string | null;
  /** "event" or "experience", for the wording. */
  noun?: "event" | "experience";
}

export function EventVenueSpacePicker({
  brandId,
  eventId,
  noun = "event",
}: EventVenueSpacePickerProps): React.ReactElement | null {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const validEventId = eventId !== null && UUID.test(eventId) ? eventId : null;
  const venuesQuery = useVenueListings(brandId);
  const venues = useMemo(
    () => (venuesQuery.data ?? []).filter((v) => v.venueCategory !== "stay" && v.claimStatus !== "revoked"),
    [venuesQuery.data],
  );
  const linkQuery = useQuery({
    queryKey: validEventId !== null ? venueFeatureKeys.eventVenue(validEventId) : ["eventVenueLink", "disabled"],
    enabled: isAuthReady && validEventId !== null,
    staleTime: 30_000,
    queryFn: () => fetchEventVenueLink(validEventId as string, noun),
  });
  const [venueId, setVenueId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (linkQuery.data !== undefined) {
      setVenueId(linkQuery.data.venueId);
      setSpaceId(linkQuery.data.spaceId);
    }
  }, [linkQuery.data]);

  const spacesQuery = useVenueSpaces(brandId, venueId);
  const spaces = spacesQuery.data ?? [];

  if (venues.length === 0) return null;

  const save = (nextVenue: string | null, nextSpace: string | null): void => {
    if (validEventId === null) return;
    const previous = { venueId, spaceId };
    setVenueId(nextVenue);
    setSpaceId(nextSpace);
    setSaving(true);
    setStatus({ text: "Saving…", error: false });
    setEventVenue({ eventId: validEventId, venueId: nextVenue, spaceId: nextSpace })
      .then(() => {
        setStatus({ text: "Saved", error: false });
        void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.eventVenue(validEventId) });
      })
      .catch((error: unknown) => {
        setVenueId(previous.venueId);
        setSpaceId(previous.spaceId);
        const e = error instanceof VenueFeatureError ? error : null;
        setStatus({ text: venueWriteErrorCopy("event_venue", e?.code ?? "unknown", e?.detail ?? null), error: true });
      })
      .finally(() => setSaving(false));
  };

  const venueOptions = [
    { value: NO_VENUE, label: "Not at one of my venues" },
    ...venues.map((v) => ({ value: v.id, label: v.name })),
  ];

  return (
    <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="event-venue-space-picker">
      <Text style={styles.title}>Where: venue and space</Text>
      <Text style={styles.body}>
        Put this {noun} at one of your venues. It shows on that venue&apos;s page when Events here is on.
      </Text>
      {validEventId === null ? (
        <Text style={styles.note}>You can pick a venue once this {noun} has saved for the first time.</Text>
      ) : (
        <>
          {/* A short radio list (a brand has a handful of venues); no sheet,
              so this card never stacks a modal over the creator. */}
          <Text style={styles.label}>Venue</Text>
          <View style={styles.list} accessibilityRole="radiogroup">
            {venueOptions.map((option) => {
              const on = (venueId ?? NO_VENUE) === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    if (on) return;
                    save(option.value === NO_VENUE ? null : option.value, null);
                  }}
                  disabled={saving || linkQuery.isLoading}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: saving }}
                  accessibilityLabel={option.label}
                  style={[styles.option, on && styles.optionOn]}
                  testID={`event-venue-option-${option.value}`}
                >
                  <Text style={on ? styles.optionTextOn : styles.optionText}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {venueId !== null ? (
            spacesQuery.isLoading ? (
              <Text style={styles.note}>Loading spaces…</Text>
            ) : spaces.length === 0 ? (
              <Text style={styles.note}>This venue has no spaces yet. Add them in the venue&apos;s Spaces.</Text>
            ) : (
              <SpacePicker
                label="Space"
                spaces={spaces}
                value={spaceId !== null ? [spaceId] : []}
                onChange={(ids) => save(venueId, ids[0] ?? null)}
                mode="single"
                noneLabel="The whole venue"
                disabled={saving}
                testID="event-space-picker"
              />
            )
          ) : null}
          {status !== null ? (
            <Text style={status.error ? styles.error : styles.note} accessibilityLiveRegion="polite" testID="event-venue-status">
              {status.text}
            </Text>
          ) : null}
        </>
      )}
    </GlassCard>
  );
}

export default EventVenueSpacePicker;

const styles = StyleSheet.create({
  card: { gap: space[2] },
  title: { ...type.row, color: color.text1 },
  body: { ...type.small, color: color.text2 },
  note: { ...type.caption, color: color.text3 },
  label: { ...type.small, color: color.text2 },
  list: { gap: space[1] },
  option: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  optionOn: { borderColor: color.accent, backgroundColor: color.accentLine },
  optionText: { ...type.body, color: color.text2 },
  optionTextOn: { ...type.body, color: color.text1, fontWeight: "600" },
  error: { ...type.caption, color: color.errorText },
});
