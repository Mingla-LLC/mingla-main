/**
 * #4523 — the Explorer app's injection for @mingla/calendar: tokens, the
 * program sheet and Explorer icons, plus labels from i18n (English defaults
 * come from the package, so a missing key still reads correctly).
 */
import type {
  CalendarConfig,
  CalendarIconName,
  CalendarLabels,
  CalendarSheetProps,
  CalendarTokens,
} from '@mingla/calendar/types';
import { DEFAULT_CALENDAR_LABELS } from '@mingla/calendar/core/labels';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../ui/Icon';
import { PROGRAM_COLORS as C, ProgramSheet } from '../programs/ProgramUi';

const TOKENS: CalendarTokens = {
  surface: 'transparent',
  text: C.text,
  textMuted: C.muted,
  textFaint: C.faint,
  border: C.border,
  fieldFill: C.field,
  selectedFill: C.accent,
  onSelected: '#171411',
  rangeFill: C.accentSoft,
  todayDot: C.text,
  error: C.danger,
  radius: 12,
  dayRadius: 12,
};

const ICONS: Record<CalendarIconName, IconName> = {
  calendar: 'calendar-outline',
  'chevron-left': 'chevron-back',
  'chevron-right': 'chevron-forward',
  close: 'close',
  clock: 'time-outline',
};

function ExplorerCalendarSheet({ visible, onClose, title, children }: CalendarSheetProps): React.ReactElement {
  return (
    <ProgramSheet visible={visible} onClose={onClose} title={title} snapPoints={['80%']}>
      {children}
    </ProgramSheet>
  );
}

export const EXPLORER_CALENDAR_CONFIG: CalendarConfig = {
  tokens: TOKENS,
  primitives: {
    Sheet: ExplorerCalendarSheet,
    renderIcon: (name, color, size) => <Icon name={ICONS[name]} color={color} size={size} />,
  },
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
 * [TRANSITIONAL] The device zone: the Explorer program pickers are not given the
 * offering's zone yet; exit: callers pass `timeZone` (#4523 slice 8).
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
