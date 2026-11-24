/** #4490 07-I — signed-out, token-scoped promoter guest-list page. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import {
  fetchPromoterGuestList,
  writePromoterGuestList,
} from "../../../../services/venuePromoterGuestListService";
import type { PromoterGuestListPage } from "../../../../types/venueOffers";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { GlassCard } from "../../../ui/GlassCard";
import { Input } from "../../../ui/Input";
import { NumberStepper } from "../../../ui/NumberStepper";
import { Pill, Segmented } from "../../../ui/Pill";
import { Skeleton } from "../../../ui/Skeleton";
import { dayDateLabel } from "../../../ui/fieldModels";
import { promoterGuestListErrorCopy, promoterGuestListTermsLine } from "./guestListModel";

export interface VisitGuestListProps {
  token: string | null;
  safeTop: number;
  safeBottom: number;
}

export function VisitGuestList({ token, safeTop, safeBottom }: VisitGuestListProps): React.ReactElement {
  const [page, setPage] = useState<PromoterGuestListPage | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(token !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(token === null ? "This promoter link isn't valid." : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [plusOnes, setPlusOnes] = useState(0);
  const [phone, setPhone] = useState("");

  const load = useCallback(async (): Promise<void> => {
    if (token === null) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchPromoterGuestList(token);
      setPage(next);
      setDate((current) => current ?? next.today);
    } catch (e) {
      setError(promoterGuestListErrorCopy(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedDate = date ?? page?.today ?? "";
  const night = page?.nights.find((candidate) => candidate.localDate === selectedDate) ?? null;
  const maxPlus = night?.terms.plusOnesMax ?? 0;
  const options = useMemo(
    () =>
      (page?.nights ?? []).map((candidate) => ({
        key: candidate.localDate,
        label: candidate.localDate === page?.today ? "Tonight" : dayDateLabel(candidate.localDate),
      })),
    [page],
  );

  const selectDate = (nextDate: string): void => {
    setDate(nextDate);
    setError(null);
    setNotice(null);
  };

  const mutate = async (action: "add" | "remove", entryId?: string): Promise<void> => {
    if (token === null || selectedDate.length === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await writePromoterGuestList({
        token,
        action,
        localDate: selectedDate,
        ...(action === "add"
          ? { guestName: name.trim(), plusOnes, phone: phone.trim() }
          : { entryId }),
      });
      if (action === "add") {
        setNotice(`${name.trim()} added to the list`);
        setName("");
        setPlusOnes(0);
        setPhone("");
      } else {
        setNotice("Name removed from the list");
      }
      await load();
    } catch (e) {
    setError(promoterGuestListErrorCopy(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading && page === null) {
    return (
      <View style={[styles.screen, { paddingTop: safeTop + space[5], paddingBottom: safeBottom + space[5] }]} testID="visit-guest-list-loading">
        <Skeleton height={34} width="60%" />
        <Skeleton height={56} radius="md" />
        <Skeleton height={240} radius="md" />
      </View>
    );
  }
  if (page === null) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: safeTop + space[5], paddingBottom: safeBottom + space[5] }]}>
        <CenteredState title="Guest list unavailable" body={error ?? "This promoter link is no longer active."} tone="error" testID="visit-guest-list-error">
          {token !== null ? <Button label="Try again" variant="secondary" size="md" onPress={() => void load()} /> : null}
        </CenteredState>
      </View>
    );
  }

  const terms = promoterGuestListTermsLine(page, selectedDate);
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.screen, { paddingTop: safeTop + space[5], paddingBottom: safeBottom + space[8] }]}
      keyboardShouldPersistTaps="handled"
      testID="visit-guest-list"
    >
      <View style={styles.hero}>
        <Pill variant="info">Private promoter link</Pill>
        <Text style={styles.eyebrow}>{page.venue.name}</Text>
        <Text style={styles.title} accessibilityRole="header">Guest list</Text>
        <Text style={styles.meta}>Hi {page.promoter.name}. Add names for tonight or any of the next seven nights.</Text>
      </View>

      <Segmented options={options} value={selectedDate} onChange={selectDate} accessibilityLabel="Night" testID="visit-guest-list-night" />
      {terms !== null ? <Text style={styles.terms}>{terms}</Text> : <Text style={styles.terms}>Ask the venue about entry terms for this night.</Text>}
      {notice !== null ? <Banner tone="ok" title={notice} /> : null}
      {error !== null ? <Banner tone="danger" title={error} testID="visit-guest-list-action-error" /> : null}

      <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="visit-guest-list-add">
        <Text style={styles.sectionTitle}>Add a name</Text>
        <Text style={styles.meta}>{dayDateLabel(selectedDate)}</Text>
        <Input value={name} onChangeText={(value) => setName(value.slice(0, 120))} placeholder="Guest name" accessibilityLabel="Guest name" autoFocus={false} testID="visit-guest-list-name" />
        <NumberStepper label="Plus-ones" value={plusOnes} min={0} max={maxPlus} onChange={setPlusOnes} testID="visit-guest-list-plus-ones" />
        <Input value={phone} onChangeText={(value) => setPhone(value.slice(0, 30))} placeholder="Phone (optional)" accessibilityLabel="Guest phone" />
        <Button label="Add to guest list" variant="primary" size="lg" fullWidth onPress={() => void mutate("add")} disabled={name.trim().length === 0 || saving} loading={saving} testID="visit-guest-list-add-submit" />
      </GlassCard>

      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="visit-guest-list-names">
        <Text style={styles.listHeading}>Your names · {dayDateLabel(selectedDate)}</Text>
        {night === null || night.entries.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No names added yet</Text>
            <Text style={styles.meta}>Names you add for this night appear here.</Text>
          </View>
        ) : (
          night.entries.map((entry) => (
            <View key={entry.id} style={styles.row} testID={`visit-guest-list-entry-${entry.id}`}>
              <View style={styles.grow}>
                <Text style={styles.rowTitle}>{entry.guestName}{entry.plusOnes > 0 ? ` +${entry.plusOnes}` : ""}</Text>
                {entry.phone !== null ? <Text style={styles.meta}>{entry.phone}</Text> : null}
              </View>
              {entry.arrived > 0 ? (
                <Pill variant="ok">Arrived</Pill>
              ) : (
                <Button label="Remove" variant="ghost" size="sm" onPress={() => void mutate("remove", entry.id)} disabled={saving} testID={`visit-guest-list-remove-${entry.id}`} />
              )}
            </View>
          ))
        )}
      </GlassCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.canvas },
  screen: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: space[4], gap: space[4] },
  center: { flex: 1, justifyContent: "center" },
  hero: { alignItems: "flex-start", gap: space[2] },
  eyebrow: { ...type.label, color: color.text2, marginTop: space[2] },
  title: { ...type.display, color: color.text1 },
  sectionTitle: { ...type.h2, color: color.text1 },
  rowTitle: { ...type.row, color: color.text1 },
  meta: { ...type.small, color: color.text2 },
  terms: { ...type.body, color: color.text1, paddingHorizontal: space[1] },
  card: { gap: space[3] },
  listCard: { overflow: "hidden", borderRadius: radius.lg },
  listHeading: { ...type.label, color: color.text3, paddingHorizontal: space[4], paddingVertical: space[3] },
  row: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.line },
  grow: { flex: 1, minWidth: 0 },
  empty: { alignItems: "center", gap: space[1], padding: space[6] },
  emptyTitle: { ...type.h2, color: color.text1 },
});
