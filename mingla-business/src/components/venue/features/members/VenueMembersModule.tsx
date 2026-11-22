/**
 * #4490 P6-2 — Members (`mb`): four tiles (members of what the plans allow,
 * in today, payment due with the amount, renewing this week), status chips
 * (all, active, payment due, in grace, lapsed, paused, leaving, joining,
 * ended) and the members list (a table on wide web, rows on a phone). A row
 * opens the member (`MemberPanel`). "Plans" opens the plans list
 * (`PlansView`) and its editor (`PlanEditor`). Shown only when Memberships is
 * on (`deriveVenueNav`).
 *
 * Loading, error, empty (no plans yet / no members yet) and filtered-empty
 * states are each drawn. The plan editor is guarded by the shell's leave
 * contract while it has unsaved changes.
 */
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useCurrentBrandRole } from "../../../../hooks/useCurrentBrandRole";
import { useMyVenueAccess } from "../../../../hooks/useMyVenueAccess";
import { useVenueDay } from "../../../../hooks/useVenueDay";
import { useVenueListing } from "../../../../hooks/useVenueListings";
import { useVenueMembers } from "../../../../hooks/useVenueMembers";
import { useVenueMembershipPlans } from "../../../../hooks/useVenueMembershipPlans";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { VenueModule } from "../../../../types/venueReservation";
import { BRAND_ROLE_RANK } from "../../../../utils/brandRole";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { GlassCard } from "../../../ui/GlassCard";
import { Icon } from "../../../ui/Icon";
import { KpiTile } from "../../../ui/KpiTile";
import { Chip, Pill } from "../../../ui/Pill";
import { Skeleton } from "../../../ui/Skeleton";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import { venueScrollBottomPad } from "../../venueShellScroll";
import { money } from "../offers/offersModel";
import { MemberPanel } from "./MemberPanel";
import { PlanEditor } from "./PlanEditor";
import { PlansView } from "./PlansView";
import {
  MEMBER_FILTERS,
  memberErrorCopy,
  memberMatches,
  memberRowLine,
  memberStatusWords,
  roomHoursLine,
  type MemberFilter,
} from "./membersModel";

const LazyToast = React.lazy(async () => {
  const mod = await import("../../../ui/Toast");
  return { default: mod.Toast };
});

export type MembersView = "members" | "plans" | "new_plan";

export interface VenueMembersModuleProps {
  brandId: string | null;
  venueId: string | null;
  /** Open on Plans, or straight into a new plan (from Offers › New offer › Membership). */
  initialView?: MembersView;
  /** `&item=<subscriptionId>` opens that member on arrival. */
  initialMemberId?: string | null;
  onOpenModule?: (module: VenueModule) => void;
}

type Sub = { kind: "members" } | { kind: "plans" } | { kind: "plan"; planId: string | null };

