/**
 * SeeWhosGoingGate — ORCH-1342 [web-see-whos-going-funnel] (META-ORCH-1337
 * Leg 5; DESIGN §3 is the pixel contract).
 *
 * The buyer-web "See who's going" install gate: web-anon gets cluster faces +
 * the count on the card; NAMES LIVE IN THE APP (sealed D1). The tap opens THIS
 * gate — an honest invitation, NEVER a redirect (ORCH-1328 pattern: the event
 * page stays mounted) and NEVER a web guest list:
 *   - phone width  → §3.1 bottom slide-up interstitial (scrim + panel).
 *   - desktop      → §3.2 centered QR dialog (the /download visual language;
 *                    the solid-#ffffff QR card is the ONE sanctioned
 *                    non-palette fill — scanner hardware contrast).
 * Variant split: useResponsiveLayout().isDesktop — the SAME breakpoint the
 * public pages use for sticky-panel vs floating-dock (DESIGN §3.3, D9).
 *
 * The component owns platform detection, target resolution (ONE builder —
 * guestFunnelLink.resolveGuestFunnelTarget; the QR always encodes exactly the
 * URL the CTA opens in onelink mode, T-A7), the client-side open, and the
 * §4.4.3 (b)/(c) analytics. Mounts stay one-liners and fire (a) themselves.
 *
 * PRIVACY (I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS): the gate renders
 * NO guest identity text in ANY state — the mini-cluster echo consumes ONLY
 * `avatarUrl` from the server-filtered sample (SocialProofSampleEntry is a
 * hard {avatarUrl,isMinglaUser} whitelist; T-6 source-asserts no name token).
 *
 * `visible === false` → renders null (no touch-capturing residue — the
 * COMMS-0084 overlay lesson applied to web). All colors are `palette.*` reads
 * (biz-web hex hygiene) except the QR card white.
 *
 * Analytics ride `captureWeb` (posthog-js), the buyer-web capture facade —
 * `postHogService` is a deliberate NO-OP stub on the web export
 * (I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS), so the §4.4.3 events would
 * silently vanish through it. `captureWeb` no-ops on native, where this gate
 * never opens anyway (web-only wiring, DESIGN §1.5).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  boldFontFamily,
  useResponsiveLayout,
  type ResolvedTheme,
  type SocialProofSampleEntry,
  type ThemePalette,
} from "@mingla/offering-rendering";
// Deep import sanctioned by tsconfig paths + metro extraNodeModules — the
// helper is package-internal (not on the index barrel); duplicating the
// composite math here would drift from the DESIGN §3.1-bound token.
import { opaqueSurfaceColor } from "@mingla/offering-rendering/themePalette";
// ISSUE-1001 — the real wordmark replaces the "MINGLA" text kicker; tinted to
// the event-theme accent via the Image tintColor PROP (react-native-web 0.21
// implements the prop form; style.tintColor is deprecated there).
import { MINGLA_WORDMARK } from "@mingla/brand-assets";

import { captureWeb } from "../../analytics/webAnalytics";
import { APP_STORE_URL, PLAY_STORE_URL } from "../../constants/storeLinks";
import {
  detectClientPlatform,
  openExternal,
  resolveGuestFunnelTarget,
  type GuestFunnelEntity,
  type GuestFunnelTarget,
  type Platform as GuestPlatform,
} from "../../services/guestFunnelLink";
import { GateQr } from "./GateQr";

export interface SeeWhosGoingGateProps {
  visible: boolean;
  onClose: () => void;
  entity: GuestFunnelEntity;
  eventId: string;
  guestSample: SocialProofSampleEntry[];
  palette: ThemePalette;
  theme: ResolvedTheme;
}

type DismissMethod = "not_now" | "scrim" | "close" | "esc";

// DESIGN §3.1 motion: slide-up 240ms cubic-bezier(0.32,0.72,0,1); scrim 120ms.
const PANEL_SLIDE_MS = 240;
const SCRIM_FADE_MS = 120;
// DESIGN §3.2 motion: scale 0.96→1 + fade, 160ms ease-out.
const DIALOG_MS = 160;
// Generous off-screen start for the phone panel's translateY (panel height is
// content-sized; any value ≥ the tallest panel reads as "from below").
const PANEL_SLIDE_FROM = 560;

/** Web reduced-motion read (SheetMobile ORCH-1136 R3 pattern — no reanimated). */
function useReducedMotionWeb(): boolean {
  const [reduced, setReduced] = useState<boolean>(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const g = globalThis as unknown as {
      matchMedia?: (q: string) => {
        matches: boolean;
        addEventListener?: (t: string, l: () => void) => void;
        removeEventListener?: (t: string, l: () => void) => void;
      };
    };
    const mq = g.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (mq === undefined) return;
    setReduced(mq.matches);
    const listener = (): void => setReduced(mq.matches);
    mq.addEventListener?.("change", listener);
    return (): void => mq.removeEventListener?.("change", listener);
  }, []);
  return reduced;
}

