/**
 * Issue #3355 P1 (D-5, D-6, D-32) — the owner copy gate.
 *
 * Owner-visible text (chat replies, proposal cards, renditions, receipts,
 * post-approval lines, reconcile lines) must never carry engine plumbing: tool
 * names, snake_case keys, revisions, hashes, ids, internal codes or engine
 * nouns. Before this gate the owner saw "update brand context", "expected plan
 * revision 7", a 64-character context hash and "I reconciled the expired
 * action".
 *
 * Two strengths:
 *   - "label": titles, eyebrows, field labels and engine-authored lines. Strict:
 *     also refuses the words revision / fingerprint / hash / receipt / tool /
 *     job / durable.
 *   - "prose": model-written replies. Ordinary English words ("a great tool",
 *     "your email receipt") are fine; plumbing tokens are not.
 * Values the owner typed (a field value, a handle such as @seth_ogieva, an
 * email, a URL) are never judged as snake_case.
 *
 * Tool names are generated from the tool registry: agentTools.ts registers
 * every name at load (`registerOwnerCopyToolNames`). This module imports
 * nothing so every boundary can use it without an import cycle.
 */

export type OwnerCopyMode = "label" | "prose";

export type OwnerCopyViolationKind =
  | "tool_name"
  | "snake_case"
  | "internal_key"
  | "uuid"
  | "hex"
  | "code"
  | "engine_noun";

export interface OwnerCopyViolation {
  kind: OwnerCopyViolationKind;
  token: string;
}

let registeredToolNames: ReadonlySet<string> = new Set();

/** Called once by the tool registry; later calls add names. */
export function registerOwnerCopyToolNames(names: Iterable<string>): void {
  const next = new Set(registeredToolNames);
  for (const name of names) {
    if (typeof name === "string" && name.length > 0) next.add(name);
  }
  registeredToolNames = next;
}

export function ownerCopyToolNames(): ReadonlySet<string> {
  return registeredToolNames;
}

const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// ≥16 hex chars with at least one letter and one digit (a hash or id, never a
// phone number or an ordinary word).
const HEX_RUN = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{16,}\b/gi;
const UUID_ONE = new RegExp(UUID.source, "i");
const HEX_ONE = new RegExp(HEX_RUN.source, "i");
const ALL_CAPS_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/**
 * #3355 rework 8 (R8-10): words of Ari's own instructions that the model
 * sometimes repeats to the host ("Verified via canonical Mingla readback",
 * "Human-owned work: None").
 */
function PROMPT_ECHO_WORDS(): RegExp[] {
  return [
    /\bcanonical\b/i,
    /\bread[- ]?backs?\b/i,
    /\bhuman[- ]owned\b/i,
    /\bAri[- ]owned\b/i,
  ];
}

/** "Waiting for approval: None." / "Skipped: none" — an empty category. */
const EMPTY_CATEGORY = /^[\p{L} -]{2,40}:\s*(?:none|n\/a|nothing|-)\s*[.!]?$/iu;
/** "Goal complete." / "Final result confirmed in Mingla system." */
const BARE_STATUS_ECHO =
  /^(?:goal\s+(?:is\s+)?complete(?:d)?|final\s+result\s+confirmed(?:\s+in\s+(?:the\s+)?mingla(?:\s+system)?)?|all\s+steps\s+complete(?:d)?)\s*[.!]?$/i;

/**
 * #3355 rework 8 (R8-10): remove the sentences that repeat Ari's own
 * instructions (they carry no fact for the host), and empty categories.
 * What is left is the plain receipt.
 */
export function stripPromptEcho(text: string): string {
  const echo = PROMPT_ECHO_WORDS();
  const lines: string[] = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) {
      lines.push("");
      continue;
    }
    if (INVENTED_CODE_STEP.test(line.replace(/[*_`]/g, ""))) continue;
    const kept = line.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((sentence) => {
      const plain = sentence.replace(/[*_`]/g, "").replace(/^\s*[-•]\s*/, "")
        .trim();
      if (!plain) return false;
      if (echo.some((pattern) => pattern.test(plain))) return false;
      if (EMPTY_CATEGORY.test(plain) || BARE_STATUS_ECHO.test(plain)) {
        return false;
      }
      return true;
    });
    if (kept.length > 0) lines.push(kept.join(" "));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Internal keys that are plumbing in any spelling ("plan revision", "state_version"). */
