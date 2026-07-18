/**
 * /brand/[id]/team — brand-team list (ORCH-1050).
 *
 * Reads pending invitations + accepted members from React Query
 * (`useBrandInvitations` / `useBrandTeamMembers`), synthesizes the
 * operator's self-row from `useCurrentBrandRole` for solo operators, and
 * gates the "+" invite CTA on MIN_RANK.INVITE_TEAM_MEMBER.
 *
 * Revoke action calls `useRevokeBrandInvitation` → direct UPDATE under
 * brand_admin+ RLS; React Query invalidates the list on success.
 *
 * Hook ordering follows ORCH-0710: ALL hooks run on every render before
 * any early-return shell.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InviteBrandMemberSheet } from "../../../src/components/team/InviteBrandMemberSheet";
import { MemberDetailSheet } from "../../../src/components/team/MemberDetailSheet";
import type { BrandTeamEntry } from "../../../src/store/brandTeamStore";
import { Avatar } from "../../../src/components/ui/Avatar";
import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Icon } from "../../../src/components/ui/Icon";
import { TopBar } from "../../../src/components/ui/TopBar";
import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import {
  useBrandInvitations,
  useBrandTeamMembers,
  useRevokeBrandInvitation,
} from "../../../src/hooks/useBrandInvitations";
import type {
  BrandInvitationRow,
  BrandTeamMemberRow,
} from "../../../src/services/brandInvitationsService";
import { useBrand } from "../../../src/hooks/useBrands";
// ORCH-1384 — owner-side partner-link read: the member row whose user_id
// matches an accepted, non-cancelled link's partner_account_id is the
// PARTNER row (badge + owner-initiated disconnect).
import { useBrandPartnerLinks } from "../../../src/hooks/useBrandPartnerLinks";
import { Toast } from "../../../src/components/ui/Toast";
import {
  BRAND_RESOLVE_AUTH_CEILING_MS,
  isBrandRouteResolving,
} from "../../../src/utils/coldLoadAuthGates";
import {
  type BrandRole,
  roleDisplayName,
} from "../../../src/utils/brandRole";
import {
  canPerformAction,
  gateCaptionFor,
} from "../../../src/utils/permissionGates";
import { formatRelativeTime } from "../../../src/utils/relativeTime";

interface DisplayEntry {
  id: string;
  name: string;
  email: string;
  role: BrandRole;
  status: "pending" | "self" | "accepted";
  /** ISO timestamp for sub-text rendering. */
  timestampIso: string;
  /** Optional reference to the underlying store entry — synthetic self-row has none. */
  storeEntry: BrandTeamEntry | null;
  /**
   * ORCH-1384 — the accepted, non-cancelled partner_brand_links id when this
   * member IS the Mingla partner (user_id ↔ partner_account_id). Null for
   * every other row.
   */
  partnerLinkId: string | null;
}

