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
  GigApplicant,
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
  | "partially_refunded"
  // #4430 item 5: a part refund with a creator share (host cancel after
  // accept, or a dispute split).
  | "cancelled_partial"
  | "dispute_partial";

const MONEY_STATES: ReadonlySet<string> = new Set([
  "on_the_way",
  "ready",
  "paid",
  "refunded",
  "partially_refunded",
  "cancelled_partial",
  "dispute_partial",
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
  refundedMinor?: number | null,
  totalPaidMinor?: number | null,
  creatorKeptMinor?: number | null,
): string {
  const fee = programMoney(feeMinor, currency);
  const refunded =
    typeof refundedMinor === "number" && refundedMinor > 0
      ? programMoney(refundedMinor, currency)
      : null;
  switch (moneyState) {
    case "on_the_way":
      return `${fee} · On the way`;
    case "ready":
      return `${fee} · Ready`;
    case "paid":
      return `${fee} paid`;
    // #4402 — the row shows what actually went back, not the contract fee.
    case "refunded":
      return `${refunded ?? fee} refunded`;
    case "partially_refunded":
      return refunded
        ? typeof totalPaidMinor === "number" && totalPaidMinor > 0
          ? `${refunded} refunded of ${programMoney(totalPaidMinor, currency)}`
          : `${refunded} refunded`
        : `${fee} · part refunded`;
    // #4430 item 5: "₦90 back to you · ₦25 to the creator".
    case "cancelled_partial":
    case "dispute_partial": {
      const kept =
        typeof creatorKeptMinor === "number" && creatorKeptMinor > 0
          ? programMoney(creatorKeptMinor, currency)
          : null;
      if (refunded && kept) return `${refunded} back to you · ${kept} to the creator`;
      if (refunded) return `${refunded} back to you`;
      return `${fee} · part refunded`;
    }
    default:
      return fee;
  }
}

/** gig_contract_workspace.refunded_minor (top level, or on the contract). */
export function workspaceRefundedMinor(workspace: unknown): number | null {
  if (!workspace || typeof workspace !== "object") return null;
  const row = workspace as Record<string, unknown>;
  const direct = row.refunded_minor;
  if (typeof direct === "number") return direct;
  const nested = (row.contract as Record<string, unknown> | undefined)
    ?.refunded_minor;
  return typeof nested === "number" ? nested : null;
}

/**
 * #4402 — the posting stage in host words: the deadline, the automatic full
 * refund if nobody posts, and what happened after a missed post.
 */
export function hostPostingCopy(input: {
  state: string;
  creatorName: string;
  deadlineWords: string | null;
  deadlineAt: string | null;
  cancelReason: string | null;
  refundWords: string | null;
  nowMs?: number;
}): { title: string; lines: string[]; dueSoon: boolean } | null {
  const { state, creatorName } = input;
  if (state === "cancelled" && input.cancelReason === "post_missed") {
    return {
      title: "Refunded",
      lines: [
        `The creator didn't post in time. Your full refund${input.refundWords ? ` of ${input.refundWords}` : ""} has started.`,
      ],
      dueSoon: false,
    };
  }
  if (state === "posts_submitted") {
    return {
      title: "Checking posts",
      lines: [
        `${creatorName} posted. Mingla's team is checking the links. You'll hear when they pass.`,
      ],
      dueSoon: false,
    };
  }
  if (["approved", "posting", "posts_failed"].includes(state)) {
    const now = input.nowMs ?? Date.now();
    const due = input.deadlineAt ? new Date(input.deadlineAt).getTime() : NaN;
    const dueSoon = Number.isFinite(due) && due - now < 86_400_000;
    const lines = [
      `${creatorName} posts the video and adds the links here. Mingla's team checks each link, usually within a day.`,
    ];
    if (input.deadlineWords) {
      lines.push(
        `${creatorName} posts by ${input.deadlineWords}. If they don't, you're refunded in full automatically.`,
      );
    }
    return { title: dueSoon ? "Posts due soon" : "Waiting for posts", lines, dueSoon };
  }
  return null;
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
  /** #4402 — the shoot plan, so the header follows a confirmation at once. */
  shoot?: {
    proposedBy: "host" | "creator";
    confirmed: boolean;
    whenWords: string;
  } | null;
  /** #4402 — while an action runs, the header says so ("Approving…"). */
  working?: string | null;
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
  let line =
    input.state === "released" || input.state === "day30"
      ? `Posts stay up for 30 days. You can rate ${input.creatorName} when the gig is done.`
      : input.state === "completed"
        ? input.hostRated
          ? "You've rated this gig."
          : `Rate ${input.creatorName} when you're ready.`
        : input.stepCaption;
  const planned = input.state === "accepted" || input.state === "shoot_planned";
  if (planned && input.shoot) {
    const { proposedBy, confirmed, whenWords } = input.shoot;
    if (confirmed) {
      title = "Shoot time confirmed";
      line = `Shoot confirmed for ${whenWords}. You'll review the script before the shoot.`;
    } else if (proposedBy === "creator") {
      title = "Approve the shoot time";
      line = `${input.creatorName} proposed ${whenWords}.`;
    } else {
      title = "Waiting for the creator to confirm";
      line = `You proposed ${whenWords}.`;
    }
  }
  if (input.working) title = input.working;
  return {
    title,
    pill: input.state === "completed" ? "Done" : pill.label,
    tone: pill.tone,
    line,
    canRate,
  };
}

/**
 * #4430 item 2: one action writes an action event and a fact event (for
 * example `send_script` and `script_sent`). The action row is dropped when
 * its fact partner from the same actor is within 5 seconds. Kept identical on
 * Explorer, Host and Admin (checked by a test).
 */
export const GIG_EVENT_PAIRS: Readonly<Record<string, string>> = {
  plan_confirmed: "shoot_plan_confirmed",
  send_script: "script_sent",
  deliver: "delivery_submitted",
  approve: "approved",
  request_fix: "fix_requested",
  open_dispute: "dispute_opened",
  submit_posts: "posts_submitted",
};
const PAIR_WINDOW_MS = 5_000;

export function dedupeGigEvents<T extends { kind: string; actor?: string; at?: string }>(
  events: readonly T[],
): T[] {
  return events.filter((event) => {
    const partner = GIG_EVENT_PAIRS[event.kind];
    if (!partner) return true;
    const at = Date.parse(event.at ?? "");
    return !events.some(
      (other) =>
        other !== event &&
        other.kind === partner &&
        other.actor === event.actor &&
        Number.isFinite(at) &&
        Math.abs(Date.parse(other.at ?? "") - at) <= PAIR_WINDOW_MS,
    );
  });
}

/**
 * Activity rows: events in words, newest first. A step recorded twice (the
 * button and the event) shows once; unknown kinds are left out.
 */
export function activityEvents<T extends { kind: string; actor?: string; at?: string }>(
  events: readonly T[],
): Array<T & { words: string }> {
  const out: Array<T & { words: string }> = [];
  for (const event of [...dedupeGigEvents(events)].reverse()) {
    const words = activityWords(
      event.kind,
      (event as { data?: Record<string, unknown> | null }).data,
    );
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

// ---------------------------------------------------------------------------
// #4402 — what the host sees while a creator-hire payment is checked.
//
// Invariant I-4402-E: the host UI never says nothing was charged until the
// server's payment_check is not_paid (declared in
// src/components/creators/screens/__tests__/issue_4402_contract_pay_return.test.ts).
// ---------------------------------------------------------------------------

/** The server's answer (`payment_check`) plus the two client-only states. */
export type HostPaymentCheckState =
  | "checking"
  | "paid"
  | "pending"
  | "unfinished"
  | "not_paid"
  | "mismatch"
  | "refunded"
  | "error";

export type HostPaymentCard = {
  title: string;
  body: string;
  /** retry → back to the applicant to offer again; check → ask the server again. */
  action: "retry" | "check" | null;
  actionLabel: string | null;
  busy: boolean;
};

export const PAYMENT_CHECK_POLL_MS = 3000;
export const PAYMENT_CHECK_LIMIT_MS = 30000;

/** Map a confirm_reference answer to a state; anything unknown is an error, never "not paid". */
export function paymentCheckState(answer: {
  ok: boolean;
  payment_check?: string;
}): HostPaymentCheckState {
  if (answer.ok) return "paid";
  switch (answer.payment_check) {
    case "paid":
    case "pending":
    case "unfinished":
    case "not_paid":
    case "mismatch":
    case "refunded":
      return answer.payment_check;
    default:
      return "error";
  }
}

/** Keep polling a pending answer every 3 s for up to 30 s after the first check. */
export function nextPaymentCheckDelay(
  state: HostPaymentCheckState,
  elapsedMs: number,
): number | null {
  if (state !== "pending") return null;
  return elapsedMs + PAYMENT_CHECK_POLL_MS <= PAYMENT_CHECK_LIMIT_MS
    ? PAYMENT_CHECK_POLL_MS
    : null;
}

/** The payment card, or null when there is nothing to say (paid). */
export function hostPaymentCard(
  state: HostPaymentCheckState,
  context: { creatorName: string; fromReturn: boolean },
): HostPaymentCard | null {
  switch (state) {
    case "paid":
      return null;
    case "checking":
      return {
        title: context.fromReturn
          ? "Confirming your payment…"
          : "Checking your payment",
        body: "This takes a few seconds.",
        action: null,
        actionLabel: null,
        busy: true,
      };
    case "pending":
      return {
        title: "Your payment is still being confirmed",
        body: "We'll update this page when it lands. You won't be charged twice.",
        action: "check",
        actionLabel: "Check again",
        busy: false,
      };
    case "unfinished":
      // #4402: Paystack keeps an unfinished checkout payable, so this is not
      // "nothing was charged" (that is only after the server says not_paid).
      return {
        title: "This payment wasn't finished",
        body: "If you closed the payment page, you can start again. You won't be charged twice.",
        action: "retry",
        actionLabel: "Start again",
        busy: false,
      };
    case "not_paid":
      return context.fromReturn
        ? {
            title: "The payment didn't go through",
            body: "Nothing was charged.",
            action: "retry",
            actionLabel: "Try again",
            busy: false,
          }
        : {
            title: "Payment not completed",
            body: `${context.creatorName} hasn't received this offer because the payment didn't go through. Nothing was charged.`,
            action: "retry",
            actionLabel: "Retry payment",
            busy: false,
          };
    case "mismatch":
      return {
        title: "We couldn't match this payment",
        body: "Our team has been alerted.",
        action: null,
        actionLabel: null,
        busy: false,
      };
    case "refunded":
      return {
        title: "This payment is being refunded",
        body: "It arrived after this offer had closed, so the full amount is on its way back to you.",
        action: "retry",
        actionLabel: "Make a new offer",
        busy: false,
      };
    case "error":
      return {
        title: "We couldn't check your payment",
        body: "Check your connection and try again.",
        action: "check",
        actionLabel: "Check payment",
        busy: false,
      };
    default: {
      const never: never = state;
      return never;
    }
  }
}

/**
 * #4430 H-C: "Retry payment" reopens the Hire sheet for the same offer: the
 * same creator's interest on this gig at the offer's agreed fee. The server
 * proves the old offer unpaid before it starts a new one (#4402 I-4402-C), so
 * this is the one hire payment path, not a second one. Null when the
 * creator's interest is not on the gig's list any more.
 */
export function retryHireMode(input: {
  applicants: readonly GigApplicant[];
  creatorAccountId: string | null | undefined;
  feeMinor: number | null | undefined;
}): { kind: "hire"; interestId: string; quoteMinor: number } | null {
  if (!input.creatorAccountId) return null;
  const interest = input.applicants.find(
    (row) => row.creator_id === input.creatorAccountId,
  );
  if (!interest) return null;
  const fee =
    typeof input.feeMinor === "number" && input.feeMinor > 0
      ? input.feeMinor
      : interest.quote_minor;
  return { kind: "hire", interestId: interest.interest_id, quoteMinor: fee };
}
