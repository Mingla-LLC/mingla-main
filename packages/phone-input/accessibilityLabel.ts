/**
 * Issue #4508 P4 — the phone field's spoken name: "<label> phone number",
 * unless the label already says it ("By phone number" read as "By phone
 * number phone number" before). A leaf with no imports, so any surface (and
 * a Deno test) can import it by path.
 */
export const phoneFieldAccessibilityLabel = (label: string): string => {
  const trimmed = label.trim();
  return /phone number$/i.test(trimmed) ? trimmed : `${trimmed} phone number`;
};
