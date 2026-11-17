/**
 * #4420 (round-3 item 10, TILE_MATRIX P10) — the shared pieces of the trip,
 * experience and RSVP homes, so they read like the event home:
 *   - OfferingHomeHeader: the compact identity card (thumb, status, name,
 *     date line) that replaces the 200pt photo hero.
 *   - OfferingTilePage: the core tiles, then "More for this <kind>", laid in
 *     rows of three equal cells so every tile edge lines up with the card.
 *   - useOfferingPromote: the Promote tile's gate, status line and handler
 *     (same rank gate, lazy program owner and Blast › Overview route as the
 *     event home).
 */

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { color, radius, space, type } from "../../constants/designSystem";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { ActionTile } from "../event/ActionTile";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import type { EventCoverMediaType } from "../../store/draftEventStore";
import { GlassCard } from "../ui/GlassCard";
import type { IconName } from "../ui/Icon";

export interface OfferingHomeHeaderProps {
  hue: number;
  mediaUrl: string | null | undefined;
  mediaType: EventCoverMediaType | null | undefined;
  /** The status pill (each kind keeps its own pill component). */
  pill: React.ReactNode;
  title: string;
  subline: string;
  sublineTestID?: string;
  testID?: string;
}

export function OfferingHomeHeader({
  hue,
  mediaUrl,
  mediaType,
  pill,
  title,
  subline,
  sublineTestID,
  testID,
}: OfferingHomeHeaderProps): React.ReactElement {
  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={space[3]}
      contentStyle={styles.headerCard}
      testID={testID}
    >
      <View style={styles.headerThumb}>
        <EventCoverMedia
          hue={hue}
          mediaUrl={mediaUrl ?? null}
          mediaType={mediaType ?? null}
          radius={radius.sm}
          label=""
          height={56}
        />
      </View>
      <View style={styles.headerText}>
        <View style={styles.pillRow}>{pill}</View>
        <Text style={styles.headerTitle} numberOfLines={2}>
          {title}
        </Text>
        {subline.length > 0 ? (
          <Text style={styles.headerSubline} numberOfLines={1} testID={sublineTestID}>
            {subline}
          </Text>
        ) : null}
      </View>
    </GlassCard>
  );
}

export interface OfferingTile {
  key: string;
  icon: IconName;
  label: string;
  sub?: string;
  accessibilityLabel?: string;
  testID?: string;
  onPress: () => void;
}

export interface OfferingTilePageProps {
  core: readonly OfferingTile[];
  more: readonly OfferingTile[];
  /** e.g. "MORE FOR THIS TRIP". */
  moreLabel: string;
  testID?: string;
}

const COLUMNS = 3;

function TileRows({ tiles }: { tiles: readonly OfferingTile[] }): React.ReactElement {
  const rows = Math.ceil(tiles.length / COLUMNS);
  return (
    <View style={styles.tileRows}>
      {Array.from({ length: rows }, (_, row) => {
        const cells = tiles.slice(row * COLUMNS, row * COLUMNS + COLUMNS);
        return (
          <View key={cells.map((c) => c.key).join("-")} style={styles.tileRow}>
            {cells.map((tile) => (
              <ActionTile
                key={tile.key}
                fill
                icon={tile.icon}
                label={tile.label}
                sub={tile.sub}
                accessibilityLabel={tile.accessibilityLabel}
                testID={tile.testID}
                onPress={tile.onPress}
              />
            ))}
            {/* A short last row keeps its cells the same width. */}
            {Array.from({ length: COLUMNS - cells.length }, (_, pad) => (
              <View key={`pad-${pad}`} style={styles.tilePad} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

export function OfferingTilePage({
  core,
  more,
  moreLabel,
  testID,
}: OfferingTilePageProps): React.ReactElement {
  return (
    <View style={styles.page} testID={testID}>
      <TileRows tiles={core} />
      {more.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>{moreLabel}</Text>
          <TileRows tiles={more} />
        </>
      ) : null}
    </View>
  );
}

export interface OfferingPromote {
  enabled: boolean;
  status: string;
  open: () => void;
}

/**
 * The Promote tile for a trip, experience or RSVP home. Trips, experiences
 * and RSVPs are `events` rows, so the promotion overview and Blast › Overview
 * read them as `kind: "event"` (promotionOverview.ts maps every non-venue
 * listing to "event"). Loaded lazily so the home keeps the program services
 * out of its chunk.
 */
export function useOfferingPromote(
  brandId: string | null,
  listingId: string | null,
  rank: number,
): OfferingPromote {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("Get it seen");

  useEffect(() => {
    if (brandId === null || rank < 20) {
      setEnabled(false);
      return;
    }
    let active = true;
    const program = import("../programs/creatorProgramOwner");
    void Promise.all([
      program.then((mod) => mod.fetchCreatorGigsAccess(brandId)).catch(() => false),
      program.then((mod) => mod.fetchReferralAccess(brandId)).catch(() => false),
    ]).then(([creators, referrals]) => {
      if (active) setEnabled(creators || referrals);
    });
    return () => {
      active = false;
    };
  }, [brandId, rank]);

  useEffect(() => {
    if (!enabled || brandId === null || listingId === null) {
      setStatus("Get it seen");
      return;
    }
    let active = true;
    void import("../programs/creatorProgramOwner")
      .then(async (mod) => {
        const overview = await mod
          .fetchPromotionOverview(brandId, { kind: "event", id: listingId })
          .catch(() => null);
        if (active) setStatus(mod.promoteTileStatus(overview));
      })
      .catch(() => {
        if (active) setStatus("Get it seen");
      });
    return () => {
      active = false;
    };
  }, [enabled, brandId, listingId]);

  // Blast reads the current brand, so set it before opening Blast › Overview.
  const setCurrentBrandId = useCurrentBrandStore((s) => s.setCurrentBrandId);
  const open = useCallback((): void => {
    if (brandId === null || listingId === null) return;
    setCurrentBrandId(brandId);
    void import("../programs/creatorProgramOwner").then((mod) => {
      router.push(mod.blastOverviewHref({ kind: "event", id: listingId }) as never);
    });
  }, [brandId, listingId, router, setCurrentBrandId]);

  return { enabled, status, open };
}

const styles = StyleSheet.create({
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  headerThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  pillRow: {
    flexDirection: "row",
    marginBottom: space[1],
  },
  headerTitle: {
    ...type.row,
    color: color.text1,
  },
  headerSubline: {
    ...type.caption,
    color: color.text2,
    marginTop: 2,
  },
  page: {
    gap: space[3],
  },
  tileRows: {
    gap: space[3],
  },
  tileRow: {
    flexDirection: "row",
    gap: space[3],
  },
  tilePad: {
    flexBasis: 0,
    flexGrow: 1,
  },
  sectionLabel: {
    ...type.label,
    textTransform: "uppercase",
    color: color.text3,
    marginTop: space[2],
  },
});
