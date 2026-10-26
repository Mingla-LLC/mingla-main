/**
 * #3872 — the Creator and Local screens' building blocks, on the app's own
 * glass components (GlassCard, GlassIconButton, Icon, BaseBottomSheet) so the
 * programs read as part of Mingla, not a separate kit.
 *
 * Working screens get a plain title bar with Back (setup steps return to the
 * setup checklist; other screens fall back to Creator or the app root when
 * there is no history) and no marketing hero.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../ui/GlassCard';
import { GlassIconButton } from '../ui/GlassIconButton';
import { Icon, type IconName } from '../ui/Icon';
import { BaseBottomSheet, BottomSheetTextInput } from '../ui/BaseBottomSheet';
import { KeyboardAwareScrollView } from '../ui/KeyboardAwareScrollView';
import { useKeyboard } from '../../hooks/useKeyboard';
import { programBackNav, runProgramNav } from './programNav';
import { glass } from '../../constants/designSystem';

export const PROGRAM_COLORS = {
  canvas: glass.profile.screenBg,
  text: '#ffffff',
  muted: 'rgba(255, 255, 255, 0.64)',
  faint: 'rgba(255, 255, 255, 0.42)',
  border: 'rgba(255, 255, 255, 0.10)',
  field: 'rgba(255, 255, 255, 0.05)',
  accent: '#eb7825',
  accentSoft: 'rgba(235, 120, 37, 0.16)',
  accentBorder: 'rgba(235, 120, 37, 0.45)',
  success: '#55c889',
  successSoft: 'rgba(85, 200, 137, 0.14)',
  warning: '#f5b14c',
  warningSoft: 'rgba(245, 177, 76, 0.14)',
  danger: '#ff8878',
  dangerSoft: 'rgba(255, 136, 120, 0.12)',
} as const;
const C = PROGRAM_COLORS;

// ── Header + screen ────────────────────────────────────────────────────────

/**
 * Every Creator and Local screen opens as a pushed route with the native header
 * hidden, so this bar is the only way back. Setup steps always return to the
 * setup checklist. A screen opened from a link has no history; it falls back to
 * Creator (or the app root) instead of stranding the person.
 */
export function ProgramHeader({ title, right, onBack }: { title: string; right?: React.ReactNode; onBack?: () => void }): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const goBack = (): void => {
    if (onBack) { onBack(); return; }
    runProgramNav(router, programBackNav(pathname, router.canGoBack()));
  };
  return <View style={styles.header}>
    <GlassIconButton iconName="chevron-back" onPress={goBack} accessibilityLabel="Back" size={40} />
    <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
    <View style={styles.headerRight}>{right ?? null}</View>
  </View>;
}

type ScreenProps = {
  title: string;
  children: React.ReactNode;
  /** Sticky bottom action area (one primary button, sometimes two). */
  footer?: React.ReactNode;
  right?: React.ReactNode;
  onBack?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Title bar + keyboard-safe scroll + optional sticky footer.
 *
 * W2.2: the top inset is plain padding from `useSafeAreaInsets`, and the scroll
 * view never adds its own automatic inset. The native SafeAreaView plus iOS's
 * automatic scroll insets re-measured when a pushed screen came back and
 * counted the status bar twice, leaving a gap at the top.
 *
 * Keyboard rule: the focused field scrolls to just above the keyboard
 * (KeyboardAwareScrollView), and the footer button hides while typing so it
 * never rides up over the field.
 */
export function ProgramScreen({ title, children, footer, right, onBack, refreshing, onRefresh, contentStyle }: ScreenProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { isVisible: typing } = useKeyboard({ disableLayoutAnimation: true });
  const showFooter = Boolean(footer) && !typing;
  return <View style={[styles.safe, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <Stack.Screen options={{ headerShown: false }} />
    <ProgramHeader title={title} right={right} onBack={onBack} />
    <KeyboardAwareScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, contentStyle, !showFooter && { paddingBottom: 48 + insets.bottom }]}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustKeyboardInsets={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={C.accent} /> : undefined}
    >
      {children}
    </KeyboardAwareScrollView>
    {showFooter ? <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>{footer}</View> : null}
  </View>;
}

// ── Cards, rows, text ──────────────────────────────────────────────────────

export function ProgramCard({ children, style, tone = 'base', onPress, accessibilityLabel }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'base' | 'highlight' | 'warning' | 'danger'; onPress?: () => void; accessibilityLabel?: string }): React.ReactElement {
  const toneStyle = tone === 'highlight' ? styles.cardHighlight : tone === 'warning' ? styles.cardWarning : tone === 'danger' ? styles.cardDanger : null;
  const card = <GlassCard style={[styles.card, toneStyle, style]} accessibilityLabel={onPress ? undefined : accessibilityLabel}>
    <View style={styles.cardInner}>{children}</View>
  </GlassCard>;
  if (!onPress) return card;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>{card}</Pressable>;
}

