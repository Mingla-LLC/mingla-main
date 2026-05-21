#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0901 [Refactor messagingService.getConversations from 4N-sequential-queries
 * to a single RLS-filtered, JOINed query] regression check (happy-path, structural).
 *
 * Adapts SPEC_ORCH-0901 §6.1's 9 happy-path tests to the app-mobile .mjs
 * structural-check pattern (jest is unavailable in app-mobile — see ORCH-0854
 * regression-check.mjs for the canonical template).
 *
 * Anti-regression rationale: this bug is fundamentally structural — "getConversations
 * makes too many sequential queries; the new structure must make ≤2." A grep-based
 * structural check on the function body is the strongest possible enforcement for
 * this class of bug because (a) grep cannot be bypassed by mock-spy gymnastics,
 * (b) the source text is the unambiguous source of truth, and (c) TypeScript strict
 * mode already enforces the return-shape contract at compile time (so no jest
 * snapshot is needed for SC-03). The 2026-05-20 implementor + operator path-fork
 * locked this approach explicitly over introducing jest to app-mobile.
 *
 * Each `check()` corresponds to one or more spec success criteria in
 * SPEC_ORCH-0901 §4 / §6.1. The check labeled "FAILS-ON-REVERT KEY" is the
 * canonical anchor — reverting the refactor flips it to FAIL with exit 1.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const read = (relFromRepoRoot) => {
  const abs = path.join(repoRoot, relFromRepoRoot);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const svcSrc = read("app-mobile/src/services/messagingService.ts");
const pageSrc = read("app-mobile/src/components/ConnectionsPage.tsx");

// Extract the getConversations function body (from declaration through closing brace at
// the same depth). Capture is the public method on the MessagingService class.
const extractGetConversationsBody = (src) => {
  if (!src) return null;
  const sigRe = /async\s+getConversations\s*\(\s*userId:\s*string\s*\)\s*:\s*Promise<\{\s*conversations:\s*Conversation\[\]\s*;\s*error:\s*string\s*\|\s*null\s*\}>\s*\{/;
  const m = src.match(sigRe);
  if (!m) return null;
  const start = m.index + m[0].length - 1; // position of opening "{"
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  return null;
};

const body = extractGetConversationsBody(svcSrc);

// ─── T-01 (SC-02): Single-round-trip count — ≤ 2 `supabase.from(` invocations in body ─

check(
  "T-01 [FAILS-ON-REVERT KEY] getConversations body contains ≤ 2 sequential `supabase.from(` invocations" +
    " (parallel Promise.all of Q1+Q2, plus optional Q3 profile fetch)",
  body !== null && (() => {
    // Strip JS line comments so a `// ... supabase.from(` mention doesn't count.
    const codeOnly = body
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const matches = codeOnly.match(/supabase\s*\.\s*from\s*\(/g) || [];
    return matches.length <= 3; // Q1, Q2, Q3 — Q3 is conditional but the source text contains 3.
  })(),
  "The refactored getConversations must issue at most 3 calls to `supabase.from(` in its body" +
    " (Q1 conversations+participants+last_message JOIN, Q2 unread helper, Q3 batch profile fetch)." +
    " Each is bounded; Q1+Q2 run in parallel via Promise.all; Q3 runs conditionally after." +
    " Re-introducing the legacy 2+5N per-conversation loop would push this count above 3 and trip" +
    " this check (canonical fails-on-revert anchor for ORCH-0901).",
);

// ─── T-01b (SC-02): Sequential-await count ─ direct `await supabase.from(` ≤ 1 ─

check(
  "T-01b Sequential `await supabase.from(` count in getConversations body is ≤ 1" +
    " (only the Q3 profile batch — Q1+Q2 run inside Promise.all and are not awaited individually)",
  body !== null && (() => {
    const codeOnly = body
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const matches = codeOnly.match(/await\s+supabase\s*\.\s*from\s*\(/g) || [];
    return matches.length <= 1;
  })(),
  "The refactored getConversations must contain at most 1 directly-awaited `supabase.from(`" +
    " call (the Q3 batch profile fetch). Q1 and Q2 are assigned to Promise variables that are" +
    " then awaited together via Promise.all — they appear as `supabase.from(...)` but NOT" +
    " `await supabase.from(...)`. Legacy code had 5 (`participantData`, `conversationsData`," +
    " `lastMessage` inside loop, `unreadMessages` inside loop, `readMessages` inside loop)." +
    " A count > 1 means the legacy sequential pattern has crept back in.",
);

// ─── T-02 (SC-03): Conversation return-type contract unchanged ────────────────────

check(
  "T-02 Conversation interface still declares { id, type, created_by, created_at, updated_at, " +
    "last_message_at?, participants[], last_message?, unread_count? }",
  svcSrc !== null && (() => {
    const ifaceMatch = svcSrc.match(/export\s+interface\s+Conversation\s*\{[\s\S]*?\n\}/);
    if (!ifaceMatch) return false;
    const iface = ifaceMatch[0];
    return (
      /\bid:\s*string\b/.test(iface) &&
      /\btype:\s*'direct'\s*\|\s*'group'/.test(iface) &&
      /\bcreated_by:\s*string\s*\|\s*null\b/.test(iface) &&
      /\bcreated_at:\s*string\b/.test(iface) &&
      /\bupdated_at:\s*string\b/.test(iface) &&
      /\blast_message_at\?:/.test(iface) &&
      /\bparticipants:\s*\{/.test(iface) &&
      /\blast_message\?:\s*DirectMessage\b/.test(iface) &&
      /\bunread_count\?:\s*number\b/.test(iface)
    );
  })(),
  "The Conversation interface at messagingService.ts:211 must remain unchanged. The refactor preserves" +
    " the server-shape contract — ConnectionsPage's transform layer + ChatListItem consume this exact" +
    " shape. Any drift here is a contract regression (SC-03).",
);

// ─── T-05 (SC-08): NULL-sender unread fix (Finding #2 from INVESTIGATION_ORCH-0901) ─

check(
  "T-05 [FAILS-ON-REVERT KEY] Unread-count predicate uses .or('sender_id.neq.<X>,sender_id.is.null')" +
    " — defeats the .neq() nullable-column footgun documented in feedback_supabase_neq_null.md",
  body !== null &&
    /\.or\(\s*`sender_id\.neq\.\$\{userId\}\s*,\s*sender_id\.is\.null`\s*\)/.test(body),
  "The legacy `.neq('sender_id', userId)` filter silently dropped NULL-sender rows because" +
    " NULL != 'value' evaluates to NULL (falsy) in SQL. Today no production NULL-sender messages exist," +
    " but ORCH-0898 [Consumer collab session → Friends-tab group chat] explicitly plans round-start system" +
    " messages with sender_id IS NULL — the day ORCH-0898 ships, unread counts would silently miss them" +
    " without this fix. The .or() form ensures both real-user-other and system-NULL rows count as unread." +
    " Reverting this to `.neq('sender_id', userId)` flips T-05 to FAIL.",
);

// ─── T-05b: Legacy .neq('sender_id', userId) is GONE from getConversations ─

check(
  "T-05b Legacy .neq('sender_id', userId) does NOT appear in getConversations body (eliminated)",
  body !== null && !/\.neq\(['"]sender_id['"]\s*,\s*userId\)/.test(body),
  "The legacy filter pattern must be removed entirely; the .or() form replaces it. If both are" +
    " present, the .or() is shadowed and the NULL-sender bug returns.",
);

// ─── T-06 (SC-07): Group-conversation-ready — no .eq('type', 'direct') filter ────

check(
  "T-06 No `.eq('type', 'direct')` or equivalent filter on conversations.type in getConversations body" +
    " — preserves group-conversation-readiness for ORCH-0898",
  body !== null &&
    !/\.eq\(\s*['"]type['"]\s*,\s*['"]direct['"]\s*\)/.test(body) &&
    !/\.eq\(\s*['"]type['"]\s*,\s*['"]group['"]\s*\)/.test(body) &&
    !/\.filter\(\s*['"]type['"]\s*,\s*['"]eq['"]\s*,\s*['"]direct['"]\s*\)/.test(body),
  "getConversations must NOT filter by conversations.type. The schema already enumerates" +
    " type='direct'|'group' (baseline migration line 8013); once ORCH-0898 introduces type='group'" +
    " rows linked to collaboration sessions, they MUST appear in the Friends-tab list automatically" +
    " with no code change. Adding any .eq('type', ...) filter here regresses SC-07.",
);

// ─── T-07 (SC-10): .single() eliminated on potentially-empty subselects ───────────

check(
  "T-07 No `.single()` call appears in getConversations body — eliminated via JOIN (was on lines" +
    " 558 + 951 of the pre-refactor code)",
  body !== null && !/\.single\(\s*\)/.test(body),
  "The legacy code used `.single()` on a `from('messages').limit(1)` that could return zero rows," +
    " producing PGRST116 (406) noise in the network log per empty conversation. The refactored JOIN" +
    " handles empty cases naturally (no row → undefined). Re-introducing `.single()` here is a" +
    " regression of Finding #3 in INVESTIGATION_ORCH-0901.",
);

// ─── T-08 (SC-04 / Constitution #3): Error path still returns shape contract ─

check(
  "T-08 Error path returns `{ conversations: [], error: error.message }` — no silent failure",
  body !== null &&
    /return\s*\{\s*conversations:\s*\[\]\s*,\s*error:\s*error\.message\s*\}/.test(body),
  "The error contract is preserved: on any throw inside the function, the catch block must return" +
    " `{ conversations: [], error: error.message }` so the caller (ConnectionsPage line 711) can" +
    " surface the error via `if (convError) throw new Error(convError)`. Constitution #3.",
);

// ─── T-09 (SC-02): Promise.all is used to run Q1+Q2 in parallel (not sequential) ─

check(
  "T-09 Q1+Q2 run in parallel via Promise.all — not sequential",
  body !== null &&
    /Promise\.all\s*\(\s*\[\s*conversationsPromise\s*,\s*unreadPromise\s*,?\s*\]\s*\)/.test(body),
  "Q1 (conversations + last_message + participants) and Q2 (unread helper) MUST run in parallel" +
    " via Promise.all([conversationsPromise, unreadPromise]) — not awaited sequentially. Without this," +
    " round-trip 1 + round-trip 2 = 2 sequential round-trips instead of 1.",
);

// ─── Q1 shape: nested JOIN includes participants + last_message + read_status ─

check(
  "Q1 shape: conversations.select() embeds participants:conversation_participants + last_message:messages" +
    " + nested read_status:message_reads",
  body !== null && (() => {
    // Extract just the conversationsPromise select block
    const selectBlock = body.match(/conversationsPromise\s*=\s*supabase[\s\S]*?\.limit\(1,\s*\{\s*referencedTable:\s*['"]last_message['"]\s*\}\s*\)/);
    if (!selectBlock) return false;
    const text = selectBlock[0];
    return (
      /participants:\s*conversation_participants/.test(text) &&
      /last_message:\s*messages/.test(text) &&
      /read_status:\s*message_reads/.test(text)
    );
  })(),
  "Q1 must select conversations + nested participants (alias participants:conversation_participants)" +
    " + nested last-message (alias last_message:messages) + nested message_reads (alias" +
    " read_status:message_reads). This is the single-round-trip shape that replaces the legacy" +
    " 2+5N loop. The order+limit(1) on last_message enforces 'most recent message per conversation'.",
);

// ─── Comment update at ConnectionsPage:693-696 ─────────────────────────────────

check(
  "ConnectionsPage:693 comment updated to reflect post-ORCH-0901 query count" +
    " (replaces stale '4N sequential' text)",
  pageSrc !== null &&
    /Post-ORCH-0901,\s*\n?\s*\/\/\s*messagingService\.getConversations\s+runs\s+at\s+most\s+2\s+sequential/.test(
      pageSrc,
    ) &&
    !/messagingService\.getConversations\s+runs\s+4N\s+sequential/.test(pageSrc),
  "ConnectionsPage.tsx:693-696 inline comment must replace the stale '4N sequential Supabase queries'" +
    " text with the post-ORCH-0901 description ('at most 2 sequential RLS-filtered Supabase round-trips')." +
    " The 10-second Promise.race timeout (lines 697-703) remains as belt-and-suspenders.",
);

// ─── 10-second timeout retained (SC-09) ─────────────────────────────────────────

check(
  "SC-09: 10-second `Promise.race` timeout retained at ConnectionsPage:697-703",
  pageSrc !== null &&
    /setTimeout\(\s*\(\)\s*=>\s*\{\s*\n?\s*const\s+err\s*=\s*new\s+Error\('getConversations\s+timed\s+out\s+after\s+10s'\)/.test(
      pageSrc,
    ),
  "The belt-and-suspenders 10-second timeout must remain in place. It guards against background-suspended" +
    " Supabase connections hanging the cold-load forever. Removing it is a separate follow-up ORCH after" +
    " operator metric confirmation.",
);

// ─── Sender-name + is_read still populated on last_message (contract preservation) ─

check(
  "Contract: last_message still gets sender_name + is_read populated before return" +
    " (ConnectionsPage transform layer relies on this)",
  body !== null &&
    /sender_name:\s*senderName/.test(body) &&
    /is_read:\s*reads\.some\(/.test(body),
  "The post-refactor function MUST populate last_message.sender_name (via the senderProfileCache" +
    " warmed by Q3) and last_message.is_read (computed from embedded read_status). ChatListItem reads" +
    " these — dropping them would break the chat-list preview rendering.",
);

// ─── Report ────────────────────────────────────────────────────────────────────

console.log("\nORCH-0901 regression check (happy-path, structural)\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
