/**
 * TabSwitchScaffold — the destination's own structure, painted on the tap frame.
 *
 * Issue #1638 (Track B: stop the acknowledgement finishing before the work starts).
 *
 * WHAT WAS WRONG
 * --------------
 * ORCH-0995 fixed "the highlight lags the tap" by moving the highlight EARLIER
 * (optimistic `pendingPage` in GlassBottomNav) and the mount LATER
 * (`React.startTransition` in app/index.tsx). It never made the mount cheaper, and a
 * React transition keeps the PREVIOUS UI committed until the new render finishes. With
 * no `Suspense` boundary and no `isPending` consumer anywhere in the app, there was
 * nothing to render in between — so the pill moved, the haptic fired, and then the user
 * stared at the screen they had just left. Measured on a Samsung SM-A725F: 48ms (p50) of
 * pure scheduling gap before React even began rendering the destination, and 589ms (p50)
 * / 1190ms (p90) from tap to the destination's first frame, with the OLD screen fully
 * painted and fully interactive for all of it.
 *
 * WHAT THIS DOES
 * --------------
 * On the tap frame — in the URGENT lane, before the deferred mount is even scheduled —
 * the tab content area is replaced by the DESTINATION's own structure: its glass header
 * band, its pill bar, its card frames, its list rows. The screen changes immediately and
 * it changes into the thing you asked for.
 *
 * RULES THIS FOLLOWS
 * ------------------
 *  - NEVER a naked spinner. Umbrella #1635 bans a spinner where real structure could be
 *    shown, and the bare spinner ConnectionsPage opens with is one of that umbrella's own
 *    findings. Every page here gets its real skeleton.
 *  - BOUND TO THE TRANSITION, NEVER TO A TIMER. The scaffold is cleared by the
 *    destination's own commit (a layout effect in TabSwitchHost), not by a duration. It
 *    cannot outlive the data, and it cannot be tuned into a lie.
 *  - CHEAP. Static `StyleSheet` views only. No images, no queries, no BlurView, no
 *    `AccessibilityInfo` probe, no context beyond safe-area insets. If the pending state
 *    cost real time it would be part of the problem.
 *  - OPAQUE. It fully covers the outgoing screen — which also stops the stale screen
 *    from staying interactive after you have already asked to leave it.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { glass } from '../../constants/designSystem';
import { useA11yPreferences } from '../../hooks/useA11yPreferences';
import { markTabSwitch } from '../../utils/tabSwitchPerf';

const c = glass.chrome;
const d = glass.discover;

/** Low-contrast placeholder fill — reads as "structure, content arriving". */
const BLOCK = 'rgba(255, 255, 255, 0.055)';
const BLOCK_STRONG = 'rgba(255, 255, 255, 0.075)';
const HAIRLINE = 'rgba(255, 255, 255, 0.10)';

const HEADER_RADIUS = 28;
const BREATHE_MS = 900;
const BREATHE_MIN = 0.55;

export type ScaffoldPage = 'home' | 'discover' | 'connections' | 'likes' | 'profile';

const SCREEN_BG: Record<ScaffoldPage, string> = {
  home: '#0c0e12',
  discover: d.screenBg,
  connections: d.screenBg,
  likes: d.screenBg,
  profile: glass.profile.screenBg,
};

const Block = ({ style }: { style: object }): React.ReactElement => (
  <View style={[styles.block, style]} />
);

/** Glass header panel shared by Discover / Friends / Likes. */
const HeaderPanel = ({
  top,
  bands,
}: {
  top: number;
  bands: React.ReactNode;
}): React.ReactElement => (
  <View style={[styles.headerPanel, { height: top }]}>
    <View style={styles.headerPanelHairline} />
    {bands}
  </View>
);

const HomeSkeleton = ({ insetTop }: { insetTop: number }): React.ReactElement => (
  <>
    {/* GlassTopBar — two floating circular controls */}
    <Block style={[styles.topBarCircle, { top: insetTop + 8, left: 16 }]} />
    <Block style={[styles.topBarCircle, { top: insetTop + 8, right: 16 }]} />
    {/* The deck card fills the viewport; its info plate sits at the bottom. */}
    <View style={styles.deckCard}>
      <View style={styles.deckPlate}>
        <Block style={styles.deckTitle} />
        <Block style={styles.deckMetaRow} />
        <Block style={styles.deckCta} />
      </View>
    </View>
  </>
);

const DiscoverSkeleton = ({ insetTop }: { insetTop: number }): React.ReactElement => (
  <>
    <HeaderPanel
      top={insetTop + c.row.topInset + 36 + 52 + 4}
      bands={
        <>
          <Block style={[styles.title, { top: insetTop + c.row.topInset }]} />
          <View style={[styles.pillRow, { top: insetTop + c.row.topInset + 36 + 8 }]}>
            <Block style={styles.chip} />
            <Block style={styles.chip} />
            <Block style={styles.chipWide} />
          </View>
        </>
      }
    />
    {/* Map canvas + the floating result card that sits over it. */}
    <View style={styles.mapCanvas} />
    <Block style={styles.mapFloatingCard} />
  </>
);

