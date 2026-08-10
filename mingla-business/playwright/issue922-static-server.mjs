import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(process.env.ISSUE_922_WEB_BUILD ?? "dist");
const port = Number(process.env.ISSUE_922_PORT ?? 19422);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function resolveRequest(rawUrl) {
  const parsed = new URL(rawUrl, `http://127.0.0.1:${port}`);
  if (
    (parsed.pathname === "/accept-brand-invitation" || parsed.pathname === "/accept-brand-invitation/") &&
    parsed.searchParams.get("issue922React") !== "1"
  ) {
    return join(root, "accept-brand-invitation-entry.html");
  }
  const clean = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  const candidate = resolve(root, clean);
  if (
    candidate.startsWith(root + sep) &&
    existsSync(candidate) &&
    statSync(candidate).isFile()
  ) {
    return candidate;
  }
  return join(root, "index.html");
}

const server = createServer((req, res) => {
  let file;
  try {
    file = resolveRequest(req.url ?? "/");
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (!existsSync(file)) {
    res.writeHead(500).end("Issue #922 build output is missing");
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypes.get(extname(file)) ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
});

server.on("error", (error) => {
  console.error(`issue #922 static server failed: ${error.message}`);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`issue #922 static server listening on http://127.0.0.1:${port}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
