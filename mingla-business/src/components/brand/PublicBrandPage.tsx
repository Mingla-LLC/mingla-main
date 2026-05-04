/**
 * PublicBrandPage — the public-facing brand page rendered at /b/{brandSlug}.
 *
 * The IG-bio-link surface. Founders drop the URL into their IG bio, WhatsApp
 * status, email signature; anyone clicks → lands here without auth.
 *
 * 3 tabs: Upcoming · Past · About. Tabs are local UI state — the page
 * itself never branches into multiple URL variants.
 *
 * Founder-aware close chrome: `ownsThisBrand` = signed in + member of the
 * brand. Mirrors PublicEventPage's `ownsThisEvent` pattern from Cycle 6.
 * Share button: always visible, opens ShareModal with brand URL.
 *
 * Honesty model (Constitution #9 + addendum §12):
 *   - Pop-up brands render `@slug` only (no separator, no faked location)
 *   - Physical brands render `@slug · {address}` only when address is
 *     non-empty. Physical-with-empty-address renders `@slug` only too.
 *   - "Verified host since YYYY" derived from brand owner's joinedAt;
 *     suppressed if no owner-member found.
 *   - No verified blue check, no rating, no Follow CTA, no Bell, no moreH
 *     — these were all designer features cut for Constitution #1 + #9
 *     compliance. See discoveries D-INV-CYCLE7-1..5.
 *
 * Stats card: rendered only when at least ONE stat has a non-zero value
 * (followers / events / attendees). Don't show "0 followers" — looks
 * worse than no card at all.
 *
 * Past tab: capped at 10 most recent, cancelled events filtered out.
 * Past event cards link to `/e/{brandSlug}/{eventSlug}` (Cycle 6's
 * `past` variant renders the "this event has ended" state).
 *
 * Per Cycle 7 spec §1-§11 (forensics) + §12 (orchestrator addendum).
 *
 * Platform notes (color formats — Cycle 7 FX3 lesson):
 *   Inline `backgroundColor` strings on RN Views go through
 *   `@react-native/normalize-colors`, which accepts ONLY hex / rgb / rgba /
 *   hsl / hsla / hwb. CSS Color Module 4 functions (`oklch`, `lab`, `lch`,
 *   `color-mix`) silently fail on iOS+Android (component renders transparent,
 *   no error logged) and dim into invisibility on web when stacked under a
 *   dark overlay. ALWAYS use `hsl(hue, 60%, 45%)` for any inline color
 *   driven by hue — mirror `EventCover.tsx`'s `baseColour` pattern.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Head from "expo-router/head";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useBrandList, type Brand } from "../../store/currentBrandStore";
import { useLiveEventsForBrand, type LiveEvent } from "../../store/liveEventStore";
import { formatGbpRound } from "../../utils/currency";
import { formatDraftDateLine } from "../../utils/eventDateDisplay";

import { Avatar } from "../ui/Avatar";
import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { ShareModal } from "../ui/ShareModal";

interface PublicBrandPageProps {
  brand: Brand;
}

type Tab = "upcoming" | "past" | "about";

const PAST_EVENT_CAP = 10;

const canonicalUrl = (brand: Brand): string =>
  `https://business.mingla.com/b/${brand.slug}`;

// [TRANSITIONAL] OG image placeholder — exits when B-cycle backend ships
// brand cover image upload. Mirrors Cycle 6 PublicEventPage's pattern.
const ogImageUrl = (_brand: Brand): string =>
  "https://business.mingla.com/og-default.png";

// ---- Main component -------------------------------------------------

export const PublicBrandPage: React.FC<PublicBrandPageProps> = ({ brand }) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userBrands = useBrandList();
  const [activeTab, setActiveTab] = useState<Tab>("upcoming");
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);

  // Founder-aware close chrome: shown only when the visitor owns this
  // brand. Forward-compat — when B-cycle wires real auth + useBrandList
  // filters to user-owned brands, this check becomes precise. Today,
  // useBrandList returns all stub brands so it resolves to "isSignedIn".
  const ownsThisBrand = useMemo<boolean>(() => {
    if (user === null) return false;
    return userBrands.some((b) => b.id === brand.id);
  }, [user, userBrands, brand.id]);

  const allEvents = useLiveEventsForBrand(brand.id);

  const upcomingEvents = useMemo<LiveEvent[]>(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // include today
    return allEvents
      .filter((e) => {
        if (e.status === "cancelled") return false;
        if (e.date === null) return false;
        const eventTime = new Date(e.date).getTime();
        return eventTime >= cutoff;
      })
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }, [allEvents]);

  const pastEvents = useMemo<LiveEvent[]>(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return allEvents
      .filter((e) => {
        if (e.status === "cancelled") return false;
        if (e.date === null) return false;
        const eventTime = new Date(e.date).getTime();
        return eventTime < cutoff;
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, PAST_EVENT_CAP);
  }, [allEvents]);

  // Cycle 13a (DEC-092): brand.members dropped. The "Verified host since YYYY"
  // pill on the public page is suppressed in 13a; restoring it is a B-cycle
  // task once `creator_accounts.created_at` (or brand_team_members.invited_at
  // for the owner row) is wired through React Query.
  const verifiedHostSinceYear = useMemo<number | null>(() => null, []);

  const showStatsCard = useMemo<boolean>(() => {
    const s = brand.stats;
    return s.followers > 0 || s.events > 0 || s.attendees > 0;
  }, [brand.stats]);

  const handleClose = useCallback((): void => {
    // Cycle 7 FX3: route to founder brand profile, NOT all the way to
    // Account tab. Founder lands on /brand/{brand.id} where they can
    // Edit, Team, Stripe, etc. From there native back returns to Account.
    router.replace(`/brand/${brand.id}` as never);
  }, [router, brand.id]);

  const handleEventCardPress = useCallback(
    (event: LiveEvent): void => {
      // event.brandSlug is the FROZEN-at-publish slug — use it instead
      // of the current brand.slug to handle the (rare) case where the
      // brand was renamed after publish (Cycle 6 freezes brandSlug at
      // publish for exactly this URL stability).
      router.push(
        `/e/${event.brandSlug}/${event.eventSlug}` as never,
      );
    },
    [router],
  );

  const handleSocialPress = useCallback(
    async (url: string): Promise<void> => {
      try {
        if (Platform.OS === "web") {
          const win = (
            globalThis as unknown as {
              window?: { open?: (u: string, t: string) => unknown };
            }
          ).window;
          if (win?.open !== undefined) {
            win.open(url, "_blank");
            return;
          }
        }
        await Linking.openURL(url);
      } catch {
        // user-cancellable / nothing to surface
      }
    },
    [],
  );

  // Brand identity card subline
  const showLocation =
    brand.kind === "physical" &&
    brand.address !== null &&
    brand.address.trim().length > 0;
  const handleSubline = showLocation
    ? `@${brand.slug} · ${brand.address}`
    : `@${brand.slug}`;

  return (
    <View style={styles.host}>
      {/* SEO Head — web only per FX1 / Cycle 6 lesson. iOS native lacks
          a registered origin URL (DEC-071); rendering Head there throws. */}
      {Platform.OS === "web" ? (
        <Head>
          <title>{brand.displayName} on Mingla</title>
          <meta
            name="description"
            content={
              brand.bio?.slice(0, 160) ?? brand.tagline ?? brand.displayName
            }
          />
          <meta property="og:title" content={brand.displayName} />
          <meta
            property="og:description"
            content={
              brand.bio?.slice(0, 200) ?? brand.tagline ?? brand.displayName
            }
          />
          <meta property="og:url" content={canonicalUrl(brand)} />
          <meta property="og:image" content={ogImageUrl(brand)} />
          <meta property="og:type" content="profile" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={brand.displayName} />
          <meta
            name="twitter:description"
            content={
              brand.bio?.slice(0, 200) ?? brand.tagline ?? brand.displayName
            }
          />
          <link rel="canonical" href={canonicalUrl(brand)} />
        </Head>
      ) : null}

      {/* Cover band hero — hue driven by brand.coverHue (Cycle 7 FX2 + FX3).
          Uses hsl() — RN normalize-colors only accepts hex/rgb/hsl/hwb.
          See header docstring "Platform notes" for the lesson. */}
      <View style={styles.heroWrap} pointerEvents="none">
        <View
          style={[
            styles.heroGradient,
            { backgroundColor: `hsl(${brand.coverHue}, 60%, 45%)` },
          ]}
        />
        <View style={styles.heroFade} />
      </View>

      {/* Floating chrome — close (founder only) + share. */}
      <View
        style={[styles.floatingChrome, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        {ownsThisBrand ? (
          <IconChrome
            icon="close"
            size={40}
            onPress={handleClose}
            accessibilityLabel="Close"
          />
        ) : (
          <View />
        )}
        <IconChrome
          icon="share"
          size={40}
          onPress={() => setShareModalVisible(true)}
          accessibilityLabel="Share"
        />
      </View>

      {/* Scroll body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Brand identity column — Linktree-style centered (Cycle 7 FX2).
            Avatar overlaps the cover band by ~42px (half-in-half-out). */}
        <View style={styles.identityCentered}>
          <Avatar
            name={brand.displayName}
            size="hero"
            photo={brand.photo}
            style={styles.heroAvatarCentered}
          />
          <Text style={styles.brandNameCentered}>{brand.displayName}</Text>
          <Text style={styles.handleLineCentered}>{handleSubline}</Text>
        </View>

        {/* Tagline / bio (lead) — centered */}
        {brand.bio !== undefined && brand.bio.trim().length > 0 ? (
          <Text style={styles.bioLeadCentered}>{brand.bio}</Text>
        ) : brand.tagline !== undefined && brand.tagline.trim().length > 0 ? (
          <Text style={styles.bioLeadCentered}>{brand.tagline}</Text>
        ) : null}

        {/* Social icons row — Linktree-style icons-only, always visible.
            Promoted from the empty-Upcoming fallback to a permanent slot
            below the bio (Cycle 7 FX2). */}
        <SocialLinksRow
          links={brand.links}
          onPress={handleSocialPress}
          compact
        />

        {/* Stats card (only when ≥1 non-zero stat) */}
        {showStatsCard ? (
          <GlassCard
            variant="elevated"
            radius="lg"
            padding={spacing.md}
            style={styles.statsCard}
          >
            <View style={styles.statsRow}>
              {brand.stats.followers > 0 ? (
                <View style={styles.statCol}>
                  <Text style={styles.statValue}>
                    {formatStatNumber(brand.stats.followers)}
                  </Text>
                  <Text style={styles.statLabel}>FOLLOWERS</Text>
                </View>
              ) : null}
              {brand.stats.events > 0 ? (
                <View style={styles.statCol}>
                  <Text style={styles.statValue}>
                    {formatStatNumber(brand.stats.events)}
                  </Text>
                  <Text style={styles.statLabel}>EVENTS</Text>
                </View>
              ) : null}
              {brand.stats.attendees > 0 ? (
                <View style={styles.statCol}>
                  <Text style={styles.statValue}>
                    {formatStatNumber(brand.stats.attendees)}
                  </Text>
                  <Text style={styles.statLabel}>ATTENDEES</Text>
                </View>
              ) : null}
            </View>
          </GlassCard>
        ) : null}

        {/* Tabs */}
        <View style={styles.tabsRow}>
          <TabButton
            label="Upcoming"
            count={upcomingEvents.length}
            active={activeTab === "upcoming"}
            onPress={() => setActiveTab("upcoming")}
          />
          <TabButton
            label="Past"
            count={pastEvents.length}
            active={activeTab === "past"}
            onPress={() => setActiveTab("past")}
          />
          <TabButton
            label="About"
            active={activeTab === "about"}
            onPress={() => setActiveTab("about")}
          />
        </View>

        {/* Tab body */}
        {activeTab === "upcoming" ? (
          <UpcomingTab
            events={upcomingEvents}
            brand={brand}
            onEventPress={handleEventCardPress}
            onSocialPress={handleSocialPress}
          />
        ) : activeTab === "past" ? (
          <PastTab events={pastEvents} onEventPress={handleEventCardPress} />
        ) : (
          <AboutTab brand={brand} onSocialPress={handleSocialPress} />
        )}

        {/* Footer trust strip */}
        {verifiedHostSinceYear !== null ? (
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Verified host on Mingla since {verifiedHostSinceYear}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Share modal */}
      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(brand)}
        title={`${brand.displayName} on Mingla`}
        description={brand.bio?.slice(0, 200) ?? brand.tagline}
      />
    </View>
  );
};

