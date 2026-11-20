import React from 'react';
import { DobField } from '@mingla/calendar/CalendarField';

import { deviceTimeZone, EXPLORER_CALENDAR_CONFIG, useExplorerCalendarLabels } from '../calendar/explorerCalendarConfig';

/**
 * #4402 (E25/E26), reworked for #4523 — date of birth for Creator setup.
 *
 * Picked on the shared Mingla calendar's year grid (year, then month, then day): nothing is typed, and a birth
 * date under 18 cannot be chosen (minAge). The saved value is `YYYY-MM-DD`.
 */
export function CreatorDobField({ value, onChange, error, hint }: {
  value: string | null; onChange: (day: string | null) => void; error?: string | null; hint?: string;
}): React.ReactElement {
  const labels = useExplorerCalendarLabels();
  return <DobField label="Date of birth" value={value ?? ''} onChange={(day) => onChange(day === '' ? null : day)} minAge={18}
    timeZone={deviceTimeZone()} error={error} hint={hint ?? 'You must be 18 or older. Hosts never see your birthday.'}
    labels={labels} config={EXPLORER_CALENDAR_CONFIG} />;
}
