import React from "react";
import { AccessibilityInfo, Linking, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PersonDetailView } from "../../../src/components/people/PersonDetailView";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { TopBar } from "../../../src/components/ui/TopBar";
import { useShareNetworkState } from "../../../src/components/ui/useShareNetworkState";
import { canvas } from "../../../src/constants/designSystem";
import { capturePeople } from "../../../src/features/people/peopleAnalytics";
import { useBrandPerson } from "../../../src/hooks/marketing/useBrandPeople";
import { useBrandPersonMaintenance } from "../../../src/hooks/marketing/useBrandPersonMaintenance";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { PeopleServiceError } from "../../../src/services/peopleService";
import type {
  BrandPersonContact,
  BrandPersonDetail,
  BrandPersonMergeHistoryRow,
  BrandPersonPromoteResult,
  BrandPersonSummary,
} from "../../../src/types/people";

function isDetail(value: unknown): value is BrandPersonDetail {
  return typeof value === "object" && value !== null
    && "identityVersion" in value && "capabilities" in value
    && "alternateNames" in value;
}

function primaryErrorCopy(caught: unknown, online: boolean): string {
  if (!online) return "You’re offline. Reconnect to continue. Nothing has changed.";
  if (caught instanceof PeopleServiceError) {
    if (caught.code === "people_forbidden") return "You don’t have permission to do that.";
    if (caught.code === "people_primary_stale" || caught.code === "people_primary_invalid") {
      return "That contact method changed. Review the latest details and try again.";
    }
  }
  return "Primary wasn’t changed. Try again.";
}

function detailError(
  roleError: boolean,
  queryKind: string,
): "not_found" | "forbidden" | "offline" | "error" | null {
  if (roleError || queryKind === "forbidden") return "forbidden";
  if (queryKind === "notFound") return "not_found";
  if (queryKind === "offlineEmpty") return "offline";
  if (queryKind === "error") return "error";
  return null;
}

