/**
 * #4490 — pick a length of time in 15-minute steps up to 24 hours (no
 * 60-minute cap). The hire version adds "Full day".
 */
import React, { useMemo } from "react";

import { SelectSheet } from "./SelectSheet";
import { durationOptions } from "./fieldModels";

export interface DurationSelectProps {
  label: string;
  /** Minutes, or null when not chosen. */
  value: number | null;
  onChange: (minutes: number) => void;
  min?: number;
  max?: number;
  includeNone?: boolean;
  includeFullDay?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function DurationSelect({
  label,
  value,
  onChange,
  min,
  max,
  includeNone,
  includeFullDay,
  disabled,
  testID,
}: DurationSelectProps): React.ReactElement {
  const options = useMemo(
    () => durationOptions({ min, max, includeNone, includeFullDay }),
    [includeFullDay, includeNone, max, min],
  );
  return (
    <SelectSheet
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      testID={testID}
    />
  );
}
