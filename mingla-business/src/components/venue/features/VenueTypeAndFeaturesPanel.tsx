/**
 * #4490 P1-10 — Settings › Venue type and features (`set`).
 *
 * The venue type is a label and a starting preset only. Changing it never
 * switches anything off; it offers the new type's usual features. Each
 * feature is a switch (`role=switch`). A switch with dependencies confirms
 * the full list first and then makes ONE server call with cascade
 * (`issue_4490_set_venue_feature(..., p_cascade => true)`). Only features
 * whose phase has shipped are shown (BUILT_FEATURES). Owner and admin only.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import { useTillReleased } from "../../../hooks/useTillReleased";
import { useVenueEditAccess } from "../../../hooks/useVenueEditAccess";
import {
  useApplyFeaturePreset,
  useSetVenueFeature,
  useVenueFeatures,
} from "../../../hooks/useVenueFeatures";
import { useVenueListing } from "../../../hooks/useVenueListings";
import {
  useSubmitVenueDetailsChangeRequest,
  useUpdateVenueIdentityInReview,
} from "../../../hooks/useVenueDetailsEdit";
import { VenueFeatureError } from "../../../services/venueFeaturesService";
import { useVenueSuiteStore } from "../../../store/venueSuiteStore";
import {
  FEATURE_COPY,
  RELEASE_GATED_FEATURES,
  SWITCHABLE_FEATURES,
  VENUE_TYPES,
  builtPreset,
  featureCascade,
  joinFeatureLabels,
  venueTypeOption,
  type VenueFeatureKey,
  type VenueTypeKey,
} from "../../../types/venueFeatures";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { BrandSwitch } from "../../ui/BrandSwitch";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { GlassCard } from "../../ui/GlassCard";
import { Sheet } from "../../ui/Sheet";
import { Skeleton } from "../../ui/Skeleton";
import { Toast } from "../../ui/Toast";
import { featureSavedLine, featureSwitchConfirm, otherChangedFeatures } from "./featureSwitchModel";
import { venueWriteErrorCopy } from "./venueFeaturesCopy";

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

interface PendingSwitch {
  key: VenueFeatureKey;
  enable: boolean;
  cascade: VenueFeatureKey[];
}

export interface VenueTypeAndFeaturesPanelProps {
  brandId: string | null;
  venueId: string | null;
  /** Stay has its own shell, so its Spaces destination is not in the venue store. */
  onOpenSpaces?: () => void;
  /**
   * "stacked" keeps the cards in one column even on wide desktop. Stay Settings
   * hosts this panel in a narrow form column, where two columns squeeze the
   * switch rows. Default "auto" is the ordinary venue layout.
   */
  layout?: "auto" | "stacked";
}

