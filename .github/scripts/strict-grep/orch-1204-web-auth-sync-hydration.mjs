#!/usr/bin/env node
/**
 * ORCH-1204 — strict-grep gate: the business-web AuthProvider MUST hydrate
 * `session` / `user` / `loading` SYNCHRONOUSLY at mount via lazy useState
 * initializers derived from a single hoisted `readStoredWebSession()` read.
 *
 * WHY: on business.usemingla.com a slow/contended gotrue auth-token lock can make
 * the async getSession() bootstrap exceed the 3s timeout, leaving `loading`
 * permanently true and `isAuthReady` false → `useBrands` disabled → the page wedges
 * on "Loading brands…" (the exact ORCH-1204 bug). The fix paints first-render auth
 * state from the persisted web session synchronously so the brand load never waits
 * on the async lock. The jest regression tests for this DO NOT run in CI (the
 * business jest suite is not a blocking job — only featureFlags.test.ts runs), so a
 * revert of the three initializers back to `useState(null)/useState(null)/useState(true)`
 * would ship undetected. This gate runs on every PR and fails that revert.
 *
 * RULE (structural anti-recurrence) — ALL must hold in
 * mingla-business/src/context/AuthContext.tsx:
 *   1. a single hoisted `const initialStored = readStoredWebSession();` (or an
 *      equivalent `const <name> = readStoredWebSession();`) at the AuthProvider body;
 *   2. the `session` state uses a LAZY initializer deriving from initialStored
 *      (e.g. `useState<Session | null>(() => initialStored)`), NOT `useState(null)`;
 *   3. the `user` state uses a LAZY initializer deriving from `initialStored?.user`
 *      (e.g. `useState<User | null>(() => initialStored?.user ?? null)`),
 *      NOT `useState(null)`;
 *   4. the `loading` state uses a LAZY initializer based on `initialStored === null`
 *      (e.g. `useState<boolean>(() => initialStored === null)`), NOT a bare
 *      `useState(true)`.
 *
 * It FAILS if any of the three reverts to the plain `useState(null)` / `useState(true)`
 * form, or if the hoisted read disappears. Resilient to whitespace/formatting:
 * everything is matched after collapsing runs of whitespace to single spaces.
 *
 * Self-test: `node orch-1204-web-auth-sync-hydration.mjs --self-test`
 * runs positive + negative synthetic fixtures and exits non-zero if the detector
 * is wrong.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGET_REL = "mingla-business/src/context/AuthContext.tsx";

/**
 * Run the detector against a source string.
 * @param {string} src  AuthContext.tsx contents
 * @returns {string[]}  violation messages (empty array = PASS)
 */
