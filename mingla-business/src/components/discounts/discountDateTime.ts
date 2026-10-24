export const localDateTimeValue = (iso: string | null): string => {
  if (iso === null) return "";
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return "";
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
};

export const isoFromLocalDateTime = (value: string): string | null => {
  if (value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};
