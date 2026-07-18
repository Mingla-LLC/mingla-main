/**
 * /partner/brands — Mingla partner brand portfolio list. ORCH-1081.
 *
 * Visible only to flagged Mingla partners (creator_accounts.partner_enabled
 * = true). Reads partner_brand_links via the usePartnerBrandLinks hook
 * (RLS gates: partner_account_id = auth.uid()) and surfaces (labels are
 * provider-neutral — ORCH-1331 added the Paystack payout rail; the internal
 * "awaiting_stripe" status value is frozen):
 *   - rows in priority order (awaiting_owner → awaiting_stripe → active →
 *     cancelled last, greyed — ORCH-1384 / OQ-3)
 *   - status chip + subtext per row (reason-aware for cancelled; honest
 *     "Invite expired" derivation for 7-day-dead awaiting_owner rows)
 *   - tap-through → PartnerLinkDetailSheet (ORCH-1384: the dashboard nav
 *     moved INTO the sheet as a verb; cancelled rows open it read-only)
 *   - persistent header [+] add-CTA → /brand/new?partner_mode=client
 *     (ORCH-1384 F-1 fix — rendered in ALL list states)
 *   - empty state CTA → /brand/new?partner_mode=client (BrandCreationFlow
 *     reads partner_mode and lands on step 1 with mode='client').
 *
 * Mirrors earnings.tsx structure (modal-style with X close header, scroll
 * content, dark canvas, GlassCard rows).
 */