function scanSource(src) {
  const violations = [];
  // Collapse all whitespace runs to single spaces so the patterns are immune to
  // line-wrapping / indentation / extra spaces around tokens.
  const flat = src.replace(/\s+/g, " ");

  // 1. Hoisted synchronous read: `const <name> = readStoredWebSession();`.
  //    Capture the binding name so the per-state checks can require derivation
  //    from THIS exact const (not an unrelated identifier).
  const hoistRe = /const\s+(\w+)\s*=\s*readStoredWebSession\s*\(\s*\)\s*;/;
  const hoistMatch = flat.match(hoistRe);
  if (!hoistMatch) {
    violations.push(
      `${TARGET_REL}: missing the hoisted synchronous read ` +
        `\`const initialStored = readStoredWebSession();\` at the AuthProvider body. ` +
        `First-paint auth state must derive from the persisted web session, not the ` +
        `async getSession() bootstrap. DO NOT revert ORCH-1204.`,
    );
    // Without the hoist we cannot verify derivation — but still run the
    // anti-revert checks below so the message set is complete.
  }
  const storedName = hoistMatch ? hoistMatch[1] : "initialStored";
  // Escape nothing — identifiers are \w+ only.

  // 2. session — lazy initializer deriving from <storedName>.
  //    Accept: useState<...>(() => <storedName> ... )  (lazy fn referencing the read)
  //    Reject: useState<...>(null) / useState(null)
  const sessionLazyRe = new RegExp(
    `\\[\\s*session\\s*,[^\\]]*\\]\\s*=\\s*useState\\s*(?:<[^>]*>)?\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*${storedName}\\b`,
  );
  const sessionRevertRe =
    /\[\s*session\s*,[^\]]*\]\s*=\s*useState\s*(?:<[^>]*>)?\s*\(\s*null\s*\)/;
  if (!sessionLazyRe.test(flat)) {
    violations.push(
      `${TARGET_REL}: \`session\` state is NOT a lazy initializer deriving from ` +
        `\`${storedName}\`. Expected ` +
        `\`useState<Session | null>(() => ${storedName})\`. ` +
        (sessionRevertRe.test(flat)
          ? `Found the reverted \`useState(null)\` form — this re-introduces the ORCH-1204 wedge. `
          : ``) +
        `DO NOT revert ORCH-1204.`,
    );
  }

  // 3. user — lazy initializer deriving from <storedName>?.user.
  const userLazyRe = new RegExp(
    `\\[\\s*user\\s*,[^\\]]*\\]\\s*=\\s*useState\\s*(?:<[^>]*>)?\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*${storedName}\\s*\\?\\.\\s*user\\b`,
  );
  const userRevertRe =
    /\[\s*user\s*,[^\]]*\]\s*=\s*useState\s*(?:<[^>]*>)?\s*\(\s*null\s*\)/;
  if (!userLazyRe.test(flat)) {
    violations.push(
      `${TARGET_REL}: \`user\` state is NOT a lazy initializer deriving from ` +
        `\`${storedName}?.user\`. Expected ` +
        `\`useState<User | null>(() => ${storedName}?.user ?? null)\`. ` +
        (userRevertRe.test(flat)
          ? `Found the reverted \`useState(null)\` form — this re-introduces the ORCH-1204 wedge. `
          : ``) +
        `DO NOT revert ORCH-1204.`,
    );
  }

  // 4. loading — lazy initializer based on <storedName> === null.
  const loadingLazyRe = new RegExp(
    `\\[\\s*loading\\s*,[^\\]]*\\]\\s*=\\s*useState\\s*(?:<[^>]*>)?\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*${storedName}\\s*===\\s*null\\b`,
  );
  const loadingRevertRe =
    /\[\s*loading\s*,[^\]]*\]\s*=\s*useState\s*(?:<[^>]*>)?\s*\(\s*true\s*\)/;
  if (!loadingLazyRe.test(flat)) {
    violations.push(
      `${TARGET_REL}: \`loading\` state is NOT a lazy initializer based on ` +
        `\`${storedName} === null\`. Expected ` +
        `\`useState<boolean>(() => ${storedName} === null)\`. ` +
        (loadingRevertRe.test(flat)
          ? `Found the reverted bare \`useState(true)\` form — this re-introduces the ORCH-1204 wedge. `
          : ``) +
        `DO NOT revert ORCH-1204.`,
    );
  }

  return violations;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const COMPLIANT = `
    export function AuthProvider({ children }) {
      const initialStored = readStoredWebSession();
      const [session, setSession] = useState<Session | null>(() => initialStored);
      const [user, setUser] = useState<User | null>(() => initialStored?.user ?? null);
      const [loading, setLoading] = useState<boolean>(() => initialStored === null);
      const [authError, setAuthError] = useState<Error | null>(null);
      return null;
    }
  `;

  // Positive: the real shape must PASS.
  let v = scanSource(COMPLIANT);
  if (v.length !== 0) {
    console.error(
      "ORCH-1204 self-test FAIL: the compliant fixture reported violations:\n" +
        v.join("\n"),
    );
    process.exit(1);
  }

  // Positive (formatting-resilient): wrapped/odd whitespace must still PASS.
  const COMPLIANT_WRAPPED = `
    const initialStored   =   readStoredWebSession( ) ;
    const [ session , setSession ] = useState< Session | null >(
        () =>
          initialStored
    );
    const [user, setUser] = useState<User | null>(() => initialStored ?. user ?? null);
    const [loading, setLoading] = useState<boolean>(
      () => initialStored === null
    );
  `;
  v = scanSource(COMPLIANT_WRAPPED);
  if (v.length !== 0) {
    console.error(
      "ORCH-1204 self-test FAIL: the formatting-resilient compliant fixture reported violations:\n" +
        v.join("\n"),
    );
    process.exit(1);
  }

  // Negative 1: session reverted to useState(null) → must FAIL on session.
  const REVERT_SESSION = COMPLIANT.replace(
    "useState<Session | null>(() => initialStored)",
    "useState<Session | null>(null)",
  );
  v = scanSource(REVERT_SESSION);
  if (!v.some((m) => m.includes("`session`"))) {
    console.error(
      "ORCH-1204 self-test FAIL: a reverted `session` useState(null) did NOT trigger the gate",
    );
    process.exit(1);
  }

  // Negative 2: user reverted to useState(null) → must FAIL on user.
  const REVERT_USER = COMPLIANT.replace(
    "useState<User | null>(() => initialStored?.user ?? null)",
    "useState<User | null>(null)",
  );
  v = scanSource(REVERT_USER);
  if (!v.some((m) => m.includes("`user`"))) {
    console.error(
      "ORCH-1204 self-test FAIL: a reverted `user` useState(null) did NOT trigger the gate",
    );
    process.exit(1);
  }

  // Negative 3: loading reverted to useState(true) → must FAIL on loading.
  const REVERT_LOADING = COMPLIANT.replace(
    "useState<boolean>(() => initialStored === null)",
    "useState(true)",
  );
  v = scanSource(REVERT_LOADING);
  if (!v.some((m) => m.includes("`loading`"))) {
    console.error(
      "ORCH-1204 self-test FAIL: a reverted `loading` useState(true) did NOT trigger the gate",
    );
    process.exit(1);
  }

  // Negative 4: all three reverted (the full ORCH-1204 revert) → must FAIL 3x.
  const REVERT_ALL = COMPLIANT
    .replace(
      "useState<Session | null>(() => initialStored)",
      "useState<Session | null>(null)",
    )
    .replace(
      "useState<User | null>(() => initialStored?.user ?? null)",
      "useState<User | null>(null)",
    )
    .replace(
      "useState<boolean>(() => initialStored === null)",
      "useState(true)",
    );
  v = scanSource(REVERT_ALL);
  if (
    !v.some((m) => m.includes("`session`")) ||
    !v.some((m) => m.includes("`user`")) ||
    !v.some((m) => m.includes("`loading`"))
  ) {
    console.error(
      "ORCH-1204 self-test FAIL: the full revert did not flag all three states:\n" +
        v.join("\n"),
    );
    process.exit(1);
  }

  // Negative 5: hoisted read deleted → must FAIL on the hoist.
  const REVERT_HOIST = COMPLIANT.replace(
    "const initialStored = readStoredWebSession();",
    "",
  );
  v = scanSource(REVERT_HOIST);
  if (!v.some((m) => m.includes("readStoredWebSession"))) {
    console.error(
      "ORCH-1204 self-test FAIL: deleting the hoisted readStoredWebSession() read did NOT trigger the gate",
    );
    process.exit(1);
  }

  console.log(
    "ORCH-1204 gate self-test PASS (2 positive + 5 negative fixtures behaved correctly).",
  );
  process.exit(0);
}

// ---- Live mode
const target = path.join(root, TARGET_REL);
let src;
try {
  src = fs.readFileSync(target, "utf8");
} catch {
  console.error(
    `ORCH-1204 gate FAIL — cannot read ${TARGET_REL}. The business-web ` +
      `AuthProvider is the single owner of synchronous first-paint auth hydration; ` +
      `the file must exist.`,
  );
  process.exit(1);
}

const failures = scanSource(src);
if (failures.length > 0) {
  console.error(
    `ORCH-1204 gate FAIL — the business-web AuthProvider no longer hydrates ` +
      `session/user/loading synchronously at mount:\n\n` +
      failures.join("\n") +
      "\n\n" +
      `The persisted-web-session read must paint first-render auth state so the ` +
      `brand load never waits on the contended async gotrue lock. The jest ` +
      `regression tests for this DO NOT run in CI, so this gate is the only fence. ` +
      `Fix: restore the lazy useState initializers derived from ` +
      `\`const initialStored = readStoredWebSession();\`. See ORCH-1204 ` +
      `(I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION).`,
  );
  process.exit(1);
}

console.log(
  "ORCH-1204 gate PASS — business-web AuthProvider hydrates session/user/loading " +
    "synchronously from readStoredWebSession() at mount.",
);