/** The 30px disk row echoed from the card (DESIGN §3.1 — continuity: "these
 * people are in there"). Avatars ONLY (D1) — decorative, hidden from a11y (the
 * title carries the meaning). Renders nothing when the sample is empty. */
const MiniClusterEcho: React.FC<{
  palette: ThemePalette;
  guestSample: SocialProofSampleEntry[];
}> = ({ palette, guestSample }) => {
  const shown = guestSample.slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <View
      style={styles.echoRow}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shown.map((entry, i) => (
        <View
          key={`${i}-${entry.avatarUrl}`}
          style={[
            styles.echoDisk,
            {
              backgroundColor: palette.accent,
              borderColor: palette.page,
              marginLeft: i === 0 ? 0 : -8,
            },
          ]}
        >
          <Image
            source={{ uri: entry.avatarUrl }}
            style={styles.echoPhoto}
            resizeMode="cover"
          />
        </View>
      ))}
    </View>
  );
};

export const SeeWhosGoingGate: React.FC<SeeWhosGoingGateProps> = ({
  visible,
  onClose,
  entity,
  eventId,
  guestSample,
  palette,
  theme,
}) => {
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsiveLayout();
  const reducedMotion = useReducedMotionWeb();
  const boldFamily = boldFontFamily(theme);
  const variant: "phone_panel" | "desktop_qr" = isDesktop
    ? "desktop_qr"
    : "phone_panel";

  // ONE builder resolves both the CTA and the QR (T-A7 single-source rule).
  const resolved = useMemo<{ platform: GuestPlatform; target: GuestFunnelTarget }>(() => {
    const platform = detectClientPlatform();
    return { platform, target: resolveGuestFunnelTarget(entity, platform) };
  }, [entity]);

  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const panelTranslate = useRef(new Animated.Value(PANEL_SLIDE_FROM)).current;
  const dialogOpacity = useRef(new Animated.Value(0)).current;
  const dialogScale = useRef(new Animated.Value(0.96)).current;

  // Entry motion (DESIGN §3.1/§3.2; reduced-motion: fade-only, no slide/scale).
  // Every timing carries isInteraction:false (ORCH-1303 discipline — DESIGN §5).
  useEffect(() => {
    if (!visible) {
      scrimOpacity.setValue(0);
      panelTranslate.setValue(PANEL_SLIDE_FROM);
      dialogOpacity.setValue(0);
      dialogScale.setValue(0.96);
      return;
    }
    Animated.timing(scrimOpacity, {
      toValue: 1,
      duration: SCRIM_FADE_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
      isInteraction: false,
    }).start();
    if (isDesktop) {
      panelTranslate.setValue(0);
      Animated.timing(dialogOpacity, {
        toValue: 1,
        duration: DIALOG_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
        isInteraction: false,
      }).start();
      if (reducedMotion) {
        dialogScale.setValue(1);
      } else {
        Animated.timing(dialogScale, {
          toValue: 1,
          duration: DIALOG_MS,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }).start();
      }
      return;
    }
    dialogOpacity.setValue(1);
    dialogScale.setValue(1);
    if (reducedMotion) {
      // §3.1 reduced-motion: 120ms fade, no slide (the scrim timing above IS
      // the fade; the panel arrives in place).
      panelTranslate.setValue(0);
      return;
    }
    panelTranslate.setValue(PANEL_SLIDE_FROM);
    Animated.timing(panelTranslate, {
      toValue: 0,
      duration: PANEL_SLIDE_MS,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: true,
      isInteraction: false,
    }).start();
  }, [visible, isDesktop, reducedMotion, scrimOpacity, panelTranslate, dialogOpacity, dialogScale]);

  const dismiss = useCallback(
    (method: DismissMethod): void => {
      captureWeb("guest_gate_dismissed", {
        entity_type: entity.entityType,
        event_id: eventId,
        variant,
        method,
      });
      onClose();
    },
    [entity.entityType, eventId, variant, onClose],
  );
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  const handleGetApp = useCallback(
    (store?: "app_store" | "play"): void => {
      const { platform, target } = resolved;
      const dest =
        store === "app_store"
          ? APP_STORE_URL
          : store === "play"
            ? PLAY_STORE_URL
            : target.ctaUrl;
      captureWeb("guest_gate_get_app_clicked", {
        entity_type: entity.entityType,
        event_id: eventId,
        platform,
        mode: target.mode,
        store: store ?? target.store,
      });
      // ORCH-1328 pattern — client-side open ON the tap gesture; the event
      // page stays mounted behind the gate (never a redirect, DESIGN §3.1).
      openExternal(dest);
    },
    [resolved, entity.entityType, eventId],
  );

  // Desktop web a11y (DESIGN §3.2): Esc dismisses; focus is trapped in-dialog
  // and returned to the invoking control on close (document.activeElement at
  // open IS the invoking affordance).
  const dialogRef = useRef<View | null>(null);
  useEffect(() => {
    if (!visible || !isDesktop || Platform.OS !== "web") return;
    const g = globalThis as unknown as {
      document?: {
        activeElement?: { focus?: () => void } | null;
        addEventListener: (t: string, l: (e: KeyboardTrapEvent) => void) => void;
        removeEventListener: (t: string, l: (e: KeyboardTrapEvent) => void) => void;
      };
    };
    type KeyboardTrapEvent = {
      key: string;
      shiftKey?: boolean;
      preventDefault?: () => void;
    };
    const doc = g.document;
    if (doc === undefined) return;
    const invoker = doc.activeElement ?? null;
    const dialogNode = dialogRef.current as unknown as {
      focus?: () => void;
      querySelectorAll?: (sel: string) => ArrayLike<{ focus?: () => void }>;
      contains?: (n: unknown) => boolean;
    } | null;
    dialogNode?.focus?.();
    const handler = (event: KeyboardTrapEvent): void => {
      if (event.key === "Escape") {
        dismissRef.current("esc");
        return;
      }
      if (event.key !== "Tab" || dialogNode?.querySelectorAll === undefined) return;
      const focusables = dialogNode.querySelectorAll(
        'button, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        event.preventDefault?.();
        return;
      }
      const active = (doc.activeElement ?? null) as unknown;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey === true && active === first) {
        event.preventDefault?.();
        last.focus?.();
      } else if (event.shiftKey !== true && active === last) {
        event.preventDefault?.();
        first.focus?.();
      } else if (dialogNode.contains !== undefined && !dialogNode.contains(active)) {
        // Focus escaped the dialog — pull it back to the first control.
        event.preventDefault?.();
        first.focus?.();
      }
    };
    doc.addEventListener("keydown", handler);
    return (): void => {
      doc.removeEventListener("keydown", handler);
      invoker?.focus?.();
    };
  }, [visible, isDesktop]);

  // COMMS-0084 overlay lesson: hidden ⇒ NOTHING renders (no touch residue).
  if (!visible) return null;

  const panelFill = opaqueSurfaceColor(palette);

  const scrim = (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrimOpacity }]}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => dismiss("scrim")}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID="orch-1342-gate-scrim"
      />
    </Animated.View>
  );

  if (isDesktop) {
    // ── DESIGN §3.2 — desktop QR dialog (the /download rhythm, brand-toned) ──
    return (
      <View style={[StyleSheet.absoluteFill, styles.host]} testID="orch-1342-gate">
        {scrim}
        <View style={styles.dialogCenter} pointerEvents="box-none">
          <Animated.View
            ref={dialogRef}
            focusable
            accessibilityViewIsModal
            accessibilityLabel="See who's going"
            style={[
              styles.dialog,
              {
                backgroundColor: panelFill,
                borderColor: palette.panelBorder,
                opacity: dialogOpacity,
                transform: [{ scale: dialogScale }],
              },
            ]}
            testID="orch-1342-gate-dialog"
          >
            <Pressable
              onPress={() => dismiss("close")}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.dialogClose}
              testID="orch-1342-gate-close"
            >
              <Text style={[styles.dialogCloseGlyph, { color: palette.secondaryText }]}>
                ✕
              </Text>
            </Pressable>

            <Image
              source={MINGLA_WORDMARK}
              tintColor={palette.accent}
              style={styles.kickerLogo}
              resizeMode="contain"
              accessibilityLabel="Mingla"
            />
            <Text
              style={[styles.dialogTitle, { color: palette.primaryText, fontFamily: boldFamily }]}
              accessibilityRole="header"
            >
              See who's going
            </Text>
            <Text style={[styles.dialogBody, { color: palette.secondaryText }]}>
              RSVP or get a ticket, then open Mingla to see the guest list.
            </Text>
            <Text style={[styles.dialogBody, { color: palette.secondaryText }]}>
              Guest faces, names, and the group chat live in the Mingla app.
            </Text>
            <Text style={[styles.dialogBody, { color: palette.secondaryText }]}>
              Scan with your phone — the full guest list lives in the app.
            </Text>

            {/* The ONE deliberate non-palette fill: solid white QR card —
                scanner contrast is a hardware requirement (/download parity). */}
            <View style={styles.qrCard} testID="orch-1342-gate-qr">
              <GateQr value={resolved.target.qrUrl} size={180} />
            </View>

            <View style={styles.orRow}>
              <View style={[styles.orHairline, { backgroundColor: palette.panelBorder }]} />
              <Text style={[styles.orLabel, { color: palette.tertiaryText }]}>OR</Text>
              <View style={[styles.orHairline, { backgroundColor: palette.panelBorder }]} />
            </View>

            <View style={styles.badgeRow}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="App Store"
                onPress={() => handleGetApp("app_store")}
                style={({ pressed }) => [
                  styles.badge,
                  { borderColor: palette.panelBorder },
                  pressed ? styles.pressed : null,
                ]}
                testID="orch-1342-gate-badge-appstore"
              >
                <Text style={[styles.badgeText, { color: palette.primaryText }]}>
                  App Store
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Google Play"
                onPress={() => handleGetApp("play")}
                style={({ pressed }) => [
                  styles.badge,
                  { borderColor: palette.panelBorder },
                  pressed ? styles.pressed : null,
                ]}
                testID="orch-1342-gate-badge-play"
              >
                <Text style={[styles.badgeText, { color: palette.primaryText }]}>
                  Google Play
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </View>
    );
  }

  // ── DESIGN §3.1 — phone slide-up interstitial ──────────────────────────────
  return (
    <View style={[StyleSheet.absoluteFill, styles.host]} testID="orch-1342-gate">
      {scrim}
      <Animated.View
        accessibilityViewIsModal
        accessibilityLabel="See who's going"
        style={[
          styles.panel,
          {
            backgroundColor: panelFill,
            borderColor: palette.panelBorder,
            paddingBottom: 24 + insets.bottom,
            transform: [{ translateY: panelTranslate }],
          },
        ]}
        testID="orch-1342-gate-panel"
      >
        <View style={[styles.handle, { backgroundColor: palette.panelBorder }]} />
        <MiniClusterEcho palette={palette} guestSample={guestSample} />
        <Text
          style={[styles.panelTitle, { color: palette.primaryText, fontFamily: boldFamily }]}
          accessibilityRole="header"
        >
          See who's going
        </Text>
        <Text style={[styles.panelBody, { color: palette.secondaryText }]}>
          Guest names are visible in Mingla after you RSVP or get a ticket.
        </Text>
        <Text style={[styles.panelBody, { color: palette.secondaryText }]}>
          Guest faces, names, and the group chat live in the Mingla app.
        </Text>
        <Pressable
          onPress={() => handleGetApp()}
          accessibilityRole="button"
          accessibilityLabel="Get the app"
          style={({ pressed }) => [
            styles.primaryCta,
            { backgroundColor: palette.accent },
            pressed ? styles.pressed : null,
          ]}
          testID="orch-1342-gate-get-app"
        >
          <Text style={[styles.primaryCtaText, { color: palette.accentText }]}>
            Get the app
          </Text>
        </Pressable>
        <Pressable
          onPress={() => dismiss("not_now")}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          style={({ pressed }) => [styles.secondaryCta, pressed ? styles.pressed : null]}
          testID="orch-1342-gate-not-now"
        >
          <Text style={[styles.secondaryCtaText, { color: palette.secondaryText }]}>
            Not now
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    zIndex: 100,
  },
  scrim: {
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  // §3.1 phone panel.
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 999,
    marginBottom: 14,
  },
  echoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  echoDisk: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 2,
    overflow: "hidden",
  },
  echoPhoto: {
    ...StyleSheet.absoluteFillObject,
  },
  panelTitle: {
    fontSize: 22,
    fontWeight: "800",
    marginTop: 14,
  },
  panelBody: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
    marginTop: 6,
  },
  primaryCta: {
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  primaryCtaText: {
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryCta: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  secondaryCtaText: {
    fontSize: 14,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
  // §3.2 desktop dialog.
  dialogCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  dialog: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 28,
    borderWidth: 1,
    padding: 36,
  },
  dialogClose: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  dialogCloseGlyph: {
    fontSize: 20,
    fontWeight: "700",
  },
  // ISSUE-1001 — accent-tinted wordmark kicker (left-aligned like the Text
  // it replaced; dialogTitle's marginTop keeps the rhythm).
  kickerLogo: {
    width: 40,
    height: 14,
  },
  dialogTitle: {
    fontSize: 30,
    fontWeight: "800",
    marginTop: 10,
  },
  dialogBody: {
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 22,
    marginTop: 8,
  },
  qrCard: {
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 20,
    marginTop: 24,
  },
  orRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
  },
  orHairline: {
    flex: 1,
    height: 1,
  },
  orLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 20,
  },
  badge: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: "700",
  },
});

export default SeeWhosGoingGate;
