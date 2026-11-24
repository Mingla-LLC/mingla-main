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
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Icon } from "../../../src/components/ui/Icon";
import { TopBar } from "../../../src/components/ui/TopBar";
import {
  color,
  radius,
  space,
  type,
} from "../../../src/constants/designSystem";
import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Table } from "../../../src/components/ui/Table";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { useTillReleased } from "../../../src/hooks/useTillReleased";
import { rowTappable, showSelfRowAboveEmpty, teamEmptyCopy, teamGateCaptionShown, teamListState } from "../../../src/components/team/teamRowModel";
import { Skeleton } from "../../../src/components/ui/Skeleton";
import { useAuth } from "../../../src/context/AuthContext";
import { SignedInNotFoundNotice } from "../../../src/components/auth/SignedInNotFoundNotice";
// #3259 — names the signed-in account on the settled-null brand branch below.
import { useSwitchAccount } from "../../../src/hooks/useSwitchAccount";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import {
  useBrandInvitations,
  useBrandTeamMembers,
  useRemoveBrandTeamMember,
  useRevokeBrandInvitation,
} from "../../../src/hooks/useBrandInvitations";
import { useBrandTeamMemberDirectory } from "../../../src/hooks/useBrandTeamMemberDirectory";
// #4579 — the one "Mingla Team" entry (Mingla admins are never listed one by one here).
import { useMinglaTeamMutations, useMinglaTeamState } from "../../../src/hooks/useMinglaTeam";
import { MinglaTeamSection } from "../../../src/components/team/MinglaTeamSection";
import { useUpdateBrandTeamMemberVenueGrants } from "../../../src/hooks/useBrandVenueAccessMutation";
import {
  BrandInvitationServiceError,
  type VenueAccessGrant,
  type BrandInvitationRow,
  type BrandTeamMemberRow,
} from "../../../src/services/brandInvitationsService";
import { useBrand } from "../../../src/hooks/useBrands";
import { useVenueListings } from "../../../src/hooks/useVenueListings";
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
} from "../../../src/utils/brandRole";
import { roleDisplayName } from "../../../src/utils/brandRoleCopy";
import {
  teamMemberIdentity,
  type TeamMemberIdentity,
} from "../../../src/utils/brandTeamMemberIdentity";
import {
  canPerformAction,
  gateCaptionFor,
} from "../../../src/utils/permissionGates";
import { formatRelativeTime } from "../../../src/utils/relativeTime";
// #1369 (folded-in D-1, Tier-3 class of #1342) — defer the "Partner
// disconnected" success toast past the sheet's unmount window so its native
// <Modal> presents from a now-free root VC instead of racing the closing
// MemberDetailSheet's modal (same close→toast race as #1360).
import { deferAfterDismiss } from "../../../src/utils/deferAfterDismiss";

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
  const { signedInEmail, onSwitchAccount } = useSwitchAccount();
  const params = useLocalSearchParams<{
    id: string | string[];
    venueId?: string | string[];
  }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandIdResolved =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;
  const venueParam = Array.isArray(params.venueId)
    ? params.venueId[0]
    : params.venueId;
  const initialVenueId = typeof venueParam === "string" && venueParam.length > 0
    ? venueParam
    : null;

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

  const invitationsQuery = useBrandInvitations(brandIdResolved);
  const membersQuery = useBrandTeamMembers(brandIdResolved);
  const { data: invitationRows = [] } = invitationsQuery;
  const { data: memberRows = [] } = membersQuery;
  // #4490 08-O5 fix 5: still loading the people (a failed read is not
  // pending): no empty state until both have answered.
  const peopleLoading = invitationsQuery.isPending === true || membersQuery.isPending === true;
  // issue #4271 — names and emails for accepted members (never a raw user id).
  const directoryQuery = useBrandTeamMemberDirectory(brandIdResolved);
  const directoryRows = useMemo(() => directoryQuery.data ?? [], [directoryQuery.data]);
  const directoryLoaded = directoryQuery.isSuccess;
  const { data: minglaTeamState } = useMinglaTeamState(brandIdResolved);
  const minglaTeam = useMinglaTeamMutations(brandIdResolved);
  const directoryByUserId = useMemo(
    () => new Map(directoryRows.map((entry) => [entry.userId, entry])),
    [directoryRows],
  );
  const { data: venues = [] } = useVenueListings(brandIdResolved);
  const { mutateAsync: revokeAsync } = useRevokeBrandInvitation(brandIdResolved);
  const { mutateAsync: removeAsync, isPending: removePending } =
    useRemoveBrandTeamMember(brandIdResolved);
  const { mutateAsync: updateVenueGrantsAsync, isPending: grantsPending } =
    useUpdateBrandTeamMemberVenueGrants(brandIdResolved);
  // Scope late success/failure to the member that started the mutation so a
  // second sheet open cannot inherit a stale close or error toast.
  const removeTargetIdRef = useRef<string | null>(null);
  // ORCH-1384 — accepted, non-cancelled links keyed by partner_account_id.
  const { data: partnerLinkRows = [] } = useBrandPartnerLinks(brandIdResolved);

  const {
    role: currentRole,
    rank: currentRank,
    isLoading: roleIsLoading,
    isAuthReady: roleAuthReady,
  } = useCurrentBrandRole(brandIdResolved);
  // #4490 08-O5 fix 6: until the role has answered, rank reads as "no rights",
  // which flashed "Your role doesn't include this action" for staff and
  // finance users. The page shows its loading list until the role is known.
  const roleLoading = roleIsLoading || !roleAuthReady;

  const { isWideDesktop } = useResponsiveLayout();
  // #4490 08-O5 fix 2 (O5-B1): while the Till is released your own row opens
  // your Till PIN (nobody else can set it); otherwise it stays informational.
  const tillReleased = useTillReleased();
  const [inviteVisible, setInviteVisible] = useState<boolean>(false);
  const [detailEntry, setDetailEntry] = useState<DisplayEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  // #4579 — the add-back failure (no sheet is open on that path).
  const [screenError, setScreenError] = useState<string | null>(null);

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
          row.user_id !== userId &&
          // #4579 — a Mingla admin viewer can read every row, including the
          // automatic ones; those belong to the one Mingla Team entry, so a
          // member the directory does not list is never shown one by one.
          (!directoryLoaded || directoryByUserId.has(row.user_id)),
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
      .map<DisplayEntry>((row) => {
        const identity = teamMemberIdentity(
          row.user_id,
          directoryByUserId.get(row.user_id),
        );
        return {
        id: row.id,
        name: identity.name,
        email: identity.email,
        role: row.role,
        status: "accepted",
        timestampIso: row.accepted_at ?? row.invited_at,
        storeEntry: memberRowToEntry(row, identity),
        // ORCH-1384 — the Mingla-partner member row (badge + owner disconnect).
        partnerLinkId: partnerLinkByUserId.get(row.user_id) ?? null,
        };
      });
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
            // The sheet shows you read-only (no role, access or remove controls);
            // its only control is your own Till PIN (MemberDetailSheet isSelf).
            storeEntry: brandIdResolved !== null
              ? {
                  id: `self_${userId}`,
                  brandId: brandIdResolved,
                  inviteeEmail: user?.email ?? "",
                  inviteeName: user?.email ?? "You",
                  role: currentRole,
                  venueGrants: [],
                  status: "accepted",
                  invitedBy: userId,
                  invitedAt: new Date().toISOString(),
                  acceptedAt: new Date().toISOString(),
                  removedAt: null,
                }
              : null,
            partnerLinkId: null,
          }
        : null;
    return selfRow !== null ? [selfRow, ...fromServer] : fromServer;
  }, [memberRows, currentRole, user, userId, brandIdResolved, partnerLinkByUserId, directoryByUserId, directoryLoaded]);

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
    if (!rowTappable(entry, tillReleased)) return;
    setDetailEntry(entry);
  }, [tillReleased]);

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
    (entry: BrandTeamEntry): void => {
      // #3660 — real removal via biz_remove_brand_team_member (no longer a no-op).
      // Keep the sheet open on failure and pass the error into MemberDetailSheet
      // so its in-sheet Toast can present (sibling root Modal races on iOS).
      if (removePending) return;
      removeTargetIdRef.current = entry.id;
      setErrorToast(null);
      void removeAsync(entry.id)
        .then(() => {
          if (removeTargetIdRef.current !== entry.id) return;
          setDetailEntry(null);
          deferAfterDismiss(() => setToast("Removed from team"));
        })
        .catch((err: unknown) => {
          if (removeTargetIdRef.current !== entry.id) return;
          const code =
            err instanceof BrandInvitationServiceError ? err.code : "server";
          const message =
            code === "cannot_remove_brand_account"
              ? "You can't remove the brand owner."
              : code === "active_partner_use_disconnect"
                ? "Disconnect this Mingla Partner from Team instead of Remove."
                : code === "forbidden"
                  ? "You don't have permission to remove this person."
                  : "Couldn't remove them. Try again.";
          setErrorToast(message);
        });
    },
    [removeAsync, removePending],
  );

  const handleSaveVenueGrants = useCallback(
    async (entry: BrandTeamEntry, grants: VenueAccessGrant[]): Promise<void> => {
      setErrorToast(null);
      try {
        await updateVenueGrantsAsync({ memberId: entry.id, grants });
        setDetailEntry(null);
        deferAfterDismiss(() => setToast("Venue access updated"));
      } catch (error) {
        const code = error instanceof BrandInvitationServiceError
          ? error.code
          : "server";
        setErrorToast(code === "forbidden"
          ? "You don't have permission to change venue access."
          : "Couldn't update venue access. Try again.");
      }
    },
    [updateVenueGrantsAsync],
  );

  // ORCH-1309 — cold-load resolving state: a valid brandId whose brand is still
  // being fetched (session warming / query not settled) renders a spinner, not
  // the "Brand not found" empty state. Only a settled-null brand falls through.
  if (brandIdResolved !== null && brand === null && isBrandResolving) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <TopBar leftKind="back" title="Team & permissions" onBack={handleBack} rightSlot={null} />
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
          title="Team & permissions"
          onBack={handleBack}
          rightSlot={null}
        />
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="users"
            title="Brand not found"
            // #3259 P2-3 — the host's own hedge is for a reader we know
            // NOTHING about. When the notice renders it says this and names the
            // account, so showing both states one cause and then a different
            // set of causes a line apart. Signed-out keeps it verbatim.
            // "Switch back and try again" also sat directly above a
            // "Switch account" button — two different switch verbs, adjacent.
            description={
              signedInEmail === null
                ? "This brand isn't in your list. Switch back and try again."
                : undefined
            }
          />
          {/*
            #3259 — a signed-in reader gets the account named and a way out. The
            client CANNOT tell a deleted row from an RLS-filtered one
            (`.maybeSingle()` returns `{data: null, error: null}` for both), so
            the copy states both possibilities and asserts neither.
          */}
          <SignedInNotFoundNotice
            variant="restricted"
            signedInEmail={signedInEmail}
            onSwitchAccount={onSwitchAccount}
            testID="brand-team-not-found-signed-in-notice"
          />
        </View>
      </View>
    );
  }

  // <=1 because self-row is always present when role is known
  const listState = teamListState({
    loading: peopleLoading || roleLoading,
    pendingCount: pendingEntries.length,
    acceptedCount: acceptedEntries.length,
  });
  const showEmpty = listState === "empty";

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <TopBar
        leftKind="back"
        title="Team & permissions"
        onBack={handleBack}
        rightSlot={
          canInvite ? (
            isWideDesktop ? (
              // #4420 — desktop names the action (the mockup's Paper button).
              <Button
                label="Invite team member"
                onPress={handleOpenInvite}
                variant="primary"
                size="sm"
                accessibilityLabel="Invite team member"
              />
            ) : (
              <IconChrome
                icon="plus"
                onPress={handleOpenInvite}
                accessibilityLabel="Invite team member"
              />
            )
          ) : null
        }
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, isWideDesktop && styles.scrollContentDesktop]}
        showsVerticalScrollIndicator={false}
      >
        {showEmpty && showSelfRowAboveEmpty(acceptedEntries, tillReleased) ? (
          <SectionList
            title="Active members"
            rows={acceptedEntries}
            tillReleased={tillReleased}
            onRowTap={handleRowTap}
          />
        ) : null}
        {listState === "loading" ? (
          <View style={styles.loadingHost} testID="team-loading" accessibilityLabel="Loading the team">
            <Skeleton height={56} radius="lg" />
            <Skeleton height={56} radius="lg" />
            <Skeleton height={56} radius="lg" />
          </View>
        ) : showEmpty ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="users"
              title={teamEmptyCopy(canInvite).title}
              description={teamEmptyCopy(canInvite).description}
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
          isWideDesktop ? (
            // #4420 — desktop (T2): one Member / Role / Status table, pending
            // invitations first; rows open the same detail sheet.
            <TeamTable
              rows={[...pendingEntries, ...acceptedEntries]}
              tillReleased={tillReleased}
              onRowTap={handleRowTap}
            />
          ) : (
          <>
            {pendingEntries.length > 0 ? (
              <SectionList
                title="Pending invitations"
                rows={pendingEntries}
                tillReleased={tillReleased}
                onRowTap={handleRowTap}
              />
            ) : null}
            <SectionList
              title="Active members"
              rows={acceptedEntries}
              tillReleased={tillReleased}
              onRowTap={handleRowTap}
            />
          </>
          )
        )}

        {/* #4579 — "Mingla" section: one Mingla Team entry, on or off. It is
            not a member row, so the solo empty state above ignores it. */}
        <MinglaTeamSection
          state={minglaTeamState}
          isWideDesktop={isWideDesktop}
          removePending={minglaTeam.removePending}
          restorePending={minglaTeam.restorePending}
          onRemove={minglaTeam.remove}
          onRestore={minglaTeam.restore}
          onSuccess={(message) => setToast(message)}
          onError={(message) => setScreenError(message)}
          defer={deferAfterDismiss}
        />

        {teamGateCaptionShown(listState, canInvite) ? (
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
        venues={venues}
        initialVenueId={initialVenueId}
        onClose={() => setInviteVisible(false)}
        onSuccess={handleInviteSuccess}
      />

      <MemberDetailSheet
        visible={detailEntry !== null}
        entry={detailEntry?.storeEntry ?? null}
        isSelf={detailEntry?.status === "self"}
        onOwnPinSaved={(message) => {
          // The sheet closes first; the toast follows once it has gone (iOS).
          setDetailEntry(null);
          deferAfterDismiss(() => setToast(message));
        }}
        currentRank={currentRank}
        onClose={() => {
          if (removePending) return;
          setDetailEntry(null);
          setErrorToast(null);
        }}
        onRevoke={handleRevoke}
        onRemove={handleRemove}
        removePending={removePending}
        grantsPending={grantsPending}
        venues={venues}
        onSaveVenueGrants={handleSaveVenueGrants}
        removeError={errorToast}
        onDismissRemoveError={() => setErrorToast(null)}
        // ORCH-1384 — partner identity + owner-only disconnect. The pending-
        // invite revoke path above is UNCHANGED; the DB invite-kill trigger
        // stamps the link server-side for every writer (F-6 closed, SC-10).
        partnerLink={
          detailEntry?.partnerLinkId != null && brandIdResolved !== null
            ? { linkId: detailEntry.partnerLinkId, brandId: brandIdResolved }
            : null
        }
        viewerIsOwner={currentRole === "brand_owner"}
        onPartnerDisconnected={() =>
          // #1369 D-1 — the sheet's handleDisconnectConfirm already called
          // onClose() (close-first); defer the success toast past the sheet's
          // unmount window so its native <Modal> isn't dropped racing the
          // closing MemberDetailSheet's modal (same class as #1360).
          deferAfterDismiss(() => setToast("Partner disconnected"))
        }
      />

      <Toast
        visible={toast !== null}
        kind="success"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />
      <Toast
        visible={screenError !== null}
        kind="error"
        message={screenError ?? ""}
        onDismiss={() => setScreenError(null)}
      />
    </View>
  );
}

