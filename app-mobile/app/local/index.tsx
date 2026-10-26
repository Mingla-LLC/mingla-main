import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { localCityRate, localProgramService, type LocalHome, type LocalLanding, type LocalMonth } from '../../src/services/localProgramService';
import { payoutService } from '../../src/services/payoutService';
import { programErrorText } from '../../src/services/programResult';
import { formatDaysLeft, formatMoney, formatMonth, formatShortDate, parseDay, toDayString } from '../../src/utils/programFormat';
import { APPLICATION_COPY, LOCAL_STEPS, localMoneyWord, localMonthWords, localStepIndex } from '../../src/components/local/localWords';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramEmpty, ProgramField, ProgramLoadError, ProgramLoading, ProgramNotice, ProgramPill, ProgramRow, ProgramScreen, programStyles as s } from '../../src/components/programs/ProgramUi';
import { ChoiceField, Chip, DateField, ToggleRow } from '../../src/components/programs/ProgramPickers';
import { Icon } from '../../src/components/ui/Icon';

export default function LocalScreen(): React.ReactElement {
  const queryClient = useQueryClient();
  const landing = useQuery({ queryKey: ['local', 'landing'], queryFn: () => localProgramService.landing() });
  const home = useQuery({ queryKey: ['local', 'home'], queryFn: () => localProgramService.home(), enabled: Boolean(landing.data?.local) });
  const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['local'] }); };

  if (landing.isLoading || (landing.data?.local && home.isLoading)) return <ProgramScreen title="Mingla Local"><ProgramLoading /></ProgramScreen>;
  if (landing.isError || !landing.data) return <ProgramScreen title="Mingla Local"><ProgramLoadError text={programErrorText(landing.error)} onRetry={refresh} /></ProgramScreen>;
  if (landing.data.local && home.data) return <LocalMonthHome landing={landing.data} home={home.data} refreshing={home.isFetching} onRefresh={refresh} />;
  const latest = landing.data.applications[0];
  if (latest && latest.status !== 'accepted') return <ApplicationStatus landing={landing.data} refreshing={landing.isFetching} onRefresh={refresh} />;
  return <ApplyForm landing={landing.data} onApplied={refresh} />;
}

// ── Apply ──────────────────────────────────────────────────────────────────

