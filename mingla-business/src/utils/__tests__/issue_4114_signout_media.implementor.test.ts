/**
 * #4114 rework — the host's signed event-chat media links do not survive
 * sign-out (Constitution #6).
 *
 *   * GroupChatSignedUrlCache.clear() also drops a sign that is still running,
 *     so the previous account's link can never land in the cleared cache;
 *   * a module loaded on demand registers its cleanup, and clearAllStores()
 *     (every sign-out path) runs it; one failing cleanup never stops the rest;
 *   * the event chat media component registers its cache clear.
 *
 * fails-on-revert (true line deletion): delete the generation check in
 * GroupChatSignedUrlCache.get → the in-flight case caches the old link; delete
 * `runSignOutCleanups()` from clearAllStores → the sign-out case never clears;
 * delete the registerSignOutCleanup line in GroupChatMessageMedia → the wiring
 * case fails.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { GroupChatSignedUrlCache } from "../groupChatMedia";
import { registerSignOutCleanup, runSignOutCleanups } from "../signOutCleanups";
import { clearAllStores } from "../clearAllStores";

const PATH = "0b8b8f0e-3a5c-4b52-9a0b-6a3a1d2c9e11/7d3c2f2a-1b4e-4c9a-8f6b-2e1d0c9b8a77.jpg";

describe("#4114 host media links on sign-out", () => {
  it("clear() drops a sign that is still in flight", async () => {
    let release: (url: string) => void = () => undefined;
    const cache = new GroupChatSignedUrlCache(
      () => new Promise<string>((resolve) => { release = resolve; }),
      () => 0,
      3600,
    );
    const pending = cache.get(PATH);
    cache.clear();
    release("signed-for-previous-account");
    await expect(pending).rejects.toThrow("signed_url_cache_cleared");
    expect(cache.peek(PATH)).toBeNull();
  });

  it("a sign started after clear() still caches", async () => {
    let calls = 0;
    const cache = new GroupChatSignedUrlCache(async () => `signed-${++calls}`, () => 0, 3600);
    cache.clear();
    await expect(cache.get(PATH)).resolves.toBe("signed-1");
    expect(cache.peek(PATH)).toBe("signed-1");
  });

  it("clearAllStores runs every registered cleanup, even after one fails", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const ran: string[] = [];
    const offA = registerSignOutCleanup(() => {
      ran.push("a");
      throw new Error("boom");
    });
    const offB = registerSignOutCleanup(() => ran.push("b"));
    clearAllStores();
    expect(ran).toEqual(["a", "b"]);
    expect(warn).toHaveBeenCalled();
    offA();
    offB();
    ran.length = 0;
    runSignOutCleanups();
    expect(ran).toEqual([]);
    warn.mockRestore();
  });

  it("the event chat media component registers its link cache clear", () => {
    const source = readFileSync(
      join(__dirname, "../../components/groupChat/GroupChatMessageMedia.tsx"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).toMatch(/registerSignOutCleanup\(\(\) => signedUrls\.clear\(\)\)/);
  });
});
