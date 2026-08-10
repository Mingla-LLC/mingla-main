#!/usr/bin/env node

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const ENTRY_NAME = "accept-brand-invitation-entry.html";
const ENTRY_MARKER = "issue-922-critical-entry";
const RAW_CAP = 20_000;
const GZIP_CAP = 6_000;

function fail(message) {
  throw new Error(`issue #922 critical-entry build failed: ${message}`);
}

function parseBuildDir(argv, env) {
  const flag = argv.indexOf("--build-dir");
  if (flag === -1) return "dist";
  if (env.NODE_ENV !== "test") {
    fail("--build-dir is a test-only override (NODE_ENV=test is required)");
  }
  if (flag !== argv.length - 2 || !argv[flag + 1]) {
    fail("usage: build-invite-critical-entry.mjs [--build-dir <test-directory>]");
  }
  return argv[flag + 1];
}

function parseAttributes(raw) {
  const attrs = [];
  let rest = raw;
  while (rest.trim().length > 0) {
    const match = rest.match(/^\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/);
    if (!match) fail(`unsupported or unpreservable script attribute syntax: ${rest.trim()}`);
    attrs.push({ name: match[1], value: match[2] ?? match[3] ?? null });
    rest = rest.slice(match[0].length);
  }
  const names = attrs.map(({ name }) => name.toLowerCase());
  if (new Set(names).size !== names.length) fail("duplicate script attribute");
  return attrs;
}

function extractEagerScripts(html, buildDir) {
  const found = [];
  const pattern = /<script\b([^>]*)>\s*<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = parseAttributes(match[1]);
    const src = attrs.find(({ name }) => name.toLowerCase() === "src")?.value;
    if (src === undefined || src === null) continue;
    let parsed;
    try {
      parsed = new URL(src, "https://business.usemingla.com");
    } catch {
      fail(`invalid script URL: ${src}`);
    }
    if (!/^\/_expo\/static\/js\/web\/.+\.js$/.test(parsed.pathname)) continue;
    if (parsed.origin !== "https://business.usemingla.com") fail(`external eager script: ${src}`);
    if (attrs.some(({ name }) => name.toLowerCase() === "async")) {
      fail("an eager script uses async, which cannot be preserved with ordered fallback boot");
    }
    const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    const file = resolve(buildDir, rel);
    const root = resolve(buildDir) + sep;
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      fail(`referenced eager script is missing: ${src}`);
    }
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      attrs,
      src,
    });
  }
  if (found.length !== 3) fail(`expected exactly 3 eager Expo scripts, found ${found.length}`);
  return found;
}

function removeScripts(html, scripts) {
  let cursor = 0;
  let output = "";
  for (const script of scripts) {
    output += html.slice(cursor, script.start);
    cursor = script.end;
  }
  return output + html.slice(cursor);
}

