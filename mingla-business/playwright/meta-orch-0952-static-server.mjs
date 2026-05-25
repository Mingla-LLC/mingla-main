import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";

const root = resolve(process.argv[2] ?? "web-build");
const port = Number(process.argv[3] ?? 43095);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const resolveAsset = (url) => {
  const parsed = new URL(url, `http://127.0.0.1:${port}`);
  const cleanPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  const candidate = resolve(root, cleanPath);
  if (candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  return join(root, "index.html");
};

const server = createServer((req, res) => {
  const assetPath = resolveAsset(req.url ?? "/");
  const contentType = contentTypes.get(extname(assetPath)) ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  createReadStream(assetPath).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`META-ORCH-0952 static server listening on http://127.0.0.1:${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
