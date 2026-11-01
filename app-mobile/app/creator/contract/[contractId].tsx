import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { creatorGigsService } from '../../../src/services/creatorGigsService';
import { programErrorText } from '../../../src/services/programResult';
import {
  contractCardLabel, contractMoneyLine, creatorStateWords, currencySymbol, formatMoney, formatName, formatShortDate, formatTimeLeft, moneyInputValue, parseMoneyInput,
  releasedCardText, toDayString, agreedVideoDue, agreedVideoDueText, dueChangeInitial, dueChangePayload, dueTimeOptions,
} from '../../../src/utils/programFormat';
import { ProgramButton, ProgramCard, ProgramEmpty, ProgramField, ProgramLoading, ProgramNotice, ProgramScreen, ProgramSheet, programStyles as s } from '../../../src/components/programs/ProgramUi';
import { CalendarGrid, TimeChips } from '../../../src/components/programs/ProgramPickers';
import { JOIN_IN_FLIGHT } from '../../../src/components/programs/programRefresh';
import { useRefreshOnFocus } from '../../../src/components/programs/useProgramRefresh';
import {
  BrandCard, DeliveriesCard, DisputeCard, DisputeOpenCard, PostLinksCard, PostsStatus, ProposalCard, RatingCard, ScriptEditor, ShootSheet, TermsCard, TermsHistory, Timeline, Tracker, UploadCard,
} from '../../../src/components/creator/contract/ContractSections';
import { nextActionFor } from '../../../src/components/creator/contract/contractWords';

type Busy = 'accept' | 'decline' | 'counter' | 'shoot' | 'script' | 'transition' | 'posts' | 'dispute' | 'rate' | 'change' | 'cancel' | 'respond' | null;

