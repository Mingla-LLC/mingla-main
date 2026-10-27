/**
 * #3872 — Blast › Overview (Promote). Answers "is my promotion working, and
 * what do I do next?" for the whole brand or one listing:
 *
 *   1. Scope: `Showing · Whole brand ▾` (+ `See whole brand` in one-listing mode).
 *   2. Notice: only when a deep-linked listing is no longer published.
 *   3. Result: one strip of three numbers.
 *   4. Ways to promote: Campaigns (with Send), Ads, Creators, Referrals.
 *
 * Phone: a list group and a bottom-sheet picker. Desktop (≥ 1024 web, via
 * `useResponsiveLayout`): capped at 1120, a wide strip, the four ways as a
 * 2 × 2 grid and the picker as a menu anchored under its button.
 * Reads `brand_promotion_overview`. Design: #3872 Promote polish round.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "react-native-reanimated";

import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { useEscapeLayer } from "../ui/escapeLayerStack";
import { ProgramSheet } from "../programs/ProgramSheet";
import { useRefreshOnFocus } from "../programs/useScreenLifecycle";
import {
  ListGroup,
  ListRow,
  PROGRAM_TAP_TARGET,
  ProgramButton,
  SectionLabel,
  SheetBody,
  StatStrip,
  StatusTag,
} from "../programs/ProgramKit";
import {
  WHOLE_BRAND_LABEL,
  promotionFallbackNotice,
  promotionListingLabel,
  promotionListingSubtitle,
  promotionRowWords,
  promotionSectionLabel,
  promotionStrip,
  promotionStripAllZero,
  type PromotionListing,
  type PromotionListingKind,
} from "../../services/promotionOverview";
import { fetchPromotionOverview } from "../../services/promotionOverviewService";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import {
  accent,
  androidOpaque,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type OverviewListingParam = {
  kind: PromotionListingKind;
  id: string;
} | null;

/** Web-only Pressable state (hover / keyboard focus), passed at runtime by react-native-web. */
type WebPressableState = PressableStateCallbackType & {
  hovered?: boolean;
  focused?: boolean;
};

type WebRadioKeyEvent = {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
};

interface FocusCapable {
  focus: () => void;
}

function hasFocusCapability(value: unknown): value is FocusCapable {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "focus" in value &&
    typeof value.focus === "function"
  );
}

const isWeb = Platform.OS === "web";
const MENU_WIDTH = 380;
const MENU_OFFSET = 6;

type Way = {
  key: "campaigns" | "ads" | "creators" | "referrals";
  icon: IconName;
  title: string;
  subtitle: string;
  path: string;
  tag?: { label: string; tone: "paused" };
  send?: boolean;
};

