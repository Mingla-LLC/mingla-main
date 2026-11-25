/**
 * #4490 P2-4 — Offers (`of`, `of-empty`, `of-new`, `of-pause`, `of-paused`,
 * `ph-offers`): everything guests can buy at this venue.
 *
 * Tabs by kind with counts, a list (table on wide web, rows on a phone) with
 * price, when, today's sales and status, and a row menu (Edit, Pause/Resume,
 * Archive). New offer opens a picker of the six kinds: Entry opens the Entry
 * editor; Table reservations goes where tables are run; kinds that are not
 * built yet are shown disabled with a plain reason (no dead taps). The editor
 * opens in place on web and as a pushed screen on the native apps.
 */
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useVenueDay } from "../../../../hooks/useVenueDay";
import { useVenueEditAccess } from "../../../../hooks/useVenueEditAccess";
import { useSetVenueFeature, useVenueFeatures } from "../../../../hooks/useVenueFeatures";
import { useVenueListing } from "../../../../hooks/useVenueListings";
import { useManageVenueOffer, useVenueOffers } from "../../../../hooks/useVenueOffers";
import { useVenueMembershipPlans } from "../../../../hooks/useVenueMembershipPlans";
import { planStatusWords } from "../members/membersModel";
import { duplicateVenueOffer, toVenueOfferError } from "../../../../services/venueOffersService";
import { venueFeatureKeys } from "../../../../hooks/venueFeatureKeys";
import type { VenueOffer, VenueOfferKind } from "../../../../types/venueOffers";
import type { VenueModule } from "../../../../types/venueReservation";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { GlassCard } from "../../../ui/GlassCard";
import { Icon } from "../../../ui/Icon";
import { IconChrome } from "../../../ui/IconChrome";
import { Menu, type MenuAnchor } from "../../../ui/Menu";
import { weekdaysSummary } from "../../../ui/fieldModels";
import { Modal } from "../../../ui/Modal";
import { OptionCard } from "../../../ui/OptionCard";
import { Pill } from "../../../ui/Pill";
import { Skeleton } from "../../../ui/Skeleton";
import { Tabs } from "../../../ui/Tabs";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import { venueScrollBottomPad } from "../../venueShellScroll";
import { EntryEditor } from "./EntryEditor";
import { HireEditor } from "./HireEditor";
import { HourEditor } from "./HourEditor";
import { PackageEditor } from "./PackageEditor";
import {
  NEW_OFFER_CARDS,
  OFFER_KIND_LABEL,
  money,
  OFFER_STATUS,
  kindLine,
  offerErrorCopy,
  optionSummary,
  priceColumn,
  splitOfferCards,
  whenColumn,
  type NewOfferCard,
} from "./offersModel";

// OptionCard is row-only (flexBasis 0); stacked in a column it must size to its content.
const COLUMN_OPTION_CARD = { flexBasis: "auto" as const, flexGrow: 0 };

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});
const LazyToast = React.lazy(async () => {
  const mod = await import("../../../ui/Toast");
  return { default: mod.Toast };
});

type KindTab = "all" | VenueOfferKind;

export interface VenueOffersModuleProps {
  brandId: string | null;
  venueId: string | null;
  /** Open another module of the venue workspace (Settings, Reservations…). */
  onOpenModule?: (module: VenueModule) => void;
  /** `&item=<offerId>` deep link: open that offer's editor on arrival. */
  initialOfferId?: string | null;
  /** #4490 P6 — open Members on its plans, or straight into a new plan. */
  onOpenMembers?: (view: "plans" | "new_plan") => void;
}

type EditorKind = "entry" | "group_package" | "private_hire" | "by_the_hour";
type Editing = { offerId: string | null; kind: EditorKind } | null;
type Confirm = { action: "pause" | "archive"; offer: VenueOffer } | null;

