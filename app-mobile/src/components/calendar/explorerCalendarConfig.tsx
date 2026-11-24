/**
 * #4523 — the Explorer app's SHEET-based injection for @mingla/calendar (the
 * program pickers open a ProgramSheet). Screens that draw the calendar inline
 * use `./explorerInlineCalendar` instead, which carries no sheet or router.
 */
import type { CalendarConfig, CalendarSheetProps } from '@mingla/calendar/types';
import React from 'react';
import { ProgramSheet } from '../programs/ProgramUi';
import { DARK_TOKENS, renderCalendarIcon } from './explorerInlineCalendar';

export {
  deviceTimeZone,
  LIGHT_INLINE_CALENDAR_CONFIG,
  useExplorerCalendarLabels,
} from './explorerInlineCalendar';

function ExplorerCalendarSheet({ visible, onClose, title, children }: CalendarSheetProps): React.ReactElement {
  return (
    <ProgramSheet visible={visible} onClose={onClose} title={title} snapPoints={['80%']}>
      {children}
    </ProgramSheet>
  );
}

export const EXPLORER_CALENDAR_CONFIG: CalendarConfig = {
  tokens: DARK_TOKENS,
  primitives: { Sheet: ExplorerCalendarSheet, renderIcon: renderCalendarIcon },
};
