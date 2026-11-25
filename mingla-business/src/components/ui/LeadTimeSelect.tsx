/**
 * #4490 — "how long before": hour, day, week and month presets (book at least,
 * final numbers by, balance due, free to cancel until). Value in minutes.
 */
import React, { useMemo } from "react";

import { SelectSheet } from "./SelectSheet";
import { leadTimeOptions } from "./fieldModels";

export interface LeadTimeSelectProps {
  label: string;
  value: number | null;
  onChange: (minutes: number) => void;
  includeNone?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function LeadTimeSelect({
  label,
  value,
  onChange,
  includeNone,
  disabled,
  testID,
}: LeadTimeSelectProps): React.ReactElement {
  const options = useMemo(() => leadTimeOptions({ includeNone }), [includeNone]);
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