export const VenueOffersModule = forwardRef<VenueModuleLeaveHandle, VenueOffersModuleProps>(function VenueOffersModule(
  { brandId, venueId, onOpenModule, initialOfferId = null, onOpenMembers },
  ref,
): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bottomPad = venueScrollBottomPad(insets.bottom);
  const currency = useBrandCurrency(brandId);
  const offersQuery = useVenueOffers(brandId, venueId);
  const queryClient = useQueryClient();
  const dayQuery = useVenueDay(brandId, venueId);
  const featuresQuery = useVenueFeatures(brandId, venueId);
  const setFeature = useSetVenueFeature(brandId, venueId);
  const venueQuery = useVenueListing(venueId);
  const access = useVenueEditAccess(brandId, venueId);
  const manageOffer = useManageVenueOffer(brandId, venueId);

  const [tab, setTab] = useState<KindTab>("all");
  const [editing, setEditing] = useState<Editing>(initialOfferId !== null ? { offerId: initialOfferId, kind: "entry" } : null);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState<{ offer: VenueOffer; anchor: MenuAnchor | null } | null>(null);
  // #4490 N5: on desktop the row menu opens as a popover under its "…" button.
  const moreRefs = useRef(new Map<string, View>());
  const openRowMenu = useCallback((offer: VenueOffer): void => {
    const node = moreRefs.current.get(offer.id);
    if (node === undefined || typeof node.measureInWindow !== "function") {
      setMenu({ offer, anchor: null });
      return;
    }
    node.measureInWindow((x, y, width, height) =>
      setMenu({ offer, anchor: width > 0 ? { x, y, width, height } : null }),
    );
  }, []);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [featureError, setFeatureError] = useState<string | null>(null);
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

  const venueName = venueQuery.data?.name ?? "your venue";
  const state = offersQuery.data;
  const offers = useMemo(() => state?.offers ?? [], [state?.offers]);
  const entryOn = featuresQuery.data?.features.entry.enabled === true;
  const [showMoreCards, setShowMoreCards] = useState(false);
  const tablesOn = featuresQuery.data?.features.table_reservations.enabled === true;
  const packagesOn = featuresQuery.data?.features.group_packages.enabled === true;
  const hireOn = featuresQuery.data?.features.private_hire.enabled === true;
  const hourOn = featuresQuery.data?.features.by_the_hour.enabled === true;
  const membersOn = featuresQuery.data?.features.memberships.enabled === true;
  const plansQuery = useVenueMembershipPlans(brandId, venueId);
  const livePlans = useMemo(() => (plansQuery.data?.plans ?? []).filter((p) => p.status !== "archived"), [plansQuery.data?.plans]);
  const activeSpaces = featuresQuery.data?.activeSpaceCount ?? 0;
  const canEdit = access.canEditSpaces;
  const soldToday = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of dayQuery.data?.offers ?? []) map[o.offerId] = o.sold;
    return map;
  }, [dayQuery.data?.offers]);

  const counts = useMemo(() => {
    const c: Partial<Record<VenueOfferKind, number>> = {};
    for (const o of offers) c[o.kind] = (c[o.kind] ?? 0) + 1;
    return c;
  }, [offers]);
  const visible = tab === "all" ? offers : offers.filter((o) => o.kind === tab);

  const openEditor = useCallback(
    (offerId: string | null, kind: EditorKind = "entry"): void => {
      setPicker(false);
      if (Platform.OS !== "web" && venueId !== null) {
        router.push(`/venue/${venueId}/offer/${offerId ?? "new"}?kind=${kind}` as never);
        return;
      }
      setEditing({ offerId, kind });
    },
    [router, venueId],
  );
  const openOffer = useCallback(
    (offer: VenueOffer): void =>
      openEditor(offer.id, offer.kind === "group_package" || offer.kind === "private_hire" || offer.kind === "by_the_hour" ? offer.kind : "entry"),
    [openEditor],
  );
  const openPayments = useCallback((): void => {
    if (brandId !== null) router.push(`/brand/${brandId}/payments` as never);
  }, [brandId, router]);

  const pickCard = useCallback(
    (card: NewOfferCard): void => {
      if (!card.built) return;
      if (card.key === "entry") {
        openEditor(null);
        return;
      }
      if (card.key === "group_package") {
        if (packagesOn) {
          openEditor(null, "group_package");
          return;
        }
        // #4490 P3 — an owner or admin turns Group packages on as they pick it.
        setFeatureError(null);
        setFeature.mutate(
          { key: "group_packages", enabled: true, cascade: true },
          {
            onSuccess: () => {
              setToast("Group packages turned on");
              openEditor(null, "group_package");
            },
            onError: () => {
              setPicker(false);
              setFeatureError("Couldn't turn on Group packages. Try again, or switch it on in Settings.");
            },
          },
        );
        return;
      }
      if (card.key === "private_hire") {
        if (hireOn) {
          openEditor(null, "private_hire");
          return;
        }
        if (activeSpaces === 0) {
          // A hire takes a whole space: the venue needs one first.
          setPicker(false);
          setFeatureError("Private hire needs at least one space. Add your spaces first, then pick Private hire again.");
          onOpenModule?.("spaces");
          return;
        }
        // #4490 P4 — an owner or admin turns Private hire on as they pick it.
        setFeatureError(null);
        setFeature.mutate(
          { key: "private_hire", enabled: true, cascade: true },
          {
            onSuccess: () => {
              setToast("Private hire turned on");
              openEditor(null, "private_hire");
            },
            onError: () => {
              setPicker(false);
              setFeatureError("Couldn't turn on Private hire. Try again, or switch it on in Settings.");
            },
          },
        );
        return;
      }
      // #4490 P5 — By the hour: an owner or admin turns it on as they pick it.
      if (card.key === "by_the_hour") {
        if (hourOn) {
          openEditor(null, "by_the_hour");
          return;
        }
        setFeatureError(null);
        setFeature.mutate(
          { key: "by_the_hour", enabled: true, cascade: true },
          {
            onSuccess: () => {
              setToast("By the hour turned on");
              openEditor(null, "by_the_hour");
            },
            onError: () => {
              setPicker(false);
              setFeatureError("Couldn't turn on By the hour. Try again, or switch it on in Settings.");
            },
          },
        );
        return;
      }
      // #4490 P6 — Membership: a plan is made in Members › Plans.
      if (card.key === "membership") {
        if (membersOn) {
          setPicker(false);
          onOpenMembers?.("new_plan");
          return;
        }
        setFeatureError(null);
        setFeature.mutate(
          { key: "memberships", enabled: true, cascade: true },
          {
            onSuccess: () => {
              setPicker(false);
              setToast("Memberships turned on");
              onOpenMembers?.("new_plan");
            },
            onError: () => {
              setPicker(false);
              setFeatureError("Couldn't turn on Memberships. Try again, or switch it on in Settings.");
            },
          },
        );
        return;
      }
      if (card.key === "table_reservations") {
        setPicker(false);
        onOpenModule?.(tablesOn ? "reservations" : "settings");
      }
    },
    [activeSpaces, hireOn, hourOn, membersOn, onOpenMembers, onOpenModule, openEditor, packagesOn, setFeature, tablesOn],
  );

  const runStatus = useCallback(
    (offer: VenueOffer, action: "pause" | "publish" | "archive", done: string): void => {
      setRowError(null);
      setConfirmError(null);
      manageOffer.mutate(
        { action, payload: { offerId: offer.id }, expectedVersion: offer.version },
        {
          onSuccess: () => {
            setConfirm(null);
            setToast(done);
          },
          onError: (e) => {
            const err = toVenueOfferError(e);
            const text = offerErrorCopy(err.code, err.detail);
            if (confirm !== null) setConfirmError(text);
            else setRowError(text);
          },
        },
      );
    },
    [confirm, manageOffer],
  );

  // #4490 fix 2 (N5): Duplicate copies the offer as a draft on the server
  // and opens the copy in its editor.
  const [duplicating, setDuplicating] = useState(false);
  const runDuplicate = useCallback(
    (offer: VenueOffer): void => {
      if (venueId === null || duplicating) return;
      setMenu(null);
      setRowError(null);
      setDuplicating(true);
      duplicateVenueOffer(venueId, offer.id)
        .then((copy) => {
          setToast(`${copy.name} saved as a draft`);
          if (brandId !== null) void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.offers(brandId, venueId) });
          openOffer(copy);
        })
        .catch((e: unknown) => {
          const err = toVenueOfferError(e);
          setRowError(`Couldn't copy ${offer.name}. ${offerErrorCopy(err.code, err.detail)}`);
        })
        .finally(() => setDuplicating(false));
    },
    [brandId, duplicating, openOffer, queryClient, venueId],
  );

  const turnOnEntry = useCallback((): void => {
    setFeatureError(null);
    setFeature.mutate(
      { key: "entry", enabled: true, cascade: true },
      {
        onSuccess: () => setToast("Entry turned on"),
        onError: () => setFeatureError("Couldn't turn on Entry. Try again, or switch it on in Settings."),
      },
    );
  }, [setFeature]);

  // ---------------------------------------------------------------- editor
  if (editing !== null) {
    return (
      <View style={styles.editorHost} testID="venue-offers-editor">
        {(editing.offerId !== null ? offers.find((o) => o.id === editing.offerId)?.kind ?? editing.kind : editing.kind) === "by_the_hour" ? (
          <HourEditor
            ref={editorRef}
            brandId={brandId}
            venueId={venueId}
            venueName={venueName}
            offerId={editing.offerId}
            onOpenSettings={onOpenModule !== undefined ? () => onOpenModule("settings") : undefined}
            onOpenSpaces={onOpenModule !== undefined ? () => onOpenModule("spaces") : undefined}
            onClose={(result) => {
              setEditing(null);
              if (result?.published === true) setToast(`${result.name} is live`);
            }}
          />
        ) : (editing.offerId !== null ? offers.find((o) => o.id === editing.offerId)?.kind ?? editing.kind : editing.kind) === "private_hire" ? (
          <HireEditor
            ref={editorRef}
            brandId={brandId}
            venueId={venueId}
            venueName={venueName}
            offerId={editing.offerId}
            onOpenSettings={onOpenModule !== undefined ? () => onOpenModule("settings") : undefined}
            onOpenSpaces={onOpenModule !== undefined ? () => onOpenModule("spaces") : undefined}
            onOpenPayments={openPayments}
            onClose={(result) => {
              setEditing(null);
              if (result?.published === true) setToast(`${result.name} is live`);
            }}
          />
        ) : (editing.offerId !== null ? offers.find((o) => o.id === editing.offerId)?.kind ?? editing.kind : editing.kind) === "group_package" ? (
          <PackageEditor
            ref={editorRef}
            brandId={brandId}
            venueId={venueId}
            venueName={venueName}
            offerId={editing.offerId}
            onOpenSettings={onOpenModule !== undefined ? () => onOpenModule("settings") : undefined}
            onOpenPayments={openPayments}
            onOpenMenu={onOpenModule !== undefined ? () => onOpenModule("menu") : undefined}
            onClose={(result) => {
              setEditing(null);
              if (result?.published === true) setToast(`${result.name} is live`);
            }}
          />
        ) : (
          <EntryEditor
            ref={editorRef}
            brandId={brandId}
            venueId={venueId}
            venueName={venueName}
            offerId={editing.offerId}
            onOpenSettings={onOpenModule !== undefined ? () => onOpenModule("settings") : undefined}
            onOpenPayments={openPayments}
            onClose={(result) => {
              setEditing(null);
              if (result?.published === true) setToast(`${result.name} is live`);
            }}
          />
        )}
        {toast !== null ? (
          <React.Suspense fallback={null}>
            <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} />
          </React.Suspense>
        ) : null}
      </View>
    );
  }

  // ---------------------------------------------------------------- states
  if (offersQuery.isLoading) {
    return (
      <View style={styles.host} testID="venue-offers-loading" accessibilityLabel="Loading offers">
        <Skeleton height={28} width="30%" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={64} radius="md" />
        ))}
      </View>
    );
  }
  if (offersQuery.isError || state === undefined) {
    return (
      <CenteredState title="Couldn't load your offers" body="Check your connection and try again." tone="error" testID="venue-offers-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void offersQuery.refetch()} />
      </CenteredState>
    );
  }

  const cardSplit = splitOfferCards(
    NEW_OFFER_CARDS,
    (key) => featuresQuery.data?.features[key].enabled === true,
    featuresQuery.data?.venueCategory ?? null,
  );
  const cardGrid = (onPick: (card: NewOfferCard) => void): React.ReactElement => (
    <>
    <View style={[styles.cardGrid, isWideDesktop ? styles.cardGridWide : null]}>
      {(showMoreCards ? [...cardSplit.main, ...cardSplit.more] : cardSplit.main).map((card) => {
        const disabled =
          !card.built ||
          !canEdit ||
          (card.key === "entry" && !entryOn) ||
          (card.key === "group_package" && !packagesOn && !access.canSwitchFeatures) ||
          (card.key === "group_package" && setFeature.isPending) ||
          (card.key === "private_hire" && !hireOn && !access.canSwitchFeatures) ||
          (card.key === "private_hire" && setFeature.isPending) ||
          (card.key === "by_the_hour" && !hourOn && !access.canSwitchFeatures) ||
          (card.key === "by_the_hour" && setFeature.isPending) ||
          (card.key === "membership" && !membersOn && !access.canSwitchFeatures) ||
          (card.key === "membership" && (setFeature.isPending || onOpenMembers === undefined));
        const helper = !card.built
          ? card.helper
          : card.key === "membership" && !membersOn
            ? access.canSwitchFeatures
              ? `${card.helper} Picking it turns on Memberships.`
              : `${card.helper} Ask a brand owner or admin to turn on Memberships.`
          : card.key === "membership"
            ? `${card.helper} Opens a new plan.`
          : card.key === "entry" && !entryOn
            ? `${card.helper} Turn on Entry first.`
            : card.key === "group_package" && !packagesOn
              ? access.canSwitchFeatures
                ? `${card.helper} Picking it turns on Group packages.`
                : `${card.helper} Ask a brand owner or admin to turn on Group packages.`
            : card.key === "private_hire" && !hireOn
              ? access.canSwitchFeatures
                ? activeSpaces === 0
                  ? `${card.helper} Add a space first: a hire takes a whole space.`
                  : `${card.helper} Picking it turns on Private hire.`
                : `${card.helper} Ask a brand owner or admin to turn on Private hire.`
            : card.key === "by_the_hour" && !hourOn
              ? access.canSwitchFeatures
                ? `${card.helper} Picking it turns on By the hour.`
                : `${card.helper} Ask a brand owner or admin to turn on By the hour.`
            : card.key === "table_reservations"
              ? `${card.helper} ${tablesOn ? "Opens Reservations." : "Switch it on in Settings."}`
              : card.helper;
        return (
          <View key={card.key} style={isWideDesktop ? styles.cardCell : null}>
            <OptionCard
              label={card.label}
              helper={helper}
              icon={card.icon}
              selected={false}
              onPress={() => onPick(card)}
              disabled={disabled && !(card.key === "table_reservations" && card.built)}
              testID={`venue-offer-kind-${card.key}`}
              style={COLUMN_OPTION_CARD}
            />
          </View>
        );
      })}
    </View>
    {cardSplit.more.length > 0 ? (
      <View style={styles.moreCards}>
        <Button
          label={showMoreCards ? "Fewer ways to sell" : `More ways to sell (${cardSplit.more.length})`}
          variant="secondary"
          size="sm"
          onPress={() => setShowMoreCards((v) => !v)}
          testID="venue-offer-kind-more"
        />
      </View>
    ) : null}
    </>
  );

  const banners = (
    <>
      {!state.flags.writes ? (
        <Banner tone="info" title="Selling offers isn't switched on yet" body="You can look around; publishing opens when Mingla switches it on for your brand." />
      ) : null}
      {/* #4490 N26: only when Entry offers exist and are paused by it, never a
          warning on a venue that does not sell Entry. */}
      {!entryOn && featuresQuery.data !== undefined && state.offers.some((o) => o.kind === "entry") ? (
        <Banner
          tone="warning"
          title="Entry is off"
          body={
            access.canSwitchFeatures
              ? "Turn on Entry to sell walk-in, day pass or timed entry. Live Entry offers are paused while it's off."
              : "Ask a brand owner or admin to turn on Entry in Settings."
          }
          action={access.canSwitchFeatures ? { label: setFeature.isPending ? "Turning on…" : "Turn on Entry", onPress: turnOnEntry, testID: "venue-offers-turn-on-entry" } : undefined}
          testID="venue-offers-entry-off"
        />
      ) : null}
      {!state.canCollectOnline ? (
        <Banner
          tone="warning"
          title="Online payments aren't set up"
          body="Guests can't pay online for your offers until your brand's payments are set up. Your offers still show, as sold at the venue only."
          action={brandId !== null ? { label: "Set up payments", onPress: openPayments, testID: "venue-offers-payments" } : undefined}
          testID="venue-offers-payments-off"
        />
      ) : null}
      {featureError !== null ? <Text style={styles.error}>{featureError}</Text> : null}
      {rowError !== null ? <Banner tone="danger" title="Couldn't change that offer" body={rowError} /> : null}
    </>
  );

  const sheets = (
    <>
      <Modal visible={picker} onClose={() => setPicker(false)} maxWidth={760} testID="venue-offers-picker">
        <View style={styles.modalBody}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle} accessibilityRole="header">What do you want to sell?</Text>
            <IconChrome icon="close" size={36} accessibilityLabel="Close" onPress={() => setPicker(false)} testID="venue-offers-picker-close" />
          </View>
          <ScrollView style={{ maxHeight: Math.max(280, height * 0.62) }} contentContainerStyle={styles.modalScroll}>
            {cardGrid(pickCard)}
            <View style={styles.eventRow}>
              <Text style={[styles.meta, styles.grow]}>A dated night with tickets is an event.</Text>
              <Button
                label="Create an event"
                variant="ghost"
                size="sm"
                onPress={() => {
                  setPicker(false);
                  router.push("/event/create" as never);
                }}
                testID="venue-offers-create-event"
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
      {menu !== null ? (
        <Menu
          visible
          onClose={() => setMenu(null)}
          anchor={menu.anchor}
          title={menu.offer.name}
          items={[
            { key: "edit", label: "Edit", icon: "edit", onPress: () => openOffer(menu.offer), testID: "venue-offer-menu-edit" },
            ...(menu.offer.status === "live"
              ? [{ key: "pause", label: "Pause", icon: "pause" as const, onPress: () => setConfirm({ action: "pause", offer: menu.offer }), testID: "venue-offer-menu-pause" }]
              : menu.offer.status === "paused"
                ? [{ key: "resume", label: "Resume", icon: "play" as const, onPress: () => runStatus(menu.offer, "publish", `${menu.offer.name} is selling again`), testID: "venue-offer-menu-resume" }]
                : []),
            ...(menu.offer.kind === "entry" || menu.offer.kind === "group_package" || menu.offer.kind === "private_hire" || menu.offer.kind === "by_the_hour"
              ? [{ key: "duplicate", label: "Duplicate", icon: "copy" as const, onPress: () => runDuplicate(menu.offer), testID: "venue-offer-menu-duplicate" }]
              : []),
            { key: "archive", label: "Archive", icon: "trash", danger: true, onPress: () => setConfirm({ action: "archive", offer: menu.offer }), testID: "venue-offer-menu-archive" },
          ]}
          testID="venue-offer-menu"
        />
      ) : null}
      {confirm !== null ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            title={confirm.action === "pause" ? `Pause ${confirm.offer.name}?` : `Archive ${confirm.offer.name}?`}
            description={
              confirm.action === "pause"
                ? "Guests can't buy it until you resume. Passes already bought for later dates stay valid."
                : "It leaves your offers and guests can't buy it. Passes already bought stay valid. This can't be undone."
            }
            confirmLabel={confirm.action === "pause" ? "Pause offer" : "Archive offer"}
            cancelLabel="Keep selling"
            destructive={confirm.action === "archive"}
            confirmLoading={manageOffer.isPending}
            errorMessage={confirmError}
            onClose={() => {
              setConfirm(null);
              setConfirmError(null);
            }}
            onConfirm={() =>
              runStatus(
                confirm.offer,
                confirm.action,
                confirm.action === "pause" ? `${confirm.offer.name} paused` : `${confirm.offer.name} archived`,
              )
            }
            testID="venue-offer-confirm"
          />
        </React.Suspense>
      ) : null}
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="venue-offers-toast" />
        </React.Suspense>
      ) : null}
    </>
  );

  // #4490 P6/K — monthly and yearly plans are made in Members › Plans.
  const plansCard =
    membersOn || livePlans.length > 0 ? (
      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="venue-offers-plans">
        <View style={[styles.row, styles.plansHead]}>
          <View style={styles.cellText}>
            <Text style={styles.rowTitle}>Membership plans</Text>
            <Text style={styles.meta}>
              {livePlans.length === 0 ? "No plan yet. Members pay one billing period at a time." : "Monthly and yearly plans, paid one period at a time."}
            </Text>
          </View>
          {onOpenMembers !== undefined ? (
            <Button
              label={livePlans.length === 0 ? "New plan" : "Manage plans"}
              variant="secondary"
              size="sm"
              onPress={() => onOpenMembers(livePlans.length === 0 ? "new_plan" : "plans")}
              testID="venue-offers-plans-open"
            />
          ) : null}
        </View>
        {livePlans.map((plan) => {
          const st = planStatusWords(plan);
          return (
            <View key={plan.id} style={[styles.row, styles.rowBorder, styles.planRow]} testID={`venue-offers-plan-${plan.id}`}>
              <View style={styles.iconTile}>
                <Icon name="star" size={18} color={color.text2} />
              </View>
              <View style={styles.cellText}>
                <Text style={styles.rowTitle} numberOfLines={2}>{plan.name}</Text>
                <Text style={styles.meta}>
                  {`${money(plan.priceMinor, plan.currencyCode || currency)} a ${plan.period} · ${plan.activeMembers} ${plan.activeMembers === 1 ? "member" : "members"}`}
                </Text>
              </View>
              <Pill variant={st.variant}>{st.label}</Pill>
            </View>
          );
        })}
      </GlassCard>
    ) : null;

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">Offers</Text>
      {canEdit && offers.length > 0 ? (
        <Button label="New offer" variant="primary" size="sm" leadingIcon="plus" onPress={() => setPicker(true)} testID="venue-offers-new" />
      ) : null}
    </View>
  );

  // ----------------------------------------------------------------- empty
  if (offers.length === 0) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.host, { paddingBottom: bottomPad }]} testID="venue-offers-empty">
        {header}
        {banners}
        <GlassCard variant="base" padding={space[5]} contentStyle={styles.emptyCard}>
          <Text style={styles.emptyTitle}>What do guests pay for at {venueName}?</Text>
          <Text style={styles.meta}>
            {canEdit ? "Pick what to sell first. You can add more later." : "Ask a brand owner or admin to add offers."}
          </Text>
          {canEdit ? cardGrid(pickCard) : null}
        </GlassCard>
        {plansCard}
        {sheets}
      </ScrollView>
    );
  }

  // ------------------------------------------------------------------ list
  const kinds = (Object.keys(counts) as VenueOfferKind[]).sort();
  const tabs = [
    { key: "all" as KindTab, label: "All", count: offers.length },
    ...kinds.map((k) => ({ key: k as KindTab, label: OFFER_KIND_LABEL[k], count: counts[k] ?? 0 })),
  ];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.host, { paddingBottom: bottomPad }]} testID="venue-offers-module">
      {header}
      {banners}
      {kinds.length > 1 ? <Tabs items={tabs} value={tab} onChange={setTab} testID="venue-offers-tabs" /> : null}
      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="venue-offers-list">
        {isWideDesktop ? (
          <View style={[styles.row, styles.headRow]}>
            <Text style={[styles.headCell, styles.colName]}>Offer</Text>
            <Text style={[styles.headCell, styles.colPrice]}>Price</Text>
            <Text style={[styles.headCell, styles.colWhen]}>When</Text>
            <Text style={[styles.headCell, styles.colSold]}>Today</Text>
            <Text style={[styles.headCell, styles.colStatus]}>Status</Text>
            <View style={styles.colMenu} />
          </View>
        ) : null}
        {visible.map((offer, index) => {
          const status = OFFER_STATUS[offer.status];
          const sold = soldToday[offer.id] ?? 0;
          const notReady = offer.status === "draft" && offer.readiness.length > 0;
          return (
            <View key={offer.id} style={[styles.row, index > 0 || isWideDesktop ? styles.rowBorder : null]}>
              <Pressable
                onPress={() => (canEdit ? openOffer(offer) : undefined)}
                disabled={!canEdit}
                accessibilityRole="button"
                accessibilityLabel={`${offer.name}, ${kindLine(offer)}, ${priceColumn(offer, currency)}, ${status.label}${canEdit ? ". Edit" : ""}`}
                style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
                testID={`venue-offer-row-${offer.id}`}
              >
                <View style={[styles.colName, styles.nameCell]}>
                  <View style={styles.iconTile}>
                    <Icon name={offer.kind === "group_package" ? "users" : offer.kind === "private_hire" ? "home" : offer.kind === "by_the_hour" ? "clock" : offer.options.some((o) => o.eligibility !== null) ? "shield" : "ticket"} size={18} color={color.text2} />
                  </View>
                  <View style={styles.cellText}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{offer.name}</Text>
                    {/* #4490 N48: the detail line wraps; it was cut to "Every da…" at 390. */}
                    <Text style={styles.meta}>
                      {isWideDesktop
                        ? kindLine(offer)
                        : `${priceColumn(offer, currency)} · ${whenColumn(offer)}`}
                    </Text>
                    {/* #4490 fix 2 (N77): each Entry price with its ID check, hours and booking limit. */}
                    {offer.kind === "entry"
                      ? offer.options.map((o) => (
                          <Text key={o.id} style={styles.meta} testID={`venue-offer-option-${o.id}`}>
                            {`${o.name}: ${optionSummary(o, currency)}`}
                          </Text>
                        ))
                      : null}
                    {notReady ? <Text style={styles.metaWarn}>Not published: {offer.readiness.length} {offer.readiness.length === 1 ? "thing" : "things"} to finish</Text> : null}
                    {offer.outsideOpeningHours === true ? (
                      // #4490 N28: the offer is never changed by itself; the host is told.
                      <Text style={styles.metaWarn} testID={`venue-offer-outside-hours-${offer.id}`}>
                        {`Sells outside your opening hours on ${weekdaysSummary(offer.outsideOpeningHoursDays ?? [])}. Change the offer's hours or your opening hours.`}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {isWideDesktop ? (
                  <>
                    <Text style={[styles.cell, styles.colPrice]}>{priceColumn(offer, currency)}</Text>
                    <Text style={[styles.cell, styles.colWhen]}>{whenColumn(offer)}</Text>
                    <Text style={[styles.cell, styles.colSold]}>{offer.status === "live" || offer.status === "paused" ? `${sold} sold` : "—"}</Text>
                    <View style={styles.colStatus}>
                      <Pill variant={status.variant}>{status.label}</Pill>
                    </View>
                  </>
                ) : (
                  <Pill variant={status.variant}>{status.label}</Pill>
                )}
              </Pressable>
              {canEdit ? (
                <View
                  style={styles.colMenu}
                  ref={(node) => {
                    if (node === null) moreRefs.current.delete(offer.id);
                    else moreRefs.current.set(offer.id, node);
                  }}
                >
                  <IconChrome
                    icon="moreH"
                    size={36}
                    accessibilityLabel={`More for ${offer.name}`}
                    onPress={() => openRowMenu(offer)}
                    testID={`venue-offer-more-${offer.id}`}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </GlassCard>
      {plansCard}
      {sheets}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  moreCards: { flexDirection: "row", marginTop: space[2] },
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  scroll: { flex: 1 },
  editorHost: { flex: 1, minHeight: 0 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  title: { ...type.h1, color: color.text1 },
  meta: { ...type.caption, color: color.text3 },
  metaWarn: { ...type.caption, color: color.warning },
  error: { ...type.caption, color: color.errorText },
  grow: { flex: 1, minWidth: 0 },
  emptyCard: { gap: space[3] },
  emptyTitle: { ...type.h2, color: color.text1 },
  cardGrid: { gap: space[2] },
  cardGridWide: { flexDirection: "row", flexWrap: "wrap" },
  cardCell: { width: "49%", flexGrow: 1, minWidth: 260 },
  listCard: { overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space[2], paddingRight: space[2] },
  headRow: { backgroundColor: color.fill.tableHead, minHeight: 40, paddingVertical: space[2], paddingHorizontal: space[4] },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.line },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 64,
  },
  pressed: { backgroundColor: color.fill.pressed },
  headCell: { ...type.label, color: color.text3 },
  colName: { flex: 3, minWidth: 0 },
  colPrice: { flex: 2, minWidth: 0 },
  colWhen: { flex: 2, minWidth: 0 },
  colSold: { flex: 1, minWidth: 0 },
  colStatus: { width: 96, flexShrink: 0 },
  colMenu: { width: 44, alignItems: "center", flexShrink: 0 },
  nameCell: { flexDirection: "row", alignItems: "center", gap: space[3] },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
  },
  cellText: { flex: 1, minWidth: 0, gap: 2 },
  plansHead: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[3], flexWrap: "wrap" },
  planRow: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[3], minHeight: 56 },
  rowTitle: { ...type.row, color: color.text1 },
  cell: { ...type.small, color: color.text2 },
  modalBody: { gap: space[3], padding: space[5] },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  modalTitle: { ...type.h2, color: color.text1, flex: 1 },
  modalScroll: { gap: space[3], paddingBottom: space[2] },
  eventRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
});
