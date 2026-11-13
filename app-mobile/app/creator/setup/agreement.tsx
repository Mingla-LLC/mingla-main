import React, { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { creatorProgramService } from '../../../src/services/creatorProgramService';
import { programErrorText } from '../../../src/services/programResult';
import { isAdult, signBlockReason } from '../../../src/utils/programFormat';
import { goToNextStep, stepTitle } from '../../../src/components/creator/setupNav';
import { ProgramButton, ProgramCard, ProgramNotice, ProgramRow, ProgramScreen, programStyles as s } from '../../../src/components/programs/ProgramUi';
import { CheckRow } from '../../../src/components/programs/ProgramPickers';
import { CreatorDobField } from '../../../src/components/creator/CreatorDobField';
// #4261: the agreement document opens in Mingla's in-app document overlay.
import { useOpenInMingla } from '../../../src/components/InAppBrowserProvider';

const CREATOR_TAX_LINE = 'You’re responsible for reporting and paying tax on what you earn.';

/** The points the agreement covers, in plain words (the full text opens below when published). */
const KEY_POINTS = [
  { title: 'You post what you agree to', text: 'The format, platforms and post-by date in each offer. Sponsored posts always say #ad or paid partnership.' },
  { title: 'Fixes are limited', text: 'Hosts can ask for up to two technical fixes per video, such as sound or framing.' },
  { title: 'You still own your video', text: 'After your full Creator fee is released, Mingla and the paying Host may use the approved video forever in organic and paid marketing, edit it and adapt it without another usage fee.' },
  { title: 'Your account stays yours', text: 'Ads run directly from your own social account still need the separate permission required by that platform. You never share your password.' },
  { title: 'How you’re paid', text: 'The host pays Mingla before you start. Your fee is released after your posts are checked, then sent to your bank.' },
  { title: 'Posts stay up', text: 'Keep agreed posts live for at least 30 days.' },
];

export default function CreatorAgreementStep(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openDocument } = useOpenInMingla();
  const own = useQuery({ queryKey: ['creator', 'own-profile'], queryFn: () => creatorProgramService.ownProfile() });
  const agreement = useQuery({ queryKey: ['creator', 'agreement'], queryFn: () => creatorProgramService.currentAgreement() });
  // undefined = untouched (the saved birth date shows); null = typed but not a complete date yet.
  const [dob, setDob] = useState<string | null | undefined>(undefined);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const version = agreement.data?.version ?? '';
  const fullTextUrl = agreement.data?.document_url ?? '';
  const birthDate = dob !== undefined ? dob : own.data?.date_of_birth ?? null;

  const sign = async (): Promise<void> => {
    if (!birthDate) { setError('Add your date of birth.'); return; }
    if (!isAdult(birthDate)) { setError('You must be 18 or older to join Mingla Creator.'); return; }
    setBusy(true); setError(null);
    try {
      await creatorProgramService.signAgreement(birthDate);
      void queryClient.invalidateQueries({ queryKey: ['creator'] });
      setSigned(true);
    } catch (e) { setError(programErrorText(e)); } finally { setBusy(false); }
  };

  // #4402: after signing, a confirmation waits for Continue (no silent jump to the next step).
  if (signed) return <ProgramScreen title={stepTitle('agreement')} footer={<ProgramButton label="Continue" onPress={() => void goToNextStep(router, queryClient, 'agreement')} />}>
    <ProgramCard tone="highlight">
      <Text style={s.title}>Signed</Text>
      <Text style={s.copy}>Signed. A copy is in Settings › Creator agreement.</Text>
    </ProgramCard>
  </ProgramScreen>;

  // The reason sits right under the disabled button, not somewhere above the fold.
  const blocked = signBlockReason({ hasVersion: Boolean(version), birthDate, agreed });
  return <ProgramScreen title={stepTitle('agreement')}
    footer={<>
      <ProgramButton label="Sign and continue" busy={busy} disabled={Boolean(blocked)} onPress={() => void sign()} />
      {blocked && !busy ? <Text style={s.small} accessibilityLiveRegion="polite">{blocked}</Text> : null}
      {error ? <ProgramNotice tone="error" text={error} /> : null}
    </>}>
    <CreatorDobField value={birthDate} onChange={(d) => { setDob(d); setError(null); }} />

    <Text style={s.label}>What you’re agreeing to</Text>
    <ProgramCard>
      {KEY_POINTS.map((p, i) => <ProgramRow key={p.title} title={p.title} subtitle={p.text} isLast={i === KEY_POINTS.length - 1} />)}
    </ProgramCard>
    {fullTextUrl ? <ProgramButton label="Read the full agreement" variant="secondary" icon="document-text" onPress={() => openDocument(fullTextUrl)} /> : null}

    <ProgramNotice text={CREATOR_TAX_LINE} />
    <CheckRow checked={agreed} onToggle={() => setAgreed((v) => !v)} label="I’ve read and agree to the Mingla Creator agreement" />
    {!version && !agreement.isLoading ? <ProgramNotice tone="warning" text="The agreement isn’t ready to sign yet. Everything else you’ve done is saved." /> : null}
  </ProgramScreen>;
}