const ConnectionsSkeleton = ({ insetTop }: { insetTop: number }): React.ReactElement => {
  const headerHeight = insetTop + c.row.topInset + 48 + 8;
  return (
    <>
      <HeaderPanel
        top={headerHeight}
        bands={
          <View style={[styles.headerRow, { top: insetTop + c.row.topInset }]}>
            <Block style={styles.title} />
            <View style={styles.headerRowActions}>
              <Block style={styles.headerCircle} />
              <Block style={styles.headerCircle} />
            </View>
          </View>
        }
      />
      <View style={{ marginTop: headerHeight + 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={styles.chatRow}>
            <Block style={styles.avatar} />
            <View style={styles.chatRowText}>
              <Block style={styles.chatName} />
              <Block style={styles.chatPreview} />
            </View>
          </View>
        ))}
      </View>
    </>
  );
};

const LikesSkeleton = ({ insetTop }: { insetTop: number }): React.ReactElement => {
  const headerHeight = insetTop + c.row.topInset + 36 + 52 + 4;
  return (
    <>
      <HeaderPanel
        top={headerHeight}
        bands={
          <>
            <Block style={[styles.title, { top: insetTop + c.row.topInset }]} />
            <View style={[styles.pillRow, { top: insetTop + c.row.topInset + 36 + 8 }]}>
              <Block style={styles.pillTab} />
              <Block style={styles.pillTab} />
            </View>
          </>
        }
      />
      <View style={[styles.tileGrid, { marginTop: headerHeight + 12 }]}>
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} style={styles.tile} />
        ))}
      </View>
    </>
  );
};

const ProfileSkeleton = ({ insetTop }: { insetTop: number }): React.ReactElement => (
  <View style={{ marginTop: insetTop + 12 }}>
    {/* Hero bento card — avatar, name, bio, location */}
    <View style={[styles.bentoCard, styles.bentoHero]}>
      <Block style={styles.avatarLarge} />
      <Block style={styles.heroName} />
      <Block style={styles.heroBio} />
    </View>
    {/* Interests + stats + account cards */}
    <View style={styles.bentoCard}>
      <Block style={styles.cardLabel} />
      <View style={styles.chipWrap}>
        <Block style={styles.chip} />
        <Block style={styles.chipWide} />
        <Block style={styles.chip} />
      </View>
    </View>
    <View style={styles.bentoCard}>
      <Block style={styles.cardLabel} />
      <View style={styles.statRow}>
        <Block style={styles.stat} />
        <Block style={styles.stat} />
      </View>
    </View>
  </View>
);

export type TabSwitchScaffoldProps = {
  page: ScaffoldPage;
  /** Human label of the destination, for the screen-reader announcement. */
  label: string;
};

