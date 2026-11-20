/**
 * #3872 — native pickers for the Creator and Local screens. Nothing here is a
 * typed date, time, currency or country: dates use the platform date picker,
 * dates, ranges and in-window days use the shared Mingla calendar
 * (@mingla/calendar), choices open a sheet.
 */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CalendarEmbed, CalendarField, DateRangeField as CalendarDateRangeField } from '@mingla/calendar/CalendarField';
import { Icon } from '../ui/Icon';
import { BottomSheetTextInput } from '../ui/BaseBottomSheet';
import { PROGRAM_COLORS as C, ProgramSheet, SelectField, programStyles as s } from './ProgramUi';
import { formatTime, toDayString } from '../../utils/programFormat';
import { EXPLORER_CALENDAR_CONFIG, deviceTimeZone, useExplorerCalendarLabels } from '../calendar/explorerCalendarConfig';

// ── Choice sheet (dropdowns) ───────────────────────────────────────────────

export type Choice<T extends string> = { value: T; label: string; hint?: string; disabled?: boolean };

export function ChoiceSheet<T extends string>({ visible, onClose, title, options, value, onSelect, searchable = false, emptyText = 'Nothing matches.' }: {
  visible: boolean; onClose: () => void; title: string; options: Array<Choice<T>>; value?: T | null; onSelect: (value: T) => void; searchable?: boolean; emptyText?: string;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)) : options;
  }, [options, query]);
  // W5.1: the search field sits in the sheet's fixed subheader, so it and the
  // title stay on screen while the matches scroll above the keyboard.
  return <ProgramSheet visible={visible} onClose={onClose} title={title} snapPoints={[searchable ? '85%' : '60%']}
    subheader={searchable ? <SearchInput value={query} onChangeText={setQuery} /> : undefined}>
    {shown.length === 0 ? <Text style={s.copy}>{emptyText}</Text> : shown.map((option) => {
      const selected = option.value === value;
      return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected, disabled: option.disabled }} disabled={option.disabled}
        onPress={() => { onSelect(option.value); onClose(); }}
        style={({ pressed }) => [styles.choice, selected && styles.choiceOn, option.disabled && s.disabled, pressed && s.pressed]}>
        <View style={s.flex}>
          <Text style={s.rowTitle}>{option.label}</Text>
          {option.hint ? <Text style={[s.rowSubtitle, { color: C.muted }]}>{option.hint}</Text> : null}
        </View>
        {selected ? <Icon name="checkmark" size={18} color={C.accent} /> : null}
      </Pressable>;
    })}
  </ProgramSheet>;
}

/** The search box used at the top of searchable sheets. */
export function SearchInput({ value, onChangeText, placeholder = 'Search', autoFocus = false }: { value: string; onChangeText: (text: string) => void; placeholder?: string; autoFocus?: boolean }): React.ReactElement {
  return <View style={[s.field, styles.search]}>
    <Icon name="search" size={16} color={C.muted} />
    <BottomSheetTextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.faint} style={s.input}
      autoCorrect={false} autoCapitalize="words" autoFocus={autoFocus} returnKeyType="search" accessibilityLabel={placeholder} />
  </View>;
}

