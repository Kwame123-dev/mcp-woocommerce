// server.js
import express from "express";
import cors from "cors";

// ----- Config -----
const PORT = process.env.PORT || 10000;
// Your WP MCP “streamable” endpoint:
const TARGET_STREAM_URL =
  process.env.TARGET_STREAM_URL ||
  "https://africancreationsbaskets.com/wp-json/wp/v2/wpmcp/streamable";

// Optional: put a JWT here if your WP MCP requires it (leave empty for read-only)
const BEARER = process.env.BEARER || "";

// ----- App -----
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Healthcheck
app.get("/health", (_req, res) => res.status(200).send("ok"));

// Some clients probe these; use safe, non-wildcard handlers
app.use("/.well-known", (_req, res) => res.sendStatus(404));
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

// SSE proxy endpoint for ChatGPT connector
app.post("/sse", async (req, res) => {
  try {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (BEARER) headers["Authorization"] = `Bearer ${BEARER}`;

    // Forward the JSON-RPC body as-is
    const body = JSON.stringify(req.body ?? {});

    const upstream = await fetch(TARGET_STREAM_URL, {
      method: "POST",
      headers,
      body,
    });

    // Mirror key headers so ChatGPT recognizes SSE/JSON stream
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type") || "application/json";
    const proto = upstream.headers.get("mcp-protocol-version") || "";
    const transport = upstream.headers.get("x-transport-type") || "";

    res.setHeader("Content-Type", ct);
    if (proto) res.setHeader("mcp-protocol-version", proto);
    if (transport) res.setHeader("x-transport-type", transport);

    // Stream upstream body to client
    if (!upstream.body) {
      return res.end();
    }
    upstream.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        },
        abort() {
          res.end();
        },
      })
    ).catch(() => res.end());
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(502).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32603, message: "Upstream proxy error" },
    });
  }
});

// Fallback GET to help you see it’s alive
app.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    sse: "/sse",
    target: TARGET_STREAM_URL,
  });
});

app.listen(PORT, () => {
  console.log(`MCP Bridge listening on :${PORT}`);
  console.log(`Forwarding to: ${TARGET_STREAM_URL}`);
});
