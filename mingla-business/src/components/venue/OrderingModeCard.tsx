/**
 * #4490 07-D — Menu › "How guests get their order".
 *
 * Three choices, saved through biz_venue_ordering_set_mode: At the table,
 * Collect at the counter, or Both. The mode is derived from the venue's two
 * ordering switches (one owner per truth); the server places the order.
 */
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import {
  useSetVenueOrderMode,
  useVenueOrderingSettings,
  venueOrderModeErrorCopy,
  venueOrderModeOf,
  type VenueOrderMode,
} from "../../hooks/useVenueOrderingSettings";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import type { IconName } from "../ui/Icon";
import { OptionCard } from "../ui/OptionCard";

const LazyToast = React.lazy(async () => {
  const mod = await import("../ui/Toast");
  return { default: mod.Toast };
});

export const ORDER_MODE_OPTIONS: ReadonlyArray<{
  mode: VenueOrderMode;
  label: string;
  helper: string;
  icon: IconName;
}> = [
  { mode: "table", label: "At the table", helper: "We bring it to the table they scanned.", icon: "qr" },
  { mode: "counter", label: "Collect at the counter", helper: "They collect it when we call their name.", icon: "users" },
  { mode: "both", label: "Both", helper: "They choose when they order at a table.", icon: "grid" },
];

export const ORDER_MODE_SAVED = "Ordering mode saved";

export interface OrderingModeCardProps {
  venueId: string;
  canMutate: boolean;
}

export function OrderingModeCard({ venueId, canMutate }: OrderingModeCardProps): React.ReactElement {
  const settingsQuery = useVenueOrderingSettings(venueId);
  const setMode = useSetVenueOrderMode(venueId);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<VenueOrderMode | null>(null);

  const current: VenueOrderMode | null =
    settingsQuery.data === undefined ? null : venueOrderModeOf(settingsQuery.data);
  const shown = pending ?? current;

  const choose = useCallback(
    (mode: VenueOrderMode): void => {
      if (!canMutate || setMode.isPending || mode === current) return;
      setError(null);
      setPending(mode);
      setMode.mutate(mode, {
        onSuccess: () => {
          setPending(null);
          setToast(ORDER_MODE_SAVED);
        },
        onError: (e: Error) => {
          setPending(null);
          setError(venueOrderModeErrorCopy(e));
        },
      });
    },
    [canMutate, current, setMode],
  );

  return (
    <GlassCard variant="base" style={styles.card} testID="venue-order-mode-card">
      <Text style={styles.title} accessibilityRole="header">
        How guests get their order
      </Text>
      {settingsQuery.isLoading ? (
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          Loading how guests order…
        </Text>
      ) : settingsQuery.isError ? (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>Couldn&apos;t load how guests order. Try again.</Text>
          <Button
            label="Retry"
            variant="secondary"
            size="sm"
            onPress={() => void settingsQuery.refetch()}
            testID="venue-order-mode-retry"
          />
        </View>
      ) : (
        <View style={styles.options} accessibilityRole="radiogroup">
          {ORDER_MODE_OPTIONS.map((option) => (
            <OptionCard
              key={option.mode}
              label={option.label}
              helper={option.helper}
              icon={option.icon}
              selected={shown === option.mode}
              disabled={!canMutate || setMode.isPending}
              onPress={() => choose(option.mode)}
              testID={`venue-order-mode-${option.mode}`}
            />
          ))}
        </View>
      )}
      {!canMutate && !settingsQuery.isLoading && !settingsQuery.isError ? (
        <Text style={styles.muted}>Only managers can change this.</Text>
      ) : null}
      {setMode.isPending ? (
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          Saving…
        </Text>
      ) : null}
      {error !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="assertive" testID="venue-order-mode-error">
          {error}
        </Text>
      ) : null}
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast
            visible
            kind="success"
            message={toast}
            onDismiss={() => setToast(null)}
            testID="venue-order-mode-toast"
          />
        </React.Suspense>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  title: { ...type.h2, color: color.text1 },
  options: { gap: space[2] },
  muted: { ...type.small, color: color.text2 },
  error: { ...type.small, color: color.errorText },
  errorBlock: { gap: space[2], alignItems: "flex-start" },
});
