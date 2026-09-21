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
    // [TEST-MOD-APPROVED #3429] (a) superseded predicate, same invariant: the
    // local row is filtered against the server snapshot BEFORE the spread, so
    // the placeholder and the real echo can never both render. #3429 keys the
    // match on client_turn_id (canonicalIdentityMatch) and keeps text equality
    // only for pre-#3429 rows that have no id — strictly stronger than text.
    const filterIdx = useAgentChat.indexOf("const liveLocalMessages = localMessages.filter");
    const mergeIdx = useAgentChat.indexOf("const messages = [...decoratedServerMessages");
    expect(filterIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeGreaterThan(filterIdx); // filter computed before merge
    const filterBlock = useAgentChat.slice(filterIdx, mergeIdx);
    expect(filterBlock).toMatch(/serverMessages\.some/);
    expect(filterBlock).toMatch(/canonicalIdentityMatch\(server, local\)/);
    // and the identity predicate itself keys on the turn id, with the legacy
    // text path reachable only when an id is missing.
    const identityIdx = useAgentChat.indexOf("function canonicalIdentityMatch");
    const identityBlock = useAgentChat.slice(identityIdx, identityIdx + 700);
    expect(identityBlock).toMatch(/role !== ["']user["']/);
    expect(identityBlock).toMatch(/server\.client_turn_id === local\.client_turn_id/);
    expect(identityBlock).toMatch(/\.text === /);
  });

  it("has no clear-before-refetch window at all (the blink is structurally impossible)", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded: there is no longer a separate
    // "clear the placeholder" state write to order against the refetch. The
    // local row is dropped inside the SAME derivation that reads the server
    // snapshot, so a frame with neither row cannot exist. The stronger form of
    // the original protection is: no state write may remove a local row on
    // success — removal is derived only.
    expect(useAgentChat).not.toMatch(/setOptimisticMessages/);
    const filterIdx = useAgentChat.indexOf("const liveLocalMessages = localMessages.filter");
    expect(filterIdx).toBeGreaterThan(-1);
    expect(useAgentChat.indexOf("const messages = [...decoratedServerMessages")).toBeGreaterThan(filterIdx);
  });

  it("a failed send keeps the row, marked failed, so the message is never lost", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded intent: dropping the bubble on
    // error is now the DEFECT. #3429 keeps the row, marks it failed, attaches
    // the failure sentence and offers Retry ("Your message is safe"), which is
    // what the user-facing copy promises. The stranded-bubble risk the original
    // guarded is covered instead by the dedupe above (a failed row still
    // disappears the moment its server echo lands) and behaviourally by
    // issue_3429_ari_delivery_state.implementor.test.ts.
    expect(useAgentChat).toMatch(/patchTurn\(clientTurnId, \{[\s\S]{0,200}delivery: "failed"/);
    expect(useAgentChat).toMatch(/delivery: "failed",[\s\S]{0,200}errorMessage:/);
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
    // [TEST-MOD-APPROVED #3429] (a) superseded source: the row is driven by
    // the live turn (chat.activeTurn) instead of the mutation flag, which is
    // what makes the callout end with its work (D-1). The invariant this
    // assertion exists for — derived, never a standalone useState that can get
    // stuck true — is unchanged and still pinned.
    expect(chatScreen).toMatch(/isThinking=\{!!chat\.activeTurn\}/);
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
  it("the local row id is namespaced so it can never collide with a DB uuid", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded namespace, same protection:
    // the local row's id is now `local-turn-${clientTurnId}` (a uuid never
    // starts with "local-turn-"), and the row is addressed by clientTurnId.
    expect(useAgentChat).toMatch(/localId: `local-turn-\$\{clientTurnId\}`/);
    expect(useAgentChat).toMatch(/id: turn\.localId/);
  });

  it("a failure is written to the row strictly by id (never by text)", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded: nothing is removed on failure
    // any more, but the addressing protection is the point and it holds — every
    // write to a local row goes through patchTurn(clientTurnId, …), which
    // matches on the turn id and never on message text.
    const fnIdx = useAgentChat.indexOf("const patchTurn = useCallback");
    const fnBlock = useAgentChat.slice(fnIdx, fnIdx + 400);
    expect(fnBlock).toMatch(/turn\.clientTurnId === clientTurnId/);
    expect(fnBlock).not.toMatch(/\.text/);
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
