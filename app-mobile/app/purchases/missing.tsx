// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * #4473 — "Missing a ticket?"
 *
 * Shows what this account has confirmed, when the app last looked, a manual
 * Check again, and three ways forward: add an email or number, use the
 * confirmation link, or ask the buyer to send it.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Svg, { Circle, Path } from "react-native-svg";

import {
  AddIdentitySheet,
  type AddIdentityEntryStep,
} from "../../src/components/purchases/AddIdentitySheet";
import { lastCheckedCopy } from "../../src/components/purchases/missingTicketModel";
import { PURCHASE_SHEET_COLORS as C } from "../../src/components/purchases/purchaseSheetTheme";
import { queryClient } from "../../src/config/queryClient";
import { useClaimIdentifiers } from "../../src/hooks/useClaimIdentifiers";
import { purchaseKeys } from "../../src/hooks/queryKeys";
import { runClaimSweep } from "../../src/services/claimSweep";
import { useAppStore } from "../../src/store/appStore";

type CheckState = "idle" | "checking" | "checked";
type CheckNotice =
  | { kind: "found"; count: number }
  | { kind: "nothing" }
  | { kind: "rateLimited" }
  | { kind: "failed" }
  | null;

const CHECKED_HOLD_MS = 3_000;
const CLOCK_TICK_MS = 30_000;

/** The last sweep's time: the claim sweep caches its result per account. */
function lastSweepAt(userId: string | null): number | null {
  if (!userId) return null;
  const updatedAt = queryClient.getQueryState(purchaseKeys.lastClaim(userId))
    ?.dataUpdatedAt;
  return typeof updatedAt === "number" && updatedAt > 0 ? updatedAt : null;
}

