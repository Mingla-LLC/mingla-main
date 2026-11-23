/**
 * #4490 spec 08 O5 part B — Settings › Selling in person
 * (`/venue/[venueId]/till-settings`, brand admins and above; ruled O5).
 *
 * Edits venue_till_settings through issue_4490_till_settings_set (version
 * checked; only what changed is sent): tips on or off and the tip choices,
 * the Till's auto-lock minutes (part A reads it), the paper floor PDFs are
 * made for, the default station for items with no station, which stations
 * have a screen (O3 reads it), the ticket target times, and the receipt
 * footer; plus the entry to Team › Till PIN. The business day is not a
 * setting any more: it follows the opening hours (one day for the Till, Close
 * the day and Paid in today), so this screen explains it instead.
 *
 * Never in a PIN session: on a Till device login the server refuses it and
 * this screen says so. Smart fields only (Switch, chips, steppers,
 * segmented); free text only for the footer.
 */

import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, space, suiteFormMaxWidth, type } from "../../../constants/designSystem";
import { useSaveTillSettings, useTillSettings } from "../../../hooks/useVenueDayClose";
import type { TillPrintPaper, TillSettings, TillStation } from "../../../services/venueDayCloseService";
import { TillError } from "../../../services/venueTillService";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { GlassCard } from "../../ui/GlassCard";
import { Input } from "../../ui/Input";
import { NumberStepper } from "../../ui/NumberStepper";
import { Chip, Segmented } from "../../ui/Pill";
import { Skeleton } from "../../ui/Skeleton";
import { Switch } from "../../ui/Switch";
import { Toast } from "../../ui/Toast";
import { closeErrorCopy, SETTINGS_COPY } from "../close/dayCloseCopy";
import {
  AUTO_LOCK_MAX,
  AUTO_LOCK_MIN,
  bpsToPercentText,
  FOOTER_MAX,
  settingsPatchFrom,
  settingsValid,
  TARGET_MAX,
  TARGET_MIN,
  TIP_OPTIONS_MAX,
} from "../close/dayCloseModel";

/** The tip choices a venue picks from (basis points). */
export const TIP_CHOICES_BPS: readonly number[] = [500, 750, 1000, 1250, 1500, 1800, 2000, 2500];

type ToastState = { kind: "success" | "error" | "info"; message: string } | null;

