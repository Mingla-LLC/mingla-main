import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ExpoRouter from "expo-router";

import { AudienceCard, ManualGroupCard } from "../marketing/AudienceCard";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
import { createRetryableLazyErrorBoundary, RetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import { useShareNetworkState } from "../ui/useShareNetworkState";
import {
  accent,
  canvas,
  glass,
  radius,
  shadows,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { capturePeople } from "../../features/people/peopleAnalytics";
import { useAudienceList } from "../../hooks/marketing/useAudienceList";
import { useBrandPeople } from "../../hooks/marketing/useBrandPeople";
import {
  useBrandPersonConflicts,
  useResolveBrandPersonConflict,
} from "../../hooks/marketing/useBrandPersonConflicts";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import {
  ensureBrandBuyersAudience,
  ensureEventBuyersAudience,
} from "../../services/marketing/marketingCampaignService";
import { PeopleServiceError } from "../../services/peopleService";
import type { AudienceListEntry, ManualGroupSummary } from "../../types/marketing";
import type {
  AddBrandPersonResult,
  BrandPersonSummary,
  ConflictResolution,
} from "../../types/people";
import { ConflictReviewSheet, ConflictReviewStrip } from "./ConflictReviewSheet";
import {
  BookSheet,
  DependencyStatus,
  GroupsSheet,
  PeopleBlock,
  PeopleRow,
} from "./PeoplePrimitives";
import { useMarketingBrandSwitcher } from "./MarketingBrandSwitcherContext";

// The create/add workflow includes contact-import parsing and is only needed
// after an operator opens it. Keeping this boundary here prevents Metro from
// hoisting the workflow shared with group detail into every web boot.
const loadManualGroupFlow = async () => {
  const module = await import("./ManualGroupFlow");
  return { default: module.ManualGroupFlow };
};
const ManualGroupFlow = createRetryableLazyErrorBoundary(loadManualGroupFlow, {
  accessibilityLiveRegion: "polite",
  loadingLabel: "Opening group setup…",
});
const loadManualGroupsLoader = async () => {
  const module = await import("./ManualGroupsLoader");
  return { default: module.ManualGroupsLoader };
};
const loadAddPersonSheet = async () => {
  const module = await import("./AddPersonSheet");
  return { default: module.AddPersonSheet };
};

// A few older render harnesses predate Expo Router search params. Select the
// stable hook once at module load so production always uses Expo Router while
// those harnesses keep a hook-shaped, empty parameter source.
const usePeopleRouteParams: typeof ExpoRouter.useLocalSearchParams =
  typeof ExpoRouter.useLocalSearchParams === "function"
    ? ExpoRouter.useLocalSearchParams
    : (() => ({})) as typeof ExpoRouter.useLocalSearchParams;


const contacts = (count: number | null): string | undefined =>
  count === null ? undefined : `${count} ${count === 1 ? "contact" : "contacts"}`;

function PageHeading(): React.ReactElement {
  return (
    <Text accessibilityRole="header" style={styles.screenReaderHeading}>
      People
    </Text>
  );
}

function PeoplePageSkeleton({
  isWideDesktop,
  width,
}: {
  isWideDesktop: boolean;
  width: number;
}): React.ReactElement {
  const actionColumns = width > 0 && width < 352 ? 1 : isWideDesktop ? 3 : 2;
  const actionCell = {
    flexBasis: actionColumns === 1 ? "100%" : actionColumns === 2 ? "48%" : 0,
    flexGrow: 1,
    minWidth: 0,
  } as const;
  const lastActionCell = {
    ...actionCell,
    flexBasis: actionColumns === 2 ? "100%" : actionCell.flexBasis,
  } as const;
  return (
    <ScrollView
      accessibilityLiveRegion="polite"
      contentContainerStyle={styles.loadingHost}
      style={styles.loadingScroll}
      testID="people-page-skeleton"
    >
      <PageHeading />
      <View style={[styles.workspaceRow, isWideDesktop ? styles.workspaceWide : styles.workspaceCompact]}>
        <View style={isWideDesktop ? styles.bookColumnWide : styles.compactColumn}>
          <View style={[styles.skeletonSurface, styles.skeletonBookSurface]}>
            <Skeleton width={112} height={20} />
            <Skeleton width={220} height={14} />
            <View style={styles.skeletons}>
              {[0, 1, 2].map((row) => (
                <View key={row} style={styles.skeletonRow}>
                  <Skeleton width={40} height={40} radius="full" />
                  <View style={styles.skeletonCopy}>
                    <Skeleton width="48%" height={16} />
                    <Skeleton width="68%" height={12} />
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.skeletonActions}>
              {[0, 1, 2].map((action) => (
                <View key={action} style={action === 2 ? lastActionCell : actionCell}>
                  <Skeleton width="100%" height={44} radius="full" />
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={isWideDesktop ? styles.groupsColumnWide : styles.compactColumn}>
          <View style={[styles.skeletonSurface, styles.skeletonGroupsSurface]}>
            <Skeleton width={96} height={20} />
            <Skeleton width={220} height={14} />
            <View style={styles.skeletons}>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} width="100%" height={76} radius="lg" />
              ))}
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

export function PeoplePage(): React.ReactElement {
  const router = ExpoRouter.useRouter();
  const routeParams = usePeopleRouteParams<{
    review?: string | string[];
  }>();
  const brand = useCurrentBrand();
  const role = useCurrentBrandRole(brand?.id ?? null);
  const { isAuthReady, user } = useAuth();
  const online = useShareNetworkState();
  const openBrandSwitcher = useMarketingBrandSwitcher();
  const { isWideDesktop, width } = useResponsiveLayout();
  const fabOffset = useStickyFooterOffset();
  const actionColumns = width > 0 && width < 352 ? 1 : isWideDesktop ? 3 : 2;
  const regularActionCell = {
    flexBasis: actionColumns === 1 ? "100%" : actionColumns === 2 ? "48%" : 0,
    flexGrow: 1,
    minWidth: 0,
  } as const;
  const seeAllActionCell = {
    flexBasis: actionColumns === 1 || actionColumns === 2 ? "100%" : 0,
    flexGrow: 1,
    minWidth: 0,
  } as const;
  const roleResolved = !role.isLoading && !role.isError;
  const authorized =
    isAuthReady && user !== null && roleResolved && role.accepted && role.rank >= 20;
  const book = useBrandPeople(
    brand?.id ?? null,
    null,
    roleResolved,
    role.accepted,
    role.rank,
    online,
  );
  const [bookSearch, setBookSearch] = React.useState("");
  const sheetBook = useBrandPeople(
    brand?.id ?? null,
    bookSearch || null,
    roleResolved,
    role.accepted,
    role.rank,
    online,
  );
  const groups=useAudienceList(user?.id??null);
  const manualFlag = useFeatureFlag("manual_contact_groups_v1");
  const manualEnabled = authorized && manualFlag.data === true;
  const [manualGroupsState, setManualGroupsState] = React.useState<{
    brandId: string | null;
    data: ManualGroupSummary[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  }>({ brandId: null, data: [], isLoading: true, isError: false, refetch: async () => undefined });
  const receiveManualGroups = React.useCallback((state: typeof manualGroupsState): void => {
    setManualGroupsState(state);
  }, []);
  const manualGroups = manualEnabled && manualGroupsState.brandId === brand?.id
    ? manualGroupsState
    : { ...manualGroupsState, data: [], isLoading: manualEnabled, isError: false };
  // #2305 — the identity-conflict review queue. Read at rank 20; the RPC gates
  // resolving at rank 50 and reports it per row as `canResolve`.
  const conflicts = useBrandPersonConflicts(
    brand?.id ?? null,
    roleResolved,
    role.accepted,
    role.rank,
    online,
  );
  const resolveConflict = useResolveBrandPersonConflict(brand?.id ?? "");
  const flag = useFeatureFlag("contact_import_v1");
  const importEnabled=authorized&&online&&!flag.isPending&&!flag.isFetching&&!flag.isError&&flag.data===true;
  const [bookOpen, setBookOpen] = React.useState(false);
  const [groupsOpen, setGroupsOpen] = React.useState(false);
  const [createGroupOpen, setCreateGroupOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [conflictOpen, setConflictOpen] = React.useState(false);
  const [conflictsResolved, setConflictsResolved] = React.useState(0);
  const [creatingKey, setCreatingKey] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const consumedReviewSignalRef = React.useRef(false);
  const modalOpen = bookOpen || groupsOpen || addOpen || conflictOpen || createGroupOpen;

  React.useEffect(() => {
    capturePeople("people_page_viewed", { surface: "page" });
  }, []);
  React.useEffect(() => {
    setBookOpen(false);
    setGroupsOpen(false);
    setAddOpen(false);
    setConflictOpen(false);
    setCreateGroupOpen(false);
    setBookSearch("");
  }, [brand?.id, isAuthReady, role.accepted, role.rank]);
  React.useEffect(() => {
    if (book.kind==="forbidden"||sheetBook.kind==="forbidden") {
      setBookOpen(false);
      setGroupsOpen(false);
      setAddOpen(false);
      setConflictOpen(false);
      setBookSearch("");
    }
  }, [book.kind, sheetBook.kind]);
  React.useEffect(() => {
    if (consumedReviewSignalRef.current || routeParams.review === undefined) return;
    const consumeSignal = (): void => {
      consumedReviewSignalRef.current = true;
      router.replace("/(tabs)/marketing/people" as never);
    };
    if (routeParams.review !== "conflicts") {
      consumeSignal();
      return;
    }
    if (!isAuthReady || role.isLoading) return;
    if (user === null || role.isError || !role.accepted || role.rank < 20) {
      consumeSignal();
      return;
    }
    if (
      conflicts.kind === "authLoading" || conflicts.kind === "roleLoading" ||
      conflicts.kind === "loading" || conflicts.kind === "refreshing"
    ) return;
    if (
      conflicts.kind === "success" && online && conflicts.openCount > 0 &&
      conflicts.rows.length > 0
    ) {
      consumedReviewSignalRef.current = true;
      capturePeople("people_conflict_queue_opened", { surface: "page" });
      setConflictOpen(true);
      router.replace("/(tabs)/marketing/people" as never);
      return;
    }
    consumeSignal();
  }, [
    conflicts.kind,
    conflicts.openCount,
    conflicts.rows.length,
    isAuthReady,
    online,
    role.accepted,
    role.isError,
    role.isLoading,
    role.rank,
    routeParams.review,
    router,
    user,
  ]);
  React.useEffect(() => {
    if (!flag.isPending && !flag.isFetching) {
      capturePeople("people_dependency_state_viewed", {
        surface: "page",
        dependency: "import",
        dependencyState: flag.isError || flag.data !== true ? "unavailable" : "available",
      });
    }
  }, [flag.data, flag.isError, flag.isFetching, flag.isPending]);

  const searchBook = React.useCallback((value: string) => {
    setBookSearch(value);
    if (value !== "") {
      capturePeople("people_book_search_used", { surface: "book_sheet", hasSearch: true });
    }
  }, []);
  const openPerson = (person: BrandPersonSummary): void => {
    router.push(`/(tabs)/people/${person.personId}` as never);
  };
  const openManualGroup = (entry: ManualGroupSummary): void => {
    capturePeople("manual_group_viewed", { surface: groupsOpen ? "groups_sheet" : "page", groupId: entry.groupId });
    router.push(`/(tabs)/people/groups/${entry.groupId}` as never);
  };
  const openGroup = async (entry: AudienceListEntry): Promise<void> => {
    capturePeople("people_group_opened", {
      surface: groupsOpen ? "groups_sheet" : "page",
      groupKind: entry.kind,
    });
    const kind = entry.kind === "brand_buyers" ? "brand" : "event";
    const target = entry.kind === "brand_buyers" ? entry.brand_id : entry.event_id;
    if (target === null) return;
    if (entry.audience_id !== null) {
      router.push(`/marketing/campaigns/compose?audience=${kind}:${target}` as never);
      return;
    }
    if (user === null) return;
    setCreatingKey(entry.client_key);
    try {
      if (entry.kind === "brand_buyers") {
        await ensureBrandBuyersAudience({ account_id: user.id, brand_id: entry.brand_id });
      } else {
        await ensureEventBuyersAudience({
          account_id: user.id,
          brand_id: entry.brand_id,
          event_id: target,
        });
      }
      router.push(`/marketing/campaigns/compose?audience=${kind}:${target}` as never);
    } catch {
      setToast({ message: "Couldn't open this group. Try again in a moment.", kind: "error" });
    } finally {
      setCreatingKey(null);
    }
  };
  const addDone = (result: AddBrandPersonResult): void => {
    if (result.outcome === "review") {
      capturePeople("people_add_review_required", { surface: "add_sheet", result: "review" });
      return;
    }
    capturePeople("people_add_completed", { surface: "add_sheet", result: result.outcome });
    setToast({
      message:
        result.outcome === "created"
          ? "Person added."
          : result.outcome === "updated"
            ? "Existing person updated."
            : "This person is already in your book.",
      kind: "success",
    });
  };
  const openNewCampaign = React.useCallback((): void => {
    router.push("/marketing/campaigns/compose" as never);
  }, [router]);

  if (brand === null) {
    return (
      <View style={styles.center}>
        <PageHeading />
        <EmptyState
          title="Choose a brand to view People."
          description="Select or create a brand to continue."
          cta={{ label: "Choose brand", onPress: openBrandSwitcher, variant: "secondary" }}
        />
      </View>
    );
  }
  if (role.isError) {
    return (
      <View style={styles.center}>
        <PageHeading />
        <EmptyState
          title="You don’t have access to People."
          description="A marketing manager or brand admin can open this page."
        />
      </View>
    );
  }
  if (
    !isAuthReady ||
    role.isLoading ||
    book.kind === "authLoading" ||
    book.kind === "roleLoading"
  ) {
    return <PeoplePageSkeleton isWideDesktop={isWideDesktop} width={width} />;
  }
  if (book.kind === "forbidden" || sheetBook.kind === "forbidden") {
    return (
      <View style={styles.center}>
        <PageHeading />
        <EmptyState
          title="You don’t have access to People."
          description="A marketing manager or brand admin can open this page."
        />
      </View>
    );
  }

  const preview = book.rows.slice(0, 3);
  return (
    <View style={styles.host}>
      {manualEnabled ? <RetryableLazyErrorBoundary loader={loadManualGroupsLoader} accessibilityLiveRegion="polite" loadingLabel="Loading Manual groups…" componentProps={{ brandId: brand.id, onState: receiveManualGroups }} style={styles.manualGroupsLoader} /> : null}
      <View
        accessibilityElementsHidden={modalOpen}
        importantForAccessibility={modalOpen ? "no-hide-descendants" : "auto"}
        pointerEvents={modalOpen ? "none" : "auto"}
        style={styles.workspace}
        testID="people-workspace"
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <PageHeading />
          <View
            testID="people-workspace-row"
            style={[
              styles.workspaceRow,
              isWideDesktop ? styles.workspaceWide : styles.workspaceCompact,
            ]}
          >
            <View
              testID="people-book-column"
              style={isWideDesktop ? styles.bookColumnWide : styles.compactColumn}
            >
              <PeopleBlock
                title="Your book"
                caption="People who gave your brand their details."
                count={
                  book.kind === "success" || book.kind === "refreshing"
                    ? contacts(book.bookTotal)
                    : undefined
                }
                elevated
                testID="people-book-block"
              >
                <ConflictReviewStrip
                  kind={conflicts.kind}
                  openCount={conflicts.openCount}
                  oldestCreatedAt={conflicts.rows[0]?.createdAt ?? null}
                  stacked={actionColumns === 1}
                  onReview={() => {
                    capturePeople("people_conflict_queue_opened", { surface: "page" });
                    setConflictOpen(true);
                  }}
                />
                {book.kind==="authLoading"||book.kind==="roleLoading"||book.kind==="loading" ? (
                  <View accessibilityLiveRegion="polite" style={styles.skeletons}>
                    {[0, 1, 2].map((row) => (
                      <View key={row} style={styles.skeletonRow}>
                        <Skeleton width={40} height={40} radius="full" />
                        <View style={styles.skeletonCopy}>
                          <Skeleton width="48%" height={16} />
                          <Skeleton width="68%" height={12} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : book.kind==="error"||book.kind==="offlineEmpty" ? (
                  <EmptyState
                    title={
                      book.kind === "offlineEmpty"
                        ? "You’re offline. Connect to load your book."
                        : "Couldn’t load your book."
                    }
                    description={
                      book.kind === "error" ? "Check your connection and try again." : undefined
                    }
                    cta={
                      book.kind === "error"
                        ? {
                            label: "Try again",
                            onPress: async (): Promise<void> => {
                              await book.refetch();
                            },
                            variant: "secondary",
                          }
                        : undefined
                    }
                  />
                ) : preview.length === 0 ? (
                  <EmptyState
                    title="No one is in your book yet."
                    description="Add a person, import contacts, or Mingla will add customers as they book."
                  />
                ) : (
                  <View style={book.kind === "refreshing" ? styles.refreshing : undefined}>
                    {book.kind === "refreshing" ? (
                      <Text style={styles.status}>Updating…</Text>
                    ) : null}
                    {book.kind === "offlineStale" ? (
                      <Text style={styles.status}>Offline — showing saved contacts.</Text>
                    ) : null}
                    {book.kind === "staleError" ? (
                      <Text style={styles.status}>Couldn’t update — showing saved contacts.</Text>
                    ) : null}
                    {preview.map((person) => (
                      <PeopleRow
                        key={person.personId}
                        person={person}
                        onPress={() => openPerson(person)}
                      />
                    ))}
                  </View>
                )}
                <View style={[styles.actions, isWideDesktop ? styles.actionsWide : undefined]}>
                  <View style={regularActionCell}>
                    <Button
                      label="Add"
                      leadingIcon="plus"
                      fullWidth
                      accentColor={accent.warm}
                      disabled={!authorized || !online}
                      onPress={() => {
                        capturePeople("people_add_opened", { surface: "page" });
                        setAddOpen(true);
                      }}
                    />
                  </View>
                  <View style={regularActionCell}>
                    {importEnabled ? (
                      <Button
                        label="Import"
                        leadingIcon="upload"
                        variant="secondary"
                        fullWidth
                        onPress={() => {
                          capturePeople("people_import_selected", {
                            surface: "page",
                            dependency: "import",
                            dependencyState: "available",
                          });
                          router.push(
                            `/(tabs)/people/import?returnTo=marketingPeople&brandId=${brand.id}` as never,
                          );
                        }}
                      />
                    ) : (
                      <DependencyStatus
                        status="Import unavailable"
                        body="Contact import is not available yet."
                        testID="people-import-unavailable"
                      />
                    )}
                  </View>
                  <View style={seeAllActionCell}>
                    <Button
                      label="See all"
                      trailingIcon="chevR"
                      variant="secondary"
                      fullWidth
                      disabled={!book.hasResolved || book.kind === "error"}
                      onPress={() => {
                        capturePeople("people_book_opened", { surface: "book_sheet" });
                        setBookOpen(true);
                      }}
                    />
                  </View>
                </View>
              </PeopleBlock>
            </View>
            <View
              testID="people-groups-column"
              style={isWideDesktop ? styles.groupsColumnWide : styles.compactColumn}
            >
              <PeopleBlock
                title="Groups"
                caption={manualEnabled ? "Organize people for focused campaigns." : "Buyer groups that update automatically."}
                testID="people-groups-block"
              >
                {manualEnabled ? <View style={styles.createGroupRow}><Button label="Create group" leadingIcon="plus" accentColor={accent.warm} fullWidth={width > 0 && width < 352} disabled={!online} onPress={() => { capturePeople("manual_group_create_started", { surface: "page" }); setCreateGroupOpen(true); }} /></View> : null}
                {(!groups.hasResolved&&!groups.isError) || (manualEnabled && manualGroups.isLoading) ? (
                  <View testID="people-groups-skeleton" style={styles.skeletons}>
                    {[0, 1, 2].map((row) => (
                      <Skeleton key={row} width="100%" height={76} radius="lg" />
                    ))}
                  </View>
                ) : groups.isError || (manualEnabled && manualGroups.isError) ? (
                  <EmptyState
                    title="Couldn’t load groups."
                    cta={{
                      label: "Try again",
                      onPress: async (): Promise<void> => {
                        await Promise.all([groups.refetch(), ...(manualEnabled ? [manualGroups.refetch()] : [])]);
                      },
                      variant: "secondary",
                    }}
                  />
                ) : groups.entries.length === 0 && (manualGroups.data?.length ?? 0) === 0 ? (
                  manualEnabled ? <View style={styles.emptyGroup}><EmptyState title="No groups yet." description="Create a group to organize people for campaigns." /><Button label="Create group" leadingIcon="plus" accentColor={accent.warm} onPress={() => setCreateGroupOpen(true)} /></View> : <EmptyState title="No buyer groups yet." />
                ) : (
                  <>
                    {(manualGroups.data ?? []).slice(0, 3).map((entry) => <ManualGroupCard key={entry.groupId} group={entry} onPress={openManualGroup} />)}
                    {groups.entries.slice(0, Math.max(0, 3 - (manualGroups.data?.length ?? 0))).map((entry) => {
                      const reach = groups.reach.has(entry.client_key)
                        ? groups.reach.get(entry.client_key)
                        : undefined;
                      return (
                        <AudienceCard
                          key={entry.client_key}
                          entry={entry}
                          reach={reach}
                          onPress={openGroup}
                          isCreating={creatingKey === entry.client_key}
                          showAutomaticKind={manualEnabled}
                        />
                      );
                    })}
                    {groups.entries.length + (manualGroups.data?.length ?? 0) > 3 ? (
                      <Button
                        label="See all"
                        trailingIcon="chevR"
                        variant="secondary"
                        onPress={() => setGroupsOpen(true)}
                      />
                    ) : null}
                  </>
                )}
              </PeopleBlock>
            </View>
          </View>
        </ScrollView>
        <Pressable
          accessibilityLabel="New campaign"
          accessibilityRole="button"
          onPress={openNewCampaign}
          testID="people-new-campaign"
          style={({ pressed }) => [
            styles.fab,
            { bottom: fabOffset },
            pressed ? styles.fabPressed : null,
          ]}
        >
          <Icon name="plus" size={24} color={text.primary} />
          <Text style={styles.fabLabel}>New campaign</Text>
        </Pressable>
      </View>
      <BookSheet
        visible={bookOpen}
        onClose={() => setBookOpen(false)}
        query={sheetBook}
        onSelect={openPerson}
        onSearch={searchBook}
      />
      <GroupsSheet
        visible={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        entries={groups.entries}
        manualGroups={manualGroups.data ?? []}
        canCreate={manualEnabled}
        reach={groups.reach}
        creatingKey={creatingKey}
        onPress={openGroup}
        onPressManual={openManualGroup}
        onCreate={() => { setGroupsOpen(false); setCreateGroupOpen(true); capturePeople("manual_group_create_started", { surface: "groups_sheet" }); }}
      />
      {brand && createGroupOpen ? <ManualGroupFlow visible brandId={brand.id} online={online} onAddPerson={() => setAddOpen(true)} onClose={() => setCreateGroupOpen(false)} onCompleted={(created: ManualGroupSummary) => { setCreateGroupOpen(false); openManualGroup(created); }} /> : null}
      <ConflictReviewSheet
        visible={conflictOpen}
        onClose={() => {
          setConflictOpen(false);
          // No toast while the sheet is open: `Sheet` renders at the OS-level
          // root on native, so the page's Toast would sit behind it. One summary
          // on close beats six toasts anyway.
          if (conflictsResolved > 0) {
            setToast({
              message: `${conflictsResolved} ${conflictsResolved === 1 ? "buyer" : "buyers"} added to your book.`,
              kind: "success",
            });
            setConflictsResolved(0);
          }
        }}
        kind={conflicts.kind}
        rows={conflicts.rows}
        openCount={conflicts.openCount}
        online={online}
        onRetry={() => {
          void conflicts.refetch();
        }}
        onResolvedCountChange={setConflictsResolved}
        onResolve={async (input: {
          conflictIds: string[];
          resolution: ConflictResolution;
          winnerPersonId: string | null;
        }) => {
          try {
            const clientRequestId = await import("./AddPersonSheet").then((module) => module.createPeopleRequestId());
            const result = await resolveConflict.mutateAsync({
              brandId: brand.id,
              conflictIds: input.conflictIds,
              resolution: input.resolution,
              winnerPersonId: input.winnerPersonId,
              clientRequestId,
            });
            capturePeople("people_conflict_resolved", {
              surface: "conflict_sheet",
              resolution: input.resolution,
              candidateCount: input.conflictIds.length,
            });
            return { personId: result.personId, mergedPersonIds: result.mergedPersonIds };
          } catch (error) {
            capturePeople("people_conflict_resolve_failed", {
              surface: "conflict_sheet",
              errorCode: error instanceof PeopleServiceError ? error.code : "people_unknown",
            });
            throw error;
          }
        }}
      />
      {addOpen ? <RetryableLazyErrorBoundary loader={loadAddPersonSheet} accessibilityLiveRegion="polite" loadingLabel="Opening Add person…" componentProps={{ visible: true, onClose: () => setAddOpen(false), brandId: brand.id, online, authorized, onCompleted: addDone }} /> : null}
      <View style={styles.toast}>
        <Toast
          visible={toast !== null}
          kind={toast?.kind ?? "success"}
          message={toast?.message ?? ""}
          onDismiss={() => setToast(null)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  workspace: {
    flex: 1,
  },
  manualGroupsLoader: {
    flex: 0,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 120,
  },
  screenReaderHeading: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  center: {
    flex: 1,
    backgroundColor: canvas.discover,
    justifyContent: "center",
  },
  loadingHost: {
    flexGrow: 1,
    backgroundColor: canvas.discover,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  loadingScroll: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  workspaceRow: {
    gap: spacing.lg,
  },
  workspaceWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  workspaceCompact: {
    flexDirection: "column",
  },
  bookColumnWide: {
    flexBasis: 0,
    flexGrow: 5,
    minWidth: 0,
  },
  groupsColumnWide: {
    flexBasis: 0,
    flexGrow: 3,
    minWidth: 0,
  },
  compactColumn: {
    width: "100%",
    minWidth: 0,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionsWide: {
    minHeight: 64,
    alignItems: "center",
  },
  createGroupRow: { alignItems: "flex-end" },
  emptyGroup: { alignItems: "center", gap: spacing.sm },
  skeletonSurface: {
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  skeletonBookSurface: {
    borderRadius: radius.xl,
    backgroundColor: glass.tint.profileElevated,
    borderColor: glass.border.profileElevated,
    ...shadows.glassCardElevated,
  },
  skeletonGroupsSurface: {
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    ...shadows.glassCardBase,
  },
  skeletonActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  skeletons: {
    gap: spacing.sm,
  },
  skeletonRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  skeletonCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  refreshing: {
    opacity: 0.72,
  },
  status: {
    ...typography.bodySm,
    color: text.tertiary,
  },
  fab: {
    position: "absolute",
    right: spacing.md,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: "rgba(235, 120, 37, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: text.primary,
  },
  toast: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    zIndex: 100,
  },
});
