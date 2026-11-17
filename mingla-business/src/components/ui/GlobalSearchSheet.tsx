/**
 * GlobalSearchSheet — the single global search surface for Mingla Host.
 *
 * META-ORCH-1073 Sub-A. SPEC §3.7 + DESIGN (full visual contract). Mounted
 * ONCE at app/(tabs)/_layout.tsx, opened via useGlobalSearchSheet().isOpen
 * (the TopBar search icon calls open()).
 *
 * Presentation shell is the canonical `Sheet` primitive:
 *   - native iOS/Android + narrow web → bottom sheet (Sheet → SheetMobile)
 *   - wide-desktop web → centred card (Sheet.web → DesktopCenteredCard)
 * Both shells consume the SAME useGlobalSearchIndex + computeBodyState, so
 * the result set is identical across surfaces (SPEC §2). No TopSheet, no new
 * tokens, no new dependency, no convergence with CommandPalette (R-5 COEXIST).
 *
 * All decision logic is pure (src/lib/search/sheetState.ts); this file is a
 * thin renderer over it + the kit primitives.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { Sheet } from "./Sheet";
import { Input } from "./Input";
import { Icon } from "./Icon";
import { color, space, type as dsType } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { useGlobalSearchSheet } from "../../hooks/useGlobalSearchSheet";
import { useGlobalSearchIndex } from "../../hooks/useGlobalSearchIndex";
import { computeBodyState, rowPressEffects } from "../../lib/search/sheetState";
import type { SearchGroup, SearchResult } from "../../lib/search/types";

const GROUP_HEADING: Record<SearchGroup, string> = {
  offerings: "Offerings",
  goto: "Go to",
  settings: "Settings & actions",
};

const PLACEHOLDER = "Search events, trips, settings…";

/** Offering rows are 56pt (subtitle); registry rows 48pt. */
const ROW_MIN_HEIGHT_OFFERING = 56;
const ROW_MIN_HEIGHT_REGISTRY = 48;

const isOffering = (type: SearchResult["type"]): boolean =>
  type === "event" || type === "trip" || type === "experience";

interface ResultRowProps {
  result: SearchResult;
  onPress: (result: SearchResult) => void;
}

const ResultRow: React.FC<ResultRowProps> = ({ result, onPress }) => {
  const offering = isOffering(result.type);
  const a11yLabel =
    result.subtitle !== null && result.subtitle.length > 0
      ? `${result.title}, ${result.subtitle}`
      : result.title;
  const handlePressIn = useCallback((): void => {
    if (Platform.OS !== "web") HapticFeedback.buttonPress();
  }, []);
  return (
    <Pressable
      onPress={() => onPress(result)}
      onPressIn={handlePressIn}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: offering ? ROW_MIN_HEIGHT_OFFERING : ROW_MIN_HEIGHT_REGISTRY,
          backgroundColor: pressed ? color.fill.inset : "transparent",
        },
      ]}
    >
      <View style={styles.rowIcon}>
        <Icon name={result.iconName} size={20} color={color.text2} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {result.title}
        </Text>
        {result.subtitle !== null && result.subtitle.length > 0 ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {result.subtitle}
          </Text>
        ) : null}
      </View>
      <Icon name="chevR" size={18} color={color.text4} />
    </Pressable>
  );
};

interface GroupSectionProps {
  group: SearchGroup;
  results: SearchResult[];
  onPress: (result: SearchResult) => void;
}

const GroupSection: React.FC<GroupSectionProps> = ({ group, results, onPress }) => {
  if (results.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text
        accessibilityRole="header"
        style={styles.groupHeading}
        numberOfLines={1}
      >
        {GROUP_HEADING[group]}
      </Text>
      {results.map((r) => (
        <ResultRow key={`${r.group}:${r.type}:${r.id}`} result={r} onPress={onPress} />
      ))}
    </View>
  );
};

