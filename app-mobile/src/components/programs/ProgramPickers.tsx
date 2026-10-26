/**
 * #3872 — native pickers for the Creator and Local screens. Nothing here is a
 * typed date, time, currency or country: dates use the platform date picker,
 * ranges and in-window days use a small calendar grid, choices open a sheet.
 */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Icon } from '../ui/Icon';
import { BottomSheetTextInput } from '../ui/BaseBottomSheet';
import { PROGRAM_COLORS as C, ProgramButton, ProgramSheet, SelectField, programStyles as s } from './ProgramUi';
import { formatDateRange, formatShortDate, formatTime, parseDay, toDayString } from '../../utils/programFormat';

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

// ── Date (native picker) ───────────────────────────────────────────────────

export function DateField({ label, value, onChange, placeholder = 'Choose date', minimumDate, maximumDate, error, hint, sheetTitle, initialDate }: {
  label?: string; value: string | null; onChange: (day: string) => void; placeholder?: string; minimumDate?: Date; maximumDate?: Date;
  error?: string | null; hint?: string; sheetTitle?: string; initialDate?: Date;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const selected = parseDay(value) ?? initialDate ?? maximumDate ?? new Date();
  const [draft, setDraft] = useState<Date>(selected);
  const display = value ? formatShortDate(value, new Date(0)) : null;
  const openPicker = (): void => { setDraft(parseDay(value) ?? initialDate ?? maximumDate ?? new Date()); setOpen(true); };
  const onAndroid = (event: DateTimePickerEvent, date?: Date): void => {
    setOpen(false);
    if (event.type === 'set' && date) onChange(toDayString(date));
  };
  return <>
    <SelectField label={label} value={display} placeholder={placeholder} onPress={openPicker} error={error} icon="calendar-outline" />
    {hint && !error ? <Text style={s.fieldHint}>{hint}</Text> : null}
    {Platform.OS === 'android' ? (open ? <DateTimePicker value={draft} mode="date" display="default" minimumDate={minimumDate} maximumDate={maximumDate} onChange={onAndroid} /> : null) : (
      <ProgramSheet visible={open} onClose={() => setOpen(false)} title={sheetTitle ?? label ?? 'Choose a date'} snapPoints={['58%']}
        footer={<ProgramButton label="Done" onPress={() => { onChange(toDayString(draft)); setOpen(false); }} />}>
        <DateTimePicker value={draft} mode="date" display="spinner" themeVariant="dark" textColor="#FFFFFF" minimumDate={minimumDate} maximumDate={maximumDate}
          onChange={(_e, date) => { if (date) setDraft(date); }} style={styles.spinner} />
        {hint ? <Text style={s.copy}>{hint}</Text> : null}
      </ProgramSheet>
    )}
  </>;
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

// ── Calendar grid (single day inside a window, or a range) ────────────────

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function monthMatrix(year: number, month: number): Array<Array<Date | null>> {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))];
  while (cells.length % 7) cells.push(null);
  const rows: Array<Array<Date | null>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

const dayKey = (d: Date): string => toDayString(d);

