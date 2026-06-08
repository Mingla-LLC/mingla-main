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
    expect(messageList).toMatch(/lead\.tail === false/);
  });

  it("guards speakerOf against null/undefined items", () => {
    expect(messageList).toMatch(/function speakerOf\(item: ListItem \| null \| undefined\)/);
    expect(messageList).toMatch(/if \(!item\) return null/);
  });
});

describe("ORCH-1101 REWORK · #2 — optimistic user message renders instantly", () => {
  it("builds a crash-safe optimistic AgentMessage (role user, content.text, null tool fields)", () => {
    expect(useAgentChat).toMatch(/function makeOptimisticMessage\(/);
    const block = useAgentChat.slice(
      useAgentChat.indexOf("function makeOptimisticMessage"),
      useAgentChat.indexOf("function makeOptimisticMessage") + 600,
    );
    expect(block).toMatch(/role:\s*["']user["']/);
    expect(block).toMatch(/content:\s*\{\s*text\s*\}/);
    expect(block).toMatch(/tool_calls:\s*null/);
    expect(block).toMatch(/tool_results:\s*null/);
    expect(block).toMatch(/optimistic-/);
  });

  it("inserts the optimistic bubble synchronously in sendMessage, before mutateAsync", () => {
    const sendBlock = useAgentChat.slice(
      useAgentChat.indexOf("const sendMessage = useCallback"),
      useAgentChat.indexOf("const clearPendingAction"),
    );
    // setOptimisticMessages([...]) MUST run before mutateAsync returns.
    expect(sendBlock).toMatch(/setOptimisticMessages\(\(prev\) => \[\.\.\.prev, optimistic\]\)/);
    const insertIdx = sendBlock.indexOf("setOptimisticMessages((prev) => [...prev, optimistic]");
    const mutateIdx = sendBlock.indexOf("mutateAsync");
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(mutateIdx).toBeGreaterThan(insertIdx);
  });

  it("reconciles on success and drops the bubble on error (no stranded placeholder)", () => {
    // onError removes the optimistic id.
    expect(useAgentChat).toMatch(
      /onError[\s\S]{0,400}setOptimisticMessages\(\(prev\) => prev\.filter\(\(m\) => m\.id !== vars\.optimisticId\)\)/,
    );
    // onSuccess awaits the refetch THEN clears (no blink between clear + refetch).
    expect(useAgentChat).toMatch(
      /await qc\.invalidateQueries\(\{ queryKey: agentQueryKeys\.messages\(response\.conversation_id\) \}\)[\s\S]{0,120}setOptimisticMessages/,
    );
  });

  it("merges server + optimistic with a text dedupe so the bubble never doubles", () => {
    expect(useAgentChat).toMatch(/const liveOptimistic = optimisticMessages\.filter/);
    expect(useAgentChat).toMatch(/const mergedMessages: AgentMessage\[\] = \[\.\.\.serverMessages, \.\.\.liveOptimistic\]/);
    expect(useAgentChat).toMatch(/messages: mergedMessages/);
  });
});

describe("ORCH-1101 REWORK · #3 — thinking signal shows while sending", () => {
  it("AriChatScreen passes isThinking while the send mutation is in flight", () => {
    expect(chatScreen).toMatch(/isThinking=\{chat\.isSending && !chat\.pendingAction\}/);
    expect(chatScreen).toMatch(/renderThinking=\{\(\) => <StreamingText visible \/>\}/);
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
    expect(emptyState).toMatch(/Tap /);
    expect(emptyState).toMatch(/ for things to try/);
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
    expect(emptyState).toMatch(/accessibilityLabel="Tap the plus button for things to try"/);
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