export default function CreatorContractScreen(): React.ReactElement {
  const { contractId } = useLocalSearchParams<{ contractId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['creator', 'contract', contractId], queryFn: () => creatorGigsService.workspace(contractId), enabled: Boolean(contractId) });
  const [busy, setBusy] = useState<Busy>(null);
  const [errors, setErrors] = useState<Partial<Record<Exclude<Busy, null>, string>>>({});
  const [sheet, setSheet] = useState<'counter' | 'shoot' | 'change' | null>(null);
  const [counterPrice, setCounterPrice] = useState('');
  const [counterNote, setCounterNote] = useState('');
  const [dueDay, setDueDay] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState('');

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['creator'] });
  };
  // Reopened (from a notification or link) or back from the background: read it again,
  // so neither the old state nor a cached "isn't available" sticks.
  useRefreshOnFocus(() => { if (contractId) void queryClient.invalidateQueries({ queryKey: ['creator', 'contract', contractId] }, JOIN_IN_FLIGHT); });

  /** Runs one action; failures (including `{ok:false}`) stay next to the control that caused them. */
  const act = async (key: Exclude<Busy, null>, action: () => Promise<unknown>, after?: () => void): Promise<boolean> => {
    setBusy(key); setErrors((e) => ({ ...e, [key]: undefined }));
    try {
      await action();
      await refresh();
      after?.();
      return true;
    } catch (e) {
      setErrors((x) => ({ ...x, [key]: programErrorText(e) }));
      return false;
    } finally { setBusy(null); }
  };

  if (query.isLoading) return <ProgramScreen title="Contract"><ProgramLoading /></ProgramScreen>;
  const w = query.data;
  if (!w) return <ProgramScreen title="Contract"><ProgramEmpty title="This contract isn’t available" text={query.isError ? programErrorText(query.error) : 'It may have been withdrawn.'}
    action={<ProgramButton label="Back to Creator" variant="secondary" onPress={() => router.replace('/creator' as never)} />} /></ProgramScreen>;

  const state = w.contract.state;
  const terms = w.terms.find((t) => t.version === w.contract.current_terms_version) ?? w.terms[w.terms.length - 1] ?? null;
  const currency = terms?.currency ?? 'USD';
  const title = w.gig.title_public;
  const openProposal = w.proposals.find((p) => p.status === 'open');
  const openCounter = openProposal && 'fee_minor' in openProposal.changes ? openProposal : null;

  // ── Offer ──
  if (state === 'offered') {
    const decline = (): void => Alert.alert('Decline this offer?', 'The host is refunded automatically.', [
      { text: 'Keep the offer', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => void act('decline', () => creatorGigsService.refund(contractId, 'creator_decline')) },
    ]);
    const sendCounter = async (): Promise<void> => {
      const minor = parseMoneyInput(counterPrice, currency);
      if (minor === null) { setErrors((e) => ({ ...e, counter: `Enter a price above zero, like ${currencySymbol(currency)}350.` })); return; }
      if (terms && minor === terms.fee_minor) { setErrors((e) => ({ ...e, counter: 'Counter with a different price from the offer.' })); return; }
      await act('counter', () => creatorGigsService.counter(contractId, minor, counterNote), () => setSheet(null));
    };
    return <ProgramScreen title="Offer" refreshing={query.isFetching} onRefresh={() => void refresh()}
      footer={<View style={{ gap: 8 }}>
        <View style={styles.two}>
          <ProgramButton label="Decline" variant="secondary" style={s.flex} busy={busy === 'decline'} disabled={busy !== null} onPress={decline} />
          <ProgramButton label="Accept offer" style={styles.grow} busy={busy === 'accept'} disabled={busy !== null}
            onPress={() => void act('accept', () => creatorGigsService.transition(contractId, 'offered', 'accept'))} />
        </View>
        {!openCounter ? <ProgramButton label="Counter with a different price" variant="ghost" disabled={busy !== null}
          onPress={() => { setCounterPrice(terms ? moneyInputValue(terms.fee_minor, currency) : ''); setErrors((e) => ({ ...e, counter: undefined })); setSheet('counter'); }} /> : null}
      </View>}>
      <ProgramCard tone="highlight">
        <Text style={s.accentText}>{formatTimeLeft(w.contract.state_deadline_at)}</Text>
        <Text style={s.h1}>You’ve got an offer</Text>
        <Text style={s.copy}>{title} · {formatName(w.gig.format_key)}</Text>
        {terms ? <Text style={s.strong}>{formatMoney(terms.fee_minor, currency)} paid to you, already held by Mingla</Text> : null}
      </ProgramCard>
      {terms ? <TermsCard terms={terms} gig={w.gig} /> : null}
      {w.rights ? <ProgramNotice text={`${w.rights.label}. You keep copyright; the standard licence is not a negotiable offer field.`} /> : null}
      {w.pending_topup ? <ProgramNotice text="The host accepted your counter and is paying the difference. You can accept once it’s paid." /> : null}
      {openCounter ? <ProgramCard>
        <Text style={s.label}>Your counter</Text>
        <Text style={s.strong}>{formatMoney(Number(openCounter.changes.fee_minor), currency)} · waiting for the host</Text>
        {openCounter.note ? <Text style={s.copy}>“{openCounter.note}”</Text> : null}
        <Text style={s.small}>You can still accept the original offer.</Text>
      </ProgramCard> : null}
      <Text style={s.copy}>Accept to see the brand, the place and the private brief. Decline and the host is refunded automatically.</Text>
      {errors.accept ? <ProgramNotice tone="error" text={errors.accept} /> : null}
      {errors.decline ? <ProgramNotice tone="error" text={errors.decline} /> : null}

      <ProgramSheet visible={sheet === 'counter'} onClose={() => setSheet(null)} title="Counter with a different price" snapPoints={['66%']} busy={busy === 'counter'}
        footer={<ProgramButton label="Send counter" busy={busy === 'counter'} disabled={!counterPrice.trim()} onPress={() => void sendCounter()} />}>
        {terms ? <Text style={s.copy}>The offer is {formatMoney(terms.fee_minor, currency)}. If the host accepts a higher price, they pay the difference; a lower price refunds them the difference.</Text> : null}
        <ProgramField inSheet label="Your price" prefix={currencySymbol(currency)} suffix={currency} value={counterPrice}
          onChangeText={(v) => { setCounterPrice(v.replace(/[^0-9.,]/g, '')); setErrors((e) => ({ ...e, counter: undefined })); }} keyboardType="decimal-pad" error={errors.counter ?? null} />
        <ProgramField inSheet label="Note to the host (optional)" value={counterNote} onChangeText={setCounterNote} multiline counter={{ max: 300 }} maxLength={300} placeholder="Why this price" />
      </ProgramSheet>
    </ProgramScreen>;
  }

  // ── Closed without work ──
  if (['declined', 'expired', 'cancelled'].includes(state)) {
    const refund = w.events.find((e) => e.kind === 'refund_recorded');
    const refundMinor = typeof refund?.data?.refund_minor === 'number' ? refund.data.refund_minor : typeof refund?.data?.amount_minor === 'number' ? refund.data.amount_minor : null;
    return <ProgramScreen title={title}>
      <ProgramCard>
        <Text style={s.title}>{creatorStateWords(state)}</Text>
        <Text style={s.copy}>{refundMinor !== null ? `The host was refunded ${formatMoney(refundMinor, currency)}.` : 'The host is refunded automatically.'} Nothing more to do here.</Text>
      </ProgramCard>
      <Timeline events={w.events} />
    </ProgramScreen>;
  }

  // ── Contract after acceptance ──
  const plan = w.shoot_plan;
  const hostProposedShoot = Boolean(plan && !plan.confirmed_at && plan.proposed_by === 'host');
  const creatorProposedShoot = Boolean(plan && !plan.confirmed_at && plan.proposed_by === 'creator');
  const next = nextActionFor(state, { fixRoundsUsed: w.contract.fix_rounds_used, hostProposedShoot, creatorProposedShoot });
  const due = w.contract.state_deadline_at;
  const window = w.gig.shoot_window ?? (terms?.shoot_date ? { start: terms.shoot_date, end: terms.shoot_date } : null);
  const acceptedEvent = w.events.find((e) => e.kind === 'accepted');
  const canChangeTerms = ['accepted', 'shoot_planned', 'script_drafting', 'script_sent'].includes(state);
  const canCancel = canChangeTerms;
  const canDispute = ['fix_requested', 'posting', 'posts_failed', 'delivered'].includes(state);
  // After release the creator has nothing to do: the card reports the money and the 30-day check.
  const released = ['released', 'day30', 'completed', 'resolved_release'].includes(state);
  const cardText = state === 'completed' ? [releasedCardText(state, w.money_state, w.money_paid_at), next.text].filter(Boolean).join(' ')
    : released ? releasedCardText(state, w.money_state, w.money_paid_at)
    : state === 'accepted' && window ? next.text.replace('the shoot window', formatShootWindow(window)) : next.text;

  const onNextCta = (): void => {
    if (state === 'accepted') setSheet('shoot');
    else if (state === 'shoot_planned') void act('transition', () => creatorGigsService.transition(contractId, 'shoot_planned', 'start_script'));
    else if (state === 'approved') void act('transition', () => creatorGigsService.transition(contractId, 'approved', 'start_posting'));
  };
  const ctaHandled = ['accepted', 'shoot_planned', 'approved'].includes(state);

  const cancel = (): void => Alert.alert('Cancel this gig?', 'The host is refunded through their original payment. You won’t be paid for this gig.', [
    { text: 'Keep the gig', style: 'cancel' },
    { text: 'Cancel gig', style: 'destructive', onPress: () => void act('cancel', () => creatorGigsService.refund(contractId, 'creator_after_accept')) },
  ]);

  return <ProgramScreen title={title} refreshing={query.isFetching} onRefresh={() => void refresh()}>
    <BrandCard workspace={w} />

    <ProgramCard tone="highlight">
      <Text style={s.accentText}>{contractCardLabel(state, due)}</Text>
      <Text style={s.title}>{released && w.money_state === 'paid' ? 'Paid' : next.title}</Text>
      <Text style={s.copy}>{cardText}</Text>
      {hostProposedShoot && plan?.shoot_at ? <View style={styles.two}>
        <ProgramButton label="Pick another" variant="secondary" style={s.flex} disabled={busy !== null} onPress={() => setSheet('shoot')} />
        <ProgramButton label={`Confirm ${formatShortDate(plan.shoot_at)}`} style={s.flex} busy={busy === 'shoot'}
          onPress={() => void act('shoot', () => creatorGigsService.planShoot(contractId, String(plan.shoot_at), String(plan.arrival_note ?? ''), true))} />
      </View> : next.cta && ctaHandled ? <ProgramButton label={next.cta} busy={busy === 'transition'} onPress={onNextCta} /> : null}
      {errors.transition ? <ProgramNotice tone="error" text={errors.transition} /> : null}
      {errors.shoot && sheet !== 'shoot' ? <ProgramNotice tone="error" text={errors.shoot} /> : null}
    </ProgramCard>

    {openProposal && !openCounter ? <ProposalCard proposal={openProposal} currency={currency} busy={busy === 'respond'}
      onRespond={(accept) => void act('respond', () => creatorGigsService.respondToChange(openProposal.id, accept))} /> : null}
    {errors.respond ? <ProgramNotice tone="error" text={errors.respond} /> : null}

    {state === 'script_drafting' ? <ScriptEditor workspace={w} editable busy={busy === 'script'} error={errors.script ?? null}
      onSave={(body, send) => void act('script', () => creatorGigsService.saveScript(contractId, body, send), () => { if (!send) Alert.alert('Draft saved', 'Send it to the host when it’s ready.'); })} /> : null}
    {['script_sent', 'script_locked', 'delivered', 'fix_requested'].includes(state) && w.scripts.length ? <ScriptEditor workspace={w} editable={false} busy={false} error={null} onSave={() => undefined} /> : null}

    {['script_locked', 'fix_requested'].includes(state) ? <UploadCard contractId={contractId} workspace={w}
      onSubmit={async (jobId) => { await creatorGigsService.submitDelivery(contractId, jobId); await refresh(); }} /> : null}
    <DeliveriesCard workspace={w} />

    {['posting', 'posts_failed'].includes(state) ? <PostLinksCard workspace={w} busy={busy === 'posts'} error={errors.posts ?? null}
      onSubmit={(posts) => void act('posts', () => creatorGigsService.submitPosts(contractId, posts))} /> : null}
    <PostsStatus workspace={w} />

    {state === 'disputed' ? <DisputeCard workspace={w} currency={currency} feeMinor={terms?.fee_minor ?? 0} busy={busy === 'dispute'} error={errors.dispute ?? null}
      onRespond={(offerId, accept) => void act('dispute', () => creatorGigsService.respondToDisputeOffer(offerId, accept))}
      onOffer={(bps) => void act('dispute', () => creatorGigsService.offerDispute(w.dispute!.id, bps))} /> : null}
    {state === 'completed' ? <RatingCard workspace={w} busy={busy === 'rate'} error={errors.rate ?? null} onRate={(stars) => void act('rate', () => creatorGigsService.rate(contractId, stars))} /> : null}

    <Tracker state={state} terms={terms} acceptedAt={acceptedEvent?.at ?? null} releaseHint={(released && contractMoneyLine(w.money_state, w.money_paid_at)) || '48 hours after your posts are checked'} />
    {w.rights ? <ProgramNotice text={w.rights.status === 'active'
      ? 'Your full Creator fee was released. Mingla and the paying Host now have the perpetual organic and paid-marketing licence in your accepted agreement.'
      : w.rights.status === 'not_granted'
        ? 'The perpetual marketing licence was not granted for this gig.'
        : w.rights.status === 'legacy'
          ? `This older contract keeps its original ${w.rights.usage_days ?? ''}-day licence.`
          : 'The perpetual marketing licence stays pending until your full Creator fee is released.'} /> : null}
    {terms ? <TermsCard terms={terms} gig={w.gig} /> : null}
    <TermsHistory terms={w.terms} />

    {canChangeTerms && !openProposal ? <ProgramButton label="Ask to change the video-due date" variant="secondary" onPress={() => {
      // Prefill from the agreed (current terms) due date and time.
      const initial = dueChangeInitial(agreedVideoDue(terms, w.gig));
      setDueDay(initial.day); setDueTime(initial.time); setChangeNote('');
      setErrors((e) => ({ ...e, change: undefined })); setSheet('change');
    }} /> : null}
    {canDispute ? <DisputeOpenCard busy={busy === 'dispute'} error={errors.dispute ?? null}
      onOpen={(statement) => void act('dispute', () => creatorGigsService.openDispute(contractId, state === 'fix_requested' ? 'nontechnical_fix_abuse' : 'posts_failed', statement))} /> : null}
    {canCancel ? <ProgramButton label="Can’t do this gig? Cancel it" variant="ghost" busy={busy === 'cancel'} onPress={cancel} /> : null}
    {errors.cancel ? <ProgramNotice tone="error" text={errors.cancel} /> : null}

    <Timeline events={w.events} />

    <ShootSheet visible={sheet === 'shoot'} onClose={() => setSheet(null)} window={window} initialAt={plan?.shoot_at ? String(plan.shoot_at) : null}
      busy={busy === 'shoot'} error={errors.shoot ?? null}
      onSend={(iso, note) => void act('shoot', () => creatorGigsService.planShoot(contractId, iso, note, false), () => setSheet(null))} />

    <ProgramSheet visible={sheet === 'change'} onClose={() => setSheet(null)} title="Ask to change the video-due date" snapPoints={['70%']} busy={busy === 'change'}
      footer={<ProgramButton label="Send to the host" busy={busy === 'change'} disabled={!dueDay || !dueTime}
        onPress={() => dueDay && dueTime && void act('change', () => creatorGigsService.proposeChange(contractId, dueChangePayload(dueDay, dueTime), 'dates', changeNote), () => setSheet(null))} />}>
      <Text style={s.copy}>{`Agreed now: ${agreedVideoDueText(terms, w.gig)}. The host has 48 hours to answer. The fee can’t change here.`}</Text>
      <Text style={s.fieldLabel}>New date{dueDay ? `: ${formatShortDate(dueDay)}` : ''}</Text>
      <CalendarGrid start={dueDay} onPick={(day) => { setDueDay(day); setErrors((e) => ({ ...e, change: undefined })); }} minDate={toDayString(new Date())} />
      <Text style={s.fieldLabel}>Time</Text>
      <TimeChips value={dueTime} onChange={(time) => { setDueTime(time); setErrors((e) => ({ ...e, change: undefined })); }} options={dueTimeOptions(dueTime)} />
      {/* Refusals (past, before the shoot) sit next to the date and time. */}
      {errors.change ? <ProgramNotice tone="error" text={errors.change} /> : null}
      <ProgramField inSheet label="Why (optional)" value={changeNote} onChangeText={setChangeNote} multiline counter={{ max: 300 }} maxLength={300} />
    </ProgramSheet>
  </ProgramScreen>;
}

function formatShootWindow(window: { start: string; end: string }): string {
  return window.start === window.end ? formatShortDate(window.start) : `${formatShortDate(window.start)}–${formatShortDate(window.end)}`;
}


const styles = StyleSheet.create({
  two: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1.6 },
});
