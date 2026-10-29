import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { localProgramService } from '../../src/services/localProgramService';
import { chooseAndUploadCreatorMedia, creatorMediaStatus, isPickerCancel } from '../../src/services/creatorMediaService';
import { programErrorText } from '../../src/services/programResult';
import { parseDay, persistedDayString } from '../../src/utils/programFormat';
import { SPEND_BANDS } from '../../src/components/local/localWords';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramEmpty, ProgramField, ProgramLoading, ProgramNotice, ProgramRow, ProgramScreen, programStyles as s } from '../../src/components/programs/ProgramUi';
import { CheckRow, Chip, DateField, StarsInput } from '../../src/components/programs/ProgramPickers';
import { Icon } from '../../src/components/ui/Icon';
import { playOwnVideo } from '../../src/components/programs/VideoTile';

type Clip = { jobId: string; status: string };

const VIDEO_BEATS = [
  { title: 'Show how you found it', text: 'Start with the place card in your Mingla deck and name the place you picked.' },
  { title: 'Take us inside', text: 'Show the arrival, atmosphere and the experience without staging the visit.' },
  { title: 'Give the honest review', text: 'Share what you tried, what stood out, what could improve and who would enjoy it.' },
  { title: 'End with your verdict', text: 'Say whether you would return and invite viewers to find the place on Mingla.' },
] as const;

