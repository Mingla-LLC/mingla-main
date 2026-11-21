/**
 * #4490 P6-2/K — Plans (`mb-plans`): the venue's monthly and yearly plans with price,
 * what's included, members (of the limit) and status, plus a row menu (Edit,
 * Stop new members / Put back on sale, Archive with a confirm). "New plan"
 * opens the editor. A line links meeting rooms to their By the hour offers.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useVenueListing } from "../../../../hooks/useVenueListings";
import { useManageMembershipPlan, useVenueMembershipPlans } from "../../../../hooks/useVenueMembershipPlans";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { MembershipPlan } from "../../../../types/venueMembers";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { GlassCard } from "../../../ui/GlassCard";
import { Icon } from "../../../ui/Icon";
import { IconChrome } from "../../../ui/IconChrome";
import { Menu } from "../../../ui/Menu";
import { Pill } from "../../../ui/Pill";
import { Skeleton } from "../../../ui/Skeleton";
import { money } from "../offers/offersModel";
import { hourPlacesTitle, planErrorCopy, planIncludesLines, planStatusWords, planTermsLine } from "./membersModel";

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

export interface PlansViewProps {
  brandId: string | null;
  venueId: string | null;
  canEdit: boolean;
  onBack: () => void;
  onEdit: (planId: string | null) => void;
  onOpenOffers?: () => void;
  onToast: (text: string) => void;
}

type Confirm = { action: "pause" | "archive"; plan: MembershipPlan } | null;

function planLines(plan: MembershipPlan): string[] {
  return planIncludesLines(
    {
      entryIncluded: plan.entryIncluded,
      guestPasses: plan.guestPasses,
      roomHours: plan.roomHours,
      discountPercent: Math.round(plan.discountBps / 100),
      discountKinds: plan.discountKinds,
      inclusions: plan.inclusions,
      period: plan.period,
    },
    { entryOffer: plan.entryOfferName, hourOffers: plan.hourOfferNames },
  );
}

export function PlansView({ brandId, venueId, canEdit, onBack, onEdit, onOpenOffers, onToast }: PlansViewProps): React.ReactElement {
  const venueCategory = useVenueListing(venueId).data?.venueCategory ?? null;
  const { isWideDesktop } = useResponsiveLayout();
  const currency = useBrandCurrency(brandId);
  const query = useVenueMembershipPlans(brandId, venueId);
  const manage = useManageMembershipPlan(brandId, venueId);
  const [menu, setMenu] = useState<MembershipPlan | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const head = (
    <View style={styles.header}>
      <View style={styles.headLeft}>
        <IconChrome icon="chevL" size={36} accessibilityLabel="Back to members" onPress={onBack} testID="venue-plans-back" />
        <Text style={styles.title} accessibilityRole="header">Plans</Text>
      </View>
      {canEdit ? <Button label="New plan" variant="primary" size="sm" leadingIcon="plus" onPress={() => onEdit(null)} testID="venue-plans-new" /> : null}
    </View>
  );

  if (query.isLoading) {
    return (
      <View style={styles.host} testID="venue-plans-loading">
        {head}
        <Skeleton height={64} radius="md" />
        <Skeleton height={64} radius="md" />
      </View>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <View style={styles.host}>
        {head}
        <CenteredState title="Couldn't load your plans" body="Check your connection and try again." tone="error" testID="venue-plans-error">
          <Button label="Try again" variant="secondary" size="md" onPress={() => void query.refetch()} />
        </CenteredState>
      </View>
    );
  }
  const state = query.data;
  const plans = state.plans.filter((p) => p.status !== "archived");

  const run = (plan: MembershipPlan, action: "publish" | "pause" | "archive", done: string): void => {
    setRowError(null);
    setConfirmError(null);
    manage.mutate(
      { action, payload: { planId: plan.id }, expectedVersion: plan.version },
      {
        onSuccess: () => {
          setConfirm(null);
          onToast(done);
        },
        onError: (e) => {
          const err = toVenueOfferError(e);
          const text = planErrorCopy(err.code, err.detail);
          if (confirm !== null) setConfirmError(text);
          else setRowError(text);
        },
      },
    );
  };

  return (
    <View style={styles.host} testID="venue-plans">
      {head}
      {rowError !== null ? <Text style={styles.error} accessibilityRole="alert">{rowError}</Text> : null}
      {plans.length === 0 ? (
        <GlassCard variant="base" padding={space[5]} contentStyle={styles.empty} testID="venue-plans-empty">
          <Icon name="award" size={28} color={color.text3} />
          <Text style={styles.emptyTitle}>No plans yet</Text>
          <Text style={styles.meta}>A plan is a monthly or yearly membership: free entry, room hours, guest passes or a member price.</Text>
          {canEdit ? <Button label="New plan" variant="primary" size="md" onPress={() => onEdit(null)} testID="venue-plans-empty-new" /> : null}
        </GlassCard>
      ) : (
        <GlassCard variant="base" padding={0} contentStyle={styles.list} testID="venue-plans-list">
          {isWideDesktop ? (
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.headCell, styles.colName]}>Plan</Text>
              <Text style={[styles.headCell, styles.colPrice]}>Price</Text>
              <Text style={[styles.headCell, styles.colInc]}>Includes</Text>
              <Text style={[styles.headCell, styles.colMembers]}>Members</Text>
              <Text style={[styles.headCell, styles.colStatus]}>Status</Text>
              <View style={styles.colMenu} />
            </View>
          ) : null}
          {plans.map((plan, index) => {
            const st = planStatusWords(plan);
            const lines = planLines(plan);
            const members = plan.maxMembers !== null ? `${plan.activeMembers} of ${plan.maxMembers}` : `${plan.activeMembers}`;
            const price = `${money(plan.priceMinor, plan.currencyCode || currency)} a ${plan.period}`;
            return (
              <View key={plan.id} style={[styles.row, index > 0 || isWideDesktop ? styles.rowBorder : null]}>
                <Pressable
                  onPress={() => (canEdit ? onEdit(plan.id) : undefined)}
                  disabled={!canEdit}
                  accessibilityRole="button"
                  accessibilityLabel={`${plan.name}, ${price}, ${members} members, ${st.label}${canEdit ? ". Edit" : ""}`}
                  style={({ pressed }) => [styles.rowMain, pressed ? styles.pressed : null]}
                  testID={`venue-plan-row-${plan.id}`}
                >
                  <View style={[styles.colName, styles.cellText]}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{plan.name}</Text>
                    <Text style={styles.meta}>
                      {isWideDesktop ? planTermsLine(plan) : `${price} · ${members} ${plan.activeMembers === 1 && plan.maxMembers === null ? "member" : "members"}`}
                    </Text>
                    {!isWideDesktop && lines.length > 0 ? <Text style={styles.meta}>{lines.join(" · ")}</Text> : null}
                  </View>
                  {isWideDesktop ? (
                    <>
                      <Text style={[styles.cell, styles.colPrice]}>{price}</Text>
                      <Text style={[styles.cell, styles.colInc]}>{lines.length > 0 ? lines.join(" · ") : "—"}</Text>
                      <Text style={[styles.cell, styles.colMembers]}>{members}</Text>
                      <View style={styles.colStatus}>
                        <Pill variant={st.variant}>{st.label}</Pill>
                      </View>
                    </>
                  ) : (
                    <Pill variant={st.variant}>{st.label}</Pill>
                  )}
                </Pressable>
                {canEdit ? (
                  <View style={styles.colMenu}>
                    <IconChrome icon="moreH" size={36} accessibilityLabel={`More for ${plan.name}`} onPress={() => setMenu(plan)} testID={`venue-plan-more-${plan.id}`} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </GlassCard>
      )}

      {state.hourOffers.length > 0 ? (
        <GlassCard variant="base" padding={space[4]} contentStyle={styles.roomsCard} testID="venue-plans-rooms">
          <Icon name="clock" size={20} color={color.text2} />
          <View style={styles.cellText}>
            <Text style={styles.rowTitle}>{hourPlacesTitle(venueCategory)}</Text>
            <Text style={styles.meta}>{`By the hour · ${state.hourOffers.map((o) => o.name).join(", ")} · members use their hours first`}</Text>
          </View>
          {onOpenOffers !== undefined ? <Button label="Open Offers" variant="secondary" size="sm" onPress={onOpenOffers} testID="venue-plans-open-offers" /> : null}
        </GlassCard>
      ) : null}

      {menu !== null ? (
        <Menu
          visible
          onClose={() => setMenu(null)}
          anchor={null}
          title={menu.name}
          items={[
            { key: "edit", label: "Edit", icon: "edit", onPress: () => onEdit(menu.id), testID: "venue-plan-menu-edit" },
            ...(menu.status === "live"
              ? [{ key: "pause", label: "Stop new members", icon: "pause" as const, onPress: () => setConfirm({ action: "pause", plan: menu }), testID: "venue-plan-menu-pause" }]
              : menu.status === "paused" || menu.status === "draft"
                ? [{ key: "publish", label: menu.status === "draft" ? "Publish" : "Put back on sale", icon: "play" as const, onPress: () => run(menu, "publish", `${menu.name} is on sale`), testID: "venue-plan-menu-publish" }]
                : []),
            { key: "archive", label: "Archive", icon: "trash", danger: true, onPress: () => setConfirm({ action: "archive", plan: menu }), testID: "venue-plan-menu-archive" },
          ]}
          testID="venue-plan-menu"
        />
      ) : null}
      {confirm !== null ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            title={confirm.action === "pause" ? `Stop new members on ${confirm.plan.name}?` : `Archive ${confirm.plan.name}?`}
            description={
              confirm.action === "pause"
                ? `Nobody new can join. The ${confirm.plan.activeMembers === 1 ? "1 member keeps" : `${confirm.plan.activeMembers} members keep`} their membership and their payment emails. You can put it back on sale any time.`
                : confirm.plan.members > 0
                  ? "A plan with members can't be archived. Stop new members instead, and archive it once everyone has left."
                  : "It leaves your plans and the venue page. This can't be undone."
            }
            confirmLabel={
              confirm.action === "pause" || (confirm.plan.members > 0 && confirm.plan.status === "live")
                ? "Stop new members"
                : confirm.plan.members > 0
                  ? "OK"
                  : "Archive plan"
            }
            cancelLabel="Keep it"
            destructive={confirm.action === "archive" && confirm.plan.members === 0}
            confirmLoading={manage.isPending}
            errorMessage={confirmError}
            onClose={() => {
              setConfirm(null);
              setConfirmError(null);
            }}
            onConfirm={() => {
              if (confirm.action === "archive" && confirm.plan.members > 0) {
                if (confirm.plan.status === "live") run(confirm.plan, "pause", `${confirm.plan.name} is not taking new members`);
                else setConfirm(null);
                return;
              }
              run(confirm.plan, confirm.action, confirm.action === "pause" ? `${confirm.plan.name} is not taking new members` : `${confirm.plan.name} archived`);
            }}
            testID="venue-plan-confirm"
          />
        </React.Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  headLeft: { flexDirection: "row", alignItems: "center", gap: space[2] },
  title: { ...type.h1, color: color.text1 },
  meta: { ...type.caption, color: color.text3 },
  error: { ...type.small, color: color.errorText },
  empty: { gap: space[3], alignItems: "flex-start" },
  emptyTitle: { ...type.h2, color: color.text1 },
  list: { overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space[2], paddingRight: space[2] },
  headRow: { backgroundColor: color.fill.tableHead, minHeight: 40, paddingVertical: space[2], paddingHorizontal: space[4] },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.line },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: 64 },
  pressed: { backgroundColor: color.fill.pressed },
  headCell: { ...type.label, color: color.text3 },
  colName: { flex: 3, minWidth: 0 },
  colPrice: { flex: 2, minWidth: 0 },
  colInc: { flex: 4, minWidth: 0 },
  colMembers: { flex: 1, minWidth: 0 },
  colStatus: { width: 120, flexShrink: 0 },
  colMenu: { width: 44, alignItems: "center", flexShrink: 0 },
  cellText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.row, color: color.text1 },
  cell: { ...type.small, color: color.text2 },
  roomsCard: { flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap", borderRadius: radius.lg },
});
