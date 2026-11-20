/**
 * #4514 §6 — the door line on the ticket scan result. The server already picks
 * the questions the host marked "Shown to door staff" and cuts them; this
 * module reads the scan answer's `doorAnswers` defensively and turns it into
 * the words on the card. Imported ONLY by the scanner screen (one importer, so
 * it never lands in the shared web boot chunk).
 *
 * MINGLA-INVARIANT: I-4514-DOOR-LINE-CAPS | issue #4514 | the scan card shows at most 3 door answers, each cut to 60 characters, and an unanswered form is a line, never a refusal (doorAnswersLine.issue4514.test.ts).
 */

/** Decision 16: at most 3 door questions, each answer cut at 60 characters. */
export const DOOR_LINE_MAX_ITEMS = 3;
export const DOOR_LINE_MAX_VALUE = 60;
const DOOR_LINE_MAX_LABEL = 40;

export const DOOR_LINE_COPY = {
  notAnswered: "Questions not answered",
  unavailable: "Answers unavailable",
  seeAll: "See all answers",
} as const;

export type DoorLineTone = "answered" | "not_answered" | "unavailable";

export interface DoorLineView {
  tone: DoorLineTone;
  /** "From Quinn B.'s order" on another ticket of the buyer's order (decision 15). */
  header: string | null;
  text: string;
  /** "See all answers" may open the full answers (the host switch, or manager rank). */
  canOpenAll: boolean;
}

const cut = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/** The card's door line, or null when the scan answer carries none (no form: the card is as before). */
export const doorLineFromScan = (value: unknown): DoorLineView | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.state === "unavailable") {
    return { tone: "unavailable", header: null, text: DOOR_LINE_COPY.unavailable, canOpenAll: false };
  }
  if (raw.state === "not_answered") {
    return { tone: "not_answered", header: null, text: DOOR_LINE_COPY.notAnswered, canOpenAll: false };
  }
  if (raw.state !== "answered" || !Array.isArray(raw.items)) return null;
  const parts = raw.items
    .flatMap((item) => {
      const x = item as Record<string, unknown> | null;
      if (x === null || typeof x !== "object" || typeof x.label !== "string" || typeof x.value !== "string") return [];
      const label = x.label.trim();
      const answer = x.value.trim();
      if (label.length === 0 || answer.length === 0) return [];
      return [`${cut(label, DOOR_LINE_MAX_LABEL)}: ${cut(answer, DOOR_LINE_MAX_VALUE)}`];
    })
    .slice(0, DOOR_LINE_MAX_ITEMS);
  if (parts.length === 0) return null;
  const from = typeof raw.fromOrderOf === "string" && raw.fromOrderOf.trim().length > 0 ? raw.fromOrderOf.trim() : null;
  return {
    tone: "answered",
    header: from === null ? null : `From ${from}'s order`,
    text: parts.join(" · "),
    canOpenAll: raw.fullAnswers === true,
  };
};