function ApplyForm({ landing, onApplied }: { landing: LocalLanding; onApplied: () => void }): React.ReactElement {
  const open = landing.enabled ? landing.programs : [];
  const initialCity = open.find((p) => p.city_id === landing.viewer_city_id)?.city_id ?? (open.length === 1 ? open[0].city_id : null);
  const [cityId, setCityId] = useState<string | null>(initialCity);
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [links, setLinks] = useState<string[]>(['']);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const city = open.find((p) => p.city_id === cityId) ?? null;
  const rate = localCityRate(city);
  const cleanLinks = links.map((l) => l.trim()).filter(Boolean);
  const badLink = cleanLinks.find((l) => !/^https:\/\/\S+\.\S+/i.test(l));
  const handle = (v: string): string => v.trim().replace(/^@+/, '').toLowerCase();
  const valid = Boolean(city) && why.trim().length >= 20 && why.trim().length <= 600 && (handle(instagram) || handle(tiktok)) && !badLink;

  const apply = async (): Promise<void> => {
    setTouched(true);
    if (!valid || !cityId) return;
    setBusy(true); setError(null);
    try {
      const handles: Record<string, string> = {};
      if (handle(instagram)) handles.instagram = handle(instagram);
      if (handle(tiktok)) handles.tiktok = handle(tiktok);
      await localProgramService.apply(cityId, handles, cleanLinks.slice(0, 10), why);
      onApplied();
    } catch (e) { setError(programErrorText(e)); } finally { setBusy(false); }
  };

  if (!open.length) return <ProgramScreen title="Mingla Local">
    <ProgramEmpty title="Applications aren’t open yet" text="Mingla picks a few Locals per city. We’ll let you know when your city opens." />
  </ProgramScreen>;

  return <ProgramScreen title="Mingla Local" footer={<ProgramButton label={city ? `Apply for ${city.city}` : 'Choose a city to apply'} busy={busy} disabled={!city} onPress={() => void apply()} />}>
    <ProgramCard tone="highlight">
      <Text style={s.h1}>Review one place a month. Get paid by Mingla.</Text>
      {[['1', 'You pick a place in your city each month'], ['2', 'Visit as a normal customer, then post an honest review'], ['3', 'Mingla checks it and pays you. Places never pay for reviews.']].map(([n, t]) =>
        <View key={n} style={styles.how}><View style={styles.num}><Text style={s.accentText}>{n}</Text></View><Text style={[s.copy, s.flex]}>{t}</Text></View>)}
    </ProgramCard>
    <ChoiceField label="City" title="City" placeholder="Choose your city" value={cityId}
      options={open.map((p) => ({ value: p.city_id, label: p.city, hint: `${p.seats} seat${p.seats === 1 ? '' : 's'} left${localCityRate(p) ? ` · ${formatMoney(localCityRate(p)!.minor, localCityRate(p)!.currency)} a month` : ''}`, disabled: p.seats <= 0 }))}
      onChange={setCityId} error={touched && !city ? 'Choose a city.' : null} />
    {city ? <ProgramCard>
      <ProgramRow title={`Monthly pay in ${city.city}`} value={rate ? `${formatMoney(rate.minor, rate.currency)} a month` : 'Set per city'} chevron={false} isLast />
    </ProgramCard> : null}
    <ProgramField label="Instagram" prefix="@" value={instagram} onChangeText={setInstagram} placeholder="yourhandle" autoCapitalize="none" autoCorrect={false} spellCheck={false} />
    <ProgramField label="TikTok (optional)" prefix="@" value={tiktok} onChangeText={setTiktok} placeholder="yourhandle" autoCapitalize="none" autoCorrect={false} spellCheck={false}
      error={touched && !handle(instagram) && !handle(tiktok) ? 'Add at least one account.' : null} />
    <View style={{ gap: 8 }}>
      <Text style={s.fieldLabel}>Sample posts or reviews (links)</Text>
      {links.map((l, i) => <View key={i} style={styles.linkRow}>
        <View style={s.flex}><ProgramField value={l} onChangeText={(v) => setLinks(links.map((x, j) => (j === i ? v : x)))} placeholder="https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" accessibilityLabel={`Sample link ${i + 1}`} /></View>
        {links.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove link ${i + 1}`} onPress={() => setLinks(links.filter((_, j) => j !== i))} hitSlop={10}><Icon name="close-circle-outline" size={22} color={C.muted} /></Pressable> : null}
      </View>)}
      {touched && badLink ? <Text style={s.fieldErrorText}>Links must start with https://</Text> : null}
      {links.length < 10 ? <ProgramButton label="Add another link" variant="ghost" icon="add" onPress={() => setLinks([...links, ''])} /> : null}
    </View>
    <ProgramField label="Why you’d be a good Local" value={why} onChangeText={setWhy} multiline counter={{ max: 600, min: 20 }} maxLength={600}
      placeholder="Where you go, what you notice, who you tell" error={touched && why.trim().length < 20 ? 'Write at least 20 characters.' : null} />
    {error ? <ProgramNotice tone="error" text={error} /> : null}
  </ProgramScreen>;
}

// ── Application status ─────────────────────────────────────────────────────

function ApplicationStatus({ landing, refreshing, onRefresh }: { landing: LocalLanding; refreshing: boolean; onRefresh: () => void }): React.ReactElement {
  const app = landing.applications[0];
  const copy = APPLICATION_COPY[app.status] ?? APPLICATION_COPY.submitted;
  const reviewing = app.status === 'submitted' || app.status === 'shortlisted';
  const steps = [
    { title: 'Applied', sub: formatShortDate(app.created_at), done: true },
    { title: 'Mingla reviews your samples', sub: null, done: false, now: reviewing },
    { title: 'Sign the Local agreement', sub: null, done: false },
    { title: 'Pick your first place', sub: 'Picks open on the 1st of each month', done: false },
  ];
  return <ProgramScreen title="Mingla Local" refreshing={refreshing} onRefresh={onRefresh}>
    <ProgramCard tone={app.status === 'rejected' ? 'base' : 'highlight'}>
      <ProgramPill label={copy.pill} tone={app.status === 'rejected' ? 'neutral' : app.status === 'waitlisted' ? 'warning' : 'accent'} />
      <Text style={s.title}>{copy.title}</Text>
      <Text style={s.copy}>{app.city} · sent {formatShortDate(app.created_at)}. {copy.text}</Text>
    </ProgramCard>
    {reviewing ? <ProgramCard>{steps.map((st, i) => <ProgramRow key={st.title} title={st.title} subtitle={st.sub} done={st.done} subtitleTone={st.now ? 'accent' : 'muted'} isLast={i === steps.length - 1} />)}</ProgramCard> : null}
    <Text style={s.small}>Not selected this time? You can apply again in 90 days. Waitlisted? You’ll move up when a seat opens.</Text>
  </ProgramScreen>;
}

// ── Month home ─────────────────────────────────────────────────────────────

function LocalMonthHome({ landing, home, refreshing, onRefresh }: { landing: LocalLanding; home: LocalHome; refreshing: boolean; onRefresh: () => void }): React.ReactElement {
  const router = useRouter();
  const now = new Date();
  const thisMonth = toDayString(new Date(now.getFullYear(), now.getMonth(), 1));
  const months = useMemo(() => {
    const list = home.months.slice();
    if (!list.some((m) => m.month === thisMonth)) list.unshift({ id: '', month: thisMonth, status: '', place_id: null } as LocalMonth);
    return list.sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  }, [home.months, thisMonth]);
  const [selected, setSelected] = useState(thisMonth);
  const month = months.find((m) => m.month === selected) ?? null;
  const current = selected === thisMonth ? home.current_month : month;
  const names = useQuery({ queryKey: ['local', 'place-names', home.months.map((m) => m.place_id).join(',')], queryFn: () => localProgramService.placeNames(home.months.map((m) => m.place_id ?? '')) });
  const payout = useQuery({ queryKey: ['creator', 'payout'], queryFn: () => payoutService.status(), retry: 0 });
  const program = landing.programs.find((p) => p.city_id === home.local.city_id);
  const rate = localCityRate(program);
  const placeName = (m: LocalMonth | null): string => (m?.place_name ?? (m?.place_id ? names.data?.[m.place_id] : null)) || 'Your place';
  const status = current?.status ?? '';
  const step = localStepIndex(status);
  const pickBy = new Date(now.getFullYear(), now.getMonth(), 7);
  const payWords = current?.payout_amount_minor && current.payout_currency ? formatMoney(current.payout_amount_minor, current.payout_currency) : rate ? formatMoney(rate.minor, rate.currency) : null;

  return <ProgramScreen title={`Mingla Local · ${home.local.city}`} refreshing={refreshing} onRefresh={onRefresh}>
    <View style={s.wrap}>{months.map((m) => <Chip key={m.month} label={formatMonth(m.month, m.month === selected ? 'long' : 'short')} selected={m.month === selected} onPress={() => setSelected(m.month)} />)}</View>

    {selected === thisMonth ? <>
      <ProgramCard tone="highlight">
        {!status ? <Text style={s.accentText}>Pick by {formatShortDate(pickBy)} · {formatDaysLeft(pickBy, now)}</Text> : <Text style={s.accentText}>{localMonthWords(status)}</Text>}
        <Text style={s.title}>{!status ? 'Choose this month’s place' : placeName(current)}</Text>
        {payWords ? <Text style={s.copy}>{status === 'paid' ? `${payWords} paid to your bank.` : `${payWords} when your review is approved.`}</Text> : null}
        <View style={styles.stepBar}>{LOCAL_STEPS.map((label, i) => <View key={label} style={s.flex}>
          <View style={[styles.stepLine, i < step && styles.stepDone, i === step && styles.stepNow]} />
          <Text style={[s.small, i <= step && { color: C.text }]}>{label}</Text>
        </View>)}</View>
      </ProgramCard>

      {!status ? (now.getDate() <= 7 ? <PickPlace city={home.local.city} onPicked={onRefresh} /> : <ProgramNotice text="Picks for this month closed on the 7th. Picks open again on the 1st." />) : null}
      {(status === 'picked' || status === 'confirmed') && current ? <MarkVisited month={current} onDone={onRefresh} /> : null}
      {(status === 'visited' || status === 'changes_requested') && current ? <ProgramCard>
        <Text style={s.title}>{status === 'changes_requested' ? 'Mingla asked for changes' : 'Write your review'}</Text>
        <Text style={s.copy}>{status === 'changes_requested' ? 'Update your review and send it again.' : 'Rate the place, write what you’d tell a friend, add a short video and your public post.'}</Text>
        <ProgramButton label={status === 'changes_requested' ? 'Update review' : 'Write review'} onPress={() => router.push(`/local/review?month=${current.id}` as never)} />
      </ProgramCard> : null}
      {status === 'submitted' ? <ProgramNotice text="Your review is with Mingla. We check it within a few days and tell you here." /> : null}
    </> : month ? <ProgramCard>
      <ProgramRow title={month.place_id ? placeName(month) : 'No place picked'} subtitle={localMonthWords(month.status)} value={localMoneyWord(month.status) && month.payout_amount_minor && month.payout_currency ? formatMoney(month.payout_amount_minor, month.payout_currency) : null} chevron={false} isLast />
    </ProgramCard> : null}

    <Text style={s.label}>History and pay</Text>
    {home.months.length === 0 ? <Text style={s.copy}>Your months show here once you pick your first place.</Text> : <ProgramCard>
      {home.months.map((m, i) => {
        const money = localMoneyWord(m.status);
        return <ProgramRow key={m.id} title={`${formatMonth(m.month)} · ${m.place_id ? placeName(m) : 'No place'}`} subtitle={localMonthWords(m.status)}
          right={money ? <ProgramPill label={`${m.payout_amount_minor && m.payout_currency ? `${formatMoney(m.payout_amount_minor, m.payout_currency)} · ` : ''}${money}`} tone={money === 'Paid' ? 'success' : 'neutral'} /> : null}
          chevron={false} isLast={i === home.months.length - 1} />;
      })}
    </ProgramCard>}
    <ProgramCard>
      <ProgramRow icon="cash-outline" title="Payout account" subtitle={payout.data?.summary ?? 'Checking…'} value={payout.data?.connected ? 'Connected' : null} onPress={() => router.push('/payout' as never)} isLast />
    </ProgramCard>
    {payout.data && !payout.data.connected ? <ProgramNotice tone="warning" text="Connect a bank so approved months can be paid." /> : null}
    <Text style={s.small}>Paid by Mingla, never by the places. Pay arrives after your review is approved.</Text>
  </ProgramScreen>;
}

function PickPlace({ city, onPicked }: { city: string; onPicked: () => void }): React.ReactElement {
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [tie, setTie] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(query), 350); return () => clearTimeout(t); }, [query]);
  const places = useQuery({ queryKey: ['local', 'places', term], queryFn: () => localProgramService.places(term) });
  const pick = (id: string, name: string): void => {
    if (tie) { setError('You can’t review a place where you know the owners or staff. Pick another place.'); return; }
    Alert.alert(`Pick ${name}?`, 'This is your place for the month. Visit as a normal customer.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Pick it', onPress: () => void (async () => {
        setBusyId(id); setError(null);
        try { await localProgramService.pickPlace(id, false); onPicked(); } catch (e) { setError(programErrorText(e)); } finally { setBusyId(null); }
      })() },
    ]);
  };
  const list = places.data ?? [];
  return <View style={{ gap: 12 }}>
    <ProgramField label={`Search places in ${city}`} value={query} onChangeText={setQuery} placeholder="Bars, restaurants, things to do" autoCorrect={false} returnKeyType="search" />
    {places.isLoading ? <ProgramLoading /> : places.isError ? <ProgramNotice tone="error" text={programErrorText(places.error)} />
      : list.length === 0 ? <Text style={s.copy}>No places match. Try another name.</Text>
      : <ProgramCard>{list.map((p, i) => <ProgramRow key={p.id} title={p.name}
        subtitle={p.eligible ? [p.primary_type, p.address].filter(Boolean).join(' · ') || null : p.reason ?? 'Not eligible this month'}
        subtitleTone={p.eligible ? 'muted' : 'danger'} disabled={!p.eligible}
        right={p.eligible ? <ProgramButton label="Pick" variant="secondary" busy={busyId === p.id} onPress={() => pick(p.id, p.name)} style={styles.pick} /> : <ProgramPill label="Not eligible" />}
        chevron={false} isLast={i === list.length - 1} />)}</ProgramCard>}
    <ToggleRow value={tie} onToggle={() => { setTie((v) => !v); setError(null); }} label="I know the owners or staff personally" hint="Then pick a different place. Locals review only places they have no ties to." />
    {error ? <ProgramNotice tone="error" text={error} /> : null}
  </View>;
}

function MarkVisited({ month, onDone }: { month: LocalMonth; onDone: () => void }): React.ReactElement {
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = parseDay(month.month) ?? new Date();
  const save = async (): Promise<void> => {
    if (!day) return;
    setBusy(true); setError(null);
    try { await localProgramService.markVisited(month.id, day); onDone(); } catch (e) { setError(programErrorText(e)); } finally { setBusy(false); }
  };
  return <ProgramCard>
    <Text style={s.title}>Visit as a normal customer</Text>
    <Text style={s.copy}>Pay as usual, then tell us the day you went.</Text>
    <DateField label="Visited on" value={day} onChange={setDay} minimumDate={start} maximumDate={new Date()} sheetTitle="Visited on" />
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    <ProgramButton label="I’ve visited" busy={busy} disabled={!day} onPress={() => void save()} />
  </ProgramCard>;
}

const styles = StyleSheet.create({
  how: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBar: { flexDirection: 'row', gap: 6, marginTop: 4 },
  stepLine: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', marginBottom: 4 },
  stepDone: { backgroundColor: C.accent },
  stepNow: { backgroundColor: C.accentBorder },
  pick: { minHeight: 36, paddingHorizontal: 14 },
});
