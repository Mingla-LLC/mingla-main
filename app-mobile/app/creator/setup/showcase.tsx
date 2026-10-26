import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { chooseAndUploadCreatorMedia, isPickerCancel, myShowcaseMedia } from '../../../src/services/creatorMediaService';
import { programErrorText } from '../../../src/services/programResult';
import { formatShortDate } from '../../../src/utils/programFormat';
import { goToNextStep, stepTitle } from '../../../src/components/creator/setupNav';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramNotice, ProgramPill, ProgramRow, ProgramScreen, programStyles as s } from '../../../src/components/programs/ProgramUi';
import { playOwnVideo } from '../../../src/components/programs/VideoTile';

const REQUIREMENTS = [
  'Vertical (9:16) works best',
  'Up to 90 seconds and 150 MB',
  'Your own work, from a phone or an MP4',
  'No phone numbers, emails or handles in the clip',
];

const STATUS: Record<string, { label: string; tone: 'success' | 'accent' | 'danger' | 'neutral' }> = {
  ready: { label: 'Ready', tone: 'success' },
  processing: { label: 'Processing', tone: 'accent' },
  awaiting_upload: { label: 'Uploading', tone: 'accent' },
  failed: { label: 'Didn’t process', tone: 'danger' },
};

export default function CreatorShowcaseStep(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const media = useQuery({ queryKey: ['creator', 'showcase'], queryFn: () => myShowcaseMedia(), refetchInterval: (q) => (q.state.data ?? []).some((m) => m.status === 'processing') ? 8000 : false });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState(false);

  const items = media.data ?? [];
  const ready = items.some((m) => m.status === 'ready');
  const processing = items.some((m) => m.status === 'processing' || m.status === 'awaiting_upload');

  const upload = async (): Promise<void> => {
    setBusy(true); setProgress(0); setError(null); setAspect(false);
    try {
      const result = await chooseAndUploadCreatorMedia({ purpose: 'showcase', onProgress: setProgress });
      setAspect(result.aspectWarning);
      await queryClient.invalidateQueries({ queryKey: ['creator'] });
    } catch (e) {
      if (!isPickerCancel(e)) setError(programErrorText(e));
    } finally { setBusy(false); }
  };

  return <ProgramScreen title={stepTitle('showcase')}
    footer={<ProgramButton label={ready || processing ? 'Continue' : 'Add a video to continue'} disabled={!ready && !processing} onPress={() => void goToNextStep(router, queryClient, 'showcase')} />}>
    <Text style={s.copy}>One strong sample is enough. Hosts watch it before they hire you. It stays private until you’re verified.</Text>
    <ProgramCard>
      {REQUIREMENTS.map((r, i) => <ProgramRow key={r} title={r} done isLast={i === REQUIREMENTS.length - 1} />)}
    </ProgramCard>

    {items.length ? <ProgramCard>
      {items.map((m, i) => {
        const st = STATUS[m.status] ?? STATUS.processing;
        return <ProgramRow key={m.id} icon="videocam" title={`Showcase video ${items.length - i}`} subtitle={`Added ${formatShortDate(m.created_at)}${m.aspect_warning ? ' · may need a more vertical crop' : ''}`}
          right={<ProgramPill label={st.label} tone={st.tone} />} onPress={m.status === 'ready' ? () => void playOwnVideo(m.id) : undefined} chevron={false} isLast={i === items.length - 1} />;
      })}
    </ProgramCard> : null}

    {busy ? <View style={styles.progress} accessibilityLabel={`Uploading ${Math.round(progress * 100)} percent`}>
      <View style={styles.bar}><View style={[styles.fill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} /></View>
      <Text style={s.small}>Uploading {Math.round(progress * 100)}%. Keep the app open.</Text>
    </View> : null}
    {processing && !busy ? <ProgramNotice text="Processing your video. This usually takes a minute or two; you can continue meanwhile." /> : null}
    {aspect ? <ProgramNotice tone="warning" text="This video looks wide. It will still process, but a vertical video looks better to hosts." /> : null}
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    <ProgramButton label={items.length ? 'Add another video' : 'Choose a video'} variant={items.length ? 'secondary' : 'primary'} icon="cloud-upload-outline" busy={busy} onPress={() => void upload()} />
  </ProgramScreen>;
}

const styles = StyleSheet.create({
  progress: { gap: 6 },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: C.accent },
});
