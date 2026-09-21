// PR #3416 independent retest — serves a local `expo export -p web` (single
// output) with SPA fallback. `/__fake-stripe?next=<path>` stands in for the
// hosted checkout: it 302s straight back, like a completed Stripe return.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.env.DIST_3416;
const port = Number(process.env.PORT_3416 ?? 8416);
if (!root) throw new Error("DIST_3416 is required");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/__fake-stripe") {
    res.writeHead(302, { Location: url.searchParams.get("next") ?? "/" });
    res.end();
    return;
  }
  if (url.pathname === "/__blank") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>other tab</title>");
    return;
  }
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = path.join(file, "index.html");
    await stat(file);
  } catch {
    file = path.join(root, "index.html");
  }
  const body = await readFile(file);
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  res.end(body);
}).listen(port, "127.0.0.1", () => console.log(`issue3416 static on ${port}`));
