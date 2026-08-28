import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve("node_modules/.cache/issue2769");
createServer((request, response) => {
  const file = request.url === "/bundle.js" ? "bundle.js" : "index.html";
  const target = path.join(root, file);
  if (!existsSync(target)) {
    response.statusCode = 200;
    response.end("issue #2769 harness warming");
    return;
  }
  response.setHeader(
    "content-type",
    file.endsWith(".js") ? "application/javascript" : "text/html",
  );
  createReadStream(target).pipe(response);
}).listen(42769, "127.0.0.1");
