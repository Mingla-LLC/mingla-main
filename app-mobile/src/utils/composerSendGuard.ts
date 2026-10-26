// Issue #4114 (simulator QA run 1, evidence 27/28): after Send, iOS can commit
// a pending autocorrect or predictive suggestion into the multiline TextInput
// AFTER the controlled value was reset, so the sent text came back and a
// second tap sent it again.
//
// Run 2 (evidence 01g): typing "Seperate words here" and tapping Send inside
// ~100 ms sent "Separate wor". Send read the render-time copy of the text, and
// the old guard then treated the late "Separate words here" as an echo of
// "Separate wor" and dropped it. Two rules now:
//   1. Send waits for pending native text to settle, then reads the LATEST
//      text from the controller's synchronous ref (never a render copy).
//   2. A change is an echo only when it restores the exact sent text, or the
//      sent text with only its final word swapped (autocorrect), arrives
//      inside SEND_ECHO_WINDOW_MS, and no key was pressed since Send. A change
//      that extends the sent text is new typing and is always kept.

export const SEND_ECHO_WINDOW_MS = 250;

export interface ComposerSendSnapshot {
  /** The raw composer text that was sent. */
  text: string;
  /** Date.now() when it was sent. */
  at: number;
  /** True once any key was pressed after the send. */
  typedSinceSend: boolean;
}

const words = (value: string): string[] => value.trim().split(/\s+/).filter(Boolean);

/** Same words, or the same words with only the last one replaced (not extended). */
function isSentTextOrLastWordSwap(sent: string, incoming: string): boolean {
  const a = words(sent);
  const b = words(incoming);
  if (a.length === 0 || a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  const sentLast = a[a.length - 1];
  const incomingLast = b[b.length - 1];
  if (sentLast === incomingLast) return true;
  // "wor" -> "words" is the rest of the word still arriving, not autocorrect.
  return !incomingLast.startsWith(sentLast);
}

/** True when `incoming` is iOS putting the just-sent text back. */
export function isComposerSendEcho(
  snapshot: ComposerSendSnapshot | null,
  incoming: string,
  now: number,
): boolean {
  if (!snapshot || snapshot.typedSinceSend) return false;
  if (now - snapshot.at > SEND_ECHO_WINDOW_MS) return false;
  if (incoming.trim().length === 0) return false;
  return isSentTextOrLastWordSwap(snapshot.text, incoming);
}

/** True when a Send would re-send exactly the text that was just sent (double tap). */
export function isDuplicateSend(
  snapshot: ComposerSendSnapshot | null,
  text: string,
  now: number,
): boolean {
  if (!snapshot || snapshot.typedSinceSend) return false;
  if (now - snapshot.at > SEND_ECHO_WINDOW_MS) return false;
  return words(snapshot.text).join(" ") === words(text).join(" ") && words(text).length > 0;
}

export interface ComposerSendRequest {
  /** Reads the latest composer text synchronously (the controller's ref). */
  read: () => string;
  /** Delivers the settled text. Runs at most once per request. */
  send: (text: string) => void;
  /** Media sends may go with an empty caption and skip the double-tap check. */
  allowEmpty?: boolean;
}

export interface ComposerSendCoordinator {
  /** False when the change is an echo of the last send and must be dropped. */
  acceptChange: (text: string) => boolean;
  /** Any key press after a send ends echo suppression for that send. */
  noteKeystroke: () => void;
  /** Waits for native text to settle, then sends the latest text. */
  requestSend: (request: ComposerSendRequest) => void;
  snapshot: () => ComposerSendSnapshot | null;
}

export function createComposerSendCoordinator(options: {
  /** Runs `run` once pending native text events have been delivered. */
  settle: (run: () => void) => void;
  now: () => number;
}): ComposerSendCoordinator {
  let snapshot: ComposerSendSnapshot | null = null;
  let settling = false;
  return {
    acceptChange: (text) => !isComposerSendEcho(snapshot, text, options.now()),
    noteKeystroke: () => {
      if (snapshot) snapshot.typedSinceSend = true;
    },
    requestSend: (request) => {
      if (settling) return;
      settling = true;
      options.settle(() => {
        settling = false;
        const text = request.read();
        const now = options.now();
        if (!request.allowEmpty) {
          if (!text.trim()) return;
          if (isDuplicateSend(snapshot, text, now)) return;
        }
        snapshot = { text, at: now, typedSinceSend: false };
        request.send(text);
      });
    },
    snapshot: () => snapshot,
  };
}