function MaintenanceDetailExperience({
  person,
  detail,
  loading,
  error,
  brandId,
  personId,
  roleResolved,
  accepted,
  rank,
  online,
  queryKind,
  refetch,
}: {
  person: BrandPersonSummary | null;
  detail: BrandPersonDetail | null;
  loading: boolean;
  error: "not_found" | "forbidden" | "offline" | "error" | null;
  brandId: string;
  personId: string;
  roleResolved: boolean;
  accepted: boolean;
  rank: number;
  online: boolean;
  queryKind: string;
  refetch: () => Promise<unknown>;
}): React.ReactElement {
  const router = useRouter();
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [candidateSearch, setCandidateSearch] = React.useState("");
  const [selectedPersonId, setSelectedPersonId] = React.useState<string | null>(null);
  const [mergeReviewOpen, setMergeReviewOpen] = React.useState(false);
  const [splitRow, setSplitRow] = React.useState<BrandPersonMergeHistoryRow | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [primaryError, setPrimaryError] = React.useState<string | null>(null);
  const maintenance = useBrandPersonMaintenance({
    brandId,
    personId,
    roleResolved,
    accepted,
    rank,
    online,
    candidateSearch,
    pickerOpen: detail !== null && mergeOpen && !mergeReviewOpen,
    mergeReviewOpen: detail !== null && mergeOpen && mergeReviewOpen,
    selectedPersonId,
    historyEnabled: detail?.capabilities.canViewMergeHistory ?? false,
    splitOpen: splitRow !== null,
    splitMergeEventId: splitRow?.mergeEventId ?? null,
  });
  const restoredMerge = maintenance.recoveryState === "receipt" &&
    maintenance.recoveredOperationKind === "merge" &&
    maintenance.recoveredOperation !== null &&
    "survivorPersonId" in maintenance.recoveredOperation
    ? maintenance.recoveredOperation
    : null;
  const restoredSplit = maintenance.recoveryState === "receipt" &&
    maintenance.recoveredOperationKind === "split";
  const restoredPromote = maintenance.recoveryState === "receipt" &&
    maintenance.recoveredOperationKind === "promote" &&
    maintenance.recoveredOperation !== null &&
    "contactMethodId" in maintenance.recoveredOperation
    ? maintenance.recoveredOperation as BrandPersonPromoteResult
    : null;

  React.useEffect(() => {
    if (restoredMerge === null) return;
    if (restoredMerge.survivorPersonId !== personId) {
      router.replace(`/(tabs)/people/${restoredMerge.survivorPersonId}` as never);
      return;
    }
    if (detail !== null) setMergeOpen(true);
  }, [detail, personId, restoredMerge, router]);

  const mutationDisabled = !maintenance.mutationAllowed || maintenance.merge.isPending
    || maintenance.promote.isPending || maintenance.split.isPending;

  const promote = async (contact: BrandPersonContact): Promise<void> => {
    setPrimaryError(null);
    setStatus("Changing primary");
    AccessibilityInfo.announceForAccessibility("Making primary…");
    try {
      await maintenance.promote.mutateAsync({
        intentKey: `${detail!.personId}:${contact.id}:${detail!.identityVersion}`,
        personId: detail!.personId,
        contactMethodId: contact.id,
        personVersion: detail!.identityVersion,
      });
      setStatus(null);
      capturePeople("brand_person_primary_promoted", {
        surface: "detail",
        result: "completed",
        channel: contact.channel,
      });
    } catch (caught) {
      setStatus(null);
      setPrimaryError(primaryErrorCopy(caught, online));
      capturePeople("brand_person_primary_blocked", {
        surface: "detail",
        result: "blocked",
        channel: contact.channel,
        errorCode: caught instanceof PeopleServiceError ? caught.code : "people_unknown",
      });
      await refetch();
    }
  };

  const openMerge = (): void => {
    setCandidateSearch("");
    setSelectedPersonId(null);
    setMergeReviewOpen(false);
    setMergeOpen(true);
    capturePeople("brand_person_merge_started", { surface: "detail" });
  };

  const routeStatus = queryKind === "offlineStale"
    ? "Offline — showing saved contact details."
    : queryKind === "staleError"
    ? "Couldn’t update — showing saved contact details."
    : queryKind === "refreshing"
    ? "Updating…"
    : status;

  const retryRecovery = async (): Promise<void> => {
    setPrimaryError(null);
    try {
      await maintenance.retryRecoveredIntent();
    } catch (caught) {
      setPrimaryError(primaryErrorCopy(caught, online));
    }
  };

  if (detail === null) {
    return (
      <PersonDetailView
        person={person}
        loading={loading}
        error={error}
        status={routeStatus}
        onRetry={() => void refetch()}
      />
    );
  }

  // Load maintenance-only animation and overlay modules only after the expanded
  // #1772 detail contract is present. The hook remains mounted above so a
  // restored merge can redirect away from an absorbed route before rendering.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PersonMaintenanceFlow } = require(
    "../../../src/components/people/PersonMaintenanceFlow"
  ) as typeof import("../../../src/components/people/PersonMaintenanceFlow");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { IdentityOperationReceipt } = require(
    "../../../src/components/people/IdentityOperationReceipt"
  ) as typeof import("../../../src/components/people/IdentityOperationReceipt");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Sheet } = require(
    "../../../src/components/ui/Sheet"
  ) as typeof import("../../../src/components/ui/Sheet");

  const promotedContact = restoredPromote === null
    ? null
    : detail.contacts.find((contact) => contact.id === restoredPromote.contactMethodId) ?? null;
  const historyFirstPageError = maintenance.history.isError &&
    maintenance.historyRows.length === 0;
  const historyLoadMoreError = maintenance.history.isFetchNextPageError;
  const historyRefreshError = maintenance.history.isRefetchError &&
    maintenance.historyRows.length > 0 && !historyLoadMoreError;

  return (
    <>
      <PersonDetailView
        person={detail}
        loading={false}
        error={null}
        status={routeStatus}
        onRetry={() => void refetch()}
        historyRows={maintenance.historyRows}
        historyLoading={maintenance.history.isLoading}
        historyInitialError={historyFirstPageError}
        historyRefreshError={historyRefreshError}
        historyLoadMoreError={historyLoadMoreError}
        historyLoadingMore={maintenance.history.isFetchingNextPage}
        historyHasNextPage={maintenance.history.hasNextPage === true}
        onRetryHistory={() => void maintenance.history.refetch()}
        onLoadMoreHistory={() => void maintenance.history.fetchNextPage()}
        mutationDisabled={mutationDisabled}
        promotingContactId={maintenance.promote.variables?.contactMethodId ?? null}
        primaryError={primaryError}
        onMerge={detail.capabilities.canMerge ? openMerge : undefined}
        onPromote={detail.capabilities.canPromotePrimary ? (contact) => void promote(contact) : undefined}
        onSplit={detail.capabilities.canSplit ? (row) => {
          setSplitRow(row);
          capturePeople("brand_person_split_started", { surface: "detail" });
        } : undefined}
        maintenanceRecoveryState={maintenance.recoveryState}
        onCheckRecovery={maintenance.checkRecovery}
        onRetryRecovery={() => void retryRecovery()}
        onAbandonRecovery={() => void maintenance.abandonRecovery()}
      />
      <PersonMaintenanceFlow
        person={detail}
        online={online}
        mergeVisible={mergeOpen}
        candidateSearch={candidateSearch}
        onCandidateSearchChange={setCandidateSearch}
        candidateRows={maintenance.candidateRows}
        candidatesLoading={maintenance.candidates.isLoading}
        candidatesLoadingMore={maintenance.candidates.isFetchingNextPage}
        candidatesError={maintenance.candidates.error}
        hasNextCandidates={maintenance.candidates.hasNextPage === true}
        onLoadMoreCandidates={() => void maintenance.candidates.fetchNextPage()}
        onRetryCandidates={() => void maintenance.candidates.refetch()}
        preview={maintenance.mergePreview.data}
        previewLoading={maintenance.mergePreview.isLoading}
        previewError={maintenance.mergePreview.error}
        onRetryPreview={() => void maintenance.mergePreview.refetch()}
        onSelectedPersonIdChange={setSelectedPersonId}
        onMergeReviewOpenChange={setMergeReviewOpen}
        onMerge={async (input) => {
          try {
            const result = await maintenance.merge.mutateAsync(input);
            capturePeople("brand_person_merge_completed", {
              surface: "merge_sheet",
              result: "completed",
              hadPriorSeparation: maintenance.mergePreview.data?.hadPriorSeparation,
              hadOpenConflict: maintenance.mergePreview.data?.hadOpenConflict,
            });
            return result;
          } catch (caught) {
            capturePeople("brand_person_merge_blocked", {
              surface: "merge_sheet",
              result: "blocked",
              errorCode: caught instanceof PeopleServiceError ? caught.code : "people_unknown",
            });
            throw caught;
          }
        }}
        mergePending={maintenance.merge.isPending}
        onCloseMerge={() => setMergeOpen(false)}
        onOpenReview={() => {
          setMergeOpen(false);
          router.replace("/(tabs)/marketing/people?review=conflicts" as never);
        }}
        onViewMergedPerson={(survivorPersonId) => {
          setMergeOpen(false);
          router.replace(`/(tabs)/people/${survivorPersonId}` as never);
        }}
        splitVisible={splitRow !== null || restoredSplit}
        splitPreview={maintenance.splitPreview.data}
        splitLoading={maintenance.splitPreview.isLoading}
        splitError={maintenance.splitPreview.error}
        onRetrySplitPreview={() => void maintenance.splitPreview.refetch()}
        splitMergeEventId={splitRow?.mergeEventId ?? null}
        onSplit={async (input) => {
          try {
            const result = await maintenance.split.mutateAsync(input);
            capturePeople(
              result.outcome === "reversed"
                ? "brand_person_split_completed"
                : "brand_person_split_escalated",
              {
                surface: "split_sheet",
                result: result.outcome === "reversed" ? "completed" : "escalated",
              },
            );
            return result;
          } catch (caught) {
            capturePeople("brand_person_split_blocked", {
              surface: "split_sheet",
              result: "blocked",
              errorCode: caught instanceof PeopleServiceError ? caught.code : "people_unknown",
            });
            throw caught;
          }
        }}
        splitPending={maintenance.split.isPending}
        onCloseSplit={() => setSplitRow(null)}
        onViewPeople={() => {
          setSplitRow(null);
          router.replace("/(tabs)/marketing/people" as never);
        }}
        onEmailSupport={(reference) => {
          const subject = encodeURIComponent(`Brand contact Split ${reference}`);
          void Linking.openURL(`mailto:support@usemingla.com?subject=${subject}`);
        }}
        restoredOperation={maintenance.recoveredOperation}
        restoredOperationKind={maintenance.recoveredOperationKind}
        onAcknowledgeReceipt={maintenance.acknowledgeRecovery}
        onCheckRecovery={maintenance.checkRecovery}
        onStaleReview={(message) => setStatus(message)}
      />
      {restoredPromote ? (
        <Sheet
          visible
          onClose={() => undefined}
          dismissOnScrimTap={false}
        >
          <IdentityOperationReceipt
            kind="promote"
            contactValue={promotedContact?.value ?? null}
            channel={restoredPromote.channel}
            onPrimary={() => {
              void (async () => {
                await maintenance.acknowledgeRecovery();
                await refetch();
              })();
            }}
          />
        </Sheet>
      ) : null}
    </>
  );
}

