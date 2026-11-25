/** #4490 07-I — host guest-list terms, names and promoter links. */
import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { BUSINESS_PUBLIC_ORIGIN } from "../../../../constants/publicUrls";
import { color, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useManageVenueGuestList, useVenueGuestList } from "../../../../hooks/useVenueGuestList";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { VenueGuestListEntry, VenueGuestListPromoter } from "../../../../types/venueOffers";
import { copyPublicUrl } from "../../../../utils/sharePublicUrl";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { DayDateField } from "../../../ui/DayDateField";
import { GlassCard } from "../../../ui/GlassCard";
import { Input } from "../../../ui/Input";
import { NumberStepper } from "../../../ui/NumberStepper";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Pill } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Sheet } from "../../../ui/Sheet";
import { Skeleton } from "../../../ui/Skeleton";
import { TimeField } from "../../../ui/TimeField";
import { dayDateLabel } from "../../../ui/fieldModels";
import { money } from "../offers/offersModel";

export interface VenueGuestListModuleProps {
  brandId: string | null;
  venueId: string | null;
}

type AddMode = "name" | "promoter" | null;

function publicLink(token: string): string {
  const origin =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.origin
      : BUSINESS_PUBLIC_ORIGIN;
  return `${origin}/visit/list/${token}`;
}

function errorCopy(error: unknown): string {
  const code = toVenueOfferError(error).code;
  if (code === "already_on_list") return "That name is already on this night's list.";
  if (code === "stale_write") return "Someone changed this while you were working. Reload and try again.";
  if (code === "guest_list_reduced_price_invalid") return "Choose an active price from a live Entry offer.";
  if (code === "guest_list_time_invalid") return "Use a 24-hour time, like 23:00.";
  if (code === "not_authorized") return "You don't have permission to manage this guest list.";
  return "That change didn't save. Check your connection and try again.";
}