/** Select field + its choice sheet in one. */
export function ChoiceField<T extends string>({ label, title, placeholder, options, value, onChange, error, searchable, disabled }: {
  label?: string; title: string; placeholder: string; options: Array<Choice<T>>; value: T | null | undefined; onChange: (value: T) => void; error?: string | null; searchable?: boolean; disabled?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return <>
    <SelectField label={label} value={current?.label ?? null} placeholder={placeholder} onPress={() => setOpen(true)} error={error} disabled={disabled} />
    <ChoiceSheet visible={open} onClose={() => setOpen(false)} title={title} options={options} value={value ?? null} onSelect={onChange} searchable={searchable} />
  </>;
}

// ── Date (Mingla calendar) ─────────────────────────────────────────────────

// #4523: dates are picked on the shared Mingla calendar (@mingla/calendar), the
// same one Host uses. Changing month never closes it or moves the value.
export function DateField({ label, value, onChange, placeholder = 'Choose date', minimumDate, maximumDate, error, hint, sheetTitle }: {
  label?: string; value: string | null; onChange: (day: string) => void; placeholder?: string; minimumDate?: Date; maximumDate?: Date;
  error?: string | null; hint?: string; sheetTitle?: string;
}): React.ReactElement {
  const labels = useExplorerCalendarLabels();
  return <CalendarField label={label ?? sheetTitle ?? labels.choose_date} value={value ?? ''} onChange={(day) => { if (day !== '') onChange(day); }}
    placeholder={placeholder} min={minimumDate ? toDayString(minimumDate) : undefined} max={maximumDate ? toDayString(maximumDate) : undefined}
    error={error} hint={hint} timeZone={deviceTimeZone()} labels={labels} config={EXPLORER_CALENDAR_CONFIG} />;
}

// ── Time ───────────────────────────────────────────────────────────────────

/** Quick time chips plus "Other time" through the native time picker. Value is "HH:mm". */
export function TimeChips({ value, onChange, options = ['10:00', '12:00', '14:00', '17:00', '18:00', '19:00', '20:00', '21:00'] }: { value: string | null; onChange: (time: string) => void; options?: string[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const base = new Date(2000, 0, 1, 19, 0);
  const asDate = (time: string): Date => { const [h, m] = time.split(':').map(Number); return new Date(2000, 0, 1, h, m); };
  const other = value && !options.includes(value) ? value : null;
  const onPick = (_e: DateTimePickerEvent, date?: Date): void => {
    if (Platform.OS === 'android') setOpen(false);
    if (date) onChange(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
  };
  return <View style={s.wrap}>
    {options.map((time) => <Chip key={time} label={formatTime(asDate(time))} selected={value === time} onPress={() => onChange(time)} />)}
    <Chip label={other ? formatTime(asDate(other)) : 'Other time'} selected={Boolean(other)} onPress={() => setOpen((v) => !v)} icon="time-outline" />
    {open ? <View style={styles.timeWrap}>
      <DateTimePicker value={value ? asDate(value) : base} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} themeVariant="dark" textColor="#FFFFFF" minuteInterval={15} onChange={onPick} />
    </View> : null}
  </View>;
}

export function Chip({ label, selected = false, onPress, icon, disabled }: { label: string; selected?: boolean; onPress: () => void; icon?: 'time-outline' | 'checkmark' | 'add'; disabled?: boolean }): React.ReactElement {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.chip, selected && styles.chipOn, disabled && s.disabled, pressed && s.pressed]}>
    {icon ? <Icon name={icon} size={14} color={selected ? C.accent : C.muted} /> : null}
    <Text style={[styles.chipText, selected && { color: C.accent }]}>{label}</Text>
  </Pressable>;
}

// ── Calendar (single day inside a window, or a range) ─────────────────────

/** One day inside a window, embedded in the screen. The month arrows only move the view. */
export function CalendarGrid({ start, onPick, minDate, maxDate }: {
  start: string | null; onPick: (day: string) => void; minDate?: string | null; maxDate?: string | null;
}): React.ReactElement {
  const labels = useExplorerCalendarLabels();
  return <CalendarEmbed mode="single" label={labels.choose_date} value={start ?? ''} onChange={(day) => { if (day !== '') onPick(day); }}
    min={minDate ?? undefined} max={maxDate ?? undefined} timeZone={deviceTimeZone()} labels={labels} config={EXPLORER_CALENDAR_CONFIG}
    onDone={noop} onCancel={noop} />;
}

const noop = (): void => undefined;

/** Start/end range picked on one calendar: first tap starts, second tap ends, Done commits. */
export function DateRangeField({ label, start, end, onChange, minDate, maxDate, error }: {
  label?: string; start: string | null; end: string | null; onChange: (range: { start: string; end: string }) => void; minDate?: string | null; maxDate?: string | null; error?: string | null;
}): React.ReactElement {
  const labels = useExplorerCalendarLabels();
  return <CalendarDateRangeField label={label ?? labels.choose_dates} value={{ start: start ?? '', end: end ?? '' }} onChange={onChange} unit="days"
    min={minDate ?? undefined} max={maxDate ?? undefined} error={error} timeZone={deviceTimeZone()} labels={labels} config={EXPLORER_CALENDAR_CONFIG} />;
}

// ── Stars, segmented, check rows ───────────────────────────────────────────

export function StarsInput({ value, onChange, size = 34 }: { value: number; onChange: (stars: number) => void; size?: number }): React.ReactElement {
  return <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`Rating ${value} of 5`}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'increment') onChange(Math.min(5, value + 1)); else onChange(Math.max(1, value - 1)); }}>
    {[1, 2, 3, 4, 5].map((n) => <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`} onPress={() => onChange(n)} hitSlop={4}>
      <Icon name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? C.accent : C.faint} />
    </Pressable>)}
  </View>;
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (value: T) => void }): React.ReactElement {
  return <View style={styles.segmented} accessibilityRole="tablist">
    {options.map((o) => {
      const on = o.value === value;
      return <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[styles.segment, on && styles.segmentOn]}>
        <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>{o.label}{typeof o.count === 'number' ? ` ${o.count}` : ''}</Text>
      </Pressable>;
    })}
  </View>;
}

export function CheckRow({ checked, onToggle, label, hint }: { checked: boolean; onToggle: () => void; label: string; hint?: string }): React.ReactElement {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onToggle} style={({ pressed }) => [styles.checkRow, pressed && s.pressed]}>
    <View style={[s.check, checked && s.checkDone, styles.checkBox]}>{checked ? <Icon name="checkmark" size={14} color="#171411" /> : null}</View>
    <View style={s.flex}><Text style={s.strong}>{label}</Text>{hint ? <Text style={s.copy}>{hint}</Text> : null}</View>
  </Pressable>;
}

export function ToggleRow({ value, onToggle, label, hint }: { value: boolean; onToggle: () => void; label: string; hint?: string }): React.ReactElement {
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={onToggle} style={({ pressed }) => [styles.checkRow, pressed && s.pressed]}>
    <View style={s.flex}><Text style={s.strong}>{label}</Text>{hint ? <Text style={s.copy}>{hint}</Text> : null}</View>
    <View style={[styles.track, value && styles.trackOn]}><View style={[styles.thumb, value && styles.thumbOn]} /></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  search: { marginBottom: 0 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12 },
  choiceOn: { backgroundColor: C.accentSoft },
  timeWrap: { width: '100%', alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.field, paddingHorizontal: 14 },
  chipOn: { borderColor: C.accentBorder, backgroundColor: C.accentSoft },
  chipText: { color: C.text, fontSize: 14, fontWeight: '700' },
  stars: { flexDirection: 'row', gap: 6 },
  segmented: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: C.field, borderWidth: 1, borderColor: C.border },
  segment: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentOn: { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  segmentText: { color: C.muted, fontSize: 14, fontWeight: '700' },
  segmentTextOn: { color: C.text },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  checkBox: { borderRadius: 6 },
  track: { width: 46, height: 28, borderRadius: 14, backgroundColor: 'rgba(255, 255, 255, 0.16)', padding: 3 },
  trackOn: { backgroundColor: C.accent },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#ffffff' },
  thumbOn: { transform: [{ translateX: 18 }] },
});
