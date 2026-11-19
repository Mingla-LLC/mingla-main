/**
 * BuyerConnectionNotice — #4518: ONE notice for every "couldn't connect"
 * moment a buyer meets on public pages and checkout.
 *
 * Replaces seven different error blocks ("Event could not load", "Couldn't
 * load trip" + a raw "TypeError: Failed to fetch", "Tickets could not load",
 * …) and the restricted-sale "We couldn't check this sale" state. The words
 * live in `buyerConnectionCopy.ts`; layout, tokens and motion follow the
 * approved design artifact (#4518 notice design, build spec table).
 *
 *   variant  "connection"   the request never got an answer
 *            "server"       the server answered with an error
 *            "accessCheck"  a restricted sale could not be checked (inline)
 *   layout   "page"     public route: card centred, top at 22 % of the space
 *            "checkout" under the unchanged CheckoutHeader, 24 below it
 *            "inline"   in the page body (accessCheck)
 *
 * STATES. idle → retrying (same frame as the tap: "Trying again…", spinner,
 * disabled + busy, held at least 600 ms so a fast failure still reads as a
 * retry) → failed again (title becomes "Still can't connect", title and body
 * re-announced). Success: the parent renders the page and this unmounts.
 *
 * EAGER, never lazy: when our own site is also unreachable a lazy chunk
 * cannot load, and this is exactly what must render then.
 *
 * Colour comes from the surface tokens only (I-CHECKOUT-ONE-COLOUR-OWNER):
 * inside a checkout flow they are the host palette, elsewhere Graphite.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { durations, motion, radius, size, space, type } from "../../constants/designSystem";
import { useReduceMotion } from "../../hooks/useMotionPreferences";
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

/** Retrying is held at least this long so a fast failure still reads as one. */
export const MIN_RETRY_MS = 600;
const WIDE_MIN = 768;

const SignalGlyph = ({ px, tint }: { px: number; tint: string }): React.ReactElement => (
  <Svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={1.75} strokeLinecap="round">
    <Path d="M5 19v-3" />
    <Path d="M10 19v-6" />
    <Path d="M15 19v-9" strokeOpacity={0.35} />
    <Path d="M20 19V7" strokeOpacity={0.35} />
  </Svg>
);

const ServerGlyph = ({ px, tint }: { px: number; tint: string }): React.ReactElement => (
  <Svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={1.75} strokeLinecap="round">
    <Circle cx={12} cy={12} r={8.5} />
    <Path d="M12 7.5v5.5" />
    <Path d="M12 16.4v.1" />
  </Svg>
);