export function BlastPromotionOverview({
  brandId,
  brandName,
  initialListing,
  onNewCampaign,
}: {
  brandId: string;
  /** For the picker's "Everything <brand> is promoting". */
  brandName?: string | null;
  initialListing: OverviewListingParam;
  onNewCampaign: () => void;
}): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const [listing, setListing] = useState<OverviewListingParam>(initialListing);
  const [picking, setPicking] = useState(false);
  // The kind of a deep-linked listing that is no longer published (drives
  // the notice). Cleared on the next pick or on dismiss.
  const [fellBack, setFellBack] = useState<PromotionListingKind | null>(null);
  const pickerRef = useRef<View>(null);

  // A new deep link (Get it seen, the Promote tile) re-picks the listing.
  useEffect(() => {
    setListing(initialListing);
    setFellBack(null);
  }, [initialListing?.kind, initialListing?.id, brandId]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useQuery({
    queryKey: ["blast-promotion-overview", brandId, listing?.kind, listing?.id],
    queryFn: () => fetchPromotionOverview(brandId, listing),
    retry: false,
    // A scope change keeps the previous numbers on screen (dimmed) until the
    // new ones arrive; only the first load shows a skeleton.
    placeholderData: keepPreviousData,
  });
  // Live counts: refetch on refocus and when the app returns to the foreground.
  useRefreshOnFocus(query.refetch);

  // A listing that no longer exists (or is unpublished) falls back to the
  // whole brand and says so, instead of an error screen.
  const failedCode =
    query.error && typeof (query.error as { code?: unknown }).code === "string"
      ? (query.error as Error & { code: string }).code
      : null;
  // Only these two codes mean "the listing is gone": every other failure,
  // coded or not (a network error has code "", Postgres gives 42501 / 57014,
  // the service can throw PromotionOverviewError("unknown")), is a real error
  // and shows the error card with Try again.
  const isListingFallback =
    failedCode === "listing_not_found" || failedCode === "listing_required";
  useEffect(() => {
    if (listing !== null && isListingFallback) {
      setFellBack(listing.kind);
      setListing(null);
    }
  }, [isListingFallback, listing]);

  const data = query.data;
  const firstLoad = data === undefined && query.isPending;
  const failed = data === undefined && query.isError && !isListingFallback;
  const swapping = query.isPlaceholderData && query.isFetching;

  const listings = data?.listings ?? [];
  const pickedListing: PromotionListing | null =
    listing === null
      ? null
      : (data?.listing && data.listing.id === listing.id && !query.isPlaceholderData
          ? data.listing
          : listings.find((row) => row.id === listing.id && row.kind === listing.kind)) ??
        null;
  // `undefined` = the scope's name is not known yet (skeleton in the chip).
  const scopeLabel: string | undefined =
    listing === null
      ? firstLoad
        ? undefined
        : WHOLE_BRAND_LABEL
      : pickedListing
        ? promotionListingLabel(pickedListing)
        : undefined;
  const sectionListing = listing === null ? null : (pickedListing ?? listing);

  const pick = useCallback((next: OverviewListingParam) => {
    setListing(next);
    setFellBack(null);
    setPicking(false);
  }, []);

  const closePicker = useCallback(() => {
    setPicking(false);
    // Focus returns to the picker (web keyboard users).
    if (isWeb) {
      pickerRef.current?.focus();
    }
  }, []);

  const words = data ? promotionRowWords(data) : null;
  const go = (path: string) => router.replace(path as never);
  const ways: Way[] | null = words
    ? [
        {
          key: "campaigns",
          icon: "send",
          title: "Campaigns",
          subtitle: words.campaigns,
          path: "/(tabs)/marketing/campaigns",
          send: true,
        },
        {
          key: "ads",
          icon: "sparkle",
          title: "Ads",
          subtitle: words.ads,
          path: "/(tabs)/marketing/ads",
          tag: data?.ads?.needsSetup ? { label: "Needs setup", tone: "paused" } : undefined,
        },
        {
          key: "creators",
          icon: "video",
          title: "Creators",
          subtitle: words.creators,
          path: "/(tabs)/marketing/creators",
        },
        {
          key: "referrals",
          icon: "gift",
          title: "Referrals",
          subtitle: words.referrals,
          path: "/(tabs)/marketing/referrals",
        },
      ]
    : null;

  const sendButton = (
    <ProgramButton
      icon="send"
      label="Send"
      accessibilityLabel="Send a campaign"
      onPress={onNewCampaign}
      testID="blast-overview-send"
    />
  );

  const options = (
    <PickerOptions
      listings={listings}
      listing={listing}
      brandName={brandName}
      onPick={pick}
    />
  );

  return (
    <View
      style={[styles.wrap, isWideDesktop && styles.wrapWide]}
      testID="blast-overview"
    >
      {/* 1. Scope */}
      <View style={styles.headRow}>
        <Pressable
          ref={pickerRef}
          onPress={() => setPicking(true)}
          disabled={firstLoad}
          accessibilityRole="button"
          accessibilityLabel={
            scopeLabel === undefined
              ? "Loading promotion scope"
              : `Showing ${scopeLabel}. Change what you see`
          }
          accessibilityState={{ disabled: firstLoad, expanded: picking }}
          aria-haspopup="dialog"
          aria-expanded={picking}
          style={(state: WebPressableState) => [
            styles.picker,
            state.hovered && isWeb ? styles.pickerHover : null,
            state.pressed ? styles.pressed : null,
            state.focused && isWeb ? styles.focusRing : null,
          ]}
          testID="blast-overview-listing-picker"
        >
          <Text style={styles.pickerPrefix}>Showing</Text>
          {scopeLabel === undefined ? (
            <Skeleton width={96} height={12} radius="sm" />
          ) : (
            <Text style={styles.pickerValue} numberOfLines={1}>
              {scopeLabel}
            </Text>
          )}
          <Icon name="chevD" size={16} color={textTokens.secondary} />
        </Pressable>
        {listing !== null && !firstLoad ? (
          <Pressable
            onPress={() => pick(null)}
            accessibilityRole="button"
            accessibilityLabel="Show promotion for the whole brand"
            style={(state: WebPressableState) => [
              styles.textButton,
              state.pressed ? styles.textButtonPressed : null,
              state.focused && isWeb ? styles.focusRing : null,
            ]}
            testID="blast-overview-whole-brand"
          >
            {(state: WebPressableState) => (
              <Text
                style={[
                  styles.textButtonLabel,
                  state.hovered && isWeb ? styles.textButtonHover : null,
                ]}
              >
                See whole brand
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {/* 2. Notice */}
      {fellBack !== null ? (
        <View
          style={styles.notice}
          accessibilityLiveRegion="polite"
          role="status"
          testID="blast-overview-fallback-notice"
        >
          <Text style={styles.noticeText}>{promotionFallbackNotice(fellBack)}</Text>
          <Pressable
            onPress={() => setFellBack(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            style={(state: WebPressableState) => [
              styles.noticeDismiss,
              state.pressed ? styles.textButtonPressed : null,
              state.focused && isWeb ? styles.focusRing : null,
            ]}
          >
            {(state: WebPressableState) => (
              <Icon
                name="close"
                size={16}
                color={state.hovered && isWeb ? textTokens.primary : textTokens.secondary}
              />
            )}
          </Pressable>
        </View>
      ) : null}

      {/* 3 + 4. Result and ways to promote, in every state */}
      {firstLoad ? (
        <OverviewSkeleton wide={isWideDesktop} />
      ) : failed ? (
        <GlassCard
          variant="base"
          radius="lg"
          padding={0}
          contentStyle={styles.errorCard}
          testID="blast-overview-error"
        >
          <View style={styles.errorTile}>
            <Icon name="flag" size={20} color={semantic.warning} />
          </View>
          <View style={styles.errorText} role="alert">
            <Text style={styles.errorTitle}>{"Promotion results didn't load"}</Text>
            <Text style={styles.errorBody}>Check your connection, then try again.</Text>
            <View style={styles.errorAction}>
              <ProgramButton
                label={query.isFetching ? "Trying…" : "Try again"}
                disabled={query.isFetching}
                onPress={() => {
                  void query.refetch();
                }}
                testID="blast-overview-retry"
              />
            </View>
          </View>
        </GlassCard>
      ) : data && ways ? (
        <View
          style={[styles.results, isWideDesktop && styles.resultsWide, swapping && styles.swapping]}
          testID="blast-overview-results"
        >
          <StatStrip items={promotionStrip(data)} layout={isWideDesktop ? "wide" : "compact"} />
          {promotionStripAllZero(data) ? (
            <Text style={styles.guide}>
              Numbers show up here once a campaign, ad, creator or referral sends someone to buy.
            </Text>
          ) : null}
          <SectionLabel wide={isWideDesktop}>
            {promotionSectionLabel(sectionListing)}
          </SectionLabel>
          {isWideDesktop ? (
            <View style={styles.waysGrid}>
              {ways.map((way) => (
                <WayCard
                  key={way.key}
                  way={way}
                  onOpen={() => go(way.path)}
                  action={way.send ? sendButton : null}
                />
              ))}
            </View>
          ) : (
            <ListGroup>
              {ways.map((way) => (
                <ListRow
                  key={way.key}
                  compact
                  icon={way.icon}
                  title={way.title}
                  subtitle={way.subtitle}
                  tag={way.tag}
                  onPress={() => go(way.path)}
                  action={way.send ? sendButton : undefined}
                  testID={`blast-overview-row-${way.key}`}
                />
              ))}
            </ListGroup>
          )}
        </View>
      ) : null}

      {/* Picker: half sheet on phone, anchored menu on desktop */}
      {isWideDesktop ? (
        <PickerMenu visible={picking} anchorRef={pickerRef} onClose={closePicker}>
          {options}
        </PickerMenu>
      ) : (
        <ProgramSheet visible={picking} onClose={closePicker} snapPoint="half">
          <SheetBody title="Show promotion for">{options}</SheetBody>
        </ProgramSheet>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Desktop way card: the whole card opens the tab; Send sits above it as a
// sibling (never inside the card's pressable).
// ---------------------------------------------------------------------------

function WayCard({
  way,
  onOpen,
  action,
}: {
  way: Way;
  onOpen: () => void;
  action: React.ReactNode;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  return (
    <View style={styles.wayCell} testID={`blast-overview-way-${way.key}`}>
      <Pressable
        onPress={onOpen}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`${way.title}, ${way.subtitle}`}
        style={(state: WebPressableState) => [
          styles.wayPress,
          state.pressed ? styles.pressed : null,
          state.focused && isWeb ? styles.focusRingCard : null,
        ]}
        testID={`blast-overview-way-${way.key}-open`}
      >
        <GlassCard
          variant="base"
          radius="lg"
          padding={20}
          style={styles.wayCard}
          contentStyle={[styles.wayContent, action ? styles.wayContentAction : null]}
        >
          <View style={styles.wayTile}>
            <Icon name={way.icon} size={20} color={accent.warm} />
          </View>
          <View style={styles.wayText}>
            <View style={styles.wayTitleLine}>
              <Text style={styles.wayTitle} numberOfLines={1}>
                {way.title}
              </Text>
              {way.tag ? <StatusTag label={way.tag.label} tone={way.tag.tone} /> : null}
            </View>
            <Text style={styles.waySubtitle} numberOfLines={2}>
              {way.subtitle}
            </Text>
          </View>
        </GlassCard>
        {hovered ? <View pointerEvents="none" style={styles.wayHoverRing} /> : null}
      </Pressable>
      <View pointerEvents="box-none" style={styles.wayActions}>
        {action}
        <View pointerEvents="none">
          <Icon name="chevR" size={16} color={textTokens.tertiary} />
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Picker options (shared by the sheet and the menu): radio rows with a check.
// ---------------------------------------------------------------------------

function PickerOptions({
  listings,
  listing,
  brandName,
  onPick,
}: {
  listings: PromotionListing[];
  listing: OverviewListingParam;
  brandName?: string | null;
  onPick: (next: OverviewListingParam) => void;
}): React.ReactElement {
  const events = listings.filter((row) => row.kind === "event");
  const venues = listings.filter((row) => row.kind === "venue");
  const grouped = events.length > 0 && venues.length > 0;
  const orderedListings = grouped ? [...events, ...venues] : listings;
  const optionRefs = useRef<Array<View | null>>([]);
  const name = brandName?.trim();
  const values: OverviewListingParam[] = [
    null,
    ...orderedListings.map((row) => ({ kind: row.kind, id: row.id })),
  ];
  const move = (from: number, delta: -1 | 1): void => {
    const next = (from + delta + values.length) % values.length;
    const target = optionRefs.current[next];
    if (isWeb && hasFocusCapability(target)) target.focus();
    onPick(values[next]);
  };
  const option = (row: PromotionListing): React.ReactElement => (
    <PickerOption
      key={`${row.kind}:${row.id}`}
      optionRef={(instance) => {
        optionRefs.current[orderedListings.indexOf(row) + 1] = instance;
      }}
      title={row.title}
      subtitle={promotionListingSubtitle(row)}
      selected={listing?.id === row.id && listing.kind === row.kind}
      onPress={() => onPick({ kind: row.kind, id: row.id })}
      onMove={(delta) => move(orderedListings.indexOf(row) + 1, delta)}
      testID={`blast-overview-option-${row.kind}-${row.id}`}
    />
  );
  return (
    <View accessibilityRole="radiogroup" style={styles.options}>
      <PickerOption
        optionRef={(instance) => {
          optionRefs.current[0] = instance;
        }}
        title={WHOLE_BRAND_LABEL}
        subtitle={name ? `Everything ${name} is promoting` : "Everything this brand is promoting"}
        selected={listing === null}
        onPress={() => onPick(null)}
        onMove={(delta) => move(0, delta)}
        testID="blast-overview-option-whole-brand"
      />
      {listings.length === 0 ? (
        <Text style={styles.emptyOptions}>
          Publish an event or venue to see its promotion on its own.
        </Text>
      ) : grouped ? (
        <>
          <Text style={styles.optionGroup} accessibilityRole="header">
            Events
          </Text>
          {events.map(option)}
          <Text style={styles.optionGroup} accessibilityRole="header">
            Venues
          </Text>
          {venues.map(option)}
        </>
      ) : (
        listings.map(option)
      )}
    </View>
  );
}

function PickerOption({
  optionRef,
  title,
  subtitle,
  selected,
  onPress,
  onMove,
  testID,
}: {
  optionRef: (instance: View | null) => void;
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
  onMove: (delta: -1 | 1) => void;
  testID?: string;
}): React.ReactElement {
  const webKeyboardProps = isWeb
    ? {
        onKeyDown: (event: WebRadioKeyEvent): void => {
          const delta = event.key === "ArrowDown" || event.key === "ArrowRight"
            ? 1
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
            ? -1
            : 0;
          if (delta === 0) return;
          event.preventDefault();
          event.stopPropagation();
          onMove(delta);
        },
      }
    : {};
  return (
    <Pressable
      ref={optionRef}
      onPress={onPress}
      {...webKeyboardProps}
      accessibilityRole="radio"
      accessibilityLabel={`${title}, ${subtitle}`}
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      aria-selected={selected}
      style={(state: WebPressableState) => [
        styles.option,
        state.hovered && isWeb && !selected ? styles.optionHover : null,
        selected ? styles.optionSelected : null,
        state.pressed ? styles.pressed : null,
        state.focused && isWeb ? styles.focusRing : null,
      ]}
      testID={testID}
    >
      <View style={styles.optionText}>
        <Text style={styles.optionTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.optionSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {/* Selected is never colour alone: a check marks it. */}
      <View style={styles.optionCheck}>
        {selected ? (
          <Icon
            name="check"
            size={20}
            color={accent.warm}
            testID={testID !== undefined ? `${testID}-check` : undefined}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Desktop menu, anchored under the picker. Esc closes (and only this layer).
// ---------------------------------------------------------------------------

function PickerMenu({
  visible,
  anchorRef,
  onClose,
  children,
}: {
  visible: boolean;
  anchorRef: React.RefObject<View | null>;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement | null {
  const isTopLayer = useEscapeLayer(visible);
  const reduceMotion = useReducedMotion();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShown(false);
      setAnchor(null);
      return undefined;
    }
    anchorRef.current?.measureInWindow((x, y, _width, height) => {
      setAnchor({ x, y: y + height + MENU_OFFSET });
    });
    const timer = setTimeout(() => setShown(true), 16);
    return () => clearTimeout(timer);
  }, [visible, anchorRef]);

  const motion = useMemo<ViewStyle>(
    () =>
      ({
        opacity: shown ? 1 : 0,
        transform: [{ translateY: shown || reduceMotion ? 0 : -6 }],
        transitionProperty: "opacity, transform",
        transitionDuration: "160ms",
        transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
      }) as ViewStyle,
    [shown, reduceMotion],
  );

  if (!visible) return null;
  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={() => {
        if (isTopLayer()) onClose();
      }}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close"
        accessible={false}
      />
      {anchor ? (
        <View
          role="dialog"
          aria-modal
          aria-label="Show promotion for"
          style={[styles.menu, { left: anchor.x, top: anchor.y }, motion]}
          testID="blast-overview-menu"
        >
          <Text style={styles.menuTitle} accessibilityRole="header">
            Show promotion for
          </Text>
          {children}
        </View>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// First-load skeleton: the strip and the rows, never a bare spinner.
// ---------------------------------------------------------------------------

function OverviewSkeleton({ wide }: { wide: boolean }): React.ReactElement {
  const cell = (index: number) => (
    <View
      key={index}
      style={[styles.skeletonCell, wide && styles.skeletonCellWide, index > 0 && styles.skeletonDivider]}
    >
      <Skeleton width={64} height={wide ? 28 : 22} radius="sm" />
      <Skeleton width={84} height={12} radius="sm" />
    </View>
  );
  const row = (index: number) => (
    <View key={index} style={styles.skeletonRow}>
      <Skeleton width={40} height={40} radius="md" />
      <View style={styles.skeletonRowText}>
        <Skeleton width={96} height={14} radius="sm" />
        <Skeleton width="60%" height={12} radius="sm" />
      </View>
    </View>
  );
  return (
    <View
      style={[styles.results, wide && styles.resultsWide]}
      accessibilityLabel="Loading promotion results"
      testID="blast-overview-skeleton"
    >
      <GlassCard variant="base" radius="lg" padding={0} contentStyle={styles.skeletonStrip}>
        {[0, 1, 2].map(cell)}
      </GlassCard>
      <View style={styles.skeletonLabel}>
        <Skeleton width={180} height={12} radius="sm" />
      </View>
      {wide ? (
        <View style={styles.waysGrid}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} style={styles.wayCell}>
              <GlassCard
                variant="base"
                radius="lg"
                padding={20}
                style={styles.wayCard}
                contentStyle={styles.wayContent}
              >
                <Skeleton width={40} height={40} radius="md" />
                <View style={styles.skeletonRowText}>
                  <Skeleton width={110} height={16} radius="sm" />
                  <Skeleton width="70%" height={12} radius="sm" />
                </View>
              </GlassCard>
            </View>
          ))}
        </View>
      ) : (
        <ListGroup>{[0, 1, 2, 3].map(row)}</ListGroup>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  wrapWide: { gap: 16, width: "100%", maxWidth: 1120 },
  results: { gap: 12 },
  resultsWide: { gap: 16 },
  swapping: { opacity: 0.5 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 44,
  },
  picker: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 44,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileBase,
  },
  pickerHover: { borderColor: accent.border },
  pickerPrefix: { color: textTokens.tertiary, fontSize: 13, fontWeight: "600" },
  pickerValue: {
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
    minWidth: 0,
  },
  pressed: { opacity: 0.85 },
  focusRing: {
    outlineColor: accent.warm,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: 2,
  },
  focusRingCard: {
    outlineColor: accent.warm,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: 2,
    borderRadius: radius.lg,
  },
  textButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: radius.sm,
  },
  textButtonPressed: { opacity: 0.7 },
  textButtonLabel: {
    ...typography.buttonMd,
    fontWeight: "700",
    color: accent.warm,
  },
  textButtonHover: { textDecorationLine: "underline" },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: Platform.OS === "android" ? androidOpaque.accentFill : accent.tint,
  },
  noticeText: { flex: 1, color: textTokens.primary, fontSize: 14, lineHeight: 20 },
  // A real 44pt box (react-native-web ignores hitSlop); the negative margins
  // keep its layout footprint at the 32pt it had, so the notice looks the same.
  noticeDismiss: {
    width: PROGRAM_TAP_TARGET,
    height: PROGRAM_TAP_TARGET,
    marginVertical: -12,
    marginHorizontal: -6,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  guide: {
    color: textTokens.secondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -4,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  errorTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: semantic.warningTint,
  },
  errorText: { flex: 1, gap: 2 },
  errorTitle: { color: textTokens.primary, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  errorBody: { color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
  errorAction: { flexDirection: "row", marginTop: 10 },
  waysGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  wayCell: {
    position: "relative",
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
  },
  wayPress: { flex: 1, borderRadius: radius.lg },
  wayCard: { flex: 1 },
  // minHeight on the CONTENT node: GlassChrome's tint layers follow the
  // content, so a minHeight on the chrome left an empty strip under the card.
  wayContent: { flexDirection: "row", alignItems: "flex-start", gap: 16, minHeight: 112 },
  wayContentAction: { paddingRight: 20 + 72 + 12 + 16 },
  wayTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
  },
  wayText: { flex: 1, minWidth: 0, gap: 2, paddingRight: 28 },
  wayTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wayTitle: {
    color: textTokens.primary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    flexShrink: 1,
  },
  waySubtitle: { color: textTokens.secondary, fontSize: 13, lineHeight: 18 },
  wayHoverRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: accent.border,
  },
  wayActions: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  options: { gap: 2 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
  },
  optionHover: { backgroundColor: glass.tint.profileBase },
  optionSelected: { backgroundColor: accent.tint },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionTitle: { color: textTokens.primary, fontSize: 15, fontWeight: "600" },
  optionSubtitle: { color: textTokens.secondary, fontSize: 13 },
  optionCheck: { width: 20, height: 20 },
  optionGroup: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 4,
    marginHorizontal: 12,
  },
  emptyOptions: {
    color: textTokens.secondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginHorizontal: 12,
  },
  menu: {
    position: "absolute",
    width: MENU_WIDTH,
    maxHeight: 520,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: canvas.profile,
    overflow: "scroll",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
  },
  menuTitle: {
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 4,
    marginBottom: 8,
    marginHorizontal: 8,
  },
  skeletonStrip: { flexDirection: "row", paddingVertical: 16 },
  skeletonCell: { flex: 1, alignItems: "center", gap: 6, paddingHorizontal: 12 },
  skeletonCellWide: { alignItems: "flex-start", paddingHorizontal: 24 },
  skeletonDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: glass.border.profileElevated,
  },
  skeletonLabel: { marginTop: 8 },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingVertical: 12,
  },
  skeletonRowText: { flex: 1, gap: 8 },
});
