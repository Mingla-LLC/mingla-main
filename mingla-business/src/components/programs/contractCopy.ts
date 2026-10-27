// #3872 — host contract words and pure helpers (testable without RN).
import {
  hostContractPill,
  hostContractStatus,
  activityWords,
  programMoney,
  shortDate,
  type HostStatusTone,
} from "../../utils/creatorProgramFormat";
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

/**
 * The format's section names, the same words the creator app shows
 * (app-mobile/app/creator/gig/[gigId].tsx SECTION_WORDS). Unknown keys fall
 * back to the key title-cased.
 */
export const SECTION_WORDS: Readonly<Record<string, string>> = {
  hook: "Hook",
  arrival: "Arrival",
  reaction: "Reaction",
  cta: "End card",
  atmosphere: "Atmosphere",
  experience: "Experience",
  price_hook: "Price hook",
  included: "What\u2019s included",
  value: "The value",
  people: "The people",
  craft: "The craft",
  reasons: "Three reasons",
  mood: "The mood",
  plan: "The plan",
};

export function sectionWord(key: string): string {
  return (
    SECTION_WORDS[key] ??
    key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")
  );
}

/** "0–3s · Hook" style label for a script section. */
export function sectionLabel(section: GigScriptSection, index: number): string {
  const key =
    typeof section.key === "string" && section.key.trim()
      ? section.key.trim()
      : null;
  const name =
    typeof section.label === "string" && section.label.trim()
      ? section.label.trim()
      : typeof section.title === "string" && section.title.trim()
        ? section.title.trim()
        : key
          ? sectionWord(key)
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

// ---------------------------------------------------------------------------
// Round 2 — money_state, the one status card, and Activity
// ---------------------------------------------------------------------------

export type ContractMoneyState =
  | "on_the_way"
  | "ready"
  | "paid"
  | "refunded"
  | "partially_refunded";

const MONEY_STATES: ReadonlySet<string> = new Set([
  "on_the_way",
  "ready",
  "paid",
  "refunded",
  "partially_refunded",
]);

/** gig_contract_workspace.money_state; null when no money was captured yet. */
export function contractMoneyState(raw: unknown): ContractMoneyState | null {
  return typeof raw === "string" && MONEY_STATES.has(raw)
    ? (raw as ContractMoneyState)
    : null;
}

/**
 * The Fee row: the fee in the contract's currency plus a money word from
 * money_state (On the way · Ready · Paid). Never "held" after release, never
 * "paid" before the server says paid; no word when nothing was captured.
 */
export function contractFeeWords(
  feeMinor: number,
  currency: string,
  moneyState: ContractMoneyState | null,
): string {
  const fee = programMoney(feeMinor, currency);
  switch (moneyState) {
    case "on_the_way":
      return `${fee} · On the way`;
    case "ready":
      return `${fee} · Ready`;
    case "paid":
      return `${fee} paid`;
    case "refunded":
      return `${fee} refunded`;
    case "partially_refunded":
      return `${fee} · part refunded`;
    default:
      return fee;
  }
}

const PAYOUT_STATES: ReadonlySet<string> = new Set([
  "released",
  "day30",
  "completed",
  "resolved_release",
]);

/** The one status card at the top of the host contract page. */
export function contractStatusCard(input: {
  state: string;
  moneyState: ContractMoneyState | null;
  creatorName: string;
  hostRated: boolean;
  stepCaption: string;
}): {
  title: string;
  pill: string;
  tone: HostStatusTone;
  line: string;
  canRate: boolean;
} {
  const base = hostContractStatus(input.state);
  const pill = hostContractPill({ state: input.state });
  let title = base.label;
  if (PAYOUT_STATES.has(input.state)) {
    title =
      input.moneyState === "paid"
        ? "Paid to the creator"
        : input.moneyState === "ready"
          ? "Released to the creator"
          : input.state === "completed"
            ? "Done"
            : "Payment released";
  }
  const canRate = input.state === "completed" && !input.hostRated;
  const line =
    input.state === "released" || input.state === "day30"
      ? `Posts stay up for 30 days. You can rate ${input.creatorName} when the gig is done.`
      : input.state === "completed"
        ? input.hostRated
          ? "You've rated this gig."
          : `Rate ${input.creatorName} when you're ready.`
        : input.stepCaption;
  return {
    title,
    pill: input.state === "completed" ? "Done" : pill.label,
    tone: pill.tone,
    line,
    canRate,
  };
}

/**
 * Activity rows: events in words, newest first. A step recorded twice (the
 * button and the event) shows once; unknown kinds are left out.
 */
export function activityEvents<T extends { kind: string }>(
  events: readonly T[],
): Array<T & { words: string }> {
  const out: Array<T & { words: string }> = [];
  for (const event of [...events].reverse()) {
    const words = activityWords(event.kind);
    if (words === null) continue;
    if (out.length > 0 && out[out.length - 1].words === words) continue;
    out.push({ ...event, words });
  }
  return out;
}

/** The gig's shoot window as the contract workspace sends it ({start,end}), or
 *  the older flat start/end fields. Null when the gig has no window. */
export function workspaceShootWindow(
  gig: unknown,
): { start: string; end: string } | null {
  if (!gig || typeof gig !== "object") return null;
  const g = gig as Record<string, unknown>;
  const nested = g.shoot_window as Record<string, unknown> | null | undefined;
  const start = nested?.start ?? g.shoot_window_start;
  const end = nested?.end ?? g.shoot_window_end ?? start;
  if (typeof start !== "string" || start === "") return null;
  return { start, end: typeof end === "string" && end !== "" ? end : start };
}

/** "Shoot day: Nov 9" or "Shoot dates: Nov 9 to Nov 12"; a plain line when
 *  the host left the shoot open. */
export function shootWindowWords(
  window: { start: string; end: string } | null,
): string {
  if (!window) return "The creator suggests a shoot time for you to approve.";
  if (window.start === window.end) return `Shoot day: ${shortDate(window.start)}.`;
  return `Shoot dates: ${shortDate(window.start)} to ${shortDate(window.end)}.`;
}

/** What a success notice is tied to: the contract's state, its terms version
 *  and its change requests. When any of them changes the notice is stale. */
export function contractNoticeKey(
  workspace: Pick<GigWorkspace, "contract" | "proposals"> | null | undefined,
): string {
  if (!workspace) return "";
  const requests = (workspace.proposals ?? [])
    .map((p) => {
      const row = p as unknown as Record<string, unknown>;
      return `${String(row.id ?? "")}:${String(row.status ?? "")}`;
    })
    .join(",");
  return `${workspace.contract.state ?? ""}|v${workspace.contract.current_terms_version ?? ""}|${requests}`;
}
