import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";

import {
  color,
  durations,
  radius,
  space,
  edge,
} from "../../constants/designSystem";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
import type {
  BrandPriceRow,
  DiscountKind,
  DiscountOfferingRow,
  DiscountScopeKind,
  DiscountTarget,
} from "../../services/discountService";
import { currencyCodeOrNull, formatCurrency } from "../../utils/currency";
import { Button } from "../ui/Button";
import {
  deletedOfferingTargets,
  DISCOUNT_LISTING_KIND_OPTIONS,
  DISCOUNT_SCOPE_OPTIONS,
  groupDiscountOfferings,
  hasOrphanedDiscountTarget,
  isDiscountPriceSelectable,
  isDiscountScopeAvailable,
  offeringCountLabel,
  offeringMeta,
  offeringTarget,
  OFFERINGS_HELP,
  SALE_PRICE_SCOPE_HELP,
} from "./discountEditorContract";

/** #4624: the offerings query state the picker renders. */
export type DiscountOfferingsStatus = "loading" | "error" | "ready";

export interface DiscountScopePickerProps {
  scopeKind: DiscountScopeKind;
  targets: DiscountTarget[];
  prices: BrandPriceRow[];
  currencyCode: string | null;
  /** #4624 D5: a sale price disables every scope but Specific items. */
  discountKind: DiscountKind;
  offerings: DiscountOfferingRow[];
  offeringsStatus: DiscountOfferingsStatus;
  onRetryOfferings: () => void;
  onScopeKindChange: (value: DiscountScopeKind) => void;
  onTargetsChange: (value: DiscountTarget[]) => void;
}

// PressableStateCallbackType does not declare `hovered`; react-native-web
// passes it at runtime (same widening as ui/Button).
type PressState = PressableStateCallbackType & { hovered?: boolean };

const sameTarget = (a: DiscountTarget, b: DiscountTarget): boolean =>
  a.targetKind === b.targetKind &&
  (a.targetId ?? null) === (b.targetId ?? null) &&
  (a.listingKind ?? null) === (b.listingKind ?? null);

const selected = (targets: DiscountTarget[], target: DiscountTarget): boolean =>
  targets.some((row) => sameTarget(row, target));

const nativeDriver = Platform.OS !== "web";

const tickHaptic = (): void => {
  if (Platform.OS === "web") return;
  void Haptics.selectionAsync().catch(() => undefined);
};

