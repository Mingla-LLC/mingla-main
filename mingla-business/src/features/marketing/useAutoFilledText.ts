/**
 * #4273 wave B — text that follows the email until the host edits it. Once
 * edited (even cleared), a later email change never overwrites their words.
 */
import { useCallback, useState } from "react";

export const AUTO_FILLED_LABEL = "Filled in from your email · edit anytime";
export const EDITED_LABEL = "Edited by you";

export interface AutoFilledText {
  text: string;
  /** Null when there is nothing filled in yet to label. */
  label: string | null;
  edit: (next: string) => void;
}

export function useAutoFilledText(autoText: string): AutoFilledText {
  const [draft, setDraft] = useState<string | null>(null);
  const edit = useCallback((next: string) => setDraft(next), []);
  const text = draft ?? autoText;
  return {
    text,
    label: draft !== null ? EDITED_LABEL : text.length > 0 ? AUTO_FILLED_LABEL : null,
    edit,
  };
}
