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

/** Internal keys that are plumbing in any spelling ("plan revision", "state_version"). */
const INTERNAL_KEY_PHRASES: readonly RegExp[] = [
  /\b(?:expected[ _])?(?:plan|context|client|site|draft)[ _]revision\b/i,
  /\bstate[ _]version\b/i,
  /\boperation[ _]id\b/i,
  /\bidempotency[ _]key\b/i,
  /\bedge function\b/i,
  /\bRPC\b/,
  /\bdurable\b/i,
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
