/**
 * useRevealedFieldErrors — #4420, Constitution 12 (validate at the right time).
 *
 * The buyer forms used to mark a field "touched" on its first keystroke (the
 * phone field) or keep it touched forever after one blur (name, email). Either
 * way a guest typing their number saw "Enter a valid mobile number" from the
 * first digit, and the line appeared, changed and vanished as they typed, so
 * the form jumped under their thumb.
 *
 * The rule this hook owns, for every field:
 *  - While someone types into a field that is not showing an error, stay quiet.
 *  - Reveal the error when the field loses focus while invalid, or when the
 *    guest taps Continue (`revealAll`).
 *  - Once an error shows, clear it live the moment the value becomes valid.
 *    After that the field is quiet again until the next blur or Continue.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** `true` means the field's current value is invalid. */
export type FieldInvalidity<K extends string> = Readonly<Record<K, boolean>>;

export interface RevealedFieldErrors<K extends string> {
  /** Whether the field's error should be on screen right now. */
  shows: (key: K) => boolean;
  /** Call from the field's onBlur. */
  blur: (key: K) => void;
  /** Call when the guest taps Continue / Pay. */
  revealAll: () => void;
}

export function useRevealedFieldErrors<K extends string>(
  invalid: FieldInvalidity<K>,
): RevealedFieldErrors<K> {
  const [revealed, setRevealed] = useState<Partial<Record<K, boolean>>>({});
  const invalidRef = useRef(invalid);
  invalidRef.current = invalid;

  const keys = Object.keys(invalid) as K[];
  // A revealed field that turned valid goes quiet again, so the next mistake
  // waits for the next blur or Continue instead of flashing mid-typing.
  const settledKey = keys
    .filter((key) => revealed[key] === true && !invalid[key])
    .join("|");
  useEffect(() => {
    if (settledKey.length === 0) return;
    const settled = settledKey.split("|") as K[];
    setRevealed((current) => {
      const next = { ...current };
      for (const key of settled) next[key] = false;
      return next;
    });
  }, [settledKey]);

  const blur = useCallback((key: K): void => {
    const isInvalid = invalidRef.current[key] === true;
    setRevealed((current) =>
      current[key] === isInvalid ? current : { ...current, [key]: isInvalid },
    );
  }, []);

  const revealAll = useCallback((): void => {
    const snapshot = invalidRef.current;
    setRevealed(() => {
      const next: Partial<Record<K, boolean>> = {};
      for (const key of Object.keys(snapshot) as K[]) next[key] = snapshot[key];
      return next;
    });
  }, []);

  const shows = useCallback(
    (key: K): boolean => revealed[key] === true && invalid[key] === true,
    [invalid, revealed],
  );

  return { shows, blur, revealAll };
}
