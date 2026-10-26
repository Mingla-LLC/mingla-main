// Issue #4114 (simulator QA, evidence 27/28): after Send, iOS can commit a
// pending autocorrect or predictive suggestion into the multiline TextInput
// AFTER the controlled value was reset, so the sent text came back and a second
// tap sent it again. The composer snapshots what it sent; a text change that
// arrives inside SEND_ECHO_WINDOW_MS and is that same text (or the same text
// with only its last word swapped by autocorrect) is an echo and is dropped,
// and a second Send of the same text inside the window is refused.

export const SEND_ECHO_WINDOW_MS = 250;

export interface ComposerSendSnapshot {
  /** The raw composer text at the moment Send was tapped. */
  text: string;
  /** Date.now() at the moment Send was tapped. */
  at: number;
}

const words = (value: string): string[] => value.trim().split(/\s+/).filter(Boolean);

/** Same text, or the same words with only the last one replaced (autocorrect). */
function isSameOrAutocorrected(sent: string, incoming: string): boolean {
  const a = words(sent);
  const b = words(incoming);
  if (a.length === 0 || b.length === 0) return false;
  if (a.join(" ") === b.join(" ")) return true;
  // A predictive suggestion can replace the last word with several words
  // ("number" -> "number one"), so compare everything before the last word.
  const head = a.slice(0, -1).join(" ");
  if (head.length === 0) return a.length === 1 && b.length <= 2;
  return b.join(" ").startsWith(`${head} `) && b.length - a.length <= 2 && b.length >= a.length;
}

/** True when `incoming` is iOS putting the just-sent text back. */
export function isComposerSendEcho(
  snapshot: ComposerSendSnapshot | null,
  incoming: string,
  now: number,
): boolean {
  if (!snapshot) return false;
  if (now - snapshot.at > SEND_ECHO_WINDOW_MS) return false;
  if (incoming.trim().length === 0) return false;
  return isSameOrAutocorrected(snapshot.text, incoming);
}

/** True when a Send would re-send the text that was just sent (double tap). */
export function isDuplicateSend(
  snapshot: ComposerSendSnapshot | null,
  text: string,
  now: number,
): boolean {
  return isComposerSendEcho(snapshot, text, now);
}
