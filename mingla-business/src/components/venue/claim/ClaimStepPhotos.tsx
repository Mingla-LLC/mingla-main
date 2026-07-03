/**
 * ClaimStepPhotos (c3) — ORCH-1263 DESIGN §6.4: the adopted gallery —
 * keep / delete / reorder / add. Everything here is CLIENT-STAGED (D-B
 * copy-on-start): nothing touches the live listing until submit → approve.
 *
 * Reorder (SPEC §B4 decision, OQ-4): NO drag dependency — long-press (300ms)
 * lifts the tile and opens the move menu (`Move earlier / Move later / Make
 * first`), the ONLY reorder input on ALL platforms (also the web/keyboard
 * path — WCAG 2.5.7). Order = the public gallery order; the first tile wears
 * a `1st` badge so order visibly matters.
 *
 * Removing an ADOPTED photo stages it into a "Removed" strip with per-photo
 * Undo (their photos are never silently gone); removing an upload just
 * removes it. GALLERY_MIN is enforced at go-live, not at claim — the counter
 * re-arms, the step never hard-blocks.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  pickGalleryPhotos,
  uploadGalleryPhoto,
  VenueGalleryError,
} from "../../../services/venueGalleryService";
import { useDraftVenueStore } from "../../../store/draftVenueStore";
import { Button } from "../../ui/Button";
import { EventCoverMedia } from "../../ui/EventCoverMedia";
import { ProvenanceChip } from "../../ui/ProvenanceChip";

// Mirrors the deck-readiness gallery bounds (edge GALLERY_MIN/GALLERY_MAX —
// duplicated because VenueDeckReadinessSetup is DO-NOT-TOUCH for this ORCH).
export const CLAIM_GALLERY_MIN = 5;
export const CLAIM_GALLERY_MAX = 20;

// ─── Pure helpers (unit-tested — T-B4) ──────────────────────────────────────

export type GalleryMoveAction = "earlier" | "later" | "first";

/** Move `url` within the ordered gallery. Unknown url / no-op moves return
 *  the same order. */
export function reorderGalleryUrls(
  urls: string[],
  url: string,
  action: GalleryMoveAction,
): string[] {
  const from = urls.indexOf(url);
  if (from < 0) return urls;
  const to = action === "first"
    ? 0
    : action === "earlier"
      ? Math.max(0, from - 1)
      : Math.min(urls.length - 1, from + 1);
  if (to === from) return urls;
  const next = [...urls];
  next.splice(from, 1);
  next.splice(to, 0, url);
  return next;
}