function criticalPayload(scripts) {
  const metadata = JSON.stringify(scripts.map(({ attrs }) => attrs)).replace(/</g, "\\u003c");
  return `<style id="issue-922-critical-style">html,body{margin:0;height:100%;font-family:Arial,sans-serif;background:#0c0e12}*{box-sizing:border-box}#root{display:flex;height:100%;flex:1}.i922-host{display:flex;flex:1;align-items:center;justify-content:center;padding:0 32px;background:#0c0e12}.i922-card{display:flex;flex-direction:column;gap:16px;width:100%;max-width:480px;padding:32px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.04)}.i922-title{margin:0;color:rgba(255,255,255,.96);font-size:22px;font-weight:700;letter-spacing:-.2px}.i922-copy{margin:0;color:rgba(255,255,255,.72);font-size:15px;line-height:22px}.i922-signin,.i922-consent button{border:0;font:inherit;cursor:pointer}.i922-signin{width:100%;height:52px;padding:0 20px;border-radius:999px;background:#eb7825;color:#fff;font-size:16px;line-height:24px;font-weight:600}.i922-signin:hover{background:#f0843a}.i922-signin:focus-visible,.i922-consent button:focus-visible,.i922-consent a:focus-visible{outline:2px solid #eb7825;outline-offset:2px}.i922-consent{position:absolute;z-index:9999;left:0;right:0;bottom:0;display:flex;justify-content:center;padding:0 16px 16px;pointer-events:none}.i922-consent-panel{display:flex;flex-direction:column;gap:8px;width:100%;max-width:520px;padding:24px;border:1px solid rgba(255,255,255,.1);border-radius:24px;background:rgba(18,20,26,.98);box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:auto}.i922-consent h2{margin:0;color:rgba(255,255,255,.96);font-size:16px;font-weight:700;letter-spacing:-.2px}.i922-consent p{margin:0;color:rgba(255,255,255,.72);font-size:13px;line-height:19px}.i922-consent a{color:#eb7825;font-weight:600}.i922-manage-note{display:none!important;margin-top:4px!important;color:rgba(255,255,255,.52)!important;font-size:12px!important;line-height:18px!important}.i922-manage-note[data-open="true"]{display:block!important}.i922-actions{display:flex;gap:8px;margin-top:4px}.i922-actions button{flex:1;height:44px;padding:0 16px;border-radius:999px;font-size:14px;line-height:20px;font-weight:600;letter-spacing:.2px}.i922-accept{background:#eb7825;color:#fff}.i922-reject{border:1px solid rgba(255,255,255,.12)!important;background:rgba(255,255,255,.06);color:rgba(255,255,255,.96)}.i922-manage{align-self:flex-start;padding:4px 0!important;background:transparent;color:rgba(255,255,255,.52);font-size:12px!important;font-weight:600!important}@media(max-width:420px){.i922-host{padding:0 32px}.i922-card{padding:32px}.i922-consent-panel{padding:24px}}</style><script id="${ENTRY_MARKER}">(function(){"use strict";var scripts=${metadata};var loaded=false;function boot(){if(loaded)return;loaded=true;for(var i=0;i<scripts.length;i++){var node=document.createElement("script");node.async=false;for(var j=0;j<scripts[i].length;j++){var attr=scripts[i][j];if(attr.value===null)node.setAttribute(attr.name,"");else node.setAttribute(attr.name,attr.value)}document.body.appendChild(node)}}function eligible(){try{var path=window.location.pathname;if(path!=="/accept-brand-invitation"&&path!=="/accept-brand-invitation/")return null;var params=new URLSearchParams(window.location.search);var token=params.get("token");if(token===null||token.trim().length===0)return null;var storage=window.localStorage;for(var i=0;i<storage.length;i++){var key=storage.key(i);if(key!==null&&(/^sb-.+-auth-token$/.test(key)||key==="mingla_consent_v1"))return null}if(storage.getItem("mingla_consent_v1")!==null)return null;return token}catch(_error){return null}}var token=eligible();if(token===null){boot();return}var root=document.getElementById("root");if(!root){boot();return}root.innerHTML='<main class="i922-host"><section class="i922-card" aria-labelledby="i922-title"><h1 class="i922-title" id="i922-title">You\'re invited</h1><p class="i922-copy">Sign in to accept this invitation. We\'ll bring you right back.</p><button class="i922-signin" type="button">Sign in</button></section><aside class="i922-consent ph-no-capture" aria-label="Cookie consent"><div class="i922-consent-panel"><h2>Cookies &amp; analytics</h2><p>We use cookies and privacy-first analytics to understand how people use Mingla and improve checkout. Nothing is tracked until you accept. See our <a href="https://usemingla.com/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p><p class="i922-manage-note">Analytics help us improve Mingla by measuring page views, funnel drop-off, and conversions. Choose Accept to turn them on, or Reject to keep them off. You can change this anytime by clearing your site data.</p><div class="i922-actions"><button class="i922-accept" type="button" aria-label="Accept cookies and analytics">Accept all</button><button class="i922-reject" type="button" aria-label="Reject cookies and analytics">Reject</button></div><button class="i922-manage" type="button" aria-label="Manage analytics preferences">Manage</button></div></aside></main>';var signIn=root.querySelector(".i922-signin");var consent=root.querySelector(".i922-consent");var note=root.querySelector(".i922-manage-note");var manage=root.querySelector(".i922-manage");signIn.addEventListener("click",function(){window.location.replace("/auth?next="+encodeURIComponent("/accept-brand-invitation?token="+token))});manage.addEventListener("click",function(){var open=note.getAttribute("data-open")==="true";note.setAttribute("data-open",String(!open));manage.textContent=open?"Manage":"Hide details"});function choose(choice){window.__minglaPrebootConsentChoice=choice;try{window.localStorage.setItem("mingla_consent_v1",JSON.stringify({choice:choice,ts:Date.now()}))}catch(_error){}consent.remove();boot()}root.querySelector(".i922-accept").addEventListener("click",function(){choose("granted")});root.querySelector(".i922-reject").addEventListener("click",function(){choose("denied")});requestAnimationFrame(function(){requestAnimationFrame(function(){document.documentElement.setAttribute("data-issue922-actionable","true")})})})();</script>`;
}