export default function BrandPersonDetailRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ personId: string | string[] }>();
  const brand = useCurrentBrand();
  const role = useCurrentBrandRole(brand?.id ?? null);
  const online = useShareNetworkState();
  const personId = Array.isArray(params.personId)
    ? params.personId[0]
    : params.personId ?? null;
  const roleResolved = !role.isLoading && !role.isError;
  const query = useBrandPerson(
    brand?.id ?? null,
    personId,
    roleResolved,
    role.accepted,
    role.rank,
    online,
  );
  const loading = !role.isError && (
    query.kind === "authLoading" || query.kind === "roleLoading" || query.kind === "loading"
  );
  const hidden = role.isError || loading || query.kind === "forbidden"
    || query.kind === "notFound" || query.kind === "offlineEmpty" || query.kind === "error";
  const detail = !hidden && isDetail(query.data) ? query.data : null;
  const person = hidden ? null : query.data ?? null;

  return (
    <SafeScreen edges={["top"]} style={styles.host}>
      <TopBar
        leftKind="back"
        title={!hidden ? query.data?.displayName ?? "Person" : "Person"}
        onBack={() => router.replace("/(tabs)/marketing/people" as never)}
        rightSlot={null}
      />
      {brand?.id && personId ? (
        <MaintenanceDetailExperience
          person={person}
          detail={detail}
          loading={loading}
          error={detailError(role.isError, query.kind)}
          brandId={brand.id}
          personId={personId}
          roleResolved={roleResolved}
          accepted={role.accepted}
          rank={role.rank}
          online={online}
          queryKind={query.kind}
          refetch={async () => { await query.refetch(); }}
        />
      ) : (
        <PersonDetailView
          person={person}
          loading={loading}
          status={null}
          error={detailError(role.isError, query.kind)}
          onRetry={() => void query.refetch()}
        />
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({ host: { backgroundColor: canvas.discover } });
