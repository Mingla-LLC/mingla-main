/**
 * REVIEW-ONLY RENDER HARNESS — #1605 PILLAR 2 (expanded card).
 *
 * THIS IS NOT SHIPPED UI AND IS NOT PART OF #1609.
 *
 * It exists for one reason: Seth asked to review the expanded card design alongside
 * the collapsed one (#1609 amendment 5), and pillar 2 is not implemented. Rather than
 * quietly widening the #1609 diff by half-building the real ExpandedCardModal rewrite,
 * this route renders the pillar-2 design faithfully against FIXTURE data so the design
 * can be judged. It lives on the branch `1609-review-expanded`, never on
 * `1609-collapsed-card`, and it must be deleted or replaced by the real implementation
 * when pillar 2 is actually built.
 *
 * No network, no Supabase, no mutations. Every number below comes from #1605 pillar 2
 * §2.2 / §2.3 / §2.5 verbatim.
 *
 * Reach it with:
 *   xcrun simctl openurl <UDID> 'com.mingla.app.v2://__review1605__?state=default'
 * States: default | loading | empty | error | nocontact
 */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../src/components/ui/Icon';

// --- pillar 2 tokens (existing app tokens, restated here so the harness is standalone)
const C = {
  accent: '#eb7825',
  primary50: '#fff7ed',
  primary600: '#ea580c',
  primary700: '#c2410c',
  primary800: '#9a3412',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray700: '#374151',
  gray800: '#1f2937',
  white: '#ffffff',
};

type ReviewState = 'default' | 'loading' | 'empty' | 'error' | 'nocontact';

const FIXTURE = {
  title: 'Bar Termini',
  category: 'Cocktail Bar',
  tags: ['Aperitivo', 'Late night', 'Counter seating'],
  rating: 4.6,
  reviewCount: 2341,
  distance: '1.2 mi',
  travelTime: '8 min',
  price: '££',
  description:
    'A tiny Soho counter pouring negronis at the exact temperature they were meant to '
    + 'be served. Standing room only after eight, which is the point.',
  tip: 'Ask for the Termini Negroni — it is aged, and it is not on the menu board.',
  website: 'https://www.bartermini.com/menu',
  phone: '+44 20 7734 4545',
  address: '7 Old Compton St, London W1D 5JE',
  hoursToday: 'Today  11:00 – 23:30',
  hoursAll: [
    'Monday  11:00 – 23:00', 'Tuesday  11:00 – 23:00', 'Wednesday  11:00 – 23:00',
    'Thursday  11:00 – 23:30', 'Friday  11:00 – 00:30', 'Saturday  11:00 – 00:30',
    'Sunday  12:00 – 22:30',
  ],
};

/** §2.3 — the Website button is labelled with the DOMAIN, not the word. */
function domainOf(url: string): string {
  const host = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  return host.length > 22 ? `${host.slice(0, 21)}…` : host;
}

function Banner(): React.JSX.Element {
  return (
    <View style={s.banner}>
      <Text style={s.bannerText}>
        REVIEW ONLY — #1605 pillar 2 design, fixture data. Not shipped, not in the #1609 PR.
      </Text>
    </View>
  );
}

function SheetHeader(): React.JSX.Element {
  // §2.2 — close is UNCONDITIONAL. 32x32, r16, gray100, icon 16 gray500, hitSlop 12.
  return (
    <View style={s.header}>
      <View style={s.closeBtn}>
        <Icon name="close" size={16} color={C.gray500} />
      </View>
      <View style={s.grabber} />
      <View style={s.headerSpacer} />
    </View>
  );
}

function Pill({ icon, label }: { icon: string; label: string }): React.JSX.Element {
  return (
    <View style={s.pill}>
      <Icon name={icon} size={13} color={C.gray700} />
      <Text style={s.pillText}>{label}</Text>
    </View>
  );
}

function Identity(): React.JSX.Element {
  return (
    <View style={s.block}>
      <Text style={s.title}>{FIXTURE.title}</Text>
      <Text style={s.category}>
        {FIXTURE.category} · {FIXTURE.tags.join(' · ')}
      </Text>
      <View style={s.pillRow}>
        {/* §2.1 — reviewCount is fetched today and never rendered; pillar 2 renders it. */}
        <Pill icon="star" label={`${FIXTURE.rating} (${FIXTURE.reviewCount.toLocaleString()})`} />
        <Pill icon="location" label={FIXTURE.distance} />
        <Pill icon="navigate" label={`${FIXTURE.travelTime} drive`} />
        <Pill icon="restaurant" label={FIXTURE.price} />
      </View>
      <Text style={s.body}>{FIXTURE.description}</Text>
      <View style={s.tip}>
        <Icon name="alert-circle" size={16} color={C.primary600} />
        <Text style={s.tipText}>{FIXTURE.tip}</Text>
      </View>
    </View>
  );
}

