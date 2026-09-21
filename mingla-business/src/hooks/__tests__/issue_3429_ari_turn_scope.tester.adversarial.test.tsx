/**
 * #3429 adversarial client seam proof. The real reconciliation export executes
 * the one-owner rule; source assertions pin the hook's dispatch and epoch
 * boundaries without creating a second implementation of them in test code.
 */
import fs from "fs";
import path from "path";
import type { AgentMessage } from "../../services/agentChatService";

jest.mock("@tanstack/react-query", () => ({}));
jest.mock("../../context/AuthContext", () => ({}));
jest.mock("../../services/agentChatService", () => ({}));
jest.mock("../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../components/ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));

import { reconcileAgentDeliveryMessages } from "../useAgentChat";

const hookPath = path.resolve(__dirname, "../useAgentChat.ts");
const inputPath = path.resolve(__dirname, "../../components/ari/InputBar.tsx");
const reliabilityPath = path.resolve(__dirname, "../../services/agentReliability.ts");
const screenPath = path.resolve(__dirname, "../../screens/ari/AriChatScreen.tsx");

function userMessage(id: string, clientTurnId: string, text = "same text"): AgentMessage {
  return {
    id,
    conversation_id: "conversation-3429",
    role: "user",
    content: { text },
    client_turn_id: clientTurnId,
    tool_calls: null,
    tool_results: null,
    created_at: "2026-09-15T12:00:00.000Z",
  };
}

describe("#3429 LocalTurn ownership and scope adversarial seams", () => {
  it("keeps different IDs distinct, replaces only the acknowledged id, and permits exact-id retry", () => {
    const first = "00000000-0000-4000-8000-000000003461";
    const second = "00000000-0000-4000-8000-000000003462";
    const acknowledged = userMessage("server-first", first);
    const result = reconcileAgentDeliveryMessages(
      [acknowledged],
      [userMessage("local-first", first), userMessage("local-second", second)],
      [],
      true,
    );
    expect(result).toEqual([acknowledged, userMessage("local-second", second)]);

    const hook = fs.readFileSync(hookPath, "utf8");
    expect(hook).toContain("interface LocalTurn");
    expect(hook).toContain("current.some((candidate) => candidate.clientTurnId === clientTurnId)");
    expect(hook).toMatch(/return sendTurn\([\s\S]*latest\.attachments, clientTurnId\)/);
    expect(hook).not.toContain("turnPayloads");
  });

  it("keeps edit/discard attachment ownership and clears every old-brand delivery channel before stale work can render", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    expect(hook).toContain("return { text: turn.displayText, attachments: turn.attachments };");
    expect(hook).toContain("turn.attachments.forEach");
    expect(hook).toContain("brandEpoch.current += 1");
    expect(hook).toContain("subscriptions.current.forEach((unsubscribe) => unsubscribe())");
    expect(hook).toContain("sendIntentRef.current = null");
    expect(hook).toContain("turnsRef.current = []");
    expect(hook).toContain("setConversationId(null)");
    expect(hook).toContain("if (turn.epoch !== brandEpoch.current) return response;");
  });

  it("requires each readiness condition while accepting text-only and ready-file-only sends", () => {
    const input = fs.readFileSync(inputPath, "utf8");
    const reliability = fs.readFileSync(reliabilityPath, "utf8");
    const screen = fs.readFileSync(screenPath, "utf8");
    expect(input).toContain("isAriSendReady(text, hasReadyAttachments, disabled, sendDisabled)");
    // [TEST-MOD-APPROVED #3429] A call-expression substring is satisfied whether
    // or not the identifier is bound — the P0 this round fixed. Pin the binding
    // too, so dropping the import fails here instead of at first paint.
    expect(input).toMatch(/import \{[^}]*\bisAriSendReady\b[^}]*\} from /);
    expect(reliability).toMatch(/return \(text\.trim\(\)\.length > 0 \|\| hasReadyAttachments\) && !disabled\s*&&\s*!sendDisabled;/);
    expect(screen).toContain("disabled={brands.isLoading || !conversationSelectionReady}");
    expect(screen).toContain("sendDisabled={chat.isSending || rateLimited || !online || !attachments.allReady}");
    expect(screen).toContain("hasReadyAttachments={attachments.attachments.length > 0 && attachments.allReady}");
  });
});

import ts from "typescript";

/**
 * Comment-immune view of a TS/TSX source. Every leaf token is re-emitted with
 * its original text; the trivia before it (whitespace AND comments, including
 * JSDoc and `{/* JSX *\/}` comments) collapses to one space. String literals and
 * JSX text survive verbatim, so an assertion over this view can only be
 * satisfied by executable code, never by a comment that quotes it.
 */
function executableSource(source: string, fileName: string): string {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let code = "";
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(file);
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    const start = node.getStart(file);
    if (start > node.getFullStart()) code += " ";
    code += source.slice(start, node.getEnd());
  };
  visit(file);
  return code.replace(/\s+/g, " ");
}

const executableFile = (filePath: string): string =>
  executableSource(fs.readFileSync(filePath, "utf8"), filePath);
const snippet = (value: string): string => value.replace(/\s+/g, " ");