const INTERNAL_KEY_PHRASES: readonly RegExp[] = [
  /\b(?:expected[ _])?(?:plan|context|client|site|draft)[ _]revision\b/i,
  /\bstate[ _]version\b/i,
  /\boperation[ _]id\b/i,
  /\bidempotency[ _]key\b/i,
  /\bedge function\b/i,
  /\bRPC\b/,
  /\bdurable\b/i,
  // #3355 P9 (D-21): places come from the address search; Ari never asks
  // for, or talks about, coordinates.
  /\b(?:latitudes?|longitudes?)\b/i,
  // #3355 rework 8 (R8-10): the continuation prompt's own words.
  ...PROMPT_ECHO_WORDS(),
];

/** Strict-only words: fine in prose, never in a label or engine line. */
const LABEL_ONLY_WORDS: readonly RegExp[] = [
  /\bpending[ _]actions?\b/i,
  /\breconcil(?:e|ed|es|ing|iation)\b/i,
  /\brevisions?\b/i,
  /\bfingerprints?\b/i,
  /\bhash(?:es)?\b/i,
  /\breceipts?\b/i,
  /\btools?\b/i,
  /\bjobs?\b/i,
];

/** Tokens the owner may legitimately write that look like snake_case. */
function isOwnerValueToken(token: string): boolean {
  return token.includes("@") || token.includes("://") ||
    token.startsWith("www.") || token.includes("/") ||
    /\.[a-z]{2,}$/i.test(token) || token.startsWith("#");
}