export function VenueTypeAndFeaturesPanel({
  brandId,
  venueId,
  onOpenSpaces,
  layout = "auto",
}: VenueTypeAndFeaturesPanelProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const wideGrid = isWideDesktop && layout !== "stacked";
  const featuresQuery = useVenueFeatures(brandId, venueId);
  const venueQuery = useVenueListing(venueId);
  const access = useVenueEditAccess(brandId, venueId);
  const setFeature = useSetVenueFeature(brandId, venueId);
  const applyPreset = useApplyFeaturePreset(brandId);
  const updateInReview = useUpdateVenueIdentityInReview(venueId, brandId);
  const submitChange = useSubmitVenueDetailsChangeRequest(venueId, brandId);
  const selectModule = useVenueSuiteStore((s) => s.selectModule);
  const requestSpaces = useVenueSuiteStore((s) => s.requestSpaces);

  const [pending, setPending] = useState<PendingSwitch | null>(null);
  // #4490 N21: what a switch did is told in a toast, never in a line under the
  // row. The line pushed every row below it down for four seconds, so the next
  // tap landed on the wrong switch. The row only shows "Saving…" beside the
  // switch, in a slot that is always there.
  const [savingKey, setSavingKey] = useState<VenueFeatureKey | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean; needsSpace: boolean } | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ type: VenueTypeKey; keys: VenueFeatureKey[]; note: string } | null>(null);

  const state = featuresQuery.data ?? null;
  const venue = venueQuery.data ?? null;
  const category = (state?.venueCategory ?? venue?.venueCategory ?? null) as VenueTypeKey | null;
  const typeOption = venueTypeOption(category);
  const canSwitch = access.canSwitchFeatures;
  const verified = venue?.claimStatus === "verified";

  const usual = useMemo(() => (category === null ? [] : builtPreset(category)), [category]);
  // #4490 08 O1: the Till's switch appears only once its release flag is on.
  const tillReleased = useTillReleased();
  const switchable = tillReleased ? [...SWITCHABLE_FEATURES, ...RELEASE_GATED_FEATURES] : SWITCHABLE_FEATURES;
  const usualKeys = switchable.filter((k) => usual.includes(k));
  const moreKeys = switchable.filter((k) => !usual.includes(k));

  const runSwitch = useCallback(
    (key: VenueFeatureKey, enable: boolean, cascade: readonly VenueFeatureKey[]): void => {
      setSavingKey(key);
      setNotice(null);
      setFeature.mutate(
        {
          key,
          enabled: enable,
          cascade: cascade.length > 0,
          expectedVersion: state?.features[key].version ?? null,
        },
        {
          onSuccess: (result) => {
            // #4490 D30 — name every switch that moved, including one the
            // server changed through the backfill rule (Waitlist follows
            // Table reservations) without listing it.
            const others = otherChangedFeatures(
              state?.features ?? null,
              result.state.features,
              key,
              result.changedKeys,
            );
            setSavingKey(null);
            setNotice({ text: featureSavedLine(result.state.features, others), error: false, needsSpace: false });
          },
          onError: (error) => {
            const e = error instanceof VenueFeatureError ? error : null;
            setSavingKey(null);
            setNotice({
              text: venueWriteErrorCopy("feature", e?.code ?? "unknown", e?.detail ?? null),
              error: true,
              // #4490 N61: "Add a space first" gets a button to Spaces.
              needsSpace: e?.code === "feature_requires" && e?.detail === "space",
            });
          },
        },
      );
    },
    [setFeature, state],
  );

  const onToggle = useCallback(
    (key: VenueFeatureKey, enable: boolean): void => {
      if (state === null || !canSwitch) return;
      const cascade = featureCascade(state.features, key, enable);
      if (featureSwitchConfirm(key, enable, cascade) !== null) {
        setPending({ key, enable, cascade });
        return;
      }
      runSwitch(key, enable, cascade);
    },
    [canSwitch, runSwitch, state],
  );

  const pickType = useCallback(
    (next: VenueTypeKey): void => {
      if (venueId === null || category === null) return;
      setTypeError(null);
      if (next === category) {
        setTypeOpen(false);
        return;
      }
      const additions = builtPreset(next).filter((k) => state !== null && !state.features[k].enabled);
      const nextLabel = venueTypeOption(next)?.label ?? next;
      const onDone = (note: string): void => {
        setTypeOpen(false);
        setOffer(additions.length > 0 || note.length > 0 ? { type: next, keys: additions, note } : null);
      };
      const onError = (): void =>
        setTypeError("Couldn't change the type. Nothing was switched on or off, so try again.");
      if (venue?.claimStatus === "pending_review") {
        updateInReview.mutate({ venueCategory: next }, { onSuccess: () => onDone(""), onError });
      } else if (verified) {
        submitChange.mutate(
          { venueCategory: next },
          {
            onSuccess: () =>
              onDone(`Sent to Mingla. Guests see ${typeOption?.label ?? "the current type"} until it's approved, usually within a working day.`),
            onError,
          },
        );
      } else {
        setTypeError(`The type can change once your venue is in review or live. You can still switch on what ${nextLabel} venues usually use below.`);
      }
    },
    [category, state, submitChange, typeOption?.label, updateInReview, venue?.claimStatus, venueId, verified],
  );

  if (featuresQuery.isLoading) {
    return (
      <View style={styles.host} accessibilityLabel="Loading features" testID="venue-features-loading">
        <Skeleton height={72} radius="lg" />
        <Skeleton height={220} radius="lg" />
      </View>
    );
  }
  if (featuresQuery.isError || state === null) {
    return (
      <CenteredState title="Couldn't load your features" body="Check your connection and try again." tone="error" testID="venue-features-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void featuresQuery.refetch()} />
      </CenteredState>
    );
  }

  const openSpaces = (): void => {
    if (venueId !== null) requestSpaces(venueId);
    if (onOpenSpaces !== undefined) {
      onOpenSpaces();
      return;
    }
    selectModule?.("spaces");
  };

  const renderRow = (key: VenueFeatureKey): React.ReactElement => {
    const feature = state.features[key];
    const needsVerified = key === "table_ordering" && !verified && !feature.enabled;
    const disabled = !canSwitch || setFeature.isPending || needsVerified;
    const saving = savingKey === key;
    return (
      <View key={key} style={styles.row} testID={`venue-feature-row-${key}`}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{FEATURE_COPY[key].label}</Text>
          <Text style={styles.rowSub}>{FEATURE_COPY[key].summary}</Text>
          {needsVerified ? <Text style={styles.rowNote}>Available once Mingla approves this venue.</Text> : null}
          {feature.enabled && (feature.needs ?? []).includes("space") ? (
            // #4490 N61: on, but guests can't book it until a space exists.
            <View style={styles.needsRow} testID={`venue-feature-needs-space-${key}`}>
              <Text style={styles.rowNote}>Needs a space</Text>
              <Button label="Add a space" variant="secondary" size="sm" onPress={openSpaces} testID={`venue-feature-add-space-${key}`} />
            </View>
          ) : null}
        </View>
        <Text style={styles.rowSaving} accessibilityLiveRegion="polite" testID={`venue-feature-status-${key}`}>
          {saving ? "Saving…" : ""}
        </Text>
        <BrandSwitch
          value={feature.enabled}
          onValueChange={(next) => onToggle(key, next)}
          disabled={disabled}
          accessibilityRole="switch"
          accessibilityLabel={FEATURE_COPY[key].label}
          testID={`venue-feature-switch-${key}`}
        />
      </View>
    );
  };


  const confirm = pending !== null ? featureSwitchConfirm(pending.key, pending.enable, pending.cascade) : null;
  const spaceCount = state.activeSpaceCount;

  return (
    <View style={styles.host} testID="venue-type-and-features">
      <GlassCard variant="base" padding={space[4]} contentStyle={styles.typeCard}>
        <View style={styles.typeText}>
          <Text style={styles.typeTitle}>{typeOption?.label ?? "No type yet"}</Text>
          <Text style={styles.rowSub}>
            {typeOption !== null ? `${typeOption.description}. ` : "Pick the kind of venue you run. "}
            Your type sets the starting features, nothing more.
          </Text>
        </View>
        {canSwitch && category !== "stay" ? (
          <Button label="Change" variant="secondary" size="sm" onPress={() => setTypeOpen(true)} testID="venue-type-change" />
        ) : null}
      </GlassCard>

      {offer !== null ? (
        <GlassCard variant="base" padding={space[4]} contentStyle={styles.offerCard} testID="venue-type-offer">
          {offer.note.length > 0 ? <Text style={styles.rowSub}>{offer.note}</Text> : null}
          {offer.keys.length > 0 ? (
            <>
              <Text style={styles.rowTitle}>
                Switch on what {venueTypeOption(offer.type)?.label ?? ""} venues usually use?
              </Text>
              <Text style={styles.rowSub}>{joinFeatureLabels(offer.keys)}. Nothing you have on now is switched off.</Text>
              <View style={styles.offerButtons}>
                <Button label="Not now" variant="ghost" size="sm" onPress={() => setOffer(null)} />
                <Button
                  label="Switch them on"
                  variant="primary"
                  size="sm"
                  loading={applyPreset.isPending}
                  onPress={() => {
                    if (venueId === null) return;
                    applyPreset.mutate(
                      { venueId, category: offer.type },
                      {
                        onSuccess: () => setOffer(null),
                        onError: (error) => {
                          const e = error instanceof VenueFeatureError ? error : null;
                          setTypeError(venueWriteErrorCopy("feature", e?.code ?? "unknown", e?.detail ?? null));
                        },
                      },
                    );
                  }}
                  testID="venue-type-offer-apply"
                />
              </View>
            </>
          ) : (
            <Button label="Done" variant="ghost" size="sm" onPress={() => setOffer(null)} />
          )}
        </GlassCard>
      ) : null}
      {typeError !== null ? <Text style={styles.rowError}>{typeError}</Text> : null}
      {!canSwitch ? (
        <Text style={styles.rowNote}>Only brand owners and admins can switch features.</Text>
      ) : null}

      {/* #4490 J fix 2 (R4J-N2): `flex: 1` only shares a ROW. In a column it
          sets a zero flex-basis, so inside a scroller (Stay Settings) each card
          collapsed below its rows and the Spaces card and pinned Save bar
          painted over the lower switches. A column card takes its natural height. */}
      <View
        style={[styles.grid, wideGrid && styles.gridWide]}
        testID="venue-features-grid"
      >
        <GlassCard
          variant="base"
          padding={space[4]}
          style={wideGrid ? styles.gridCol : undefined}
          contentStyle={styles.section}
          testID="venue-features-usual"
        >
          <Text style={styles.sectionLabel}>
            {typeOption !== null ? `Usual for ${typeOption.label.toLowerCase()} venues` : "Usual for venues like yours"}
          </Text>
          {usualKeys.length === 0 ? (
            <Text style={styles.rowSub}>The usual features for this type arrive soon. Switch on anything below.</Text>
          ) : (
            usualKeys.map(renderRow)
          )}
        </GlassCard>
        <GlassCard
          variant="base"
          padding={space[4]}
          style={wideGrid ? styles.gridCol : undefined}
          contentStyle={styles.section}
          testID="venue-features-more"
        >
          <Text style={styles.sectionLabel}>More you can switch on</Text>
          {moreKeys.map(renderRow)}
        </GlassCard>
      </View>

      <GlassCard variant="base" padding={space[4]} contentStyle={styles.typeCard} testID="venue-features-spaces">
        <View style={styles.typeText}>
          <Text style={styles.rowTitle}>Spaces</Text>
          <Text style={styles.rowSub}>
            {spaceCount === 0
              ? "Name the rooms and areas guests use. Events, hire and tables sit in spaces."
              : `${spaceCount} space${spaceCount === 1 ? "" : "s"}. Events, hire and tables sit in spaces.`}
          </Text>
        </View>
        <Button
          label={spaceCount === 0 ? "Add spaces" : "Open Spaces"}
          variant="secondary"
          size="sm"
          onPress={openSpaces}
          testID="venue-features-open-spaces"
        />
      </GlassCard>

      <Sheet
        visible={typeOpen}
        onClose={() => setTypeOpen(false)}
        snapPoint={0.9}
        presentation={isWideDesktop ? "modal" : undefined}
        testID="venue-type-sheet"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.typeTitle} accessibilityRole="header">What kind of venue is it?</Text>
          <Text style={styles.rowSub}>Changing the type never switches anything off.</Text>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.typeGrid}>
            {VENUE_TYPES.filter((t) => t.key !== "stay").map((t) => {
              const on = t.key === category;
              const preset = builtPreset(t.key);
              return (
                <Pressable
                  key={t.key}
                  onPress={() => pickType(t.key)}
                  disabled={updateInReview.isPending || submitChange.isPending}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${t.label}. ${t.description}`}
                  style={[styles.typeOption, isWideDesktop && styles.typeOptionWide, on && styles.typeOptionOn]}
                  testID={`venue-type-option-${t.key}`}
                >
                  <Text style={styles.rowTitle}>{t.label}</Text>
                  <Text style={styles.rowSub}>{t.description}</Text>
                  {preset.length > 0 ? (
                    <Text style={styles.rowNote}>Starts with {joinFeatureLabels(preset)}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {typeError !== null ? <Text style={styles.rowError}>{typeError}</Text> : null}
        </View>
      </Sheet>

      <Toast
        visible={notice !== null}
        kind={notice?.error ? "error" : "success"}
        message={notice?.text ?? ""}
        onDismiss={() => setNotice(null)}
        action={notice?.needsSpace ? { label: "Add a space", onPress: openSpaces } : undefined}
        testID="venue-feature-notice"
      />

      {pending !== null && confirm !== null ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => setPending(null)}
            title={confirm.title}
            description={confirm.body}
            confirmLabel={confirm.confirm}
            cancelLabel="Keep as it is"
            destructive={!pending.enable}
            onConfirm={() => {
              const next = pending;
              setPending(null);
              runSwitch(next.key, next.enable, next.cascade);
            }}
            testID="venue-feature-confirm"
          />
        </React.Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[4] },
  typeCard: { flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" },
  typeText: { flex: 1, minWidth: 200, gap: 2 },
  typeTitle: { ...type.h2, color: color.text1 },
  offerCard: { gap: space[2] },
  offerButtons: { flexDirection: "row", gap: space[2], justifyContent: "flex-end", flexWrap: "wrap" },
  grid: { gap: space[4] },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  gridCol: { flex: 1 },
  section: { gap: space[1] },
  sectionLabel: { ...type.label, color: color.text3, marginBottom: space[1] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[2],
    minHeight: 56,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.row, color: color.text1 },
  rowSub: { ...type.small, color: color.text2 },
  rowNote: { ...type.caption, color: color.text3 },
  needsRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap", marginTop: space[1] },
  rowSaving: { ...type.caption, color: color.text3, width: 56, textAlign: "right" },
  rowError: { ...type.caption, color: color.errorText },
  sheetBody: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], gap: space[2] },
  sheetScroll: { flex: 1 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingBottom: space[6] },
  typeOption: {
    width: "100%",
    gap: 2,
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  typeOptionWide: { width: "48%" },
  typeOptionOn: { borderColor: color.accent, backgroundColor: color.accentLine },
});
