import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { creatorProgramService, type CreatorPackage } from '../../../src/services/creatorProgramService';
import { payoutService, payoutCountry } from '../../../src/services/payoutService';
import { programErrorText } from '../../../src/services/programResult';
import { FORMAT_INFO, currencySymbol, formatMoney, moneyInputValue, parseMoneyInput, platformLabel, type FormatInfo } from '../../../src/utils/programFormat';
import { SETUP_STATUS_KEY, goToNextStep, stepTitle } from '../../../src/components/creator/setupNav';
import { ProgramButton, ProgramCard, ProgramField, ProgramLoading, ProgramNotice, ProgramRow, ProgramScreen, ProgramSheet, programStyles as s } from '../../../src/components/programs/ProgramUi';
import { Chip } from '../../../src/components/programs/ProgramPickers';

const CURRENCIES = ['USD', 'NGN', 'GBP', 'EUR', 'CAD'] as const;
const RATE_PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
const TURNAROUND = [1, 2, 3, 5, 7, 14];
type Draft = { format: FormatInfo; price: string; currency: string; platforms: string[]; turnaround: number; existing: CreatorPackage | null };

export default function CreatorRatesStep(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: SETUP_STATUS_KEY, queryFn: () => creatorProgramService.status() });
  const payout = useQuery({ queryKey: ['creator', 'payout'], queryFn: () => payoutService.status(), retry: 0 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const packages = status.data?.packages ?? [];
  const byFormat = new Map(packages.map((p) => [p.format_key, p]));
  const active = packages.filter((p) => p.active);
  const defaultCurrency = active[0]?.currency ?? payoutCountry(payout.data?.countryCode)?.currency ?? 'USD';

  const open = (format: FormatInfo): void => {
    const existing = byFormat.get(format.key) ?? null;
    const currency = existing?.currency ?? defaultCurrency;
    setDraft({
      format, existing, currency,
      price: existing ? moneyInputValue(existing.price_minor, existing.currency) : '',
      platforms: existing?.platforms?.length ? existing.platforms : ['instagram'],
      turnaround: existing?.turnaround_days ?? 3,
    });
    setError(null); setPriceError(null);
  };

  const save = async (activeFlag = true): Promise<void> => {
    if (!draft) return;
    const minor = parseMoneyInput(draft.price, draft.currency);
    if (activeFlag && minor === null) { setPriceError(`Enter a price above zero, like ${currencySymbol(draft.currency)}300.`); return; }
    if (activeFlag && draft.platforms.length === 0) { setError('Pick at least one platform.'); return; }
    setBusy(true); setError(null);
    try {
      await creatorProgramService.savePackage({
        formatKey: draft.format.key, platforms: draft.platforms.length ? draft.platforms : ['instagram'],
        priceMinor: minor ?? draft.existing?.price_minor ?? 1, currency: draft.currency, turnaroundDays: draft.turnaround,
        active: activeFlag,
      });
      await queryClient.invalidateQueries({ queryKey: ['creator'] });
      setDraft(null);
    } catch (e) {
      setError(programErrorText(e));
    } finally { setBusy(false); }
  };

  if (status.isLoading) return <ProgramScreen title={stepTitle('rates')}><ProgramLoading /></ProgramScreen>;

  return <ProgramScreen title={stepTitle('rates')}
    footer={<ProgramButton label={active.length ? 'Continue' : 'Set at least one rate'} disabled={active.length === 0} onPress={() => void goToNextStep(router, queryClient, 'rates')} />}>
    <Text style={s.copy}>Your starting price per format. You can change it for each gig when you send interest.</Text>
    <ProgramCard>
      {FORMAT_INFO.map((f, i) => {
        const p = byFormat.get(f.key);
        const on = Boolean(p?.active);
        return <ProgramRow key={f.key} title={f.name}
          subtitle={`${f.seconds[0]}–${f.seconds[1]}s${on && p ? ` · ${p.platforms.map(platformLabel).join(', ')} · ${p.turnaround_days} day${p.turnaround_days === 1 ? '' : 's'}` : ''}`}
          value={on && p ? formatMoney(p.price_minor, p.currency) : 'Not offered'} onPress={() => open(f)} isLast={i === FORMAT_INFO.length - 1} />;
      })}
    </ProgramCard>

    <ProgramSheet visible={draft !== null} onClose={() => setDraft(null)} title={draft?.format.name ?? ''} snapPoints={['88%']} busy={busy}
      footer={<View style={{ gap: 8 }}>
        <ProgramButton label="Save rate" busy={busy} onPress={() => void save(true)} />
        {draft?.existing?.active ? <ProgramButton label="Stop offering this format" variant="ghost" disabled={busy} onPress={() => void save(false)} /> : null}
      </View>}>
      {draft ? <>
        <Text style={s.copy}>{draft.format.oneLine}</Text>
        <ProgramField inSheet label="Your price" prefix={currencySymbol(draft.currency)} suffix={draft.currency} value={draft.price}
          onChangeText={(v) => { setDraft({ ...draft, price: v.replace(/[^0-9.,]/g, '') }); setPriceError(null); }} keyboardType="decimal-pad" placeholder="300" error={priceError} />
        <Text style={s.fieldLabel}>Currency</Text>
        <View style={s.wrap}>{CURRENCIES.map((c) => <Chip key={c} label={`${currencySymbol(c)} ${c}`} selected={draft.currency === c} onPress={() => setDraft({ ...draft, currency: c })} />)}</View>
        <Text style={s.fieldLabel}>Where you post it</Text>
        <View style={s.wrap}>{RATE_PLATFORMS.map((p) => <Chip key={p} label={platformLabel(p)} selected={draft.platforms.includes(p)}
          onPress={() => setDraft({ ...draft, platforms: draft.platforms.includes(p) ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p] })} />)}</View>
        <Text style={s.fieldLabel}>Turnaround after the shoot</Text>
        <View style={s.wrap}>{TURNAROUND.map((d) => <Chip key={d} label={`${d} day${d === 1 ? '' : 's'}`} selected={draft.turnaround === d} onPress={() => setDraft({ ...draft, turnaround: d })} />)}</View>
        <ProgramNotice text="Your price includes perpetual organic and paid-marketing rights for Mingla and the paying Host once your full Creator fee is released. You keep copyright." />
        {error ? <ProgramNotice tone="error" text={error} /> : null}
      </> : null}
    </ProgramSheet>
  </ProgramScreen>;
}
