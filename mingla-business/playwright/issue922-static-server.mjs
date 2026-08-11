import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(process.env.ISSUE_922_WEB_BUILD ?? "dist");
const port = Number(process.env.ISSUE_922_PORT ?? 19422);
const vercel = JSON.parse(readFileSync(resolve(import.meta.dirname, "../vercel.json"), "utf8"));
const inviteRewriteIndex = vercel.rewrites.findIndex(
  (rewrite) => rewrite.source === "/accept-brand-invitation" && rewrite.destination === "/accept-brand-invitation-entry",
);
if (inviteRewriteIndex === -1) throw new Error("issue #922 exact invitation rewrite is missing");
const relevantRewrites = vercel.rewrites.slice(inviteRewriteIndex).map((rewrite) => ({
  ...rewrite,
  matcher: new RegExp(`^(?:${rewrite.source})$`),
}));

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

function builtFile(pathname) {
  if (pathname === "/") return join(root, "index.html");
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = [resolve(root, clean)];
  if (vercel.cleanUrls && extname(clean) === "") candidates.push(resolve(root, `${clean}.html`));
  for (const candidate of candidates) {
    if (
      candidate.startsWith(root + sep) &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
    ) return candidate;
  }
  return null;
}

function resolveRequest(rawUrl) {
  const parsed = new URL(rawUrl, `http://127.0.0.1:${port}`);
  if (vercel.trailingSlash === false && parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
    return { redirect: `${parsed.pathname.slice(0, -1)}${parsed.search}` };
  }
  if (vercel.cleanUrls && parsed.pathname.endsWith(".html")) {
    return { redirect: `${parsed.pathname.slice(0, -5)}${parsed.search}` };
  }

  const originalFile = builtFile(parsed.pathname);
  if (originalFile) return { file: originalFile };

  let currentPath = parsed.pathname;
  for (const rewrite of relevantRewrites) {
    if (
      rewrite.source === "/accept-brand-invitation" &&
      parsed.searchParams.get("issue922React") === "1"
    ) continue;
    if (rewrite.matcher.test(currentPath)) currentPath = rewrite.destination;
  }

  const rewrittenFile = builtFile(currentPath);
  return rewrittenFile ? { file: rewrittenFile } : { status: 404 };
}

const server = createServer((req, res) => {
  let resolved;
  try {
    resolved = resolveRequest(req.url ?? "/");
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (resolved.redirect) {
    res.writeHead(308, { Location: resolved.redirect }).end();
    return;
  }
  if (resolved.status === 404) {
    res.writeHead(404).end("Not found");
    return;
  }
  const file = resolved.file;
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
