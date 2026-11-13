import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CREATOR_PLATFORMS, creatorProgramService, type CreatorHandle } from '../../../src/services/creatorProgramService';
import { programErrorText } from '../../../src/services/programResult';
import { FOLLOWER_BAND_KEYS, followerBandLabel, formatTimeLeft, platformLabel } from '../../../src/utils/programFormat';
import { copyAddressText } from '../../../src/utils/copyAddressText';
import { SETUP_STATUS_KEY, goToNextStep, stepTitle } from '../../../src/components/creator/setupNav';
import { audienceLine, handleCheckView } from '../../../src/components/creator/handleCheckState';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramField, ProgramLoading, ProgramNotice, ProgramPill, ProgramRow, ProgramScreen, ProgramSheet, programStyles as s } from '../../../src/components/programs/ProgramUi';
import { Chip } from '../../../src/components/programs/ProgramPickers';
import { Icon } from '../../../src/components/ui/Icon';

type CheckError = { tone: 'error'; text: string };

export default function CreatorSocialsStep(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: SETUP_STATUS_KEY, queryFn: () => creatorProgramService.status() });
  const [platform, setPlatform] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [band, setBand] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, CheckError>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const handles = status.data?.handles ?? [];
  const suggested = status.data?.suggested_handles ?? {};
  const byPlatform = new Map(handles.map((h) => [h.platform, h]));
  const anyVerified = handles.some((h) => h.verified && !h.review_required);
  // #4402: a handle with Mingla for review lets setup go on; the step passes when Mingla approves it.
  const anySubmitted = anyVerified || handles.some((h) => h.review_required && h.last_check_status !== 'rejected');

  const openPlatform = (key: string): void => {
    const existing = byPlatform.get(key);
    // #4402 C18: a platform with no row yet starts from the Local application.
    const fromLocal = !existing ? suggested[key] ?? null : null;
    setPlatform(key); setHandle(existing?.handle ?? fromLocal ?? ''); setBand(existing?.follower_band ?? null); setFieldError(null);
    setPrefilled(Boolean(fromLocal));
  };

  const getCode = async (): Promise<void> => {
    if (!platform) return;
    const clean = handle.trim().replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9._-]{1,80}$/.test(clean)) { setFieldError('Use letters, numbers, dots, dashes or underscores only, without the @.'); return; }
    setBusy(true); setFieldError(null);
    try {
      await creatorProgramService.saveHandle({ platform, handle: clean, followerBand: band });
      await queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
      setPlatform(null);
    } catch (e) {
      setFieldError(programErrorText(e));
    } finally { setBusy(false); }
  };

  const check = async (h: CreatorHandle): Promise<void> => {
    setWorking(h.id);
    setErrors((r) => { const next = { ...r }; delete next[h.id]; return next; });
    try {
      await creatorProgramService.verifyHandle(h.id);
      // The card reads the saved outcome back from the server.
      await queryClient.invalidateQueries({ queryKey: ['creator'] });
    } catch (e) {
      setErrors((r) => ({ ...r, [h.id]: { tone: 'error', text: programErrorText(e) } }));
    } finally { setWorking(null); }
  };

  // #4402: an expired code gets a fresh one for the same handle (a rejected one cannot).
  const newCode = async (h: CreatorHandle): Promise<void> => {
    setWorking(h.id);
    setErrors((r) => { const next = { ...r }; delete next[h.id]; return next; });
    try {
      await creatorProgramService.saveHandle({ platform: h.platform, handle: h.handle, followerBand: h.follower_band ?? null });
      await queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
    } catch (e) {
      setErrors((r) => ({ ...r, [h.id]: { tone: 'error', text: programErrorText(e) } }));
    } finally { setWorking(null); }
  };

  const copy = async (code: string): Promise<void> => {
    try { await copyAddressText(code); setCopied(code); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); }
  };

  const platformRejected = platform !== null && byPlatform.get(platform)?.last_check_status === 'rejected';
  if (status.isLoading) return <ProgramScreen title={stepTitle('socials')}><ProgramLoading /></ProgramScreen>;
  const pendingHandles = handles.filter((h) => handleCheckView(h).kind !== 'verified');

  return <ProgramScreen title={stepTitle('socials')}
    footer={<ProgramButton label={anySubmitted ? 'Continue' : 'Add one account to continue'} disabled={!anySubmitted} onPress={() => void goToNextStep(router, queryClient, 'socials')} />}>
    <Text style={s.copy}>Prove one account is yours: add a short code to your public bio. A person at Mingla checks it and confirms the account. Hosts see the platform and audience size, never your handle.</Text>

    {pendingHandles.map((h) => {
      const view = handleCheckView(h);
      const showCode = view.kind !== 'expired' && view.kind !== 'rejected';
      return <ProgramCard key={h.id} tone="highlight">
        <View style={styles.titleRow}>
          <Text style={[s.label, styles.title]}>Your code for {platformLabel(h.platform)} · @{h.handle}</Text>
          <ProgramPill label={view.pill.label} tone={view.pill.tone} />
        </View>
        {showCode ? <View style={styles.codeRow}>
          <Text style={styles.code} selectable accessibilityLabel={`Code ${h.verify_code.split('').join(' ')}`}>{h.verify_code}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Copy code" onPress={() => void copy(h.verify_code)} style={styles.copy} hitSlop={8}>
            <Icon name={copied === h.verify_code ? 'checkmark' : 'copy-outline'} size={16} color={C.accent} />
            <Text style={s.accentText}>{copied === h.verify_code ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        </View> : null}
        {view.kind === 'review' && !h.last_check_status ? <Text style={s.copy}>Paste it anywhere in your {platformLabel(h.platform)} bio and save.</Text> : null}
        <ProgramNotice tone={view.noticeTone} text={view.text} />
        {showCode && h.expires_at ? <Text style={s.small}>{formatTimeLeft(h.expires_at, new Date(), 'to use this code')}</Text> : null}
        {errors[h.id] ? <ProgramNotice tone="error" text={errors[h.id].text} /> : null}
        {view.action === 'check' ? <ProgramButton label="I added the code" variant="secondary" busy={working === h.id} onPress={() => void check(h)} /> : null}
        {view.action === 'new_code' ? <ProgramButton label="Get a new code" busy={working === h.id} onPress={() => void newCode(h)} /> : null}
      </ProgramCard>;
    })}

    <ProgramCard>
      {CREATOR_PLATFORMS.map((key, i) => {
        const h = byPlatform.get(key);
        const right = h ? <ProgramPill label={handleCheckView(h).pill.label} tone={handleCheckView(h).pill.tone} /> : null;
        return <ProgramRow key={key} title={platformLabel(key)} subtitle={h ? `@${h.handle} · ${audienceLine(h)}` : 'Not added'}
          right={right} onPress={() => openPlatform(key)} isLast={i === CREATOR_PLATFORMS.length - 1} />;
      })}
    </ProgramCard>

    <ProgramSheet visible={platform !== null} onClose={() => setPlatform(null)} title={platform ? `Your ${platformLabel(platform)}` : ''} snapPoints={['62%']} busy={busy}
      footer={platformRejected
        ? <ProgramButton label="Not confirmed by Mingla" disabled onPress={() => undefined} />
        : <ProgramButton label={platform && byPlatform.get(platform) ? 'Save and get a new code' : 'Get my code'} busy={busy} disabled={!handle.trim()} onPress={() => void getCode()} />}>
      {platformRejected ? <ProgramNotice tone="error" text="Mingla couldn’t confirm this account, so it can’t be changed here. Message Mingla if you think this is a mistake." /> : null}
      <ProgramField inSheet label="Handle" prefix="@" value={handle} onChangeText={(v) => { setHandle(v.replace(/^@+/, '')); setFieldError(null); setPrefilled(false); }}
        placeholder="yourhandle" autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType="default" textContentType="username" error={fieldError} />
      {prefilled ? <Text style={s.small}>From your Mingla Local application</Text> : null}
      <Text style={s.fieldLabel}>Audience size</Text>
      <View style={s.wrap}>{FOLLOWER_BAND_KEYS.map((k) => <Chip key={k} label={followerBandLabel(k)} selected={band === k} onPress={() => setBand(k)} />)}</View>
      <Text style={s.small}>Audience size is self-reported. Mingla may ask for a screenshot.</Text>
    </ProgramSheet>
  </ProgramScreen>;
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)' },
  code: { color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 2, fontVariant: ['tabular-nums'] },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.accentSoft },
});
