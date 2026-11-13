import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { CREATOR_UNDER_18_ERROR, dayToTypedDob, dobWheelStart, formatTypedDob, isAdult, latestAdultBirthDate, parseDay, toDayString, typedDobToDay } from '../../utils/programFormat';
import { PROGRAM_COLORS as C, ProgramButton, ProgramField, programStyles as s } from '../programs/ProgramUi';

/**
 * #4402 (E25/E26) — date of birth for Creator setup.
 *
 * Typing DD / MM / YYYY works on its own. "Pick from a calendar" opens a wheel that starts 21 years back
 * (never on 1 Jan 2001). On iPhone the wheel sits in a plain bottom panel with no drag gesture of its own, so
 * touching the wheel can only turn the wheel; tapping outside the panel closes it. Android uses the native dialog.
 */
export function CreatorDobField({ value, onChange, error, hint }: {
  value: string | null; onChange: (day: string | null) => void; error?: string | null; hint?: string;
}): React.ReactElement {
  const [text, setText] = useState(dayToTypedDob(value));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(dobWheelStart());
  const maximumDate = latestAdultBirthDate();
  // A saved date that arrives after the first render fills the field (typing never loops: it emits the date it shows).
  useEffect(() => { if (value && value !== typedDobToDay(text)) setText(dayToTypedDob(value)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onType = (raw: string): void => {
    const next = formatTypedDob(raw);
    setText(next);
    onChange(typedDobToDay(next));
  };
  const typedDay = typedDobToDay(text);
  const typedUnder18 = typedDay !== null && !isAdult(typedDay);
  const complete = text.replace(/\D/g, '').length === 8;
  const typedError = complete && typedDay === null ? 'Enter a real date, like 15 / 03 / 2001.' : typedUnder18 ? CREATOR_UNDER_18_ERROR : null;

  const openPicker = (): void => {
    const current = parseDay(typedDay ?? value);
    setDraft(current && current.getTime() <= maximumDate.getTime() ? current : dobWheelStart());
    setOpen(true);
  };
  const choose = (date: Date): void => {
    const day = toDayString(date);
    setText(dayToTypedDob(day));
    onChange(day);
  };
  const onAndroid = (event: DateTimePickerEvent, date?: Date): void => {
    setOpen(false);
    if (event.type === 'set' && date) choose(date);
  };

  return <View style={styles.wrap}>
    <ProgramField label="Date of birth" value={text} onChangeText={onType} placeholder="DD / MM / YYYY" keyboardType="number-pad" maxLength={14}
      autoCorrect={false} error={error ?? typedError} hint={hint ?? 'DD / MM / YYYY. You must be 18 or older. Hosts never see your birthday.'} />
    <ProgramButton label="Pick from a calendar" variant="ghost" icon="calendar-outline" onPress={openPicker} />
    {Platform.OS === 'android' ? (open ? <DateTimePicker value={draft} mode="date" display="default" minimumDate={new Date(1900, 0, 1)} maximumDate={maximumDate} onChange={onAndroid} /> : null) : (
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.root}>
          <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} />
          <View style={styles.panel}>
            <View style={styles.header}>
              <Text style={s.title} accessibilityRole="header">Date of birth</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={() => setOpen(false)}><Text style={s.copy}>✕</Text></Pressable>
            </View>
            <DateTimePicker value={draft} mode="date" display="spinner" themeVariant="dark" textColor="#FFFFFF" minimumDate={new Date(1900, 0, 1)} maximumDate={maximumDate}
              onChange={(_e, date) => { if (date) setDraft(date); }} style={styles.wheel} />
            <Text style={s.small}>Starts 21 years back. Dragging the wheel never drags this panel.</Text>
            <ProgramButton label="Done" onPress={() => { choose(draft); setOpen(false); }} />
          </View>
        </View>
      </Modal>
    )}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: { backgroundColor: C.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wheel: { height: 200 },
});