export default function MissingPurchaseRoute(): React.ReactElement {
  const { t } = useTranslation("purchases");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAppStore((state) => state.user?.id ?? null);
  const identifiers = useClaimIdentifiers(userId);
  const [sheetStep, setSheetStep] = useState<AddIdentityEntryStep>("add");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(() => lastSweepAt(userId));
  const [now, setNow] = useState(() => Date.now());
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [notice, setNotice] = useState<CheckNotice>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCheckedAt(lastSweepAt(userId));
  }, [userId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  const openSheet = (step: AddIdentityEntryStep): void => {
    setSheetStep(step);
    setSheetOpen(true);
  };

  const markChecked = useCallback((at: number): void => {
    setCheckedAt(at);
    setNow(at);
  }, []);

  const checkAgain = async (): Promise<void> => {
    if (!userId || checkState === "checking") return;
    setCheckState("checking");
    setNotice(null);
    try {
      const result = await runClaimSweep(userId, "pull_to_refresh");
      if (result.rateLimited) {
        setNotice({ kind: "rateLimited" });
      } else {
        // A throttled run means a check finished under a minute ago; the
        // "Last checked" line already says so.
        if (!result.throttled) markChecked(Date.now());
        setNotice(
          result.count > 0
            ? { kind: "found", count: result.count }
            : { kind: "nothing" },
        );
      }
      await queryClient
        .invalidateQueries({ queryKey: purchaseKeys.identifiers(userId) })
        .catch(() => undefined);
    } catch {
      setNotice({ kind: "failed" });
    }
    setCheckState("checked");
    AccessibilityInfo.announceForAccessibility(t("missing.checked"));
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setCheckState("idle"), CHECKED_HOLD_MS);
  };

  const checkedLine = (() => {
    if (checkedAt === null) return t("missing.lastChecked.never");
    const copy = lastCheckedCopy(checkedAt, now);
    if (copy.key === "justNow") {
      return notice?.kind === "nothing"
        ? t("missing.lastChecked.nothingNew")
        : t("missing.lastChecked.justNow");
    }
    return t(`missing.lastChecked.${copy.key}`, { count: copy.count });
  })();

  const noticeCopy = notice?.kind === "found"
    ? t("missing.foundCount", { count: notice.count })
    : notice?.kind === "rateLimited"
    ? t("missing.rateLimited")
    : notice?.kind === "failed"
    ? t("error.body")
    : null;

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <Pressable
          accessibilityLabel={t("screen.back")}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/purchases")
          }
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Svg height={16} viewBox="0 0 10 16" width={10}>
            <Path
              d="M8 2 2 8l6 6"
              fill="none"
              stroke="#ffffff"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.2}
            />
          </Svg>
          <Text style={styles.backLabel}>{t("screen.title")}</Text>
        </Pressable>

        <Text style={styles.eyebrow}>{t("missing.eyebrow")}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {t("missing.title")}
        </Text>
        <Text style={styles.body}>{t("missing.body")}</Text>

        <View style={styles.card} testID="missing-confirmed-card">
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t("missing.confirmedHeading")}</Text>
            {userId ? (
              <Pressable
                accessibilityLabel={
                  checkState === "checking"
                    ? t("missing.checkingNow")
                    : checkState === "checked"
                    ? t("missing.checked")
                    : t("missing.checkAgain")
                }
                accessibilityRole="button"
                accessibilityState={{
                  busy: checkState === "checking",
                  disabled: checkState === "checking",
                }}
                disabled={checkState === "checking"}
                hitSlop={4}
                onPress={() => { void checkAgain(); }}
                style={({ pressed }) => [styles.recheck, pressed && styles.pressed]}
                testID="missing-check-again"
              >
                {checkState === "checking" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.recheckText}>
                    {checkState === "checked"
                      ? t("missing.checked")
                      : t("missing.checkAgain")}
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>

          <View style={styles.rows}>
            {identifiers.isLoading ? (
              <View
                accessibilityLabel={t("screen.loading")}
                testID="missing-identifiers-loading"
              >
                {[0, 1].map((index) => (
                  <View key={index} style={styles.row}>
                    <View style={[styles.check, styles.skeleton]} />
                    <View style={styles.rowCopy}>
                      <View style={[styles.skeletonLine, styles.skeleton]} />
                      <View style={[styles.skeletonLineShort, styles.skeleton]} />
                    </View>
                  </View>
                ))}
              </View>
            ) : identifiers.isError ? (
              <View style={styles.offline} testID="missing-identifiers-error">
                <Text style={styles.empty}>{t("error.body")}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { void identifiers.refetch(); }}
                  style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
                  testID="missing-identifiers-retry"
                >
                  <Text style={styles.retryText}>{t("error.retry")}</Text>
                </Pressable>
              </View>
            ) : identifiers.data?.length ? (
              identifiers.data.map((identifier) => (
                <View
                  key={`${identifier.kind}:${identifier.value}`}
                  style={styles.row}
                >
                  <View style={styles.check}>
                    <Svg height={14} viewBox="0 0 14 14" width={14}>
                      <Path
                        d="M3 7.5 6 10l5-6"
                        fill="none"
                        stroke={C.success}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.2}
                      />
                    </Svg>
                  </View>
                  <View style={styles.rowCopy}>
                    <Text selectable style={styles.rowValue}>
                      {identifier.display}
                    </Text>
                    <Text style={styles.rowKind}>
                      {identifier.kind === "email"
                        ? t("missing.email")
                        : t("missing.mobile")}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.empty}>{t("missing.noneConfirmed")}</Text>
            )}
          </View>
          {userId ? (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.checkedLine}
              testID="missing-last-checked"
            >
              {checkedLine}
            </Text>
          ) : null}
        </View>

        {noticeCopy ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.notice,
              notice?.kind === "found" ? styles.noticeGood : styles.noticeBad,
            ]}
            testID="missing-check-notice"
          >
            <Text
              style={notice?.kind === "found" ? styles.noticeGoodText : styles.noticeBadText}
            >
              {noticeCopy}
            </Text>
          </View>
        ) : null}

        <Text accessibilityRole="header" style={styles.otherTitle}>
          {t("missing.otherWaysHeading")}
        </Text>
        <View style={styles.options}>
          <OptionButton
            hint={t("missing.options.add.hint")}
            icon="add"
            onPress={() => openSheet("add")}
            primary
            testID="missing-option-add"
            title={t("missing.cta")}
          />
          <OptionButton
            hint={t("missing.options.link.hint")}
            icon="link"
            onPress={() => openSheet("link")}
            testID="missing-option-link"
            title={t("missing.options.link.title")}
          />
          <OptionButton
            hint={t("missing.options.ask.hint")}
            icon="ask"
            onPress={() => openSheet("ask")}
            testID="missing-option-ask"
            title={t("missing.options.ask.title")}
          />
        </View>
      </ScrollView>

      <AddIdentitySheet
        identifiers={identifiers.data}
        initialStep={sheetStep}
        onChecked={markChecked}
        onClose={() => setSheetOpen(false)}
        userId={userId}
        visible={sheetOpen}
      />
    </View>
  );
}

