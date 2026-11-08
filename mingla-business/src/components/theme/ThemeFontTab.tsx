import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewToken,
} from "react-native";

import { canonicalThemeFont } from "@mingla/offering-rendering/themeResolver";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import {
  FONT_CHIPS,
  LEGACY_FONT_ROWS,
  catalogRows,
  familyOfThemeFont,
  fontRowAccessibilityLabel,
  fontRowCaption,
  fontSearchPlaceholder,
  visibleFontRows,
  type FontChip,
  type FontRow,
  type GoogleFontsCatalog,
} from "./fontCatalogModel";

/**
 * issue #1023 wave 2 — the Font tab: every Google Fonts family.
 *
 * The catalogue loads LAZILY, only when this tab mounts, through a dynamic
 * import — it must never reach the eager web chunk (strict-grep rule 3 in
 * i-1047-biz-bundle-budget-deferral.mjs). Rows draw their own name in a tiny
 * preview face (`&text=<name>`), only for rows on screen for 200 ms, at most 4
 * requests at a time and 150 per session (googleFontLoader).
 */

export const FONT_ROW_HEIGHT = 52;

// The preview loader is imported on demand (the same async module the theme
// font hook loads), so it is one lazy chunk and never hoisted into the eager
// web chunk by being shared between two lazy chunks.
const loadGoogleFontLoader = () =>
  import("@mingla/offering-rendering/googleFontLoader");
/** The preview face key; equals googleFontLoader.googlePreviewKey. */
const previewKey = (family: string): string => `GFP_${family.replace(/ /g, "_")}`;
const VISIBLE_DWELL_MS = 200;

type CatalogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: FontRow[] };

/** Test seam: the catalogue import, replaceable in tests. */
export const loadGoogleFontsCatalog = async (): Promise<GoogleFontsCatalog> => {
  const mod = (await import(
    "../../../../packages/offering-rendering/fonts/googleFontsCatalog.json"
  )) as unknown as { default?: GoogleFontsCatalog } & GoogleFontsCatalog;
  return mod.default ?? mod;
};

export interface ThemeFontTabProps {
  /** The raw saved font at this level (slug or family), or null if inherited. */
  font: string | null;
  inherited: boolean;
  /** "Brand default — Inter" / "Mingla default — Inter". */
  inheritLabel: string;
  inheritAccessibilityLabel: string;
  onCommit: (font: string | null) => void;
  /** Test seam for the catalogue loader. */
  loadCatalog?: () => Promise<GoogleFontsCatalog>;
  testID?: string;
}