// ---- TabButton ------------------------------------------------------

interface TabButtonProps {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({
  label,
  count,
  active,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
    style={[styles.tabButton, active && styles.tabButtonActive]}
  >
    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
      {label}
      {count !== undefined ? (
        <Text style={styles.tabCount}> {count}</Text>
      ) : null}
    </Text>
  </Pressable>
);

// ---- UpcomingTab ----------------------------------------------------

interface UpcomingTabProps {
  events: LiveEvent[];
  brand: Brand;
  onEventPress: (e: LiveEvent) => void;
  onSocialPress: (url: string) => void;
}

const UpcomingTab: React.FC<UpcomingTabProps> = ({
  events,
  brand,
  onEventPress,
  onSocialPress,
}) => {
  if (events.length === 0) {
    // Cycle 7 FX2: socials moved to permanent slot below bio (above tabs),
    // so the empty-tab copy doesn't need to repeat them here.
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={styles.emptyTabTitle}>No upcoming events yet</Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {events.map((e) => (
        <EventMiniCard key={e.id} event={e} onPress={onEventPress} />
      ))}
    </View>
  );
};

// ---- PastTab --------------------------------------------------------

interface PastTabProps {
  events: LiveEvent[];
  onEventPress: (e: LiveEvent) => void;
}

const PastTab: React.FC<PastTabProps> = ({ events, onEventPress }) => {
  if (events.length === 0) {
    return (
      <View style={styles.emptyTabWrap}>
        <Text style={styles.emptyTabTitle}>No past events to show</Text>
      </View>
    );
  }
  return (
    <View style={styles.eventList}>
      {events.map((e) => (
        <EventMiniCard key={e.id} event={e} onPress={onEventPress} past />
      ))}
    </View>
  );
};

// ---- AboutTab -------------------------------------------------------

interface AboutTabProps {
  brand: Brand;
  onSocialPress: (url: string) => void;
}

const AboutTab: React.FC<AboutTabProps> = ({ brand, onSocialPress }) => {
  const hasContact =
    (brand.contact?.email !== undefined && brand.contact.email.length > 0) ||
    (brand.contact?.phone !== undefined && brand.contact.phone.length > 0);

  return (
    <View style={styles.aboutWrap}>
      {brand.bio !== undefined && brand.bio.trim().length > 0 ? (
        <View style={styles.aboutBlock}>
          <Text style={styles.aboutBlockLabel}>About</Text>
          <Text style={styles.aboutBlockBody}>{brand.bio}</Text>
        </View>
      ) : null}
      {hasContact ? (
        <View style={styles.aboutBlock}>
          <Text style={styles.aboutBlockLabel}>Contact</Text>
          {brand.contact?.email !== undefined &&
          brand.contact.email.length > 0 ? (
            <Pressable
              onPress={() => onSocialPress(`mailto:${brand.contact?.email}`)}
              accessibilityRole="link"
              accessibilityLabel={`Email ${brand.contact.email}`}
            >
              <Text style={styles.aboutContactLink}>{brand.contact.email}</Text>
            </Pressable>
          ) : null}
          {brand.contact?.phone !== undefined &&
          brand.contact.phone.length > 0 ? (
            <Pressable
              onPress={() => onSocialPress(`tel:${brand.contact?.phone}`)}
              accessibilityRole="link"
              accessibilityLabel={`Call ${brand.contact.phone}`}
            >
              <Text style={styles.aboutContactLink}>{brand.contact.phone}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.aboutBlock}>
        <Text style={styles.aboutBlockLabel}>Find us</Text>
        <SocialLinksRow links={brand.links} onPress={onSocialPress} />
      </View>
    </View>
  );
};

// ---- SocialLinksRow -------------------------------------------------

interface SocialLinksRowProps {
  links?: Brand["links"];
  onPress: (url: string) => void;
  /**
   * Compact mode renders circular icons-only chips (Linktree style).
   * Default false renders labelled pills (used in About tab).
   * NEW in Cycle 7 FX2.
   */
  compact?: boolean;
}

interface SocialEntry {
  url: string;
  icon: IconName;
  label: string;
}

const SocialLinksRow: React.FC<SocialLinksRowProps> = ({
  links,
  onPress,
  compact = false,
}) => {
  const entries = useMemo<SocialEntry[]>(() => {
    if (links === undefined) return [];
    const out: SocialEntry[] = [];
    if (links.website !== undefined && links.website.length > 0) {
      out.push({ url: links.website, icon: "globe", label: "Website" });
    }
    if (links.instagram !== undefined && links.instagram.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.instagram, "https://instagram.com/"),
        icon: "instagram",
        label: "Instagram",
      });
    }
    if (links.tiktok !== undefined && links.tiktok.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.tiktok, "https://tiktok.com/@"),
        icon: "tiktok",
        label: "TikTok",
      });
    }
    if (links.x !== undefined && links.x.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.x, "https://x.com/"),
        icon: "x",
        label: "X",
      });
    }
    if (links.youtube !== undefined && links.youtube.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.youtube, "https://youtube.com/@"),
        icon: "youtube",
        label: "YouTube",
      });
    }
    if (links.threads !== undefined && links.threads.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.threads, "https://threads.net/@"),
        icon: "threads",
        label: "Threads",
      });
    }
    return out;
  }, [links]);

  if (entries.length === 0) return null;

  return (
    <View style={[styles.socialsRow, compact && styles.socialsRowCompact]}>
      {entries.map((s) => (
        <Pressable
          key={s.url}
          onPress={() => onPress(s.url)}
          accessibilityRole="link"
          accessibilityLabel={s.label}
          style={compact ? styles.socialBtnIconOnly : styles.socialBtn}
        >
          <Icon
            name={s.icon}
            size={compact ? 20 : 18}
            color={compact ? accent.warm : textTokens.secondary}
          />
          {compact ? null : <Text style={styles.socialLabel}>{s.label}</Text>}
        </Pressable>
      ))}
    </View>
  );
};

