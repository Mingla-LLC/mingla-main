/**
 * Issue #3429 implementor regression proof.
 *
 * The identity test executes the real reconciliation seam. It fails if new
 * turns regress to text equality because two identical messages with distinct
 * immutable client turn ids collapse into one.
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
import { ariFileType, normalizePickedAriFile } from "../../services/ariAttachmentService";

const SRC = path.resolve(__dirname, "../..");

function message(id: string, text: string, clientTurnId: string): AgentMessage {
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

describe("#3429 one owner and multi-file contract", () => {
  it("keeps same-text turns distinct and replaces exactly the matching optimistic row", () => {
    const firstId = "00000000-0000-4000-8000-000000003429";
    const secondId = "00000000-0000-4000-8000-000000003430";
    const firstLocal = message("local-first", "Plan this", firstId);
    const secondLocal = message("local-second", "Plan this", secondId);
    const firstServer = message("server-first", "Plan this", firstId);

    expect(reconcileAgentDeliveryMessages(
      [firstServer],
      [firstLocal, secondLocal],
      [],
      true,
    )).toEqual([firstServer, secondLocal]);
  });

  it("accepts only the approved image/document types and preserves file context", () => {
    expect([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/csv",
    ].map(ariFileType)).toEqual([
      "image", "image", "image", "image", "image",
      "pdf", "docx", "text", "csv",
    ]);
    expect(ariFileType("image/gif")).toBeNull();
    expect(normalizePickedAriFile({
      uri: "file:///fixture/report.csv",
      name: "report.csv",
      mimeType: null,
      size: 42,
    }, "local-3429")).toMatchObject({
      localId: "local-3429",
      name: "report.csv",
      mimeType: "text/csv",
      fileType: "csv",
      sizeBytes: 42,
      state: "preparing",
    });
  });
});

describe("#3429 approved cross-surface polish remains shared", () => {
  const read = (relative: string): string => fs.readFileSync(path.join(SRC, relative), "utf8");

  it("uses the shared main/Website thread owner, activity, attachment tray, and composer", () => {
    const screen = read("screens/ari/AriChatScreen.tsx");
    expect(screen).toContain('const surface = websiteSplit ? "website" as const : "main" as const');
    expect(screen).toContain("useAgentChat(null, selectedBrandId, persistConversationSelection)");
    expect(screen).toContain("chat.setSurface(surface)");
    expect(screen).toContain("<MessageList");
    expect(screen).toContain("<AriActivity");
    expect(screen).toContain("<AriAttachmentTray");
    expect(screen).toContain("<InputBar");
    expect(screen).toContain("styles.websiteAriPane");
    expect(screen).not.toContain("SAMPLE_PROMPTS");
  });

  it("pins the approved geometry, dark-on-orange contrast, and reduced-motion reveal", () => {
    const design = read("constants/designSystem.ts");
    const reveal = read("components/ari/SemanticRevealText.tsx");
    expect(design).toContain("gapTurn: 16");
    expect(design).toContain("orbGap: 16");
    expect(design).toContain("bubblePadH: 16");
    expect(design).toContain("bubblePadV: 12");
    expect(design).toContain("bubbleRadius: 20");
    expect(design).toContain("bubbleTail: 12");
    expect(design).toContain("bodyFont: 16");
    expect(design).toContain("bodyLine: 24");
    expect(design).toContain("composerMinH: 60");
    expect(design).toContain("controlSize: 44");
    expect(design).toContain("onUserBubble: canvas.depth");
    expect(reveal).toContain("useReducedMotion");
    expect(reveal).toContain("Math.min(1200");
  });

  it("keeps contextual quick replies while removing only screen-level samples", () => {
    expect(read("components/ari/MessageList.tsx")).toContain("<QuickReplyChips");
    const screen = read("screens/ari/AriChatScreen.tsx");
    expect(screen).not.toContain("chips={[");
    expect(screen).not.toContain("Try asking Ari");
  });

  it("ships exact context-limit recovery and truthful activity copy", () => {
    const attachments = read("services/ariAttachmentService.ts");
    const activity = read("components/ari/AriActivity.tsx");
    expect(attachments).toContain(
      "Ari couldn’t use this file because it contains too much information for one message. Remove it and attach a shorter version.",
    );
    for (const copy of [
      "Sending your message…",
      "Ari is reading your attachments…",
      "Ari is thinking…",
      "Ari is checking your workspace…",
      "Ari is working on the approved action…",
      "Ari is retrying…",
      "Ari is finishing up…",
    ]) expect(activity).toContain(copy);
    expect(activity).toContain("15_000");
  });
});
