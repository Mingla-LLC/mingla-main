import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { creatorProgramService, setupChecks } from '../../src/services/creatorProgramService';
import { creatorGigsService, type CreatorHomeContract, type PublicGig } from '../../src/services/creatorGigsService';
import { programErrorText } from '../../src/services/programResult';
import {
  CLOSED_CONTRACT_STATES, FORMAT_INFO, budgetDisplay, creatorOwnsNextStep, creatorStateWords, deliverablesLabel, formatDateRange,
  formatDue, formatMoney, formatName, formatShortDate, nicheLabel, setupMinutesLeft,
} from '../../src/utils/programFormat';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramEmpty, ProgramLoadError, ProgramLoading, ProgramNotice, ProgramPill, ProgramScreen, programStyles as s } from '../../src/components/programs/ProgramUi';
import { ChoiceSheet, Chip, LevelDots, Segmented, type Choice } from '../../src/components/programs/ProgramPickers';
import { GlassIconButton } from '../../src/components/ui/GlassIconButton';
import { Icon } from '../../src/components/ui/Icon';

type Tab = 'work' | 'gigs' | 'interest';
type Budget = 'any' | 'b1' | 'b2' | 'b3' | 'b4';

const VERIFICATION_COPY: Record<string, { title: string; text: string }> = {
  review: { title: 'A person is checking one thing', text: 'Most profiles verify instantly. Yours was flagged, so someone at Mingla takes a look, usually within a day.' },
  needs_more: { title: 'Mingla asked for one more thing', text: 'See what’s needed and resubmit. Everything else is already accepted.' },
  declined: { title: 'Your Creator profile wasn’t approved', text: 'See the reason and what you can do next.' },
  suspended: { title: 'Your Creator profile is paused', text: 'Hosts can’t see you right now. See why.' },
};

