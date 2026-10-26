// #3872 — host contract words and pure helpers (testable without RN).
import type {
  GigScript,
  GigScriptSection,
  GigWorkspace,
} from "../../services/creatorGigsService";

export const FIX_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ["audio", "Sound"],
  ["video_quality", "Picture quality"],
  ["missing_agreed_element", "Missing something agreed in the script"],
  ["wrong_length_or_format", "Wrong length or format"],
];

export const DISPUTE_REASONS: ReadonlyArray<readonly [string, string]> = [
  ["technical_fixes_exhausted", "Fixes didn't solve a technical problem"],
  ["post_missed", "The post wasn't made on time"],
  ["posts_failed", "The posts don't match what was agreed"],
  ["other", "Something else"],
];

export const RATING_TAGS = [
  "On time",
  "Great video",
  "Easy to work with",
  "Drove sales",
  "Followed the brief",
] as const;

export const SHOOT_TIMES: ReadonlyArray<readonly [number, string]> = [
  [10, "10 AM"],
  [12, "12 PM"],
  [14, "2 PM"],
  [16, "4 PM"],
  [18, "6 PM"],
  [20, "8 PM"],
];

export function fixCategoryWords(key: string): string {
  return (
    FIX_CATEGORIES.find(([value]) => value === key)?.[1] ?? "Something else"
  );
}

/** The latest script version (what the host reviews). */
export function latestScript(
  workspace: Pick<GigWorkspace, "scripts">,
): GigScript | null {
  const scripts = Array.isArray(workspace.scripts) ? workspace.scripts : [];
  return scripts.length === 0
    ? null
    : [...scripts].sort((a, b) => b.version - a.version)[0];
}

/** "0–3s · Hook" style label for a script section. */
export function sectionLabel(section: GigScriptSection, index: number): string {
  const name =
    typeof section.label === "string" && section.label.trim()
      ? section.label.trim()
      : typeof section.title === "string" && section.title.trim()
        ? section.title.trim()
        : `Part ${index + 1}`;
  if (
    typeof section.start_s === "number" &&
    typeof section.end_s === "number"
  ) {
    return `${section.start_s}–${section.end_s}s · ${name}`;
  }
  return name;
}

/** The words of a section, without repeating identical fields. */
export function sectionLines(
  section: GigScriptSection,
): Array<{ label: string; text: string }> {
  const lines: Array<{ label: string; text: string }> = [];
  const seen = new Set<string>();
  const push = (label: string, value: unknown) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push({ label, text });
  };
  push("Says", section.voiceover);
  push("On screen", section.on_screen);
  push("Shot", section.shot_notes);
  push("", section.text);
  return lines;
}

export function scriptChecks(script: GigScript | null): {
  disclosure: boolean;
  seconds: number | null;
} {
  if (!script) return { disclosure: false, seconds: null };
  const text = JSON.stringify(script.body ?? {}).toLowerCase();
  return {
    disclosure: text.includes("#ad") || text.includes("paid partnership"),
    seconds:
      typeof script.body?.estimated_seconds === "number"
        ? script.body.estimated_seconds
        : null,
  };
}

/** Fix rounds left (2 per contract). */
export function fixesLeft(fixRoundsUsed: number | null | undefined): number {
  return Math.max(
    0,
    2 - (typeof fixRoundsUsed === "number" ? fixRoundsUsed : 0),
  );
}

/** Local date + hour → ISO instant for gig_shoot_plan_save. */
export function shootInstant(day: string, hour: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, 0, 0).toISOString();
}

const POST_CHECK_WORDS: Record<string, string> = {
  pending: "Checking",
  passed: "Verified",
  failed: "Needs a fix",
  unverifiable: "Couldn't check automatically",
};

export function postCheckWords(status: string): string {
  return POST_CHECK_WORDS[status] ?? "Checking";
}
