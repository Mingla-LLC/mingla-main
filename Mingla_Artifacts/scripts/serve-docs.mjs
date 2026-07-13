import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 7317);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const server = http.createServer((request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url ?? "/", `http://${request.headers.host}`).pathname);
  const requestedPath = path.resolve(repoRoot, `.${urlPath}`);

  if (!requestedPath.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(requestedPath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const stats = fs.statSync(requestedPath);
  if (!stats.isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const contentType = mime[path.extname(requestedPath).toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.range;
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { ...commonHeaders, "Content-Range": `bytes */${stats.size}` });
      response.end();
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
    if (start > end || start >= stats.size) {
      response.writeHead(416, { ...commonHeaders, "Content-Range": `bytes */${stats.size}` });
      response.end();
      return;
    }

    response.writeHead(206, {
      ...commonHeaders,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stats.size}`,
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(requestedPath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { ...commonHeaders, "Content-Length": stats.size });
  if (request.method === "HEAD") response.end();
  else fs.createReadStream(requestedPath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mingla docs server: http://127.0.0.1:${port}`);
});
