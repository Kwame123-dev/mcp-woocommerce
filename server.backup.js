#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { fetch } from 'undici';

/* ---------- Woo basics ---------- */
const base = `${process.env.WC_URL}/wp-json/wc/v3`;
const useQueryAuth = () => String(process.env.WC_AUTH_IN_QUERY || '').toLowerCase() === 'true';
const authHeaders = () => {
  const h = { 'Content-Type': 'application/json' };
  if (!useQueryAuth()) {
    h.Authorization = 'Basic ' + Buffer
      .from(`${process.env.WC_KEY}:${process.env.WC_SECRET}`)
      .toString('base64');
  }
  return h;
};
const withAuth = (path) => {
  if (!useQueryAuth()) return base + path;
  const sep = path.includes('?') ? '&' : '?';
  return base + path +
    `${sep}consumer_key=${encodeURIComponent(process.env.WC_KEY)}` +
    `&consumer_secret=${encodeURIComponent(process.env.WC_SECRET)}`;
};
async function wc(path, method = 'GET', body) {
  const res = await fetch(withAuth(path), {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${txt ? ' - ' + txt : ''}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

/* ---------- MCP server & tools ---------- */
const server = new McpServer({ name: 'woocommerce-mcp', version: '1.0.0' });

server.tool(
  'ping',
  { description: 'Health check', inputSchema: z.object({}) },
  async () => ({ content: [{ type: 'text', text: 'pong' }] })
);

server.tool(
  'list_categories',
  {
    description: 'List WooCommerce product categories (id, name, slug, count)',
    inputSchema: z.object({ per_page: z.number().optional(), page: z.number().optional() })
  },
  async ({ input }) => {
    const per = input?.per_page ?? 50;
    const page = input?.page ?? 1;
    const data = await wc(`/products/categories?per_page=${per}&page=${page}`);
    const slim = (data || []).map(c => ({ id: c.id, name: c.name, slug: c.slug, count: c.count }));
    return { content: [{ type: 'text', text: JSON.stringify(slim, null, 2) }] };
  }
);

/* ---------- SSE endpoint ---------- */
const app = express();

// IMPORTANT: pass (req, res) to SSEServerTransport with the current SDK
app.get('/sse', async (req, res) => {
  console.log('🔌 SSE connection received');
  const transport = new SSEServerTransport(req, res);
  await server.connect(transport);  // sends handshake & tools list
});

/* ---------- Start HTTP server ---------- */
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`✅ MCP SSE running at http://localhost:${port}/sse`));
