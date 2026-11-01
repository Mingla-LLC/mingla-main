import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '../../../src/services/supabase';
import { creatorProgramService } from '../../../src/services/creatorProgramService';
import { creatorGigsService } from '../../../src/services/creatorGigsService';
import { ProgramActionError, programErrorText } from '../../../src/services/programResult';
import {
  currencySymbol, deliverablesLabel, formatDateRange, formatInfo, formatMoney, formatName, interestPricePrefill, overPayUpToNote, payUpToText,
  moneyInputValue, parseMoneyInput, salesShareText, usageLabel, videoDueText,
} from '../../../src/utils/programFormat';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramEmpty, ProgramField, ProgramLoading, ProgramNotice, ProgramRow, ProgramScreen, ProgramSheet, programStyles as s } from '../../../src/components/programs/ProgramUi';
import { VideoTile, playPublicVideo } from '../../../src/components/programs/VideoTile';
import { JOIN_IN_FLIGHT } from '../../../src/components/programs/programRefresh';
import { useRefreshOnFocus } from '../../../src/components/programs/useProgramRefresh';
import { Icon } from '../../../src/components/ui/Icon';

type FormatRow = { key: string; name: string; one_line: string; structure: Array<{ key: string; from: number; to: number }>; example_asset_ids: string[] };

const SECTION_WORDS: Record<string, string> = {
  hook: 'Hook', arrival: 'Arrival', reaction: 'Reaction', cta: 'End card', atmosphere: 'Atmosphere', experience: 'Experience',
  price_hook: 'Price hook', included: 'What’s included', value: 'The value', people: 'The people', craft: 'The craft', reasons: 'Three reasons', mood: 'The mood', plan: 'The plan',
};
const sectionWord = (key: string): string => SECTION_WORDS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');

