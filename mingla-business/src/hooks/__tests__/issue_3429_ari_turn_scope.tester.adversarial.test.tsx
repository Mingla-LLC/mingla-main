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
    expect(activity).toContain("useReducedMotion()");
    expect(reveal).toContain("accessibilityLabel={`Ari said: ${text}`}");
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