interface SectionListProps {
  title: string;
  rows: DisplayEntry[];
  tillReleased: boolean;
  onRowTap: (entry: DisplayEntry) => void;
}

const SectionList: React.FC<SectionListProps> = ({
  title,
  rows,
  tillReleased,
  onRowTap,
}) => {
  if (rows.length === 0) return null;
  // #4420 — one grouped pane per section, hairline between rows (the
  // mockup), instead of a separate boxed card per member.
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      <GlassCard variant="base" padding={0}>
      {rows.map((row, index) => (
        <Pressable
          key={row.id}
          onPress={() => onRowTap(row)}
          accessibilityRole="button"
          accessibilityLabel={`${row.name}, ${roleDisplayName(row.role)}`}
          disabled={!rowTappable(row, tillReleased)}
          style={({ pressed }) => [
            styles.row,
            index > 0 && styles.rowDivider,
            pressed && rowTappable(row, tillReleased) && styles.rowPressed,
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
              <Text style={styles.rolePillText} numberOfLines={1}>
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
                <Icon name="award" size={10} color={color.text1} />
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
      </GlassCard>
    </View>
  );
};

const TeamTable: React.FC<{
  rows: DisplayEntry[];
  tillReleased: boolean;
  onRowTap: (entry: DisplayEntry) => void;
}> = ({ rows, tillReleased, onRowTap }) => (
  <View style={styles.tableWrap}>
    <Table<DisplayEntry>
      rows={rows}
      rowKey={(row) => row.id}
      onRowPress={(row) => {
        if (rowTappable(row, tillReleased)) onRowTap(row);
      }}
      columns={[
        {
          key: "member",
          title: "Member",
          flex: 3,
          render: (row) => (
            <View style={styles.tableMember}>
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
            </View>
          ),
        },
        {
          key: "role",
          title: "Role",
          flex: 2,
          render: (row) => (
            <View style={styles.tableRole}>
              <View style={styles.rolePill}>
                <Text style={styles.rolePillText} numberOfLines={1}>
                  {roleDisplayName(row.role)}
                </Text>
              </View>
              {row.partnerLinkId !== null ? (
                <View style={styles.partnerBadge} testID="team-partner-badge">
                  <Icon name="award" size={10} color={color.text1} />
                  <Text style={styles.partnerBadgeText}>Mingla Partner</Text>
                </View>
              ) : null}
            </View>
          ),
        },
        {
          key: "status",
          title: "Status",
          flex: 1,
          align: "right",
          render: (row) => (
            <Text style={styles.tableStatus} numberOfLines={1}>
              {row.status === "pending"
                ? `Pending · ${formatRelativeTime(row.timestampIso)}`
                : "Active"}
            </Text>
          ),
        },
      ]}
    />
  </View>
);

// ---- Adapters: server rows → BrandTeamEntry shape consumed by MemberDetailSheet
function invitationRowToEntry(row: BrandInvitationRow): BrandTeamEntry {
  return {
    id: row.id,
    brandId: row.brand_id,
    inviteeEmail: row.email,
    inviteeName: row.invitee_name ?? row.email,
    role: row.role,
    venueGrants: row.venueGrants,
    status: "pending",
    invitedBy: row.invited_by,
    invitedAt: new Date(
      new Date(row.expires_at).getTime() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    acceptedAt: null,
    removedAt: null,
  };
}

function memberRowToEntry(
  row: BrandTeamMemberRow,
  identity: TeamMemberIdentity,
): BrandTeamEntry {
  return {
    id: row.id,
    brandId: row.brand_id,
    // issue #4271 — MemberDetailSheet renders these; never the raw user id.
    inviteeEmail: identity.email,
    inviteeName: identity.name,
    role: row.role,
    venueGrants: row.venueGrants,
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
    backgroundColor: color.canvas,
  },
  scrollContent: {
    paddingHorizontal: space[4],
    paddingBottom: space[7],
  },
  scrollContentDesktop: {
    paddingHorizontal: space[6],
  },
  tableWrap: {
    marginTop: space[4],
  },
  tableMember: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    alignSelf: "stretch",
  },
  tableRole: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space[2],
  },
  tableStatus: {
    ...type.caption,
    color: color.text2,
  },
  banner: {
    marginTop: space[2],
    marginBottom: space[4],
    padding: space[2] + 2,
    borderRadius: radius.sm,
    backgroundColor: color.infoTint,
    borderWidth: 1,
    borderColor: color.line,
  },
  bannerText: {
    fontSize: 12,
    color: color.text2,
    lineHeight: 18,
  },
  emptyHost: {
    paddingTop: space[7],
    alignItems: "center",
  },
  loadingHost: {
    marginTop: space[5],
    gap: space[2],
  },
  // ORCH-1309 — cold-load resolving spinner host.
  resolvingHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    marginTop: space[5],
    gap: space[2],
  },
  sectionTitle: {
    ...type.label,
    color: color.text3,
    textTransform: "uppercase",
    paddingHorizontal: space[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 64,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  rowPressed: {
    backgroundColor: color.fill.rowHover,
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 15,
    fontWeight: "600",
    color: color.text1,
  },
  rowEmail: {
    fontSize: 12,
    color: color.text3,
    marginTop: 2,
  },
  rowMetaCol: {
    alignItems: "flex-end",
    gap: 4,
    flexShrink: 0,
    maxWidth: "45%",
  },
  rolePill: {
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: "600",
    color: color.text1,
  },
  // ORCH-1384 — "Mingla Partner" badge (DESIGN §2.4). accent.tint fill +
  // accent.border border are real tokens; text.primary text (10.66:1).
  partnerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  partnerBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: color.text1,
  },
  rowSubText: {
    fontSize: 11,
    color: color.text3,
  },
  gateCaption: {
    fontSize: 12,
    color: color.text3,
    marginTop: space[4],
    textAlign: "center",
  },
});
