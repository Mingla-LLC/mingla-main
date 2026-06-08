import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1101 REWORK — TESTER ADVERSARIAL regression test.
 *
 * Attacks a DIFFERENT angle than the implementor's happy-path rework test
 * (orch_1101_rework_ari_chat_bugs.test.ts). That test asserts the presence of
 * the new strings (makeOptimisticMessage, composerSurface, hintChip,
 * disclosureDismissed, the precomputed-tail separator). It passes the moment
 * those strings exist — it does NOT defend against the SEMANTIC failure modes
 * the rework was supposed to close:
 *
 *   ADV-R1  Optimistic DUPLICATION after server reconcile. The bug-#2 fix is
 *           only safe if the merge DEDUPES (drops the placeholder once the real
 *           server echo lands) AND clears the placeholder ONLY after awaiting
 *           the refetch. A reorder (clear-before-await) or a removed dedupe
 *           reopens the double-bubble / blink. Ordering + predicate attack.
 *   ADV-R2  Thinking bubble that NEVER UNMOUNTS. Bug #3 is only correct if
 *           StreamingText returns null when !visible AND AriChatScreen drives
 *           isThinking false the instant the send settles (isSending false).
 *           A thinking row that lingers after the reply is the inverse defect.
 *   ADV-R3  composerSurface carrying ALPHA. Bug #4's whole point is opacity.
 *           A 6-digit hex is opaque; an 8-digit (#RRGGBBAA) hex, an rgba(), or
 *           an hsla() is NOT. Computed-channel attack — parse the value, prove
 *           it has no alpha, and prove the InputBar host never falls back to a
 *           translucent glass tint anywhere in its style block.
 *   ADV-R4  Disclosure dismissal COUPLED to the network. Bug #6 fails if the
 *           modal's `visible` is driven by the refetched profile rather than
 *           the local flag, or if the ack error is re-swallowed. Source-of-
 *           truth + error-routing attack.
 *   ADV-R5  Optimistic id COLLIDING with a real DB uuid (would make onError
 *           filter remove a real row) — the id must be namespaced.
 *   ADV-R6  Reanimated loop LEAK — the thinking-bubble blink must cancelAnimation
 *           on unmount, else a backgrounded thread keeps a 600ms repeat alive.
 *
 * Harness: ts-jest / testEnvironment:node / source-assertion (the established
 * mingla-business ari pattern; no RN render preset, no jsdom). These assertions
 * therefore attack SOURCE STRUCTURE, ORDERING, and COMPUTED CHANNEL VALUES, not
 * a rendered DOM. The web-DOM opaque-composer render proof is captured in the
 * QA report TEST_ORCH-1101_REWORK §Web leg.
 */

const ARI_DIR = path.resolve(__dirname, "..");
const SCREEN_DIR = path.resolve(__dirname, "../../../screens/ari");
const HOOKS_DIR = path.resolve(__dirname, "../../../hooks");
const CONSTANTS_DIR = path.resolve(__dirname, "../../../constants");

const read = (p: string): string => fs.readFileSync(p, "utf8");

/** Strip block + line comments so structural/ordering assertions ignore prose
 *  in the docblocks (which legitimately mention the old swallowed/translucent
 *  patterns when explaining what was removed). */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const useAgentChat = stripComments(read(path.join(HOOKS_DIR, "useAgentChat.ts")));
const chatScreen = stripComments(read(path.join(SCREEN_DIR, "AriChatScreen.tsx")));
const inputBar = stripComments(read(path.join(ARI_DIR, "InputBar.tsx")));
const streaming = stripComments(read(path.join(ARI_DIR, "StreamingText.tsx")));
const designSystem = read(path.join(CONSTANTS_DIR, "designSystem.ts"));

describe("ORCH-1101 REWORK ADV-R1 · optimistic message cannot duplicate after reconcile", () => {
  it("the merge DEDUPES the placeholder against a matching server user row", () => {
    // The defended invariant: liveOptimistic filters out any optimistic whose
    // text already exists as a server user row, BEFORE the spread. Without this
    // filter, the placeholder + the real echo both render = double bubble.
    const filterIdx = useAgentChat.indexOf("const liveOptimistic = optimisticMessages.filter");
    const mergeIdx = useAgentChat.indexOf("const mergedMessages");
    expect(filterIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeGreaterThan(filterIdx); // filter computed before merge
    const filterBlock = useAgentChat.slice(filterIdx, mergeIdx);
    // The dedupe predicate must key on a server USER row with identical text.
    expect(filterBlock).toMatch(/serverMessages\.some/);
    expect(filterBlock).toMatch(/role === ["']user["']/);
    expect(filterBlock).toMatch(/\.text === /);
  });

  it("onSuccess clears the placeholder ONLY AFTER awaiting the refetch (no blink, no double)", () => {
    const successIdx = useAgentChat.indexOf("onSuccess: async (response, vars)");
    const errorIdx = useAgentChat.indexOf("onError:");
    expect(successIdx).toBeGreaterThan(-1);
    const successBlock = useAgentChat.slice(successIdx, errorIdx);
    const awaitIdx = successBlock.indexOf("await qc.invalidateQueries");
    // the LAST setOptimisticMessages in the success block is the reconcile clear
    const clearIdx = successBlock.lastIndexOf("setOptimisticMessages");
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(awaitIdx); // clear strictly after the await
  });

  it("a server-kind error drops the placeholder so a failed send leaves no stranded bubble", () => {
    const successIdx = useAgentChat.indexOf("onSuccess: async (response, vars)");
    const errorIdx = useAgentChat.indexOf("onError:");
    const successBlock = useAgentChat.slice(successIdx, errorIdx);
    // Inside the `response.kind === "error"` early-return, the placeholder is removed.
    const errKindIdx = successBlock.indexOf('response.kind === "error"');
    expect(errKindIdx).toBeGreaterThan(-1);
    const errKindBlock = successBlock.slice(errKindIdx, errKindIdx + 320);
    expect(errKindBlock).toMatch(/setOptimisticMessages\(\(prev\) => prev\.filter\(\(m\) => m\.id !== vars\.optimisticId\)\)/);
  });
});

describe("ORCH-1101 REWORK ADV-R2 · thinking bubble unmounts the moment the reply arrives", () => {
  it("StreamingText returns null when !visible (no orphaned bubble after reply)", () => {
    expect(streaming).toMatch(/if \(!visible\) return null/);
  });

  it("AriChatScreen drives isThinking false once the send settles (gated on isSending)", () => {
    // isThinking is purely derived from chat.isSending — when the mutation
    // settles isSending flips false, so the thinking row evaporates. It must
    // NOT be a standalone useState that could get stuck true.
    expect(chatScreen).toMatch(/isThinking=\{chat\.isSending && !chat\.pendingAction\}/);
    expect(chatScreen).not.toMatch(/useState[^\n]*[iI]sThinking/);
  });

  it("MessageList appends the thinking row ONLY while isThinking (conditional push)", () => {
    const messageList = stripComments(read(path.join(ARI_DIR, "MessageList.tsx")));
    expect(messageList).toMatch(/if \(isThinking\) items\.push\(\{ kind: "thinking" \}\)/);
  });
});

describe("ORCH-1101 REWORK ADV-R3 · composerSurface has ZERO alpha transparency", () => {
  const tokenLine = designSystem
    .split("\n")
    .find((l) => l.includes("composerSurface:")) as string;

  it("the token is a fully-opaque 6-digit hex — not 8-digit (#RRGGBBAA), rgba, or hsla", () => {
    expect(tokenLine).toBeTruthy();
    const m = tokenLine.match(/composerSurface:\s*["']([^"']+)["']/);
    expect(m).not.toBeNull();
    const val = m![1].trim();
    // Exactly 6 hex digits => no alpha channel. 8-digit hex carries AA.
    expect(val).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(val).not.toMatch(/^#[0-9a-fA-F]{8}$/);
    expect(val).not.toMatch(/rgba|hsla/i);
  });

  it("the InputBar host fill is the opaque token and NEVER a translucent glass tint anywhere in its style", () => {
    const hostBlock = inputBar.slice(inputBar.indexOf("host: {"), inputBar.indexOf("input: {"));
    expect(hostBlock).toMatch(/backgroundColor:\s*ariThread\.composerSurface/);
    // No rgba/hsla literal and no glass.tint.* fill leaked into the composer host.
    expect(hostBlock).not.toMatch(/backgroundColor:\s*["']?(rgba|hsla)/i);
    expect(hostBlock).not.toMatch(/backgroundColor:\s*glass\.tint\./);
  });

  it("the composer host clips overflow so the opaque fill honors the rounded edge (Android policy)", () => {
    const hostBlock = inputBar.slice(inputBar.indexOf("host: {"), inputBar.indexOf("input: {"));
    expect(hostBlock).toMatch(/overflow:\s*["']hidden["']/);
  });
});

describe("ORCH-1101 REWORK ADV-R4 · disclosure dismissal is decoupled from the network", () => {
  it("the modal `visible` is driven by the LOCAL flag, not the refetched profile alone", () => {
    // disclosureNeeded must short-circuit on !disclosureDismissed FIRST, so a
    // slow/failed acknowledge refetch can never keep the sheet open.
    const needIdx = chatScreen.indexOf("const disclosureNeeded =");
    expect(needIdx).toBeGreaterThan(-1);
    const needBlock = chatScreen.slice(needIdx, needIdx + 200);
    expect(needBlock).toMatch(/!disclosureDismissed/);
    // The local flag appears BEFORE the profile timestamp check in the &&-chain.
    const flagPos = needBlock.indexOf("!disclosureDismissed");
    const profPos = needBlock.indexOf("ai_disclosure_acknowledged_at");
    expect(flagPos).toBeGreaterThan(-1);
    expect(profPos).toBeGreaterThan(flagPos);
  });

  it("the acknowledge error is ROUTED to state, not swallowed", () => {
    expect(chatScreen).not.toMatch(/acknowledge\(\)\.catch\(\(\) => undefined\)/);
    const handlerIdx = chatScreen.indexOf("const handleAcceptDisclosure");
    const handler = chatScreen.slice(handlerIdx, handlerIdx + 600);
    // dismiss is synchronous and happens before the async persist
    const dismissPos = handler.indexOf("setDisclosureDismissed(true)");
    const ackPos = handler.indexOf("prefs.acknowledge()");
    expect(dismissPos).toBeGreaterThan(-1);
    expect(ackPos).toBeGreaterThan(dismissPos);
    // the catch surfaces the error via the toast state setter
    expect(handler).toMatch(/\.catch\(\(err: unknown\) =>/);
    expect(handler).toMatch(/setLocalError/);
  });
});

describe("ORCH-1101 REWORK ADV-R5 · optimistic id can never collide with a real DB uuid", () => {
  it("makeOptimisticMessage namespaces the id with an `optimistic-` prefix", () => {
    const fnIdx = useAgentChat.indexOf("function makeOptimisticMessage");
    const fnBlock = useAgentChat.slice(fnIdx, fnIdx + 400);
    // id literal begins with the optimistic- namespace (a uuid never does).
    expect(fnBlock).toMatch(/id:\s*`optimistic-/);
  });

  it("onError removes the placeholder strictly by its namespaced id (never by text)", () => {
    const errIdx = useAgentChat.indexOf("onError:");
    const errBlock = useAgentChat.slice(errIdx, errIdx + 400);
    expect(errBlock).toMatch(/prev\.filter\(\(m\) => m\.id !== vars\.optimisticId\)/);
  });
});

describe("ORCH-1101 REWORK ADV-R6 · the thinking blink never leaks a reanimated loop", () => {
  it("StreamingText cancels its repeat animation on unmount", () => {
    // The cleanup return must cancelAnimation so unmounting the thinking row
    // (reply arrived) doesn't strand a -1 (infinite) withRepeat on the UI thread.
    expect(streaming).toMatch(/return \(\): void => \{[\s\S]{0,80}cancelAnimation\(opacity\)/);
    expect(streaming).toMatch(/withRepeat\(/);
    // and the repeat only arms while visible (not unconditionally on mount)
    expect(streaming).toMatch(/if \(visible && !reduceMotion\)/);
  });
});
