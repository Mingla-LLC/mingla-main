/**
 * #4490 P1-10 / fix 2 (N84, N76) — "Where" for an event or experience at one
 * of the brand's venues.
 *
 * When the brand has venues, the Where step opens with two choices: "At one of
 * your venues" (venue → space, or the whole venue) and "Somewhere else" (the
 * creator's own free-text fields, passed in as `otherPlace`). Picking a venue
 * hands its name, address, pin and country to `onPlace`, so the address and
 * time zone fill themselves; nothing is typed.
 *
 * The link itself is saved with `issue_4490_set_event_venue` as soon as the
 * draft has a server id. A new draft gets its id after its first edit, so a
 * pick made before that is kept here and saved the moment the id arrives.
 * "Add an event here" inside a venue preselects the venue through
 * `eventVenueIntent`. Each save says so; a refusal says why and keeps the
 * previous link.
 *
 * fix 3 (N101, N106) — a combination of spaces can be picked too, and once a
 * place is picked the host says whether the event takes it ("This event
 * takes the space", the default) or leaves it open to others. Taking it
 * holds the space (every part of a combination, every space for the whole
 * venue) from publish, so no hire, by-the-hour booking or block can use it;
 * the server refuses a publish or a change over a space already hired.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useAuth } from "../../../context/AuthContext";
import { venueFeatureKeys } from "../../../hooks/venueFeatureKeys";
import { useVenueListings } from "../../../hooks/useVenueListings";
import { useVenueSpaceCombinations, useVenueSpaces } from "../../../hooks/useVenueSpaces";
import {
  VenueFeatureError,
  fetchEventVenueLink,
  fetchVenueLocation,
  setEventVenue,
  type EventSpaceUse,
  type VenueLocation,
} from "../../../services/venueFeaturesService";
import {
  clearEventVenueIntent,
  readEventVenueIntent,
} from "../../../utils/eventVenueIntent";
import { GlassCard } from "../../ui/GlassCard";
import { OptionCard } from "../../ui/OptionCard";
import { SpacePicker } from "../../ui/SpacePicker";


import {
  DEFAULT_EVENT_SPACE_USE,
  eventVenueErrorCopy,
  initialWhereMode,
  spaceUseChoices,
  type EventWhereMode,
} from "./eventWhereModel";

export { DEFAULT_EVENT_SPACE_USE, eventVenueErrorCopy, initialWhereMode, spaceUseChoices, type EventWhereMode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What is saved: the venue, one space OR one combination (or neither = whole venue), and whether the event takes it. */
interface PlaceLink {
  venueId: string | null;
  spaceId: string | null;
  combinationId: string | null;
  spaceUse: EventSpaceUse;
}

export interface EventVenueSpacePickerProps {
  brandId: string | null;
  /** The event / experience row id; null (or a local d_ id) until the draft is saved. */
  eventId: string | null;
  /** "event" or "experience", for the wording. */
  noun?: "event" | "experience";
  /** The creator's own "somewhere else" fields. Shown when there is no venue or "Somewhere else" is chosen. */
  otherPlace?: React.ReactNode;
  /** True when the draft already has a typed address (opens on "Somewhere else"). */
  hasOtherAddress?: boolean;
  /** True when the draft has no address yet (a linked venue then fills it). */
  addressMissing?: boolean;
  /** A venue was chosen (fill name, address, pin, time zone) or "Somewhere else" (null: clear them). */
  onPlace?: (venue: VenueLocation | null) => void;
}