export const BuyerConnectionNotice: React.FC<BuyerConnectionNoticeProps> = ({
  variant,
  onRetry,
  onBack,
  layout = variant === "accessCheck" ? "inline" : onBack !== undefined ? "checkout" : "page",
  testID = "buyer-connection-notice",
  retryTestID,
}) => {
  const { width, height } = useWindowDimensions();
  const wide = Platform.OS === "web" && width >= WIDE_MIN;
  const reduceMotion = useReduceMotion();
  const inline = layout === "inline";

  const [retrying, setRetrying] = useState(false);
  const [fails, setFails] = useState(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Mount: opacity 0→1 + translateY 8→0 over 260 ms (reduced: opacity, 80 ms).
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? durations.instant : durations.entry,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [enter, reduceMotion]);

  // Failed again: title and body fade 0.35→1 over 200 ms (reduced: none).
  const refresh = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (fails === 0 || reduceMotion) return;
    refresh.setValue(0.35);
    Animated.timing(refresh, {
      toValue: 1,
      duration: durations.normal,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [fails, reduceMotion, refresh]);

  // Full-page notices move focus to the title once on web; inline never does.
  const titleRef = useRef<Text>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || inline) return;
    const node = titleRef.current as unknown as { focus?: () => void } | null;
    node?.focus?.();
  }, [inline]);

  const handleRetry = useCallback((): void => {
    // No dead taps: a tap while retrying is ignored, and the control shows
    // it is disabled.
    if (busy.current) return;
    busy.current = true;
    setRetrying(true);
    const started = Date.now();
    let attempt: Promise<unknown>;
    try {
      attempt = Promise.resolve(onRetry());
    } catch (error) {
      attempt = Promise.reject(error);
    }
    void attempt
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve) =>
            setTimeout(resolve, Math.max(0, MIN_RETRY_MS - (Date.now() - started))),
          ),
      )
      .then(() => {
        busy.current = false;
        // Success unmounts this notice (the parent renders the page). Still
        // mounted means the retry did not get through: say so again.
        if (!mounted.current) return;
        setRetrying(false);
        setFails((n) => n + 1);
      });
  }, [onRetry]);

  const title =
    variant === "server"
      ? COPY.SERVER_TITLE
      : fails > 0
        ? COPY.STILL_TITLE
        : COPY.CONNECTION_TITLE;
  const body =
    variant === "server"
      ? COPY.SERVER_BODY
      : variant === "accessCheck"
        ? COPY.ACCESS_CHECK_BODY
        : COPY.CONNECTION_BODY;

  const styles = noticeStyles;
  const glyphPx = inline ? 18 : 22;
  const glyph =
    variant === "server" ? (
      <ServerGlyph px={glyphPx} tint={color.text2} />
    ) : (
      <SignalGlyph px={glyphPx} tint={color.text2} />
    );

  const tryAgain = (
    <Pressable
      onPress={handleRetry}
      disabled={retrying}
      accessibilityRole="button"
      accessibilityLabel={COPY.TRY_AGAIN_A11Y}
      accessibilityState={{ disabled: retrying, busy: retrying }}
      testID={retryTestID ?? `${testID}-retry`}
      style={({ pressed }) => [
        styles.button,
        styles.primary,
        inline ? styles.inlineButton : wide ? styles.primaryWide : styles.primaryPhone,
        !inline && !wide ? styles.phoneHeight : styles.webHeight,
        pressed && !retrying ? styles.pressed : null,
      ]}
    >
      {retrying ? <ActivityIndicator size="small" color={color.ink} testID={`${testID}-spinner`} /> : null}
      <Text style={[styles.primaryLabel, retrying ? styles.labelBusy : null]}>
        {retrying ? COPY.TRYING_AGAIN : COPY.TRY_AGAIN}
      </Text>
    </Pressable>
  );

  const back =
    onBack !== undefined && !inline ? (
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={COPY.BACK}
        testID={`${testID}-back`}
        style={({ pressed }) => [
          styles.button,
          styles.secondary,
          !wide ? styles.phoneHeight : styles.webHeight,
          pressed ? styles.pressed : null,
        ]}
      >
        <Text style={styles.secondaryLabel}>{COPY.BACK}</Text>
      </Pressable>
    ) : null;

  const copyBlock = (
    <Animated.View style={{ opacity: refresh }}>
      <Text
        key={`title-${fails}`}
        ref={titleRef}
        accessibilityRole="header"
        style={inline ? styles.inlineTitle : wide ? styles.titleWide : styles.title}
        testID={`${testID}-title`}
        {...(Platform.OS === "web" && !inline ? { tabIndex: -1 } : {})}
      >
        {title}
      </Text>
      <Text
        key={`body-${fails}`}
        style={inline ? styles.inlineBody : wide ? styles.bodyWide : styles.body}
        testID={`${testID}-body`}
      >
        {body}
      </Text>
    </Animated.View>
  );

  const card = inline ? (
    <View style={styles.inlineCard}>
      <View style={styles.inlineRow}>
        <View style={[styles.chip, styles.inlineChip]}>{glyph}</View>
        <View style={styles.inlineCopy}>{copyBlock}</View>
      </View>
      <View style={styles.inlineActions}>{tryAgain}</View>
    </View>
  ) : (
    <View style={[styles.card, wide ? styles.cardWide : styles.cardPhone]}>
      <View style={styles.chip}>{glyph}</View>
      {copyBlock}
      <View style={styles.actions}>
        {tryAgain}
        {back}
      </View>
    </View>
  );

  const notice = (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      {...(Platform.OS === "web" ? { "aria-live": "polite" } : {})}
      testID={testID}
      style={[
        inline ? null : styles.noticeColumn,
        {
          opacity: enter,
          transform: reduceMotion
            ? []
            : [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      {card}
    </Animated.View>
  );
  if (inline) return notice;
  // Full-page and checkout notices scroll, so at large text sizes the title
  // and Try again can always be reached (#2211).
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        layout === "page" ? styles.pageWrap : styles.checkoutWrap,
        // Reads high, never mid-void: the card's top sits at 22 % of the
        // screen on a phone, 120 on a wide web page.
        layout === "page" ? { paddingTop: wide ? 120 : Math.round(height * 0.22) } : null,
      ]}
      testID={`${testID}-scroll`}
    >
      {notice}
    </ScrollView>
  );
};

