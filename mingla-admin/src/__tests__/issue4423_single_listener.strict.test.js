// MINGLA-INVARIANT: I-ADMIN-SINGLE-PAGE-RETURN-LISTENER | issue #4423 | Only mingla-admin/src/lib/pageReturn.js adds focus, visibilitychange or online listeners; every other admin refresh subscribes to its shared, throttled page-return signal.
// Issue #4423 (W1.1, W1.6) — strict gate.
// @invariant I-ADMIN-SINGLE-PAGE-RETURN-LISTENER: only mingla-admin/src/lib/pageReturn.js
// adds window `focus` / `online` / `offline` or document `visibilitychange`
// listeners (or assigns onfocus / ononline / onvisibilitychange). Everything
// else subscribes to it: subscribePageReturn to refetch (throttled, at most
// once per 20 s per tab), subscribeVisibility / subscribeConnectivity only
// for timers and indicators that make no request.
//
// Exceptions: none. (The online indicators that read navigator.onLine for
// display use subscribeConnectivity, so they need no exception.)
//
// FAILS-ON-REVERT: add `window.addEventListener("focus", refresh)` to any hook
// (for example back into hooks/useOpsWork.js) and this goes red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const OWNER = "lib/pageReturn.js";
const EXCEPTIONS = new Map([
  // [path, reason] — keep empty unless a listener makes no request and cannot use pageReturn.
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const LISTENER = /addEventListener\(\s*["'`](focus|visibilitychange|online|offline)["'`]/g;
const HANDLER = /\.\s*on(focus|visibilitychange|online|offline)\s*=/g;

describe("#4423 I-ADMIN-SINGLE-PAGE-RETURN-LISTENER", () => {
  const files = walk(SRC);

  it("scans the whole of mingla-admin/src", () => {
    assert.ok(files.length > 200, `${files.length} files`);
    assert.ok(files.some((f) => relative(SRC, f) === OWNER));
  });

  it("only lib/pageReturn.js listens to focus, visibilitychange, online or offline", () => {
    const offenders = [];
    for (const file of files) {
      const rel = relative(SRC, file).split("\\").join("/");
      if (rel === OWNER || EXCEPTIONS.has(rel)) continue;
      const code = strip(readFileSync(file, "utf8"));
      for (const m of code.matchAll(LISTENER)) offenders.push(`${rel}: addEventListener("${m[1]}")`);
      for (const m of code.matchAll(HANDLER)) offenders.push(`${rel}: on${m[1]} =`);
    }
    assert.deepEqual(offenders, []);
  });

  it("the owner installs exactly one listener per event", () => {
    const code = strip(readFileSync(join(SRC, OWNER), "utf8"));
    const events = [...code.matchAll(LISTENER)].map((m) => m[1]).sort();
    assert.deepEqual(events, ["focus", "offline", "online", "visibilitychange"]);
  });

  it("the gate itself catches a listener added back (self-check of the patterns)", () => {
    for (const bad of [
      'window.addEventListener("focus", refresh);',
      "document.addEventListener('visibilitychange', onVisible)",
      "window.addEventListener(`online`, onOnline, { once: true })",
      "window.onfocus = () => run();",
    ]) {
      assert.ok(LISTENER.test(bad) || HANDLER.test(bad), bad);
      LISTENER.lastIndex = 0;
      HANDLER.lastIndex = 0;
    }
  });

  it("every file that used to listen now uses the shared signal (behaviour moved, not dropped)", () => {
    const moved = [
      "context/AuthContext.jsx",
      "hooks/useOpsWork.js",
      "hooks/useDraftCounts.js",
      "hooks/useMessages.js",
      "hooks/useAgentKeys.js",
      "hooks/useDrafts.js",
      "hooks/useCrmPipeline.js",
      "hooks/useContentCalendar.js",
      "hooks/useLiveCityRuns.js",
      "hooks/useCrmSummary.js",
      "hooks/useActiveRunsPoller.js",
      "hooks/useAgentGuide.js",
      "pages/AgentPage.jsx",
      "components/AdConnectionsPanel.jsx",
      "components/AppIdentityReadinessPanel.jsx",
      "components/app-readiness/AppDownloadReadinessPanel.jsx",
      "components/community/BrandGroupsPanel.jsx",
    ];
    for (const rel of moved) {
      const code = readFileSync(join(SRC, rel), "utf8");
      assert.match(code, /from "(\.\.\/)+lib\/pageReturn"/, rel);
      assert.match(code, /subscribePageReturn|subscribeVisibility|subscribeConnectivity|createPoller\(/, rel);
    }
  });
});
