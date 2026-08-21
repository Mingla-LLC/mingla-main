/**
 * Issue #1985 — independent tester guard for the first-send handoff.
 *
 * The store tests prove that an existing UUID survives hydration. This guard
 * covers the different boundary where a deliberate New-conversation null must
 * be replaced by the UUID returned by the first successful server turn. If the
 * hook updates only its local conversation state, reload reopens a blank chat
 * even though the newly created thread exists on the server.
 *
 * APPEND-ONLY tester evidence. Do not fold this into implementor coverage.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(__dirname, relativePath), "utf8");

describe("#1985 tester — first created conversation becomes the durable selection", () => {
  test("the server-created UUID flows through the persistence callback", () => {
    const hook = readSource("../../hooks/useAgentChat.ts");

    const selectionOwner = hook.match(
      /const selectConversation = useCallback\(\(id: string \| null\): void => \{([\s\S]*?)\n  \}, \[onConversationIdChange\]\);/,
    )?.[1];
    expect(selectionOwner).toBeDefined();
    expect(selectionOwner).toMatch(/setConversationId\(id\);/);
    expect(selectionOwner).toMatch(/onConversationIdChange\?\.\(id\);/);

    const successBranch = hook.match(
      /if \(response\.conversation_id !== conversationId\) \{([\s\S]*?)\n      \}/,
    )?.[1];
    expect(successBranch).toBeDefined();
    expect(successBranch).toMatch(
      /selectConversation\(response\.conversation_id\);/,
    );
    expect(successBranch).not.toMatch(/setConversationId\(/);
  });

  test("the screen binds that callback to the current account+brand scope", () => {
    const screen = readSource("../../screens/ari/AriChatScreen.tsx");

    expect(screen).toMatch(
      /const conversationScopeKey = ariConversationScopeKey\(accountId, selectedBrandId\);/,
    );
    expect(screen).toMatch(
      /setStoredConversationSelection\(conversationScopeKey, conversationId\);/,
    );
    expect(screen).toMatch(
      /useAgentChat\(null, selectedBrandId, persistConversationSelection\)/,
    );
  });
});
