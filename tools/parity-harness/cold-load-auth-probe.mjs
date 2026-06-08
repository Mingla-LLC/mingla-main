/**
 * ORCH-1100 Wave 3 — cold-direct-load auth-readiness probe.
 *
 * Reproduces the Wave-2 Residual #1: on a COLD direct load (hard reload /
 * bookmark, session not yet warm) of a deep authed route, the screen briefly
 * renders the SIGNED-OUT state (/account → sign-in landing; /brand/{id} →
 * "Brand not found") before settling into real content.
 *
 * Method:
 *   1. adb reverse (phone -> Mac static server) + adb forward (CDP).
 *   2. Inject the saved Supabase session into localStorage.
 *   3. Throttle network (slow getSession round-trip => exposes the warming
 *      window, the real cold-device condition).
 *   4. HARD navigate to the route (cold GoTrue bootstrap).
 *   5. Poll document.body.innerText every ~120ms from the first frames, record
 *      whether the SIGNED-OUT / NOT-FOUND text EVER appears, and what the
 *      settled (final) text is.
 *   6. Screenshot the EARLY frame (~700ms) + the SETTLED frame.
 *   7. Repeat N times per route.
 *
 * Usage:
 *   node tools/parity-harness/cold-load-auth-probe.mjs \
 *     --device R58R54YV7JT --web-build mingla-business/web-build-w3 \
 *     --session Mingla_Artifacts/reports/orch1100_wave2_verify/session.token.json \
 *     --out Mingla_Artifacts/reports/orch1100_wave3_verify \
 *     --routes "/account,/brand/22a18413-bfbf-4087-9ba7-45f70deba0f3" --runs 3
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
// Node 22 provides a global WebSocket (same as run-parity-baseline.mjs).

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DEVICE = arg("device", "R58R54YV7JT");
const WEB_BUILD = arg("web-build", "mingla-business/web-build-w3");
const SESSION_FILE = arg("session", "");
const OUT_DIR = arg("out", "Mingla_Artifacts/reports/orch1100_wave3_verify");
const ROUTES = arg("routes", "/account").split(",").map((s) => s.trim()).filter(Boolean);
const RUNS = Number(arg("runs", "3"));
const PORT = Number(arg("port", "8099"));
const CDP_PORT = Number(arg("cdp-port", "9222"));
const ADB = process.env.ADB ||
  `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;

function adb(...a) {
  const r = spawnSync(ADB, ["-s", DEVICE, ...a], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json",
};
function startServer() {
  return new Promise((res) => {
    const server = createServer(async (req, rq) => {
      try {
        const p = decodeURIComponent((req.url || "/").split("?")[0]);
        let file = join(WEB_BUILD, p);
        const isFile = existsSync(file) && (await stat(file)).isFile();
        if (!isFile) file = join(WEB_BUILD, "index.html");
        const body = await readFile(file);
        rq.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
        rq.end(body);
      } catch (e) { rq.writeHead(500); rq.end(String(e)); }
    });
    server.listen(PORT, "127.0.0.1", () => res(server));
  });
}

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }
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
        }
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 30000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalExpr = async (cdp, expression) => {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, timeout: 8000 });
  return r?.result?.value;
};
const listTargets = async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const BASE = () => `http://127.0.0.1:${PORT}`;

// What counts as a SIGNED-OUT / NOT-FOUND flash on each route.
function detectSignedOut(text) {
  const t = (text || "").toLowerCase();
  return {
    signInLanding:
      t.includes("continue with apple") ||
      t.includes("continue with google") ||
      t.includes("sign in to open") ||
      t.includes("list experiences, reach guests"),
    notFound: t.includes("brand not found"),
    loading:
      t.includes("loading your brands") ||
      t.includes("loading brand") ||
      // ActivityIndicator renders no text; treat near-empty body as a spinner
      t.replace(/\s+/g, "").length < 40,
    realContent:
      t.includes("your brands") && !t.includes("loading your brands")
        ? true
        : t.includes("we are a brand") || t.includes("edit profile") || t.includes("sign out everywhere") ||
          t.includes("operations") || t.includes("view public"),
  };
}

async function coldProbe(cdp, route, sessionJson, runIdx) {
  const url = `${BASE()}${route}`;
  // 1. wipe localStorage, then inject the saved session (cold but authed).
  await evalExpr(cdp, "(()=>{try{localStorage.clear();}catch(e){}return true;})()");
  const enc = Buffer.from(sessionJson).toString("base64");
  await evalExpr(cdp, `(()=>{try{const o=JSON.parse(decodeURIComponent(escape(atob("${enc}"))));for(const k in o){localStorage.setItem(k,o[k]);}return Object.keys(o).length;}catch(e){return String(e);}})()`);
  // 2. throttle network to slow the getSession round-trip (expose warming window).
  //    Light throttle: enough to surface the cold warming frames, light enough
  //    that the bundle settles and screenshots/evals don't time out.
  await cdp.send("Network.enable").catch(() => {});
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 200, downloadThroughput: 1.5 * 1024 * 1024, uploadThroughput: 1.5 * 1024 * 1024,
  }).catch(() => {});
  // 3. HARD navigate (cold bootstrap).
  const t0 = Date.now();
  await cdp.send("Page.navigate", { url });

  // 4. poll the body text from the first frames.
  const frames = [];
  let sawSignedOut = false, sawNotFound = false, sawLoading = false, settledReal = false;
  let earlyShotTaken = false, earlyShot = null;
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    await sleep(120);
    let text = "";
    try { text = (await evalExpr(cdp, "document.body ? document.body.innerText.slice(0,1200) : ''")) || ""; } catch {}
    const d = detectSignedOut(text);
    const ms = Date.now() - t0;
    frames.push({ ms, signInLanding: d.signInLanding, notFound: d.notFound, loading: d.loading, realContent: d.realContent });
    if (d.signInLanding) sawSignedOut = true;
    if (d.notFound) sawNotFound = true;
    if (d.loading) sawLoading = true;
    if (d.realContent) settledReal = true;
    // capture an EARLY frame screenshot ~700ms in (where the flash used to be).
    if (!earlyShotTaken && ms >= 650) {
      earlyShotTaken = true;
      try {
        const r = await cdp.send("Page.captureScreenshot", { format: "png" });
        if (r?.data) {
          earlyShot = `${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}_run${runIdx}_early.png`;
          await writeFile(join(OUT_DIR, earlyShot), Buffer.from(r.data, "base64"));
        }
      } catch {}
    }
    if (settledReal) break;
  }
  // settled screenshot
  let settledShot = null;
  try {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (r?.data) {
      settledShot = `${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}_run${runIdx}_settled.png`;
      await writeFile(join(OUT_DIR, settledShot), Buffer.from(r.data, "base64"));
    }
  } catch {}
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});

  return { route, run: runIdx, sawSignedOut, sawNotFound, sawLoading, settledReal, frames, earlyShot, settledShot };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  if (!SESSION_FILE || !existsSync(SESSION_FILE)) { console.error("[probe] need --session <session.token.json>"); process.exit(2); }
  const sessionJson = await readFile(SESSION_FILE, "utf8");
  if (!sessionJson.includes("access_token")) { console.error("[probe] session has no access_token"); process.exit(2); }

  adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`);
  adb("forward", `tcp:${CDP_PORT}`, "localabstract:chrome_devtools_remote");
  const server = await startServer();
  console.log(`[probe] static server 127.0.0.1:${PORT} -> ${WEB_BUILD}`);

  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) { console.error("[probe] no page target — open Chrome on the phone."); process.exit(2); }
  const wsUrl = page.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${CDP_PORT}`);
  const cdp = new CDP(wsUrl);
  await cdp.connect();
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");

  const results = [];
  for (const route of ROUTES) {
    for (let run = 1; run <= RUNS; run++) {
      process.stdout.write(`[probe] ${route} run ${run}/${RUNS} ... `);
      let r;
      try { r = await coldProbe(cdp, route, sessionJson, run); }
      catch (e) { r = { route, run, error: String(e).slice(0, 200) }; }
      results.push(r);
      const verdict = r.error ? `ERROR ${r.error}`
        : `signedOutFlash=${r.sawSignedOut || r.sawNotFound} sawLoading=${r.sawLoading} settledReal=${r.settledReal}`;
      console.log(verdict);
      await writeFile(join(OUT_DIR, "coldload.results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), device: DEVICE, webBuild: WEB_BUILD, results }, null, 2));
    }
  }

  cdp.close(); server.close();
  adb("reverse", "--remove", `tcp:${PORT}`);
  adb("forward", "--remove", `tcp:${CDP_PORT}`);
  console.log(`[probe] done. results + screenshots in ${OUT_DIR}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