function OptionButton({
  title,
  hint,
  icon,
  primary = false,
  onPress,
  testID,
}: {
  title: string;
  hint: string;
  icon: "add" | "link" | "ask";
  primary?: boolean;
  onPress: () => void;
  testID: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        primary ? styles.optionPrimary : styles.optionSecondary,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Svg height={22} viewBox="0 0 24 24" width={22}>
        {icon === "add" ? (
          <Path d="M12 5v14M5 12h14" fill="none" stroke="#ffffff" strokeLinecap="round" strokeWidth={2.4} />
        ) : icon === "link" ? (
          <Path
            d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
            fill="none"
            stroke="#ffffff"
            strokeLinecap="round"
            strokeWidth={2}
          />
        ) : (
          <>
            <Circle cx={9} cy={8} fill="none" r={3.5} stroke="#ffffff" strokeWidth={2} />
            <Path
              d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M16 7h5M18.5 4.5 21 7l-2.5 2.5"
              fill="none"
              stroke="#ffffff"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </>
        )}
      </Svg>
      <View style={styles.optionCopy}>
        <Text style={primary ? styles.optionTitlePrimary : styles.optionTitle}>
          {title}
        </Text>
        <Text style={primary ? styles.optionHintPrimary : styles.optionHint}>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: C.screen },
  content: { paddingHorizontal: 20 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    minHeight: 44,
    gap: 6,
  },
  backLabel: { color: C.text, fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  eyebrow: {
    color: C.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 16,
  },
  title: {
    color: C.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    marginTop: 6,
  },
  body: {
    color: C.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 16,
    marginTop: 20,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: { flex: 1, color: C.text, fontSize: 16, fontWeight: "700" },
  recheck: {
    minHeight: 36,
    minWidth: 96,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  recheckText: { color: C.text, fontSize: 13, fontWeight: "600" },
  rows: { marginTop: 10 },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.successTint,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowValue: { color: C.text, fontSize: 15, fontWeight: "600" },
  rowKind: { color: C.textMeta, fontSize: 12, marginTop: 2 },
  skeleton: { backgroundColor: "rgba(255,255,255,0.08)" },
  skeletonLine: { height: 12, width: "70%", borderRadius: 6 },
  skeletonLineShort: { height: 10, width: "30%", borderRadius: 5, marginTop: 6 },
  empty: {
    color: C.textMeta,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 12,
  },
  offline: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  retry: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  retryText: { color: C.accent, fontSize: 14, fontWeight: "700" },
  checkedLine: { color: C.textMeta, fontSize: 12, marginTop: 8 },
  notice: { borderRadius: 14, padding: 14, marginTop: 12 },
  noticeGood: { backgroundColor: "rgba(82,215,143,0.12)" },
  noticeBad: { backgroundColor: "rgba(248,113,113,0.12)" },
  noticeGoodText: { color: "#91e6b8", fontSize: 13, lineHeight: 19 },
  noticeBadText: { color: "#fecaca", fontSize: 13, lineHeight: 19 },
  otherTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 22,
  },
  options: { gap: 10, marginTop: 12 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionPrimary: { minHeight: 64, backgroundColor: C.accent },
  optionSecondary: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: C.card,
  },
  optionCopy: { flex: 1 },
  optionTitlePrimary: { color: C.text, fontSize: 16, fontWeight: "700" },
  optionTitle: { color: C.text, fontSize: 15, fontWeight: "600" },
  optionHintPrimary: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 13,
    marginTop: 2,
  },
  optionHint: { color: "rgba(255,255,255,0.62)", fontSize: 13, marginTop: 2 },
});
