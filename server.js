const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const INDEX_PATH = path.join(__dirname, "index.html");
const MAX_BYTES = 1 * 1024 * 1024 * 1024;
const CHUNK_SIZE = 256 * 1024;
const RANDOM_CHUNK = crypto.randomBytes(CHUNK_SIZE);

function sendIndex(res) {
  fs.readFile(INDEX_PATH, "utf8", (err, html) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Unable to read index.html");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate"
    });
    res.end(html);
  });
}

function clampBytes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MAX_BYTES;
  }
  return Math.min(Math.floor(parsed), MAX_BYTES);
}

function sendPayload(req, res, url) {
  const bytes = clampBytes(url.searchParams.get("bytes"));
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(bytes),
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, no-transform",
    "Pragma": "no-cache",
    "Expires": "0",
    "Content-Encoding": "identity"
  });

  let sent = 0;
  function writeChunk() {
    while (sent < bytes) {
      const remaining = bytes - sent;
      const chunk = remaining >= CHUNK_SIZE ? RANDOM_CHUNK : RANDOM_CHUNK.subarray(0, remaining);
      const canContinue = res.write(chunk);
      sent += chunk.length;
      if (!canContinue) {
        res.once("drain", writeChunk);
        return;
      }
    }
    res.end();
  }

  req.on("close", () => {
    if (!res.writableEnded) {
      res.end();
    }
  });

  writeChunk();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendIndex(res);
    return;
  }

  if (url.pathname === "/payload.bin") {
    sendPayload(req, res, url);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Speed test server running on port ${PORT}`);
});
