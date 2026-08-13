import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { AudienceCard } from "../marketing/AudienceCard";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
import { useShareNetworkState } from "../ui/useShareNetworkState";
import {
  accent,
  canvas,
  durations,
  easings,
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
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import {
  ensureBrandBuyersAudience,
  ensureEventBuyersAudience,
} from "../../services/marketing/marketingCampaignService";
import type { AudienceListEntry } from "../../types/marketing";
import type { AddBrandPersonResult, BrandPersonSummary } from "../../types/people";
import { AddPersonSheet } from "./AddPersonSheet";
import {
  BookSheet,
  DependencyStatus,
  GroupsSheet,
  PeopleBlock,
  PeopleRow,
} from "./PeoplePrimitives";
import { useMarketingBrandSwitcher } from "./MarketingBrandSwitcherContext";

const FAB_HEIGHT = 48;
const FAB_BASE_BACKGROUND = "rgba(235, 120, 37, 0.42)";
const FAB_HOVER_BACKGROUND = "rgba(235, 120, 37, 0.52)";

const contacts = (count: number | null): string | undefined =>
  count === null ? undefined : `${count} ${count === 1 ? "contact" : "contacts"}`;

const useWebReducedMotion = (): boolean => {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mql = (
      globalThis as unknown as {
        matchMedia?: (query: string) => {
          matches: boolean;
          addEventListener?: (type: string, listener: () => void) => void;
          removeEventListener?: (type: string, listener: () => void) => void;
        };
      }
    ).matchMedia?.("(prefers-reduced-motion: reduce)");
    if (mql === undefined) return;
    setReduced(mql.matches);
    const onChange = (): void => setReduced(mql.matches);
    mql.addEventListener?.("change", onChange);
    return (): void => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
};

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
  const router = useRouter();
  const brand = useCurrentBrand();
  const role = useCurrentBrandRole(brand?.id ?? null);
  const { isAuthReady, user } = useAuth();
  const online = useShareNetworkState();
  const openBrandSwitcher = useMarketingBrandSwitcher();
  const { isWideDesktop, width } = useResponsiveLayout();
  const reduceMotion = useWebReducedMotion();
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
  const flag = useFeatureFlag("contact_import_v1");
  const importEnabled=authorized&&online&&!flag.isPending&&!flag.isFetching&&!flag.isError&&flag.data===true;
  const [bookOpen, setBookOpen] = React.useState(false);
  const [groupsOpen, setGroupsOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [creatingKey, setCreatingKey] = React.useState<string | null>(null);
  const [fabHovered, setFabHovered] = React.useState(false);
  const [fabFocused, setFabFocused] = React.useState(false);
  const [toast, setToast] = React.useState<{
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const modalOpen = bookOpen || groupsOpen || addOpen;

  React.useEffect(() => {
    capturePeople("people_page_viewed", { surface: "page" });
  }, []);
  React.useEffect(() => {
    setBookOpen(false);
    setGroupsOpen(false);
    setAddOpen(false);
    setBookSearch("");
  }, [brand?.id, isAuthReady, role.accepted, role.rank]);
  React.useEffect(() => {
    if (book.kind==="forbidden"||sheetBook.kind==="forbidden") {
      setBookOpen(false);
      setGroupsOpen(false);
      setAddOpen(false);
      setBookSearch("");
    }
  }, [book.kind, sheetBook.kind]);
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
      <View
        accessibilityElementsHidden={modalOpen}
        importantForAccessibility={modalOpen ? "no-hide-descendants" : "auto"}
        pointerEvents={modalOpen ? "none" : "auto"}
        style={styles.workspace}
        testID="people-workspace"
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: fabOffset + FAB_HEIGHT + spacing.md },
          ]}
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
                caption="Buyer groups that update automatically."
                testID="people-groups-block"
              >
                {!groups.hasResolved&&!groups.isError ? (
                  <View testID="people-groups-skeleton" style={styles.skeletons}>
                    {[0, 1, 2].map((row) => (
                      <Skeleton key={row} width="100%" height={76} radius="lg" />
                    ))}
                  </View>
                ) : groups.isError ? (
                  <EmptyState
                    title="Couldn’t load groups."
                    cta={{
                      label: "Try again",
                      onPress: async (): Promise<void> => {
                        await groups.refetch();
                      },
                      variant: "secondary",
                    }}
                  />
                ) : groups.entries.length === 0 ? (
                  <EmptyState title="No buyer groups yet." />
                ) : (
                  <>
                    {groups.entries.slice(0, 3).map((entry) => {
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
                        />
                      );
                    })}
                    {groups.entries.length > 3 ? (
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
          onBlur={() => setFabFocused(false)}
          onFocus={() => setFabFocused(true)}
          onHoverIn={() => setFabHovered(true)}
          onHoverOut={() => setFabHovered(false)}
          onPress={openNewCampaign}
          testID="people-new-campaign"
          style={({ pressed }) => [
            styles.fab,
            { bottom: fabOffset },
            Platform.OS === "web"
              ? ({
                  transitionDuration: reduceMotion ? "0ms" : `${durations.fast}ms`,
                  transitionTimingFunction: pressed ? easings.press : easings.out,
                } as never)
              : undefined,
            fabHovered && Platform.OS === "web" ? styles.fabHovered : undefined,
            fabFocused && Platform.OS === "web" ? styles.fabFocused : undefined,
            pressed ? styles.fabPressed : undefined,
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
        reach={groups.reach}
        creatingKey={creatingKey}
        onPress={openGroup}
      />
      <AddPersonSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        brandId={brand.id}
        online={online}
        authorized={authorized}
        onCompleted={addDone}
      />
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
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
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
    minHeight: FAB_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: FAB_BASE_BACKGROUND,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    zIndex: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 6,
    ...Platform.select({
        web: {
          cursor: "pointer",
          transitionProperty: "background-color, border-color, opacity",
          transitionTimingFunction: easings.out,
      },
      default: {},
    }),
  },
  fabHovered: {
    backgroundColor: FAB_HOVER_BACKGROUND,
  },
  fabFocused: {
    outlineColor: accent.warm,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: 2,
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
