/**
 * #4255 W5 — the Mingla team screens' words (every Host app language). The
 * English words load with these screens; see i18n/teamChatEnglish.ts.
 */
import { useBusinessMediaTranslation, type BusinessMediaTranslator } from "../../i18n";
import { addTeamEnglish } from "../../i18n/teamChatEnglish";

addTeamEnglish();

export type TeamT = BusinessMediaTranslator;

export function useTeamText(): { t: TeamT; language: string } {
  return useBusinessMediaTranslation();
}

/** "09:41" today, "Mon" this week, "3 Nov" before that. */
export function teamTime(iso: string | null | undefined, language: string, now: Date = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const sameDay = at.toDateString() === now.toDateString();
  try {
    if (sameDay) return new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(at);
    if (now.getTime() - at.getTime() < 6 * 24 * 3600 * 1000) return new Intl.DateTimeFormat(language, { weekday: "short" }).format(at);
    return new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
