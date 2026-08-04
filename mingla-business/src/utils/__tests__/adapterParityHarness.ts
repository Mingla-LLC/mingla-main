/**
 * Issue #1556 — test harness that makes the SERVER SMS adapter executable from
 * Jest. NOT a test file (no `.test.` in the name, so jest's testMatch skips it).
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase/functions/_shared/adapters/smsAdapter.ts` is a Deno module:
 * `.ts`-suffixed relative imports and `Deno.env` in its transitive deps. Jest
 * cannot `import` it. But the whole point of #1556 is that the client preview
 * and the server adapter must not drift, and a guard built on a hand-copied
 * corpus of expected outputs is exactly the mirror that drifted in the first
 * place.
 *
 * So this harness READS the adapter source and EXECUTES its shipped function
 * BODIES. Both `composeSmsBody` and `sanitizeGsm7` are pure JS inside their
 * braces — every TypeScript annotation lives in the signature, which is not
 * extracted — so they run verbatim, with their two dependencies injected. The
 * Jest suite therefore drives the REAL server implementation, not a replica.
 *
 * FAIL-LOUD BY DESIGN
 * -------------------
 * Every extraction is vacuity-guarded and THROWS with an explicit message. If
 * the adapter is refactored so the guard or the sanitizer no longer lives inline
 * in those two functions, the importing suite fails loudly and a human
 * re-derives it. It never silently degrades into a test that asserts nothing —
 * an unfalsifiable guard is worse than none, which is the whole lesson of #1556.
 *
 * The authority remains the Deno twin,
 * `supabase/functions/__tests__/issue1556_sms_footer_parity.test.ts`, which
 * imports both real modules natively with no extraction at all.
 */

import { readFileSync } from "fs";
import path from "path";

const REPO_ROOT = path.join(__dirname, "../../../..");

export const ADAPTER_PATH = path.join(
  REPO_ROOT,
  "supabase/functions/_shared/adapters/smsAdapter.ts",
);
export const CORPUS_PATH = path.join(
  REPO_ROOT,
  "supabase/functions/__tests__/fixtures/issue1556_sms_footer_corpus.json",
);

const ADAPTER_SRC = readFileSync(ADAPTER_PATH, "utf8");

export interface CorpusEntry {
  id: string;
  body: string;
  why: string;
  expect?: { clientAppends: boolean; wireLength: number; wireSegments: number };
}

export interface Corpus {
  issue: number;
  footer: string;
  marketingSeparator: string;
  transactionalSeparator: string;
  entries: CorpusEntry[];
}

/** The corpus the Deno twin reads. One file, two runtimes — it cannot drift. */
export const CORPUS: Corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

/**
 * Extract the BODY of a top-level function from the adapter source by
 * brace-matching from its signature. Throws loudly — never returns a silent
 * empty string — so a refactor cannot make the importing suite vacuous.
 */
function extractFunctionBody(name: string): string {
  const sigIdx = ADAPTER_SRC.indexOf(`export function ${name}(`);
  if (sigIdx === -1) {
    throw new Error(
      `#1556 EXTRACTION FAILED: \`export function ${name}(\` is gone from ${ADAPTER_PATH}. ` +
        `The adapter was refactored — re-derive this harness against the new shape. ` +
        `Do NOT delete the assertions it feeds; that is how #1556 happened.`,
    );
  }
  const open = ADAPTER_SRC.indexOf("{", sigIdx);
  if (open === -1) {
    throw new Error(`#1556 EXTRACTION FAILED: no body found for ${name}`);
  }
  let depth = 0;
  for (let i = open; i < ADAPTER_SRC.length; i++) {
    const ch = ADAPTER_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return ADAPTER_SRC.slice(open + 1, i);
    }
  }
  throw new Error(`#1556 EXTRACTION FAILED: unbalanced braces in ${name}`);
}

function extractStopFooter(): string {
  const m = ADAPTER_SRC.match(/const STOP_FOOTER = ("(?:[^"\\]|\\.)*");/);
  if (m === null) {
    throw new Error(
      "#1556 EXTRACTION FAILED: STOP_FOOTER literal not found in smsAdapter.ts",
    );
  }
  return JSON.parse(m[1]) as string;
}

/** The adapter's own STOP footer constant. */
export const SERVER_STOP_FOOTER: string = extractStopFooter();

/** The adapter's SHIPPED GSM-7 sanitizer, executed. */
export const serverSanitizeGsm7 = new Function(
  "input",
  extractFunctionBody("sanitizeGsm7"),
) as (input: string) => string;

const rawCompose = new Function(
  "message",
  "stopFooterOwnLine",
  "STOP_FOOTER",
  "sanitizeGsm7",
  extractFunctionBody("composeSmsBody"),
) as (
  message: string,
  ownLine: boolean,
  footer: string,
  sanitize: (s: string) => string,
) => string;

/** The adapter's SHIPPED wire composer, executed with its deps injected. */
export const serverComposeSmsBody = (
  message: string,
  ownLine = false,
): string => rawCompose(message, ownLine, SERVER_STOP_FOOTER, serverSanitizeGsm7);

/**
 * Did the SERVER append a footer? Derived by RUNNING the adapter and comparing
 * against what it returns when it suppresses (the sanitized trimmed body). No
 * regex is re-stated anywhere in this harness.
 */
export const serverAppends = (body: string, ownLine: boolean): boolean =>
  serverComposeSmsBody(body, ownLine) !== serverSanitizeGsm7(body.trim());
