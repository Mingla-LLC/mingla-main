/**
 * /brand/[id]/tap-to-pay/address — T1 (#4389), fallback only.
 *
 * Tap to Pay on iPhone first uses the address the payment partner already
 * verified on the account. Only when it holds none does the Terminal path
 * answer address_missing with this route. One Google search box; the picked
 * address is shown back whole; one field appears only for a missing part.
 */
import React, { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddressInput } from "../../../../src/components/location/AddressInput";
// #4389 (device r4) — keyboard-aware column, as brand setup's steps: the
// avoiding view lifts Save address above the keyboard and its Done bar.
import { DONE_BAR_OCCUPIED, ScrollView } from "../../../../src/wrappers/SmartScrollView";
import { KeyboardAvoidingView } from "../../../../src/wrappers/SmartKeyboardAvoidingView";
import { Button } from "../../../../src/components/ui/Button";
import { CenteredState } from "../../../../src/components/ui/CenteredState";
import { BRAND_SETUP_ADDRESS_COPY as C } from "../../../../src/components/brand/brandSetupAddressCopy";
import { payoutCountryOption } from "../../../../src/components/brand/payoutCountryOptions";
import {
  tapAddressFromPlace,
  withBuildingNumber,
  type TapAddressDraft,
} from "../../../../src/components/brand/tapLocationAddress";
import { canvas, radius, semantic, spacing, text as textTokens, typography } from "../../../../src/constants/designSystem";
import { useBrandSetupChecklist, useSetTapLocationAddress } from "../../../../src/hooks/useBrandSetupChecklist";
import { useNetInfoSafe } from "../../../../src/lib/netinfoSafe";

export default function TapToPayAddressRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const brandId = (Array.isArray(params.id) ? params.id[0] : params.id) ?? null;
  const checklist = useBrandSetupChecklist(brandId);
  const bankCountry = checklist.data?.facts.payoutCountry ?? "";
  const countryName = payoutCountryOption(bankCountry)?.name ?? bankCountry;
  const save = useSetTapLocationAddress(brandId);
  const offline = useNetInfoSafe()?.isConnected === false;

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<TapAddressDraft | null>(null);
  const [number, setNumber] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  // #3291 — the tapped name is what the host sees back.
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  // Rank-only proximity (#3291): none for a card-payments address.
  const proximity: string | undefined = undefined;
  const postalLabel = bankCountry === "US" ? "ZIP code" : "postcode";

  const ready = useMemo(() => {
    if (draft === null) return null;
    if (draft.ok) return draft;
    if (draft.missing === "building_number" && number.trim()) {
      return { ...draft.partial, ok: true as const, line1: withBuildingNumber(draft.partial.line1, number) };
    }
    return null;
  }, [draft, number]);

  const submit = (): void => {
    if (ready === null || offline) return;
    setError(null);
    save.mutate(
      {
        line1: ready.line1,
        line2: unit.trim() || null,
        city: ready.city,
        state: ready.state,
        postalCode: ready.postalCode,
        country: ready.country,
      },
      {
        onSuccess: () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home" as never)),
        onError: () => setError(C.t1.refused),
      },
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="tap-to-pay-address">
      {/* The column starts insets.top below the screen top (see setupKeyboardOffset). */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={DONE_BAR_OCCUPIED + insets.top} style={styles.fill}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.h1} accessibilityRole="header">{C.t1.title}</Text>
        <Text style={styles.sub}>{Platform.OS === "android" ? C.t1.helperAndroid : C.t1.helper}</Text>
        {draft === null || (!draft.ok && draft.missing !== "building_number") ? (
          <>
            <AddressInput
              value={query}
              onChangeText={setQuery}
              placeholder={C.t1.search}
              accessibilityLabel={C.t1.search}
              onClear={() => setDraft(null)}
              proximity={proximity}
              onPick={(details, selectedLabel) => {
                const label = selectedLabel ?? details.formattedAddress;
                setPickedLabel(label);
                const next = tapAddressFromPlace(
                  {
                    line1: details.line1 ?? null,
                    postalCode: details.postalCode ?? null,
                    city: details.city,
                    regionCode: details.regionCode,
                    countryCode: details.countryCode,
                  },
                  bankCountry,
                );
                setDraft(next);
                setError(next.ok || next.missing === "building_number" ? null : C.t1.noMatch(countryName, postalLabel));
              }}
            />
            <Text style={styles.helper}>{C.t1.searchHelper}</Text>
            <Text style={styles.helper}>{C.t1.poweredByGoogle}</Text>
          </>
        ) : (
          <View style={styles.card} accessibilityRole="summary">
            <Text style={styles.cardLine}>{ready?.line1 ?? (draft.ok ? draft.line1 : draft.partial.line1)}</Text>
            <Text style={styles.cardSub}>
              {[draft.ok ? draft.city : draft.partial.city, draft.ok ? draft.state : draft.partial.state, draft.ok ? draft.postalCode : draft.partial.postalCode].filter(Boolean).join(" ")}
            </Text>
            <Text style={styles.cardSub}>{countryName}</Text>
            {pickedLabel !== null ? <Text style={styles.cardSub}>{pickedLabel}</Text> : null}
            <Button label={C.t1.change} onPress={() => { setDraft(null); setNumber(""); }} variant="secondary" size="sm" />
          </View>
        )}
        {draft !== null && !draft.ok && draft.missing === "building_number" ? (
          <>
            <Text style={styles.label}>{C.t1.buildingNumber}</Text>
            <TextInput value={number} onChangeText={setNumber} style={styles.input} accessibilityLabel={C.t1.buildingNumber} />
            {!number.trim() ? <Text style={[styles.helper, styles.err]}>{C.t1.buildingNumberError}</Text> : null}
          </>
        ) : null}
        {draft !== null && (draft.ok || draft.missing === "building_number") ? (
          <>
            <Text style={styles.label}>{C.t1.unit}</Text>
            <TextInput value={unit} onChangeText={setUnit} style={styles.input} accessibilityLabel={C.t1.unit} />
          </>
        ) : null}
        {error !== null ? (
          // #4389 — centred like every other no-match / error state.
          <CenteredState compact tone="error" title={error} accessibilityRole="alert" testID="t1-error" />
        ) : null}
        {offline ? <Text style={styles.helper}>{C.common.offline}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button testID="tap-address-save" label={C.t1.save} onPress={submit} variant="primary" size="lg" fullWidth disabled={ready === null || offline} loading={save.isPending} />
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canvas.discover },
  fill: { flex: 1 },
  body: { padding: spacing.md, gap: spacing.sm, maxWidth: 560, width: "100%", alignSelf: "center" },
  footer: { padding: spacing.md, maxWidth: 560, width: "100%", alignSelf: "center" },
  h1: { ...typography.h1, color: textTokens.primary },
  sub: { ...typography.body, color: textTokens.secondary },
  helper: { ...typography.bodySm, color: textTokens.tertiary },
  err: { color: semantic.errorText },
  label: { ...typography.bodySm, color: textTokens.secondary, marginTop: spacing.sm },
  input: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: "rgba(255,255,255,0.06)", color: textTokens.primary },
  card: { padding: spacing.md, gap: spacing.xs, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.06)" },
  cardLine: { ...typography.body, color: textTokens.primary, fontWeight: "600" },
  cardSub: { ...typography.bodySm, color: textTokens.secondary },
});
