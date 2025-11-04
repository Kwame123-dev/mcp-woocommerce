#!/usr/bin/env node
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

/* ---------- Minimal MCP server ---------- */
const server = new McpServer({ name: 'woo-mcp', version: '1.0.0' });

server.tool(
  'ping',
  { description: 'Health check', inputSchema: { type: 'object', properties: {} } },
  async () => ({ content: [{ type: 'text', text: 'pong' }] })
);

server.tool(
  'time',
  { description: 'Server time (ISO)', inputSchema: { type: 'object', properties: {} } },
  async () => ({ content: [{ type: 'text', text: new Date().toISOString() }] })
);

/* ---------- HTTP + SSE routing (robust) ---------- */
const app = express();

// Helpful headers for proxies and SSE
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  next();
});

// Some clients probe these; avoid failing the connector creation
app.get('/.well-known/:path(*)', (req, res) => res.sendStatus(404));
app.options('*', (req, res) => res.sendStatus(204));
app.post('*', (req, res) => res.sendStatus(200));

async function handleSse(req, res) {
  console.log('🔌 SSE connection received');
  // Current SDK signature is (req, res)
  const transport = new SSEServerTransport(req, res);
  await server.connect(transport);
}

// Serve SSE on both /sse and / (some validators hit root)
app.get('/sse', handleSse);
app.get('/', handleSse);

/* ---------- Start HTTP server (long timeouts) ---------- */
const port = Number(process.env.PORT || 8787);
const srv = app.listen(port, () => {
  console.log(`✅ MCP SSE running at http://localhost:${port}/sse`);
});
try {
  srv.keepAliveTimeout = 0;
  srv.headersTimeout = 0;
  srv.requestTimeout = 0;
} catch {}