export function CalendarGrid({ start, end, onPick, minDate, maxDate, mode = 'single' }: {
  start: string | null; end?: string | null; onPick: (day: string) => void; minDate?: string | null; maxDate?: string | null; mode?: 'single' | 'range';
}): React.ReactElement {
  const initial = parseDay(start) ?? parseDay(minDate) ?? new Date();
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const min = parseDay(minDate);
  const max = parseDay(maxDate);
  const a = parseDay(start);
  const b = mode === 'range' ? parseDay(end) : a;
  const rows = monthMatrix(cursor.getFullYear(), cursor.getMonth());
  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
  const canPrev = !min || new Date(cursor.getFullYear(), cursor.getMonth(), 0) >= new Date(min.getFullYear(), min.getMonth(), 1);
  const canNext = !max || new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) <= max;
  return <View style={styles.calendar}>
    <View style={s.rowLine}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" disabled={!canPrev} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} hitSlop={10} style={!canPrev && s.disabled}><Icon name="chevron-back" size={18} color={C.text} /></Pressable>
      <Text style={s.strong}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={!canNext} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} hitSlop={10} style={!canNext && s.disabled}><Icon name="chevron-forward" size={18} color={C.text} /></Pressable>
    </View>
    <View style={styles.week}>{WEEKDAYS.map((d, i) => <Text key={i} style={styles.weekday}>{d}</Text>)}</View>
    {rows.map((row, r) => <View key={r} style={styles.week}>{row.map((day, i) => {
      if (!day) return <View key={i} style={styles.cell} />;
      const outside = (min && day < min) || (max && day > max);
      const isStart = a && dayKey(day) === dayKey(a);
      const isEnd = b && dayKey(day) === dayKey(b);
      const inRange = a && b && day > a && day < b;
      return <Pressable key={i} accessibilityRole="button" accessibilityLabel={formatShortDate(day)} accessibilityState={{ selected: Boolean(isStart || isEnd), disabled: Boolean(outside) }}
        disabled={Boolean(outside)} onPress={() => onPick(dayKey(day))}
        style={[styles.cell, inRange && styles.cellRange, (isStart || isEnd) && styles.cellOn, outside && styles.cellOff]}>
        <Text style={[styles.cellText, (isStart || isEnd) && { color: '#171411', fontWeight: '900' }, outside && { color: C.faint }]}>{day.getDate()}</Text>
      </Pressable>;
    })}</View>)}
  </View>;
}

/** Start/end range picked on one calendar: first tap starts, second tap ends. */
export function DateRangeField({ label, start, end, onChange, minDate, maxDate, error }: {
  label?: string; start: string | null; end: string | null; onChange: (range: { start: string; end: string }) => void; minDate?: string | null; maxDate?: string | null; error?: string | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ start: string | null; end: string | null }>({ start, end });
  const pick = (day: string): void => {
    setDraft((cur) => (!cur.start || cur.end || day < cur.start ? { start: day, end: null } : { start: cur.start, end: day }));
  };
  return <>
    <SelectField label={label} value={start && end ? formatDateRange(start, end) : null} placeholder="Choose dates" icon="calendar-outline" onPress={() => { setDraft({ start, end }); setOpen(true); }} error={error} />
    <ProgramSheet visible={open} onClose={() => setOpen(false)} title={label ?? 'Choose dates'} snapPoints={['72%']}
      footer={<ProgramButton label={draft.start && draft.end ? `Use ${formatDateRange(draft.start, draft.end)}` : 'Pick a start and end date'} disabled={!draft.start || !draft.end}
        onPress={() => { if (draft.start && draft.end) { onChange({ start: draft.start, end: draft.end }); setOpen(false); } }} />}>
      <CalendarGrid mode="range" start={draft.start} end={draft.end} onPick={pick} minDate={minDate} maxDate={maxDate} />
    </ProgramSheet>
  </>;
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

/** Four-step level for a budget with no configured money range. */
export function LevelDots({ level }: { level: number }): React.ReactElement {
  return <View style={styles.dots} accessibilityLabel={`Budget level ${level} of 4`}>
    {[1, 2, 3, 4].map((n) => <View key={n} style={[styles.dot, n <= level && styles.dotOn]} />)}
  </View>;
}

const styles = StyleSheet.create({
  search: { marginBottom: 0 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12 },
  choiceOn: { backgroundColor: C.accentSoft },
  spinner: { alignSelf: 'stretch', height: 216 },
  timeWrap: { width: '100%', alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.field, paddingHorizontal: 14 },
  chipOn: { borderColor: C.accentBorder, backgroundColor: C.accentSoft },
  chipText: { color: C.text, fontSize: 14, fontWeight: '700' },
  calendar: { gap: 8 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: C.faint, fontSize: 12, fontWeight: '700' },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999, margin: 1 },
  cellOn: { backgroundColor: C.accent },
  cellRange: { backgroundColor: C.accentSoft, borderRadius: 8 },
  cellOff: { opacity: 0.4 },
  cellText: { color: C.text, fontSize: 15, fontWeight: '600' },
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
  dots: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  dot: { width: 14, height: 6, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.16)' },
  dotOn: { backgroundColor: C.accent },
});