export function VenueGuestListModule({ brandId, venueId }: VenueGuestListModuleProps): React.ReactElement {
  const [date, setDate] = useState<string | null>(null);
  const listQuery = useVenueGuestList(brandId, venueId, date);
  const offersQuery = useVenueOffers(brandId, venueId);
  const manage = useManageVenueGuestList(brandId, venueId);
  const currency = useBrandCurrency(brandId);
  const [mode, setMode] = useState<AddMode>(null);
  const [guestName, setGuestName] = useState("");
  const [plusOnes, setPlusOnes] = useState(0);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [promoterId, setPromoterId] = useState<string | null>(null);
  const [promoterName, setPromoterName] = useState("");
  const [promoterPhone, setPromoterPhone] = useState("");
  const [promoterEmail, setPromoterEmail] = useState("");
  const [namesPerNight, setNamesPerNight] = useState(50);
  const [freeUntil, setFreeUntil] = useState("");
  const [reducedUntil, setReducedUntil] = useState("");
  const [reducedOptionId, setReducedOptionId] = useState<string | null>(null);
  const [plusOnesMax, setPlusOnesMax] = useState(3);
  const [closesBefore, setClosesBefore] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});

  const data = listQuery.data;
  const shownDate = date ?? data?.localDate ?? "";
  useEffect(() => {
    if (data === undefined) return;
    setFreeUntil(data.terms.freeUntil ?? "");
    setReducedUntil(data.terms.reducedUntil ?? "");
    setReducedOptionId(data.terms.reducedPriceOptionId);
    setPlusOnesMax(data.terms.plusOnesMax);
    setClosesBefore(data.terms.closesMinutesBefore);
  }, [data]);

  const entryPrices = useMemo(
    () =>
      (offersQuery.data?.offers ?? [])
        .filter((offer) => offer.kind === "entry" && offer.status === "live")
        .flatMap((offer) =>
          offer.options
            .filter((option) => option.status === "active")
            .map((option) => ({
              value: option.id,
              label: `${offer.name} · ${option.name} · ${money(option.priceMinor, currency)}`,
            })),
        ),
    [currency, offersQuery.data?.offers],
  );

  const run = (
    input: Parameters<typeof manage.mutate>[0],
    onSuccess?: (result: Record<string, unknown>) => void,
  ): void => {
    setError(null);
    setNotice(null);
    manage.mutate(input, {
      onSuccess: (result) => onSuccess?.(result),
      onError: (e) => setError(errorCopy(e)),
    });
  };

  if (listQuery.isLoading) {
    return (
      <View style={styles.host} testID="venue-guest-list-loading">
        <Skeleton height={30} width="35%" />
        <Skeleton height={150} radius="md" />
        <Skeleton height={220} radius="md" />
      </View>
    );
  }
  if (listQuery.isError || data === undefined) {
    return (
      <CenteredState title="Couldn't load the guest list" body="Check your connection and try again." tone="error" testID="venue-guest-list-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void listQuery.refetch()} />
      </CenteredState>
    );
  }

  const groups = new Map<string, { title: string; entries: VenueGuestListEntry[] }>();
  for (const entry of data.entries) {
    const key = entry.promoterId ?? "staff";
    const group = groups.get(key) ?? { title: entry.promoterName ?? "Venue team", entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }

  const resetAdd = (): void => {
    setGuestName("");
    setPlusOnes(0);
    setPhone("");
    setNote("");
    setPromoterId(null);
    setPromoterName("");
    setPromoterPhone("");
    setPromoterEmail("");
    setNamesPerNight(50);
    setMode(null);
  };

  const saveTerms = (): void => {
    run(
      {
        action: "set_terms",
        payload: {
          freeUntil,
          reducedUntil,
          reducedPriceOptionId: reducedUntil.length > 0 ? reducedOptionId ?? "" : "",
          plusOnesMax,
          closesMinutesBefore: closesBefore,
        },
        expectedVersion: data.terms.version,
      },
      () => setNotice("List terms saved"),
    );
  };

  const copyLink = (promoter: VenueGuestListPromoter): void => {
    const link = links[promoter.id];
    if (link === undefined) {
      setNotice("Make a new link first. Existing links can't be recovered after they are created.");
      return;
    }
    void copyPublicUrl(link).then(
      () => setNotice(`Link copied for ${promoter.name}`),
      () => setError("The link couldn't be copied. Try again."),
    );
  };

  const makeLink = (promoter: VenueGuestListPromoter): void => {
    run(
      {
        action: "new_promoter_link",
        payload: { promoterId: promoter.id },
        expectedVersion: promoter.version,
      },
      (result) => {
        const token = typeof result.token === "string" ? result.token : null;
        if (token === null) {
          setError("The new link wasn't returned. Make another link and try again.");
          return;
        }
        const link = publicLink(token);
        setLinks((current) => ({ ...current, [promoter.id]: link }));
        void copyPublicUrl(link).then(
          () => setNotice(`New link made and copied for ${promoter.name}`),
          () => setNotice(`New link made for ${promoter.name}. Use Copy link to try again.`),
        );
      },
    );
  };

  return (
    <View style={styles.host} testID="venue-guest-list-module">
      <View style={styles.header}>
        <View style={styles.headCopy}>
          <Text style={styles.title} accessibilityRole="header">Guest list</Text>
          <Text style={styles.meta}>{data.counts.names} names · {data.counts.in} in</Text>
        </View>
        <View style={styles.actions}>
          <Button label="Add names" variant="primary" size="sm" leadingIcon="plus" onPress={() => setMode("name")} testID="guest-list-add-name" />
          <Button label="Add promoter" variant="secondary" size="sm" leadingIcon="plus" onPress={() => setMode("promoter")} testID="guest-list-add-promoter" />
        </View>
      </View>

      <View style={styles.dateField}>
        <DayDateField label="Night" value={shownDate} onChangeValue={(value) => setDate(value)} accessibilityLabel="Guest-list night" today={data.localDate} testID="guest-list-date" />
      </View>
      {notice !== null ? <Banner tone="ok" title={notice} /> : null}
      {error !== null ? <Banner tone="danger" title="That didn't save" body={error} testID="guest-list-save-error" /> : null}

      <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="guest-list-terms">
        <View style={styles.cardHead}>
          <View style={styles.grow}>
            <Text style={styles.sectionTitle}>List terms</Text>
            <Text style={styles.meta}>Set what the door gives listed guests and when the list closes.</Text>
          </View>
          <Button label="Save terms" variant="secondary" size="sm" onPress={saveTerms} loading={manage.isPending} testID="guest-list-save-terms" />
        </View>
        <View style={styles.fieldRow}>
          <View style={styles.fieldHalf}>
            <TimeField label="Free until" value={freeUntil} onChangeValue={setFreeUntil} accessibilityLabel="Free entry until" testID="guest-list-free-until" />
          </View>
          <View style={styles.fieldHalf}>
            <TimeField label="Reduced until" value={reducedUntil} onChangeValue={setReducedUntil} accessibilityLabel="Reduced entry until" disabled={entryPrices.length === 0} testID="guest-list-reduced-until" />
          </View>
        </View>
        <SelectSheet
          label="Price after free entry"
          value={reducedOptionId}
          options={entryPrices}
          onChange={setReducedOptionId}
          disabled={entryPrices.length === 0 || reducedUntil.length === 0}
          placeholder="Choose an Entry price"
          testID="guest-list-reduced-price"
        />
        {entryPrices.length === 0 ? <Text style={styles.hint}>Turn on Entry and add a price to charge a reduced price.</Text> : null}
        <View style={styles.fieldRow}>
          <View style={styles.fieldHalf}>
            <NumberStepper label="Plus-ones max" value={plusOnesMax} min={0} max={10} onChange={setPlusOnesMax} testID="guest-list-plus-max" />
          </View>
          <View style={styles.fieldHalf}>
            <NumberStepper label="Closes before opening (minutes)" value={closesBefore} min={0} max={1440} onChange={setClosesBefore} testID="guest-list-closes-before" />
          </View>
        </View>
      </GlassCard>

      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="guest-list-names">
        <Text style={styles.listHeading}>Names for {dayDateLabel(data.localDate)}</Text>
        {data.entries.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No one on the list for {dayDateLabel(data.localDate)}.</Text>
            <Text style={styles.meta}>Add names or share a promoter link.</Text>
          </View>
        ) : (
          [...groups.entries()].map(([key, group]) => (
            <View key={key}>
              <Text style={styles.groupHeading}>{group.title}</Text>
              {group.entries.map((entry) => {
                const total = 1 + entry.plusOnes;
                return (
                  <View key={entry.id} style={styles.row} testID={`guest-list-entry-${entry.id}`}>
                    <View style={styles.grow}>
                      <Text style={styles.rowTitle}>{entry.guestName}{entry.plusOnes > 0 ? ` +${entry.plusOnes}` : ""}</Text>
                      <Text style={styles.meta}>{entry.phone ?? "No phone"}{entry.note ? ` · ${entry.note}` : ""}</Text>
                    </View>
                    <Pill variant={entry.arrived >= total ? "ok" : entry.arrived > 0 ? "info" : "muted"}>
                      {entry.arrived >= total ? "In" : entry.arrived > 0 ? `${entry.arrived} of ${total} in` : "To arrive"}
                    </Pill>
                    {entry.arrived === 0 ? (
                      <Button
                        label="Remove"
                        variant="ghost"
                        size="sm"
                        onPress={() => run({ action: "remove_entry", payload: { entryId: entry.id }, expectedVersion: entry.version })}
                        disabled={manage.isPending}
                        testID={`guest-list-remove-${entry.id}`}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))
        )}
      </GlassCard>

      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="guest-list-promoters">
        <Text style={styles.listHeading}>Promoters</Text>
        {data.promoters.length === 0 ? (
          <Text style={styles.emptyPad}>Add a promoter to give them their own private link.</Text>
        ) : (
          data.promoters.map((promoter) => (
            <View key={promoter.id} style={styles.promoterRow} testID={`guest-list-promoter-${promoter.id}`}>
              <View style={styles.grow}>
                <View style={styles.promoterName}>
                  <Text style={styles.rowTitle}>{promoter.name}</Text>
                  <Pill variant={promoter.active ? "ok" : "muted"}>{promoter.active ? "Active" : "Paused"}</Pill>
                </View>
                <Text style={styles.meta}>{promoter.names} names · {promoter.in} in{promoter.namesPerNight !== null ? ` · max ${promoter.namesPerNight} each night` : ""}</Text>
              </View>
              <View style={styles.rowActions}>
                <Button label="Copy link" variant="secondary" size="sm" leadingIcon="copy" onPress={() => copyLink(promoter)} disabled={!promoter.active} />
                <Button label="New link" variant="ghost" size="sm" onPress={() => makeLink(promoter)} disabled={!promoter.active || manage.isPending} />
                {promoter.active ? (
                  <Button
                    label="Pause"
                    variant="ghost"
                    size="sm"
                    onPress={() => run({ action: "pause_promoter", payload: { promoterId: promoter.id }, expectedVersion: promoter.version })}
                    disabled={manage.isPending}
                  />
                ) : null}
              </View>
            </View>
          ))
        )}
      </GlassCard>

      <Sheet visible={mode !== null} onClose={resetAdd} snapPoint={0.85} testID="guest-list-add-sheet">
        <View style={styles.sheet}>
          <PickerSheetHead title={mode === "promoter" ? "Add a promoter" : "Add names"} onClose={resetAdd} />
          <ScrollView style={styles.grow} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            {mode === "promoter" ? (
              <>
                <Input value={promoterName} onChangeText={(value) => setPromoterName(value.slice(0, 80))} placeholder="Promoter name" accessibilityLabel="Promoter name" testID="guest-list-promoter-name" />
                <Input value={promoterPhone} onChangeText={(value) => setPromoterPhone(value.slice(0, 30))} placeholder="Phone (optional)" accessibilityLabel="Promoter phone" />
                <Input value={promoterEmail} onChangeText={(value) => setPromoterEmail(value.slice(0, 200))} variant="email" placeholder="Email (optional)" accessibilityLabel="Promoter email" />
                <NumberStepper label="Names per night" value={namesPerNight} min={1} max={500} onChange={setNamesPerNight} testID="guest-list-promoter-limit" />
                <Button
                  label="Add promoter and copy link"
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={manage.isPending}
                  disabled={promoterName.trim().length === 0}
                  onPress={() =>
                    run(
                      {
                        action: "add_promoter",
                        payload: { name: promoterName.trim(), phone: promoterPhone.trim(), email: promoterEmail.trim(), namesPerNight },
                      },
                      (result) => {
                        const promoter = result.promoter as Record<string, unknown> | undefined;
                        const id = typeof promoter?.id === "string" ? promoter.id : null;
                        const token = typeof result.token === "string" ? result.token : null;
                        if (id !== null && token !== null) {
                          const link = publicLink(token);
                          setLinks((current) => ({ ...current, [id]: link }));
                          void copyPublicUrl(link).then(
                            () => setNotice(`Link copied for ${promoterName.trim()}`),
                            () => setNotice(`Promoter added. Use Copy link to copy their link.`),
                          );
                        }
                        resetAdd();
                      },
                    )
                  }
                  testID="guest-list-promoter-save"
                />
              </>
            ) : (
              <>
                <Text style={styles.meta}>For {dayDateLabel(data.localDate)}</Text>
                <Input value={guestName} onChangeText={(value) => setGuestName(value.slice(0, 120))} placeholder="Guest name" accessibilityLabel="Guest name" autoFocus testID="guest-list-name" />
                <NumberStepper label="Plus-ones" value={plusOnes} min={0} max={data.terms.plusOnesMax} onChange={setPlusOnes} testID="guest-list-plus-ones" />
                <Input value={phone} onChangeText={(value) => setPhone(value.slice(0, 30))} placeholder="Phone (optional)" accessibilityLabel="Guest phone" />
                <Input value={note} onChangeText={(value) => setNote(value.slice(0, 300))} placeholder="Note (optional)" accessibilityLabel="Guest-list note" />
                <SelectSheet
                  label="Promoter (optional)"
                  value={promoterId}
                  options={data.promoters.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))}
                  onChange={setPromoterId}
                  placeholder="Venue team"
                  testID="guest-list-name-promoter"
                />
                <Button
                  label="Add to guest list"
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={manage.isPending}
                  disabled={guestName.trim().length === 0}
                  onPress={() =>
                    run(
                      {
                        action: "add_entry",
                        payload: {
                          localDate: data.localDate,
                          guestName: guestName.trim(),
                          plusOnes,
                          phone: phone.trim(),
                          note: note.trim(),
                          promoterId: promoterId ?? "",
                        },
                      },
                      () => {
                        setNotice(`${guestName.trim()} added to the list`);
                        resetAdd();
                      },
                    )
                  }
                  testID="guest-list-name-save"
                />
              </>
            )}
          </ScrollView>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[3], flexWrap: "wrap" },
  headCopy: { gap: 2 },
  title: { ...type.h1, color: color.text1 },
  sectionTitle: { ...type.h2, color: color.text1 },
  rowTitle: { ...type.row, color: color.text1 },
  meta: { ...type.small, color: color.text2 },
  hint: { ...type.caption, color: color.text3 },
  actions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  dateField: { maxWidth: 340 },
  card: { gap: space[3] },
  cardHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  fieldRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap" },
  fieldHalf: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
  grow: { flex: 1, minWidth: 0 },
  listCard: { overflow: "hidden" },
  listHeading: { ...type.label, color: color.text3, paddingHorizontal: space[4], paddingVertical: space[3] },
  groupHeading: { ...type.small, color: color.text2, backgroundColor: color.fill.inset, paddingHorizontal: space[4], paddingVertical: space[2] },
  row: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.line, flexWrap: "wrap" },
  promoterRow: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.line, flexWrap: "wrap" },
  promoterName: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  rowActions: { flexDirection: "row", gap: space[1], flexWrap: "wrap" },
  empty: { alignItems: "center", gap: space[1], padding: space[6] },
  emptyTitle: { ...type.h2, color: color.text1, textAlign: "center" },
  emptyPad: { ...type.small, color: color.text2, paddingHorizontal: space[4], paddingBottom: space[4] },
  sheet: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2] },
  sheetScroll: { gap: space[3], paddingBottom: space[10] },
});
