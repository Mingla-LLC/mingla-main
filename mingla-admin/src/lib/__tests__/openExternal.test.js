/**
 * ISSUE-903 [window.open one-owner hardening] — happy-path regression test for
 * the mingla-admin openExternal owner (implementor-owned; the tester owns the
 * adversarial suite, a different angle).
 *
 * Proves:
 *   T-1  the owner opens with a BARE (dest, "_blank") — NO noopener/noreferrer
 *        feature string — and severs win.opener on success.
 *   T-2  it falls back to location.assign(dest) ONLY when open() returns null.
 *   T-3  it is an SSR/undefined-window no-op (does not throw, does not open).
 *   T-4  BOTH admin call sites route through the owner (import + call), and
 *        neither re-rolls window.open( inline.
 *
 * Fails-on-revert: re-adding the "noopener,noreferrer" feature string (T-1),
 * moving the fallback out of the else / dropping opener-severance (T-1/T-2),
 * or reverting a call site to inline window.open( (T-4) all break this suite.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openExternal } from "../openExternal.js";

const BANNED = /\bno(?:opener|referrer)\b/i;

function makeWindow({ openReturns }) {
  const record = { openArgs: [], assignArgs: [] };
  const win = openReturns === null ? null : { opener: { hijack: true } };
  const w = {
    open(...args) {
      record.openArgs.push(args);
      return win;
    },
    location: {
      assign(...args) {
        record.assignArgs.push(args);
      },
    },
  };
  return { w, win, record };
}

describe("openExternal (mingla-admin owner)", () => {
  it("T-1 opens a BARE new tab and severs opener on success", () => {
    const { w, win, record } = makeWindow({ openReturns: "truthy" });
    openExternal("https://example.com/x", w);

    assert.equal(record.openArgs.length, 1, "open() called exactly once");
    const [dest, target, ...rest] = record.openArgs[0];
    assert.equal(dest, "https://example.com/x");
    assert.equal(target, "_blank");
    assert.equal(rest.length, 0, "NO feature-string 3rd argument");
    assert.ok(
      !BANNED.test(record.openArgs[0].join(" ")),
      "open() call must not carry noopener/noreferrer",
    );
    assert.equal(win.opener, null, "win.opener severed to null");
    assert.equal(record.assignArgs.length, 0, "location.assign NOT called on success");
  });

  it("T-2 falls back to location.assign ONLY when open() returns null", () => {
    const { w, record } = makeWindow({ openReturns: null });
    openExternal("https://example.com/blocked", w);

    assert.equal(record.openArgs.length, 1, "open() attempted first");
    assert.equal(record.assignArgs.length, 1, "location.assign called exactly once");
    assert.deepEqual(record.assignArgs[0], ["https://example.com/blocked"]);
  });

  it("T-3 is a no-op when the injected window is undefined (SSR-safe)", () => {
    assert.doesNotThrow(() => openExternal("https://example.com/ssr", undefined));
  });

  it("T-4 both admin call sites route through openExternal (import + call, no inline window.open)", () => {
    const sites = {
      AdPreview: fileURLToPath(
        new URL("../../components/campaign-builder/AdPreview.jsx", import.meta.url),
      ),
      CareersPage: fileURLToPath(new URL("../../pages/CareersPage.jsx", import.meta.url)),
    };
    for (const [name, filePath] of Object.entries(sites)) {
      const src = fs.readFileSync(filePath, "utf8");
      assert.match(src, /import\s*\{\s*openExternal\s*\}\s*from\s*["'][^"']*\/openExternal["']/, `${name} imports openExternal`);
      assert.match(src, /openExternal\(/, `${name} calls openExternal(`);
      assert.doesNotMatch(src, /window\.open\(/, `${name} has no inline window.open(`);
    }
  });
});
