#!/usr/bin/env node
/**
 * ORCH-1100 — Business-web parity baseline harness (CDP driver).
 *
 * Purpose: with the mobile-web route firewall TEMPORARILY BYPASSED (web export
 * built with EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS=1), navigate a real phone
 * Chrome to EVERY business route signed-in and record the TRUE per-route state:
 * boots / firewall-stub / error-boundary / renderer-crash, console errors, peak
 * JS heap, and a screenshot. This is the verification engine the parity sweep
 * depends on. DIAGNOSTIC ONLY — nothing here is shipped.
 *
 * Mechanism (proven by the ORCH-1093/1098 device-runtime work):
 *   1. A local Node static server serves web-build/ with SPA fallback.
 *   2. adb reverse  tcp:<port> tcp:<port>     -> phone reaches the server.
 *   3. adb forward  tcp:9222 localabstract:chrome_devtools_remote -> CDP on Mac.
 *   4. Drive the phone's Chrome tab over the DevTools websocket (native WS).
 *   5. Sign in ONCE; persist the session via localStorage round-trip; then
 *      navigate route-by-route, classify, screenshot.
 *
 * Usage:
 *   node tools/parity-harness/run-parity-baseline.mjs \
 *     --device R58R54YV7JT \
 *     --web-build mingla-business/web-build \
 *     --out Mingla_Artifacts/reports/orch1100_baseline \
 *     [--email sethogieva@gmail.com] [--limit N] [--only /route,/route]
 *
 * Auth: this harness does NOT type passwords. It expects you to sign in once in
 * the phone Chrome tab (the harness pauses and waits until a Supabase
 * sb-*-auth-token with an access_token is present in localStorage), then it
 * captures that token and re-injects it before every navigation so each route
 * loads already-authenticated even after a renderer crash recycles the tab.
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");

// ---- args -----------------------------------------------------------------
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const DEVICE = arg("device", "R58R54YV7JT");
const WEB_BUILD = resolve(REPO, arg("web-build", "mingla-business/web-build"));
const OUT_DIR = resolve(REPO, arg("out", "Mingla_Artifacts/reports/orch1100_baseline"));
const PORT = Number(arg("port", "56815"));
const CDP_PORT = Number(arg("cdp-port", "9222"));
const LIMIT = Number(arg("limit", "0")) || Infinity;
const ONLY = (arg("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const NAV_WAIT_MS = Number(arg("nav-wait", "6500"));
const MANIFEST = resolve(__dirname, arg("manifest", "routes.manifest.json"));

const ADB = process.env.ADB_PATH ||
  `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;

function adb(...a) {
  const r = spawnSync(ADB, ["-s", DEVICE, ...a], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

// ---- tiny static server with SPA fallback ---------------------------------
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json",
};
function startServer() {
  return new Promise((res) => {
    const server = createServer(async (req, rq) => {
      try {
        let p = decodeURIComponent((req.url || "/").split("?")[0]);
        let file = join(WEB_BUILD, p);
        let isFile = existsSync(file) && (await stat(file)).isFile();
        if (!isFile) file = join(WEB_BUILD, "index.html"); // SPA fallback
        const body = await readFile(file);
        rq.writeHead(200, {
          "content-type": MIME[extname(file)] || "application/octet-stream",
          "cache-control": "no-store",
        });
        rq.end(body);
      } catch (e) {
        rq.writeHead(500); rq.end(String(e));
      }
    });
    server.listen(PORT, "127.0.0.1", () => res(server));
  });
}

// ---- CDP client (one websocket, id-matched request/response) ---------------
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.listeners = [];
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error("CDP ws error: " + (e.message || "open failed")));
      this.ws.onmessage = (m) => {
        let msg; try { msg = JSON.parse(m.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        } else if (msg.method) {
          for (const l of this.listeners) l(msg);
        }
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 30000);
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

async function listTargets() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return await r.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- classification --------------------------------------------------------
function classify({ crashed, oom, consoleErrors, bodyText, html, heapMB }) {
  const errs = consoleErrors.join("\n").toLowerCase();
  const text = (bodyText || "").toLowerCase();

  // Firewall stub (should NOT appear now that bypass is on; if it does, flag it)
  const isStub =
    text.includes("keeping you on the stable home") ||
    text.includes("route has not been promoted") ||
    text.includes("staying protected") ||
    text.includes("return to home launcher");

  if (crashed || oom) {
    if (oom || /ineffective mark-compacts|out of memory|allocation failed/.test(errs)) {
      return { status: "CRASH", failureClass: "reanimated-loop" };
    }
    // distinguish reanimated-gesture crash
    if (/useevent|gesturedetector|reanimated|react-native-gesture/.test(errs)) {
      return { status: "CRASH", failureClass: "reanimated-gesture" };
    }
    if (/expo-camera|imagepicker|expo-image-picker|maps|barcode|camera/.test(errs)) {
      return { status: "CRASH", failureClass: "native-module" };
    }
    return { status: "CRASH", failureClass: "other" };
  }

  if (isStub) return { status: "STUB", failureClass: "firewall-stub" };

  // Error boundary
  const isErrorBoundary =
    text.includes("something went wrong") ||
    text.includes("we hit a snag") ||
    text.includes("unexpected error") ||
    text.includes("try again");
  if (isErrorBoundary) {
    let fc = "other";
    if (/useevent|gesturedetector|reanimated/.test(errs)) fc = "reanimated-gesture";
    else if (/#300|#310|#185|minified react error/.test(errs)) fc = "hydration/auth";
    else if (/expo-camera|imagepicker|camera|maps/.test(errs)) fc = "native-module";
    return { status: "ERROR_BOUNDARY", failureClass: fc };
  }

  // Booted but with console errors worth flagging
  let warn = null;
  if (/useevent|gesturedetector|reanimated/.test(errs)) warn = "reanimated-gesture";
  else if (/#300|#310|#185/.test(errs)) warn = "hydration/auth";
  else if (/alert is not|not implemented|noop|no-op/.test(errs)) warn = "dead-handler";
  else if (consoleErrors.length > 0) warn = "other";

  return { status: "BOOTS", failureClass: warn };
}

// ---- per-route navigation --------------------------------------------------
async function evalExpr(cdp, expression, awaitPromise = false) {
  const r = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise, timeout: 8000,
  });
  return r?.result?.value;
}

async function captureSession(cdp) {
  return await evalExpr(cdp, `(()=>{const o={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^sb-.+-auth-token$/.test(k)){o[k]=localStorage.getItem(k);}}return JSON.stringify(o);})()`);
}
async function restoreSession(cdp, sessionJson) {
  if (!sessionJson || sessionJson === "{}") return;
  const enc = Buffer.from(sessionJson).toString("base64");
  await evalExpr(cdp, `(()=>{try{const o=JSON.parse(decodeURIComponent(escape(atob("${enc}"))));for(const k in o){localStorage.setItem(k,o[k]);}return true;}catch(e){return String(e);}})()`);
}

const BASE = () => `http://127.0.0.1:${PORT}`;

async function probeRoute(getCdp, route, sessionJson, outDir, idx, total) {
  const url = `${BASE()}${route.pathname}`;
  const consoleErrors = [];
  let crashed = false, oom = false;
  let cdp = await getCdp();

  const onMsg = (m) => {
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      consoleErrors.push(d?.exception?.description || d?.text || "exception");
    }
    if (m.method === "Log.entryAdded") {
      const e = m.params.entry;
      if (e.level === "error") consoleErrors.push(e.text);
      if (/ineffective mark-compacts|out of memory/i.test(e.text)) oom = true;
    }
    if (m.method === "Inspector.targetCrashed") { crashed = true; }
  };
  cdp.on(onMsg);

  // Re-inject the session so the route loads authenticated even after a crash.
  try { await restoreSession(cdp, sessionJson); } catch {}

  let heapMB = null, bodyText = "", html = "";
  try {
    await cdp.send("Page.navigate", { url });
    await sleep(NAV_WAIT_MS);
    // heap
    try {
      const h = await cdp.send("Runtime.getHeapUsage");
      if (h?.usedSize) heapMB = +(h.usedSize / 1048576).toFixed(1);
    } catch {}
    bodyText = (await evalExpr(cdp, "document.body ? document.body.innerText.slice(0,4000) : ''")) || "";
    html = (await evalExpr(cdp, "document.getElementById('root') ? document.getElementById('root').innerHTML.length : 0")) || 0;
  } catch (e) {
    // navigate/eval failing after a crash is itself a signal
    const t = await listTargets().catch(() => []);
    const target = t.find((x) => x.type === "page");
    if (!target || /crash/i.test(String(e))) crashed = true;
    consoleErrors.push("nav/eval failed: " + String(e).slice(0, 200));
  }

  // screenshot
  let shot = null;
  try {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (r?.data) {
      shot = `${String(idx).padStart(3, "0")}_${route.pathname.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}.png`;
      await writeFile(join(outDir, shot), Buffer.from(r.data, "base64"));
    }
  } catch (e) {
    consoleErrors.push("screenshot failed: " + String(e).slice(0, 120));
  }

  const cls = classify({ crashed, oom, consoleErrors, bodyText, html, heapMB });
  cdp.listeners = cdp.listeners.filter((l) => l !== onMsg);

  return {
    pathname: route.pathname,
    sourceFile: route.sourceFile,
    dynamic: route.dynamic,
    status: cls.status,
    failureClass: cls.failureClass,
    heapMB,
    rootHtmlLen: html,
    bodyHead: (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 240),
    consoleErrors: consoleErrors.slice(0, 8),
    screenshot: shot,
    crashed,
    oom,
  };
}

// ---- main ------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  let routes = manifest.routes;
  if (ONLY.length) routes = routes.filter((r) => ONLY.includes(r.pathname));
  routes = routes.slice(0, LIMIT);

  console.log(`[harness] ${routes.length} routes; device ${DEVICE}; port ${PORT}; cdp ${CDP_PORT}`);

  // adb wiring
  adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`);
  adb("forward", `tcp:${CDP_PORT}`, "localabstract:chrome_devtools_remote");
  const server = await startServer();
  console.log(`[harness] static server on 127.0.0.1:${PORT} -> web-build`);

  // find the page target
  let targets = await listTargets();
  let page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) {
    console.error("[harness] no page target. Open Chrome on the phone first.");
    process.exit(2);
  }
  // make sure CDP url points at localhost forwarded port
  const wsUrl = page.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${CDP_PORT}`);

  let cdp = new CDP(wsUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Inspector.enable").catch(() => {});

  // getCdp re-establishes the connection if the renderer crashes the tab.
  const getCdp = async () => {
    try { await cdp.send("Runtime.evaluate", { expression: "1", returnByValue: true, timeout: 3000 }); return cdp; }
    catch {
      console.log("[harness] reconnecting CDP (tab recycled)...");
      try { cdp.close(); } catch {}
      await sleep(1500);
      const ts = await listTargets();
      const pg = ts.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const u = pg.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${CDP_PORT}`);
      cdp = new CDP(u);
      await cdp.connect();
      await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
      await cdp.send("Log.enable"); await cdp.send("Inspector.enable").catch(() => {});
      return cdp;
    }
  };

  // Sign-in gate: navigate to /auth, then wait for the operator to sign in.
  await cdp.send("Page.navigate", { url: `${BASE()}/auth` });
  await sleep(4000);
  let session = await captureSession(cdp);
  if (!session || session === "{}" || !session.includes("access_token")) {
    console.log("\n========================================================");
    console.log("[harness] NOT SIGNED IN. On the phone Chrome tab now showing");
    console.log("          the Mingla Business sign-in, sign in as the operator");
    console.log("          (sethogieva@gmail.com). The harness will poll for a");
    console.log("          Supabase session and continue automatically.");
    console.log("========================================================\n");
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(5000);
      session = await captureSession(await getCdp()).catch(() => "{}");
      if (session && session.includes("access_token")) { console.log("[harness] session captured."); break; }
      process.stdout.write(".");
    }
  }
  if (!session || !session.includes("access_token")) {
    console.error("\n[harness] no session after wait. Persisting empty; routes will be probed unauthenticated.");
  } else {
    await writeFile(join(OUT_DIR, "session.token.json"), session);
    console.log("[harness] session persisted to session.token.json");
  }

  const results = [];
  let i = 0;
  for (const route of routes) {
    i++;
    process.stdout.write(`[${i}/${routes.length}] ${route.pathname} ... `);
    let r;
    try {
      r = await probeRoute(getCdp, route, session, OUT_DIR, i, routes.length);
    } catch (e) {
      r = { pathname: route.pathname, sourceFile: route.sourceFile, status: "UNREACHED",
        failureClass: "harness-error", heapMB: null, consoleErrors: [String(e).slice(0, 200)],
        screenshot: null };
      // try to recover the connection for the next route
      try { await getCdp(); } catch {}
    }
    results.push(r);
    console.log(`${r.status}${r.failureClass ? " (" + r.failureClass + ")" : ""}${r.heapMB ? " " + r.heapMB + "MB" : ""}`);
    await writeFile(join(OUT_DIR, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), device: DEVICE, results }, null, 2));
  }

  cdp.close();
  server.close();
  adb("reverse", "--remove", `tcp:${PORT}`);
  adb("forward", "--remove", `tcp:${CDP_PORT}`);
  console.log(`\n[harness] done. ${results.length} routes. results.json + screenshots in ${OUT_DIR}`);
  console.log("[harness] adb reverse/forward torn down.");
}

main().catch((e) => { console.error(e); process.exit(1); });
