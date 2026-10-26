/**
 * #3872 round 2 (W5.2) — the creator's home city.
 *
 * Opens on the cities where Mingla is live (marked Live); typing searches any
 * city through `creator_city_search`. Picking a city that isn't live keeps it
 * and says plainly that hosts there can't hire yet, instead of silently
 * accepting it. The screen saves the choice with `creator_home_city_set`.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { creatorProgramService } from '../../services/creatorProgramService';
import { cityHint, homeCityFromOption, notLiveNotice, type CityOption, type HomeCity } from '../../services/creatorProgramMapping';
import { programErrorText } from '../../services/programResult';
import { Icon } from '../ui/Icon';
import { PROGRAM_COLORS as C, ProgramButton, ProgramLoading, ProgramNotice, ProgramPill, ProgramSheet, SelectField, programStyles as s } from '../programs/ProgramUi';
import { SearchInput } from '../programs/ProgramPickers';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function HomeCityField({ value, onChange, error }: { value: HomeCity | null; onChange: (city: HomeCity) => void; error?: string | null }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 250);
  const search = useQuery({
    queryKey: ['creator', 'city-search', q.toLowerCase()],
    queryFn: () => creatorProgramService.citySearch(q || null),
    enabled: open,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const pick = (option: CityOption): void => {
    onChange(homeCityFromOption(option));
    setOpen(false);
    setQuery('');
  };

  const options = search.data ?? [];
  const selectedKey = value ? (value.id ?? `${value.name.toLowerCase()}|${(value.countryCode ?? '').toUpperCase()}`) : null;

  return <View style={styles.wrap}>
    <SelectField label="Home city" value={value?.name ?? null} placeholder="Choose your city" icon="location-outline" onPress={() => setOpen(true)} error={error} />
    {value && !value.isLive ? <ProgramNotice tone="warning" text={notLiveNotice(value.name)} /> : null}
    <ProgramSheet visible={open} onClose={() => { setOpen(false); setQuery(''); }} title="Home city" snapPoints={['85%']}
      subheader={<SearchInput value={query} onChangeText={setQuery} placeholder="Search any city" />}>
      {!q ? <Text style={s.label}>Where Mingla is live</Text> : null}
      {search.isLoading ? <ProgramLoading label="Finding cities" />
        : search.isError ? <View style={styles.wrap}>
          <ProgramNotice tone="error" text={programErrorText(search.error)} />
          <ProgramButton label="Try again" variant="secondary" onPress={() => void search.refetch()} />
        </View>
        : options.length === 0 ? <Text style={s.copy}>{q ? `No city called “${q}”. Check the spelling.` : 'Type your city to find it.'}</Text>
        : options.map((option) => {
          const selected = option.key === selectedKey;
          const hint = cityHint(option);
          return <Pressable key={option.key} accessibilityRole="radio" accessibilityState={{ selected }}
            accessibilityLabel={`${option.name}${option.isLive ? ', live' : ', not live yet'}`}
            onPress={() => pick(option)} style={({ pressed }) => [styles.choice, selected && styles.choiceOn, pressed && s.pressed]}>
            <View style={s.flex}>
              <Text style={s.rowTitle}>{option.name}</Text>
              {hint && !option.isLive ? <Text style={[s.rowSubtitle, { color: C.muted }]}>{hint} · Not live yet</Text>
                : !option.isLive ? <Text style={[s.rowSubtitle, { color: C.muted }]}>Not live yet</Text>
                : option.region ? <Text style={[s.rowSubtitle, { color: C.muted }]}>{option.region}</Text> : null}
            </View>
            {option.isLive ? <ProgramPill label="Live" tone="success" /> : null}
            {selected ? <Icon name="checkmark" size={18} color={C.accent} /> : null}
          </Pressable>;
        })}
    </ProgramSheet>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12 },
  choiceOn: { backgroundColor: C.accentSoft },
});
