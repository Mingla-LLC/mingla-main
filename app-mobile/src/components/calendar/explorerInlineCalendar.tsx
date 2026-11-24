/**
 * #4523 — Explorer calendar pieces that need NO sheet and import no router or
 * program chrome: tokens (dark and light), icons, labels from i18n, the device
 * zone, and the two inline configs. Screens that draw the calendar inline
 * (stay dates, plan time, schedule, onboarding birthday, ...) import from here,
 * so their own jest mocks and bundles do not pick up `ProgramUi`.
 */
import type {
  CalendarConfig,
  CalendarIconName,
  CalendarLabels,
  CalendarTokens,
} from '@mingla/calendar/types';
import { DEFAULT_CALENDAR_LABELS } from '@mingla/calendar/core/labels';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../ui/Icon';
import { colors } from '../../constants/designSystem';

/** Dark surfaces (program screens, chat, discover). Same values as PROGRAM_COLORS. */
export const DARK_TOKENS: CalendarTokens = {
  surface: 'transparent',
  text: '#ffffff',
  textMuted: 'rgba(255, 255, 255, 0.64)',
  textFaint: 'rgba(255, 255, 255, 0.42)',
  border: 'rgba(255, 255, 255, 0.10)',
  fieldFill: 'rgba(255, 255, 255, 0.05)',
  selectedFill: '#eb7825',
  onSelected: '#171411',
  rangeFill: 'rgba(235, 120, 37, 0.16)',
  todayDot: '#ffffff',
  error: '#ff8878',
  radius: 12,
  dayRadius: 12,
};

/** Light tokens for the calendar drawn inline on a white card. */
export const LIGHT_TOKENS: CalendarTokens = {
  surface: 'transparent',
  text: colors.text.primary,
  textMuted: colors.text.secondary,
  textFaint: colors.text.tertiary,
  border: 'rgba(17, 24, 39, 0.14)',
  fieldFill: 'rgba(17, 24, 39, 0.05)',
  selectedFill: colors.primary[600],
  onSelected: colors.text.inverse,
  rangeFill: 'rgba(234, 88, 12, 0.16)',
  todayDot: colors.primary[600],
  error: colors.error[600],
  radius: 12,
  dayRadius: 12,
};

export const CALENDAR_ICONS: Record<CalendarIconName, IconName> = {
  calendar: 'calendar-outline',
  'chevron-left': 'chevron-back',
  'chevron-right': 'chevron-forward',
  close: 'close',
  clock: 'time-outline',
};

export const renderCalendarIcon = (name: CalendarIconName, color: string, size: number): React.ReactElement => (
  <Icon name={CALENDAR_ICONS[name]} color={color} size={size} />
);

export const DARK_INLINE_CALENDAR_CONFIG: CalendarConfig = {
  tokens: DARK_TOKENS,
  primitives: { Sheet: () => null, renderIcon: renderCalendarIcon },
};

export const LIGHT_INLINE_CALENDAR_CONFIG: CalendarConfig = {
  tokens: LIGHT_TOKENS,
  primitives: { Sheet: () => null, renderIcon: renderCalendarIcon },
};

/** Every label from the `common` namespace; the package default fills a missing key. */
export function useExplorerCalendarLabels(): CalendarLabels {
  const { t } = useTranslation('common');
  return useMemo(() => {
    const entries = (Object.keys(DEFAULT_CALENDAR_LABELS) as Array<keyof CalendarLabels>).map(
      (key) => [key, t(`mingla_calendar_${key}`, { defaultValue: DEFAULT_CALENDAR_LABELS[key] })] as const,
    );
    return Object.fromEntries(entries) as unknown as CalendarLabels;
  }, [t]);
}

/**
 * [TRANSITIONAL] The device zone: the Explorer pickers are not given the
 * offering's zone yet; exit: callers pass `timeZone` (a later #4523 slice).
 */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : 'UTC';
  } catch {
    // Intl zone data unavailable: UTC is stated plainly in the calendar footer.
    return 'UTC';
  }
}
