import React, {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { ViewProps, ViewStyle } from "react-native";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";
import {
  reconcileInitialVenueTab,
  type PublicVenueTab,
} from "./publicVenueTabState";
// issue #4420 — the tab strip is the shared glass pill.
import { GlassTabs, type GlassTabNode } from "./GlassTabs";

// This package is source-linked into both apps. Their isolated typecheck
// sandboxes resolve React peers from the app root, while files under packages/
// cannot discover that peer directly. Keep one package-local React bridge on
// this established module so additional shared renderers reuse the same typed
// runtime instead of creating unresolved peer-module diagnostics.
export const BrandRenderingReact = React;
export const useBrandRenderingMemo = useMemo;
export const useBrandRenderingState = useState;
export type BrandRenderingReactElement = React.ReactElement;
export type BrandRenderingReactNode = React.ReactNode;

export type { PublicVenueTab } from "./publicVenueTabState";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export interface PublicVenueTabsProps {
  initialTab?: PublicVenueTab;
  activeTab?: PublicVenueTab;
  hasMenu: boolean;
  /**
   * #4490 — the tabs this venue has, in order, from its features. Absent =
   * today's strip (Overview, Menu when there is one, Reservations).
   */
  tabs?: readonly PublicVenueTab[];
  /** Label overrides ("Tables" for "Reservations", …). */
  labels?: Partial<Record<PublicVenueTab, string>>;
  /** Panes for the tabs beyond the three above (What's on, Rooms, …). */
  panes?: Partial<Record<PublicVenueTab, React.ReactNode>>;
  overview: React.ReactNode;
  menu: React.ReactNode;
  reservations: React.ReactNode;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  onTabChange?: (tab: PublicVenueTab) => void;
  onTabViewed?: (tab: PublicVenueTab) => void;
}

export interface PublicVenueTabsHandle {
  focusTab: (tab: PublicVenueTab) => void;
  /** issue #4420 — select a tab from the pinned copy of the strip (native). */
  selectTab: (tab: PublicVenueTab) => void;
}

interface VenueTabKeyboardEvent {
  nativeEvent: {
    altKey?: boolean;
    ctrlKey?: boolean;
    key: string;
    metaKey?: boolean;
    shiftKey?: boolean;
  };
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  preventDefault: () => void;
}

interface VenueTabFocusEvent {
  currentTarget?: {
    matches?: (selector: string) => boolean;
  };
}

type FocusableVenueTab = React.ElementRef<typeof Pressable> & {
  closest?: (selector: string) => InlineScrollOwner | null;
  focus: () => void;
  getBoundingClientRect?: () => InlineRect;
  scrollIntoView?: (options: {
    block: "nearest";
    inline: "nearest";
  }) => void;
};

interface InlineRect {
  left: number;
  right: number;
}

interface InlineScrollOwner {
  getBoundingClientRect: () => InlineRect;
  scrollLeft: number;
}

interface WebVenuePanelProps extends ViewProps {
  "aria-hidden"?: boolean;
  "aria-labelledby"?: string;
  id?: string;
  role?: "tabpanel";
  tabIndex?: 0 | -1;
}

interface WebFocusOutline extends ViewStyle {
  outlineColor: string;
  outlineOffset: number;
  outlineStyle: "solid";
  outlineWidth: number;
}

// React Native Web forwards these DOM-only properties, while the installed
// native component types intentionally omit them. Keeping the typed seams here
// prevents web semantics from leaking into either native render branch.
const WebVenuePanel = View as React.ComponentType<WebVenuePanelProps>;

const isWebFocusVisible = (event: VenueTabFocusEvent): boolean => {
  if (event.currentTarget?.matches === undefined) return true;
  try {
    return event.currentTarget.matches(":focus-visible");
  } catch {
    // Older engines can expose Element.matches without supporting this
    // selector. The approved accessible fallback is to show focus, never hide it.
    return true;
  }
};

const LABELS: Record<PublicVenueTab, string> = {
  overview: "Overview",
  entry: "Entry",
  groups: "Groups",
  hire: "Private hire",
  by_the_hour: "By the hour",
  plans: "Plans",
  rooms: "Rooms",
  whats_on: "What's on",
  guest_list: "Guest list",
  menu: "Menu",
  reservations: "Reservations",
};

const legacyTabs = (hasMenu: boolean): PublicVenueTab[] =>
  hasMenu
    ? ["overview", "menu", "reservations"]
    : ["overview", "reservations"];

const WEB_TABLIST_SELECTOR =
  '[role="tablist"][aria-label="Venue sections"]';
const INLINE_VISIBILITY_SAFETY_PX = 1;

const keepFocusedTabInlineVisible = (target: FocusableVenueTab): void => {
  const tabRect = target.getBoundingClientRect?.();
  const scrollOwner = target.closest?.(WEB_TABLIST_SELECTOR);
  if (
    tabRect === undefined ||
    scrollOwner === null ||
    scrollOwner === undefined
  ) {
    return;
  }
  const ownerRect = scrollOwner.getBoundingClientRect();
  const rightOverrun = tabRect.right - ownerRect.right;
  const leftOverrun = ownerRect.left - tabRect.left;

  if (rightOverrun > 0) {
    scrollOwner.scrollLeft +=
      Math.ceil(rightOverrun) + INLINE_VISIBILITY_SAFETY_PX;
    return;
  }
  if (leftOverrun > 0) {
    scrollOwner.scrollLeft = Math.max(
      0,
      scrollOwner.scrollLeft -
        (Math.ceil(leftOverrun) + INLINE_VISIBILITY_SAFETY_PX),
    );
  }
};

/**
 * Issue #1365 — the one shared public-venue tab composition. It intentionally
 * reuses the same pill shape and theme inputs as PublicBrandPage; adapters own
 * data, navigation, and booking side effects.
 */
export const PublicVenueTabs = forwardRef<
  PublicVenueTabsHandle,
  PublicVenueTabsProps
>(function PublicVenueTabs(
  {
    initialTab = "overview",
    activeTab: controlledActiveTab,
    hasMenu,
    tabs: tabsProp,
    labels,
    panes,
    overview,
    menu,
    reservations,
    palette,
    surface,
    theme,
    onTabChange,
    onTabViewed,
  },
  ref,
): React.ReactElement {
  const tabs: PublicVenueTab[] =
    tabsProp === undefined ? legacyTabs(hasMenu) : [...tabsProp];
  const safeInitial = tabs.includes(initialTab) ? initialTab : "overview";
  const isControlled = controlledActiveTab !== undefined;
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    useState<PublicVenueTab>(safeInitial);
  const activeTab =
    controlledActiveTab !== undefined && tabs.includes(controlledActiveTab)
      ? controlledActiveTab
      : isControlled
        ? "overview"
        : tabs.includes(uncontrolledActiveTab)
          ? uncontrolledActiveTab
          : "overview";
  // #4490 W3 fix 6 (W3-N41) — the Menu pane holds the guest's order basket
  // (items, notes, name). Once opened it stays mounted, hidden, while another
  // tab shows, so a guest who looks at Private hire or What's on comes back to
  // the same basket. It goes when the page goes (or the venue loses its menu).
  // Other panes keep today's rule: only the active one is mounted.
  const [menuOpened, setMenuOpened] = useState<boolean>(activeTab === "menu");
  if (activeTab === "menu" && !menuOpened) setMenuOpened(true);
  const keepMenu =
    menuOpened && tabs.includes("menu") && menu !== null && menu !== undefined;
  const instanceId = useId();
  const lastInitialViewed = useRef<PublicVenueTab | null>(null);
  const onTabViewedRef = useRef(onTabViewed);
  const tabRefs = useRef<Partial<Record<PublicVenueTab, FocusableVenueTab>>>({});
  const focusedTabRef = useRef<PublicVenueTab | null>(null);
  const pointerFocusPendingRef = useRef(false);
  const keyboardFocusPendingRef = useRef(false);
  const [focusVisibleTab, setFocusVisibleTab] =
    useState<PublicVenueTab | null>(null);

  const tabId = (tab: PublicVenueTab): string =>
    `${instanceId}-public-venue-${tab}-tab`;
  const panelId = (tab: PublicVenueTab): string =>
    `${instanceId}-public-venue-${tab}-panel`;

  const revealAndFocus = (tab: PublicVenueTab): void => {
    const target = tabRefs.current[tab];
    if (target === undefined) return;
    focusedTabRef.current = tab;
    target.focus();
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (Platform.OS === "web") keepFocusedTabInlineVisible(target);
  };

  useImperativeHandle(
    ref,
    () => ({
      focusTab: (tab: PublicVenueTab): void => {
        revealAndFocus(tab);
      },
      selectTab: (tab: PublicVenueTab): void => {
        selectRef.current(tab);
      },
    }),
    [],
  );

  useEffect(() => {
    onTabViewedRef.current = onTabViewed;
  }, [onTabViewed]);

  useEffect(() => {
    if (
      !isControlled &&
      uncontrolledActiveTab === "menu" &&
      !hasMenu
    ) {
      setUncontrolledActiveTab("overview");
    }
  }, [hasMenu, isControlled, uncontrolledActiveTab]);

  useEffect(() => {
    if (!hasMenu && focusedTabRef.current === "menu") {
      focusedTabRef.current = activeTab;
      setFocusVisibleTab(null);
      revealAndFocus(activeTab);
    }
  }, [activeTab, hasMenu]);

  useEffect(() => {
    const transition = reconcileInitialVenueTab(
      activeTab,
      lastInitialViewed.current,
      safeInitial,
    );
    lastInitialViewed.current = transition.lastInitialTab;
    if (!isControlled && transition.activeTab !== uncontrolledActiveTab) {
      setUncontrolledActiveTab(transition.activeTab);
    }
    if (transition.shouldEmit) {
      onTabViewedRef.current?.(safeInitial);
    }
    // activeTab is intentionally excluded: user tab changes must not replay the
    // route-initial event or snap back to the route's initial tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeInitial]);

  const select = (tab: PublicVenueTab): void => {
    if (!isControlled) {
      setUncontrolledActiveTab(tab);
    }
    onTabChange?.(tab);
    onTabViewed?.(tab);
  };
  // The imperative handle is created once; it reads the latest `select`.
  const selectRef = useRef(select);
  selectRef.current = select;

  const handleWebKeyDown = (
    event: VenueTabKeyboardEvent,
    currentIndex: number,
    currentTab: PublicVenueTab,
  ): void => {
    const modified =
      event.altKey === true ||
      event.ctrlKey === true ||
      event.metaKey === true ||
      event.shiftKey === true ||
      event.nativeEvent.altKey === true ||
      event.nativeEvent.ctrlKey === true ||
      event.nativeEvent.metaKey === true ||
      event.nativeEvent.shiftKey === true;
    if (modified) return;

    pointerFocusPendingRef.current = false;

    if (
      event.nativeEvent.key === " " ||
      event.nativeEvent.key === "Spacebar"
    ) {
      event.preventDefault();
      keyboardFocusPendingRef.current = false;
      setFocusVisibleTab(currentTab);
      select(currentTab);
      return;
    }

    // Enter remains owned by React Native Web's existing Pressable path. Mark
    // the modality here, but do not activate a second time from onKeyDown.
    if (event.nativeEvent.key === "Enter") {
      keyboardFocusPendingRef.current = false;
      setFocusVisibleTab(currentTab);
      return;
    }

    let targetIndex: number;
    switch (event.nativeEvent.key) {
      case "ArrowLeft":
        targetIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case "ArrowRight":
        targetIndex = (currentIndex + 1) % tabs.length;
        break;
      case "Home":
        targetIndex = 0;
        break;
      case "End":
        targetIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const targetTab: PublicVenueTab = tabs[targetIndex];
    const focusStaysOnCurrentTab = targetTab === currentTab;
    keyboardFocusPendingRef.current = !focusStaysOnCurrentTab;
    // focus() does not dispatch another focus event when Home/End resolves to
    // the tab that already owns focus, so restore keyboard modality directly.
    if (focusStaysOnCurrentTab) setFocusVisibleTab(targetTab);
    revealAndFocus(targetTab);
  };

  const contentByTab: Partial<Record<PublicVenueTab, React.ReactNode>> = {
    ...panes,
    overview,
    menu,
    reservations,
  };

  // issue #4420 — the segmented glass pill is the shared GlassTabs (spec
  // §1.1.7). On web it sticks under the glass header so moving between
  // Overview, Menu and Reservations never means scrolling back up; native
  // keeps it in the flow (the screen pins a copy, PublicVenueTabPill).
  const webTabPropsFor = (
    tab: PublicVenueTab,
    index: number,
    active: boolean,
  ): Record<string, unknown> =>
    Platform.OS === "web"
      ? {
          "aria-controls": panelId(tab),
          "aria-selected": active,
          id: tabId(tab),
          onBlur: (): void => {
            if (focusedTabRef.current === tab) {
              focusedTabRef.current = null;
            }
            setFocusVisibleTab((current: PublicVenueTab | null) =>
              current === tab ? null : current,
            );
          },
          onFocus: (event: VenueTabFocusEvent): void => {
            focusedTabRef.current = tab;
            const pointerFocused = pointerFocusPendingRef.current;
            const keyboardFocused = keyboardFocusPendingRef.current;
            pointerFocusPendingRef.current = false;
            keyboardFocusPendingRef.current = false;
            setFocusVisibleTab(
              !pointerFocused && (keyboardFocused || isWebFocusVisible(event))
                ? tab
                : null,
            );
          },
          onKeyDown: (event: VenueTabKeyboardEvent): void => {
            handleWebKeyDown(event, index, tab);
          },
          onPointerDown: (): void => {
            pointerFocusPendingRef.current = true;
            keyboardFocusPendingRef.current = false;
            setFocusVisibleTab(null);
          },
          tabIndex: active ? 0 : -1,
        }
      : {};
  const focusOutlineFor = (
    tab: PublicVenueTab,
    active: boolean,
  ): WebFocusOutline | null =>
    Platform.OS === "web" && focusVisibleTab === tab
      ? {
          outlineColor: active ? palette.accentText : palette.primaryText,
          outlineOffset: -4,
          outlineStyle: "solid",
          outlineWidth: 3,
        }
      : null;
  // #4490 — a venue whose features give it a single tab (just Overview) has
  // nothing to choose between: no strip, the content stands alone. Today's page
  // (no `tabs` prop) always has two or more, so it is unchanged.
  const showStrip = tabsProp === undefined || tabs.length > 1;
  return (
    <View>
      {showStrip ? (
        <GlassTabs
          items={tabs.map((tab: PublicVenueTab) => ({
            key: tab,
            label: labels?.[tab] ?? LABELS[tab],
          }))}
          activeKey={activeTab}
          onSelect={select}
          palette={palette}
          theme={theme}
          stickyTop={72}
          listLabel="Venue sections"
          testID="issue-4420-venue-tab-pill"
          tabProps={webTabPropsFor}
          tabRef={(tab: PublicVenueTab, node: GlassTabNode | null) => {
            tabRefs.current[tab] = (node as FocusableVenueTab | null) ?? undefined;
          }}
          tabStyle={focusOutlineFor}
        />
      ) : null}
      {Platform.OS === "web" ? (
        tabs.map((tab: PublicVenueTab) => {
          const active = tab === activeTab;
          return (
            <WebVenuePanel
              key={tab}
              id={panelId(tab)}
              role="tabpanel"
              aria-hidden={!active}
              aria-labelledby={tabId(tab)}
              tabIndex={active ? 0 : -1}
              style={[styles.pane, !active && styles.hiddenPanel]}
            >
              {active || (tab === "menu" && keepMenu)
                ? contentByTab[tab]
                : null}
            </WebVenuePanel>
          );
        })
      ) : (
        <View style={styles.pane}>
          {activeTab === "menu" && keepMenu
            ? null
            : (contentByTab[activeTab] ?? overview)}
          {keepMenu ? (
            // One fixed slot, so moving between tabs never remounts the menu.
            <View
              testID="issue-4490-menu-pane"
              style={activeTab === "menu" ? null : styles.hiddenPanel}
              accessibilityElementsHidden={activeTab !== "menu"}
              importantForAccessibility={
                activeTab === "menu" ? "auto" : "no-hide-descendants"
              }
            >
              {menu}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
});

/**
 * issue #4420 — the pinned copy of the tab pill. Native has no CSS sticky,
 * so the venue screen shows this copy under the glass header once the
 * in-flow strip has scrolled under it; a tap selects through the in-flow
 * strip's own handler (same state, same analytics).
 */
export interface PublicVenueTabPillProps {
  hasMenu: boolean;
  tabs?: readonly PublicVenueTab[];
  labels?: Partial<Record<PublicVenueTab, string>>;
  activeTab: PublicVenueTab;
  palette: ThemePalette;
  theme: ResolvedTheme;
  onSelect: (tab: PublicVenueTab) => void;
  testID?: string;
}
export const PublicVenueTabPill = ({
  hasMenu,
  tabs: tabsProp,
  labels,
  activeTab,
  palette,
  theme,
  onSelect,
  testID = "issue-4420-venue-tab-pill-pinned",
}: PublicVenueTabPillProps) => {
  const tabs: PublicVenueTab[] =
    tabsProp === undefined ? legacyTabs(hasMenu) : [...tabsProp];
  return (
    <GlassTabs
      items={tabs.map((tab: PublicVenueTab) => ({
        key: tab,
        label: labels?.[tab] ?? LABELS[tab],
      }))}
      activeKey={activeTab}
      onSelect={onSelect}
      palette={palette}
      theme={theme}
      pinned
      testID={testID}
    />
  );
};

const styles = StyleSheet.create({
  pane: {
    marginTop: 20,
  },
  hiddenPanel: {
    display: "none",
  },
});