export const VenueMembersModule = forwardRef<VenueModuleLeaveHandle, VenueMembersModuleProps>(function VenueMembersModule(
  { brandId, venueId, initialView = "members", initialMemberId = null, onOpenModule },
  ref,
): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const bottomPad = venueScrollBottomPad(insets.bottom);
  const currency = useBrandCurrency(brandId);
  const { rank } = useCurrentBrandRole(brandId);
  const access = useMyVenueAccess(venueId);
  const venueQuery = useVenueListing(venueId);
  const plansQuery = useVenueMembershipPlans(brandId, venueId);
  const [filter, setFilter] = useState<MemberFilter>("all");
  const listQuery = useVenueMembers(brandId, venueId, filter === "ended" ? "ended" : "all");
  const [sub, setSub] = useState<Sub>(
    initialView === "new_plan" ? { kind: "plan", planId: null } : initialView === "plans" ? { kind: "plans" } : { kind: "members" },
  );
  const [openMember, setOpenMember] = useState<string | null>(initialMemberId);
  const [toast, setToast] = useState<string | null>(null);
  const editorRef = useRef<VenueModuleLeaveHandle | null>(null);

  useImperativeHandle(
    ref,
    (): VenueModuleLeaveHandle => ({
      isDirty: () => editorRef.current?.isDirty() ?? false,
      changedLabels: () => editorRef.current?.changedLabels() ?? [],
      isValid: () => editorRef.current?.isValid() ?? true,
      save: async () => {
        await editorRef.current?.save();
      },
      discard: () => editorRef.current?.discard(),
    }),
    [],
  );

  // Plans: rank >= event_manager or venue.manage_members (the server checks again).
  const canEditPlans =
    plansQuery.data?.canManage === true ||
    rank >= BRAND_ROLE_RANK.event_manager ||
    (access.data?.scoped === true && access.data.capabilities.includes("venue.manage_members"));
  const venueName = venueQuery.data?.name ?? "your venue";
  const dayQuery = useVenueDay(brandId, venueId);
  const timezone = dayQuery.data?.timezone ?? "Africa/Lagos";

  const rows = useMemo(
    () => (listQuery.data?.members ?? []).filter((r) => memberMatches(r, filter)),
    [filter, listQuery.data?.members],
  );

  const toastNode =
    toast !== null ? (
      <React.Suspense fallback={null}>
        <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="venue-members-toast" />
      </React.Suspense>
    ) : null;

  if (sub.kind === "plan") {
    return (
      <View style={styles.editorHost} testID="venue-members-plan-editor">
        <PlanEditor
          ref={editorRef}
          brandId={brandId}
          venueId={venueId}
          venueName={venueName}
          planId={sub.planId}
          onOpenOffers={onOpenModule !== undefined ? () => onOpenModule("offers") : undefined}
          onClose={(result) => {
            setSub({ kind: "plans" });
            if (result?.published === true) setToast(`${result.name} is on sale`);
          }}
        />
        {toastNode}
      </View>
    );
  }
  if (sub.kind === "plans") {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: bottomPad }}>
        <PlansView
          brandId={brandId}
          venueId={venueId}
          canEdit={canEditPlans}
          onBack={() => setSub({ kind: "members" })}
          onEdit={(planId) => setSub({ kind: "plan", planId })}
          onOpenOffers={onOpenModule !== undefined ? () => onOpenModule("offers") : undefined}
          onToast={setToast}
        />
        {toastNode}
      </ScrollView>
    );
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">Members</Text>
      <Button label="Plans" variant="secondary" size="sm" leadingIcon="award" onPress={() => setSub({ kind: "plans" })} testID="venue-members-plans" />
    </View>
  );

  if (listQuery.isLoading) {
    return (
      <View style={styles.host} testID="venue-members-loading" accessibilityLabel="Loading members">
        {header}
        <View style={styles.tiles}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={84} radius="md" style={styles.tileSkeleton} />
          ))}
        </View>
        <Skeleton height={56} radius="md" />
        <Skeleton height={56} radius="md" />
      </View>
    );
  }
  if (listQuery.isError || listQuery.data === undefined) {
    const err = listQuery.error === null ? null : toVenueOfferError(listQuery.error);
    return (
      <View style={styles.host}>
        {header}
        <CenteredState
          title="Couldn't load your members"
          body={err !== null && err.code !== "unknown" ? memberErrorCopy(err.code) : "Check your connection and try again."}
          tone="error"
          testID="venue-members-error"
        >
          <Button label="Try again" variant="secondary" size="md" onPress={() => void listQuery.refetch()} />
        </CenteredState>
      </View>
    );
  }

  const list = listQuery.data;
  const t = list.tiles;
  const livePlans = (plansQuery.data?.plans ?? []).filter((p) => p.status === "live");
  const noPlans = plansQuery.data !== undefined && plansQuery.data.plans.filter((p) => p.status !== "archived").length === 0;
  const perMonthFor = (planId: string): number | null => plansQuery.data?.plans.find((p) => p.id === planId)?.roomHours ?? null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.host, { paddingBottom: bottomPad }]} testID="venue-members-module">
      {header}
      <View style={styles.tiles}>
        <KpiTile
          label="Members"
          value={t.members}
          sub={t.membersAllowed !== null ? `of ${t.membersAllowed.toLocaleString("en-GB")} the plans allow` : livePlans.length > 0 ? `on ${livePlans.length} ${livePlans.length === 1 ? "plan" : "plans"}` : "No plan on sale"}
          style={styles.tile}
          testID="venue-members-tile-members"
        />
        <KpiTile label="In today" value={t.inToday} sub="Checked in at the door" style={styles.tile} testID="venue-members-tile-in" />
        <KpiTile
          label="Payment due"
          value={t.paymentDue.count}
          sub={t.paymentDue.count > 0 ? money(t.paymentDue.amountMinor, currency) : "Everyone is paid up"}
          style={styles.tile}
          testID="venue-members-tile-due"
        />
        <KpiTile label="Renewing this week" value={t.renewingThisWeek} sub={`Emails go out ${plansQuery.data?.plans[0]?.renewalNoticeDays ?? 7} days before`} style={styles.tile} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} testID="venue-members-filters">
        {MEMBER_FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            selected={filter === f.key}
            onPress={() => setFilter(f.key)}
            count={f.key === "ended" || filter === "ended" ? undefined : list.members.filter((r) => memberMatches(r, f.key)).length}
            testID={`venue-members-filter-${f.key}`}
          />
        ))}
      </ScrollView>

      {rows.length === 0 ? (
        <GlassCard variant="base" padding={space[5]} contentStyle={styles.empty} testID="venue-members-empty">
          <Icon name="users" size={28} color={color.text3} />
          {noPlans ? (
            <>
              <Text style={styles.emptyTitle}>No plans yet</Text>
              <Text style={styles.meta}>Make a monthly or yearly plan, put it on sale, and members join from your venue page.</Text>
              {canEditPlans ? <Button label="New plan" variant="primary" size="md" onPress={() => setSub({ kind: "plan", planId: null })} testID="venue-members-empty-new-plan" /> : null}
            </>
          ) : filter === "all" ? (
            <>
              <Text style={styles.emptyTitle}>No members yet</Text>
              <Text style={styles.meta}>
                {livePlans.length > 0
                  ? "People join from the Plans tab on your venue page and pay their first billing period there."
                  : "Put a plan on sale so people can join from your venue page."}
              </Text>
              {livePlans.length === 0 && canEditPlans ? (
                <Button label="Open plans" variant="secondary" size="md" onPress={() => setSub({ kind: "plans" })} />
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.emptyTitle}>Nobody here</Text>
              <Text style={styles.meta}>No member is {MEMBER_FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? "in this list"} right now.</Text>
              <Button label="Show everyone" variant="secondary" size="md" onPress={() => setFilter("all")} testID="venue-members-show-all" />
            </>
          )}
        </GlassCard>
      ) : (
        <GlassCard variant="base" padding={0} contentStyle={styles.list} testID="venue-members-list">
          {isWideDesktop ? (
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.headCell, styles.colName]}>Member</Text>
              <Text style={[styles.headCell, styles.colPlan]}>Plan</Text>
              <Text style={[styles.headCell, styles.colWhen]}>Renews</Text>
              <Text style={[styles.headCell, styles.colRooms]}>This period</Text>
              <Text style={[styles.headCell, styles.colStatus]}>Status</Text>
            </View>
          ) : null}
          {rows.map((r, index) => {
            const st = memberStatusWords(r.status, r.leavingOn);
            const perMonth = perMonthFor(r.planId);
            const credits = [
              perMonth !== null && perMonth > 0 ? roomHoursLine(r.roomHoursLeft, perMonth) : null,
              r.guestPassesLeft > 0 ? `${r.guestPassesLeft} guest ${r.guestPassesLeft === 1 ? "pass" : "passes"}` : null,
            ].filter((x): x is string => x !== null);
            const line = memberRowLine(r, timezone);
            return (
              <Pressable
                key={r.subscriptionId}
                onPress={() => setOpenMember(r.subscriptionId)}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}, ${r.planName}, ${st.label}, ${line}. Open member`}
                style={({ pressed }) => [styles.row, styles.rowPad, index > 0 || isWideDesktop ? styles.rowBorder : null, pressed ? styles.pressed : null]}
                testID={`venue-member-row-${r.subscriptionId}`}
              >
                <View style={[styles.colName, styles.nameCell]}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{r.name.split(/\s+/).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={styles.cellText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{r.name}</Text>
                    {!isWideDesktop ? (
                      <Text style={styles.meta} numberOfLines={2}>{`${r.planName} · ${line}`}</Text>
                    ) : r.inToday ? (
                      <Text style={styles.meta}>In today</Text>
                    ) : null}
                  </View>
                </View>
                {isWideDesktop ? (
                  <>
                    <Text style={[styles.cell, styles.colPlan]} numberOfLines={1}>{r.planName}</Text>
                    <Text style={[styles.cell, styles.colWhen]} numberOfLines={2}>{line}</Text>
                    <Text style={[styles.cell, styles.colRooms]} numberOfLines={2}>{credits.length > 0 ? credits.join(" · ") : "—"}</Text>
                    <View style={styles.colStatus}>
                      <Pill variant={st.variant}>{st.label}</Pill>
                    </View>
                  </>
                ) : (
                  <Pill variant={st.variant}>{st.label}</Pill>
                )}
              </Pressable>
            );
          })}
        </GlassCard>
      )}

      <MemberPanel brandId={brandId} venueId={venueId} subscriptionId={openMember} onClose={() => setOpenMember(null)} onToast={setToast} />
      {toastNode}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  editorHost: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  title: { ...type.h1, color: color.text1 },
  meta: { ...type.caption, color: color.text3 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  tile: { flexGrow: 1, flexBasis: 160, minWidth: 150 },
  tileSkeleton: { flexGrow: 1, flexBasis: 160 },
  chips: { flexDirection: "row", gap: space[2], paddingVertical: space[1] },
  empty: { gap: space[3], alignItems: "flex-start" },
  emptyTitle: { ...type.h2, color: color.text1 },
  list: { overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3] },
  rowPad: { paddingHorizontal: space[4], paddingVertical: space[3], minHeight: 64 },
  headRow: { backgroundColor: color.fill.tableHead, minHeight: 40, paddingVertical: space[2], paddingHorizontal: space[4] },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.line },
  pressed: { backgroundColor: color.fill.pressed },
  headCell: { ...type.label, color: color.text3 },
  colName: { flex: 3, minWidth: 0 },
  colPlan: { flex: 2, minWidth: 0 },
  colWhen: { flex: 2, minWidth: 0 },
  colRooms: { flex: 2, minWidth: 0 },
  colStatus: { width: 120, flexShrink: 0 },
  nameCell: { flexDirection: "row", alignItems: "center", gap: space[3] },
  avatar: { width: 36, height: 36, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  avatarText: { ...type.label, color: color.text2 },
  cellText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.row, color: color.text1 },
  cell: { ...type.small, color: color.text2 },
});