export default function BrandTeamRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandIdResolved =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const { user, isAuthReady } = useAuth();
  const userId = user?.id ?? null;
  const operatorAccountId = userId ?? "";

  // ORCH-1309 — resolve the brand by FETCHING it (useBrand), not by finding it in
  // the in-memory useBrandList() (EMPTY on a cold deep-link / refresh, which made
  // /brand/{id}/team flash "Brand not found" for every direct load). Guarded by
  // the cold-load resolving window (mirrors the /brand/[id] hub, ORCH-1100/1292):
  // a null brand while the session warms + the query settles renders a spinner,
  // not the not-found empty state.
  const brandQuery = useBrand(brandIdResolved);
  const brand = brandQuery.data ?? null;
  const mountedAtRef = useRef<number>(Date.now());
  const [, forceResolveTick] = useState(0);
  const isBrandResolving = isBrandRouteResolving({
    hasBrandId: brandIdResolved !== null,
    brandIsNull: brand === null,
    isAuthReady,
    queryIsFetched: brandQuery.isFetched,
    queryIsLoading: brandQuery.isLoading,
    elapsedMs: Date.now() - mountedAtRef.current,
  });
  useEffect(() => {
    if (!isBrandResolving) return;
    const remaining =
      BRAND_RESOLVE_AUTH_CEILING_MS - (Date.now() - mountedAtRef.current);
    if (remaining <= 0) return;
    const timer = setTimeout(
      () => forceResolveTick((n) => n + 1),
      remaining + 50,
    );
    return () => clearTimeout(timer);
  }, [isBrandResolving]);

  const { data: invitationRows = [] } = useBrandInvitations(brandIdResolved);
  const { data: memberRows = [] } = useBrandTeamMembers(brandIdResolved);
  const { mutateAsync: revokeAsync } = useRevokeBrandInvitation(brandIdResolved);
  // ORCH-1384 — accepted, non-cancelled links keyed by partner_account_id.
  const { data: partnerLinkRows = [] } = useBrandPartnerLinks(brandIdResolved);

  const { role: currentRole, rank: currentRank } = useCurrentBrandRole(
    brandIdResolved,
  );

  const [inviteVisible, setInviteVisible] = useState<boolean>(false);
  const [detailEntry, setDetailEntry] = useState<DisplayEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ORCH-1384 — partner_account_id → link id for accepted, non-cancelled
  // links (the badge/disconnect matcher; SPEC §4.6).
  const partnerLinkByUserId = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const link of partnerLinkRows) {
      if (link.accepted_at !== null && link.cancelled_at === null) {
        map.set(link.partner_account_id, link.id);
      }
    }
    return map;
  }, [partnerLinkRows]);

  const pendingEntries = useMemo<DisplayEntry[]>(() => {
    const nowMs = Date.now();
    return invitationRows
      .filter(
        (row) =>
          row.status === "pending" &&
          new Date(row.expires_at).getTime() > nowMs,
      )
      .sort(
        (a, b) =>
          new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime(),
      )
      .map<DisplayEntry>((row) => ({
        id: row.id,
        name: row.invitee_name ?? row.email,
        email: row.email,
        role: row.role,
        status: "pending",
        // Approximate "invited at" as expires - 7d to feed relative-time copy.
        timestampIso: new Date(
          new Date(row.expires_at).getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        storeEntry: invitationRowToEntry(row),
        partnerLinkId: null,
      }));
  }, [invitationRows]);

  const acceptedEntries = useMemo<DisplayEntry[]>(() => {
    const fromServer = memberRows
      .filter(
        (row) =>
          row.accepted_at !== null &&
          row.removed_at === null &&
          // Hide the self-row coming from the server; it is rendered via the
          // synthesized row below to match the existing "You" affordance.
          row.user_id !== userId,
      )
      .sort((a, b) => {
        const aT = a.accepted_at !== null
          ? new Date(a.accepted_at).getTime()
          : 0;
        const bT = b.accepted_at !== null
          ? new Date(b.accepted_at).getTime()
          : 0;
        return bT - aT;
      })
      .map<DisplayEntry>((row) => ({
        id: row.id,
        name: row.user_id,
        email: row.user_id,
        role: row.role,
        status: "accepted",
        timestampIso: row.accepted_at ?? row.invited_at,
        storeEntry: memberRowToEntry(row),
        // ORCH-1384 — the Mingla-partner member row (badge + owner disconnect).
        partnerLinkId: partnerLinkByUserId.get(row.user_id) ?? null,
      }));
    // Synthesize self-row at top — solo operator falls back here.
    const selfRow: DisplayEntry | null =
      currentRole !== null && userId !== null
        ? {
            id: `self_${userId}`,
            name: user?.email ?? "You",
            email: user?.email ?? "",
            role: currentRole,
            status: "self",
            timestampIso: new Date().toISOString(),
            storeEntry: null,
            partnerLinkId: null,
          }
        : null;
    return selfRow !== null ? [selfRow, ...fromServer] : fromServer;
  }, [memberRows, currentRole, user, userId, partnerLinkByUserId]);

  const canInvite = canPerformAction(currentRank, "INVITE_TEAM_MEMBER");

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  const handleOpenInvite = useCallback((): void => {
    if (!canInvite) return;
    setInviteVisible(true);
  }, [canInvite]);

  const handleInviteSuccess = useCallback(
    (_details: { invitationId: string }): void => {
      setInviteVisible(false);
      // List is refetched via React Query invalidation triggered by the
      // useInviteBrandMember mutation onSuccess.
    },
    [],
  );

  const handleRowTap = useCallback((entry: DisplayEntry): void => {
    if (entry.status === "self") return; // self-row is informational only
    setDetailEntry(entry);
  }, []);

  const handleRevoke = useCallback(
    (entry: BrandTeamEntry): void => {
      // Fire-and-forget; React Query refetches on success and the row
      // disappears. The dialog is already optimistically closed.
      revokeAsync(entry.id).catch(() => {
        // Toast wiring deferred — error surfaces in next list refetch.
      });
      setDetailEntry(null);
    },
    [revokeAsync],
  );

  const handleRemove = useCallback(
    (_entry: BrandTeamEntry): void => {
      // ORCH-1050 ships invite+accept+revoke; member removal lands in a
      // follow-up ORCH (ORCH-1051 partner identity / team admin removal).
      // For now this close the sheet without a destructive action.
      setDetailEntry(null);
    },
    [],
  );

  // ORCH-1309 — cold-load resolving state: a valid brandId whose brand is still
  // being fetched (session warming / query not settled) renders a spinner, not
  // the "Brand not found" empty state. Only a settled-null brand falls through.
  if (brandIdResolved !== null && brand === null && isBrandResolving) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <TopBar leftKind="back" title="Team" onBack={handleBack} rightSlot={null} />
        <View style={styles.resolvingHost}>
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  if (brandIdResolved === null || brand === null) {
    return (
      <View
        style={[styles.host, { paddingTop: insets.top }]}
      >
        <TopBar
          leftKind="back"
          title="Team"
          onBack={handleBack}
          rightSlot={null}
        />
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="users"
            title="Brand not found"
            description="This brand isn't in your list. Switch back and try again."
          />
        </View>
      </View>
    );
  }

  const showEmpty =
    pendingEntries.length === 0 && acceptedEntries.length <= 1;
  // <=1 because self-row is always present when role is known

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <TopBar
        leftKind="back"
        title="Team"
        onBack={handleBack}
        rightSlot={
          canInvite ? (
            <Pressable
              onPress={handleOpenInvite}
              accessibilityRole="button"
              accessibilityLabel="Invite team member"
              style={styles.headerInviteCta}
            >
              <Icon name="plus" size={22} color={textTokens.primary} />
            </Pressable>
          ) : null
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {showEmpty ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="users"
              title="You're working solo"
              description={
                canInvite
                  ? "Tap + to invite a team member."
                  : "Ask the brand admin to invite team members."
              }
              cta={
                canInvite
                  ? {
                      label: "Invite team member",
                      onPress: handleOpenInvite,
                      variant: "primary",
                    }
                  : undefined
              }
            />
          </View>
        ) : (
          <>
            {pendingEntries.length > 0 ? (
              <SectionList
                title="PENDING INVITATIONS"
                rows={pendingEntries}
                onRowTap={handleRowTap}
              />
            ) : null}
            <SectionList
              title="ACTIVE MEMBERS"
              rows={acceptedEntries}
              onRowTap={handleRowTap}
            />
          </>
        )}

        {!canInvite && !showEmpty ? (
          <Text style={styles.gateCaption}>
            {gateCaptionFor("INVITE_TEAM_MEMBER")}
          </Text>
        ) : null}
      </ScrollView>

      <InviteBrandMemberSheet
        visible={inviteVisible}
        brandId={brand.id}
        brandName={brand.displayName}
        operatorAccountId={operatorAccountId}
        onClose={() => setInviteVisible(false)}
        onSuccess={handleInviteSuccess}
      />

      <MemberDetailSheet
        visible={detailEntry !== null}
        entry={detailEntry?.storeEntry ?? null}
        currentRank={currentRank}
        onClose={() => setDetailEntry(null)}
        onRevoke={handleRevoke}
        onRemove={handleRemove}
        // ORCH-1384 — partner identity + owner-only disconnect. The pending-
        // invite revoke path above is UNCHANGED; the DB invite-kill trigger
        // stamps the link server-side for every writer (F-6 closed, SC-10).
        partnerLink={
          detailEntry?.partnerLinkId != null && brandIdResolved !== null
            ? { linkId: detailEntry.partnerLinkId, brandId: brandIdResolved }
            : null
        }
        viewerIsOwner={currentRole === "brand_owner"}
        onPartnerDisconnected={() => setToast("Partner disconnected")}
      />

      <Toast
        visible={toast !== null}
        kind="success"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}

