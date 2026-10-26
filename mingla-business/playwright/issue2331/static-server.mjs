// #2331 — serves a local `expo export -p web` (DIST_2331) with SPA fallback.
// The export must be built with EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331
// (mocked in-test) and fixture vendor ids so the vendor boot is observable.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.env.DIST_2331;
const port = Number(process.env.PORT_2331 ?? 8331);
if (!root) throw new Error("DIST_2331 is required (a local expo web export)");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
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
}).listen(port, "127.0.0.1", () => console.log(`issue2331 static on ${port}`));
