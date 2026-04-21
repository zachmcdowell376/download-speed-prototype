const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const INDEX_PATH = path.join(__dirname, "index.html");
const MAX_BYTES = 1 * 1024 * 1024 * 1024;
const CHUNK_SIZE = 256 * 1024;
const RANDOM_CHUNK = crypto.randomBytes(CHUNK_SIZE);
const SERVER_LABEL = process.env.SPEED_SERVER_LABEL || "Default Node";
const SERVER_REGION = process.env.SPEED_SERVER_REGION || "Auto";
const SERVER_ID = process.env.SPEED_SERVER_ID || "default-node";
const CORS_ANY_ORIGIN = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function inferOrigin(req) {
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader || "http").split(",")[0].trim();
  return `${proto || "http"}://${req.headers.host}`;
}

function parseServerList(req) {
  const fallbackBaseUrl = trimTrailingSlash(process.env.SPEED_SERVER_BASE_URL || inferOrigin(req));
  const fallbackServer = {
    id: SERVER_ID,
    label: SERVER_LABEL,
    region: SERVER_REGION,
    baseUrl: fallbackBaseUrl,
    enabled: true
  };

  const rawList = process.env.SPEED_TEST_SERVERS;
  if (!rawList) return [fallbackServer];

  try {
    const parsed = JSON.parse(rawList);
    if (!Array.isArray(parsed)) return [fallbackServer];

    const normalized = parsed
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const baseUrl = trimTrailingSlash(item.baseUrl);
        if (!baseUrl) return null;
        return {
          id: String(item.id || `node-${index + 1}`),
          label: String(item.label || `Speed Node ${index + 1}`),
          region: String(item.region || "Auto"),
          baseUrl,
          enabled: item.enabled !== false
        };
      })
      .filter(Boolean);

    if (!normalized.length) return [fallbackServer];
    return normalized;
  } catch (error) {
    return [fallbackServer];
  }
}

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
    ...CORS_ANY_ORIGIN,
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

function handleUpload(req, res) {
  let received = 0;
  req.on("data", (chunk) => {
    received += chunk.length;
  });
  req.on("end", () => {
    res.writeHead(200, {
      ...CORS_ANY_ORIGIN,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ ok: true, bytesReceived: received }));
  });
  req.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(400, { ...CORS_ANY_ORIGIN, "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Bad request");
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/servers") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...CORS_ANY_ORIGIN,
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      });
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { ...CORS_ANY_ORIGIN, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    const servers = parseServerList(req).filter((server) => server.enabled !== false);
    res.writeHead(200, {
      ...CORS_ANY_ORIGIN,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ servers }));
    return;
  }

  if (url.pathname === "/ping") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...CORS_ANY_ORIGIN,
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      });
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { ...CORS_ANY_ORIGIN, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    res.writeHead(200, {
      ...CORS_ANY_ORIGIN,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate"
    });
    res.end("pong");
    return;
  }

  if (url.pathname === "/upload.bin") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...CORS_ANY_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      res.end();
      return;
    }
    if (req.method === "POST") {
      handleUpload(req, res);
      return;
    }
    res.writeHead(405, { ...CORS_ANY_ORIGIN, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

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