export const DiscountScopePicker: React.FC<DiscountScopePickerProps> = ({
  scopeKind,
  targets,
  prices,
  currencyCode,
  discountKind,
  offerings,
  offeringsStatus,
  onRetryOfferings,
  onScopeKindChange,
  onTargetsChange,
}) => {
  const code = currencyCodeOrNull(currencyCode);
  const groupedPrices = useMemo(() => {
    const groups = new Map<string, BrandPriceRow[]>();
    prices.forEach((price) => {
      const group = groups.get(price.listingName) ?? [];
      group.push(price);
      groups.set(price.listingName, group);
    });
    return Array.from(groups.entries());
  }, [prices]);

  const toggle = (target: DiscountTarget): void => {
    onTargetsChange(
      selected(targets, target)
        ? targets.filter((row) => !sameTarget(row, target))
        : [...targets, target],
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>What it applies to</Text>
      <Text style={styles.help}>Choose one scope for this discount.</Text>
      <View style={styles.scopeCards} accessibilityRole="radiogroup">
        {DISCOUNT_SCOPE_OPTIONS.map(({ value, label, description }) => {
          const isSelected = scopeKind === value;
          const available = isDiscountScopeAvailable(discountKind, value);
          return (
            <Pressable
              key={value}
              disabled={!available}
              onPress={() => onScopeKindChange(value)}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityHint={available ? description : SALE_PRICE_SCOPE_HELP}
              accessibilityState={{ checked: isSelected, disabled: !available }}
              testID={`discount-scope-${value}`}
              style={(state: PressState) => [
                styles.scopeCard,
                state.hovered && available ? styles.hover : null,
                isSelected && styles.scopeCardSelected,
                !available && styles.disabled,
              ]}
            >
              <View style={[styles.radio, isSelected && styles.radioSelected]}>
                {isSelected ? <View style={styles.radioCenter} /> : null}
              </View>
              <View style={styles.scopeCopy}>
                <Text style={styles.scopeTitle}>{label}</Text>
                <Text style={styles.scopeDescription}>{description}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {discountKind === "sale_price" ? (
        <Text style={styles.help}>{SALE_PRICE_SCOPE_HELP}</Text>
      ) : null}

      {scopeKind === "brand" ? (
        <Text style={styles.help}>
          Items with Allow discounts turned off will still be excluded.
        </Text>
      ) : null}

      {scopeKind === "listing_kinds" ? (
        <View style={styles.chipWrap}>
          {DISCOUNT_LISTING_KIND_OPTIONS.map(([kind, label]) => {
            const target: DiscountTarget = {
              targetKind: "listing_kind",
              listingKind: kind,
              targetId: null,
            };
            const isSelected = selected(targets, target);
            return (
              <Pressable
                key={kind}
                onPress={() => toggle(target)}
                style={[styles.chip, isSelected && styles.chipSelected]}
                accessibilityRole="checkbox"
                accessibilityLabel={`${label} offering type`}
                accessibilityState={{ checked: isSelected }}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && styles.chipTextSelected,
                  ]}
                >
                  {isSelected ? "✓ " : ""}
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {scopeKind === "listings" ? (
        <OfferingsPicker
          targets={targets}
          offerings={offerings}
          status={offeringsStatus}
          onRetry={onRetryOfferings}
          onTargetsChange={onTargetsChange}
        />
      ) : null}

      {scopeKind === "items" ? (
        groupedPrices.length === 0 ? (
          <Text style={styles.help}>No paid items are available yet.</Text>
        ) : (
          <View style={styles.itemGroups}>
            {groupedPrices.map(([listingName, rows]) => (
              <View key={listingName} style={styles.itemGroup}>
                <Text style={styles.groupTitle}>{listingName}</Text>
                <View style={styles.itemGrid}>
                  {rows.map((price) => {
                    const target: DiscountTarget = {
                      targetKind: price.kind,
                      targetId: price.id,
                      listingKind: null,
                    };
                    const isSelected = selected(targets, target);
                    const selectable = isDiscountPriceSelectable(price);
                    return (
                      <Pressable
                        key={`${price.kind}:${price.id}`}
                        disabled={!selectable}
                        onPress={() => toggle(target)}
                        style={[
                          styles.itemCard,
                          isSelected && styles.itemCardSelected,
                          !selectable && styles.itemCardDisabled,
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`${price.itemName} in ${price.listingName}`}
                        accessibilityState={{
                          checked: isSelected,
                          disabled: !selectable,
                        }}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            isSelected && styles.checkboxSelected,
                          ]}
                        >
                          {isSelected ? (
                            <Text style={styles.checkmark}>✓</Text>
                          ) : null}
                        </View>
                        <View style={styles.itemCopy}>
                          <Text style={styles.itemName}>{price.itemName}</Text>
                          <Text style={styles.itemMeta}>
                            {selectable
                              ? code === null
                                ? "Price unavailable"
                                : formatCurrency(
                                    price.listUnitCents,
                                    code,
                                    true,
                                  )
                              : "Discounts are off for this item"}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )
      ) : null}

      {hasOrphanedDiscountTarget(targets) ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Deleted item — remove it before saving.
          </Text>
        </View>
      ) : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
// #4624 "Specific offerings" picker.
// ---------------------------------------------------------------------------

const OfferingsPicker: React.FC<{
  targets: DiscountTarget[];
  offerings: DiscountOfferingRow[];
  status: DiscountOfferingsStatus;
  onRetry: () => void;
  onTargetsChange: (value: DiscountTarget[]) => void;
}> = ({ targets, offerings, status, onRetry, onTargetsChange }) => {
  const reduceMotion = useReducedMotionNative();
  // An ended offering unticked this sheet session stays visible until the
  // sheet closes, so an accidental untick can be undone.
  const [keepVisible, setKeepVisible] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const selectedIds = useMemo(
    () =>
      new Set(
        targets
          .filter((target) => target.targetKind === "event")
          .map((target) => target.targetId ?? ""),
      ),
    [targets],
  );
  const deleted = useMemo(
    () => deletedOfferingTargets(targets, status === "ready" ? offerings : null),
    [targets, offerings, status],
  );
  const groups = useMemo(
    () =>
      groupDiscountOfferings(
        offerings.filter(
          (row) =>
            !deleted.some((target) => target.targetId === row.id),
        ),
        selectedIds,
        keepVisible,
      ),
    [offerings, deleted, selectedIds, keepVisible],
  );
  const count = targets.filter((target) => target.targetKind === "event").length;
  const countText = offeringCountLabel(count);

  // Appear: opacity 0→1, translateY 8→0, 200 ms ease-out (opacity only, 0 ms
  // under Reduce Motion).
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (status !== "ready") return;
    if (reduceMotion) {
      appear.setValue(1);
      return;
    }
    appear.setValue(0);
    Animated.timing(appear, {
      toValue: 1,
      duration: durations.normal,
      easing: Easing.bezier(0.33, 1, 0.68, 1),
      useNativeDriver: nativeDriver,
    }).start();
  }, [appear, reduceMotion, status]);

  // Count crossfade (120 ms) and an iOS VoiceOver announcement on change.
  const countFade = useRef(new Animated.Value(1)).current;
  const firstCount = useRef(true);
  useEffect(() => {
    if (firstCount.current) {
      firstCount.current = false;
      return;
    }
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(countText);
    }
    if (reduceMotion) return;
    countFade.setValue(0.3);
    Animated.timing(countFade, {
      toValue: 1,
      duration: durations.fast,
      useNativeDriver: nativeDriver,
    }).start();
  }, [countFade, countText, reduceMotion]);

  if (status === "loading") return <OfferingsSkeleton reduceMotion={reduceMotion} />;
  if (status === "error") {
    return (
      <View style={[styles.panel, styles.panelError]} accessibilityRole="alert">
        <Text style={styles.panelTitle}>Couldn’t load your offerings.</Text>
        <Text style={styles.panelBody}>
          Check your connection, then try again.
        </Text>
        <Button
          label="Retry"
          variant="secondary"
          size="sm"
          onPress={onRetry}
          accessibilityLabel="Retry loading offerings"
          testID="discount-offerings-retry"
        />
      </View>
    );
  }
  if (offerings.length === 0 && deleted.length === 0) {
    return (
      <View style={styles.panel} accessibilityRole="text">
        <Text style={styles.panelTitle}>
          No events, experiences or trips yet.
        </Text>
        <Text style={styles.panelBody}>
          Offerings you create appear here. Until then, choose another scope
          above.
        </Text>
      </View>
    );
  }

  const toggleOffering = (row: DiscountOfferingRow): void => {
    const target = offeringTarget(row.id);
    const isSelected = selectedIds.has(row.id);
    if (!isSelected && !row.discountsAllowed) return;
    tickHaptic();
    if (isSelected && (row.status === "ended" || row.status === "cancelled")) {
      setKeepVisible((current) => new Set(current).add(row.id));
    }
    onTargetsChange(
      isSelected
        ? targets.filter((item) => !sameTarget(item, target))
        : [...targets, target],
    );
  };
  const removeTarget = (target: DiscountTarget): void => {
    onTargetsChange(targets.filter((item) => !sameTarget(item, target)));
  };

  // Deleted rows lead the Events group (it exists even with no live events).
  const shown =
    deleted.length > 0 && !groups.some((group) => group.kind === "event")
      ? [{ kind: "event" as const, label: "Events", singular: "event", rows: [] }, ...groups]
      : groups;

  return (
    <Animated.View
      style={[
        styles.offerings,
        {
          opacity: appear,
          transform: reduceMotion
            ? []
            : [
                {
                  translateY: appear.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
        },
      ]}
    >
      <View style={styles.pickHead}>
        <Text style={styles.pickTitle}>Offerings</Text>
        <Animated.Text
          style={[styles.count, { opacity: countFade }]}
          accessibilityLiveRegion="polite"
          testID="discount-offerings-count"
        >
          {countText}
        </Animated.Text>
      </View>
      <View style={styles.offeringGroups}>
        {shown.map((group) => (
          <View key={group.kind} style={styles.offeringGroup}>
            <Text style={styles.groupTitle}>{group.label}</Text>
            {group.kind === "event"
              ? deleted.map((target) => (
                  <View
                    key={`deleted:${target.targetId ?? ""}`}
                    style={[styles.offeringRow, styles.deletedRow]}
                    accessibilityLabel="Deleted offering"
                  >
                    <View style={[styles.checkbox, styles.checkboxSelected]}>
                      <Text style={styles.checkmark}>✓</Text>
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.offeringTitle}>Deleted offering</Text>
                      <Text style={styles.deletedMeta}>
                        This offering was deleted. Remove it to save.
                      </Text>
                    </View>
                    <Button
                      label="Remove"
                      variant="secondary"
                      size="sm"
                      onPress={() => removeTarget(target)}
                      accessibilityLabel="Remove deleted offering"
                      testID={`discount-offering-remove-${target.targetId ?? ""}`}
                    />
                  </View>
                ))
              : null}
            {group.rows.map((row) => (
              <OfferingRow
                key={row.id}
                row={row}
                singular={group.singular}
                isSelected={selectedIds.has(row.id)}
                reduceMotion={reduceMotion}
                onToggle={() => toggleOffering(row)}
              />
            ))}
          </View>
        ))}
      </View>
      <Text style={styles.offeringsHelp}>{OFFERINGS_HELP}</Text>
    </Animated.View>
  );
};

const OfferingRow: React.FC<{
  row: DiscountOfferingRow;
  singular: string;
  isSelected: boolean;
  reduceMotion: boolean;
  onToggle: () => void;
}> = ({ row, singular, isSelected, reduceMotion, onToggle }) => {
  const scale = useRef(new Animated.Value(1)).current;
  // Off rows can't be ticked; one already ticked stays tappable to untick.
  const disabled = !row.discountsAllowed && !isSelected;
  const meta = offeringMeta(row);
  const press = (): void => {
    if (!reduceMotion) {
      scale.stopAnimation();
      scale.setValue(0.85);
      Animated.timing(scale, {
        toValue: 1,
        duration: 160,
        easing: Easing.bezier(0.33, 1, 0.68, 1),
        useNativeDriver: nativeDriver,
      }).start();
    }
    onToggle();
  };
  return (
    <Pressable
      disabled={disabled}
      onPress={press}
      android_ripple={{ color: color.fill.inset }}
      accessibilityRole="checkbox"
      accessibilityLabel={`${row.title}, ${singular}`}
      accessibilityHint={
        row.discountsAllowed
          ? meta
          : `${meta}. Turn on Allow discounts for this offering to include it.`
      }
      accessibilityState={{ checked: isSelected, disabled }}
      testID={`discount-offering-${row.id}`}
      style={(state: PressState): StyleProp<ViewStyle> => [
        styles.offeringRow,
        state.hovered && !disabled ? styles.hover : null,
        isSelected && styles.itemCardSelected,
        !row.discountsAllowed && styles.itemCardDisabled,
        isSelected && !row.discountsAllowed ? styles.offSelected : null,
      ]}
    >
      <Animated.View
        style={[
          styles.checkbox,
          isSelected && styles.checkboxSelected,
          { transform: [{ scale }] },
        ]}
      >
        {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
      </Animated.View>
      <View style={styles.itemCopy}>
        <Text style={styles.offeringTitle} numberOfLines={2}>
          {row.title}
        </Text>
        <Text style={styles.offeringMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
};

const OfferingsSkeleton: React.FC<{ reduceMotion: boolean }> = ({
  reduceMotion,
}) => {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 1200,
          easing: Easing.bezier(0.37, 0, 0.63, 1),
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.bezier(0.37, 0, 0.63, 1),
          useNativeDriver: nativeDriver,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <Animated.View
      style={[styles.offerings, { opacity: pulse }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading offerings"
      testID="discount-offerings-loading"
    >
      <View style={styles.skeletonLabel} />
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonBox} />
          <View style={styles.skeletonLines}>
            <View style={[styles.skeletonBar, styles.skeletonTitle]} />
            <View style={[styles.skeletonBar, styles.skeletonMeta]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  label: { color: color.text1, fontSize: 14, fontWeight: "700" },
  help: { color: color.text2, fontSize: 13, lineHeight: 19 },
  scopeCards: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  // #4624: padding 8→12 (breathing room); minWidth 180→240 gives a fixed
  // 2×2 grid in the 608 pt desktop card and one card per row on phones.
  scopeCard: {
    flex: 1,
    minWidth: 240,
    minHeight: 76,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    padding: space[3],
    borderWidth: 1,
    borderColor: edge.ringInputFocus.borderColor,
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  // #4420 — selection is the selected material, not orange.
  scopeCardSelected: {
    borderColor: color.lineStrong,
    backgroundColor: color.card3,
  },
  hover: { backgroundColor: color.card2 },
  disabled: { opacity: 0.5 },
  radio: {
    width: 19,
    height: 19,
    marginTop: 1,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.text3,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: color.paper },
  radioCenter: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: color.paper,
  },
  scopeCopy: { flex: 1, gap: 3 },
  scopeTitle: { color: color.text1, fontSize: 14, fontWeight: "700" },
  scopeDescription: {
    color: color.text2,
    fontSize: 12,
    lineHeight: 17,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  chip: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: space[2],
    borderWidth: 1,
    borderColor: edge.ringInputFocus.borderColor,
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
  },
  chipSelected: {
    borderColor: color.lineStrong,
    backgroundColor: color.card3,
  },
  chipText: { color: color.text2, fontSize: 13, fontWeight: "600" },
  chipTextSelected: { color: color.text1 },
  itemGroups: { gap: space[4] },
  itemGroup: { gap: space[1] },
  groupTitle: {
    color: color.text2,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  itemGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  itemCard: {
    flexGrow: 1,
    flexBasis: 220,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    padding: space[2],
    borderWidth: 1,
    borderColor: edge.ringInputFocus.borderColor,
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  itemCardSelected: { borderColor: color.lineStrong, backgroundColor: color.card3 },
  itemCardDisabled: { opacity: 0.5 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.text3,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: { borderColor: color.paper, backgroundColor: color.paper },
  checkmark: { color: color.ink, fontSize: 13, fontWeight: "800" },
  itemCopy: { flex: 1, gap: 3 },
  itemName: { color: color.text1, fontSize: 14, fontWeight: "600" },
  itemMeta: { color: color.text2, fontSize: 12 },
  warning: {
    padding: space[2],
    borderRadius: radius.sm,
    backgroundColor: color.warningTint,
  },
  warningText: { color: color.text1, fontSize: 13 },
  // #4624 offerings picker (design §2-§4).
  offerings: { gap: space[2] },
  pickHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: space[2],
  },
  pickTitle: { color: color.text1, fontSize: 13, fontWeight: "700" },
  count: {
    color: color.text2,
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  offeringGroups: { gap: space[4] },
  offeringGroup: { gap: space[2] },
  offeringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    minHeight: 64,
    borderWidth: 1,
    borderColor: edge.ringInputFocus.borderColor,
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  // An already-ticked off row stays legible enough to untick.
  offSelected: { opacity: 0.75 },
  offeringTitle: {
    color: color.text1,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  offeringMeta: { color: color.text2, fontSize: 12, lineHeight: 16 },
  deletedRow: {
    backgroundColor: color.warningTint,
    borderColor: color.warningLine,
  },
  deletedMeta: { color: color.text1, fontSize: 12, lineHeight: 16 },
  offeringsHelp: {
    color: color.text2,
    fontSize: 13,
    lineHeight: 19,
    marginTop: space[1],
  },
  panel: {
    padding: space[4],
    borderRadius: radius.md,
    gap: 6,
    alignItems: "flex-start",
    backgroundColor: color.fill.inset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  panelError: {
    backgroundColor: color.solidTint.error,
    borderColor: color.errorLine,
  },
  panelTitle: { color: color.text1, fontSize: 14, fontWeight: "600" },
  panelBody: { color: color.text2, fontSize: 13, lineHeight: 19 },
  skeletonLabel: {
    width: 70,
    height: 12,
    borderRadius: 4,
    marginTop: space[2],
    backgroundColor: color.skeleton,
  },
  skeletonRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: color.skeleton,
  },
  skeletonBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: color.skeletonHi,
  },
  skeletonLines: { flex: 1, gap: 6 },
  skeletonBar: { borderRadius: 6, backgroundColor: color.skeletonHi },
  skeletonTitle: { width: "62%", height: 12 },
  skeletonMeta: { width: "40%", height: 10 },
});