export default function CreatorGigScreen(): React.ReactElement {
  const { gigId } = useLocalSearchParams<{ gigId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const gig = useQuery({ queryKey: ['creator', 'gig', gigId], queryFn: () => creatorGigsService.detail(gigId), enabled: Boolean(gigId) });
  const setup = useQuery({ queryKey: ['creator', 'status'], queryFn: () => creatorProgramService.status() });
  const home = useQuery({ queryKey: ['creator', 'home'], queryFn: () => creatorGigsService.home(), enabled: Boolean(setup.data?.profile) });
  const format = useQuery({
    queryKey: ['creator', 'format', gig.data?.format_key],
    enabled: Boolean(gig.data?.format_key),
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<FormatRow | null> => {
      const { data } = await supabase.from('gig_formats').select('key,name,one_line,structure,example_asset_ids').eq('key', gig.data!.format_key).maybeSingle();
      return (data as FormatRow | null) ?? null;
    },
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ProgramActionError | null>(null);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  // Reopened (from a link or a notification) or back from the background: read it again.
  useRefreshOnFocus(() => { void queryClient.invalidateQueries({ queryKey: ['creator'] }, JOIN_IN_FLIGHT); });

  const g = gig.data;
  const packages = (setup.data?.packages ?? []).filter((p) => p.active);
  const pkg = g ? packages.find((p) => p.format_key === g.format_key) ?? packages[0] : undefined;
  const verified = setup.data?.verification === 'verified';
  const alreadySent = sent || Boolean(home.data?.interests.some((i) => i.gig_id === gigId));
  const saved = Boolean(g?.saved ?? home.data?.saved?.some((x) => x.id === gigId));

  const toggleSave = async (): Promise<void> => {
    if (!g) return;
    setSaving(true);
    try { await creatorGigsService.saveGig(g.id, !saved); await queryClient.invalidateQueries({ queryKey: ['creator'] }); }
    catch (e) { Alert.alert('Couldn’t save the gig', programErrorText(e)); }
    finally { setSaving(false); }
  };

  const openSheet = (): void => {
    // The saved rate, or what the gig pays when the rate is higher.
    setPrice(pkg && g ? moneyInputValue(interestPricePrefill(pkg.price_minor, pkg.currency, g), pkg.currency) : '');
    setError(null); setSheetOpen(true);
  };

  const send = async (): Promise<void> => {
    if (!g || !pkg) return;
    const minor = parseMoneyInput(price, pkg.currency);
    if (minor === null) { setError(new ProgramActionError('invalid_price', { field: 'price' })); return; }
    setBusy(true); setError(null);
    try {
      await creatorGigsService.sendInterest(g.id, pkg.id, minor, note);
      setSent(true); setSheetOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['creator'] });
      Alert.alert('Interest sent', 'The host sees your profile, rate and showcase, not your contact details. You’ll hear back in Creator.');
    } catch (e) {
      // ok:false (note_not_anonymous, payout_rail_mismatch, creator_not_ready, gig_full, already_interested) lands here, never as success.
      setError(e instanceof ProgramActionError ? e : new ProgramActionError('unknown_error'));
    } finally { setBusy(false); }
  };

  if (gig.isLoading) return <ProgramScreen title="Gig"><ProgramLoading /></ProgramScreen>;
  if (!g) return <ProgramScreen title="Gig"><ProgramEmpty title="This gig isn’t available" text={gig.isError ? programErrorText(gig.error) : 'It may have filled up or closed. Find another one in Creator.'}
    action={<ProgramButton label="Find gigs" variant="secondary" onPress={() => router.replace('/creator' as never)} />} /></ProgramScreen>;

  const info = formatInfo(g.format_key);
  const pay = payUpToText(g);
  const structure = format.data?.structure ?? [];
  const examples = format.data?.example_asset_ids ?? [];
  const noteError = error?.code === 'note_not_anonymous' ? error.message : null;
  const priceError = error?.field === 'price' || error?.code === 'invalid_price' ? error.message : null;
  const generalError = error && !noteError && !priceError ? error : null;
  const overPayNote = pkg && !priceError ? overPayUpToNote(parseMoneyInput(price, pkg.currency), pkg.currency, g) : null;

  const footer = alreadySent
    ? <ProgramButton label="Interest sent" icon="checkmark" disabled onPress={() => undefined} />
    : verified
      ? <ProgramButton label="I’m interested" disabled={g.slots_left <= 0 || !pkg} onPress={openSheet} />
      : <ProgramButton label="Finish setup to send interest" onPress={() => router.push('/creator/setup' as never)} />;

  return <ProgramScreen title={g.title_public} footer={footer}
    right={<Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Remove from saved' : 'Save gig'} accessibilityState={{ selected: saved, busy: saving }} disabled={saving} onPress={() => void toggleSave()} hitSlop={10}>
      <Icon name={saved ? 'bookmark' : 'bookmark-outline'} size={22} color={saved ? C.accent : C.text} />
    </Pressable>}>
    <ProgramCard>
      <Text style={s.label}>Brand</Text>
      <Text style={s.copy}>Hidden until you’re hired</Text>
      <Text style={[s.label, styles.gap]}>What</Text>
      <Text style={s.strong}>{g.brief_public}</Text>
    </ProgramCard>

    <ProgramCard>
      <Text style={s.title}>Format: {formatName(g.format_key)}</Text>
      {info ? <Text style={s.copy}>{info.oneLine} {info.seconds[0]}–{info.seconds[1]} seconds.</Text> : null}
      {examples.length ? <View style={styles.tiles}>
        {examples.slice(0, 3).map((id, i) => <VideoTile key={id} index={i} label={i === 0 ? 'Example' : `Example ${i + 1}`} onPress={() => void playPublicVideo(id)} />)}
      </View> : null}
      {structure.length ? <View style={styles.beats}>
        {structure.map((b) => <View key={b.key} style={styles.beat}><Text style={s.strong}>{sectionWord(b.key)}</Text><Text style={s.small}>{b.from}–{b.to}s</Text></View>)}
      </View> : null}
    </ProgramCard>

    <ProgramCard>
      <ProgramRow title="Shoot" value={formatDateRange(g.shoot_window.start, g.shoot_window.end)} chevron={false} />
      <ProgramRow title="Video due" value={videoDueText(g.video_due_at, g.post_by)} chevron={false} />
      <ProgramRow title="Deliverables" value={deliverablesLabel(g.deliverables)} chevron={false} />
      <ProgramRow title="Marketing rights" value={g.rights_model === 'creator_v1_perpetual' ? 'Perpetual after full fee release' : usageLabel(g.usage_days)} chevron={false} />
      <ProgramRow title="Where" value={g.city_name} chevron={false} />
      {pay ? <ProgramRow title="Pay" chevron={false} right={<Text style={s.strong}>{pay}</Text>} /> : null}
      {salesShareText(g.sales_share_bps) ? <ProgramRow title="Plus" value={salesShareText(g.sales_share_bps)!} chevron={false} /> : null}
      <ProgramRow title="Spots left" value={String(g.slots_left)} chevron={false} isLast />
    </ProgramCard>
    {g.rights_model === 'creator_v1_perpetual' ? <ProgramNotice text="You keep copyright. Once your full Creator fee is released, Mingla and the paying Host may reuse, edit and advertise with the approved video worldwide without another usage fee. Ads from your own social account still need separate platform permission." /> : null}
    {!verified ? <ProgramNotice text="Browse now. Sending interest unlocks when setup is done." /> : !pkg ? <ProgramNotice tone="warning" text="Set a rate for this format first, then send interest." /> : null}

    <ProgramSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Your price for this gig" snapPoints={['72%']} busy={busy}
      footer={<ProgramButton label="Send interest" busy={busy} disabled={!price.trim()} onPress={() => void send()} />}>
      {pkg ? <>
        <ProgramField inSheet label="Your price" prefix={currencySymbol(pkg.currency)} suffix={pkg.currency} value={price}
          onChangeText={(v) => { setPrice(v.replace(/[^0-9.,]/g, '')); if (error?.field === 'price' || error?.code === 'invalid_price') setError(null); }}
          keyboardType="decimal-pad" error={priceError} hint={`Your saved rate is ${formatMoney(pkg.price_minor, pkg.currency)}.`} />
        {overPayNote ? <Text style={s.small}>{overPayNote}</Text> : null}
        <ProgramField inSheet label="One-line pitch (optional)" value={note} onChangeText={(v) => { setNote(v); if (noteError) setError(null); }} multiline
          counter={{ max: 280 }} maxLength={280} placeholder="Why you’re a good fit" error={noteError} />
        <Text style={s.small}>Notes can’t include contact details, links or handles until you’re hired.</Text>
        {generalError ? <ProgramNotice tone="error" text={generalError.message} /> : null}
        {generalError?.code === 'creator_not_ready' ? <ProgramButton label="Finish setup" variant="secondary" onPress={() => { setSheetOpen(false); router.push('/creator/setup' as never); }} /> : null}
        {generalError?.code === 'payout_rail_mismatch' ? <ProgramButton label="Check payout account" variant="secondary" onPress={() => { setSheetOpen(false); router.push('/payout' as never); }} /> : null}
      </> : null}
    </ProgramSheet>
  </ProgramScreen>;
}

const styles = StyleSheet.create({
  gap: { marginTop: 6 },
  tiles: { flexDirection: 'row', gap: 8 },
  beats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  beat: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: C.field, gap: 2 },
});
