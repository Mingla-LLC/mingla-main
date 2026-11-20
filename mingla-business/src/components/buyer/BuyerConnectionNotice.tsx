/**
 * BuyerConnectionNotice — #4518: ONE notice for every "couldn't connect"
 * moment a buyer meets on public pages and checkout.
 *
 *   variant  "connection" (no answer) | "server" (the server answered with an
 *            error) | "accessCheck" (a restricted sale could not be checked)
 *
 * TWO LAYERS, so the boot payload stays small and the notice still works
 * with no network at all:
 *   - THIS eager shell owns the retry state (idle → "Trying again…" in the
 *     same render as the tap, held ≥ 600 ms → "Still can't connect") and
 *     draws a COMPLETE plain notice: approved copy, a working Try again,
 *     Back when given, colours from the surface tokens. It is what a fully
 *     offline buyer gets, and it never depends on a chunk loading.
 *   - `BuyerConnectionNoticeFull` (the designed card: motion, glyph, page /
 *     checkout layouts) is an enhancement, preloaded when the page goes idle
 *     (`preloadBuyerConnectionNotice`). It draws the same state, so swapping
 *     in mid-retry loses nothing. If its chunk cannot load, the plain notice
 *     simply stays.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { color, themedStyles } from "../../theme/surfaceTokens";
import { BUYER_CONNECTION_COPY as COPY } from "./buyerConnectionCopy";

export type BuyerConnectionNoticeVariant = "connection" | "server" | "accessCheck";
export type BuyerConnectionNoticeLayout = "page" | "checkout" | "inline";

export interface BuyerConnectionNoticeProps {
  variant: BuyerConnectionNoticeVariant;
  onRetry: () => Promise<unknown> | void;
  onBack?: () => void;
  layout?: BuyerConnectionNoticeLayout;
  testID?: string;
  /** Defaults to `${testID}-retry` (the #2101 notice keeps its own id). */
  retryTestID?: string;
}

/** What either layer draws: the shell's copy and retry state. */
export interface BuyerConnectionNoticeViewProps
  extends Omit<BuyerConnectionNoticeProps, "onRetry"> {
  title: string;
  body: string;
  retrying: boolean;
  fails: number;
  onTryAgain: () => void;
}

/** Retrying is held at least this long so a fast failure still reads as one. */
export const MIN_RETRY_MS = 600;

type FullView = React.ComponentType<BuyerConnectionNoticeViewProps>;
let full: FullView | null = null;
let loading: Promise<FullView | null> | null = null;

const loadFull = (): Promise<FullView | null> =>
  (loading ??= import("./BuyerConnectionNoticeFull").then(
    (m) => (full = m.BuyerConnectionNoticeFull),
    () => (loading = null),
  ));

/**
 * Called by buyer routes on mount: fetch the designed notice once the page
 * is idle (never during first paint). Best effort; the plain notice needs
 * nothing from it.
 */
export function preloadBuyerConnectionNotice(): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback;
  if (idle) idle(() => void loadFull());
  else setTimeout(() => void loadFull(), 2000);
}

export function BuyerConnectionNotice(props: BuyerConnectionNoticeProps): React.ReactElement {
  const { variant, onRetry, onBack, testID = "buyer-connection-notice" } = props;
  const [retrying, setRetrying] = useState(false);
  const [fails, setFails] = useState(0);
  const [Full, setFull] = useState<FullView | null>(() => full);
  const live = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    live.current = true;
    if (full === null) {
      void loadFull().then((loaded) => {
        if (live.current && loaded) setFull(() => loaded);
      });
    }
    return () => {
      live.current = false;
    };
  }, []);

  const onTryAgain = useCallback((): void => {
    // No dead taps: a tap while retrying is ignored (and shown disabled).
    if (busy.current) return;
    busy.current = true;
    setRetrying(true);
    const started = Date.now();
    void Promise.resolve()
      .then(onRetry)
      .catch(() => undefined)
      .then(() => new Promise((r) => setTimeout(r, MIN_RETRY_MS - (Date.now() - started))))
      .then(() => {
        busy.current = false;
        // Success unmounts this notice; still here means it did not get through.
        if (!live.current) return;
        setRetrying(false);
        setFails((n) => n + 1);
      });
  }, [onRetry]);

  const view: BuyerConnectionNoticeViewProps = {
    ...props,
    testID,
    title:
      variant === "server" ? COPY.SERVER_TITLE : fails > 0 ? COPY.STILL_TITLE : COPY.CONNECTION_TITLE,
    body:
      variant === "server"
        ? COPY.SERVER_BODY
        : variant === "accessCheck"
          ? COPY.ACCESS_CHECK_BODY
          : COPY.CONNECTION_BODY,
    retrying,
    fails,
    onTryAgain,
  };
  return Full !== null ? <Full {...view} /> : <BuyerConnectionNoticePlain {...view} />;
}

/** The plain notice: complete on its own, no network needed. */
export function BuyerConnectionNoticePlain(view: BuyerConnectionNoticeViewProps): React.ReactElement {
  const { variant, onBack, retrying, fails, onTryAgain, testID = "buyer-connection-notice" } = view;
  const s = plain;
  return (
    <View style={s.card} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      <Text key={`t${fails}`} style={s.title} accessibilityRole="header" testID={`${testID}-title`}>
        {view.title}
      </Text>
      <Text key={`b${fails}`} style={s.body} testID={`${testID}-body`}>
        {view.body}
      </Text>
      <View style={s.row}>
        <Pressable
          onPress={onTryAgain}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLabel={COPY.TRY_AGAIN_A11Y}
          accessibilityState={{ disabled: retrying, busy: retrying }}
          testID={view.retryTestID ?? `${testID}-retry`}
          style={[s.btn, s.primary]}
        >
          {retrying ? <ActivityIndicator size="small" color={color.ink} /> : null}
          <Text style={s.primaryLabel}>{retrying ? COPY.TRYING_AGAIN : COPY.TRY_AGAIN}</Text>
        </Pressable>
        {onBack !== undefined && variant !== "accessCheck" ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={COPY.BACK}
            testID={`${testID}-back`}
            style={[s.btn, s.secondary]}
          >
            <Text style={s.secondaryLabel}>{COPY.BACK}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const plain = themedStyles(() =>
  StyleSheet.create({
    card: {
      margin: 16,
      padding: 20,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: color.controlOutline,
      backgroundColor: color.card,
    },
    title: { fontSize: 20, fontWeight: "700", color: color.text1 },
    body: { fontSize: 15, lineHeight: 20, marginTop: 8, color: color.text2 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 20 },
    btn: {
      minHeight: 48,
      paddingHorizontal: 20,
      borderRadius: 999,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    primary: { backgroundColor: color.paper },
    primaryLabel: { fontSize: 16, fontWeight: "600", color: color.ink },
    secondary: { borderWidth: 1, borderColor: color.controlOutline },
    secondaryLabel: { fontSize: 16, fontWeight: "600", color: color.text1 },
  }),
);

export default BuyerConnectionNotice;