export function TillSettingsScreen({ venueId }: { venueId: string }): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useTillSettings(venueId);
  const save = useSaveTillSettings(venueId);
  const base = query.data ?? null;
  const [draft, setDraft] = useState<TillSettings | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  useEffect(() => {
    if (base !== null) setDraft(base);
  }, [base]);
  const patch = useMemo(() => (base !== null && draft !== null ? settingsPatchFrom(base, draft) : {}), [base, draft]);
  const dirty = Object.keys(patch).length > 0;

  const back = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/venue/${venueId}?module=settings` as never);
  };
  const set = (next: Partial<TillSettings>): void => setDraft((d) => (d === null ? d : { ...d, ...next }));
  const toggleTip = (bps: number): void => {
    if (draft === null) return;
    const has = draft.tipBpsOptions.includes(bps);
    if (!has && draft.tipBpsOptions.length >= TIP_OPTIONS_MAX) return;
    set({ tipBpsOptions: (has ? draft.tipBpsOptions.filter((b) => b !== bps) : [...draft.tipBpsOptions, bps]).sort((a, b) => a - b) });
  };
  const toggleScreen = (s: TillStation): void => {
    if (draft === null) return;
    set({ screenStations: draft.screenStations.includes(s) ? draft.screenStations.filter((x) => x !== s) : [...draft.screenStations, s] });
  };
  const onSave = async (): Promise<void> => {
    if (base === null || draft === null || !dirty) return;
    try {
      await save.mutateAsync({ patch, expectedVersion: base.version });
      setToast({ kind: "success", message: SETTINGS_COPY.saved });
    } catch (err) {
      setToast({ kind: "error", message: closeErrorCopy(err instanceof TillError ? err.code : "till_failed") });
    }
  };

  let body: React.ReactElement;
  if (query.isLoading) {
    body = <View style={styles.column}><Skeleton height={120} /><Skeleton height={160} /></View>;
  } else if (query.isError || base === null || draft === null) {
    const code = query.error instanceof TillError ? query.error.code : "till_failed";
    const noAccess = code === "not_authorized" || code === "pin_session_required" || code === "pin_session_invalid";
    body = (
      <CenteredState title={noAccess ? SETTINGS_COPY.noAccess : SETTINGS_COPY.loadFailed}
        body={noAccess ? null : closeErrorCopy(code)} testID="till-settings-error">
        {noAccess ? null : <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} testID="till-settings-retry" />}
      </CenteredState>
    );
  } else {
    const sc = draft.serviceChargeBps / 100;
    body = (
      <View style={styles.column}>
        <GlassCard testID="till-settings-tips">
          <View style={styles.section}>
            <Text style={styles.h3}>{SETTINGS_COPY.tips}</Text>
            <View style={styles.switchRow}>
              <Text style={styles.rowText}>{SETTINGS_COPY.tipsOn}</Text>
              <Switch value={draft.tipsEnabled} onValueChange={(v) => set({ tipsEnabled: v })} accessibilityLabel={SETTINGS_COPY.tipsOn}
                testID="till-settings-tips-on" />
            </View>
            {draft.tipsEnabled ? (
              <>
                <Text style={styles.label}>{SETTINGS_COPY.tipOptions}</Text>
                <View style={styles.chips}>
                  {TIP_CHOICES_BPS.map((bps) => (
                    <Chip key={bps} label={`${bpsToPercentText(bps)}${SETTINGS_COPY.percent}`} selected={draft.tipBpsOptions.includes(bps)}
                      disabled={!draft.tipBpsOptions.includes(bps) && draft.tipBpsOptions.length >= TIP_OPTIONS_MAX}
                      onPress={() => toggleTip(bps)} testID={`till-settings-tip-${bps}`} />
                  ))}
                </View>
                <Text style={styles.hint}>{SETTINGS_COPY.tipsHint}</Text>
              </>
            ) : null}
            <Text style={styles.label}>{SETTINGS_COPY.serviceCharge}</Text>
            <Text style={styles.hint}>{SETTINGS_COPY.serviceChargeValue(Number.isInteger(sc) ? String(sc) : sc.toFixed(1))}</Text>
          </View>
        </GlassCard>

        <GlassCard testID="till-settings-day">
          <View style={styles.section}>
            <Text style={styles.h3}>{SETTINGS_COPY.dayTitle}</Text>
            <Text style={styles.rowText}>{SETTINGS_COPY.dayBody}</Text>
            {draft.pastMidnightDays > 0 ? <Text style={styles.hint}>{SETTINGS_COPY.dayPastMidnight(draft.pastMidnightDays)}</Text> : null}
            <Button label={SETTINGS_COPY.dayHours} variant="secondary" size="sm" style={styles.inline}
              onPress={() => router.push(`/venue/${venueId}?module=settings` as never)} testID="till-settings-hours" />
          </View>
        </GlassCard>

        <GlassCard testID="till-settings-till">
          <View style={styles.section}>
            <NumberStepper label={SETTINGS_COPY.autoLock} value={draft.autoLockMinutes} min={AUTO_LOCK_MIN} max={AUTO_LOCK_MAX}
              onChange={(v) => set({ autoLockMinutes: v })} testID="till-settings-autolock" />
            <Text style={styles.hint}>{`${SETTINGS_COPY.minutes(draft.autoLockMinutes)} · ${SETTINGS_COPY.autoLockHint}`}</Text>
            <Text style={styles.label}>{SETTINGS_COPY.paper}</Text>
            <Segmented<TillPrintPaper>
              options={[
                { key: "a4", label: SETTINGS_COPY.paperA4 },
                { key: "roll_80", label: SETTINGS_COPY.paperRoll80 },
                { key: "roll_58", label: SETTINGS_COPY.paperRoll58 },
              ]}
              value={draft.printPaper} onChange={(k) => set({ printPaper: k })} accessibilityLabel={SETTINGS_COPY.paper}
              testID="till-settings-paper" />
          </View>
        </GlassCard>

        <GlassCard testID="till-settings-stations">
          <View style={styles.section}>
            <Text style={styles.label}>{SETTINGS_COPY.defaultStation}</Text>
            <Segmented<TillStation>
              options={[{ key: "kitchen", label: SETTINGS_COPY.kitchen }, { key: "bar", label: SETTINGS_COPY.bar }]}
              value={draft.defaultStation} onChange={(k) => set({ defaultStation: k })} accessibilityLabel={SETTINGS_COPY.defaultStation}
              testID="till-settings-default-station" />
            <Text style={styles.label}>{SETTINGS_COPY.screens}</Text>
            <View style={styles.chips}>
              {(["kitchen", "bar"] as const).map((s) => (
                <Chip key={s} label={s === "kitchen" ? SETTINGS_COPY.kitchen : SETTINGS_COPY.bar}
                  selected={draft.screenStations.includes(s)} onPress={() => toggleScreen(s)} testID={`till-settings-screen-${s}`} />
              ))}
            </View>
            <Text style={styles.hint}>{draft.kitchenScreensOn ? SETTINGS_COPY.screensHint : SETTINGS_COPY.screensOff}</Text>
            <Text style={styles.label}>{SETTINGS_COPY.targets}</Text>
            <NumberStepper label={`${SETTINGS_COPY.kitchen} (min)`} value={draft.targetMinutes.kitchen} min={TARGET_MIN} max={TARGET_MAX}
              onChange={(v) => set({ targetMinutes: { ...draft.targetMinutes, kitchen: v } })} testID="till-settings-target-kitchen" />
            <NumberStepper label={`${SETTINGS_COPY.bar} (min)`} value={draft.targetMinutes.bar} min={TARGET_MIN} max={TARGET_MAX}
              onChange={(v) => set({ targetMinutes: { ...draft.targetMinutes, bar: v } })} testID="till-settings-target-bar" />
            <Text style={styles.hint}>{SETTINGS_COPY.targetsHint}</Text>
          </View>
        </GlassCard>

        <GlassCard testID="till-settings-receipt">
          <View style={styles.section}>
            <Text style={styles.label}>{SETTINGS_COPY.footer}</Text>
            <Input value={draft.receiptFooter ?? ""} onChangeText={(v) => set({ receiptFooter: v.slice(0, FOOTER_MAX) })}
              placeholder={SETTINGS_COPY.footerPlaceholder} accessibilityLabel={SETTINGS_COPY.footer} testID="till-settings-footer" />
            <Text style={styles.hint}>{SETTINGS_COPY.footerCount((draft.receiptFooter ?? "").length)}</Text>
          </View>
        </GlassCard>

        <GlassCard testID="till-settings-pins">
          <View style={styles.section}>
            <Text style={styles.h3}>{SETTINGS_COPY.pins}</Text>
            <Text style={styles.rowText}>{SETTINGS_COPY.pinsBody}</Text>
            <Button label={SETTINGS_COPY.openTeam} variant="secondary" size="sm" style={styles.inline}
              onPress={() => router.push(`/brand/${draft.brandId}/team?venueId=${encodeURIComponent(venueId)}` as never)} testID="till-settings-team" />
          </View>
        </GlassCard>
        {!settingsValid(draft) ? <Banner tone="danger" title={closeErrorCopy("till_settings_invalid")} /> : null}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="till-settings-screen">
      <View style={styles.header}>
        <Button label="Close" variant="ghost" size="sm" onPress={back} testID="till-settings-back" />
        <View style={styles.titleBlock}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{SETTINGS_COPY.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{base?.venueName ?? SETTINGS_COPY.sub}</Text>
        </View>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.scroll} testID="till-settings-scroll">{body}</ScrollView>
      {draft !== null && base !== null ? (
        <View style={styles.saveBar}>
          <Button label={SETTINGS_COPY.save} variant="primary" size="lg" fullWidth loading={save.isPending}
            disabled={!dirty || save.isPending || !settingsValid(draft)} onPress={() => void onSave()} testID="till-settings-save" />
        </View>
      ) : null}
      <Toast visible={toast !== null} kind={toast?.kind ?? "info"} message={toast?.message ?? ""}
        onDismiss={() => setToast(null)} testID="till-settings-toast" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2] },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { ...type.h2, color: color.text1 },
  sub: { ...type.caption, color: color.text2 },
  grow: { flexGrow: 1 },
  scroll: { paddingHorizontal: space[4], paddingBottom: space[8], alignItems: "center" },
  column: { width: "100%", maxWidth: suiteFormMaxWidth, gap: space[4] },
  section: { gap: space[3] },
  h3: { ...type.row, color: color.text1 },
  rowText: { ...type.body, color: color.text2, flexShrink: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  label: { ...type.label, color: color.text3 },
  hint: { ...type.caption, color: color.text3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  inline: { alignSelf: "flex-start" },
  saveBar: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[3], alignItems: "center", width: "100%" },
});
