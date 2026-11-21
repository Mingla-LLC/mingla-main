import React from "react";
import type { FormWebDateInputProps } from "@mingla/form-rendering";

export const RsvpFormWebDateInput: React.FC<FormWebDateInputProps> = ({
  value,
  onChangeValue,
  ariaLabel,
  disabled = false,
  hasError = false,
  testID,
}) => (
  <input
    type="date"
    value={value}
    onChange={(event) => onChangeValue(event.currentTarget.value)}
    aria-label={ariaLabel}
    disabled={disabled}
    data-testid={testID}
    style={{
      boxSizing: "border-box",
      width: "100%",
      minHeight: 48,
      padding: "0 14px",
      borderRadius: 12,
      border: `1px solid ${hasError ? "#DC2626" : "rgba(255,255,255,0.18)"}`,
      background: "rgba(0,0,0,0.22)",
      color: "inherit",
      colorScheme: "dark",
      fontSize: 16,
    }}
  />
);