export default function CreatorHubScreen(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('work');
  const [cityId, setCityId] = useState<string | null>(null);
  const [formatKey, setFormatKey] = useState<string | null>(null);
  const [budget, setBudget] = useState<Budget>('any');
  const [savedOnly, setSavedOnly] = useState(false);
  const [sheet, setSheet] = useState<'city' | 'format' | 'budget' | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const status = useQuery({ queryKey: ['creator', 'status'], queryFn: () => creatorProgramService.status() });
  const profile = useQuery({ queryKey: ['creator', 'own-profile'], queryFn: () => creatorProgramService.ownProfile(), enabled: Boolean(status.data?.profile) });
  const home = useQuery({ queryKey: ['creator', 'home'], queryFn: () => creatorGigsService.home(), enabled: Boolean(status.data?.profile) });
  const earnings = useQuery({ queryKey: ['creator', 'earnings'], queryFn: () => creatorGigsService.earningsSummary(), enabled: Boolean(status.data?.profile), retry: 0 });
  const cities = useQuery({ queryKey: ['creator', 'cities'], queryFn: () => creatorProgramService.cities(), staleTime: 10 * 60_000 });
  const homeCity = profile.data?.home_city_id ?? null;
  const effectiveCity = cityId ?? homeCity;
  const board = useQuery({
    queryKey: ['creator', 'board', effectiveCity, formatKey],
    queryFn: () => creatorGigsService.board({ cityId: effectiveCity, formatKey }),
    enabled: Boolean(status.data?.profile),
  });

  useFocusEffect(useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['creator'] });
  }, [queryClient]));

  const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['creator'] }); };

  const checks = setupChecks(status.data);
  const done = checks.filter((c) => c.done).length;
  const verification = status.data?.verification ?? 'incomplete';
  const verified = verification === 'verified';
  const contracts = home.data?.contracts ?? [];
  const active = contracts.filter((c) => !(CLOSED_CONTRACT_STATES as readonly string[]).includes(c.state));
  const past = contracts.filter((c) => (CLOSED_CONTRACT_STATES as readonly string[]).includes(c.state));
  const needsYou = active.filter((c) => creatorOwnsNextStep(c.state)).sort((a, b) => (dueOf(a) ?? '9').localeCompare(dueOf(b) ?? '9'))[0];
  const interests = home.data?.interests ?? [];
  const saved = home.data?.saved ?? [];
  const savedIds = useMemo(() => new Set(saved.map((g) => g.id)), [saved]);

  const gigs = useMemo(() => {
    const source = savedOnly ? saved : board.data ?? [];
    return source
      .filter((g) => g.slots_left > 0)
      .filter((g) => budget === 'any' || (g.budget_band ?? '').toLowerCase() === budget)
      .filter((g) => !savedOnly || !formatKey || g.format_key === formatKey);
  }, [board.data, saved, savedOnly, budget, formatKey]);

  const toggleSave = async (gig: PublicGig): Promise<void> => {
    const next = !(gig.saved ?? savedIds.has(gig.id));
    setSavingId(gig.id);
    try {
      await creatorGigsService.saveGig(gig.id, next);
      refresh();
    } catch (error) {
      Alert.alert('Couldn’t save the gig', programErrorText(error));
    } finally { setSavingId(null); }
  };

  if (status.isLoading) return <ProgramScreen title="Creator"><ProgramLoading /></ProgramScreen>;
  if (status.isError) return <ProgramScreen title="Creator"><ProgramLoadError text={programErrorText(status.error)} onRetry={() => void status.refetch()} /></ProgramScreen>;

  const name = profile.data?.display_name ?? 'Your Creator profile';
  const sub = [...(profile.data?.niches ?? []).slice(0, 2).map(nicheLabel), profile.data?.home_city_name].filter(Boolean).join(' · ');
  const cityOptions: Array<Choice<string>> = [{ value: 'any', label: 'Any city' }, ...(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))];
  const formatOptions: Array<Choice<string>> = [{ value: 'any', label: 'Any format' }, ...FORMAT_INFO.map((f) => ({ value: f.key, label: f.name, hint: `${f.seconds[0]}–${f.seconds[1]}s` }))];
  const budgetOptions: Array<Choice<Budget>> = [
    { value: 'any', label: 'Any budget' }, { value: 'b1', label: 'Starter budget' }, { value: 'b2', label: 'Mid budget' }, { value: 'b3', label: 'High budget' }, { value: 'b4', label: 'Top budget' },
  ];
  const cityLabel = effectiveCity ? (cities.data ?? []).find((c) => c.id === effectiveCity)?.name ?? 'Your city' : 'Any city';

  return <ProgramScreen
    title="Creator"
    refreshing={home.isFetching || board.isFetching}
    onRefresh={refresh}
    right={status.data?.profile ? <GlassIconButton iconName="settings-outline" accessibilityLabel="Creator setup" size={40} onPress={() => router.push('/creator/setup' as never)} /> : undefined}
  >
    {!status.data?.profile ? <ProgramCard tone="highlight">
      <Text style={s.h1}>Get paid to make videos for hosts</Text>
      <Text style={s.copy}>Set up once: your profile, rates, a showcase video, one social account, payout and the agreement. Hosts see you when all six are done.</Text>
      <Text style={s.small}>About {setupMinutesLeft(6)} minutes</Text>
      <ProgramButton label="Start setup" onPress={() => router.push('/creator/setup' as never)} />
    </ProgramCard> : <>
      <View style={styles.me}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
        <View style={s.flex}>
          <Text style={s.title} numberOfLines={1}>{name}</Text>
          {sub ? <Text style={s.copy} numberOfLines={1}>{sub}</Text> : null}
        </View>
        <ProgramPill label={verified ? 'Visible to hosts' : 'Not visible yet'} tone={verified ? 'success' : 'neutral'} icon={verified ? 'eye' : 'eye-off'} />
      </View>

      {verified ? <>
        <View style={styles.money}>
          <MoneyTile label="On the way" value={formatMoney(earnings.data?.on_the_way_minor ?? 0, earnings.data?.currency ?? 'USD')} />
          <MoneyTile label="Ready" value={formatMoney(earnings.data?.ready_minor ?? 0, earnings.data?.currency ?? 'USD')} />
          <MoneyTile label="Paid" value={formatMoney(earnings.data?.paid_minor ?? 0, earnings.data?.currency ?? 'USD')} onPress={() => router.push('/earnings' as never)} />
        </View>
        {needsYou ? <ProgramCard tone="highlight" onPress={() => router.push(`/creator/contract/${needsYou.id}` as never)} accessibilityLabel={`Needs you: ${needsYou.title}`}>
          <Text style={s.accentText}>Needs you{dueOf(needsYou) ? ` · ${formatDue(dueOf(needsYou)).toLowerCase()}` : ''}</Text>
          <Text style={s.title}>{needsYou.title}</Text>
          <Text style={s.copy}>{creatorStateWords(needsYou.state, { deadlineAt: needsYou.deadline_at, fixRoundsUsed: needsYou.fix_rounds_used })}</Text>
          <ProgramButton label={needsYou.state === 'offered' ? 'See the offer' : 'Open'} onPress={() => router.push(`/creator/contract/${needsYou.id}` as never)} />
        </ProgramCard> : null}
      </> : VERIFICATION_COPY[verification] ? <ProgramCard tone="warning" onPress={() => router.push('/creator/status' as never)}>
        <Text style={s.title}>{VERIFICATION_COPY[verification].title}</Text>
        <Text style={s.copy}>{VERIFICATION_COPY[verification].text}</Text>
        <ProgramButton label="See status" variant="secondary" onPress={() => router.push('/creator/status' as never)} />
      </ProgramCard> : <ProgramCard tone="highlight">
        <View style={s.rowLine}><Text style={s.strong}>Setup · {done} of {checks.length}</Text><Text style={s.small}>about {setupMinutesLeft(checks.length - done)} min left</Text></View>
        <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round((done / Math.max(1, checks.length)) * 100)}%` }]} /></View>
        <Text style={s.copy}>Next: {(checks.find((c) => !c.done)?.label ?? 'Review your setup').toLowerCase()}. Hosts only see you once all six are done.</Text>
        <ProgramButton label="Continue setup" onPress={() => router.push('/creator/setup' as never)} />
      </ProgramCard>}

      <Segmented<Tab> value={tab} onChange={setTab} options={[
        { value: 'work', label: 'Work', count: active.length },
        { value: 'gigs', label: 'Find gigs', count: gigs.length },
        { value: 'interest', label: 'Interest', count: interests.length },
      ]} />

      {tab === 'work' ? <>
        {home.isError ? <ProgramNotice tone="error" text={programErrorText(home.error)} /> : null}
        {active.length === 0 ? <ProgramEmpty title="No work yet" text={verified ? 'Send interest on a gig. When a host hires you, the offer shows up here.' : 'Finish setup, then send interest on gigs you like.'}
          action={verified ? <ProgramButton label="Find gigs" variant="secondary" onPress={() => setTab('gigs')} /> : undefined} />
          : <ProgramCard>{active.map((c, i) => <ContractRow key={c.id} contract={c} isLast={i === active.length - 1} onPress={() => router.push(`/creator/contract/${c.id}` as never)} />)}</ProgramCard>}
        {past.length ? <>
          <Text style={s.label}>Past work</Text>
          <ProgramCard>{past.map((c, i) => <ContractRow key={c.id} contract={c} isLast={i === past.length - 1} onPress={() => router.push(`/creator/contract/${c.id}` as never)} />)}</ProgramCard>
        </> : null}
      </> : null}

      {tab === 'gigs' ? <>
        <View style={s.wrap}>
          <Chip label={cityLabel} selected={Boolean(effectiveCity)} onPress={() => setSheet('city')} />
          <Chip label={formatKey ? formatName(formatKey) : 'Any format'} selected={Boolean(formatKey)} onPress={() => setSheet('format')} />
          <Chip label={budgetOptions.find((b) => b.value === budget)?.label ?? 'Any budget'} selected={budget !== 'any'} onPress={() => setSheet('budget')} />
          <Chip label={`Saved${saved.length ? ` ${saved.length}` : ''}`} selected={savedOnly} onPress={() => setSavedOnly((v) => !v)} />
        </View>
        {!verified ? <ProgramNotice text="Browse now. Sending interest unlocks when setup is done." /> : null}
        {board.isLoading ? <ProgramLoading /> : board.isError ? <ProgramNotice tone="error" text={programErrorText(board.error)} />
          : gigs.length === 0 ? <ProgramEmpty title={savedOnly ? 'No saved gigs' : 'Nothing matches yet'} text={savedOnly ? 'Tap the bookmark on a gig to keep it here.' : 'Try another city, format or budget. New gigs show up as hosts post them.'} />
          : gigs.map((gig) => <GigCard key={gig.id} gig={gig} saved={gig.saved ?? savedIds.has(gig.id)} saving={savingId === gig.id}
            onSave={() => void toggleSave(gig)} onPress={() => router.push(`/creator/gig/${gig.id}` as never)} />)}
      </> : null}

      {tab === 'interest' ? (interests.length === 0 ? <ProgramEmpty title="No interest sent" text="When you send interest on a gig, it waits here until the host answers." />
        : <ProgramCard>{interests.map((item, i) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push(`/creator/gig/${item.gig_id}` as never)}
          style={[styles.item, i < interests.length - 1 && styles.itemBorder]}>
          <View style={s.flex}>
            <Text style={s.strong} numberOfLines={1}>{item.title}</Text>
            <Text style={s.copy}>Your quote {formatMoney(item.quote_minor, item.currency)} · sent {formatShortDate(item.created_at)}</Text>
          </View>
          <ProgramPill label={item.status === 'shortlisted' ? 'Shortlisted' : 'With host'} tone={item.status === 'shortlisted' ? 'accent' : 'neutral'} />
        </Pressable>)}</ProgramCard>) : null}
    </>}

    <ChoiceSheet visible={sheet === 'city'} onClose={() => setSheet(null)} title="City" searchable options={cityOptions} value={effectiveCity ?? 'any'} onSelect={(v) => setCityId(v === 'any' ? null : v)} />
    <ChoiceSheet visible={sheet === 'format'} onClose={() => setSheet(null)} title="Format" options={formatOptions} value={formatKey ?? 'any'} onSelect={(v) => setFormatKey(v === 'any' ? null : v)} />
    <ChoiceSheet visible={sheet === 'budget'} onClose={() => setSheet(null)} title="Budget" options={budgetOptions} value={budget} onSelect={setBudget} />
  </ProgramScreen>;
}

function dueOf(contract: CreatorHomeContract): string | null {
  return contract.due_at ?? contract.deadline_at ?? null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'M';
}

function MoneyTile({ label, value, onPress }: { label: string; value: string; onPress?: () => void }): React.ReactElement {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${label}: ${value}`} disabled={!onPress} onPress={onPress} style={styles.tile}>
    <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Text style={s.small}>{label}</Text>
  </Pressable>;
}