export const ThemeFontTab: React.FC<ThemeFontTabProps> = ({
  font,
  inherited,
  inheritLabel,
  inheritAccessibilityLabel,
  onCommit,
  loadCatalog = loadGoogleFontsCatalog,
  testID,
}) => {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [chip, setChip] = useState<FontChip>("popular");
  const [query, setQuery] = useState("");
  const [readyFaces, setReadyFaces] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setCatalog({ status: "loading" });
    loadCatalog().then(
      (c) => {
        if (!cancelled) setCatalog({ status: "ready", rows: catalogRows(c) });
      },
      (error: unknown) => {
        console.warn("[theme-font] catalogue failed to load", error);
        if (!cancelled) setCatalog({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadCatalog, attempt]);

  const currentFamily = inherited ? null : familyOfThemeFont(font);
  const rows = useMemo(
    () =>
      catalog.status === "ready"
        ? visibleFontRows(catalog.rows, chip, query, currentFamily)
        : [],
    [catalog, chip, query, currentFamily],
  );

  // ── preview faces: rows visible for 200 ms, pumped 4 at a time ──────────
  const visible = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const pump = useCallback((): void => {
    void loadGoogleFontLoader().then(({ ensureGooglePreviewFace, isGooglePreviewReady }) => {
      for (const family of visible.current) {
        if (isGooglePreviewReady(family)) continue;
        void ensureGooglePreviewFace(family).then((ok) => {
          if (!mounted.current) return;
          if (ok) setReadyFaces((prev) => new Set(prev).add(family));
          // A finished request frees a slot: start the next visible row.
          if (ok) pump();
        });
      }
    }, (error: unknown) => {
      // Previews are decoration: rows keep the system font.
      console.warn("[theme-font] preview loader unavailable", error);
    });
  }, []);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }): void => {
      const next = new Set<string>();
      for (const token of viewableItems) {
        const row = token.item as FontRow | undefined;
        if (row !== undefined) next.add(row.family);
      }
      visible.current = next;
      if (dwellTimer.current !== null) clearTimeout(dwellTimer.current);
      dwellTimer.current = setTimeout(pump, VISIBLE_DWELL_MS);
    },
  ).current;
  useEffect(
    () => () => {
      if (dwellTimer.current !== null) clearTimeout(dwellTimer.current);
    },
    [],
  );

  const renderRow = useCallback(
    ({ item }: { item: FontRow }) => {
      const selected = currentFamily !== null && item.family === currentFamily;
      const ready = readyFaces.has(item.family);
      return (
        <Pressable
          onPress={() => onCommit(canonicalThemeFont(item.family))}
          style={[styles.row, selected ? styles.rowSelected : null]}
          accessibilityRole="radio"
          accessibilityState={{ selected, checked: selected }}
          accessibilityLabel={fontRowAccessibilityLabel(item)}
          testID={`theme-font-row-${item.family}`}
        >
          <View style={styles.rowText}>
            <Text
              style={[
                styles.rowName,
                ready ? { fontFamily: previewKey(item.family) } : null,
              ]}
              numberOfLines={1}
            >
              {item.family}
            </Text>
            <Text style={styles.rowCaption}>{fontRowCaption(item)}</Text>
          </View>
          {selected ? <Icon name="check" size={16} color={accent.warm} /> : null}
        </Pressable>
      );
    },
    [currentFamily, onCommit, readyFaces],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<FontRow> | null | undefined, index: number) => ({
      length: FONT_ROW_HEIGHT,
      offset: FONT_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  // Loading or failed: the 14 bundled families stay choosable.
  const legacyFallback = (
    <FlatList
      data={LEGACY_FONT_ROWS as FontRow[]}
      keyExtractor={(row) => row.family}
      renderItem={renderRow}
      getItemLayout={getItemLayout}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={VIEWABILITY}
      keyboardShouldPersistTaps="handled"
      style={styles.list}
      accessibilityRole="radiogroup"
      accessibilityLabel="Fonts"
      testID="theme-font-legacy-list"
    />
  );

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={() => onCommit(null)}
        style={[styles.row, inherited ? styles.rowSelected : null]}
        accessibilityRole="radio"
        accessibilityState={{ selected: inherited, checked: inherited }}
        accessibilityLabel={inheritAccessibilityLabel}
      >
        <Text style={styles.inheritLabel}>{inheritLabel}</Text>
        {inherited ? <Icon name="check" size={16} color={accent.warm} /> : null}
      </Pressable>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={fontSearchPlaceholder(
          catalog.status === "ready" ? catalog.rows.length : null,
        )}
        placeholderTextColor={textTokens.quaternary}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        accessibilityLabel="Search fonts"
        style={styles.search}
        testID="theme-font-search"
      />
      <View style={styles.chips} accessibilityRole="tablist">
        {FONT_CHIPS.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => setChip(c.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: chip === c.key }}
            accessibilityLabel={c.label}
            style={[styles.chip, chip === c.key ? styles.chipActive : null]}
            testID={`theme-font-chip-${c.key}`}
          >
            <Text style={[styles.chipLabel, chip === c.key ? styles.chipLabelActive : null]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  if (catalog.status !== "ready") {
    return (
      <View style={styles.wrap} testID={testID}>
        {header}
        {catalog.status === "loading" ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color={textTokens.tertiary} />
            <Text style={styles.stateText}>Loading fonts…</Text>
          </View>
        ) : (
          <View style={styles.stateRow}>
            <Text style={styles.stateText}>Couldn't load the font list.</Text>
            <Pressable
              onPress={() => setAttempt((n) => n + 1)}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              hitSlop={8}
              style={styles.retry}
            >
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        )}
        {legacyFallback}
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID}>
      {header}
      {rows.length === 0 ? (
        <Text style={styles.stateText}>{`No fonts match “${query.trim()}”.`}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.family}
          renderItem={renderRow}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          initialNumToRender={12}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          accessibilityRole="radiogroup"
          accessibilityLabel="Fonts"
          testID="theme-font-list"
        />
      )}
    </View>
  );
};

const VIEWABILITY = { itemVisiblePercentThreshold: 50 };

const styles = StyleSheet.create({
  // The tab body is NOT inside the sheet's ScrollView (a FlatList nested in a
  // same-direction ScrollView loses virtualisation and warns): it fills the
  // panel and the list scrolls on its own.
  wrap: { flex: 1, gap: spacing.sm, paddingTop: spacing.md },
  header: { gap: spacing.sm },
  list: { flex: 1 },
  row: {
    height: FONT_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowSelected: { backgroundColor: accent.tint },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 17, color: textTokens.primary },
  rowCaption: { fontSize: 11, color: textTokens.quaternary },
  inheritLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: textTokens.primary },
  search: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    paddingHorizontal: spacing.sm,
    fontSize: 14,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
  },
  chipActive: { backgroundColor: accent.tint, borderColor: accent.border, borderWidth: 1 },
  chipLabel: { fontSize: 13, fontWeight: "600", color: textTokens.tertiary },
  chipLabelActive: { color: textTokens.primary },
  stateRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  stateText: { fontSize: 13, color: textTokens.tertiary },
  retry: { minHeight: 44, justifyContent: "center" },
  retryLabel: { fontSize: 13, fontWeight: "700", color: accent.warm },
});
