/**
 * VenueMapsActions — issue #2508 [maps-app-chooser].
 *
 * THE ONE implementation of the two affordances Seth asked for on every public
 * page that shows an offering address:
 *
 *   1. "Open in maps" ASKS WHICH APP (Apple Maps / Google Maps) instead of
 *      silently choosing one.
 *   2. A COPY button next to the address that puts the human address text on
 *      the clipboard, so it can be pasted into Waze, Citymapper, Uber, or a
 *      message to a friend.
 *
 * It lives here, next to `mapsDeepLink.ts`, because the four public renderers
 * that show an address (EventOfferingBody, RsvpOfferingBody, PublicEventPage,
 * brand-rendering's PublicVenueScreen) must behave IDENTICALLY. Forking the
 * behaviour so the explorer asks and the business app does not would be worse
 * than the feature — public offering pages hold parity across surfaces.
 *
 * PRIVACY — THE HARD ONE (#2489 / #2508)
 * --------------------------------------
 * Both affordances are gated by the SAME predicate that already gates the maps
 * link, and there is no second predicate anywhere: this module takes the
 * ALREADY-GATED `MapsOpenTarget` that `selectVenueMapsTarget()` returned, and
 * `null` means BOTH controls are gone. It never receives `locationGeo`, never
 * receives a raw address, and cannot re-derive either. A hide-address-until-
 * ticket offering therefore exposes no chooser and no copy button, structurally
 * rather than by remembering to check twice.
 *
 * NO URLS ARE BUILT HERE. `mapsDeepLink.ts` stays the single owner of every
 * maps URL (#2468); this file only asks it which apps can open the target.
 *
 * The two side effects — opening a URL and writing the clipboard — are HOST
 * effects, injected by the app exactly like #2468 injected `onOpenMaps`. The
 * package composes and renders; it does not touch `Linking` or `Clipboard`.
 */

import React from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Check, Copy, MapPin } from "./LucideIcons";
import {
  listMapsAppChoices,
  selectAddressCopyText,
  type MapsAppChoice,
  type MapsAppId,
  type MapsOpenTarget,
} from "./mapsDeepLink";
import { type ThemePalette } from "./themePalette";

/** How long the "Copied" / "Couldn't copy" confirm holds before reverting. */
const CONFIRM_HOLD_MS = 1600;

export type VenueCopyState = "idle" | "copied" | "failed";

export interface UseVenueMapsActionsParams {
  /**
   * The output of `selectVenueMapsTarget()` — ALREADY privacy-gated. `null`
   * means the address is withheld (or there is nothing to open) and NEITHER
   * control renders.
   */
  target: MapsOpenTarget | null;
  /**
   * The host effect that actually opens the link. `app` is `undefined` when
   * there was nothing to ask (a single openable app), which keeps the
   * pre-#2508 code path byte-identical on Android.
   */
  onOpenMaps?: (target: MapsOpenTarget, app?: MapsAppId) => void;
  /**
   * The host effect that writes the clipboard. Absent ⇒ no copy button, because
   * a copy control that cannot copy is a dead tap (Constitution #1).
   */
  onCopyAddress?: (text: string) => void | Promise<void>;
  /** Test seam. Defaults to `Platform.OS`. */
  platform?: string;
}

export interface VenueMapsActionsState {
  /** The apps that can ACTUALLY open this target on this platform. */
  choices: MapsAppChoice[];
  /** True ⇔ the "Open maps" control should render at all. */
  canOpenMaps: boolean;
  /** True ⇔ tapping "Open maps" asks first (more than one openable app). */
  offersChoice: boolean;
  chooserVisible: boolean;
  /** The address text the copy button writes, or null ⇔ no copy button. */
  copyText: string | null;
  canCopy: boolean;
  copyState: VenueCopyState;
  /** Bind to the venue card's onPress — asks, or opens directly. */
  requestOpenMaps: () => void;
  chooseApp: (app: MapsAppId) => void;
  dismissChooser: () => void;
  copyAddress: () => void;
}

/**
 * The controller. Every renderer calls this once and binds the returned
 * handlers, so the "ask, then open" and "copy, then confirm" logic exists once.
 */