// ---- EventMiniCard --------------------------------------------------

interface EventMiniCardProps {
  event: LiveEvent;
  onPress: (e: LiveEvent) => void;
  past?: boolean;
}

const EventMiniCard: React.FC<EventMiniCardProps> = ({
  event,
  onPress,
  past = false,
}) => {
  const dateLine = formatDraftDateLine(event);
  const minPrice = useMemo<string | null>(() => {
    const visible = event.tickets.filter(
      (t) => t.visibility !== "hidden" && !t.isFree,
    );
    if (visible.length === 0) {
      return event.tickets.some((t) => t.visibility !== "hidden" && t.isFree)
        ? "Free"
        : null;
    }
    const prices = visible
      .map((t) => t.priceGbp ?? 0)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    if (prices.length === 0) return null;
    return `From ${formatGbpRound(prices[0])}`;
  }, [event.tickets]);

  return (
    <Pressable
      onPress={() => onPress(event)}
      accessibilityRole="button"
      accessibilityLabel={`Open event ${event.name}`}
      style={({ pressed }) => [
        styles.eventCard,
        past && styles.eventCardPast,
        pressed && styles.eventCardPressed,
      ]}
    >
      <View
        style={[
          styles.eventCover,
          { backgroundColor: `hsl(${event.coverHue}, 60%, 45%)` },
        ]}
      />
      <View style={styles.eventBody}>
        <Text style={styles.eventDate}>{dateLine}</Text>
        <Text style={styles.eventTitle} numberOfLines={2}>
          {event.name.length > 0 ? event.name : "Untitled event"}
        </Text>
        {event.venueName !== null && event.venueName.length > 0 ? (
          <Text style={styles.eventVenue} numberOfLines={1}>
            {event.venueName}
          </Text>
        ) : event.format === "online" || event.format === "hybrid" ? (
          <Text style={styles.eventVenue}>Online event</Text>
        ) : null}
        {minPrice !== null ? (
          <Text style={styles.eventPrice}>{minPrice}</Text>
        ) : null}
      </View>
    </Pressable>
  );
};

