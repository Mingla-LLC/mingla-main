/**
 * PinDropSheet — Issue #1363 [three-tier address · Tier-3 pin-drop]
 *
 * STATIC-image tap-to-place map (SPEC §6, OQ-3 resolved: STATIC tap-to-place).
 * Renders the vendor-neutral `static-map` proxy image (`buildStaticMapUrl`) and
 * lets the brand TAP to recenter; the confirmed coordinate is always the current
 * map CENTER — a real point on a real Mapbox tile, never a confirm-time pixel
 * guess. No new native/map dependency (Expo SDK 54 is PINNED): the same code path
 * renders on business iOS, Android, AND web (`react-native-web` renders the plain
 * <Image> + <Pressable> unchanged — no `.web.tsx`, §6.5).
 *
 * The HOST owns the sheet's visibility (`visible`) and wires `onConfirm(lat,lng)`
 * to its flow's coordinate patch. Live pan/zoom WebGL is an explicit non-goal; if
 * ever wanted it slots behind this SAME `onConfirm(lat,lng)` contract.
 *
 * FAIL-SAFE (Constitution rule 9): if `buildStaticMapUrl` returns null (functions
 * base absent / non-finite coords) an honest "Map unavailable" state renders —
 * never a blank or fabricated tile.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";
import { staticMapPixelToLngLat } from "../../utils/staticMapPixelToLngLat";

export interface PinDropSheetProps {
  visible: boolean;
  /** Coarse center seed (Tier-2 result, device, or null → wide default). */
  initialLat: number | null;
  initialLng: number | null;
  onCancel: () => void;
  /** Returns the CURRENT MAP CENTER — always a real tile coordinate. */
  onConfirm: (lat: number, lng: number) => void;
  /** Pin/reticle color (brand accent). Defaults to the Mingla warm accent. */
  accentHex?: string;
}

