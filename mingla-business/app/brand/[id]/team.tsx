/**
 * /brand/[id]/team — J-T1 brand-team list (Cycle 13a).
 *
 * Replaces the J-A9 BrandTeamView cluster (deleted per DEC-092 / Path A).
 * Renders pending invitations + active members from `useBrandTeamStore`,
 * synthesizes the operator's self-row from `useCurrentBrandRole` for solo
 * operators, and gates the "+" invite CTA on MIN_RANK.INVITE_TEAM_MEMBER.
 *
 * I-31 TRANSITIONAL banner is permanent in 13a — emails ship in B-cycle.
 *
 * Hook ordering follows ORCH-0710: ALL hooks run on every render before any
 * early-return shell. Guards happen via the `enabled` flag inside
 * `useCurrentBrandRole`, not via skipped hooks.
 *
 * Per Cycle 13a SPEC §4.10.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
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
  useBrandTeamStore,
  type BrandTeamEntry,
} from "../../../src/store/brandTeamStore";
import { useBrandList } from "../../../src/store/currentBrandStore";
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
}

export default function BrandTeamRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandIdResolved =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const { user } = useAuth();
  const userId = user?.id ?? null;
  const operatorAccountId = userId ?? "";

  const brands = useBrandList();
  const brand =
    brandIdResolved !== null
      ? brands.find((b) => b.id === brandIdResolved) ?? null
      : null;

  const allEntries = useBrandTeamStore((s) => s.entries);
  const revokeInvitation = useBrandTeamStore((s) => s.revokeInvitation);
  const removeAcceptedMember = useBrandTeamStore(
    (s) => s.removeAcceptedMember,
  );

  const { role: currentRole, rank: currentRank } = useCurrentBrandRole(
    brandIdResolved,
  );

  const [inviteVisible, setInviteVisible] = useState<boolean>(false);
  const [detailEntry, setDetailEntry] = useState<DisplayEntry | null>(null);

  const pendingEntries = useMemo<DisplayEntry[]>(
    () =>
      allEntries
        .filter(
          (e) => e.brandId === brandIdResolved && e.status === "pending",
        )
        .sort(
          (a, b) =>
            new Date(b.invitedAt).getTime() - new Date(a.invitedAt).getTime(),
        )
        .map<DisplayEntry>((e) => ({
          id: e.id,
          name: e.inviteeName,
          email: e.inviteeEmail,
          role: e.role,
          status: "pending",
          timestampIso: e.invitedAt,
          storeEntry: e,
        })),
    [allEntries, brandIdResolved],
  );

  const acceptedEntries = useMemo<DisplayEntry[]>(() => {
    const fromStore = allEntries
      .filter(
        (e) => e.brandId === brandIdResolved && e.status === "accepted",
      )
      .sort((a, b) => {
        const aT = a.acceptedAt !== null ? new Date(a.acceptedAt).getTime() : 0;
        const bT = b.acceptedAt !== null ? new Date(b.acceptedAt).getTime() : 0;
        return bT - aT;
      })
      .map<DisplayEntry>((e) => ({
        id: e.id,
        name: e.inviteeName,
        email: e.inviteeEmail,
        role: e.role,
        status: "accepted",
        timestampIso: e.acceptedAt ?? e.invitedAt,
        storeEntry: e,
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
          }
        : null;
    return selfRow !== null ? [selfRow, ...fromStore] : fromStore;
  }, [allEntries, brandIdResolved, currentRole, user, userId]);

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

  const handleInviteSuccess = useCallback((): void => {
    setInviteVisible(false);
  }, []);

  const handleRowTap = useCallback((entry: DisplayEntry): void => {
    if (entry.status === "self") return; // self-row is informational only
    setDetailEntry(entry);
  }, []);

  const handleRevoke = useCallback(
    (entry: BrandTeamEntry): void => {
      revokeInvitation(entry.id);
      setDetailEntry(null);
    },
    [revokeInvitation],
  );

  const handleRemove = useCallback(
    (entry: BrandTeamEntry): void => {
      removeAcceptedMember(entry.id);
      setDetailEntry(null);
    },
    [removeAcceptedMember],
  );

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
        {/* TRANSITIONAL banner — permanent until B-cycle */}
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Testing mode — invitations are stored locally for now. Emails ship
            in B-cycle.
          </Text>
        </View>

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
