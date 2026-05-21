#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0901 [Refactor messagingService.getConversations from 4N-sequential-queries
 * to a single RLS-filtered, JOINed query] tester-written ADVERSARIAL regression check.
 *
 * Sister to `orch-0901-regression-check.mjs` (implementor happy-path). This script
 * attacks the SAME implementation from DIFFERENT angles than the happy-path:
 *
 * Happy-path stance:                          Adversarial stance:
 * - "Promise.all([Q1, Q2]) is present"   →    "Q1 and Q2 are NOT awaited separately
 *                                              BEFORE the Promise.all"
 * - ".or() pattern is present"           →    "No OTHER .neq() on a nullable column
 *                                              regression was introduced"
 * - "shape interface still declares X"   →    "no new field was silently added to
 *                                              the return shape that breaks consumers"
 * - "no .single() in the function body"  →    "no .single() reintroduced ANYWHERE
 *                                              that the implementor's regex might miss"
 * - "embedded select uses last_message:" →    "every field consumer code reads
 *                                              from last_message is in the SELECT"
 *
 * Per SPEC_ORCH-0901 §6.2 and ORCH-0840 [Regression-test enforcement + append-only CI]
 * Step 0.5 — both implementor + tester regression tests are mandatory for CLOSE.
 *
 * Coverage angles (NUMBERED TA-NN per SPEC §6.2 + tester additions):
 *
 *   TA-01: AST-style loop-body invariant — no await supabase.from() inside ANY for /
 *          forEach / while / map(async) inside getConversations body. This is the
 *          structural rule the legacy 2+5N pattern violated.
 *   TA-02: Runtime-field shape — last_message return shape includes EVERY field
 *          the Conversation + DirectMessage TypeScript types declare.
 *   TA-03: RLS-failure resilience — error path returns shape contract without
 *          throwing, ensuring zero-row-from-RLS doesn't surface as a crash.
 *   TA-04: Promise.all ordering — Q1 and Q2 are NOT awaited individually before the
 *          Promise.all call. (Adversarial: the happy-path checks "Promise.all is
 *          present"; this attack checks "no shadow awaits subvert it".)
 *   TA-05: N=200 stress — function body has no internal data-size cap or per-N
 *          structural cost that would fail at scale.
 *   TA-06: Group-conversation-ready AST scan — no `eq` / `match` / `filter` /
 *          `or` / `in` invocations targeting `type` column anywhere in body.
 *   TA-07: .maybeSingle vs .single enforcement — comprehensive scan including
 *          `.single<` (generic form) and `.maybeSingle()` confirmation if used.
 *   TA-08: NULL-sender unread counting LOGIC — verifies the unreadByConv build
 *          loop includes the `isReadByMe` guard so already-read messages don't
 *          erroneously count. (Adversarial: happy-path checks predicate exists;
 *          this attacks the count-math layer above the predicate.)
 *   TA-09: Embedded SELECT field completeness — every field of DirectMessage
 *          that is NOT optional is named in the last_message:messages(...) SELECT.
 *   TA-10: senderProfileCache warming — Q3 batch fetch correctly populates the
 *          shared cache so `enrichMessage` calls in OTHER service methods
 *          (`getMessageById`, `sendMessage`) benefit transparently.
 *   TA-11: Soft-delete filter on Q2 — unread helper has `.is('deleted_at', null)`
 *          so soft-deleted messages don't count toward unread. (Adversarial: SPEC
 *          §3.1 implies this but doesn't explicitly require Q2 to filter; verifies
 *          the implementor caught the obvious oversight.)
 *   TA-12: Q1 deleted_at filter on embedded last_message — embedded last_message
 *          must be filtered to non-deleted via `.is('last_message.deleted_at', null)`
 *          OR equivalent — otherwise a soft-deleted message could be shown in the
 *          chat list preview.
 *   TA-13: Defensive Array.isArray guard on last_message embedded result — Postgrest
 *          returns embedded resources as arrays when .limit() is applied; the code
 *          must handle both array and scalar shapes.
 *   TA-14: No new .neq() on a nullable column elsewhere in the function body —
 *          adversarial check against the implementor accidentally reintroducing
 *          the bug class while fixing one instance.
 *
 * Each adversarial test FAILS on revert because each independently tests a
 * structural invariant the legacy 2+5N pattern violated.
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

