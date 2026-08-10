/**
 * Issue #1789 (#1767 Phase 1) — the SPOTS inventory (SPEC #1788 P-7, P-7c,
 * P-9, P-10, P-27; DESIGN D-3 / D-3b / D-5).
 *
 * ONE list per brand, grouped by venue — rooms and tables side by side, one
 * print button covering both. The venue never manages two lists: a spot exists
 * because a table or a named room exists, and it is minted, renamed and
 * retired by the database, not by a person.
 *
 * What an operator can actually do here:
 *   · see every spot the brand has, grouped by venue, with its printing state
 *   · print the whole brand, one venue, or re-print one card
 *   · re-point a room at the kitchen that serves it (the D-3b to-do)
 *   · stop a spot printing without deleting anything
 *
 * What they can NEVER do: change a printed code. It is opaque, server-minted
 * and immutable, so a rename can never kill a laminated card
 * (I-PROPOSED-1767-PRINTED-CODE-SURVIVES-A-RENAME). No control on this screen
 * even implies otherwise.
 *
 * Sub-sheets render INSIDE this parent Sheet (the shipped RN rule), and the
 * body ScrollView is flex-bounded so the CTA clears the keyboard.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Sheet } from "../ui/Sheet";
import {
  useQrSheet,
  useQrSpots,
  useQrSpotVenues,
  useUpdateQrSpot,
} from "../../hooks/useQrSpots";
import {
  bulkPrintRequest,
  groupSpotsByVenue,
  isPrintable,
  singlePrintRequest,
  SPOT_SERVING_TODO_LABEL,
  spotNeedsServingChoice,
  spotSubtitle,
  type QrSpot,
} from "./qrSpots";

export interface VenueSpotsSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  /** Manager-plus. RLS enforces the same floor server-side. */
  canMutate: boolean;
  testID?: string;
}

