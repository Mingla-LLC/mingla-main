/** #4490 M — the unambiguous six-character member code shown as `ABC DEF`. */
const MEMBER_CODE_ALPHABET = /^[2-9A-HJ-NP-Z]$/;

export function normalizeVenueMemberCode(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((character) => MEMBER_CODE_ALPHABET.test(character))
    .join("")
    .slice(0, 6);
}

export function formatVenueMemberCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !/^[2-9A-HJ-NP-Z]{6}$/.test(raw)) return null;
  return `${raw.slice(0, 3)} ${raw.slice(3)}`;
}