function ContractRow({ contract, isLast, onPress }: { contract: CreatorHomeContract; isLast: boolean; onPress: () => void }): React.ReactElement {
  const words = contract.state === 'offered' && contract.counter_open ? 'Counter sent · waiting for the host' : creatorStateWords(contract.state, { deadlineAt: contract.deadline_at, fixRoundsUsed: contract.fix_rounds_used });
  return <Pressable accessibilityRole="button" accessibilityLabel={`${contract.title}, ${words}`} onPress={onPress} style={({ pressed }) => [styles.item, !isLast && styles.itemBorder, pressed && s.pressed]}>
    <View style={styles.fmt}><Icon name="videocam" size={16} color={C.accent} /></View>
    <View style={s.flex}>
      <Text style={s.strong} numberOfLines={1}>{contract.title}</Text>
      <Text style={s.copy} numberOfLines={1}>{formatName(contract.format_key)} · post by {formatShortDate(contract.post_by)}</Text>
    </View>
    <View style={styles.right}>
      <Text style={s.strong}>{formatMoney(contract.fee_minor, contract.currency)}</Text>
      <Text style={[s.small, creatorOwnsNextStep(contract.state) && { color: C.accent }]} numberOfLines={1}>{words}</Text>
    </View>
  </Pressable>;
}

