export const normalizePhoneE164 = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (/^\+[1-9][0-9]{1,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
};

export const isRequiredPhoneValid = (raw: string): boolean =>
  normalizePhoneE164(raw) !== null;