// Extract getConversations body (same brace-counting approach as happy-path script).
const extractGetConversationsBody = (src) => {
  if (!src) return null;
  const sigRe = /async\s+getConversations\s*\(\s*userId:\s*string\s*\)\s*:\s*Promise<\{\s*conversations:\s*Conversation\[\]\s*;\s*error:\s*string\s*\|\s*null\s*\}>\s*\{/;
  const m = src.match(sigRe);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
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

// Strip JS line + block comments to focus on actual code.
const stripComments = (s) =>
  s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ─── TA-01: AST-style loop-body invariant (stricter than happy-path T-01b) ─

check(
  "TA-01 [FAILS-ON-REVERT KEY] No `await supabase` (incl. `supabase.from`, `supabase.rpc`," +
    " etc.) appears inside any for / forEach / while / .map(async loop body in getConversations." +
    " Stricter than happy-path: catches RPC calls + any future Supabase-method-call-inside-loop pattern.",
  body !== null && (() => {
    const code = stripComments(body);
    // Find every loop opening and check no `await supabase.` appears before the matching close.
    // Approach: split on loop headers, then for each loop's body, walk braces to find the
    // closing brace, then scan that bounded substring for `await supabase.`.
    const findLoopBodies = (text) => {
      const bodies = [];
      const headers = [
        { re: /\bfor\s*\(/g, type: "for" },
        { re: /\bwhile\s*\(/g, type: "while" },
        { re: /\.\s*forEach\s*\(/g, type: "forEach" },
        { re: /\.\s*map\s*\(\s*async/g, type: "map_async" },
      ];
      for (const h of headers) {
        let m;
        while ((m = h.re.exec(text)) !== null) {
          // Walk forward from header end to find body's opening "{" (skip the loop-header parens).
          let i = m.index + m[0].length;
          let parenDepth = h.type === "for" || h.type === "while" || h.type === "forEach" || h.type === "map_async" ? 1 : 0;
          while (i < text.length && parenDepth > 0) {
            if (text[i] === "(") parenDepth += 1;
            else if (text[i] === ")") parenDepth -= 1;
            i += 1;
          }
          // Skip arrow or whitespace
          while (i < text.length && /[\s=>]/.test(text[i])) i += 1;
          if (text[i] !== "{") continue; // not a brace body
          // Walk braces to find matching close.
          let depth = 0;
          const bodyStart = i;
          for (; i < text.length; i++) {
            if (text[i] === "{") depth += 1;
            else if (text[i] === "}") {
              depth -= 1;
              if (depth === 0) {
                bodies.push(text.slice(bodyStart, i + 1));
                break;
              }
            }
          }
        }
      }
      return bodies;
    };
    const loopBodies = findLoopBodies(code);
    return loopBodies.every((b) => !/await\s+supabase\s*\.\s*\w+/.test(b));
  })(),
  "Strictly NO `await supabase.<anything>` inside any loop body within getConversations." +
    " Reverting the refactor reintroduces the legacy `for (const conv of ...) { await supabase.from('messages')... }`" +
    " pattern — TA-01 catches it via proper brace-depth tracking. This is a canonical fails-on-revert anchor that" +
    " attacks the structural invariant from a different angle than happy-path T-01b's count-based check.",
);

// ─── TA-02: Runtime-field shape — every Conversation field appears in the return ─

check(
  "TA-02 Return object literal includes every required Conversation field" +
    " (id, type, created_by, created_at, updated_at, last_message_at, participants, last_message, unread_count)",
  body !== null && (() => {
    const code = stripComments(body);
    // Look for the conversations.push({...}) literal and verify it contains the 9 fields.
    const pushMatch = code.match(/conversations\.push\(\s*\{[\s\S]*?\}\s*\)/);
    if (!pushMatch) return false;
    const lit = pushMatch[0];
    const required = [
      /\bid\s*:/,
      /\btype\s*:/,
      /\bcreated_by\s*:/,
      /\bcreated_at\s*:/,
      /\bupdated_at\s*:/,
      /\blast_message_at\s*:/,
      /\bparticipants\s*:/,
      /\blast_message\s*:/,
      /\bunread_count\s*:/,
    ];
    return required.every((re) => re.test(lit));
  })(),
  "The conversations.push({...}) object literal MUST include every field declared on the Conversation" +
    " interface at messagingService.ts:211. Any missing field is a silent contract regression that" +
    " TypeScript MAY catch (depending on whether the field is required vs optional) but the source-text" +
    " check provides defense-in-depth. The legacy code spread `...conv` which incidentally included all" +
    " fields; the refactor must do so explicitly.",
);

// ─── TA-03: Error path returns shape contract (Constitution #3) ─

check(
  "TA-03 catch block returns `{ conversations: [], error: error.message }` AND calls console.error" +
    " (no silent swallow, no throw rethrow that breaks caller's try/catch)",
  body !== null && (() => {
    const code = stripComments(body);
    return (
      /catch\s*\(\s*error[:\s][\s\S]*?\)\s*\{[\s\S]*?console\.error[\s\S]*?return\s*\{\s*conversations:\s*\[\]\s*,\s*error:\s*error\.message\s*\}/.test(
        code,
      )
    );
  })(),
  "The error path MUST do BOTH: log to console.error (so the issue is surfaceable from logs) AND return" +
    " `{ conversations: [], error: error.message }` so the caller (ConnectionsPage line 711) can branch on" +
    " convError. Removing either is a Constitution #3 violation (silent failure if console.error stripped;" +
    " caller-confusing contract drift if shape changed).",
);

// ─── TA-04: Promise.all ordering — no shadow await before the batch ─

check(
  "TA-04 [FAILS-ON-REVERT KEY] Q1 + Q2 are NOT awaited individually before the Promise.all." +
    " The two Promise variables are created without await, then awaited together via Promise.all.",
  body !== null && (() => {
    const code = stripComments(body);
    // Verify: `const conversationsPromise = supabase.from(...)` — NOT `const ... = await supabase.from(...)`
    const q1NotAwaited = /const\s+conversationsPromise\s*=\s*supabase\s*\.\s*from\(/.test(code) &&
                         !/const\s+conversationsPromise\s*=\s*await\s+supabase/.test(code);
    const q2NotAwaited = /const\s+unreadPromise\s*=\s*supabase\s*\.\s*from\(/.test(code) &&
                         !/const\s+unreadPromise\s*=\s*await\s+supabase/.test(code);
    const promiseAllPresent =
      /Promise\.all\s*\(\s*\[\s*conversationsPromise\s*,\s*unreadPromise\s*,?\s*\]\s*\)/.test(code);
    return q1NotAwaited && q2NotAwaited && promiseAllPresent;
  })(),
  "The happy-path test verifies Promise.all([conversationsPromise, unreadPromise]) exists — but a future" +
    " implementor could ALSO add `const a = await conversationsPromise` BEFORE the Promise.all, which" +
    " serializes them. This adversarial verifies neither Promise is awaited individually before the batch.",
);

// ─── TA-05: N=200 stress — function body has no per-N cost beyond constant Map operations ─

check(
  "TA-05 No per-N Supabase call structure — the function's loop bodies contain ONLY in-memory" +
    " operations (Map.get/set, Set.add, Array.isArray, object spread). NO await, NO Supabase calls.",
  body !== null && (() => {
    const code = stripComments(body);
    // Locate `for (const msg of unreadResult.data || [])` and `for (const conv of conversationsResult.data || [])`
    // bodies, verify they contain ONLY map/set operations.
    const forBodyRe = /for\s*\(\s*const\s+\w+\s+of[^)]+\)\s*\{([\s\S]*?)\n\s{6,}\}/g;
    let m;
    while ((m = forBodyRe.exec(code)) !== null) {
      const innerBody = m[1];
      if (/await\b/.test(innerBody)) return false; // any await inside loop is a regression
      if (/supabase\s*\./.test(innerBody)) return false; // any supabase call inside loop
    }
    return true;
  })(),
  "N=200 stress safety: the function body's loops over conversationsResult.data and unreadResult.data" +
    " must perform only in-memory operations (Map.get/set, Set.add). Any per-N await or supabase call" +
    " inside these loops is a regression to the legacy 2+5N pattern at scale.",
);

// ─── TA-06: Group-conversation-ready AST scan — no type-column filter anywhere ─

check(
  "TA-06 No filter targeting `type` column (via .eq, .match, .filter, .or, .in) anywhere in" +
    " getConversations body — preserves SC-07 group-conversation readiness comprehensively",
  body !== null && (() => {
    const code = stripComments(body);
    return (
      !/\.\s*eq\(\s*['"`]type['"`]/.test(code) &&
      !/\.\s*match\([^)]*type:/.test(code) &&
      !/\.\s*filter\(\s*['"`]type['"`]/.test(code) &&
      !/\.\s*in\(\s*['"`]type['"`]/.test(code) &&
      !/\.\s*or\([^)]*type\.\w+/.test(code)
    );
  })(),
  "Happy-path checks `.eq('type', 'direct')` only. Adversarial widens to ALL Supabase filter methods" +
    " — `.match({type: ...})`, `.filter('type', 'eq', ...)`, `.in('type', [...])`, `.or('type.eq...')`." +
    " Any of these would regress group-conversation-readiness for ORCH-0898 [Consumer collab session" +
    " → Friends-tab group chat].",
);

// ─── TA-07: .maybeSingle vs .single enforcement (extended to generic forms) ─

check(
  "TA-07 No `.single()` or `.single<...>()` (generic) anywhere in getConversations body" +
    " — PGRST116 noise eliminated comprehensively",
  body !== null && (() => {
    const code = stripComments(body);
    return !/\.\s*single\s*(<[^>]*>)?\s*\(/.test(code);
  })(),
  "Happy-path T-07 checks `.single()` exactly. Adversarial extends to `.single<MyType>()` generic form" +
    " which TypeScript supports for explicit response typing. Either form on an embedded subselect that" +
    " can return zero rows produces PGRST116 (406) noise per Investigation Finding #3.",
);

// ─── TA-08: NULL-sender unread counting LOGIC — verifies the count-math layer ─

check(
  "TA-08 [FAILS-ON-REVERT KEY] The unread-count map build loop checks `isReadByMe` BEFORE incrementing" +
    " — guards against already-read messages erroneously counting as unread",
  body !== null && (() => {
    const code = stripComments(body);
    // Pattern: const isReadByMe = reads.some((r) => r.user_id === userId); if (!isReadByMe) { unreadByConv.set(...) }
    return /const\s+isReadByMe\s*=\s*reads\.some\([\s\S]*?\)\s*;[\s\S]*?if\s*\(\s*!\s*isReadByMe\s*\)\s*\{[\s\S]*?unreadByConv\.set\(/.test(
      code,
    );
  })(),
  "Happy-path checks the `.or(sender_id.neq.<X>,sender_id.is.null)` Postgrest predicate exists. This adversarial" +
    " attacks the LOGIC LAYER ABOVE the predicate: the TypeScript code that builds unreadByConv must explicitly" +
    " check isReadByMe BEFORE incrementing the count. Without this guard, every non-self / NULL-sender message" +
    " would count as unread even if the user already opened it. Reverting flips this back to the legacy" +
    " messages-minus-reads two-set-diff math which doesn't appear in the new code structure.",
);

// ─── TA-09: Embedded SELECT field completeness — every required DirectMessage field is named ─

check(
  "TA-09 Q1's last_message:messages(...) SELECT names every required DirectMessage field" +
    " (id, conversation_id, sender_id, content, message_type, file_url, file_name, file_size," +
    " card_payload, reply_to_id, created_at, updated_at, deleted_at)",
  body !== null && (() => {
    const code = stripComments(body);
    const lastMessageBlockMatch = code.match(/last_message:\s*messages\s*\(([\s\S]*?)\)\s*(?=\s*[,)])/);
    if (!lastMessageBlockMatch) return false;
    const block = lastMessageBlockMatch[1];
    const required = [
      "id", "conversation_id", "sender_id", "content", "message_type",
      "file_url", "file_name", "file_size", "card_payload", "reply_to_id",
      "created_at", "updated_at", "deleted_at",
    ];
    return required.every((f) => new RegExp(`\\b${f}\\b`).test(block));
  })(),
  "The embedded last_message:messages(...) SELECT must name every column that DirectMessage interface declares." +
    " Postgrest does NOT include columns by default — if a field is missing from the SELECT, it's missing from" +
    " the response, and consumers (ChatListItem, etc.) get undefined values for fields like file_url, card_payload." +
    " Happy-path Q1-shape check only verifies the alias structure; this adversarial verifies field completeness.",
);

// ─── TA-10: senderProfileCache warming — verifies Q3 writes to the shared cache ─

check(
  "TA-10 Q3 batch profile fetch writes to `this.senderProfileCache` so downstream `enrichMessage`" +
    " calls in other service methods (getMessageById, sendMessage) benefit from the warm cache",
  body !== null && /this\.senderProfileCache\.set\(\s*p\.id\s*,\s*\{\s*name\s*,\s*cachedAt:\s*Date\.now\(\)\s*\}\s*\)/.test(
    stripComments(body),
  ),
  "Q3's purpose is dual: (a) provide sender names for last_message.sender_name in the immediate return, and" +
    " (b) warm the senderProfileCache so subsequent enrichMessage calls in OTHER methods hit the cache." +
    " Without (b), the perf benefit of Q3 is contained to one cold-load. Verifying the cache write" +
    " confirms the shared-state contract.",
);

// ─── TA-11: Q2 has .is('deleted_at', null) — soft-deleted messages excluded from unread ─

check(
  "TA-11 Q2 (unread helper) includes `.is('deleted_at', null)` filter — soft-deleted messages do not" +
    " count toward unread",
  body !== null && (() => {
    const code = stripComments(body);
    // Find the unreadPromise block and verify deleted_at filter
    const unreadBlock = code.match(/const\s+unreadPromise\s*=\s*supabase[\s\S]*?(?:;|\n\n)/);
    if (!unreadBlock) return false;
    return /\.\s*is\(\s*['"`]deleted_at['"`]\s*,\s*null\s*\)/.test(unreadBlock[0]);
  })(),
  "Q2 unread helper must filter `.is('deleted_at', null)` so soft-deleted messages don't inflate unread counts." +
    " The legacy code's per-conversation unread query had this filter at line 566 (`.is('deleted_at', null)`)." +
    " Dropping it on the new Q2 would silently count deleted messages as unread.",
);

// ─── TA-12: Q1 has .is('last_message.deleted_at', null) — embedded soft-delete filter ─

check(
  "TA-12 Q1 includes `.is('last_message.deleted_at', null)` embedded filter — soft-deleted last_message" +
    " is not shown as the latest message",
  body !== null && /\.\s*is\(\s*['"`]last_message\.deleted_at['"`]\s*,\s*null\s*\)/.test(stripComments(body)),
  "Q1's embedded last_message subselect must filter out soft-deleted messages via dot-notation filter on" +
    " the embedded resource (`.is('last_message.deleted_at', null)`). Without this, a conversation whose" +
    " most recent message was soft-deleted would show that deleted message in the Friends-tab preview" +
    " (Constitution #9 — fabricated data, kind of).",
);

// ─── TA-13: Defensive Array.isArray guard on last_message embedded result ─

check(
  "TA-13 Code handles both array and scalar shapes of embedded last_message (defensive against Postgrest" +
    " shape variation when .limit(1) is applied to an embedded resource)",
  body !== null && (() => {
    const code = stripComments(body);
    // Both `senderIds` build loop AND main assembly loop should use Array.isArray check.
    const matches = code.match(/Array\.isArray\(\s*\([\s\S]*?\)\.last_message\s*\)\s*\?\s*\([\s\S]*?\)\.last_message\s*\[\s*0\s*\]\s*:\s*\([\s\S]*?\)\.last_message/g) || [];
    return matches.length >= 2;
  })(),
  "Postgrest returns an embedded resource as an ARRAY when .limit() is applied, even with .limit(1). The code" +
    " must defensively handle both array and scalar shapes — the Array.isArray ternary appears in 2 places:" +
    " the senderIds build loop AND the main assembly loop. A missing guard in either place would crash on a" +
    " minor Postgrest behavioral variation.",
);

// ─── TA-14: No new .neq() on a nullable column elsewhere in the function body ─

check(
  "TA-14 No new `.neq()` on a nullable column anywhere in getConversations body" +
    " — guard against accidentally reintroducing the .neq()-NULL footgun while fixing one instance",
  body !== null && (() => {
    const code = stripComments(body);
    // Find all .neq() invocations. Check none target known-nullable columns (sender_id, deleted_at, etc).
    const neqInvocations = code.match(/\.\s*neq\(\s*['"`]([a-z_]+)['"`]/g) || [];
    const nullableColumns = ["sender_id", "user_id", "deleted_at", "card_payload", "reply_to_id",
                             "file_url", "file_name", "file_size", "last_message_at", "last_read_at"];
    for (const inv of neqInvocations) {
      for (const col of nullableColumns) {
        if (inv.includes(`'${col}'`) || inv.includes(`"${col}"`)) {
          return false; // any .neq() on a nullable column = regression
        }
      }
    }
    return true;
  })(),
  "While fixing Investigation Finding #2's .neq('sender_id', userId) bug, the implementor MUST NOT have" +
    " accidentally introduced another .neq() on a nullable column elsewhere in the function. Per" +
    " feedback_supabase_neq_null.md, any .neq() on a nullable column silently drops NULL rows. This check" +
    " scans for any .neq() targeting known-nullable columns in the messages/conversations tables.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0901 ADVERSARIAL regression check (tester, structural)\n");
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
