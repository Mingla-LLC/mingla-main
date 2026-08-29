import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  androidOpaque,
  competition,
  competitorSheet,
  glass,
  spacing,
  semantic,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  captureCompetitorIntelligenceEvent,
  captureIntelCompetitorAdded,
} from "../../../analytics/competitorIntelligenceAnalytics";
import { useAuth } from "../../../context/AuthContext";
import { growthToolsKeys } from "../../../hooks/growthToolsKeys";
import { useAddCompetitor } from "../../../hooks/useCompetitorIntelligence";
import {
  searchPlaces,
  type PlaceSearchResult,
} from "../../../services/growthToolsService";
import type {
  CompetitorSourceInput,
  CompetitorSourceKind,
  CompetitorWatchRow,
} from "../../../types/growthTools";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import { ScrollView } from "../../../wrappers/SmartScrollView";

const PROFILE = {
  website: /^https?:\/\/[^\s]+$/i,
  instagram: /^https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?$/i,
  tiktok: /^https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._]{2,24}\/?$/i,
} as const;

export interface CompetitorAddSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  venueListingId: string | null;
  venueCity: string | null;
  initialRow?: CompetitorWatchRow | null;
  offline?: boolean;
  testID?: string;
}

function canonicalPreview(
  kind: CompetitorSourceKind,
  raw: string,
): string | null {
  if (!PROFILE[kind].test(raw.trim())) return null;
  try {
    const url = new URL(raw.trim());
    if (kind === "instagram")
      return `https://www.instagram.com/${url.pathname.split("/").filter(Boolean)[0]?.toLowerCase()}/`;
    if (kind === "tiktok")
      return `https://www.tiktok.com/${url.pathname.split("/").filter(Boolean)[0]?.toLowerCase()}`;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function CompetitorAddSheet({
  visible,
  onClose,
  brandId,
  venueListingId,
  venueCity,
  initialRow = null,
  offline = false,
  testID = "competitor-source-sheet",
}: CompetitorAddSheetProps): React.ReactElement {
  const { width } = useWindowDimensions();
  const contentInsetStyle = width >= 1024
    ? styles.insetWide
    : width >= 360
      ? styles.insetRegular
      : styles.insetCompact;
  const { loading, session } = useAuth();
  const isOffline = offline;
  const mutation = useAddCompetitor(brandId, venueListingId);
  const editing = initialRow !== null;
  const resetMutationRef = useRef(mutation.reset);
  resetMutationRef.current = mutation.reset;
  const [searchMode, setSearchMode] = useState(!editing);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [placePoolId, setPlacePoolId] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const initial = useMemo(
    () => ({
      name: initialRow?.name ?? "",
      city: initialRow?.city ?? venueCity ?? "",
      website:
        initialRow?.sources?.find((s) => s.kind === "website")?.url ??
        initialRow?.website ??
        "",
      instagram:
        initialRow?.sources?.find((s) => s.kind === "instagram")?.url ?? "",
      tiktok: initialRow?.sources?.find((s) => s.kind === "tiktok")?.url ?? "",
      placePoolId: initialRow?.placePoolId ?? null,
    }),
    [
      initialRow?.name,
      initialRow?.city,
      initialRow?.website,
      initialRow?.sources,
      initialRow?.placePoolId,
      venueCity,
    ],
  );
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setSearchMode(!editing);
    setName(initial.name);
    setCity(initial.city);
    setWebsite(initial.website);
    setInstagram(initial.instagram);
    setTiktok(initial.tiktok);
    setPlacePoolId(initial.placePoolId);
    setDiscardOpen(false);
    resetMutationRef.current();
  }, [visible, editing, initialRow?.id, initial]);
  const dirty =
    visible &&
    (query.trim() !== "" ||
      name !== initial.name ||
      city !== initial.city ||
      website !== initial.website ||
      instagram !== initial.instagram ||
      tiktok !== initial.tiktok ||
      placePoolId !== initial.placePoolId);
  const requestClose = (): void => {
    if (mutation.isPending) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  };
  const searchEnabled =
    visible &&
    searchMode &&
    !isOffline &&
    !loading &&
    session !== null &&
    brandId !== null &&
    debounced.length >= 2;
  const search = useQuery({
    queryKey:
      searchEnabled && brandId
        ? growthToolsKeys.search(brandId, debounced, venueCity ?? "")
        : ["growth-tools-disabled", "search"],
    enabled: searchEnabled,
    queryFn: () =>
      searchPlaces(brandId as string, debounced, venueCity ?? undefined),
    staleTime: 60_000,
  });
  const selectPlace = useCallback(
    (result: PlaceSearchResult) => {
      if (Platform.OS !== "web") {
        void import("../../../utils/hapticFeedback").then(({ HapticFeedback }) => HapticFeedback.buttonPress());
      }
      setName(result.name);
      setCity(result.city ?? venueCity ?? "");
      setWebsite(result.website ?? "");
      setPlacePoolId(result.id);
      setSearchMode(false);
    },
    [venueCity],
  );
  const previews = useMemo(
    () => ({
      website: canonicalPreview("website", website),
      instagram: canonicalPreview("instagram", instagram),
      tiktok: canonicalPreview("tiktok", tiktok),
    }),
    [website, instagram, tiktok],
  );
  const sources = useMemo<CompetitorSourceInput[]>(
    () => [
      ...(website.trim()
        ? [{ kind: "website" as const, url: website.trim() }]
        : []),
      ...(instagram.trim()
        ? [{ kind: "instagram" as const, url: instagram.trim() }]
        : []),
      ...(tiktok.trim()
        ? [{ kind: "tiktok" as const, url: tiktok.trim() }]
        : []),
    ],
    [website, instagram, tiktok],
  );
  const invalid =
    name.trim().length < 2 ||
    city.trim().length < 2 ||
    sources.length === 0 ||
    (website.trim() !== "" && !previews.website) ||
    (instagram.trim() !== "" && !previews.instagram) ||
    (tiktok.trim() !== "" && !previews.tiktok);
  const errorCopy =
    mutation.error?.code === "duplicate_source"
      ? "You're already watching this source for this venue."
      : mutation.error?.code === "duplicate_competitor"
        ? "You're already watching this site."
        : mutation.error?.code === "watch_limit"
          ? "Watching 5 of 5 — remove one to add another."
          : mutation.error?.code === "watch_conflict"
            ? "This competitor changed somewhere else. Review the latest links, then save again."
            : mutation.isError
              ? "Couldn't save this competitor. Your edits are still here — try again."
              : null;
  const submit = (): void => {
    if (invalid || mutation.isPending || isOffline) return;
    const callbacks = {
      onSuccess: (row: CompetitorWatchRow) => {
        captureCompetitorIntelligenceEvent(
          editing ? "competitor_source_edited" : "competitor_source_added",
          {
            watch_id: row.id,
            source_count: row.sources?.length ?? sources.length,
            schema_version: 2,
          },
        );
        if (!editing) captureIntelCompetitorAdded();
        if (!editing) {
          void import("../../../utils/hapticFeedback").then(({ HapticFeedback }) => HapticFeedback.success());
          AccessibilityInfo.announceForAccessibility(
            `Watching ${name.trim()}. Your first sourced brief is being prepared`,
          );
        }
        onClose();
      },
      onError: (error: { code: string }) =>
        console.error("[CompetitorSourceSheet] save failed", error.code),
    };
    mutation.mutate(
      {
        name,
        city,
        sources,
        placePoolId,
        ...(editing && initialRow
          ? {
              competitorId: initialRow.id,
              expectedUpdatedAt: initialRow.updatedAt ?? "",
            }
          : {}),
      },
      callbacks,
    );
  };
  return (
    <Sheet
      visible={visible}
      onClose={requestClose}
      snapPoint="full"
      verticalAlign="top"
      presentation="competition"
      panelBackground={competition.surface}
      style={styles.sheet}
      testID={testID}
    >
      <View
        style={[styles.body, contentInsetStyle]}
        testID={`${testID}-${editing ? "mode-edit" : "mode-add"}`}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.headerTop}>
            <Text accessibilityRole="header" style={styles.title}>
              {editing ? "Edit competitor sources" : "Watch a competitor"}
            </Text>
            <Button
              label="Close"
              accessibilityLabel={`Close ${editing ? "edit competitor sources" : "watch a competitor"}`}
              variant="ghost"
              size="md"
              disabled={mutation.isPending}
              onPress={requestClose}
            />
          </View>
          <Text style={styles.help}>
            {editing
              ? "Keep each public source accurate."
              : "Find a nearby venue, or add its public links yourself."}
          </Text>
        </View>
        {isOffline ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.error}
            testID={`${testID}-offline`}
          >
            You&apos;re offline. Reconnect to save changes.
          </Text>
        ) : null}
        {errorCopy ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.error}
            testID={`${testID}-form-error`}
          >
            {errorCopy}
          </Text>
        ) : null}
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          testID="competitor-add-sheet-scroll"
        >
          {searchMode ? (
            <>
              <Input
                value={query}
                onChangeText={setQuery}
                placeholder="Search by venue name"
                leadingIcon="search"
                accessibilityLabel="Search nearby venues"
                disabled={mutation.isPending}
              />
              {venueCity ? (
                <Text
                  style={styles.cap}
                >{`NEARBY IN ${venueCity.toUpperCase()}`}</Text>
              ) : null}
              <View style={styles.searchResults}>
                {!debounced && !search.isFetching ? (
                  <View style={styles.searchMessage} testID={`${testID}-search-initial`}>
                    <Text style={styles.label}>Search by venue name</Text>
                    <Text style={styles.help}>We’ll prefill public details when we can.</Text>
                  </View>
                ) : null}
                {search.isFetching ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={styles.skeletons}
                  >
                    {[0, 1, 2].map((item) => (
                      <View key={item} style={styles.skeletonRow}>
                        <ActivityIndicator color={textTokens.secondary} />
                        <Text style={styles.help}>Finding nearby venue…</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {search.isError ? (
                  <View style={styles.searchMessage}>
                    <Text accessibilityLiveRegion="polite" style={styles.error}>
                      We couldn&apos;t search nearby venues.
                    </Text>
                    <Button
                      label="Try search again"
                      variant="secondary"
                      size="md"
                      onPress={() => void search.refetch()}
                    />
                  </View>
                ) : null}
                {(search.data ?? []).map((result) => (
                  <Pressable
                    key={result.id}
                    accessibilityRole="button"
                    accessibilityLabel={
                      result.city
                        ? `Select ${result.name} in ${result.city}`
                        : `Select ${result.name}`
                    }
                    disabled={mutation.isPending}
                    onPress={() => selectPlace(result)}
                    style={styles.result}
                  >
                    <Text style={styles.label}>{result.name}</Text>
                    <Text style={styles.help}>{result.city ?? ""}</Text>
                    {result.website ? <Text style={styles.preview}>Website found</Text> : null}
                  </Pressable>
                ))}
                {search.isFetched &&
                !search.isError &&
                (search.data ?? []).length === 0 ? (
                  <View style={styles.searchMessage}>
                    <Text style={styles.label}>No match nearby yet</Text>
                    <Text style={styles.help}>
                      You can still add a competitor yourself.
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.cap}>COMPETITOR</Text>
              {!editing ? (
                <Button label="Back to nearby search" variant="ghost" size="md" onPress={() => setSearchMode(true)} />
              ) : null}
              <Text style={styles.label}>Competitor name</Text>
              <Input
                value={name}
                onChangeText={setName}
                disabled={mutation.isPending}
                placeholder="e.g. The Lantern Room"
                accessibilityLabel="Competitor name"
                testID={`${testID}-name-input`}
              />
              <Text style={styles.label}>City</Text>
              <Input
                value={city}
                onChangeText={setCity}
                disabled={mutation.isPending}
                placeholder="e.g. Atlanta"
                accessibilityLabel="City"
                testID={`${testID}-city-input`}
              />
              <Text style={styles.cap}>SOURCES MINGLA CAN WATCH</Text>
              <Text style={styles.help}>
                Add one source Mingla can verify each week. You can save TikTok as a quick reference.
              </Text>
              <SourceField
                kind="website"
                label="Website"
                badge="Weekly"
                copy="Mingla checks the public website each week."
                value={website}
                setValue={setWebsite}
                preview={previews.website}
                disabled={mutation.isPending}
                testID={testID}
              />
              <SourceField
                kind="instagram"
                label="Instagram profile"
                badge="Weekly if eligible"
                copy="Weekly checks require an approved professional account."
                value={instagram}
                setValue={setInstagram}
                preview={previews.instagram}
                disabled={mutation.isPending}
                testID={testID}
              />
              <Text style={styles.cap}>SAVED REFERENCE</Text>
              <SourceField
                kind="tiktok"
                label="TikTok"
                badge="Saved link only"
                copy="Saved as a link — weekly analysis isn't available. Use it as a quick reference."
                value={tiktok}
                setValue={setTiktok}
                preview={previews.tiktok}
                disabled={mutation.isPending}
                testID={testID}
              />
              {sources.length === 0 ? (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  Add at least one website or social profile.
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
        {searchMode ? (
          <View style={styles.footer} testID={`${testID}-nearby-footer`}>
            <Button label="Enter details manually" variant="secondary" size="md" fullWidth onPress={() => setSearchMode(false)} />
          </View>
        ) : (
          <View style={styles.footer} testID={`${testID}-sticky-footer`}>
            <Button
              label={
                mutation.isPending
                  ? "Saving…"
                  : editing
                    ? "Save sources"
                    : "Watch competitor"
              }
              variant="primary"
              size="md"
              fullWidth
              disabled={
                invalid || mutation.isPending || session === null || isOffline
              }
              loading={mutation.isPending}
              onPress={submit}
              testID={`${testID}-submit`}
            />
          </View>
        )}
      </View>
      {discardOpen ? (
        <ConfirmDialog
          visible
          onClose={() => setDiscardOpen(false)}
          title="Discard changes?"
          description="Your unsaved competitor links and details will be lost."
          confirmLabel="Discard changes"
          destructive
          onConfirm={() => {
            setDiscardOpen(false);
            onClose();
          }}
          testID={`${testID}-discard-confirm`}
        />
      ) : null}
    </Sheet>
  );
}

function SourceField({
  kind,
  label,
  badge,
  copy,
  value,
  setValue,
  preview,
  disabled,
  testID,
}: {
  kind: CompetitorSourceKind;
  label: string;
  badge: string;
  copy: string;
  value: string;
  setValue: (value: string) => void;
  preview: string | null;
  disabled: boolean;
  testID: string;
}): React.ReactElement {
  const invalid = value.trim() !== "" && preview === null;
  const error =
    kind === "website"
      ? "Use a website link that starts with http:// or https://."
      : kind === "instagram"
        ? "Paste an Instagram profile link, like instagram.com/competitor."
        : "Paste a TikTok profile link, like tiktok.com/@competitor.";
  return (
    <View style={styles.source}>
      <View style={styles.sourceTitle}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.badge}>{badge}</Text>
      </View>
      <Text style={styles.help}>{copy}</Text>
      <Input
        value={value}
        onChangeText={setValue}
        disabled={disabled}
        placeholder={
          kind === "website"
            ? "https://competitor.com"
            : kind === "instagram"
              ? "https://instagram.com/competitor"
              : "https://tiktok.com/@competitor"
        }
        accessibilityLabel={label}
        testID={`${testID}-${kind}-input`}
      />
      {preview ? (
        <Text style={styles.preview} testID={`${testID}-${kind}-preview`}>
          WE&apos;LL SAVE {preview}
        </Text>
      ) : null}
      {invalid ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.error}
          testID={`${testID}-${kind}-error`}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const competitionCardSurface = Platform.OS === "android" ? androidOpaque.rowFill : competition.surfaceRaised;
const competitionBorder = Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileElevated;
const competitionSubtleBorder = Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileBase;
const styles = StyleSheet.create({
  sheet: {
    width: "100%",
    maxWidth: competitorSheet.addMaxWidth,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    ...Platform.select({
      android: { elevation: 0, shadowOpacity: 0 },
      default: {
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: -8 },
      },
    }),
  },
  body: { flex: 1, gap: spacing.lg },
  insetCompact: { paddingHorizontal: competitorSheet.contentInsetCompact },
  insetRegular: { paddingHorizontal: competitorSheet.contentInsetRegular },
  insetWide: { paddingHorizontal: competitorSheet.contentInsetWide },
  sheetHeader: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: competitionBorder,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  scroll: { gap: spacing.md, paddingBottom: spacing.xl },
  footer: {
    minHeight: competitorSheet.stickyFooterMinHeight,
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: competitionBorder,
    backgroundColor: competition.surface,
  },
  title: { ...typography.h3, color: textTokens.primary },
  cap: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  label: { ...typography.bodySm, color: textTokens.primary, fontWeight: "600" },
  help: { ...typography.bodySm, color: textTokens.secondary },
  source: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: competitionBorder,
    backgroundColor: competitionCardSurface,
    overflow: "hidden",
    ...Platform.select({ android: { elevation: 0, shadowOpacity: 0 } }),
  },
  sourceTitle: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  badge: {
    ...typography.caption,
    color: textTokens.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: competitionBorder,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  preview: { ...typography.caption, color: textTokens.secondary },
  error: { ...typography.bodySm, color: semantic.error },
  searchResults: { minHeight: 160, maxHeight: 360, gap: spacing.md },
  skeletons: { gap: spacing.sm },
  skeletonRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: competitionCardSurface,
  },
  searchMessage: { minHeight: 56, justifyContent: "center", gap: spacing.sm },
  result: {
    minHeight: 56,
    justifyContent: "center",
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: competitionSubtleBorder,
  },
});
export default CompetitorAddSheet;
