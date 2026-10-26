import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PAYOUT_COUNTRIES, payoutCountry, payoutService, usesInAppAccountCheck } from '../../services/payoutService';
import { programErrorText } from '../../services/programResult';
import { ProgramButton, ProgramCard, ProgramField, ProgramLoading, ProgramNotice, ProgramRow, programStyles as s } from '../programs/ProgramUi';
import { ChoiceField } from '../programs/ProgramPickers';

/**
 * #3872 — one payout flow everywhere (Creator setup, Earnings, Local). Pick
 * your country, then Connect bank. Mingla picks the provider from the
 * country; no provider name ever appears.
 */
export function PayoutConnect({ onConnected }: { onConnected?: () => void }): React.ReactElement {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['creator', 'payout'], queryFn: () => payoutService.status(), retry: 0 });
  const [country, setCountry] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const [resolved, setResolved] = useState<{ name: string; masked: string; account: string; bank: string } | null>(null);
  const inApp = usesInAppAccountCheck(country);
  const banks = useQuery({ queryKey: ['payout', 'banks'], queryFn: () => payoutService.banks(), enabled: inApp, staleTime: 60 * 60_000, retry: 1 });
  const bankOptions = useMemo(() => (banks.data ?? []).map((b) => ({ value: b.code, label: b.name })), [banks.data]);
  const bankName = (banks.data ?? []).find((b) => b.code === bankCode)?.name ?? '';

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['creator'] });
    await queryClient.invalidateQueries({ queryKey: ['earnings-wallet'] });
  };

  const connectLink = async (): Promise<void> => {
    if (!country) return;
    setBusy(true); setError(null);
    try {
      await payoutService.connectWithLink(country);
      await refresh();
      const next = await queryClient.fetchQuery({ queryKey: ['creator', 'payout'], queryFn: () => payoutService.status(), staleTime: 0 });
      if (next.connected) { setEditing(false); onConnected?.(); }
    } catch (e) { setError(programErrorText(e)); } finally { setBusy(false); }
  };

  const check = async (): Promise<void> => {
    if (!bankCode) { setError('Choose your bank.'); return; }
    if (!/^\d{10}$/.test(account)) { setError('Enter the 10-digit account number.'); return; }
    setBusy(true); setError(null);
    try {
      const result = await payoutService.checkAccount({ accountNumber: account, bankCode });
      setResolved({ name: result.account_name, masked: result.account_number_masked, account, bank: bankCode });
    } catch (e) { setError(programErrorText(e)); } finally { setBusy(false); }
  };

  const confirm = async (): Promise<void> => {
    if (!resolved || resolved.account !== account || resolved.bank !== bankCode || !bankCode) { setResolved(null); setError('Check the account name again before saving.'); return; }
    setBusy(true); setError(null);
    try {
      await payoutService.saveAccount({ accountNumber: account, bankCode, bankName });
      await refresh();
      setEditing(false); setResolved(null); setAccount('');
      onConnected?.();
    } catch (e) { setError(programErrorText(e)); } finally { setBusy(false); }
  };

  if (status.isLoading) return <ProgramLoading />;
  const current = status.data;

  if (current?.connected && !editing) {
    return <View style={{ gap: 12 }}>
      <ProgramCard>
        <ProgramRow icon="cash-outline" title="Payout account" subtitle={current.summary} value="Connected" chevron={false} isLast />
      </ProgramCard>
      <Text style={s.small}>Mingla never shows money as paid until your bank confirms it.</Text>
      <ProgramButton label="Change bank" variant="secondary" onPress={() => { setEditing(true); setCountry(current.countryCode); }} />
    </View>;
  }

  return <View style={{ gap: 14 }}>
    <ProgramCard>
      <Text style={s.strong}>Get paid to your own bank. Mingla never holds your bank details.</Text>
      <Text style={s.small}>The same secure bank onboarding Mingla’s partners use.</Text>
    </ProgramCard>
    {current?.pending ? <ProgramNotice tone="warning" text={`${current.summary}. Tap Connect bank to finish.`} /> : null}
    {status.isError ? <ProgramNotice tone="error" text={programErrorText(status.error)} /> : null}
    <ChoiceField label="Country of your bank" title="Country of your bank" placeholder="Choose a country" searchable value={country}
      options={PAYOUT_COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
      onChange={(v) => { setCountry(v); setError(null); setResolved(null); }} />
    {country && inApp ? <>
      <ChoiceField label="Bank" title="Your bank" placeholder={banks.isLoading ? 'Loading banks…' : 'Choose your bank'} searchable value={bankCode}
        options={bankOptions} onChange={(v) => { setBankCode(v); setResolved(null); setError(null); }} disabled={banks.isLoading} error={banks.isError ? programErrorText(banks.error) : null} />
      <ProgramField label="Account number" value={account} onChangeText={(v) => { setAccount(v.replace(/\D/g, '').slice(0, 10)); setResolved(null); setError(null); }}
        keyboardType="number-pad" maxLength={10} placeholder="10 digits" autoCorrect={false} hint="Mingla keeps only the last four digits." />
      {resolved ? <ProgramCard tone="highlight" accessibilityLabel={`Account name ${resolved.name}`}>
        <Text style={s.label}>Is this you?</Text>
        <Text style={s.title}>{resolved.name}</Text>
        <Text style={s.copy}>{bankName} · {resolved.masked}</Text>
        <ProgramButton label="Yes, connect this account" busy={busy} onPress={() => void confirm()} />
        <ProgramButton label="Change details" variant="ghost" disabled={busy} onPress={() => setResolved(null)} />
      </ProgramCard> : <ProgramButton label="Connect bank" busy={busy} disabled={!bankCode || account.length !== 10} onPress={() => void check()} />}
    </> : null}
    {country && !inApp ? <>
      <Text style={s.copy}>You’ll add your bank details on a secure page, then come back here.</Text>
      <ProgramButton label="Connect bank" busy={busy} onPress={() => void connectLink()} />
    </> : null}
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    {editing ? <ProgramButton label="Keep my current bank" variant="ghost" onPress={() => setEditing(false)} /> : null}
    {country && !payoutCountry(country) ? <ProgramNotice tone="warning" text="Payouts aren’t available in that country yet." /> : null}
  </View>;
}
