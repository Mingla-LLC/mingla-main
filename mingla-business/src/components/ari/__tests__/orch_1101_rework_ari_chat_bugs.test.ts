import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1101 REWORK — five live-test bug fixes (#2–#6).
 * Implementor regression test, source-assertion style (ts-jest, node env) to
 * match the established orch_1057_* / orch_1101_ari_chat_composer_overhaul
 * pattern. The Ari send path + composer surfaces are static enough that source
 * structure is the truth.
 *
 *   #1 (already fixed, commit 87d6e6cd3) — the FlatList separator must NOT read
 *      the always-undefined `trailingItem`; the group gap is derived from the
 *      precomputed `tail` flag on `leadingItem`. This test ALSO guards #1 so a
 *      future edit can't reintroduce the send-time crash.
 *   #2 — optimistic user message: useAgentChat inserts a placeholder bubble
 *      synchronously on send (makeOptimisticMessage) and reconciles it on the
 *      thread refetch / drops it on error.
 *   #3 — thinking signal: MessageList supports isThinking and AriChatScreen
 *      passes isThinking while the send mutation is in flight.
 *   #4 — opaque composer: InputBar host fills with the solid ariThread
 *      .composerSurface (no rgba/hsla), never the translucent glass tint.
 *   #5 — empty-state hint renders the actual + glyph as an inline chip, not a
 *      literal "+" character in the sentence.
 *   #6 — AiDisclosure CTA dismisses locally on tap (disclosureDismissed),
 *      decoupled from the acknowledge mutation refetch; the error is surfaced,
 *      not swallowed with `.catch(() => undefined)`.
 *
 * fails-on-revert: every assertion targets a string that ONLY exists after the
 * rework (composerSurface fill, makeOptimisticMessage, hintChip, disclosure-
 * Dismissed, the precomputed-tail separator) or that the rework REMOVED (the
 * literal "Tap + for things to try" text, the `.catch(() => undefined)` swallow,
 * the translucent composer host fill). Reverting any touched file flips its
 * assertions red.
 */

const ARI_DIR = path.resolve(__dirname, "..");
const SCREEN_DIR = path.resolve(__dirname, "../../../screens/ari");
const HOOKS_DIR = path.resolve(__dirname, "../../../hooks");
const CONSTANTS_DIR = path.resolve(__dirname, "../../../constants");

const read = (p: string): string => fs.readFileSync(p, "utf8");

const inputBar = read(path.join(ARI_DIR, "InputBar.tsx"));
const emptyState = read(path.join(ARI_DIR, "EmptyState.tsx"));
const messageList = read(path.join(ARI_DIR, "MessageList.tsx"));
const chatScreen = read(path.join(SCREEN_DIR, "AriChatScreen.tsx"));
const useAgentChat = read(path.join(HOOKS_DIR, "useAgentChat.ts"));
const designSystem = read(path.join(CONSTANTS_DIR, "designSystem.ts"));

describe("ORCH-1101 REWORK · #1 guard — separator never reads undefined trailingItem", () => {
  it("derives the group gap from leadingItem.tail, not a trailingItem prop", () => {
    // SectionList's trailingItem is always undefined in a FlatList separator —
    // reading it crashed the thread on send. The fix reads leadingItem + the
    // precomputed `tail === false` flag. The separator must NOT destructure or
    // dereference trailingItem (a passing comment mention is fine).
    // The separator arrow destructures ONLY leadingItem (trailingItem is never a
    // prop it reads); the gap derives from the precomputed tail flag.
    expect(messageList).toMatch(/ItemSeparatorComponent=\{\(\{ leadingItem \}\)/);
    expect(messageList).not.toMatch(/trailingItem\s*[.?]/); // never dereferenced
    expect(messageList).not.toMatch(/\bconst\b[^\n]*trailingItem/); // never aliased into a const
    // [TEST-MOD-APPROVED #2649] — this ONE assertion is amended; :58/:59/:60
    // above are untouched and still binding. It used to read
    // `toMatch(/lead\.tail === false/)`, and the sentence about "the precomputed
    // tail flag" in the comment above is superseded with it.
    //
    // WHY. `tail` means "this row groups with the NEXT one" — a neighbour-
    // relative flag. #2649 inverted the thread, so the item FlatList hands the
    // separator is the row rendered BELOW the gap, and #2649 F-8 MEASURED the
    // old predicate putting every 4pt cluster gap one boundary off. The gap is
    // now stamped on each row during the grouping pass as `gapAbove` and read
    // straight off the row the gap sits above.
    //
    // WHY THIS IS NOT A WEAKENING. The original protected "the separator's gap
    // comes from the grouping pass, not from an ad-hoc read of a prop that is
    // always undefined". This still pins that, on the current predicate. And
    // the thing the original could NOT do is exactly how F-8 nearly shipped:
    // it is a SOURCE pin, and it read correctly the whole time the rendered
    // gaps were wrong. That hole is now closed behaviourally, against rendered
    // separator heights in visual order, by
    //   issue_2649_ari_thread_bottom_anchored.happy.test.tsx        (T-2)
    //   issue_2649_ari_thread_bottom_anchored.adversarial.test.tsx  (T-5)
    // Net coverage is strictly greater than before, which is why this was
    // amended rather than refused.
    //
    // MATCHED ON THE WHOLE RENDER EXPRESSION, NOT THE BARE IDENTIFIER. A
    // `/lead\?\.gapAbove/` pin passes even with the old predicate restored,
    // because MessageList's own comment block explains the union narrowing in
    // those exact words — the audit-regex-matches-comments trap. Verified by
    // reverting the predicate and watching the bare-identifier version stay
    // green; the pair below goes red on that same revert.
    expect(messageList).toMatch(/height: lead\?\.gapAbove \?\? ariThread\.gapTurn/);
    expect(messageList).not.toMatch(/lead\.tail === false/); // superseded predicate stays gone
  });

  it("guards speakerOf against null/undefined items", () => {
    expect(messageList).toMatch(/function speakerOf\(item: ListItem \| null \| undefined\)/);
    expect(messageList).toMatch(/if \(!item\) return null/);
  });
});

describe("ORCH-1101 REWORK · #2 — optimistic user message renders instantly", () => {
  it("builds a crash-safe optimistic AgentMessage (role user, content.text, null tool fields)", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded: the optimistic row is now built
    // by turnMessage(turn) from the conversation-scoped local turn #3429
    // introduced for D-2. The crash-safe shape this assertion protects — role
    // user, a text content field, null tool fields — is unchanged, and the id
    // is still namespaced (see ADV-R5).
    expect(useAgentChat).toMatch(/function turnMessage\(turn: LocalTurn\): AgentMessage/);
    const block = useAgentChat.slice(
      useAgentChat.indexOf("function turnMessage(turn: LocalTurn)"),
      useAgentChat.indexOf("function turnMessage(turn: LocalTurn)") + 900,
    );
    expect(block).toMatch(/role:\s*["']user["']/);
    expect(block).toMatch(/content:\s*\{\s*\n\s*text,/);
    expect(block).toMatch(/tool_calls:\s*null/);
    expect(block).toMatch(/tool_results:\s*null/);
    expect(block).toMatch(/id:\s*turn\.localId/);
    expect(block).toMatch(/client_turn_id:\s*turn\.clientTurnId/);
  });

  // [TEST-MOD-APPROVED #2060] — #2060 moved optimistic insert from sendMessage into sendTurn.
  // [TEST-MOD-APPROVED #3429] (a) superseded: the insert is the local turn
  // itself (replaceTurns) and the request is executeTurn, not a mutateAsync.
  // The ordering this exists for — the bubble exists BEFORE the network call —
  // is pinned exactly as before.
  it("inserts the optimistic bubble synchronously in sendTurn, before the request", () => {
    const sendBlock = useAgentChat.slice(
      useAgentChat.indexOf("const sendTurn = useCallback"),
      useAgentChat.indexOf("const sendMessage = useCallback"),
    );
    // The local turn MUST be in state before the request leaves.
    expect(sendBlock).toMatch(/replaceTurns\(\(current\) =>/);
    const insertIdx = sendBlock.indexOf("replaceTurns((current) =>");
    const requestIdx = sendBlock.indexOf("executeTurn(turn)");
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(requestIdx).toBeGreaterThan(insertIdx);
  });

  it("reconciles on success and marks a failed send, never stranding a bubble", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded on BOTH halves.
    //  - Success: there is no separate "clear" step to order against a refetch
    //    any more. The local row is dropped in the same derivation that reads
    //    the server snapshot (liveLocalMessages), so the blink this guarded is
    //    structurally impossible.
    //  - Error: #3429 deliberately KEEPS the row and marks it failed, with the
    //    failure sentence and a Retry, because the message is not lost ("Your
    //    message is safe"). Dropping it would now be the defect.
    // Behavioural replacement: issue_3429_ari_chat_polish.implementor.test.ts
    // ("keeps same-text turns distinct and replaces exactly the matching
    // optimistic row") and issue_3429_ari_delivery_state.implementor.test.ts.
    expect(useAgentChat).toMatch(/const liveLocalMessages = localMessages\.filter/);
    expect(useAgentChat).toMatch(/patchTurn\(clientTurnId, \{[\s\S]{0,200}delivery: "failed"/);
    expect(useAgentChat).toMatch(/errorMessage:/);
  });

  it("merges server + local turns with an identity dedupe so the bubble never doubles", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded: the dedupe keys on
    // client_turn_id (canonicalIdentityMatch), with text equality kept only as
    // a compatibility path for pre-#3429 rows — strictly stronger than the
    // text-only dedupe this pinned.
    expect(useAgentChat).toMatch(/const localMessages = scopedTurns\.map\(turnMessage\)/);
    expect(useAgentChat).toMatch(
      /const liveLocalMessages = localMessages\.filter\(\(local\) => !serverMessages\.some\(\(server\) => canonicalIdentityMatch\(server, local\)\)\)/,
    );
    expect(useAgentChat).toMatch(/const messages = \[\.\.\.decoratedServerMessages, \.\.\.liveLocalMessages\]/);
  });
});

describe("ORCH-1101 REWORK · #3 — thinking signal shows while sending", () => {
  it("AriChatScreen passes isThinking while a turn is actually in flight", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded: the thinking row is now the
    // truthful activity callout, driven by the live turn rather than by the
    // mutation flag — the point of D-1 (the callout ends with its work). Still
    // derived, never a standalone useState (see ADV-R2).
    expect(chatScreen).toMatch(/isThinking=\{!!chat\.activeTurn\}/);
    expect(chatScreen).toMatch(/renderThinking=\{\(\) => chat\.activeTurn \? \(/);
    expect(chatScreen).toMatch(/<AriActivity/);
  });

  it("MessageList renders the thinking row and StreamingText respects reduced motion", () => {
    expect(messageList).toMatch(/if \(item\.kind === "thinking"\)/);
    const streaming = read(path.join(ARI_DIR, "StreamingText.tsx"));
    expect(streaming).toMatch(/useReducedMotion\(\)/);
    expect(streaming).toMatch(/if \(visible && !reduceMotion\)/);
  });
});

describe("ORCH-1101 REWORK · #4 — composer is OPAQUE, nothing bleeds through", () => {
  it("adds an opaque composerSurface token (solid hex, no rgba/hsla)", () => {
    expect(designSystem).toMatch(/composerSurface:\s*["']#[0-9a-fA-F]{6}["']/);
    const tokenLine = designSystem
      .split("\n")
      .find((l) => l.includes("composerSurface:")) as string;
    expect(tokenLine).not.toMatch(/rgba|hsla/);
  });

  it("InputBar host fills with the opaque surface, NOT the translucent glass tint", () => {
    const hostBlock = inputBar.slice(
      inputBar.indexOf("host: {"),
      inputBar.indexOf("input: {"),
    );
    expect(hostBlock).toMatch(/backgroundColor:\s*ariThread\.composerSurface/);
    expect(hostBlock).not.toMatch(/backgroundColor:\s*glass\.tint\.profileBase/);
    // Border + radius preserved (still reads as a glass-edged field).
    expect(hostBlock).toMatch(/borderColor:\s*glass\.border\.profileBase/);
    expect(hostBlock).toMatch(/borderRadius:\s*radius\.xl/);
  });

  it("keeps the empty-overlay clearance above the resting composer (no underlap)", () => {
    // The hero overlay reserves paddingBottom = inset + nav clearance + 60 so the
    // hint row clears the composer; that clearance math must stay.
    expect(chatScreen).toMatch(/BOTTOM_NAV_CLEARANCE_PX \+\s*60/);
  });
});

describe("ORCH-1101 REWORK · #5 — hint references the actual + button glyph", () => {
  it("renders an inline + chip, not a literal '+' character in the sentence", () => {
    // The old literal copy is gone.
    expect(emptyState).not.toMatch(/Tap \+ for things to try/);
    // The sentence is split around a Plus-glyph chip.
    // [TEST-MOD-APPROVED #3429] (a) superseded copy: the + now opens "Add
    // context", so the split sentence reads "Tap [+] to attach context".
    expect(emptyState).toMatch(/Tap /);
    expect(emptyState).toMatch(/ to attach context/);
    expect(emptyState).toMatch(/<View style=\{styles\.hintChip\}/);
    expect(emptyState).toMatch(/<Plus size=\{13\}/);
  });

  it("styles the chip like the InputBar + button (bordered circle)", () => {
    const chipBlock = emptyState.slice(emptyState.indexOf("hintChip: {"));
    expect(chipBlock).toMatch(/borderRadius:\s*radius\.full/);
    expect(chipBlock).toMatch(/borderWidth:\s*1/);
    expect(chipBlock).toMatch(/borderColor:\s*glass\.border\.profileBase/);
  });

  it("keeps a natural spoken accessibility label for the hint row", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded copy only — the label still
    // speaks the whole sentence naturally, now for the attach affordance.
    expect(emptyState).toMatch(/accessibilityLabel="Tap the plus button to attach context"/);
  });
});

describe("ORCH-1101 REWORK · #6 — disclosure CTA dismisses on tap", () => {
  it("dismisses locally (disclosureDismissed) decoupled from the mutation refetch", () => {
    expect(chatScreen).toMatch(/const \[disclosureDismissed, setDisclosureDismissed\] = useState\(false\)/);
    expect(chatScreen).toMatch(/!disclosureDismissed/);
    const handler = chatScreen.slice(
      chatScreen.indexOf("const handleAcceptDisclosure"),
      chatScreen.indexOf("const handleAcceptDisclosure") + 600,
    );
    expect(handler).toMatch(/setDisclosureDismissed\(true\)/);
    // Dismiss happens before / independent of the async acknowledge.
    expect(handler.indexOf("setDisclosureDismissed(true)")).toBeLessThan(
      handler.indexOf("prefs.acknowledge()"),
    );
  });

  it("surfaces the acknowledge error instead of swallowing it", () => {
    // The old swallow is gone.
    expect(chatScreen).not.toMatch(/acknowledge\(\)\.catch\(\(\) => undefined\)/);
    // The error routes to the toast via setLocalError.
    expect(chatScreen).toMatch(/prefs\.acknowledge\(\)\.catch\(\(err: unknown\) => \{[\s\S]{0,300}setLocalError/);
  });

  it("wires the modal onAccept to the new handler", () => {
    expect(chatScreen).toMatch(/onAccept=\{handleAcceptDisclosure\}/);
  });
});
