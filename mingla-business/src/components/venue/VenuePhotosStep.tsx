/**
 * VenuePhotosStep (create s3) — META-ORCH-1290 Leg B (D-1 folded wizard).
 *
 * The create-path equivalent of claim c3 (ClaimStepPhotos), migrating the
 * deck-readiness gallery block INTO the wizard. Create has no adopted photos,
 * so this is the simple case: add / remove / reorder the operator's own
 * uploads on the top-level `draft.galleryUrls`. Everything is CLIENT-STAGED
 * until submit (submit persists via `syncGallery`).
 *
 * GALLERY_MIN (≥5) is enforced at go-live/approve, NOT at this step (SPEC
 * §4.3.A / OQ-7 converge-to-claim) — the counter shows "≥5 to go live"; the
 * step never hard-blocks. Reorder = long-press move-menu (WCAG 2.5.7, the
 * ClaimStepPhotos pattern), the only reorder input on every platform.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  pickGalleryPhotos,
  uploadGalleryPhoto,
  VenueGalleryError,
} from "../../services/venueGalleryService";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import {
  reorderGalleryUrls,
  type GalleryMoveAction,
  CLAIM_GALLERY_MIN,
  CLAIM_GALLERY_MAX,
} from "./claim/ClaimStepPhotos";

export interface VenuePhotosStepProps {
  brandId: string | null;
}

export const VenuePhotosStep: React.FC<VenuePhotosStepProps> = ({ brandId }) => {
  const gallery = useDraftVenueStore((s) => s.galleryUrls ?? []);
  const coverChoice = useDraftVenueStore((s) => s.coverChoice ?? null);
  const patch = useDraftVenueStore((s) => s.patch);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [movingUrl, setMovingUrl] = useState<string | null>(null);

  const setGallery = useCallback(
    (next: string[]): void => {
      patch({ galleryUrls: next });
    },
    [patch],
  );

  const handleRemove = useCallback(
    (url: string): void => {
      const cur = useDraftVenueStore.getState().galleryUrls ?? [];
      const nextCover =
        useDraftVenueStore.getState().coverChoice?.url === url
          ? null
          : useDraftVenueStore.getState().coverChoice ?? null;
      patch({
        galleryUrls: cur.filter((u) => u !== url),
        coverChoice: nextCover,
      });
      setMovingUrl(null);
    },
    [patch],
  );

  const handleMove = useCallback(
    (url: string, action: GalleryMoveAction): void => {
      const cur = useDraftVenueStore.getState().galleryUrls ?? [];
      setGallery(reorderGalleryUrls(cur, url, action));
      setMovingUrl(null);
    },
    [setGallery],
  );

  const handleAdd = useCallback(async (): Promise<void> => {
    if (brandId === null) return;
    const cur = useDraftVenueStore.getState().galleryUrls ?? [];
    const remaining = CLAIM_GALLERY_MAX - cur.length;
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
      const now = useDraftVenueStore.getState().galleryUrls ?? [];
      setGallery(
        Array.from(new Set([...now, ...uploaded])).slice(0, CLAIM_GALLERY_MAX),
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Couldn't add photos. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [brandId, setGallery]);

  const countOk = gallery.length >= CLAIM_GALLERY_MIN;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Your photos</Text>
      <Text style={styles.helper}>
        {gallery.length === 0
          ? `Add at least ${CLAIM_GALLERY_MIN} photos so people can picture your place.`
          : "Add your best shots. Reorder them so your strongest photo leads."}
      </Text>
      <Text style={[styles.counter, countOk && styles.counterOk]}>
        {gallery.length} photo{gallery.length === 1 ? "" : "s"} · at least{" "}
        {CLAIM_GALLERY_MIN} to go live
      </Text>

      {gallery.length > 0 ? (
        <View style={styles.grid}>
          {gallery.map((url, index) => {
            const held = movingUrl === url;
            const isCover = coverChoice?.url === url;
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
                  accessibilityLabel={`Photo ${index + 1} of ${gallery.length}. Opens the move menu.`}
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
                  {isCover ? (
                    <View style={styles.coverBadge}>
                      <Text style={styles.coverBadgeText}>Cover</Text>
                    </View>
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => handleRemove(url)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1} of ${gallery.length}`}
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
                    {index < gallery.length - 1 ? (
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

      <Button
        label={busy ? "Uploading..." : "Add photos"}
        variant={gallery.length === 0 ? "primary" : "secondary"}
        size="md"
        leadingIcon="upload"
        loading={busy}
        disabled={busy || gallery.length >= CLAIM_GALLERY_MAX || brandId === null}
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
  tileWrapHeld: {
    zIndex: 20,
  },
  tile: {
    width: 92,
    height: 92,
    borderRadius: 10,
    overflow: "hidden",
  },
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
  coverBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: accent.warm,
  },
  coverBadgeText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
    color: textTokens.inverse,
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
  warn: {
    fontSize: typography.caption.fontSize,
    color: "#F59E0B",
  },
});

export default VenuePhotosStep;