export function useVenueMapsActions(
  params: UseVenueMapsActionsParams,
): VenueMapsActionsState {
  const { target, onOpenMaps, onCopyAddress } = params;
  const platform = params.platform ?? Platform.OS;

  const [chooserVisible, setChooserVisible] = React.useState<boolean>(false);
  const [copyState, setCopyState] = React.useState<VenueCopyState>("idle");
  const confirmTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending confirm must not fire into an unmounted tree, and must not
  // survive a navigation away from the page.
  React.useEffect(() => {
    return () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    };
  }, []);

  const choices = React.useMemo<MapsAppChoice[]>(() => {
    if (target === null) return [];
    return listMapsAppChoices({
      geo: target.geo,
      label: target.label,
      platform,
    });
  }, [platform, target]);

  const copyText = selectAddressCopyText(target);
  const canOpenMaps = choices.length > 0 && onOpenMaps !== undefined;
  const offersChoice = canOpenMaps && choices.length > 1;
  const canCopy = copyText !== null && onCopyAddress !== undefined;

  const requestOpenMaps = React.useCallback((): void => {
    if (target === null || onOpenMaps === undefined) return;
    if (choices.length > 1) {
      setChooserVisible(true);
      return;
    }
    // Exactly one openable app ⇒ nothing to ask. `app` stays undefined so the
    // host takes the identical #2468 path it always took (this is the Android
    // case, where the `geo:` intent already makes the OS offer every installed
    // map app — a one-row sheet in front of that would be pure ceremony).
    onOpenMaps(target);
  }, [choices.length, onOpenMaps, target]);

  const chooseApp = React.useCallback(
    (app: MapsAppId): void => {
      setChooserVisible(false);
      if (target === null || onOpenMaps === undefined) return;
      onOpenMaps(target, app);
    },
    [onOpenMaps, target],
  );

  const dismissChooser = React.useCallback((): void => {
    setChooserVisible(false);
  }, []);

  const holdConfirm = React.useCallback((next: VenueCopyState): void => {
    setCopyState(next);
    if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => {
      setCopyState("idle");
      confirmTimer.current = null;
    }, CONFIRM_HOLD_MS);
  }, []);

  const copyAddress = React.useCallback((): void => {
    if (copyText === null || onCopyAddress === undefined) return;
    // A copy control with no feedback reads as broken, and a copy that FAILED
    // silently is worse (Constitution #3) — so both outcomes are announced and
    // both are shown on the button itself.
    try {
      const result = onCopyAddress(copyText);
      if (result instanceof Promise) {
        void result.then(
          () => {
            holdConfirm("copied");
            AccessibilityInfo.announceForAccessibility("Address copied");
          },
          () => {
            holdConfirm("failed");
            AccessibilityInfo.announceForAccessibility(
              "Couldn't copy the address",
            );
          },
        );
        return;
      }
      holdConfirm("copied");
      AccessibilityInfo.announceForAccessibility("Address copied");
    } catch {
      holdConfirm("failed");
      AccessibilityInfo.announceForAccessibility("Couldn't copy the address");
    }
  }, [copyText, holdConfirm, onCopyAddress]);

  // Memoised: PublicVenueScreen threads this object through a `useMemo`'d
  // section-props bag, and a fresh object every render would defeat that memo
  // for every section on the page, not just the location card.
  return React.useMemo<VenueMapsActionsState>(
    () => ({
      choices,
      canOpenMaps,
      offersChoice,
      chooserVisible,
      copyText,
      canCopy,
      copyState,
      requestOpenMaps,
      chooseApp,
      dismissChooser,
      copyAddress,
    }),
    [
      canCopy,
      canOpenMaps,
      chooseApp,
      chooserVisible,
      choices,
      copyAddress,
      copyState,
      copyText,
      dismissChooser,
      offersChoice,
      requestOpenMaps,
    ],
  );
}

// ───────────────────────────────────────────────────────────────────────────
// The copy button.
//
// It is a SIBLING of the venue card, never a child of it: the card is itself a
// Pressable, and nesting a Pressable inside a Pressable flattens the
// accessibility subtree so a screen reader announces one merged control
// instead of two. It sits directly under the card, aligned to its left edge,
// in the pill vocabulary section 4 already uses (999 radius, accentWash fill,
// panelBorder hairline, 12/800 accent label).
// ───────────────────────────────────────────────────────────────────────────

export interface VenueCopyAddressButtonProps {
  actions: VenueMapsActionsState;
  palette: ThemePalette;
  /** The body's resolved bold family, so the label matches its siblings. */
  font?: string;
  testID?: string;
}

const COPY_LABEL: Readonly<Record<VenueCopyState, string>> = {
  idle: "Copy address",
  copied: "Copied",
  failed: "Couldn't copy",
};

