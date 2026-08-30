import React from "react";
import { Linking, StyleSheet } from "react-native";
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

function MaintenanceDetailExperience({
  detail,
  brandId,
  personId,
  roleResolved,
  accepted,
  rank,
  online,
  queryKind,
  refetch,
}: {
  detail: BrandPersonDetail;
  brandId: string;
  personId: string;
  roleResolved: boolean;
  accepted: boolean;
  rank: number;
  online: boolean;
  queryKind: string;
  refetch: () => Promise<unknown>;
}): React.ReactElement {
  // Load the maintenance sheet only for the expanded #1772 detail contract.
  // This keeps the rolling-deploy legacy detail/error boundary independent of
  // the sheet's animation runtime until the new DTO is actually present.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PersonMaintenanceFlow } = require(
    "../../../src/components/people/PersonMaintenanceFlow"
  ) as typeof import("../../../src/components/people/PersonMaintenanceFlow");
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
    pickerOpen: mergeOpen && !mergeReviewOpen,
    mergeReviewOpen: mergeOpen && mergeReviewOpen,
    selectedPersonId,
    historyEnabled: detail.capabilities.canViewMergeHistory,
    splitOpen: splitRow !== null,
    splitMergeEventId: splitRow?.mergeEventId ?? null,
  });
  const mutationDisabled = !online || maintenance.merge.isPending
    || maintenance.promote.isPending || maintenance.split.isPending;

  const promote = async (contact: BrandPersonContact): Promise<void> => {
    setPrimaryError(null);
    setStatus("Changing primary");
    try {
      await maintenance.promote.mutateAsync({
        intentKey: `${contact.id}:${detail.identityVersion}`,
        personId: detail.personId,
        contactMethodId: contact.id,
        personVersion: detail.identityVersion,
      });
      setStatus(`${contact.value} is now the primary ${contact.channel}.`);
      capturePeople("brand_person_primary_promoted", {
        surface: "detail",
        result: "completed",
        channel: contact.channel,
      });
      await refetch();
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
        mutationDisabled={mutationDisabled}
        promotingContactId={maintenance.promote.variables?.contactMethodId ?? null}
        primaryError={primaryError}
        onMerge={detail.capabilities.canMerge ? openMerge : undefined}
        onPromote={detail.capabilities.canPromotePrimary ? (contact) => void promote(contact) : undefined}
        onSplit={detail.capabilities.canSplit ? (row) => {
          setSplitRow(row);
          capturePeople("brand_person_split_started", { surface: "detail" });
        } : undefined}
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
          router.replace("/(tabs)/marketing/people" as never);
        }}
        onViewMergedPerson={(survivorPersonId) => {
          setMergeOpen(false);
          router.replace(`/(tabs)/people/${survivorPersonId}` as never);
        }}
        splitVisible={splitRow !== null}
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
      />
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
  return (
    <SafeScreen edges={["top"]} style={styles.host}>
      <TopBar
        leftKind="back"
        title={!hidden ? query.data?.displayName ?? "Person" : "Person"}
        onBack={() => router.replace("/(tabs)/marketing/people" as never)}
        rightSlot={null}
      />
      {detail && brand?.id && personId ? (
        <MaintenanceDetailExperience
          detail={detail}
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
          person={hidden ? null : query.data ?? null}
          loading={loading}
          status={query.kind === "offlineStale"
            ? "Offline — showing saved contact details."
            : query.kind === "staleError"
            ? "Couldn’t update — showing saved contact details."
            : query.kind === "refreshing"
            ? "Updating…"
            : null}
          error={role.isError || query.kind === "forbidden"
            ? "forbidden"
            : query.kind === "notFound"
            ? "not_found"
            : query.kind === "offlineEmpty"
            ? "offline"
            : query.kind === "error"
            ? "error"
            : null}
          onRetry={() => void query.refetch()}
        />
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({ host: { backgroundColor: canvas.discover } });
