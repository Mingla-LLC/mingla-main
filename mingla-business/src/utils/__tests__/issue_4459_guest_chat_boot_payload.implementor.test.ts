/**
 * #4459 — the brand Guest chat stays off the business-web boot payload.
 *
 * WHY. The listing's Group chat route, the brand's Guest chat route and the
 * desktop Messages thread all render GroupChatPanel. Metro hoists a module
 * that two lazy chunks share into `__common`, the chunk every visitor
 * downloads before anything renders: with GroupChatPanel imported statically
 * by two routes, and the Messages inbox importing groupChatService for its
 * Guests list, `__common` grew +24,387 B against a 1,024 B movement limit.
 *
 * WHAT THIS PINS:
 *   - every owner reaches GroupChatPanel through LazyGroupChatPanel (one
 *     dynamic import), never a static import;
 *   - the inbox side (hook, section, screen) reads the Guests list from the
 *     small brandGuestChatList module, never from groupChatService;
 *   - brandGuestChatList and groupChatService never import each other, and
 *     brandGuestChatList's only runtime import is ./supabase.
 *
 * FAILS ON REVERT: import GroupChatPanel statically in either route or the
 * inbox, point the inbox hook or screen back at groupChatService, or make
 * either service import the other, and the matching test fails.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

/** Runtime import specifiers (type-only imports are erased and do not count). */
const runtimeImports = (code: string): string[] => {
  const found: string[] = [];
  const pattern = /^\s*(import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gms;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) found.push(match[2]);
  return found;
};

const staticImportsOf = (code: string, name: string): boolean =>
  runtimeImports(code).some((specifier) => specifier.endsWith(`/${name}`));

describe("#4459 boot payload — GroupChatPanel loads on intent only", () => {
  test.each([
    ["app/event/[id]/group-chat.tsx"],
    ["app/brand/[id]/guest-chat.tsx"],
    // #4420: the Guests side of the brand's one thread (the inbox no longer
    // renders a Guest chat panel of its own).
    ["app/messages/[conversationId].tsx"],
  ])("%s renders the panel through LazyGroupChatPanel", (file) => {
    const code = source(file);
    expect(staticImportsOf(code, "GroupChatPanel")).toBe(false);
    expect(staticImportsOf(code, "LazyGroupChatPanel")).toBe(true);
    expect(code).toMatch(/<LazyGroupChatPanel\s/);
  });

  test("LazyGroupChatPanel reaches the panel only by dynamic import", () => {
    const code = source("src/components/groupChat/LazyGroupChatPanel.tsx");
    expect(staticImportsOf(code, "GroupChatPanel")).toBe(false);
    expect(code).toContain('import("./GroupChatPanel")');
  });
});

describe("#4459 boot payload — the inbox never pulls groupChatService", () => {
  test.each([
    ["src/hooks/useBrandGuestChats.ts"],
    ["src/components/messages/BrandGroupInboxScreen.tsx"],
    ["src/components/messages/BrandGroupInboxList.tsx"],
    ["src/utils/brandMessagesInbox.ts"],
  ])("%s imports no groupChatService at runtime", (file) => {
    expect(staticImportsOf(source(file), "groupChatService")).toBe(false);
  });

  test("brandGuestChatList's only runtime import is ./supabase", () => {
    expect(runtimeImports(source("src/services/brandGuestChatList.ts"))).toEqual(["./supabase"]);
  });

  test("groupChatService does not import brandGuestChatList", () => {
    expect(staticImportsOf(source("src/services/groupChatService.ts"), "brandGuestChatList")).toBe(false);
  });
});