export const VenueCopyAddressButton: React.FC<VenueCopyAddressButtonProps> = ({
  actions,
  palette,
  font,
  testID = "issue-2508-copy-address",
}) => {
  if (!actions.canCopy) return null;
  const state = actions.copyState;
  const label = COPY_LABEL[state];
  const Glyph = state === "copied" ? Check : Copy;
  const tint = state === "failed" ? palette.secondaryText : palette.accent;

  return (
    <View style={styles.actionsRow}>
      <Pressable
        onPress={actions.copyAddress}
        accessibilityRole="button"
        // The label carries the STATE, so a screen reader that re-reads the
        // button after the tap hears the confirmation too — not only the
        // one-shot announcement.
        accessibilityLabel={
          state === "copied"
            ? "Address copied"
            : state === "failed"
              ? "Couldn't copy the address, tap to try again"
              : "Copy address"
        }
        accessibilityHint="Copies the full address so you can paste it into any app"
        accessibilityLiveRegion="polite"
        // 12/800 text in a 9pt-padded pill is well under 44pt on its own; the
        // hit slop takes the real target past it without inflating the pill.
        hitSlop={12}
        style={({ pressed }) => [
          styles.copyPill,
          {
            backgroundColor: palette.accentWash,
            borderColor: palette.panelBorder,
          },
          pressed && styles.pressed,
        ]}
        testID={testID}
      >
        <Glyph size={14} color={tint} />
        <Text
          style={[
            styles.copyPillText,
            font === undefined ? null : { fontFamily: font },
            { color: tint },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// The chooser.
//
// Deliberately the SAME dialog language as RsvpGoingConfirmDialog — native
// <Modal>, fade, 0.55 scrim, page-filled card at 20 radius with a panelBorder
// hairline — because this package already has a decision dialog and a second
// visual dialect would be invention, not design. The two app rows are peers
// (accentWash + hairline), not one primary and one secondary: neither app is
// the "right" answer, that is the whole point of asking.
//
// Dismissible three ways: the scrim, the Cancel row, and Android's hardware
// back via `onRequestClose`.
// ───────────────────────────────────────────────────────────────────────────

export interface MapsAppChooserDialogProps {
  actions: VenueMapsActionsState;
  palette: ThemePalette;
  /** What the user is opening — the venue name, for the sheet's subtitle. */
  placeLabel?: string | null;
  font?: string;
  testID?: string;
}

export const MapsAppChooserDialog: React.FC<MapsAppChooserDialogProps> = ({
  actions,
  palette,
  placeLabel,
  font,
  testID = "issue-2508-maps-app-chooser",
}) => {
  // Never mount a chooser that has nothing to choose between.
  if (!actions.offersChoice) return null;
  const boldStyle = font === undefined ? null : { fontFamily: font };
  const subtitle =
    placeLabel !== null && placeLabel !== undefined && placeLabel.length > 0
      ? placeLabel
      : null;

  return (
    <Modal
      visible={actions.chooserVisible}
      transparent
      animationType="fade"
      onRequestClose={actions.dismissChooser}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.scrim}
        onPress={actions.dismissChooser}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Pressable
          style={[
            styles.chooserCard,
            { backgroundColor: palette.page, borderColor: palette.panelBorder },
          ]}
          onPress={() => undefined}
          testID={testID}
        >
          <Text
            style={[
              styles.chooserTitle,
              boldStyle,
              { color: palette.primaryText },
            ]}
          >
            Open in maps
          </Text>
          {subtitle !== null ? (
            <Text
              numberOfLines={2}
              style={[styles.chooserBody, { color: palette.secondaryText }]}
            >
              {subtitle}
            </Text>
          ) : null}

          {actions.choices.map((choice) => (
            <Pressable
              key={choice.id}
              onPress={() => actions.chooseApp(choice.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open in ${choice.label}`}
              style={({ pressed }) => [
                styles.chooserRow,
                {
                  backgroundColor: palette.accentWash,
                  borderColor: palette.panelBorder,
                },
                pressed && styles.pressed,
              ]}
              testID={`issue-2508-maps-app-${choice.id}`}
            >
              <MapPin size={18} color={palette.accent} />
              <Text
                style={[
                  styles.chooserRowText,
                  boldStyle,
                  { color: palette.primaryText },
                ]}
              >
                {choice.label}
              </Text>
            </Pressable>
          ))}

          <Pressable
            onPress={actions.dismissChooser}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={styles.chooserCancel}
            testID="issue-2508-maps-app-cancel"
          >
            <Text
              style={[
                styles.chooserCancelText,
                { color: palette.secondaryText },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  copyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  copyPillText: { fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.7 },
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  chooserCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
  },
  chooserTitle: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  chooserBody: { fontSize: 15, lineHeight: 21, marginBottom: 4 },
  chooserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 15,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  chooserRowText: { fontSize: 16, fontWeight: "900" },
  chooserCancel: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    marginTop: 6,
  },
  chooserCancelText: { fontSize: 14, fontWeight: "700" },
});