export function EventVenueSpacePicker({
  brandId,
  eventId,
  noun = "event",
  otherPlace = null,
  hasOtherAddress = false,
  addressMissing = false,
  onPlace,
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
  const [intent] = useState(() => readEventVenueIntent(brandId, noun));
  const [mode, setMode] = useState<EventWhereMode | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [combinationId, setCombinationId] = useState<string | null>(null);
  const [spaceUse, setSpaceUse] = useState<EventSpaceUse>(DEFAULT_EVENT_SPACE_USE);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const seededRef = useRef(false);
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  const linkKnown = validEventId === null || linkQuery.data !== undefined || linkQuery.isError;
  const ready = !venuesQuery.isLoading && linkKnown;

  // Decide the opening choice once the venues and the saved link are known.
  useEffect(() => {
    if (!ready || seededRef.current) return;
    seededRef.current = true;
    const linked = linkQuery.data?.venueId ?? null;
    const intentVenue =
      // Only a fresh draft (no place yet) takes the venue it was started from.
      intent !== null && addressMissing && venues.some((v) => v.id === intent.venueId) ? intent.venueId : null;
    const first = initialWhereMode({
      hasVenues: venues.length > 0,
      linkedVenueId: linked,
      intentVenueId: intentVenue,
      hasOtherAddress,
    });
    setMode(first);
    if (linked !== null) {
      setVenueId(linked);
      setSpaceId(linkQuery.data?.spaceId ?? null);
      setCombinationId(linkQuery.data?.combinationId ?? null);
      setSpaceUse(linkQuery.data?.spaceUse ?? "shared");
      if (addressMissing) void prefill(linked);
    } else if (intentVenue !== null) {
      setVenueId(intentVenue);
      void prefill(intentVenue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const spacesQuery = useVenueSpaces(brandId, venueId);
  const spaces = spacesQuery.data ?? [];
  const combinationsQuery = useVenueSpaceCombinations(brandId, venueId);
  const combinations = combinationsQuery.data ?? [];
  const current: PlaceLink = { venueId, spaceId, combinationId, spaceUse };
  const placeName =
    spaceId !== null
      ? spaces.find((s) => s.id === spaceId)?.name ?? "this space"
      : combinationId !== null
        ? combinations.find((c) => c.id === combinationId)?.name ?? "these spaces"
        : null;

  async function prefill(id: string): Promise<void> {
    if (onPlaceRef.current === undefined) return;
    try {
      const location = await fetchVenueLocation(id);
      if (location !== null) onPlaceRef.current?.(location);
    } catch {
      setStatus({ text: "Couldn't load the venue's address. Try picking it again.", error: true });
    }
  }

  const restore = (previous: PlaceLink): void => {
    setVenueId(previous.venueId);
    setSpaceId(previous.spaceId);
    setCombinationId(previous.combinationId);
    setSpaceUse(previous.spaceUse);
  };

  const persist = (next: PlaceLink, previous: PlaceLink, takenPlace: string | null = placeName): void => {
    if (validEventId === null) {
      setStatus({ text: `Saved with this ${noun} once it has its first save.`, error: false });
      return;
    }
    setSaving(true);
    setStatus({ text: "Saving…", error: false });
    setEventVenue({
      eventId: validEventId,
      venueId: next.venueId,
      spaceId: next.spaceId,
      combinationId: next.combinationId,
      spaceUse: next.spaceUse,
    })
      .then(() => {
        setStatus({ text: next.venueId === null ? "Saved · not at a venue" : "Saved", error: false });
        if (intent !== null) clearEventVenueIntent();
        void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.eventVenue(validEventId) });
      })
      .catch((error: unknown) => {
        restore(previous);
        const e = error instanceof VenueFeatureError ? error : null;
        setStatus({ text: eventVenueErrorCopy(e?.code ?? "unknown", e?.detail ?? null, takenPlace, noun), error: true });
      })
      .finally(() => setSaving(false));
  };

  // A pick made before the draft had a server id is saved once the id arrives.
  const server = linkQuery.data;
  const serverLink: PlaceLink = {
    venueId: server?.venueId ?? null,
    spaceId: server?.spaceId ?? null,
    combinationId: server?.combinationId ?? null,
    spaceUse: server?.spaceUse ?? "shared",
  };
  useEffect(() => {
    if (validEventId === null || linkQuery.data === undefined || saving) return;
    if (mode !== "venue" || venueId === null) return;
    if (
      venueId === serverLink.venueId &&
      spaceId === serverLink.spaceId &&
      combinationId === serverLink.combinationId &&
      spaceUse === serverLink.spaceUse
    ) {
      if (intent !== null) clearEventVenueIntent();
      return;
    }
    persist(current, serverLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validEventId, linkQuery.data, mode]);

  const pickVenue = (id: string): void => {
    if (id === venueId) return;
    const previous = current;
    setVenueId(id);
    setSpaceId(null);
    setCombinationId(null);
    setSpaceUse(DEFAULT_EVENT_SPACE_USE);
    void prefill(id);
    persist({ venueId: id, spaceId: null, combinationId: null, spaceUse: DEFAULT_EVENT_SPACE_USE }, previous, null);
  };

  const pickPlace = (id: string | null): void => {
    const previous = current;
    const isCombination = id !== null && combinations.some((c) => c.id === id);
    const nextSpace = id !== null && !isCombination ? id : null;
    const nextCombination = isCombination ? id : null;
    // A new pick takes its place by default; the host can let it stay open.
    setSpaceId(nextSpace);
    setCombinationId(nextCombination);
    setSpaceUse(DEFAULT_EVENT_SPACE_USE);
    const name =
      nextSpace !== null
        ? spaces.find((s) => s.id === nextSpace)?.name ?? null
        : nextCombination !== null
          ? combinations.find((c) => c.id === nextCombination)?.name ?? null
          : null;
    persist(
      { venueId, spaceId: nextSpace, combinationId: nextCombination, spaceUse: DEFAULT_EVENT_SPACE_USE },
      previous,
      name,
    );
  };

  const pickSpaceUse = (next: EventSpaceUse): void => {
    if (next === spaceUse) return;
    const previous = current;
    setSpaceUse(next);
    persist({ ...current, spaceUse: next }, previous);
  };

  const chooseMode = (next: EventWhereMode): void => {
    if (next === mode) return;
    setMode(next);
    if (next === "other") {
      if (intent !== null) clearEventVenueIntent();
      const previous = current;
      setVenueId(null);
      setSpaceId(null);
      setCombinationId(null);
      onPlaceRef.current?.(null);
      if (previous.venueId !== null && validEventId !== null && serverLink.venueId !== null) {
        persist({ venueId: null, spaceId: null, combinationId: null, spaceUse: "shared" }, previous);
      } else {
        setStatus(null);
      }
    }
  };

  // No venues (or still deciding): the creator's own fields, unchanged.
  if (venues.length === 0 || mode === null) {
    return <>{otherPlace}</>;
  }

  const choices: Array<{ value: EventWhereMode; label: string }> = [
    { value: "venue", label: "At one of your venues" },
    { value: "other", label: "Somewhere else" },
  ];

  return (
    <View style={styles.wrap} testID="event-venue-space-picker">
      <View style={styles.choiceRow} accessibilityRole="radiogroup" accessibilityLabel={`Where is this ${noun}?`}>
        {choices.map((choice) => {
          const on = mode === choice.value;
          return (
            <Pressable
              key={choice.value}
              onPress={() => chooseMode(choice.value)}
              disabled={saving}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: saving }}
              accessibilityLabel={choice.label}
              style={[styles.choice, on && styles.choiceOn]}
              testID={`event-where-mode-${choice.value}`}
            >
              <Text style={on ? styles.choiceTextOn : styles.choiceText}>{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {mode === "other" ? (
        <>{otherPlace}</>
      ) : (
        <GlassCard variant="base" padding={space[4]} contentStyle={styles.card}>
          <Text style={styles.label}>Venue</Text>
          <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel="Venue">
            {venues.map((v) => {
              const on = venueId === v.id;
              const line = [v.address, v.city].filter((p): p is string => p !== null && p.trim().length > 0).join(", ");
              return (
                <Pressable
                  key={v.id}
                  onPress={() => pickVenue(v.id)}
                  disabled={saving}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: saving }}
                  accessibilityLabel={v.name}
                  style={[styles.option, on && styles.optionOn]}
                  testID={`event-venue-option-${v.id}`}
                >
                  <Text style={on ? styles.optionTextOn : styles.optionText}>{v.name}</Text>
                  {line.length > 0 ? <Text style={styles.optionSub}>{line}</Text> : null}
                </Pressable>
              );
            })}
          </View>
          {venueId === null ? (
            <Text style={styles.note}>Pick the venue. Its address and time zone fill in for you.</Text>
          ) : spacesQuery.isLoading ? (
            <Text style={styles.note}>Loading spaces…</Text>
          ) : spacesQuery.isError ? (
            <Text style={styles.error}>Couldn&apos;t load this venue&apos;s spaces. Pick the venue again to retry.</Text>
          ) : spaces.length === 0 ? (
            <Text style={styles.note}>
              This {noun} uses the whole venue. Add spaces in the venue&apos;s Spaces to place it in one room.
            </Text>
          ) : (
            <>
              <SpacePicker
                label="Space"
                spaces={spaces}
                combinations={combinations}
                value={spaceId !== null ? [spaceId] : combinationId !== null ? [combinationId] : []}
                onChange={(ids) => pickPlace(ids[0] ?? null)}
                mode="single"
                noneLabel="The whole venue"
                disabled={saving}
                testID="event-space-picker"
              />
              <Text style={styles.label}>Does it take {placeName ?? "the venue"}?</Text>
              <View style={styles.useRow} accessibilityRole="radiogroup" accessibilityLabel={`Does this ${noun} take ${placeName ?? "the venue"}?`}>
                {spaceUseChoices(noun, placeName).map((choice) => (
                  <OptionCard
                    key={choice.value}
                    label={choice.label}
                    helper={choice.helper}
                    selected={spaceUse === choice.value}
                    onPress={() => pickSpaceUse(choice.value)}
                    disabled={saving}
                    testID={`event-space-use-${choice.value}`}
                  />
                ))}
              </View>
              {spaceUse === "exclusive" ? (
                <Text style={styles.note}>
                  Held from when it&apos;s published. If {placeName ?? "a space"} is already hired or blocked then, publishing says so.
                </Text>
              ) : null}
            </>
          )}
          <Text style={styles.note}>
            It shows on the venue&apos;s page under What&apos;s on and on its Calendar when Events here is on.
          </Text>
        </GlassCard>
      )}
      {status !== null ? (
        <Text style={status.error ? styles.error : styles.note} accessibilityLiveRegion="polite" testID="event-venue-status">
          {status.text}
        </Text>
      ) : null}
    </View>
  );
}

export default EventVenueSpacePicker;

const styles = StyleSheet.create({
  wrap: { gap: space[3], marginBottom: space[4] },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  useRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  choice: {
    flexGrow: 1,
    flexBasis: 200,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  choiceOn: { borderColor: color.accent, backgroundColor: color.accentLine },
  choiceText: { ...type.body, color: color.text2 },
  choiceTextOn: { ...type.body, color: color.text1, fontWeight: "600" },
  card: { gap: space[2] },
  note: { ...type.caption, color: color.text3 },
  label: { ...type.small, color: color.text2 },
  list: { gap: space[1] },
  option: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  optionOn: { borderColor: color.accent, backgroundColor: color.accentLine },
  optionText: { ...type.body, color: color.text2 },
  optionTextOn: { ...type.body, color: color.text1, fontWeight: "600" },
  optionSub: { ...type.caption, color: color.text3 },
  error: { ...type.caption, color: color.errorText },
});
