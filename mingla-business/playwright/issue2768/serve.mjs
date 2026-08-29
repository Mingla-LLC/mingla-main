import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const port = Number(process.env.ISSUE_2768_PORT ?? 27680);
const root = resolve("node_modules/.cache/issue2768");
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

function cachedFile(pathname) {
  const file = pathname === "/bundle.js"
    ? join(root, "bundle.js")
    : join(root, "index.html");
  return file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()
    ? file
    : null;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("issue-2768-ready");
    return;
  }
  const file = cachedFile(url.pathname);
  if (file === null) {
    response.writeHead(500).end("Issue #2768 browser bundle is missing");
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentTypes.get(extname(file)) ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
});

server.on("error", (error) => {
  console.error(`issue #2768 static server failed: ${error.message}`);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`issue #2768 static server listening on http://127.0.0.1:${port}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