import React, { Suspense, lazy, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";

import { usePartnerBrandLinks } from "../../src/hooks/usePartnerBrandLinks";
import {
  isInviteExpired,
  INVITE_EXPIRY_DAYS,
  type PartnerBrandLinkStatus,
  type PartnerBrandLinkWithStatus,
} from "../../src/services/partnerBrandLinksService";
import { useAuth } from "../../src/context/AuthContext";
import {
  accent,
  canvas,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";

// ORCH-1384 web eager-bundle budget fix: PartnerLinkDetailSheet is native-first
// and heavy (reanimated sheet, the verb mutations, Input). It opens only on a
// row tap, so it is lazily loaded off the boot path — keeping it and its whole
// dependency graph OUT of the eager web `__common` chunk guarded by
// scripts/ci/orch-1083-initial-bundle-budget.mjs (the guard IS this fix's
// regression test — reverting to a static import re-bloats __common and turns
// it red). On native the single bundle resolves it with no visual delay.
const PartnerLinkDetailSheet = lazy(() =>
  import("../../src/components/partner/PartnerLinkDetailSheet").then((m) => ({
    default: m.PartnerLinkDetailSheet,
  })),
);

const STATUS_RANK: Record<PartnerBrandLinkStatus, number> = {
  awaiting_owner: 0,
  awaiting_stripe: 1,
  active: 2,
  cancelled: 3,
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for T-6 / T-10 companion tests)
// ---------------------------------------------------------------------------

/**
 * ORCH-1384 sort contract (SPEC §4.6-3): STATUS_RANK order unchanged
 * (cancelled = 3 → last); within active, first_split_at desc; within
 * cancelled, cancelled_at desc; otherwise newest invite first.
 */
export function compareLinkRows(
  a: PartnerBrandLinkWithStatus,
  b: PartnerBrandLinkWithStatus,
): number {
  const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rankDiff !== 0) return rankDiff;
  // Within active: sort by first_split_at desc (most recent earnings first).
  if (a.status === "active" && b.status === "active") {
    const aTime = a.first_split_at ? new Date(a.first_split_at).getTime() : 0;
    const bTime = b.first_split_at ? new Date(b.first_split_at).getTime() : 0;
    return bTime - aTime;
  }
  // Within cancelled: most recently terminated first (SPEC §4.6-3).
  if (a.status === "cancelled" && b.status === "cancelled") {
    const aTime = a.cancelled_at ? new Date(a.cancelled_at).getTime() : 0;
    const bTime = b.cancelled_at ? new Date(b.cancelled_at).getTime() : 0;
    return bTime - aTime;
  }
  // Within any other state: newest invite first.
  const aTime = new Date(a.invited_at).getTime();
  const bTime = new Date(b.invited_at).getTime();
  return bTime - aTime;
}

/**
 * Header/account count semantics (SC-13 / T-6): counts are STATUS-filtered —
 * cancelled rows can NEVER alter them, regardless of includeCancelled reads.
 */
export function headerCounts(rows: PartnerBrandLinkWithStatus[]): {
  activeCount: number;
  pendingCount: number;
} {
  return {
    activeCount: rows.filter((r) => r.status === "active").length,
    pendingCount: rows.filter(
      (r) => r.status === "awaiting_owner" || r.status === "awaiting_stripe",
    ).length,
  };
}

// ORCH-1384 web eager-bundle budget fix — INLINE label copies.
//
// These mirror partnerLinkLabels.reasonLabelFor / terminalEventNameFor VERBATIM
// (the canonical, unit-tested source used by the lazy PartnerLinkDetailSheet).
// They are deliberately duplicated here rather than imported so that
// partnerLinkLabels is pulled ONLY by the lazy sheet — keeping it (and the
// sheet's whole native-first graph) out of the shared web boot `__common`
// chunk guarded by scripts/ci/orch-1083-initial-bundle-budget.mjs. This is a
// pure-formatting duplication (spec-frozen copy, no state — NOT a Const #2
// data-ownership split); partnerLinkLabels.driftguard.orch1384.source.test.ts
// asserts these copies never drift from the canonical module.

/** §9.1 — cancelled_reason → row status label. NULL (legacy) → "Cancelled". */
function reasonLabelFor(reason: string | null): string {
  switch (reason) {
    case "owner_declined":
      return "Declined by owner";
    case "invitation_revoked":
      return "Invite revoked";
    case "partner_disconnected":
      return "Disconnected";
    case "owner_removed":
      return "Disconnected by owner";
    case "partner_cancelled":
    default:
      return "Cancelled";
  }
}

/** §2.2 Group C — terminal timeline event name per reason. */
function terminalEventNameFor(reason: string | null): string {
  switch (reason) {
    case "owner_declined":
      return "Declined";
    case "invitation_revoked":
      return "Revoked";
    case "partner_disconnected":
    case "owner_removed":
      return "Disconnected";
    case "partner_cancelled":
    default:
      return "Cancelled";
  }
}

/** §4.2 status→label matrix (reason-aware for cancelled; honest expired). */
export function rowStatusLabel(
  row: PartnerBrandLinkWithStatus,
  expired: boolean,
): string {
  switch (row.status) {
    case "awaiting_owner":
      return expired ? "Invite expired" : "Awaiting Owner";
    case "awaiting_stripe":
      // ORCH-1331 — provider-neutral label (Stripe OR Paystack rail); the
      // internal status VALUE stays awaiting_stripe (client contract,
      // I-PROPOSED-1331-LINK-COLUMNS-FROZEN).
      return "Awaiting payouts";
    case "active":
      return "Active";
    case "cancelled":
      return reasonLabelFor(row.cancelled_reason);
    default:
      return row.status;
  }
}

/** Row subtext (reason verb + relative time for cancelled; §9.1). */
export function rowSubText(
  row: PartnerBrandLinkWithStatus,
  expired: boolean,
): string {
  switch (row.status) {
    case "awaiting_owner":
      return expired
        ? `Expired ${timeAgo(
            new Date(
              new Date(row.invited_at).getTime() +
                INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
            ).toISOString(),
          )}`
        : `Invite sent ${timeAgo(row.invited_at)}`;
    case "awaiting_stripe":
      return row.accepted_at !== null
        ? `Owner accepted ${timeAgo(row.accepted_at)}`
        : "Owner accepted";
    case "active":
      return row.first_split_at !== null
        ? `First split ${timeAgo(row.first_split_at)}`
        : "Payouts connected";
    case "cancelled":
      return row.cancelled_at !== null
        ? `${terminalEventNameFor(row.cancelled_reason)} ${timeAgo(
            row.cancelled_at,
          )}`
        : "Cancelled";
    default:
      return "";
  }
}

export default function PartnerBrandsScreen(): React.ReactElement {
  const router = useRouter();
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  // ORCH-1384 / OQ-3 — cancelled rows are SHOWN (greyed, last). Counts stay
  // status-filtered so they never include cancelled (SC-13).
  const linksQuery = usePartnerBrandLinks({ includeCancelled: true });

  // Row SNAPSHOT at tap time — the sheet's status/snap is fixed at open.
  const [detailLink, setDetailLink] =
    useState<PartnerBrandLinkWithStatus | null>(null);
  const [detailVisible, setDetailVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  const handleOpenDetail = useCallback(
    (row: PartnerBrandLinkWithStatus): void => {
      setDetailLink(row);
      setDetailVisible(true);
    },
    [],
  );

  const handleSetUpFirst = useCallback((): void => {
    router.push("/brand/new?partner_mode=client" as never);
  }, [router]);

  const handleVerbSuccess = useCallback((message: string): void => {
    setToast(message);
  }, []);

  const sortedRows = useMemo<PartnerBrandLinkWithStatus[]>(() => {
    const rows = linksQuery.data ?? [];
    return [...rows].sort(compareLinkRows);
  }, [linksQuery.data]);

  const { activeCount, pendingCount } = headerCounts(sortedRows);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close partner brands"
          testID="partner-brands-close-button"
        />
        <View style={styles.headerMid}>
          <Text style={styles.headerTitle}>Brands</Text>
          {(activeCount > 0 || pendingCount > 0) ? (
            <Text style={styles.headerSub}>
              {activeCount} active · {pendingCount} pending
            </Text>
          ) : null}
        </View>
        {/* ORCH-1384 fails-on-revert proof 1 (SPEC §9): reverting this slot to
            the empty 36px spacer turns T-10 red. The add-CTA renders in ALL
            list states — the wizard route is always valid (SC-1 / F-1 fix). */}
        <IconChrome
          icon="plus"
          size={36}
          onPress={handleSetUpFirst}
          accessibilityLabel="Set up another partner brand"
          testID="partner-brands-add-button"
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {linksQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={accent.warm} />
          </View>
        ) : linksQuery.error ? (
          <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
            <Text style={styles.cardTitle}>Couldn't load your brands</Text>
            <Text style={styles.cardBody}>{linksQuery.error.message}</Text>
            <View style={{ marginTop: spacing.md }}>
              <Button
                variant="secondary"
                size="md"
                label="Retry"
                onPress={() => {
                  void linksQuery.refetch();
                }}
              />
            </View>
          </GlassCard>
        ) : sortedRows.length === 0 ? (
          <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
            <Text style={styles.cardTitle}>No partner brands yet</Text>
            <Text style={styles.cardBody}>
              Brands you set up for clients show up here. You'll see them go
              from invite-sent to live to earning.
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <Button
                variant="primary"
                size="md"
                fullWidth
                label="Set up your first partner brand"
                trailingIcon="chevR"
                onPress={handleSetUpFirst}
                accessibilityLabel="Set up your first partner brand"
              />
            </View>
          </GlassCard>
        ) : (
          sortedRows.map((row) => (
            <BrandLinkRow
              key={row.id}
              row={row}
              onPress={() => handleOpenDetail(row)}
            />
          ))
        )}
      </ScrollView>

      {/* Lazy sheet: the fallback is null because the sheet itself renders
          nothing until a row snapshot is set (link === null → null), so the
          async chunk resolving in the background is invisible; the open
          animation still rides the visible=false→true transition as before. */}
      <Suspense fallback={null}>
        <PartnerLinkDetailSheet
          visible={detailVisible}
          link={detailLink}
          accountId={accountId}
          onClose={() => setDetailVisible(false)}
          onVerbSuccess={handleVerbSuccess}
        />
      </Suspense>

      <Toast
        visible={toast !== null}
        kind="success"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />
    </SafeAreaView>
  );
}