function GigCard({ gig, saved, saving, onSave, onPress }: { gig: PublicGig; saved: boolean; saving: boolean; onSave: () => void; onPress: () => void }): React.ReactElement {
  const budgetInfo = budgetDisplay(gig);
  return <ProgramCard onPress={onPress} accessibilityLabel={`${gig.title_public}. ${formatName(gig.format_key)}`}>
    <View style={s.rowLine}>
      <ProgramPill label={formatName(gig.format_key)} tone="accent" />
      <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Remove from saved' : 'Save gig'} accessibilityState={{ selected: saved, busy: saving }} disabled={saving} hitSlop={10} onPress={onSave}>
        <Icon name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color={saved ? C.accent : C.muted} />
      </Pressable>
    </View>
    <Text style={s.title}>{gig.title_public}</Text>
    <Text style={s.copy} numberOfLines={2}>{gig.brief_public}</Text>
    <View style={styles.foot}>
      <Text style={s.small}>{formatDateRange(gig.shoot_window.start, gig.shoot_window.end)} shoot</Text>
      <Text style={s.small}>{deliverablesLabel(gig.deliverables)}</Text>
      <Text style={s.small}>{gig.slots_left} spot{gig.slots_left === 1 ? '' : 's'} left</Text>
    </View>
    <View style={s.rowLine}>
      {budgetInfo.kind === 'range' ? <Text style={s.strong}>{budgetInfo.text}</Text> : <View style={styles.level}><LevelDots level={budgetInfo.level} /><Text style={s.small}>{budgetInfo.text}</Text></View>}
      {gig.sales_share_bps ? <Text style={s.successText}>+{Math.round(gig.sales_share_bps / 100)}% of sales</Text> : null}
    </View>
  </ProgramCard>;
}

const styles = StyleSheet.create({
  me: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.accent, fontWeight: '900', fontSize: 17 },
  money: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, padding: 12, borderRadius: 14, backgroundColor: C.field, borderWidth: 1, borderColor: C.border, gap: 2 },
  tileValue: { color: C.text, fontSize: 18, fontWeight: '900' },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: C.accent },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  fmt: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  right: { alignItems: 'flex-end', maxWidth: '42%', gap: 2 },
  foot: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 },
  level: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