export const TabSwitchScaffold = ({
  page,
  label,
}: TabSwitchScaffoldProps): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useA11yPreferences();

  // Breathing runs entirely on the UI thread, so it cannot compete with the destination
  // mount for the JS thread — which is the whole reason the destination is late.
  const breathe = useSharedValue(1);
  React.useEffect(() => {
    if (reduceMotion) {
      breathe.value = 1;
      return;
    }
    breathe.value = withRepeat(
      withTiming(BREATHE_MIN, { duration: BREATHE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [breathe, reduceMotion]);

  const breatheStyle = useAnimatedStyle(() => ({ opacity: breathe.value }));

  // TS — first frame on which the destination's structure is actually on screen.
  // `__DEV__`-only; compiled out of release builds.
  React.useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => markTabSwitch('TS.scaffoldFrame'));
    return () => cancelAnimationFrame(raf);
  }, []);

  const insetTop = insets.top;

  return (
    <View
      style={[styles.root, { backgroundColor: SCREEN_BG[page] }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      testID={`tab-switch-scaffold-${page}`}
    >
      <Animated.View style={[StyleSheet.absoluteFill, breatheStyle]} pointerEvents="none">
        {page === 'home' ? <HomeSkeleton insetTop={insetTop} /> : null}
        {page === 'discover' ? <DiscoverSkeleton insetTop={insetTop} /> : null}
        {page === 'connections' ? <ConnectionsSkeleton insetTop={insetTop} /> : null}
        {page === 'likes' ? <LikesSkeleton insetTop={insetTop} /> : null}
        {page === 'profile' ? <ProfileSkeleton insetTop={insetTop} /> : null}
      </Animated.View>
    </View>
  );
};

export default TabSwitchScaffold;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // Z-ORDER. Every value here was settled on the SM-A725F, not reasoned about.
    //
    // This view is rendered by TabSwitchHost as a SIBLING of `mainContent`, between it and
    // the floating bottom nav. Two things must both be true while it is up: it must cover
    // the ENTIRE outgoing page (which runs edge to edge and under the nav), and the nav
    // must stay painted and tappable on top of it — not optional, because the spotlight
    // pill has already moved to the destination.
    //
    // On Android neither `elevation` nor a nested `zIndex` stays inside its own subtree,
    // so both of the obvious values are wrong and each fails in a different direction:
    //   - `elevation: 24` (first attempt, from inside the tab subtree) beat the outgoing
    //     page AND the nav, so the nav vanished for the whole pending window. It even hid
    //     itself: `mainContent` reserves bottom-nav space via paddingBottom ONLY while
    //     `currentPage === 'home'`, so on the home->x direction the overlay never reached
    //     that far down and looked perfect.
    //   - `zIndex: 40` fixed the nav but lost to the page headers, which carry their own
    //     `zIndex: 50` (ConnectionsPage, LikesPage) — the outgoing "Friends" title sat on
    //     top of the incoming Profile skeleton.
    //
    // 50 is the value that satisfies both, because it TIES with each competitor and the
    // tie breaks on document order:
    //     page header (50, earlier)  <  this scaffold (50)  <  bottomNavigation (50, later)
    // `elevation` stays pinned at 0; adding any back re-opens the first hole.
    zIndex: 50,
    elevation: 0,
    overflow: 'hidden',
  },
  block: {
    backgroundColor: BLOCK,
    borderRadius: 10,
  },

  // ── shared header panel ───────────────────────────────────
  headerPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderBottomLeftRadius: HEADER_RADIUS,
    borderBottomRightRadius: HEADER_RADIUS,
    backgroundColor: d.stickyHeader.fallbackSolid,
    overflow: 'hidden',
  },
  headerPanelHairline: {
    ...StyleSheet.absoluteFillObject,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  title: {
    position: 'absolute',
    left: 16,
    width: 168,
    height: 30,
    borderRadius: 8,
    backgroundColor: BLOCK_STRONG,
  },
  headerRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerRowActions: {
    flexDirection: 'row',
    gap: 10,
  },
  headerCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  pillRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 36,
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    width: 84,
    height: 36,
    borderRadius: 18,
  },
  chipWide: {
    width: 118,
    height: 36,
    borderRadius: 18,
  },
  pillTab: {
    flex: 1,
    height: 40,
    borderRadius: 20,
  },

  // ── home (Explore deck) ───────────────────────────────────
  topBarCircle: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: BLOCK_STRONG,
  },
  deckCard: {
    ...StyleSheet.absoluteFillObject,
    margin: 0,
    borderRadius: 0,
    backgroundColor: BLOCK,
    justifyContent: 'flex-end',
  },
  deckPlate: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 12,
  },
  deckTitle: {
    width: '68%',
    height: 40,
    borderRadius: 10,
    backgroundColor: BLOCK_STRONG,
  },
  deckMetaRow: {
    width: '52%',
    height: 20,
    borderRadius: 8,
  },
  deckCta: {
    width: '58%',
    height: 48,
    borderRadius: 24,
    backgroundColor: BLOCK_STRONG,
  },

  // ── discover (map) ────────────────────────────────────────
  mapCanvas: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    zIndex: -1,
  },
  mapFloatingCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 130,
    height: 128,
    borderRadius: 18,
    backgroundColor: BLOCK_STRONG,
  },

  // ── connections (chat list) ───────────────────────────────
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: BLOCK_STRONG,
  },
  chatRowText: {
    flex: 1,
    gap: 8,
  },
  chatName: {
    width: '42%',
    height: 16,
    borderRadius: 8,
  },
  chatPreview: {
    width: '76%',
    height: 12,
    borderRadius: 6,
  },

  // ── likes (saved tiles) ───────────────────────────────────
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 12,
  },
  tile: {
    width: '47%',
    height: 210,
    borderRadius: 16,
  },

  // ── profile (bento cards) ─────────────────────────────────
  bentoCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 18,
    paddingVertical: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    gap: 12,
  },
  bentoHero: {
    alignItems: 'center',
    paddingTop: 28,
  },
  avatarLarge: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: BLOCK_STRONG,
  },
  heroName: {
    width: 180,
    height: 24,
    borderRadius: 8,
    backgroundColor: BLOCK_STRONG,
  },
  heroBio: {
    width: 240,
    height: 14,
    borderRadius: 7,
  },
  cardLabel: {
    width: 120,
    height: 16,
    borderRadius: 8,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statRow: {
    flexDirection: 'row',
    gap: 12,
  },
  stat: {
    flex: 1,
    height: 72,
    borderRadius: 16,
  },
});