export const GlobalSearchSheet: React.FC = () => {
  const router = useRouter();
  const isOpen = useGlobalSearchSheet((s) => s.isOpen);
  const query = useGlobalSearchSheet((s) => s.query);
  const recents = useGlobalSearchSheet((s) => s.recents);
  const setQuery = useGlobalSearchSheet((s) => s.setQuery);
  const close = useGlobalSearchSheet((s) => s.close);
  const pushRecent = useGlobalSearchSheet((s) => s.pushRecent);

  const { index, isOfferingsLoading, hasBrand } = useGlobalSearchIndex();

  // Native autofocus is deferred until the open spring settles so the iOS
  // keyboard doesn't race the spring (DESIGN D-4 / §7.2). Web focuses
  // immediately.
  const [autoFocusReady, setAutoFocusReady] = useState<boolean>(
    Platform.OS === "web",
  );
  useEffect(() => {
    if (!isOpen) {
      setAutoFocusReady(Platform.OS === "web");
      return;
    }
    if (Platform.OS === "web") {
      setAutoFocusReady(true);
      return;
    }
    const t = setTimeout(() => setAutoFocusReady(true), 260);
    return (): void => clearTimeout(t);
  }, [isOpen]);

  const handleRowPress = useCallback(
    (result: SearchResult): void => {
      const effects = rowPressEffects(result, query, recents);
      pushRecent(query);
      close();
      router.push(effects.route as never);
    },
    [query, recents, pushRecent, close, router],
  );

  const handleRecentPress = useCallback(
    (recent: string): void => {
      setQuery(recent);
    },
    [setQuery],
  );

  const body = useMemo(
    () => computeBodyState({ query, index, recents }),
    [query, index, recents],
  );

  return (
    <Sheet
      visible={isOpen}
      onClose={close}
      snapPoint="full"
      verticalAlign="top"
      testID="global-search-sheet"
    >
      <View style={styles.container}>
        <Input
          variant="search"
          value={query}
          onChangeText={setQuery}
          placeholder={PLACEHOLDER}
          clearable
          autoFocus={autoFocusReady}
          returnKeyType="search"
          accessibilityLabel="Search"
          testID="global-search-input"
        />
        <View style={styles.divider} />
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {body.kind === "empty" ? (
            <>
              {body.recents.length > 0 ? (
                <View style={styles.group}>
                  <Text
                    accessibilityRole="header"
                    style={styles.groupHeading}
                  >
                    Recent
                  </Text>
                  {body.recents.map((recent) => (
                    <Pressable
                      key={`recent:${recent}`}
                      onPress={() => handleRecentPress(recent)}
                      accessibilityRole="button"
                      accessibilityLabel={`Search ${recent}`}
                      style={({ pressed }) => [
                        styles.row,
                        {
                          minHeight: ROW_MIN_HEIGHT_REGISTRY,
                          backgroundColor: pressed
                            ? color.fill.inset
                            : "transparent",
                        },
                      ]}
                    >
                      <View style={styles.rowIcon}>
                        <Icon
                          name="search"
                          size={20}
                          color={color.text2}
                        />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {recent}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {isOfferingsLoading ? (
                <View style={styles.group}>
                  <Text accessibilityRole="header" style={styles.groupHeading}>
                    {GROUP_HEADING.offerings}
                  </Text>
                  <Text style={styles.muted}>Loading your stuff…</Text>
                </View>
              ) : null}
              {body.suggestions.length > 0 ? (
                <View style={styles.group}>
                  <Text accessibilityRole="header" style={styles.groupHeading}>
                    Jump to
                  </Text>
                  {body.suggestions.map((r) => (
                    <ResultRow
                      key={`jump:${r.group}:${r.id}`}
                      result={r}
                      onPress={handleRowPress}
                    />
                  ))}
                </View>
              ) : null}
              {body.recents.length === 0 &&
              body.suggestions.length === 0 &&
              !isOfferingsLoading ? (
                <Text style={styles.muted}>
                  {hasBrand
                    ? "Nothing to jump to yet."
                    : "Nothing to jump to yet — create your first event to get started."}
                </Text>
              ) : null}
            </>
          ) : null}

          {body.kind === "populated" ? (
            <>
              <GroupSection
                group="offerings"
                results={body.results.filter((r) => r.group === "offerings")}
                onPress={handleRowPress}
              />
              <GroupSection
                group="goto"
                results={body.results.filter((r) => r.group === "goto")}
                onPress={handleRowPress}
              />
              <GroupSection
                group="settings"
                results={body.results.filter((r) => r.group === "settings")}
                onPress={handleRowPress}
              />
            </>
          ) : null}

          {body.kind === "zero" ? (
            <View style={styles.group}>
              <Text style={styles.zeroHeadline}>
                {`No matches for "${body.query.trim()}".`}
              </Text>
              <Text style={styles.muted}>Try a name, or jump to a setting.</Text>
              {body.suggestions.length > 0 ? (
                <>
                  <Text
                    accessibilityRole="header"
                    style={[styles.groupHeading, styles.zeroSuggestHeading]}
                  >
                    Did you mean
                  </Text>
                  {body.suggestions.map((r) => (
                    <ResultRow
                      key={`zero:${r.group}:${r.id}`}
                      result={r}
                      onPress={handleRowPress}
                    />
                  ))}
                </>
              ) : null}
            </View>
          ) : null}

          {body.kind === "error" ? (
            <View style={styles.errorRow}>
              <Icon name="flag" size={20} color={color.danger} />
              <Text style={styles.errorText}>
                Something went wrong searching. Try again.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: space[2],
    // Edge gutter so the search input, group headings ("JUMP TO") and rows
    // are not flush to the sheet edge (META-ORCH-1073 Sub-A2 QA). Matches the
    // standard sheet content inset used across mingla-business UI.
    paddingHorizontal: space[4],
  },
  divider: {
    height: 1,
    backgroundColor: color.line,
    marginTop: space[2],
  },
  list: {
    flex: 1,
    marginTop: space[2],
  },
  group: {
    marginBottom: space[2],
  },
  groupHeading: {
    fontSize: dsType.label.fontSize,
    lineHeight: dsType.label.lineHeight,
    fontWeight: dsType.label.fontWeight,
    letterSpacing: dsType.label.letterSpacing,
    color: color.text3,
    textTransform: "uppercase",
    paddingTop: space[2] + space[1],
    paddingBottom: space[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space[1],
  },
  rowIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: space[4],
  },
  rowText: {
    flex: 1,
    paddingRight: space[2],
  },
  rowTitle: {
    fontSize: dsType.body.fontSize,
    lineHeight: dsType.body.lineHeight,
    fontWeight: dsType.body.fontWeight,
    color: color.text1,
  },
  rowSubtitle: {
    fontSize: dsType.small.fontSize,
    lineHeight: dsType.small.lineHeight,
    fontWeight: dsType.small.fontWeight,
    color: color.text3,
  },
  muted: {
    fontSize: dsType.small.fontSize,
    lineHeight: dsType.small.lineHeight,
    fontWeight: dsType.small.fontWeight,
    color: color.text3,
    paddingVertical: space[1],
  },
  zeroHeadline: {
    fontSize: dsType.body.fontSize,
    lineHeight: dsType.body.lineHeight,
    fontWeight: dsType.body.fontWeight,
    color: color.text1,
    paddingTop: space[2],
  },
  zeroSuggestHeading: {
    marginTop: space[2],
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space[4],
  },
  errorText: {
    flex: 1,
    marginLeft: space[2],
    fontSize: dsType.body.fontSize,
    lineHeight: dsType.body.lineHeight,
    fontWeight: dsType.body.fontWeight,
    color: color.text1,
  },
});

export default GlobalSearchSheet;
