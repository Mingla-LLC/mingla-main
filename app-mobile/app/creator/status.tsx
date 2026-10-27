import React, { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { creatorProgramService, setupChecks } from '../../src/services/creatorProgramService';
import { programErrorText } from '../../src/services/programResult';
import { SETUP_STATUS_KEY, SETUP_STEPS, type SetupStep } from '../../src/components/creator/setupNav';
import { ProgramButton, ProgramCard, ProgramEmpty, ProgramLoadError, ProgramLoading, ProgramNotice, ProgramRow, ProgramScreen, programStyles as s } from '../../src/components/programs/ProgramUi';

/**
 * #3872 — verification status: in review, asked for more (with what Mingla
 * asked and a Resubmit), declined (with the reason) and paused.
 */
export default function CreatorStatusScreen(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: SETUP_STATUS_KEY, queryFn: () => creatorProgramService.status() });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  if (status.isLoading) return <ProgramScreen title="Creator status"><ProgramLoading /></ProgramScreen>;
  if (status.isError) return <ProgramScreen title="Creator status"><ProgramLoadError text={programErrorText(status.error)} onRetry={() => void status.refetch()} /></ProgramScreen>;

  const data = status.data;
  const verification = data?.verification ?? 'incomplete';
  const checks = setupChecks(data);
  const accepted = checks.filter((c) => c.done);
  const open = checks.filter((c) => !c.done);

  const resubmit = async (): Promise<void> => {
    setBusy(true); setMessage(null);
    try {
      await creatorProgramService.recompute();
      await queryClient.invalidateQueries({ queryKey: ['creator'] });
      setMessage({ tone: 'success', text: 'Sent. We’ll tell you here when it’s checked, usually within a day.' });
    } catch (e) { setMessage({ tone: 'error', text: programErrorText(e) }); } finally { setBusy(false); }
  };

  const fixRows = open.map((c, i) => <ProgramRow key={c.key} title={c.label} value="Needed" onPress={(SETUP_STEPS as readonly string[]).includes(c.key) ? () => router.push(`/creator/setup/${c.key as SetupStep}` as never) : undefined} isLast={i === open.length - 1} />);

  if (verification === 'needs_more') {
    return <ProgramScreen title="What’s needed" footer={<ProgramButton label="Resubmit" busy={busy} onPress={() => void resubmit()} />}>
      <ProgramCard tone="warning">
        <Text style={s.label}>Asked by Mingla</Text>
        <Text style={s.strong}>{data?.review_note?.trim() || 'One part of your profile needs another look. Check the steps below.'}</Text>
      </ProgramCard>
      {accepted.length ? <ProgramCard>
        <Text style={s.label}>Already accepted (no need to redo)</Text>
        {accepted.map((c, i) => <ProgramRow key={c.key} title={c.label} done isLast={i === accepted.length - 1} />)}
      </ProgramCard> : null}
      {open.length ? <ProgramCard>{fixRows}</ProgramCard> : <Text style={s.copy}>Update what Mingla asked for in setup, then tap Resubmit.</Text>}
      <ProgramButton label="Open setup" variant="secondary" onPress={() => router.push('/creator/setup' as never)} />
      {message ? <ProgramNotice tone={message.tone} text={message.text} /> : null}
    </ProgramScreen>;
  }

  if (verification === 'declined') {
    return <ProgramScreen title="Creator status">
      <ProgramCard tone="danger">
        <Text style={s.title}>Your Creator profile wasn’t approved</Text>
        <Text style={s.copy}>{data?.declined_reason?.trim() || 'It didn’t meet the Mingla Creator guidelines.'}</Text>
      </ProgramCard>
      <Text style={s.copy}>You can still use Mingla as usual and earn from friends you bring. If you think this is a mistake, contact support from Profile › Help.</Text>
      <ProgramButton label="Back to Profile" variant="secondary" onPress={() => router.replace('/' as never)} />
    </ProgramScreen>;
  }

  if (verification === 'suspended') {
    return <ProgramScreen title="Creator status">
      <ProgramCard tone="danger">
        <Text style={s.title}>Your Creator profile is paused</Text>
        <Text style={s.copy}>{data?.declined_reason?.trim() || data?.review_note?.trim() || 'Hosts can’t see you or send offers while it’s paused. Work you already accepted stays open.'}</Text>
      </ProgramCard>
      <Text style={s.copy}>Contact support from Profile › Help to talk it through.</Text>
    </ProgramScreen>;
  }

  if (verification === 'review') {
    return <ProgramScreen title="Creator status">
      <ProgramCard tone="warning">
        <Text style={s.title}>A person is checking one thing</Text>
        <Text style={s.copy}>Most profiles verify instantly. Yours was flagged, so someone at Mingla takes a look, usually within a day.</Text>
      </ProgramCard>
      <ProgramButton label="Edit profile" variant="secondary" onPress={() => router.push('/creator/setup/profile' as never)} />
    </ProgramScreen>;
  }

  if (verification === 'verified') {
    return <ProgramScreen title="Creator status">
      <ProgramEmpty title="You’re verified" text="Hosts can see you and send offers." action={<ProgramButton label="Find gigs" onPress={() => router.replace('/creator' as never)} />} />
    </ProgramScreen>;
  }

  return <ProgramScreen title="Creator status" footer={<ProgramButton label="Continue setup" onPress={() => router.push('/creator/setup' as never)} />}>
    <ProgramCard>
      <Text style={s.title}>Finish setup to be verified</Text>
      <Text style={s.copy}>Hosts see you once all six steps are done.</Text>
    </ProgramCard>
    {open.length ? <ProgramCard>{fixRows}</ProgramCard> : null}
  </ProgramScreen>;
}