export function ProgramLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.ReactElement {
  return <View style={style}><Text style={styles.label}>{children}</Text></View>;
}

type RowProps = {
  title: string;
  subtitle?: string | null;
  value?: string | null;
  icon?: IconName;
  /** Checklist state: renders a tick or an empty circle instead of the icon. */
  done?: boolean | null;
  subtitleTone?: 'muted' | 'accent' | 'success' | 'danger';
  onPress?: () => void;
  chevron?: boolean;
  isLast?: boolean;
  right?: React.ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export function ProgramRow({ title, subtitle, value, icon, done, subtitleTone = 'muted', onPress, chevron, isLast, right, disabled, accessibilityLabel }: RowProps): React.ReactElement {
  const subtitleColor = subtitleTone === 'accent' ? C.accent : subtitleTone === 'success' ? C.success : subtitleTone === 'danger' ? C.danger : C.muted;
  const body = <View style={[styles.row, !isLast && styles.rowBorder, disabled && styles.disabled]}>
    {done !== undefined && done !== null ? (
      <View style={[styles.check, done && styles.checkDone]}>{done ? <Icon name="checkmark" size={14} color="#171411" /> : null}</View>
    ) : icon ? <View style={styles.rowIcon}><Icon name={icon} size={18} color={C.accent} /></View> : null}
    <View style={styles.rowText}>
      <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
      {subtitle ? <Text style={[styles.rowSubtitle, { color: subtitleColor }]} numberOfLines={3}>{subtitle}</Text> : null}
    </View>
    {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
    {right ?? null}
    {(chevron ?? Boolean(onPress)) ? <Icon name="chevron-forward" size={16} color={C.faint} /> : null}
  </View>;
  if (!onPress) return body;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} disabled={disabled} onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>{body}</Pressable>;
}

export type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export function ProgramPill({ label, tone = 'neutral', icon }: { label: string; tone?: PillTone; icon?: IconName }): React.ReactElement {
  const palette = {
    neutral: [C.field, C.muted], accent: [C.accentSoft, C.accent], success: [C.successSoft, C.success],
    warning: [C.warningSoft, C.warning], danger: [C.dangerSoft, C.danger],
  }[tone];
  return <View style={[styles.pill, { backgroundColor: palette[0] }]}>
    {icon ? <Icon name={icon} size={12} color={palette[1]} /> : null}
    <Text style={[styles.pillText, { color: palette[1] }]} numberOfLines={1}>{label}</Text>
  </View>;
}

export function ProgramNotice({ text, title, tone = 'info' }: { text: string; title?: string; tone?: 'info' | 'error' | 'success' | 'warning' }): React.ReactElement {
  const color = tone === 'error' ? C.danger : tone === 'success' ? C.success : tone === 'warning' ? C.warning : C.muted;
  const icon: IconName = tone === 'error' ? 'alert-circle-outline' : tone === 'success' ? 'checkmark-circle-outline' : tone === 'warning' ? 'warning' : 'information-circle-outline';
  return <View style={styles.notice} accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
    <Icon name={icon} size={16} color={color} />
    <View style={styles.flex}>
      {title ? <Text style={[styles.noticeTitle, { color }]}>{title}</Text> : null}
      <Text style={[styles.noticeText, tone === 'error' && { color: C.danger }]}>{text}</Text>
    </View>
  </View>;
}

export function ProgramEmpty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }): React.ReactElement {
  return <View style={styles.empty}>
    <Text style={styles.title}>{title}</Text>
    {text ? <Text style={[styles.copy, styles.center]}>{text}</Text> : null}
    {action ?? null}
  </View>;
}