// Integer zooms within the proxy's [0,22] allowlist (static-map/index.ts:85-86:
// MIN_ZOOM 0 / MAX_ZOOM 22 accept any integer). A wide-to-street ramp so the
// brand can zoom from a country view down to a street corner.
const ZOOM_LEVELS = [3, 6, 9, 11, 13, 15, 17] as const;
const DEFAULT_ZOOM_INDEX = 3; // 11 — the proxy's own default.
const WORLD_SEED = { lat: 20, lng: 0 } as const; // wide fallback when no seed.
const MAP_HEIGHT = 340;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export const PinDropSheet: React.FC<PinDropSheetProps> = ({
  visible,
  initialLat,
  initialLng,
  onCancel,
  onConfirm,
  accentHex = accent.warm,
}) => {
  const seededCenter = useMemo(
    () =>
      isFiniteNumber(initialLat) && isFiniteNumber(initialLng)
        ? { lat: initialLat, lng: initialLng }
        : { ...WORLD_SEED },
    [initialLat, initialLng],
  );
  const seededZoomIndex =
    isFiniteNumber(initialLat) && isFiniteNumber(initialLng)
      ? DEFAULT_ZOOM_INDEX
      : 0; // no seed → open at the widest level so the brand can find the area.

  const [center, setCenter] = useState<{ lat: number; lng: number }>(seededCenter);
  const [zoomIndex, setZoomIndex] = useState<number>(seededZoomIndex);
  const [layout, setLayout] = useState<{ w: number; h: number }>({
    w: 0,
    h: MAP_HEIGHT,
  });

  // Re-seed each time the sheet opens (a new open should start from the host's
  // latest seed, not a stale prior session's center).
  useEffect(() => {
    if (visible) {
      setCenter(seededCenter);
      setZoomIndex(seededZoomIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const zoom = ZOOM_LEVELS[zoomIndex];

  const mapUrl = buildStaticMapUrl({
    lat: center.lat,
    lng: center.lng,
    zoom,
    width: layout.w > 0 ? Math.round(layout.w) : 350,
    height: MAP_HEIGHT,
    accentHex,
  });

  const onMapLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setLayout({ w: width, h: height });
    }
  };

  const onMapPress = (evt: {
    nativeEvent: { locationX: number; locationY: number };
  }): void => {
    const { locationX, locationY } = evt.nativeEvent;
    if (
      !isFiniteNumber(locationX) ||
      !isFiniteNumber(locationY) ||
      layout.w <= 0 ||
      layout.h <= 0
    ) {
      return;
    }
    const next = staticMapPixelToLngLat({
      centerLat: center.lat,
      centerLng: center.lng,
      zoom,
      width: layout.w,
      height: layout.h,
      px: locationX,
      py: locationY,
    });
    setCenter({ lat: next.lat, lng: next.lng });
  };

  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;
  const canZoomOut = zoomIndex > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Close pin drop"
              hitSlop={10}
              style={styles.headerBtn}
            >
              <Icon name="close" size={20} color={textTokens.secondary} />
            </Pressable>
            <Text style={styles.title}>Drop a pin</Text>
            <View style={styles.headerBtn} />
          </View>
          <Text style={styles.subtitle}>
            Tap the map to move the pin to the exact spot, then use it.
          </Text>

          {/* Map area */}
          {mapUrl !== null ? (
            <View style={styles.mapWrap} onLayout={onMapLayout}>
              <Pressable
                onPress={onMapPress}
                accessibilityRole="adjustable"
                accessibilityLabel="Map — tap to place the pin"
                style={StyleSheet.absoluteFill}
              >
                <Image
                  source={{ uri: mapUrl }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  accessibilityLabel="Static map for pin placement"
                />
              </Pressable>

              {/* Fixed center reticle — "you are setting THIS point". */}
              <View pointerEvents="none" style={styles.reticleWrap}>
                <View
                  style={[styles.reticleRing, { borderColor: accentHex }]}
                />
                <View style={[styles.reticleDot, { backgroundColor: accentHex }]} />
              </View>

              {/* Zoom controls */}
              <View style={styles.zoomCol} pointerEvents="box-none">
                <Pressable
                  onPress={() =>
                    setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))
                  }
                  disabled={!canZoomIn}
                  accessibilityRole="button"
                  accessibilityLabel="Zoom in"
                  accessibilityState={{ disabled: !canZoomIn }}
                  style={[styles.zoomBtn, !canZoomIn && styles.zoomBtnDisabled]}
                >
                  <Text style={styles.zoomGlyph}>+</Text>
                </Pressable>
                <Pressable
                  onPress={() => setZoomIndex((i) => Math.max(0, i - 1))}
                  disabled={!canZoomOut}
                  accessibilityRole="button"
                  accessibilityLabel="Zoom out"
                  accessibilityState={{ disabled: !canZoomOut }}
                  style={[styles.zoomBtn, !canZoomOut && styles.zoomBtnDisabled]}
                >
                  <Text style={styles.zoomGlyph}>−</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={[styles.mapWrap, styles.mapUnavailable]}>
              <Icon name="location" size={24} color={textTokens.quaternary} />
              <Text style={styles.mapUnavailableText}>
                Map unavailable — try again in a moment.
              </Text>
            </View>
          )}

          {/* Footer actions */}
          <View style={styles.footer}>
            <Button
              label="Use this location"
              onPress={() => onConfirm(center.lat, center.lng)}
              variant="primary"
              size="lg"
              accentColor={accentHex}
            />
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={styles.cancelRow}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: glass.tint.profileElevated,
    borderTopLeftRadius: radiusTokens.xl,
    borderTopRightRadius: radiusTokens.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  subtitle: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
  },
  mapWrap: {
    height: MAP_HEIGHT,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  mapUnavailable: {
    gap: spacing.xs,
  },
  mapUnavailableText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.quaternary,
  },
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  reticleRing: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 3,
    backgroundColor: "transparent",
  },
  reticleDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  zoomCol: {
    position: "absolute",
    right: spacing.sm,
    bottom: spacing.sm,
    gap: spacing.xs,
  },
  zoomBtn: {
    width: 40,
    height: 40,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomBtnDisabled: {
    opacity: 0.4,
  },
  zoomGlyph: {
    fontSize: 24,
    lineHeight: 28,
    color: "#fff",
    fontWeight: "600",
  },
  footer: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  cancelRow: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  cancelText: {
    fontSize: typography.body.fontSize,
    color: textTokens.tertiary,
  },
});

export default PinDropSheet;
