import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CREATOR_PLATFORMS, creatorProgramService, type CreatorHandle } from '../../../src/services/creatorProgramService';
import { programErrorText } from '../../../src/services/programResult';
import { FOLLOWER_BAND_KEYS, followerBandLabel, formatTimeLeft, platformLabel } from '../../../src/utils/programFormat';
import { copyAddressText } from '../../../src/utils/copyAddressText';
import { SETUP_STATUS_KEY, goToNextStep, stepTitle } from '../../../src/components/creator/setupNav';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramField, ProgramLoading, ProgramNotice, ProgramPill, ProgramRow, ProgramScreen, ProgramSheet, programStyles as s } from '../../../src/components/programs/ProgramUi';
import { Chip } from '../../../src/components/programs/ProgramPickers';
import { Icon } from '../../../src/components/ui/Icon';

type CheckResult = { tone: 'success' | 'info' | 'warning' | 'error'; text: string };

const CHECK_COPY: Record<string, CheckResult> = {
  verified: { tone: 'success', text: 'Verified. You can remove the code from your bio now.' },
  pending: { tone: 'warning', text: 'We couldn’t see the code yet. Make sure your profile is public and the code is in your bio, then check again.' },
  review: { tone: 'info', text: 'Thanks. A person at Mingla will confirm this account, usually within a day.' },
  expired: { tone: 'warning', text: 'That code expired. Get a new code and add it to your bio.' },
};

export default function CreatorSocialsStep(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: SETUP_STATUS_KEY, queryFn: () => creatorProgramService.status() });
  const [platform, setPlatform] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [band, setBand] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const handles = status.data?.handles ?? [];
  const byPlatform = new Map(handles.map((h) => [h.platform, h]));
  const anyVerified = handles.some((h) => h.verified);

  const openPlatform = (key: string): void => {
    const existing = byPlatform.get(key);
    setPlatform(key); setHandle(existing?.handle ?? ''); setBand(existing?.follower_band ?? null); setFieldError(null);
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
    setChecking(h.id);
    try {
      const result = await creatorProgramService.verifyHandle(h.id);
      setResults((r) => ({ ...r, [h.id]: CHECK_COPY[result.status] ?? CHECK_COPY.pending }));
      await queryClient.invalidateQueries({ queryKey: ['creator'] });
    } catch (e) {
      setResults((r) => ({ ...r, [h.id]: { tone: 'error', text: programErrorText(e) } }));
    } finally { setChecking(null); }
  };

  const copy = async (code: string): Promise<void> => {
    try { await copyAddressText(code); setCopied(code); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); }
  };

  if (status.isLoading) return <ProgramScreen title={stepTitle('socials')}><ProgramLoading /></ProgramScreen>;
  const pendingHandles = handles.filter((h) => !h.verified);

  return <ProgramScreen title={stepTitle('socials')}
    footer={<ProgramButton label={anyVerified ? 'Continue' : 'Verify one account to continue'} disabled={!anyVerified} onPress={() => void goToNextStep(router, queryClient, 'socials')} />}>
    <Text style={s.copy}>Prove one account is yours: add a short code to your public bio, then tap Check. Hosts see the platform and audience size, never your handle.</Text>

    {pendingHandles.map((h) => <ProgramCard key={h.id} tone="highlight">
      <Text style={s.label}>Your code for {platformLabel(h.platform)} · @{h.handle}</Text>
      <View style={styles.codeRow}>
        <Text style={styles.code} selectable accessibilityLabel={`Code ${h.verify_code.split('').join(' ')}`}>{h.verify_code}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy code" onPress={() => void copy(h.verify_code)} style={styles.copy} hitSlop={8}>
          <Icon name={copied === h.verify_code ? 'checkmark' : 'copy-outline'} size={16} color={C.accent} />
          <Text style={s.accentText}>{copied === h.verify_code ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <Text style={s.copy}>1. Paste it anywhere in your {platformLabel(h.platform)} bio and save.{'\n'}2. Come back and tap Check my bio.</Text>
      {h.expires_at ? <Text style={s.small}>{formatTimeLeft(h.expires_at, new Date(), 'to use this code')}</Text> : null}
      {results[h.id] ? <ProgramNotice tone={results[h.id].tone === 'warning' ? 'warning' : results[h.id].tone} text={results[h.id].text} /> : null}
      <ProgramButton label="Check my bio" busy={checking === h.id} onPress={() => void check(h)} />
    </ProgramCard>)}

    <ProgramCard>
      {CREATOR_PLATFORMS.map((key, i) => {
        const h = byPlatform.get(key);
        const right = h?.verified ? <ProgramPill label="Verified" tone="success" /> : h?.review_required ? <ProgramPill label="In review" tone="warning" /> : h ? <ProgramPill label="Code added" tone="accent" /> : null;
        return <ProgramRow key={key} title={platformLabel(key)} subtitle={h ? `@${h.handle} · audience ${followerBandLabel(h.follower_band)}` : 'Not added'}
          right={right} onPress={() => openPlatform(key)} isLast={i === CREATOR_PLATFORMS.length - 1} />;
      })}
    </ProgramCard>

    <ProgramSheet visible={platform !== null} onClose={() => setPlatform(null)} title={platform ? `Your ${platformLabel(platform)}` : ''} snapPoints={['62%']} busy={busy}
      footer={<ProgramButton label={platform && byPlatform.get(platform) ? 'Save and get a new code' : 'Get my code'} busy={busy} disabled={!handle.trim()} onPress={() => void getCode()} />}>
      <ProgramField inSheet label="Handle" prefix="@" value={handle} onChangeText={(v) => { setHandle(v.replace(/^@+/, '')); setFieldError(null); }}
        placeholder="yourhandle" autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType="default" textContentType="username" error={fieldError} />
      <Text style={s.fieldLabel}>Audience size</Text>
      <View style={s.wrap}>{FOLLOWER_BAND_KEYS.map((k) => <Chip key={k} label={followerBandLabel(k)} selected={band === k} onPress={() => setBand(k)} />)}</View>
      <Text style={s.small}>Audience size is self-reported. Mingla may ask for a screenshot.</Text>
    </ProgramSheet>
  </ProgramScreen>;
}

const styles = StyleSheet.create({
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)' },
  code: { color: C.text, fontSize: 24, fontWeight: '900', letterSpacing: 2, fontVariant: ['tabular-nums'] },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.accentSoft },
});