function ActionDeck({ showContact }: { showContact: boolean }): React.JSX.Element {
  // §2.3 Row A. Save is primary700 #c2410c, NOT accent #eb7825: white on #eb7825 is
  // 3.02:1 and fails AA for the 15/600 label; #c2410c is 5.86:1 and is already in the
  // primary ramp. That is the one place brand and accessibility genuinely conflict.
  const outbound: Array<{ icon: string; label: string; a11y: string }> = [
    { icon: 'navigate', label: 'Directions', a11y: 'Get directions' },
  ];
  if (showContact) {
    outbound.push({ icon: 'call', label: 'Call', a11y: `Call, ${FIXTURE.phone}` });
    outbound.push({
      icon: 'globe',
      label: domainOf(FIXTURE.website),
      a11y: `Open website, ${domainOf(FIXTURE.website)}`,
    });
  }
  return (
    <View>
      <View style={s.rowA}>
        <View style={[s.primaryBtn, { backgroundColor: C.primary700 }]}>
          <Icon name="bookmark-outline" size={20} color={C.white} />
          <Text style={[s.primaryLabel, { color: C.white }]}>Save</Text>
        </View>
        <View style={[s.primaryBtn, { backgroundColor: C.gray800 }]}>
          <Icon name="calendar-outline" size={20} color={C.white} />
          <Text style={[s.primaryLabel, { color: C.white }]}>Schedule</Text>
        </View>
        <View style={[s.primaryBtn, s.shareBtn]}>
          <Icon name="share-outline" size={20} color={C.gray700} />
          <Text style={[s.primaryLabel, { color: C.gray700 }]}>Share</Text>
        </View>
      </View>

      {/* §2.3 Row B — layout adapts to COUNT. Missing is hidden, never disabled. */}
      <View style={s.rowB}>
        {outbound.map((o) => (
          <View key={o.label} style={s.outboundBtn} accessibilityLabel={o.a11y}>
            <Icon name={o.icon} size={18} color={C.primary600} />
            <Text style={s.outboundText} numberOfLines={1} ellipsizeMode="tail">
              {o.label}
            </Text>
          </View>
        ))}
      </View>
      {!showContact ? (
        <Text style={s.note}>
          This venue has no website and no phone number. Both buttons are absent, not
          greyed out, and Directions reflows to full width — §2.3, hide don&apos;t disable.
        </Text>
      ) : null}

      {/* §2.2 item 6 — "I've been here", a quiet secondary row (pillar 4). */}
      <View style={s.beenRow}>
        <Icon name="checkmark-circle" size={18} color={C.gray500} />
        <Text style={s.beenText}>I&apos;ve been here</Text>
      </View>
    </View>
  );
}

function Section({
  title, children,
}: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={s.block}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Body({ state }: { state: ReviewState }): React.JSX.Element {
  if (state === 'loading') {
    // §2.5 — chrome renders immediately; the hero is a placeholder, never a blank sheet.
    return (
      <View>
        <View style={s.heroLoading}>
          <ActivityIndicator color={C.gray400} />
        </View>
        <View style={s.block}>
          <View style={[s.skel, { width: '62%', height: 26 }]} />
          <View style={[s.skel, { width: '40%', height: 14, marginTop: 10 }]} />
          <View style={[s.skel, { width: '100%', height: 14, marginTop: 18 }]} />
          <View style={[s.skel, { width: '86%', height: 14, marginTop: 8 }]} />
        </View>
      </View>
    );
  }
  if (state === 'empty') {
    // §2.5 — the existing 200pt honest placeholder, preserved.
    return (
      <View>
        <View style={s.heroEmpty}>
          <Icon name="image-outline" size={48} color={C.gray400} />
          <Text style={s.emptyText}>No images available</Text>
        </View>
        <Identity />
        <ActionDeck showContact />
        <Section title="Weather">
          <Text style={s.muted}>
            No forecast for this venue. The section returns null rather than rendering an
            &quot;unavailable&quot; row — §2.5.
          </Text>
        </Section>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <View>
        <View style={s.heroEmpty}>
          <Icon name="alert-circle" size={44} color={C.primary600} />
        </View>
        <View style={s.block}>
          <View style={s.errorBox}>
            <Icon name="alert-circle" size={18} color={C.primary800} />
            <View style={{ flex: 1 }}>
              <Text style={s.errorTitle}>Couldn&apos;t open that</Text>
              <Text style={s.errorBody}>
                The link may no longer work. §2.3 rule 2 — every open is awaited and
                caught, and the failure is surfaced, never swallowed.
              </Text>
            </View>
          </View>
          <View style={s.errorActions}>
            <View style={s.retryBtn}><Text style={s.retryText}>Retry</Text></View>
            <View style={s.retryBtn}><Text style={s.retryText}>Copy link</Text></View>
          </View>
        </View>
      </View>
    );
  }
  const showContact = state !== 'nocontact';
  return (
    <View>
      <View style={s.hero}>
        <Text style={s.heroLabel}>hero gallery · 300pt · pager + dots</Text>
        <View style={s.dots}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[s.dot, i === 0 ? s.dotOn : null]} />
          ))}
        </View>
      </View>
      <Identity />
      <ActionDeck showContact={showContact} />
      <Section title="Opening hours">
        <Text style={s.body}>{FIXTURE.hoursToday}</Text>
        {FIXTURE.hoursAll.map((h) => <Text key={h} style={s.muted}>{h}</Text>)}
      </Section>
      <Section title="Experiences here">
        <View style={s.infoRow}>
          <Icon name="people" size={18} color={C.primary600} />
          <Text style={s.body}>Negroni masterclass · Thursdays 18:30</Text>
        </View>
      </Section>
      <Section title="Weather">
        <View style={s.infoRow}>
          <Icon name="partly-sunny" size={18} color={C.primary600} />
          <Text style={s.body}>14°C, light cloud at 19:00</Text>
        </View>
      </Section>
      <Section title="How busy">
        <View style={s.infoRow}>
          <Icon name="time-outline" size={18} color={C.primary600} />
          <Text style={s.body}>Usually busy around 21:00</Text>
        </View>
      </Section>
      <Section title="Details">
        <Text style={s.body} selectable>{FIXTURE.address}</Text>
      </Section>
    </View>
  );
}