export function ProgramLoading({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return <View style={styles.empty} accessibilityLabel={label}><ActivityIndicator color={C.accent} /></View>;
}

export function ProgramLoadError({ text, onRetry }: { text: string; onRetry: () => void }): React.ReactElement {
  return <ProgramEmpty title="Couldn’t load this" text={text} action={<ProgramButton label="Try again" variant="secondary" onPress={onRetry} />} />;
}

// ── Buttons ────────────────────────────────────────────────────────────────

export function ProgramButton({ label, onPress, disabled = false, busy = false, variant = 'primary', icon, style, accessibilityLabel }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; icon?: IconName; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}): React.ReactElement {
  const inactive = disabled || busy;
  const textColor = variant === 'primary' ? '#171411' : variant === 'danger' ? C.danger : variant === 'ghost' ? C.accent : C.text;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: inactive, busy }}
    disabled={inactive}
    onPress={onPress}
    style={({ pressed }) => [styles.button, variant === 'secondary' && styles.buttonSecondary, variant === 'danger' && styles.buttonDanger, variant === 'ghost' && styles.buttonGhost, inactive && styles.disabled, pressed && styles.pressed, style]}
  >
    {busy ? <ActivityIndicator color={textColor} /> : <View style={styles.buttonInner}>
      {icon ? <Icon name={icon} size={17} color={textColor} /> : null}
      <Text style={[styles.buttonText, { color: textColor }]} numberOfLines={1}>{label}</Text>
    </View>}
  </Pressable>;
}

// ── Fields ─────────────────────────────────────────────────────────────────

type FieldProps = TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string | null;
  prefix?: string;
  suffix?: string;
  /** Character counter. `min` shows "At least N characters" until met. */
  counter?: { max: number; min?: number };
  /** Inside a bottom sheet: use the sheet's keyboard-aware input. */
  inSheet?: boolean;
};

export function ProgramField({ label, error, hint, prefix, suffix, counter, inSheet = false, style, multiline, value, ...rest }: FieldProps): React.ReactElement {
  const Input = (inSheet ? BottomSheetTextInput : TextInput) as unknown as React.ComponentType<TextInputProps>;
  const length = (value ?? '').length;
  const under = counter?.min !== undefined && length < counter.min;
  return <View style={styles.fieldWrap}>
    {label || counter ? <View style={styles.fieldTop}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : <View />}
      {counter ? <Text style={[styles.counter, length > counter.max && { color: C.danger }]}>{length.toLocaleString()} / {counter.max.toLocaleString()}</Text> : null}
    </View> : null}
    <View style={[styles.field, multiline && styles.fieldMultiline, error ? styles.fieldError : null]}>
      {prefix ? <Text style={styles.affix}>{prefix}</Text> : null}
      <Input
        placeholderTextColor={C.faint}
        selectionColor={C.accent}
        {...rest}
        value={value}
        multiline={multiline}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        style={[styles.input, multiline && styles.inputMultiline, style]}
      />
      {suffix ? <Text style={styles.affix}>{suffix}</Text> : null}
    </View>
    {error ? <Text style={styles.fieldErrorText} accessibilityLiveRegion="polite">{error}</Text>
      : under ? <Text style={styles.fieldHint}>At least {counter!.min!.toLocaleString()} characters</Text>
      : hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
  </View>;
}