// ---- Helpers --------------------------------------------------------

const formatStatNumber = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
};

const normalizeSocialUrl = (raw: string, base: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  // Strip leading @ if present
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return `${base}${handle}`;
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  heroWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    zIndex: 0,
    overflow: "hidden",
  },
  heroGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Defensive fallback — visible if inline color fails for any reason.
    // Inline override at the call site uses hsl(brand.coverHue, 60%, 45%).
    // Use hsl/rgb/hex/hwb ONLY — RN normalize-colors rejects oklch/lab/lch
    // (CSS Color Module 4 functions are web-only on inline RN styles).
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  heroFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // 30% body-color overlay — keeps a subtle bottom-edge fade without
    // dimming the cover hue into invisibility (Cycle 7 FX3 reduced from
    // 0.55, which made even valid colors read as near-black on web).
    backgroundColor: "rgba(12, 14, 18, 0.30)",
  },
  floatingChrome: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 3,
  },
  scroll: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  // Cycle 7 FX2 — Linktree-style centered identity column.
  identityCentered: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  heroAvatarCentered: {
    marginTop: -42,
  },
  brandNameCentered: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: textTokens.primary,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  handleLineCentered: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: 2,
    textAlign: "center",
  },
  brandName: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: textTokens.primary,
  },
  handleLine: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  // Cycle 7 FX2 — centered bio with max-width.
  bioLeadCentered: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 22,
    marginBottom: spacing.md,
    textAlign: "center",
    maxWidth: 540,
    alignSelf: "center",
    paddingHorizontal: spacing.sm,
  },
  statsCard: {
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statCol: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
  },
  statLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
    letterSpacing: 1.4,
    fontWeight: "600",
    marginTop: 2,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
    marginBottom: spacing.md,
  },
  tabButton: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  tabButtonActive: {
    borderBottomColor: accent.warm,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  tabLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  tabCount: {
    color: textTokens.quaternary,
    fontWeight: "400",
  },
  eventList: {
    gap: spacing.sm,
  },
  eventCard: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  eventCardPast: {
    opacity: 0.7,
  },
  eventCardPressed: {
    opacity: 0.6,
  },
  eventCover: {
    width: 96,
    height: 116,
  },
  eventBody: {
    flex: 1,
    padding: spacing.md,
    justifyContent: "space-between",
  },
  eventDate: {
    fontSize: 10,
    color: accent.warm,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  eventVenue: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginBottom: 6,
  },
  eventPrice: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  emptyTabWrap: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTabTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  emptyTabBody: {
    fontSize: 14,
    color: textTokens.tertiary,
    textAlign: "center",
    maxWidth: 280,
    marginBottom: spacing.sm,
  },
  aboutWrap: {
    gap: spacing.lg,
  },
  aboutBlock: {
    gap: spacing.xs,
  },
  aboutBlockLabel: {
    fontSize: 11,
    color: textTokens.tertiary,
    letterSpacing: 1.4,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  aboutBlockBody: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 22,
  },
  aboutContactLink: {
    fontSize: 14,
    color: accent.warm,
    paddingVertical: 4,
  },
  socialsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  // Cycle 7 FX2 — Linktree-style icons-only row, centered.
  socialsRowCompact: {
    justifyContent: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  socialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  // Cycle 7 FX2 — circular icon-only chip for compact mode.
  socialBtnIconOnly: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  socialLabel: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  footer: {
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  footerText: {
    fontSize: 11,
    color: textTokens.quaternary,
  },
});

export default PublicBrandPage;