interface SectionListProps {
  title: string;
  rows: DisplayEntry[];
  onRowTap: (entry: DisplayEntry) => void;
}

const SectionList: React.FC<SectionListProps> = ({
  title,
  rows,
  onRowTap,
}) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {rows.map((row) => (
        <Pressable
          key={row.id}
          onPress={() => onRowTap(row)}
          accessibilityRole="button"
          accessibilityLabel={`${row.name}, ${roleDisplayName(row.role)}`}
          disabled={row.status === "self"}
          style={({ pressed }) => [
            styles.row,
            row.status === "pending" && styles.rowPending,
            pressed && row.status !== "self" && styles.rowPressed,
          ]}
        >
          <Avatar name={row.name} size="row" />
          <View style={styles.rowTextCol}>
            <Text style={styles.rowName} numberOfLines={1}>
              {row.name}
              {row.status === "self" ? "  ·  You" : ""}
            </Text>
            <Text style={styles.rowEmail} numberOfLines={1}>
              {row.email}
            </Text>
          </View>
          <View style={styles.rowMetaCol}>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>
                {roleDisplayName(row.role)}
              </Text>
            </View>
            {row.partnerLinkId !== null ? (
              // ORCH-1384 — "Mingla Partner" badge, directly below the role
              // pill for EXACTLY the matched partner row. Non-interactive
              // label inside an already-tappable row (no dead tap). Text is
              // text.primary on accent.tint (10.66:1, DESIGN §4.3) —
              // deliberately NOT the role pill's warm-on-tint.
              <View style={styles.partnerBadge} testID="team-partner-badge">
                <Icon name="award" size={10} color={accent.warm} />
                <Text style={styles.partnerBadgeText}>Mingla Partner</Text>
              </View>
            ) : null}
            {row.status === "pending" ? (
              <Text style={styles.rowSubText}>
                {formatRelativeTime(row.timestampIso)}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
};

// ---- Adapters: server rows → BrandTeamEntry shape consumed by MemberDetailSheet
function invitationRowToEntry(row: BrandInvitationRow): BrandTeamEntry {
  return {
    id: row.id,
    brandId: row.brand_id,
    inviteeEmail: row.email,
    inviteeName: row.invitee_name ?? row.email,
    role: row.role,
    status: "pending",
    invitedBy: row.invited_by,
    invitedAt: new Date(
      new Date(row.expires_at).getTime() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    acceptedAt: null,
    removedAt: null,
  };
}

function memberRowToEntry(row: BrandTeamMemberRow): BrandTeamEntry {
  return {
    id: row.id,
    brandId: row.brand_id,
    inviteeEmail: row.user_id,
    inviteeName: row.user_id,
    role: row.role,
    status: "accepted",
    invitedBy: row.user_id,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
    removedAt: row.removed_at,
  };
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  banner: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(59, 130, 246, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.24)",
  },
  bannerText: {
    fontSize: 12,
    color: textTokens.secondary,
    lineHeight: 18,
  },
  headerInviteCta: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  emptyHost: {
    paddingTop: spacing.xl,
    alignItems: "center",
  },
  // ORCH-1309 — cold-load resolving spinner host.
  resolvingHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: textTokens.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.xs + 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.xs + 2,
  },
  rowPending: {
    opacity: 0.85,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowEmail: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  rowMetaCol: {
    alignItems: "flex-end",
    gap: 4,
  },
  rolePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(235, 120, 37, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.32)",
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: "600",
    color: accent.warm,
  },
  // ORCH-1384 — "Mingla Partner" badge (DESIGN §2.4). accent.tint fill +
  // accent.border border are real tokens; text.primary text (10.66:1).
  partnerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  partnerBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: textTokens.primary,
  },
  rowSubText: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  gateCaption: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    textAlign: "center",
  },
});