/** A dropdown-looking field that opens a picker sheet. */
export function SelectField({ label, value, placeholder, onPress, error, icon = 'chevron-down', disabled }: { label?: string; value?: string | null; placeholder: string; onPress: () => void; error?: string | null; icon?: IconName; disabled?: boolean }): React.ReactElement {
  return <View style={styles.fieldWrap}>
    {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={label ? `${label}: ${value ?? placeholder}` : value ?? placeholder} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.field, styles.select, error ? styles.fieldError : null, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={[styles.input, styles.selectText, !value && { color: C.faint }]} numberOfLines={1}>{value || placeholder}</Text>
      <Icon name={icon} size={16} color={C.muted} />
    </Pressable>
    {error ? <Text style={styles.fieldErrorText}>{error}</Text> : null}
  </View>;
}

// ── Sheet ──────────────────────────────────────────────────────────────────

/**
 * W5.1: the sheet never rises past the top safe-area inset (it used to slide its
 * title under the status bar when a search field opened the keyboard), and a
 * `subheader` (e.g. a search field) stays fixed under the title while the list
 * below it scrolls above the keyboard.
 */
export function ProgramSheet({ visible, onClose, title, children, footer, subheader, snapPoints = ['70%'], busy = false }: {
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; subheader?: React.ReactNode; snapPoints?: (string | number)[]; busy?: boolean;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const header = <View>
    <View style={styles.sheetHeader}>
      <Text style={styles.sheetTitle} accessibilityRole="header" numberOfLines={2}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={onClose} disabled={busy}><Icon name="close" size={22} color={C.muted} /></Pressable>
    </View>
    {subheader ? <View style={styles.sheetSubheader}>{subheader}</View> : null}
  </View>;
  return <BaseBottomSheet
    visible={visible}
    onClose={onClose}
    theme="dark"
    snapPoints={snapPoints}
    topInset={sheetTopInset(insets.top)}
    scrollMode="scroll"
    wrapInRNModal
    keyboardBehavior="interactive"
    keyboardBlurBehavior="restore"
    android_keyboardInputMode="adjustResize"
    backdropPressBehavior={busy ? 'none' : 'close'}
    header={header}
    stickyFooter={footer ? <View style={styles.sheetFooter}>{footer}</View> : undefined}
    scrollProps={{ keyboardShouldPersistTaps: 'handled', contentContainerStyle: styles.sheetBody }}
    accessibilityLabel={title}
  >
    {children}
  </BaseBottomSheet>;
}

/** Keep a little air between the status bar and a fully raised sheet. */
export function sheetTopInset(safeTop: number): number {
  return Math.max(0, safeTop) + 8;
}

// ── Styles ─────────────────────────────────────────────────────────────────

export const programStyles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  safe: { flex: 1, backgroundColor: C.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, backgroundColor: C.canvas },
  headerTitle: { flex: 1, color: C.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  headerRight: { minWidth: 40, alignItems: 'flex-end' },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, backgroundColor: C.canvas },
  card: { marginHorizontal: 0, marginBottom: 0, paddingHorizontal: 16, paddingVertical: 16 },
  cardInner: { gap: 10 },
  cardHighlight: { borderColor: C.accentBorder },
  cardWarning: { borderColor: 'rgba(245, 177, 76, 0.40)' },
  cardDanger: { borderColor: 'rgba(255, 136, 120, 0.40)' },
  h1: { color: C.text, fontSize: 24, lineHeight: 30, fontWeight: '900' },
  title: { color: C.text, fontSize: 17, lineHeight: 23, fontWeight: '800' },
  copy: { color: C.muted, fontSize: 14, lineHeight: 20 },
  small: { color: C.faint, fontSize: 12, lineHeight: 17 },
  strong: { color: C.text, fontSize: 15, fontWeight: '700' },
  accentText: { color: C.accent, fontSize: 13, fontWeight: '800' },
  successText: { color: C.success, fontSize: 13, fontWeight: '800' },
  dangerText: { color: C.danger, fontSize: 13, fontWeight: '700' },
  label: { color: C.faint, fontSize: 11, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 52 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  rowIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  rowSubtitle: { fontSize: 13, lineHeight: 18 },
  rowValue: { color: C.text, fontSize: 15, fontWeight: '800', maxWidth: '40%' },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: C.accent, borderColor: C.accent },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '800' },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 14, backgroundColor: C.field },
  noticeTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  noticeText: { color: C.muted, fontSize: 13, lineHeight: 19 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 32, paddingHorizontal: 12 },
  button: { minHeight: 50, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent },
  buttonSecondary: { backgroundColor: 'rgba(255, 255, 255, 0.08)', borderWidth: 1, borderColor: C.border },
  buttonDanger: { backgroundColor: C.dangerSoft },
  buttonGhost: { backgroundColor: 'transparent', minHeight: 40 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  fieldWrap: { gap: 6 },
  fieldTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  fieldLabel: { color: C.muted, fontSize: 13, fontWeight: '700' },
  counter: { color: C.faint, fontSize: 12, fontVariant: ['tabular-nums'] },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.field, paddingHorizontal: 14, gap: 6 },
  fieldMultiline: { alignItems: 'flex-start', paddingTop: 4 },
  fieldError: { borderColor: C.danger },
  input: { flex: 1, color: C.text, fontSize: 16, paddingVertical: 12 },
  inputMultiline: { minHeight: 120, textAlignVertical: 'top' },
  affix: { color: C.muted, fontSize: 16, fontWeight: '700' },
  select: { justifyContent: 'space-between' },
  selectText: { paddingVertical: 14 },
  fieldErrorText: { color: C.danger, fontSize: 13, lineHeight: 18 },
  fieldHint: { color: C.faint, fontSize: 12, lineHeight: 17 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  sheetTitle: { flex: 1, color: C.text, fontSize: 19, fontWeight: '900' },
  sheetSubheader: { paddingHorizontal: 20, paddingBottom: 10 },
  sheetBody: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  sheetFooter: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 10 },
});
const styles = programStyles;