describe("#3429 assistive truth and cooperative-stop adversarial seams", () => {
  const activityPath = path.resolve(__dirname, "../../components/ari/AriActivity.tsx");
  const attachmentCardsPath = path.resolve(__dirname, "../../components/ari/AriAttachmentCards.tsx");
  const revealPath = path.resolve(__dirname, "../../components/ari/SemanticRevealText.tsx");

  it("reads executable source only: a comment that quotes a guarded statement never satisfies it", () => {
    const fixture = [
      "// setStopRequested(true); void onStop();",
      "/* accessibilityLabel=\"Remove all attached files\" */",
      "/** Files are saved with this conversation and kept private to your brand workspace. */",
      "const url = \"https://example.invalid/a//b\";",
      "export const Probe = () => <View>{/* useReducedMotion() */}<Text>Keep // this text</Text></View>;",
    ].join("\n");
    const code = executableSource(fixture, "fixture.tsx");

    expect(code).not.toContain("setStopRequested(true); void onStop();");
    expect(code).not.toContain("Remove all attached files");
    expect(code).not.toContain("Files are saved with this conversation");
    expect(code).not.toContain("useReducedMotion()");
    expect(code).toContain("const url = \"https://example.invalid/a//b\";");
    expect(code).toContain("Keep // this text");
  });

  it("keeps animated content readable while never presenting a stop request as a confirmed stop", () => {
    const activity = executableFile(activityPath);
    const reveal = executableFile(revealPath);

    expect(activity).toContain(snippet('accessibilityLabel={stopRequested ? "Stop requested" : turn.accepted ? "Stop Ari" : "Stop sending"}'));
    expect(activity).toContain(snippet("onPress={() => { setStopRequested(true); void onStop(); }}"));
    expect(activity).toMatch(/const terminal = turn\.delivery === "stopped" \|\| turn\.delivery === "failed"/);
    expect(activity).toContain(snippet('if (terminal) { AccessibilityInfo.announceForAccessibility(turn.errorMessage ?? "Ari stopped. Your message is still here.");'));
    // [TEST-MOD-APPROVED #3429] A QUALIFIED call depends on the binding of its
    // ROOT — `AccessibilityInfo`, not `announceForAccessibility`. My first
    // audit keyed on the identifier next to the paren and filed this as
    // "nothing to drop"; it is an import like any other, and dropping it is a
    // crash on the terminal-turn announcement. Pin the binding too.
    expect(activity).toMatch(
      /import[^;]*\{[^}]*\bAccessibilityInfo\b[^}]*\}\s*from\s*"react-native";/,
    );
    expect(activity).toContain("useReducedMotion()");
    // [TEST-MOD-APPROVED #3429] Same reason as above: pin the binding, not just
    // the call text.
    expect(activity).toMatch(
      /import[^;]*\{[^}]*\buseReducedMotion\b[^}]*\}\s*from\s*"react-native-reanimated";/,
    );
    // [TEST-MOD-APPROVED #3429] REWORK-4 N-2: the protection is that the
    // revealing bubble CARRIES a spoken label while its chunks are hidden from
    // assistive technology. Pinning the raw `${text}` form also froze the
    // markdown defect into the contract — a screen reader read "dash" before
    // every bullet on every fresh answer, and this assertion was what stopped
    // it being fixed. Same protection, anchored to the stripped form the
    // renderer's own segments produce.
    // [TEST-MOD-APPROVED #3429] This line used to be the substring match
    // `toContain("accessibilityLabel={\`Ari said: ${toAccessibleText(text)}\`}")`.
    // It proved the TEXT of a call expression existed, not that the call could
    // run. `390f435a0` repointed the segmenter import to the leaf module and
    // dropped `toAccessibleText` from the binding list; this assertion stayed
    // green while the Ari screen threw ReferenceError on every fresh answer,
    // on iOS, Android and web alike. #2113 class, and it cost four rework
    // rounds and a twelve-cell device matrix.
    //
    // The label is now proven by RENDERING the component and reading the
    // resulting accessibility label — see
    // src/components/ari/__tests__/issue_3429_ari_reveal_label.implementor.test.tsx
    // (R-1..R-5), each proven by deleting the binding.
    //
    // What stays here is the source-level half that IS falsifiable: the module
    // must both CALL the helper and BIND it. Deleting either fails this.
    expect(reveal).toContain("${toAccessibleText(text)}");
    expect(reveal).toMatch(
      /import \{[^}]*\btoAccessibleText\b[^}]*\} from "\.\/ariBubbleSegments";/,
    );
    expect(reveal).toContain('importantForAccessibility="no-hide-descendants"');
    expect(reveal).toMatch(/if \(reduced \|\| skipped\) \{[^}]*duration: reduced \? 0 : 80/);
  });

  it("exposes full attachment identity and deterministic failure recovery to assistive technology", () => {
    const cards = executableFile(attachmentCardsPath);

    expect(cards).toContain(snippet("accessibilityLabel={`${attachment.name}, ${attachment.fileType}, ${formatAriFileSize(attachment.sizeBytes)}, ${accessibleState}`}"));
    expect(cards).toContain("accessibilityLabel={`Retry attaching ${attachment.name}`}");
    expect(cards).toContain("accessibilityLabel={`Remove file ${attachment.name}`}");
    expect(cards).toContain('accessibilityLabel="Remove all attached files"');
    expect(cards).toContain("Files are saved with this conversation and kept private to your brand workspace.");
  });
});
