import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
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
      panelBackground="#16181b"
      style={styles.sheet}
      testID={testID}
    >
      <View
        style={styles.body}
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
              : "Start with a nearby venue or enter it yourself."}
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
                placeholder="Search nearby venues"
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
                {search.isFetching ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={styles.searchMessage}
                  >
                    <ActivityIndicator color={textTokens.secondary} />
                    <Text style={styles.help}>Finding nearby venues…</Text>
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
              <Button
                label="Enter details instead"
                variant="ghost"
                size="md"
                onPress={() => setSearchMode(false)}
              />
            </>
          ) : (
            <>
              <Text style={styles.cap}>COMPETITOR</Text>
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
              <Text style={styles.cap}>PUBLIC SOURCES</Text>
              <Text style={styles.help}>
                Add at least one public source. We only use public business
                information.
              </Text>
              <SourceField
                kind="website"
                label="Website"
                copy="Eligible for weekly analysis"
                value={website}
                setValue={setWebsite}
                preview={previews.website}
                disabled={mutation.isPending}
                testID={testID}
              />
              <SourceField
                kind="instagram"
                label="Instagram profile"
                copy="Eligible for weekly analysis when the profile is an approved professional account"
                value={instagram}
                setValue={setInstagram}
                preview={previews.instagram}
                disabled={mutation.isPending}
                testID={testID}
              />
              <SourceField
                kind="tiktok"
                label="TikTok · Saved link"
                copy="Not analyzed weekly. Saved as a link — weekly analysis isn't available"
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
        {!searchMode ? (
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
            <Button
              label="Cancel"
              variant="ghost"
              size="md"
              fullWidth
              disabled={mutation.isPending}
              onPress={requestClose}
              testID={`${testID}-cancel`}
            />
          </View>
        ) : null}
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
  copy,
  value,
  setValue,
  preview,
  disabled,
  testID,
}: {
  kind: CompetitorSourceKind;
  label: string;
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
      <Text style={styles.label}>{label}</Text>
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
const styles = StyleSheet.create({
  sheet: {
    width: "100%",
    maxWidth: 640,
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
  sheetHeader: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.16)",
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  scroll: { gap: spacing.md, paddingBottom: spacing.xl },
  footer: {
    minHeight: 72,
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.16)",
    backgroundColor: "#16181b",
  },
  title: { ...typography.h3, color: textTokens.primary },
  cap: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  label: { ...typography.bodySm, color: textTokens.primary, fontWeight: "600" },
  help: { ...typography.bodySm, color: textTokens.secondary },
  source: { gap: spacing.sm, marginTop: spacing.md },
  preview: { ...typography.caption, color: textTokens.secondary },
  error: { ...typography.bodySm, color: semantic.error },
  searchResults: { minHeight: 56, gap: spacing.md },
  searchMessage: { minHeight: 56, justifyContent: "center", gap: spacing.sm },
  result: {
    minHeight: 56,
    justifyContent: "center",
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
});
export default CompetitorAddSheet;