/** #3872 — the Local review: date, stars, title, counted body, videos, public post link and disclosure. */
export default function LocalReviewScreen(): React.ReactElement {
  const { month: monthId } = useLocalSearchParams<{ month: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const home = useQuery({ queryKey: ['local', 'home'], queryFn: () => localProgramService.home() });
  const month = home.data?.months.find((m) => m.id === monthId) ?? (home.data?.current_month?.id === monthId ? home.data.current_month : null);
  const names = useQuery({ queryKey: ['local', 'place-name', month?.place_id], queryFn: () => localProgramService.placeNames([month!.place_id!]), enabled: Boolean(month?.place_id) });
  const visitedDefault = persistedDayString(month?.visited_at);
  const [visitedOn, setVisitedOn] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [spend, setSpend] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [uploading, setUploading] = useState(0);
  const [link, setLink] = useState('');
  const [formatConfirmed, setFormatConfirmed] = useState(false);
  const [collaborationConfirmed, setCollaborationConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const day = visitedOn ?? visitedDefault;
  const ready = clips.filter((c) => c.status === 'ready');
  const titleOk = title.trim().length >= 3 && title.trim().length <= 70;
  const bodyOk = body.trim().length >= 300 && body.trim().length <= 2000;
  const linkOk = /^https:\/\/\S+\.\S+/i.test(link.trim());
  const valid = Boolean(day) && rating > 0 && titleOk && bodyOk && ready.length > 0 && linkOk && formatConfirmed && collaborationConfirmed && clips.every((c) => c.status === 'ready');

  const addClip = async (): Promise<void> => {
    if (!month) return;
    setError(null); setUploading(0.01);
    try {
      const result = await chooseAndUploadCreatorMedia({ purpose: 'local_review', localMonthId: month.id, onProgress: (f) => setUploading(Math.max(0.01, f)) });
      setClips((c) => [...c, { jobId: result.jobId, status: 'processing' }]);
    } catch (e) { if (!isPickerCancel(e)) setError(programErrorText(e)); } finally { setUploading(0); }
  };
  const checkClips = async (): Promise<void> => {
    const next = await Promise.all(clips.map(async (c) => c.status === 'ready' ? c : { ...c, status: (await creatorMediaStatus(c.jobId).catch(() => ({ status: c.status }))).status }));
    setClips(next);
  };

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (!valid || !month || !day) return;
    setBusy(true); setError(null);
    try {
      await localProgramService.submitReview({ monthId: month.id, rating, title, body, visitedOn: day, spendBand: spend, mediaJobIds: ready.map((c) => c.jobId), socialPostUrl: link });
      await queryClient.invalidateQueries({ queryKey: ['local'] });
      router.back();
    } catch (e) { setError(programErrorText(e)); } finally { setBusy(false); }
  };

  if (home.isLoading) return <ProgramScreen title="Your review"><ProgramLoading /></ProgramScreen>;
  if (!month) return <ProgramScreen title="Your review"><ProgramEmpty title="This month isn’t open for a review" text="Go back to Mingla Local to see where you are." /></ProgramScreen>;
  const place = month.place_name ?? (month.place_id ? names.data?.[month.place_id] : null) ?? 'your place';
  const processing = clips.some((c) => c.status !== 'ready' && c.status !== 'failed');

  return <ProgramScreen title={`Your review · ${place}`} footer={<ProgramButton label="Send for review" busy={busy} disabled={!valid} onPress={() => void submit()} />}>
    <ProgramCard tone="highlight">
      <Text style={s.title}>Your video format · 30–60 seconds, vertical</Text>
      <Text style={s.copy}>Use one finished video in this order so it works on the place card and in Mingla marketing.</Text>
      {VIDEO_BEATS.map((beat, index) => <ProgramRow key={beat.title} title={`${index + 1}. ${beat.title}`} subtitle={beat.text} chevron={false} isLast={index === VIDEO_BEATS.length - 1} />)}
    </ProgramCard>
    <ProgramNotice text="Before the visit, save a short screen recording of the place card in your Mingla deck. Put it at the start so viewers can see how you found the place." />
    <DateField label="Visited on" value={day} onChange={setVisitedOn} minimumDate={parseDay(month.month) ?? undefined} maximumDate={new Date()} sheetTitle="Visited on" />
    <View style={{ gap: 6 }}>
      <Text style={s.fieldLabel}>Your rating</Text>
      <StarsInput value={rating} onChange={setRating} />
      {touched && rating === 0 ? <Text style={s.fieldErrorText}>Tap a star to rate.</Text> : null}
    </View>
    <ProgramField label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Small plates worth the trip" maxLength={70} counter={{ max: 70, min: 3 }} />
    <ProgramField label="What you’d tell a friend" value={body} onChangeText={setBody} multiline counter={{ max: 2000, min: 300 }} maxLength={2000}
      placeholder="What you had, what stood out, who it’s for" error={touched && !bodyOk ? 'Write between 300 and 2,000 characters.' : null} />
    <Text style={s.fieldLabel}>What you spent</Text>
    <View style={s.wrap}>{SPEND_BANDS.map((b) => <Chip key={b.key} label={b.label} selected={spend === b.key} onPress={() => setSpend(spend === b.key ? null : b.key)} />)}</View>

    <Text style={s.fieldLabel}>Videos · at least one, up to six</Text>
    <View style={styles.grid}>
      {clips.map((c, i) => <Pressable key={c.jobId} accessibilityRole="button" accessibilityLabel={`Video ${i + 1}, ${c.status === 'ready' ? 'ready' : c.status === 'failed' ? 'didn’t process' : 'processing'}`}
        onPress={() => (c.status === 'ready' ? void playOwnVideo(c.jobId) : void checkClips())} style={styles.tile}>
        <Icon name={c.status === 'ready' ? 'play' : c.status === 'failed' ? 'alert-circle-outline' : 'hourglass-outline'} size={22} color={c.status === 'failed' ? C.danger : C.text} />
        <Text style={s.small}>{c.status === 'ready' ? 'Ready' : c.status === 'failed' ? 'Didn’t process' : 'Processing'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove video ${i + 1}`} hitSlop={8} style={styles.remove} onPress={() => setClips(clips.filter((x) => x.jobId !== c.jobId))}><Icon name="close" size={14} color={C.text} /></Pressable>
      </Pressable>)}
      {clips.length < 6 ? <Pressable accessibilityRole="button" accessibilityLabel="Add a video" disabled={uploading > 0} onPress={() => void addClip()} style={[styles.tile, styles.add]}>
        <Icon name="add" size={24} color={C.accent} />
        <Text style={s.small}>{uploading > 0 ? `${Math.round(uploading * 100)}%` : 'Add video'}</Text>
      </Pressable> : null}
    </View>
    {processing ? <ProgramButton label="Check processing" variant="ghost" onPress={() => void checkClips()} /> : null}
    {touched && ready.length === 0 ? <Text style={s.fieldErrorText}>Add at least one video and wait for it to process.</Text> : null}

    <ProgramCard>
      <Text style={s.title}>Post the same finished video</Text>
      <Text style={s.copy}>Publish it on your social account, tag Mingla and invite Mingla’s official account as a collaborator. Then paste the public post below.</Text>
      <Text style={s.small}>After approval, this video can also appear on this place’s expanded card and in Mingla marketing, as set out in your signed Local agreement.</Text>
    </ProgramCard>
    <ProgramField label="Link to the post with your video" value={link} onChangeText={setLink} placeholder="https://instagram.com/p/…" autoCapitalize="none" autoCorrect={false} spellCheck={false}
      keyboardType="url" textContentType="URL" error={touched && !linkOk ? 'Paste the full link, starting with https://' : null} />
    <CheckRow checked={formatConfirmed} onToggle={() => setFormatConfirmed((value) => !value)} label="My video follows the four-part Mingla format above" />
    <CheckRow checked={collaborationConfirmed} onToggle={() => setCollaborationConfirmed((value) => !value)} label="I posted this same video, tagged Mingla and invited Mingla’s official account as a collaborator" />
    {touched && !formatConfirmed ? <Text style={s.fieldErrorText}>Confirm that the submitted video follows the format.</Text> : null}
    {touched && !collaborationConfirmed ? <Text style={s.fieldErrorText}>Post the video and invite Mingla as a collaborator before sending it for review.</Text> : null}
    {error ? <ProgramNotice tone="error" text={error} /> : null}
  </ProgramScreen>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31%', aspectRatio: 9 / 14, borderRadius: 12, backgroundColor: C.field, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', gap: 4 },
  add: { borderStyle: 'dashed', borderColor: C.accentBorder },
  remove: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