export function buildCriticalEntry(buildDir) {
  const sourcePath = join(buildDir, "index.html");
  if (!existsSync(sourcePath)) fail(`missing ${sourcePath}`);
  const sourceBytes = readFileSync(sourcePath);
  const html = sourceBytes.toString("utf8");
  if (html.includes(ENTRY_MARKER)) fail("source index already contains the output marker");
  if (!html.includes('<div id="root"></div>')) fail("source index lacks the Expo root scaffold");
  if (!html.includes("</body>")) fail("source index lacks </body>");
  const scripts = extractEagerScripts(html, buildDir);
  const withoutScripts = removeScripts(html, scripts);
  // The shell markup is assigned through a single-quoted inline-JS string.
  // Preserve its contractions as escaped apostrophes in the emitted HTML.
  const payload = criticalPayload(scripts)
    .replace(
      "font-family:Arial,sans-serif",
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    )
    .replace("You're invited", "You\\'re invited")
    .replace("We'll bring you right back.", "We\\'ll bring you right back.");
  const output = withoutScripts.replace("</body>", `${payload}\n</body>`);
  if ((output.match(new RegExp(`id="${ENTRY_MARKER}"`, "g")) ?? []).length !== 1) {
    fail("output marker is not unique");
  }
  if (output.includes("<script undefined")) fail("invalid output script metadata");
  const criticalSource = output.match(
    new RegExp(`<script id="${ENTRY_MARKER}">([\\s\\S]*?)<\\/script>`),
  )?.[1];
  if (criticalSource === undefined) fail("critical bootstrap script is missing");
  try {
    new Script(criticalSource);
  } catch (error) {
    fail(`critical bootstrap is invalid JavaScript: ${error.message}`);
  }
  const raw = Buffer.byteLength(output);
  const gzip = gzipSync(output).byteLength;
  if (raw > RAW_CAP || gzip > GZIP_CAP) fail(`output is ${raw} raw/${gzip} gzip bytes (caps ${RAW_CAP}/${GZIP_CAP})`);
  writeFileSync(join(buildDir, ENTRY_NAME), output);
  if (!readFileSync(sourcePath).equals(sourceBytes)) fail("source index.html changed during generation");
  return { raw, gzip, scripts: scripts.map(({ src }) => src) };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
  try {
    const buildDir = parseBuildDir(process.argv.slice(2), process.env);
    const result = buildCriticalEntry(buildDir);
    console.log(`issue #922 critical entry built: ${result.raw} raw / ${result.gzip} gzip bytes`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
