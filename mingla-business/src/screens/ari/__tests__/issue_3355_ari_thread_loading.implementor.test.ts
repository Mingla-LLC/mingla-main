/**
 * #3355 — selecting an existing conversation must never flash an empty thread.
 * The query already exposes its loading state; the screen owns the visible,
 * motion-aware transition while canonical messages are fetched.
 */

import fs from "fs";
import path from "path";

const screen = fs.readFileSync(
  path.join(__dirname, "../AriChatScreen.tsx"),
  "utf8",
);

describe("#3355 Ari thread loading transition", () => {
  it("shows a labelled thinking orb until the selected thread is ready", () => {
    expect(screen).toContain("chat.conversationId && chat.isLoadingMessages");
    expect(screen).toContain('accessibilityLabel="Opening Ari conversation"');
    expect(screen).toContain('<AriOrb size="md" thinking decorative />');
    expect(screen).toContain("Opening conversation…");
  });

  it("resolves the loading branch before either the empty state or MessageList", () => {
    const loading = screen.indexOf(
      "chat.conversationId && chat.isLoadingMessages",
    );
    const empty = screen.indexOf(") : noMessages ? (");
    const messages = screen.indexOf("<MessageList", empty);
    expect(loading).toBeGreaterThan(-1);
    expect(loading).toBeLessThan(empty);
    expect(empty).toBeLessThan(messages);
  });
});