function stripEdges(token: string): string {
  return token.replace(/^[`'"“”‘’([{<*_]+|[`'"“”‘’)\]}>.,:;!?*]+$/g, "");
}

/** Every plumbing token in `text`. Empty means the copy is owner-safe. */
export function ownerCopyViolations(
  text: string,
  mode: OwnerCopyMode = "label",
): OwnerCopyViolation[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const found: OwnerCopyViolation[] = [];
  for (const match of text.matchAll(UUID)) {
    found.push({ kind: "uuid", token: match[0] });
  }
  const withoutUuids = text.replace(UUID, " ");
  for (const match of withoutUuids.matchAll(HEX_RUN)) {
    found.push({ kind: "hex", token: match[0] });
  }
  for (const match of text.matchAll(ALL_CAPS_CODE)) {
    found.push({ kind: "code", token: match[0] });
  }
  for (const raw of withoutUuids.split(/\s+/)) {
    if (!raw || isOwnerValueToken(raw)) continue;
    const token = stripEdges(raw);
    if (!token) continue;
    if (registeredToolNames.has(token)) {
      found.push({ kind: "tool_name", token });
    } else if (SNAKE.test(token)) {
      found.push({ kind: "snake_case", token });
    }
  }
  for (const phrase of INTERNAL_KEY_PHRASES) {
    const match = text.match(phrase);
    if (match) {
      found.push({
        kind: /durable|edge function|RPC/i.test(match[0])
          ? "engine_noun"
          : "internal_key",
        token: match[0],
      });
    }
  }
  if (mode === "label") {
    for (const word of LABEL_ONLY_WORDS) {
      const match = text.match(word);
      if (match) found.push({ kind: "engine_noun", token: match[0] });
    }
  }
  return found;
}

export function isOwnerSafe(
  text: string,
  mode: OwnerCopyMode = "label",
): boolean {
  return ownerCopyViolations(text, mode).length === 0;
}

/** A field VALUE the owner typed or the server read back: only ids/hashes are refused. */
export function isOwnerSafeValue(value: string): boolean {
  if (typeof value !== "string") return false;
  return !UUID_ONE.test(value) && !HEX_ONE.test(value.replace(UUID, " "));
}

function logBlocked(surface: string, violations: OwnerCopyViolation[]): void {
  // Structured, token-free log line (the blocked token may be owner data).
  console.warn(
    "[ari-owner-copy]",
    JSON.stringify({
      kind: "copy_gate_blocked",
      surface,
      violations: [...new Set(violations.map((v) => v.kind))],
    }),
  );
}

/**
 * The owner copy gate. Returns `text` when it is owner-safe; otherwise logs
 * `copy_gate_blocked` for `surface` and returns `fallback`.
 */
export function assertOwnerCopy(
  text: string,
  options: { fallback: string; surface: string; mode?: OwnerCopyMode },
): string {
  const violations = ownerCopyViolations(text, options.mode ?? "label");
  if (violations.length === 0) return text;
  logBlocked(options.surface, violations);
  return options.fallback;
}

/**
 * Rewrite plumbing out of model prose before the gate judges it: tool names
 * and snake_case keys become plain words or disappear, ids and hashes are
 * removed. Handles, emails and URLs are left exactly as written.
 */
export function rewriteOwnerProse(
  text: string,
  toolPhrase: (toolName: string) => string | null = () => null,
): string {
  let out = text.replace(UUID, "").replace(HEX_RUN, "");
  out = out.split(/(\s+)/).map((part) => {
    if (!part.trim() || isOwnerValueToken(part)) return part;
    const token = stripEdges(part);
    if (!token || !(registeredToolNames.has(token) || SNAKE.test(token))) {
      return part;
    }
    const lead = part.slice(0, part.indexOf(token));
    const tail = part.slice(part.indexOf(token) + token.length);
    if (registeredToolNames.has(token)) {
      const phrase = toolPhrase(token) ?? "that step";
      return `${lead.replace(/`/g, "")}${phrase}${tail.replace(/`/g, "")}`;
    }
    if (
      /(^|_)(id|ids|uuid|revision|version|hash|digest|fingerprint|key)$/.test(
        token,
      )
    ) {
      return `${lead.replace(/`/g, "")}${tail.replace(/`/g, "")}`;
    }
    return `${lead.replace(/`/g, "")}${token.split("_").join(" ")}${
      tail.replace(/`/g, "")
    }`;
  }).join("");
  return out
    .replace(/\b(?:expected )?(?:plan|context|client) revision\b\s*\S*/gi, "")
    .replace(/\bstate version\b\s*\S*/gi, "")
    .replace(/\bdurable\s+/gi, "")
    .replace(/\b(?:an?\s+|the\s+)?edge functions?\b/gi, "Mingla")
    .replace(/\bRPCs?\b\s*/g, "")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .replace(/\s+([.,:;!?])/g, "$1")
    .trim();
}

/**
 * Model prose at the response boundary: rewrite, then gate. A reply that is
 * still unsafe after the rewrite is replaced by `fallback`.
 */
export function gateOwnerProse(
  text: string,
  options: {
    fallback: string;
    surface: string;
    toolPhrase?: (toolName: string) => string | null;
  },
): string {
  const rewritten = rewriteOwnerProse(text, options.toolPhrase);
  return assertOwnerCopy(rewritten, {
    fallback: options.fallback,
    surface: options.surface,
    mode: "prose",
  });
}

// ---------------------------------------------------------------------------
// Engine lines the owner reads (D-7, D-32). One home, all gate-clean.
// ---------------------------------------------------------------------------

export type ReconciledApprovalOutcome =
  | "executed"
  | "failed"
  | "failed_unknown"
  | "cancelled"
  | "expired"
  | "executing"
  | "pending"
  | undefined;

/** What happened to an earlier approval, in plain words. */
export function reconciledApprovalLine(
  outcome: ReconciledApprovalOutcome,
): string {
  switch (outcome) {
    case "executed":
      return "That earlier change finished saving.";
    case "expired":
      return "That earlier approval timed out; nothing was saved.";
    case "cancelled":
      return "That earlier approval was cancelled; nothing was saved.";
    case "failed_unknown":
      return "I couldn't confirm that earlier change saved, so I'm not showing it as done.";
    case "failed":
    default:
      return "That earlier change didn't go through; nothing was saved.";
  }
}

/** What the owner sees when a model reply is still unsafe after the rewrite. */
export const OWNER_PROSE_FALLBACK =
  "I have an answer, but I couldn't put it in plain words. Ask me again and I'll keep it simple.";

/** Post-approval budget stop. Never claims anything was saved for later. */
export const ARI_STOPPED_HERE_LINE =
  "I stopped here. Say 'continue' when you're ready.";

/**
 * #3355 final fix (P3): Ari speaks to the host, never about them ("The host
 * still needs to share this code" → "You still need to share this code"),
 * and never adds a step the product does not have: a discount code is live
 * once it is saved, so "Publish the code" is dropped.
 */
const HOST_THIRD_PERSON: ReadonlyArray<[RegExp, string]> = [
  [/\bThe host still needs to\b/g, "You still need to"],
  [/\bthe host still needs to\b/g, "you still need to"],
  [/\bThe host needs to\b/g, "You need to"],
  [/\bthe host needs to\b/g, "you need to"],
  [/\bThe host has\b/g, "You have"],
  [/\bthe host has\b/g, "you have"],
  [/\bThe host is\b/g, "You are"],
  [/\bthe host is\b/g, "you are"],
  [/\bThe host(?:'|’)s\b/g, "Your"],
  [/\bthe host(?:'|’)s\b/g, "your"],
  [/\bThe host (can|should|will|must|may)\b/g, "You $1"],
  [/\bthe host (can|should|will|must|may)\b/g, "you $1"],
];
const INVENTED_CODE_STEP =
  /^(?:\s*(?:\d+[.)]|[-•*])\s*)?(?:(?:then|next|finally|and)[,\s]+)?(?:you\s+(?:still\s+)?(?:need|have)\s+to\s+)?publish\s+(?:the|your|this)\s+(?:discount\s+|promo\s+)?codes?\b[^.!?\n]*[.!]?\s*$/i;
/**
 * #3355 rework 9 (fix 4, I-ARI-HOST-IS-YOU): a step that sends the reader
 * to "the host" ("You still need to confirm with the host that the discount
 * is live", "Let the host know…") is about a third person who is the reader
 * themself, so the sentence goes. "As the host, you…" is kept.
 */
const HOST_THIRD_PARTY_STEP =
  /\b(?:confirm|check|verify|coordinate|discuss|share|agree|follow\s+up|double[-\s]check|talk|speak|work|sync|align)\s+(?:[\p{L}'’]+\s+){0,4}?with\s+the\s+host\b|\b(?:let|tell|ask|remind|notify|inform|message|email|contact|text|ping|update)\s+the\s+host\b|\b(?:send|forward|pass|give|show)\s+(?:[\p{L}'’]+\s+){0,4}?to\s+the\s+host\b/iu;
/** "the host" left mid-sentence is the reader ("Mingla pays the host" → "pays you"). */
const HOST_OBJECT =
  /(?<!\b[Aa]s\s)\bthe host\b(?!\s*(?:app|web|portal|dashboard)\b)(?!['’]s)/g;

export function speakToHost(text: string): string {
  let out = String(text ?? "");
  for (const [pattern, words] of HOST_THIRD_PERSON) {
    out = out.replace(pattern, words);
  }
  const lines: string[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) {
      lines.push(line);
      continue;
    }
    const plainLine = line.replace(/[*_`]/g, "");
    if (INVENTED_CODE_STEP.test(plainLine)) continue;
    if (HOST_THIRD_PARTY_STEP.test(plainLine) && !/[.!?]\s+\S/.test(line)) {
      continue;
    }
    const kept = line.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((sentence) => {
      const plain = sentence.replace(/[*_`]/g, "");
      return !INVENTED_CODE_STEP.test(plain) &&
        !HOST_THIRD_PARTY_STEP.test(plain);
    }).map((sentence) => sentence.replace(HOST_OBJECT, "you"));
    if (kept.length > 0) lines.push(kept.join(" "));
  }
  // Nothing left (the whole reply was a step for "the host"): say it as is.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() ||
    String(text ?? "").trim();
}
