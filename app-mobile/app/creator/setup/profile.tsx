import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CREATOR_LANGUAGES, CREATOR_NICHES, creatorProgramService } from '../../../src/services/creatorProgramService';
import { PAID_ADS_NOTICE, homeCityFrom, profileCityId, type HomeCity } from '../../../src/services/creatorProgramMapping';
import { ProgramActionError, programErrorText } from '../../../src/services/programResult';
import { nicheLabel } from '../../../src/utils/programFormat';
import { SETUP_STATUS_KEY, goToNextStep, stepTitle } from '../../../src/components/creator/setupNav';
import { HomeCityField } from '../../../src/components/creator/HomeCityField';
import { ProgramButton, ProgramField, ProgramLoading, ProgramNotice, ProgramScreen, programStyles as s } from '../../../src/components/programs/ProgramUi';
import { Chip } from '../../../src/components/programs/ProgramPickers';

export default function CreatorProfileStep(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const own = useQuery({ queryKey: ['creator', 'own-profile'], queryFn: () => creatorProgramService.ownProfile() });
  const status = useQuery({ queryKey: SETUP_STATUS_KEY, queryFn: () => creatorProgramService.status() });
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState<HomeCity | null>(null);
  const [cityTouched, setCityTouched] = useState(false);
  const [niches, setNiches] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>(['English']);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ProgramActionError | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (loaded || own.isLoading || status.isLoading) return;
    const p = own.data;
    if (p) {
      setName(p.display_name); setBio(p.bio ?? ''); setNiches(p.niches);
      setLanguages(p.languages.length ? p.languages : ['English']);
    }
    // The saved home city, live or not (profile read first, then the status call).
    setCity(p?.home_city ?? homeCityFrom(status.data?.home_city));
    setLoaded(true);
  }, [own.data, own.isLoading, status.data, status.isLoading, loaded]);

  const nameError = touched && name.trim().length < 2 ? 'Use at least 2 characters.' : name.trim().length > 40 ? 'Use 40 characters or fewer.' : null;
  const valid = name.trim().length >= 2 && name.trim().length <= 40 && bio.length <= 160 && niches.length > 0 && languages.length > 0;

  const save = async (): Promise<void> => {
    setTouched(true);
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      await creatorProgramService.saveProfile({ displayName: name, bio, homeCityId: profileCityId(city), niches, languages, dateOfBirth: own.data?.date_of_birth ?? null });
      // Live or not, a changed home city is saved here (after the profile exists); a non-live one never matches hosts until it launches.
      if (city && cityTouched) await creatorProgramService.setHomeCity({ id: city.id, name: city.name, countryCode: city.countryCode ?? 'US', isLive: city.isLive });
      await goToNextStep(router, queryClient, 'profile');
    } catch (e) {
      setError(e instanceof ProgramActionError ? e : new ProgramActionError('unknown_error', { message: programErrorText(e) }));
    } finally { setBusy(false); }
  };

  const toggle = (list: string[], value: string, max: number): string[] => list.includes(value) ? list.filter((v) => v !== value) : list.length < max ? [...list, value] : list;

  if (own.isLoading || status.isLoading) return <ProgramScreen title={stepTitle('profile')}><ProgramLoading /></ProgramScreen>;

  return <ProgramScreen title={stepTitle('profile')} footer={<ProgramButton label="Save and continue" busy={busy} disabled={!valid} onPress={() => void save()} />}>
    <ProgramField label="Name hosts see" value={name} onChangeText={setName} onBlur={() => setTouched(true)} placeholder="e.g. Ada Films" maxLength={40}
      error={error?.field === 'display_name' ? error.message : nameError} autoCorrect={false} returnKeyType="next" />
    <ProgramField label="Short bio" value={bio} onChangeText={setBio} placeholder="What you make and where" multiline counter={{ max: 160 }} maxLength={160} />
    <HomeCityField value={city} onChange={(next) => { setCity(next); setCityTouched(true); }} error={error?.field === 'home_city' || error?.code === 'city_required' ? error.message : null} />
    <View style={{ gap: 8 }}>
      <Text style={s.fieldLabel}>What you make · up to 5</Text>
      <View style={s.wrap}>{CREATOR_NICHES.map((n) => <Chip key={n} label={nicheLabel(n)} selected={niches.includes(n)} onPress={() => setNiches((v) => toggle(v, n, 5))} />)}</View>
      {touched && niches.length === 0 ? <Text style={s.fieldErrorText}>Pick at least one.</Text> : null}
    </View>
    <View style={{ gap: 8 }}>
      <Text style={s.fieldLabel}>Languages you create in</Text>
      <View style={s.wrap}>{CREATOR_LANGUAGES.map((l) => <Chip key={l} label={l} selected={languages.includes(l)} onPress={() => setLanguages((v) => toggle(v, l, 6))} />)}</View>
    </View>
    <ProgramNotice text={PAID_ADS_NOTICE} />
    {error && error.field !== 'display_name' && error.field !== 'home_city' && error.code !== 'city_required' ? <ProgramNotice tone="error" text={error.message} /> : null}
    <Text style={s.small}>Your date of birth is asked when you sign the agreement. Hosts never see it.</Text>
  </ProgramScreen>;
}
