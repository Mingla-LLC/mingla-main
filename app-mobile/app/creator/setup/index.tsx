import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { creatorProgramService, setupChecks } from '../../../src/services/creatorProgramService';
import { payoutService } from '../../../src/services/payoutService';
import { myShowcaseMedia } from '../../../src/services/creatorMediaService';
import { programErrorText } from '../../../src/services/programResult';
import { formatMoney, nicheLabel, platformLabel, setupMinutesLeft } from '../../../src/utils/programFormat';
import { SETUP_STATUS_KEY, SETUP_STEPS, firstOpenStep, type SetupStep } from '../../../src/components/creator/setupNav';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramLoadError, ProgramLoading, ProgramRow, ProgramScreen, ProgramSheet, programStyles as s } from '../../../src/components/programs/ProgramUi';

export default function CreatorSetupChecklist(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState(false);
  const status = useQuery({ queryKey: SETUP_STATUS_KEY, queryFn: () => creatorProgramService.status() });
  const profile = useQuery({ queryKey: ['creator', 'own-profile'], queryFn: () => creatorProgramService.ownProfile(), enabled: Boolean(status.data?.profile) });
  const payout = useQuery({ queryKey: ['creator', 'payout'], queryFn: () => payoutService.status(), retry: 0 });
  const showcase = useQuery({ queryKey: ['creator', 'showcase'], queryFn: () => myShowcaseMedia(), enabled: Boolean(status.data?.profile) });
  useFocusEffect(useCallback(() => { void queryClient.invalidateQueries({ queryKey: ['creator'] }); }, [queryClient]));

  if (status.isLoading) return <ProgramScreen title="Creator setup"><ProgramLoading /></ProgramScreen>;
  if (status.isError) return <ProgramScreen title="Creator setup"><ProgramLoadError text={programErrorText(status.error)} onRetry={() => void status.refetch()} /></ProgramScreen>;

  const checks = setupChecks(status.data);
  const doneCount = checks.filter((c) => c.done).length;
  const next = firstOpenStep(status.data);
  const verification = status.data?.verification ?? 'incomplete';
  const packages = (status.data?.packages ?? []).filter((p) => p.active);
  const cheapest = packages.slice().sort((a, b) => a.price_minor - b.price_minor)[0];
  const handles = status.data?.handles ?? [];
  const verifiedHandles = handles.filter((h) => h.verified);
  const ready = (showcase.data ?? []).filter((m) => m.status === 'ready').length;
  const processing = (showcase.data ?? []).filter((m) => m.status === 'processing' || m.status === 'awaiting_upload').length;
  const name = profile.data?.display_name;
  const niches = (profile.data?.niches ?? []).slice(0, 3).map(nicheLabel).join(', ');

  const subtitle = (key: string, done: boolean): { text: string; tone: 'muted' | 'accent' } => {
    const isNext = key === next;
    const pick = (text: string): { text: string; tone: 'muted' | 'accent' } => ({ text: isNext && !done ? `Next · ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text, tone: isNext && !done ? 'accent' : 'muted' });
    switch (key) {
      case 'profile': return pick(done && name ? [name, niches].filter(Boolean).join(' · ') : 'Your name, city and what you make');
      case 'rates': return pick(cheapest ? `${packages.length} format${packages.length === 1 ? '' : 's'} from ${formatMoney(cheapest.price_minor, cheapest.currency)}` : 'Set a price for the formats you make');
      case 'showcase': return pick(ready ? `${ready} ready${processing ? ` · ${processing} processing` : ''}` : processing ? 'Processing your video' : 'Add one vertical video');
      case 'socials': return pick(verifiedHandles.length ? verifiedHandles.map((h) => `${platformLabel(h.platform)} verified`).join(' · ') : handles.length ? 'Add the code to your bio, then check' : 'Add a code to your bio');
      case 'payout': return pick(payout.data?.summary ?? (done ? 'Connected' : 'Not connected'));
      case 'agreement': return pick(done ? 'Signed' : 'Not signed');
      default: return pick(done ? 'Done' : 'Not done');
    }
  };

  const footer = next
    ? <ProgramButton label={doneCount === 0 ? 'Start with your profile' : `Continue: ${checks.find((c) => c.key === next)?.label ?? 'next step'}`} onPress={() => router.push(`/creator/setup/${next}` as never)} />
    : verification === 'verified'
      ? <ProgramButton label="Back to Creator" onPress={() => router.replace('/creator' as never)} />
      : <ProgramButton label="See verification status" onPress={() => router.push('/creator/status' as never)} />;

  return <ProgramScreen title="Creator setup" footer={footer} refreshing={status.isFetching} onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['creator'] })}>
    <View style={s.rowLine}>
      <Text style={s.strong}>{doneCount} of {checks.length} done</Text>
      {doneCount < checks.length ? <Text style={s.small}>about {setupMinutesLeft(checks.length - doneCount)} min left</Text> : <Text style={s.successText}>All set</Text>}
    </View>
    <View style={styles.steps}>{checks.map((c) => <View key={c.key} style={[styles.step, c.done && styles.stepDone]} />)}</View>
    <Text style={s.copy}>Hosts see you once all six are done. They never see your handles or contact details until they hire you.</Text>

    <ProgramCard>
      {checks.map((c, i) => {
        const sub = subtitle(c.key, c.done);
        const step = (SETUP_STEPS as readonly string[]).includes(c.key) ? c.key as SetupStep : null;
        return <ProgramRow key={c.key} title={c.label} subtitle={sub.text} subtitleTone={sub.tone} done={c.done} isLast={i === checks.length - 1}
          onPress={step ? () => router.push(`/creator/setup/${step}` as never) : undefined} />;
      })}
    </ProgramCard>

    {status.data?.profile ? <ProgramCard>
      <ProgramRow icon="eye" title="Preview how hosts see you" subtitle="Your public card on Explorer and the pre-hire profile" onPress={() => setPreview(true)} isLast />
    </ProgramCard> : null}

    <ProgramSheet visible={preview} onClose={() => setPreview(false)} title="How hosts see you" snapPoints={['60%']}>
      <ProgramCard>
        <Text style={s.title}>{name ?? 'Your name'}</Text>
        {niches ? <Text style={s.copy}>{niches}{profile.data?.home_city_name ? ` · ${profile.data.home_city_name}` : ''}</Text> : null}
        {profile.data?.bio ? <Text style={s.copy}>{profile.data.bio}</Text> : null}
        <Text style={s.small}>{ready ? `${ready} showcase video${ready === 1 ? '' : 's'}` : 'No showcase video yet'} · {verifiedHandles.length ? verifiedHandles.map((h) => platformLabel(h.platform)).join(', ') + ' verified' : 'No verified account yet'}</Text>
        {cheapest ? <Text style={s.strong}>From {formatMoney(cheapest.price_minor, cheapest.currency)}</Text> : null}
      </ProgramCard>
      <Text style={s.small}>Hosts never see your handles, email or phone until they hire you.</Text>
    </ProgramSheet>
  </ProgramScreen>;
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', gap: 4 },
  step: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)' },
  stepDone: { backgroundColor: C.accent },
});