export default function Review1605(): React.JSX.Element {
  const params = useLocalSearchParams<{ state?: string }>();
  const insets = useSafeAreaInsets();
  const raw = String(params.state ?? 'default');
  const state: ReviewState = (
    ['default', 'loading', 'empty', 'error', 'nocontact'].includes(raw) ? raw : 'default'
  ) as ReviewState;
  return (
    <View style={s.root}>
      <View style={[s.sheet, { paddingTop: 0 }]}>
        <SheetHeader />
        <ScrollView
          style={s.scroll}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
        >
          <Banner />
          <Body state={state} />
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', justifyContent: 'flex-end' },
  sheet: {
    height: '92%', backgroundColor: C.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden',
  },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingTop: 10, paddingBottom: 8,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.gray100,
    alignItems: 'center', justifyContent: 'center',
  },
  grabber: {
    flex: 1, height: 4, maxWidth: 40, borderRadius: 2,
    backgroundColor: C.gray200, marginHorizontal: 12,
  },
  headerSpacer: { width: 32 },
  banner: {
    backgroundColor: '#fef3c7', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#fde68a',
  },
  bannerText: { fontSize: 11, fontWeight: '700', color: '#92400e' },
  hero: {
    height: 300, backgroundColor: '#111827',
    alignItems: 'center', justifyContent: 'center',
  },
  heroLabel: { color: C.gray400, fontSize: 13, fontWeight: '600' },
  dots: { flexDirection: 'row', gap: 6, marginTop: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { backgroundColor: C.white, width: 18 },
  heroLoading: {
    height: 300, backgroundColor: C.gray100, alignItems: 'center', justifyContent: 'center',
  },
  heroEmpty: {
    height: 200, backgroundColor: C.gray100, alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  emptyText: { color: C.gray500, fontSize: 14, fontWeight: '600' },
  block: { paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 24, fontWeight: '700', color: C.gray800, lineHeight: 30 },
  category: { fontSize: 14, fontWeight: '600', color: C.gray500, marginTop: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
    backgroundColor: C.gray100,
  },
  pillText: { fontSize: 13, fontWeight: '600', color: C.gray700 },
  body: { fontSize: 15, lineHeight: 22, color: C.gray700, marginTop: 10 },
  muted: { fontSize: 13, lineHeight: 20, color: C.gray500, marginTop: 2 },
  tip: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12,
    backgroundColor: C.primary50, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(235,120,37,0.28)',
  },
  tipText: { flex: 1, fontSize: 13, lineHeight: 19, color: C.primary800, fontWeight: '600' },
  rowA: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 16 },
  primaryBtn: {
    flex: 1, minHeight: 52, borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  shareBtn: { backgroundColor: C.white, borderWidth: 1, borderColor: C.gray200 },
  primaryLabel: { fontSize: 15, fontWeight: '600' },
  rowB: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 12 },
  outboundBtn: {
    flex: 1, minHeight: 48, borderRadius: 12, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.primary50, borderWidth: 1, borderColor: 'rgba(235,120,37,0.28)',
  },
  outboundText: { fontSize: 14, fontWeight: '600', color: C.primary800 },
  note: {
    marginHorizontal: 16, marginTop: 10, fontSize: 12, lineHeight: 17,
    color: C.gray500, fontStyle: 'italic',
  },
  beenRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: C.gray200,
  },
  beenText: { fontSize: 15, fontWeight: '600', color: C.gray700 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: C.gray800 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  skel: { backgroundColor: C.gray100, borderRadius: 6 },
  errorBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: C.primary50, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: 'rgba(235,120,37,0.28)',
  },
  errorTitle: { fontSize: 15, fontWeight: '700', color: C.primary800 },
  errorBody: { fontSize: 13, lineHeight: 19, color: C.primary800, marginTop: 4 },
  errorActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  retryBtn: {
    flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.gray200, backgroundColor: C.white,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: C.gray700 },
});