function BrandLinkRow(props: {
  row: PartnerBrandLinkWithStatus;
  onPress: () => void;
}): React.ReactElement {
  const { row, onPress } = props;
  const brand = row.brand ?? null;
  const brandName = brand?.name ?? "Brand";
  const coverUrl = brand?.cover_media_url ?? null;
  const coverType = brand?.cover_media_type ?? null;
  // Stills only for the round thumbnail; skip videos.
  const hasStillCover = coverUrl !== null &&
    coverUrl.length > 0 &&
    coverType !== "video";
  const cancelled = row.status === "cancelled";
  const expired = isInviteExpired(row);
  const statusLabel = rowStatusLabel(row, expired);

  return (
    <Pressable
      accessibilityRole="button"
      // Honest affordance: status rides the announcement ("{brand},
      // {statusLabel}") — replaces the old "Open {brand}" (DESIGN §7.2).
      accessibilityLabel={`${brandName}, ${statusLabel}`}
      onPress={onPress}
      testID={`partner-brand-row-${row.id}`}
      // ORCH-1384 — pressed feedback for ALL rows (fixes the pre-existing
      // dead-feel tap; DESIGN §5.1 / decision-of-record 10).
      style={({ pressed }) => (pressed ? styles.rowPressed : null)}
    >
      {/* Cancelled recession: card variant drops elevated→base — the row
          physically recedes (lower tint, lower blur, softer shadow). */}
      <GlassCard
        variant={cancelled ? "base" : "elevated"}
        radius="md"
        padding={spacing.md}
      >
        <View style={styles.rowOuter}>
          <View style={styles.thumbWrap}>
            {hasStillCover ? (
              <Image
                source={{ uri: coverUrl as string }}
                style={[styles.thumb, cancelled && styles.thumbCancelled]}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View
                style={[
                  styles.thumb,
                  cancelled
                    ? styles.thumbFallbackCancelled
                    : styles.thumbFallback,
                ]}
              >
                <Text
                  style={
                    cancelled
                      ? styles.thumbFallbackTextCancelled
                      : styles.thumbFallbackText
                  }
                >
                  {brandName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.rowBody}>
            <Text
              style={cancelled ? styles.brandNameCancelled : styles.brandName}
              numberOfLines={1}
            >
              {brandName}
            </Text>
            <View style={styles.statusRow}>
              <StatusDot status={row.status} expired={expired} />
              <Text
                style={
                  cancelled ? styles.statusLabelCancelled : styles.statusLabel
                }
              >
                {statusLabel}
              </Text>
            </View>
            <Text style={styles.subText} numberOfLines={1}>
              {rowSubText(row, expired)}
            </Text>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

function StatusDot({
  status,
  expired,
}: {
  status: PartnerBrandLinkStatus;
  expired: boolean;
}): React.ReactElement {
  // §4.2 dot matrix — expired = semantic.error (the token is dead; the label
  // carries the words, color is never the sole signal).
  const color = status === "active"
    ? semantic.success
    : status === "awaiting_stripe"
    ? semantic.warning
    : status === "awaiting_owner"
    ? (expired ? semantic.error : accent.warm)
    : textTokens.tertiary;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: canvas.discover },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  headerMid: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  headerSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  cardTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  cardBody: {
    ...typography.body,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowOuter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  thumbWrap: {
    width: 60,
    height: 60,
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: "hidden",
  },
  thumbCancelled: {
    // RN has no grayscale filter without a new dependency (banned); 0.55
    // over the dark card reads as muted (DESIGN §2.3).
    opacity: 0.55,
  },
  thumbFallback: {
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbFallbackCancelled: {
    backgroundColor: glass.tint.profileElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbFallbackText: {
    fontSize: 22,
    fontWeight: "800",
    color: accent.warm,
  },
  thumbFallbackTextCancelled: {
    fontSize: 22,
    fontWeight: "800",
    // Decorative — the name beside it carries identity (DESIGN §2.3).
    color: textTokens.tertiary,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  brandName: {
    ...typography.bodyLg,
    fontWeight: "700",
    color: textTokens.primary,
  },
  brandNameCancelled: {
    ...typography.bodyLg,
    fontWeight: "600",
    // text.secondary (9.6:1) — recessed but fully AA. NEVER text.quaternary
    // (2.91:1 measured fail — BANNED for meaningful text, DESIGN §4.3).
    color: textTokens.secondary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    ...typography.micro,
    fontWeight: "700",
    color: textTokens.secondary,
    letterSpacing: 0.5,
  },
  statusLabelCancelled: {
    ...typography.micro,
    fontWeight: "700",
    // text.tertiary — 5.58:1 on the base card, AA (DESIGN §2.3/§4.3).
    color: textTokens.tertiary,
    letterSpacing: 0.5,
  },
  subText: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
});