export function VenueSpotsSheet({
  visible,
  onClose,
  brandId,
  canMutate,
  testID,
}: VenueSpotsSheetProps): React.ReactElement {
  const spotsQuery = useQrSpots(visible ? brandId : null);
  const venuesQuery = useQrSpotVenues(visible ? brandId : null);
  const updateSpot = useUpdateQrSpot(brandId);
  const qrSheet = useQrSheet(brandId);

  const [pendingSpotId, setPendingSpotId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [servingPickerSpot, setServingPickerSpot] = useState<QrSpot | null>(
    null,
  );

  const venues = useMemo(() => venuesQuery.data ?? [], [venuesQuery.data]);
  const venueNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const venue of venues) map.set(venue.id, venue.name);
    return map;
  }, [venues]);
  const groups = useMemo(
    () => groupSpotsByVenue(spotsQuery.data ?? [], venues),
    [spotsQuery.data, venues],
  );
  const printableTotal = useMemo(
    () => groups.reduce((sum, group) => sum + group.activeCount, 0),
    [groups],
  );

  const openSheetUrl = useCallback(async (url: string): Promise<void> => {
    try {
      await Linking.openURL(url);
    } catch {
      setActionError(
        "The sheet is ready but this device couldn't open it. Try again.",
      );
    }
  }, []);

  const print = useCallback(
    (request: Parameters<typeof qrSheet.mutate>[0], spotId: string | null) => {
      setActionError(null);
      setPendingSpotId(spotId ?? "__bulk__");
      qrSheet.mutate(request, {
        onSuccess: (result) => {
          setPendingSpotId(null);
          void openSheetUrl(result.signedUrl);
        },
        onError: () => {
          setPendingSpotId(null);
          // The exact staff copy from SPEC #1788 P-29.
          setActionError("The sheet didn't render. Try again.");
        },
      });
    },
    [qrSheet, openSheetUrl],
  );

  const toggleSpotActive = useCallback(
    (spot: QrSpot): void => {
      setActionError(null);
      setPendingSpotId(spot.id);
      updateSpot.mutate(
        { id: spot.id, isActive: !spot.isActive },
        {
          onSuccess: () => setPendingSpotId(null),
          onError: () => {
            setPendingSpotId(null);
            setActionError("Couldn't save. Check your connection and try again.");
          },
        },
      );
    },
    [updateSpot],
  );

  const chooseServingVenue = useCallback(
    (spot: QrSpot, servingVenueId: string): void => {
      setActionError(null);
      setPendingSpotId(spot.id);
      updateSpot.mutate(
        // Re-pointing the kitchen also makes the room printable — that IS the
        // to-do being completed. The printed code is untouched, and is not even
        // in the update payload.
        { id: spot.id, servingVenueId, isActive: true },
        {
          onSuccess: () => {
            setPendingSpotId(null);
            setServingPickerSpot(null);
          },
          onError: () => {
            setPendingSpotId(null);
            setActionError("Couldn't save. Check your connection and try again.");
          },
        },
      );
    },
    [updateSpot],
  );

  const busy = qrSheet.isPending || updateSpot.isPending;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.9}
      testID={testID ?? "venue-spots-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>QR spots</Text>
        <Text style={styles.sub}>
          One list for the whole brand. Tables and rooms appear here on their
          own — print the codes and put them where guests sit.
        </Text>

        {actionError !== null ? (
          <Text style={styles.errorNote} testID="venue-spots-error">
            {actionError}
          </Text>
        ) : null}

        <ScrollView
          style={styles.scrollFlex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {spotsQuery.isLoading ? (
            <Text style={styles.muted} accessibilityLiveRegion="polite">
              Loading your spots…
            </Text>
          ) : spotsQuery.isError ? (
            <Text style={styles.errorNote}>
              Couldn&apos;t load your spots. Check your connection and try again.
            </Text>
          ) : groups.length === 0 ? (
            <GlassCard variant="base" style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No spots yet</Text>
              <Text style={styles.emptyBody}>
                Add a table, or name a room, and its QR spot appears here on its
                own. You never keep two lists.
              </Text>
            </GlassCard>
          ) : (
            groups.map((group) => (
              <View key={group.venueId} style={styles.group}>
                <View style={styles.groupHeader}>
                  <Text
                    style={styles.groupTitle}
                    accessibilityRole="header"
                    numberOfLines={1}
                  >
                    {group.venueName}
                  </Text>
                  <Text style={styles.groupMeta}>
                    {group.activeCount}{" "}
                    {group.activeCount === 1 ? "printing" : "printing"}
                    {group.needsAttentionCount > 0
                      ? ` · ${group.needsAttentionCount} to set up`
                      : ""}
                  </Text>
                </View>

                {canMutate && group.activeCount > 0 ? (
                  <Button
                    label={`Print ${group.venueName}`}
                    onPress={() => {
                      if (brandId === null) return;
                      print(bulkPrintRequest(brandId, group.venueId), null);
                    }}
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    style={styles.groupPrint}
                    testID={`venue-spots-print-venue-${group.venueId}`}
                  />
                ) : null}

                {group.spots.map((spot) => {
                  const needsChoice = spotNeedsServingChoice(spot);
                  const rowBusy = pendingSpotId === spot.id;
                  return (
                    <GlassCard
                      key={spot.id}
                      variant="base"
                      style={styles.spotCard}
                      testID={`venue-spot-${spot.id}`}
                    >
                      <View style={styles.spotRow}>
                        <View style={styles.spotLeft}>
                          <Text style={styles.spotLabel} numberOfLines={1}>
                            {spot.label}
                          </Text>
                          <Text style={styles.spotMeta} numberOfLines={2}>
                            {spotSubtitle(spot, {
                              servingVenueName: venueNameById.get(
                                spot.servingVenueId,
                              ),
                              servingMenuName: null,
                            })}
                          </Text>
                          {needsChoice ? (
                            <Text
                              style={styles.todo}
                              testID={`venue-spot-todo-${spot.id}`}
                            >
                              {SPOT_SERVING_TODO_LABEL}
                            </Text>
                          ) : null}
                        </View>

                        {canMutate ? (
                          <View style={styles.spotActions}>
                            {needsChoice ? (
                              <Pressable
                                onPress={() => setServingPickerSpot(spot)}
                                disabled={rowBusy}
                                accessibilityRole="button"
                                accessibilityLabel={`Choose which kitchen serves ${spot.label}`}
                                hitSlop={8}
                                style={({ pressed }) => [
                                  styles.action,
                                  pressed && styles.pressed,
                                ]}
                                testID={`venue-spot-choose-kitchen-${spot.id}`}
                              >
                                <Text style={styles.actionText}>Set up</Text>
                              </Pressable>
                            ) : (
                              <Pressable
                                onPress={() => {
                                  if (brandId === null) return;
                                  print(
                                    singlePrintRequest(brandId, spot.id),
                                    spot.id,
                                  );
                                }}
                                disabled={rowBusy || !isPrintable(spot)}
                                accessibilityRole="button"
                                accessibilityLabel={`Print the code for ${spot.label}`}
                                hitSlop={8}
                                style={({ pressed }) => [
                                  styles.action,
                                  (rowBusy || !isPrintable(spot)) &&
                                    styles.actionDisabled,
                                  pressed && styles.pressed,
                                ]}
                                testID={`venue-spot-print-${spot.id}`}
                              >
                                <Text style={styles.actionText}>Print</Text>
                              </Pressable>
                            )}
                            <Pressable
                              onPress={() => toggleSpotActive(spot)}
                              disabled={rowBusy}
                              accessibilityRole="switch"
                              accessibilityState={{ checked: spot.isActive }}
                              accessibilityLabel={
                                spot.isActive
                                  ? `${spot.label} is printing. Tap to stop printing it.`
                                  : `${spot.label} is not printing. Tap to include it.`
                              }
                              hitSlop={8}
                              style={({ pressed }) => [
                                styles.action,
                                pressed && styles.pressed,
                              ]}
                              testID={`venue-spot-active-${spot.id}`}
                            >
                              <Text
                                style={[
                                  styles.actionText,
                                  spot.isActive
                                    ? styles.actionOn
                                    : styles.actionOff,
                                ]}
                              >
                                {spot.isActive ? "On" : "Off"}
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>

                      {/*
                        Sub-sheets render INSIDE their parent (the shipped RN
                        rule), so the kitchen picker is an inline disclosure on
                        the row rather than a second Sheet over this one.
                      */}
                      {servingPickerSpot?.id === spot.id ? (
                        <View
                          style={styles.picker}
                          testID={`venue-spot-kitchen-picker-${spot.id}`}
                        >
                          <Text style={styles.pickerTitle}>
                            Which kitchen serves {spot.label}?
                          </Text>
                          {venues
                            .filter((venue) => venue.id !== spot.venueId)
                            .map((venue) => (
                              <Pressable
                                key={venue.id}
                                onPress={() =>
                                  chooseServingVenue(spot, venue.id)
                                }
                                disabled={rowBusy}
                                accessibilityRole="button"
                                accessibilityLabel={`${venue.name} serves ${spot.label}`}
                                style={({ pressed }) => [
                                  styles.pickerRow,
                                  pressed && styles.pressed,
                                ]}
                                testID={`venue-spot-kitchen-${spot.id}-${venue.id}`}
                              >
                                <Text style={styles.pickerRowText}>
                                  {venue.name}
                                </Text>
                              </Pressable>
                            ))}
                          {venues.filter((venue) => venue.id !== spot.venueId)
                            .length === 0 ? (
                            <Text style={styles.pickerEmpty}>
                              This brand has no other venue yet. Add the
                              restaurant that serves these rooms, then come back.
                            </Text>
                          ) : null}
                          <Button
                            label="Not now"
                            onPress={() => setServingPickerSpot(null)}
                            variant="ghost"
                            size="sm"
                            testID={`venue-spot-kitchen-cancel-${spot.id}`}
                          />
                        </View>
                      ) : null}
                    </GlassCard>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>

        {canMutate && printableTotal > 0 ? (
          <Button
            label={
              qrSheet.isPending
                ? "Building your sheet…"
                : `Print all ${printableTotal}`
            }
            onPress={() => {
              if (brandId === null) return;
              print(bulkPrintRequest(brandId, null), null);
            }}
            variant="primary"
            size="lg"
            fullWidth
            loading={qrSheet.isPending}
            disabled={busy}
            style={styles.printAll}
            testID="venue-spots-print-all"
          />
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  heading: {
    ...typography.h3,
    color: textTokens.primary,
  },
  sub: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.xxs,
    marginBottom: spacing.sm,
  },
  // Bound the scroll viewport to the panel so the CTA never overflows past the
  // panel's overflow:hidden (the ORCH-1193 sheet-cutoff contract).
  scrollFlex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  muted: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  errorNote: {
    ...typography.bodySm,
    color: semantic.error,
    marginBottom: spacing.xs,
  },
  emptyCard: {
    width: "100%",
    alignSelf: "stretch",
  },
  emptyTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  emptyBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.xxs,
  },
  group: {
    gap: spacing.xs,
  },
  groupHeader: {
    marginTop: spacing.sm,
  },
  groupTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  groupMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  groupPrint: {
    alignSelf: "flex-start",
  },
  // ORCH-1190 R2 — a row card needs BOTH: alignSelf stretches it regardless of
  // the ancestor's alignItems, width keeps it edge-to-edge when the parent IS
  // definite. Neither alone covers every container.
  spotCard: {
    width: "100%",
    alignSelf: "stretch",
  },
  spotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  spotLeft: {
    flex: 1,
  },
  spotLabel: {
    ...typography.body,
    color: textTokens.primary,
  },
  spotMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  todo: {
    ...typography.caption,
    color: semantic.warning,
    marginTop: spacing.xxs,
  },
  spotActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  actionText: {
    ...typography.buttonMd,
    color: textTokens.secondary,
  },
  actionOn: {
    color: semantic.success,
  },
  actionOff: {
    color: textTokens.quaternary,
  },
  pressed: {
    opacity: 0.6,
  },
  picker: {
    marginTop: spacing.sm,
    gap: spacing.xxs,
  },
  pickerTitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  pickerRow: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  pickerRowText: {
    ...typography.body,
    color: textTokens.primary,
  },
  pickerEmpty: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  printAll: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
});

export default VenueSpotsSheet;
