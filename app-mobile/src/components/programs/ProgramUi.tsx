import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

export const PROGRAM_COLORS = { canvas: '#171411', card: '#24201d', border: '#413a34', text: '#fffaf5', muted: '#bcb2aa', accent: '#eb7825', success: '#55c889', danger: '#ff8878' } as const;

export function ProgramCard({ children, style }: { children: React.ReactNode; style?: object }): React.ReactElement {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function ProgramButton({ label, onPress, disabled = false, busy = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean }): React.ReactElement {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, (disabled || busy) && styles.disabled, pressed && styles.pressed]}>
    {busy ? <ActivityIndicator color={secondary ? PROGRAM_COLORS.text : '#111'} /> : <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>}
  </Pressable>;
}

export function ProgramField(props: TextInputProps): React.ReactElement {
  return <TextInput placeholderTextColor={PROGRAM_COLORS.muted} {...props} style={[styles.field, props.multiline && styles.multiline, props.style]} />;
}

export function ProgramChip({ label, selected = false, onPress, disabled = false }: { label: string; selected?: boolean; onPress: () => void; disabled?: boolean }): React.ReactElement {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.chip, selected && styles.chipOn, disabled && styles.disabled]}><Text style={styles.chipText}>{label}</Text></Pressable>;
}

export const programStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PROGRAM_COLORS.canvas },
  content: { padding: 18, paddingBottom: 64, gap: 14 },
  eyebrow: { color: PROGRAM_COLORS.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.5, marginTop: 8 },
  heading: { color: PROGRAM_COLORS.text, fontSize: 32, lineHeight: 38, fontWeight: '900' },
  lede: { color: PROGRAM_COLORS.muted, fontSize: 16, lineHeight: 23 },
  title: { color: PROGRAM_COLORS.text, fontSize: 20, lineHeight: 25, fontWeight: '900' },
  copy: { color: PROGRAM_COLORS.muted, fontSize: 14, lineHeight: 21 },
  label: { color: PROGRAM_COLORS.text, fontSize: 13, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { gap: 10, padding: 16, borderWidth: 1, borderColor: PROGRAM_COLORS.border, borderRadius: 18, backgroundColor: PROGRAM_COLORS.card },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: PROGRAM_COLORS.accent },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: PROGRAM_COLORS.border },
  buttonText: { color: '#171411', fontWeight: '900', fontSize: 15 },
  buttonTextSecondary: { color: PROGRAM_COLORS.text },
  field: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: PROGRAM_COLORS.border, color: PROGRAM_COLORS.text, paddingHorizontal: 14, backgroundColor: '#1b1816' },
  multiline: { minHeight: 112, paddingTop: 13, textAlignVertical: 'top' },
  chip: { minHeight: 38, borderRadius: 999, borderWidth: 1, borderColor: PROGRAM_COLORS.border, justifyContent: 'center', paddingHorizontal: 13 },
  chipOn: { borderColor: PROGRAM_COLORS.accent, backgroundColor: '#38261b' },
  chipText: { color: PROGRAM_COLORS.text, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.82 },
  warning: { color: PROGRAM_COLORS.accent, lineHeight: 20 }, success: { color: PROGRAM_COLORS.success, fontWeight: '800' }, danger: { color: PROGRAM_COLORS.danger, fontWeight: '800' },
});

const styles = programStyles;