const noticeStyles = themedStyles(() =>
  StyleSheet.create({
    scroll: { flex: 1, width: "100%" },
    pageWrap: {
      flexGrow: 1,
      alignItems: "center",
      paddingHorizontal: space[4],
      paddingBottom: space[6],
    },
    checkoutWrap: {
      flexGrow: 1,
      alignItems: "center",
      paddingHorizontal: space[4],
      paddingTop: space[6],
      paddingBottom: space[6],
    },
    noticeColumn: { width: "100%", maxWidth: 560, alignItems: "center" },
    card: {
      width: "100%",
      backgroundColor: color.card,
      borderWidth: 1,
      borderColor: color.line,
    },
    cardPhone: { borderRadius: radius.xxl, padding: space[5] },
    cardWide: { borderRadius: radius.xl, padding: space[6], maxWidth: 440 },
    chip: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: color.fill.tile,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: space[4],
    },
    title: { ...type.h1, fontSize: 22, lineHeight: 28, fontWeight: "700", color: color.text1 },
    titleWide: { ...type.h1, fontSize: 21, lineHeight: 28, fontWeight: "600", color: color.text1 },
    body: { fontSize: 15, lineHeight: 20, color: color.text2, marginTop: space[2] },
    bodyWide: { fontSize: 14, lineHeight: 20, color: color.text2, marginTop: space[2] },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: space[3], marginTop: space[5] },
    button: {
      borderRadius: radius.full,
      paddingHorizontal: space[5],
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: space[2],
    },
    phoneHeight: { minHeight: size.btn.phone },
    webHeight: { minHeight: size.btn.md },
    primary: { backgroundColor: color.paper },
    primaryPhone: { flexGrow: 1, flexBasis: 0 },
    // Width locked so the label swap never shifts the layout.
    primaryWide: { minWidth: 148 },
    primaryLabel: { ...type.btn, color: color.ink },
    labelBusy: { opacity: 0.72 },
    secondary: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: color.controlOutline,
      minWidth: 96,
    },
    secondaryLabel: { ...type.btn, color: color.text1 },
    pressed: { transform: [{ scale: motion.pressScale }] },
    inlineCard: {
      backgroundColor: color.card2,
      borderWidth: 1,
      borderColor: color.controlOutline,
      borderRadius: radius.md,
      padding: space[4],
    },
    inlineRow: { flexDirection: "row", gap: space[3], alignItems: "flex-start" },
    inlineChip: { width: 32, height: 32, borderRadius: 10, marginBottom: 0 },
    inlineCopy: { flex: 1, minWidth: 0 },
    inlineTitle: { fontSize: 16, lineHeight: 21, fontWeight: "600", color: color.text1 },
    inlineBody: { fontSize: 13, lineHeight: 18, color: color.text2, marginTop: space[1] },
    inlineActions: { marginTop: space[3], paddingLeft: 44, flexDirection: "row" },
    inlineButton: { paddingHorizontal: 18 },
  }),
);

export default BuyerConnectionNotice;