/** Adopted photos the operator removed (staged — derivable, never stored). */
export function removedAdoptedUrls(
  adoptedUrls: string[],
  keptUrls: string[],
): string[] {
  const kept = new Set(keptUrls);
  return adoptedUrls.filter((u) => !kept.has(u));
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface ClaimStepPhotosProps {
  brandId: string | null;
}

export const ClaimStepPhotos: React.FC<ClaimStepPhotosProps> = ({
  brandId,
}) => {
  const claim = useDraftVenueStore((s) => s.claim);
  const patch = useDraftVenueStore((s) => s.patch);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** URL whose move menu is open (the "held"/lifted tile). */
  const [movingUrl, setMovingUrl] = useState<string | null>(null);

  const kept = claim?.keptGalleryUrls ?? [];
  const added = new Set(claim?.addedGalleryUrls ?? []);
  const adoptedSet = new Set(claim?.adopted.galleryUrls ?? []);
  const removed = removedAdoptedUrls(
    claim?.adopted.galleryUrls ?? [],
    kept,
  );

  const patchClaim = useCallback(
    (next: Partial<NonNullable<typeof claim>>): void => {
      const cur = useDraftVenueStore.getState().claim;
      if (cur === null) return;
      patch({ claim: { ...cur, ...next } });
    },
    [patch],
  );

  const handleRemove = useCallback(
    (url: string): void => {
      const cur = useDraftVenueStore.getState().claim;
      if (cur === null) return;
      const nextKept = cur.keptGalleryUrls.filter((u) => u !== url);
      const nextAdded = cur.addedGalleryUrls.filter((u) => u !== url);
      // Removing the chosen cover un-chooses it (it left the gallery).
      const nextCover = cur.coverChoice?.url === url ? null : cur.coverChoice;
      patchClaim({
        keptGalleryUrls: nextKept,
        addedGalleryUrls: nextAdded,
        coverChoice: nextCover,
      });
      setMovingUrl(null);
    },
    [patchClaim],
  );

  const handleUndoRemove = useCallback(
    (url: string): void => {
      const cur = useDraftVenueStore.getState().claim;
      if (cur === null) return;
      if (cur.keptGalleryUrls.includes(url)) return;
      patchClaim({ keptGalleryUrls: [...cur.keptGalleryUrls, url] });
    },
    [patchClaim],
  );

  const handleMove = useCallback(
    (url: string, action: GalleryMoveAction): void => {
      const cur = useDraftVenueStore.getState().claim;
      if (cur === null) return;
      patchClaim({
        keptGalleryUrls: reorderGalleryUrls(cur.keptGalleryUrls, url, action),
      });
      setMovingUrl(null);
    },
    [patchClaim],
  );

  const handleAdd = useCallback(async (): Promise<void> => {
    if (brandId === null) return;
    const cur = useDraftVenueStore.getState().claim;
    if (cur === null) return;
    const remaining = CLAIM_GALLERY_MAX - cur.keptGalleryUrls.length;
    if (remaining <= 0) {
      setMessage(`You can add up to ${CLAIM_GALLERY_MAX} photos.`);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const picked = await pickGalleryPhotos(remaining);
      if (picked.length === 0) return;
      const uploaded: string[] = [];
      for (const asset of picked) {
        try {
          uploaded.push(await uploadGalleryPhoto(brandId, asset));
        } catch (e) {
          setMessage(
            e instanceof VenueGalleryError
              ? e.message
              : "A photo failed to upload.",
          );
        }
      }
      if (uploaded.length === 0) return;
      const now = useDraftVenueStore.getState().claim;
      if (now === null) return;
      patchClaim({
        keptGalleryUrls: Array.from(
          new Set([...now.keptGalleryUrls, ...uploaded]),
        ).slice(0, CLAIM_GALLERY_MAX),
        addedGalleryUrls: Array.from(
          new Set([...now.addedGalleryUrls, ...uploaded]),
        ),
      });
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Couldn't add photos. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [brandId, patchClaim]);

  const countOk = kept.length >= CLAIM_GALLERY_MIN;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Your photos</Text>
      <Text style={styles.helper}>
        {kept.length === 0 && removed.length === 0
          ? `No photos on file — add at least ${CLAIM_GALLERY_MIN} so people can picture your place.`
          : "These are already on your Mingla listing. Remove any that shouldn't be here, reorder them, add better ones."}
      </Text>
      <Text style={[styles.counter, countOk && styles.counterOk]}>
        {kept.length} photo{kept.length === 1 ? "" : "s"} · at least{" "}
        {CLAIM_GALLERY_MIN} to go live
      </Text>

      {kept.length > 0 ? (
        <View style={styles.grid}>
          {kept.map((url, index) => {
            const isNew = added.has(url);
            const isAdopted = adoptedSet.has(url);
            const held = movingUrl === url;
            return (
              <View
                key={url}
                style={[styles.tileWrap, held && styles.tileWrapHeld]}
              >
                <Pressable
                  onLongPress={() => setMovingUrl(url)}
                  delayLongPress={300}
                  onPress={() => setMovingUrl((m) => (m === url ? null : url))}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${index + 1} of ${kept.length}. Opens the move menu.`}
                  style={[styles.tile, held && styles.tileHeld]}
                >
                  <EventCoverMedia
                    hue={25}
                    mediaUrl={url}
                    mediaType="image"
                    radius={10}
                    label={`Venue photo ${index + 1}`}
                    height={92}
                    width={92}
                  />
                  {index === 0 ? (
                    <View style={styles.firstBadge}>
                      <Text style={styles.firstBadgeText}>1st</Text>
                    </View>
                  ) : null}
                  {isNew ? (
                    <View style={styles.tileChip}>
                      <ProvenanceChip state="new" scrim />
                    </View>
                  ) : isAdopted ? (
                    <View style={styles.tileChip}>
                      <ProvenanceChip state="adopted" scrim />
                    </View>
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => handleRemove(url)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1} of ${kept.length}`}
                  hitSlop={10}
                  style={styles.remove}
                >
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
                {held ? (
                  <View style={styles.moveMenu}>
                    {index > 0 ? (
                      <Pressable
                        onPress={() => handleMove(url, "earlier")}
                        accessibilityRole="button"
                        accessibilityLabel="Move earlier"
                        style={styles.moveItem}
                      >
                        <Text style={styles.moveItemText}>Move earlier</Text>
                      </Pressable>
                    ) : null}
                    {index < kept.length - 1 ? (
                      <Pressable
                        onPress={() => handleMove(url, "later")}
                        accessibilityRole="button"
                        accessibilityLabel="Move later"
                        style={styles.moveItem}
                      >
                        <Text style={styles.moveItemText}>Move later</Text>
                      </Pressable>
                    ) : null}
                    {index > 0 ? (
                      <Pressable
                        onPress={() => handleMove(url, "first")}
                        accessibilityRole="button"
                        accessibilityLabel="Make first"
                        style={styles.moveItem}
                      >
                        <Text style={styles.moveItemText}>Make first</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {removed.length > 0 ? (
        <View style={styles.removedStrip}>
          <Text style={styles.removedTitle}>
            Removed · they stay off your listing after approval
          </Text>
          {removed.map((url) => (
            <View key={url} style={styles.removedRow}>
              <EventCoverMedia
                hue={25}
                mediaUrl={url}
                mediaType="image"
                radius={6}
                label="Removed photo"
                height={40}
                width={40}
              />
              <Text style={styles.removedLabel} numberOfLines={1}>
                Removed photo
              </Text>
              <Pressable
                onPress={() => handleUndoRemove(url)}
                accessibilityRole="button"
                accessibilityLabel="Undo remove"
                hitSlop={10}
                style={styles.undoBtn}
              >
                <Text style={styles.undoText}>Undo</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Button
        label={busy ? "Uploading..." : "Add photos"}
        variant={kept.length === 0 ? "primary" : "secondary"}
        size="md"
        leadingIcon="upload"
        loading={busy}
        disabled={busy || kept.length >= CLAIM_GALLERY_MAX || brandId === null}
        onPress={() => void handleAdd()}
      />
      {message !== null ? <Text style={styles.warn}>{message}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  counter: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  counterOk: {
    color: "#22c55e",
    fontWeight: "700",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tileWrap: {
    width: 92,
    height: 92,
  },
  // The open move menu must float over later siblings in the wrap grid.
  tileWrapHeld: {
    zIndex: 20,
  },
  tile: {
    width: 92,
    height: 92,
    borderRadius: 10,
    overflow: "hidden",
  },
  // Reduced-motion-safe "held" treatment (M-4 fallback): 2px accent border.
  tileHeld: {
    borderWidth: 2,
    borderColor: accent.warm,
  },
  firstBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  firstBadgeText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
    color: textTokens.secondary,
  },
  tileChip: {
    position: "absolute",
    bottom: 4,
    left: 4,
  },
  remove: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: {
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "700",
  },
  moveMenu: {
    position: "absolute",
    top: 92 + spacing.xs,
    left: 0,
    minWidth: 140,
    borderRadius: 10,
    backgroundColor: "#191c21",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingVertical: spacing.xs,
    zIndex: 10,
    elevation: 10,
  },
  moveItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  moveItemText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  removedStrip: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  removedTitle: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  removedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  removedLabel: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  undoBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  undoText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  warn: {
    fontSize: typography.caption.fontSize,
    color: "#F59E0B",
  },
});

export default ClaimStepPhotos;
