#!/usr/bin/env node
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SseServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

/* --------- Config --------- */
const BASE_URL = process.env.BASE_URL; // e.g. https://africancreationsbaskets.com
const CK = process.env.WOO_CONSUMER_KEY;
const CS = process.env.WOO_CONSUMER_SECRET;

if (!BASE_URL || !CK || !CS) {
  console.error('Missing env: BASE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET');
  process.exit(1);
}

/* --------- Minimal MCP server --------- */
const server = new McpServer({ name: 'woo-mcp', version: '1.0.0' });

function wcHeaders() {
  const token = Buffer.from(`${CK}:${CS}`).toString('base64');
  return {
    'Authorization': `Basic ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

async function wcGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: wcHeaders() });
  if (!res.ok) {
    throw new Error(`Woo GET ${url} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function wcPut(path, body) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: wcHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Woo PUT ${url} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/* --------- Tools --------- */

// Health/ping
server.tool('ping', {
  description: 'Health check',
  inputSchema: { type: 'object', properties: {} },
  async handler() {
    return { content: [{ type: 'text', text: 'pong' }] };
  },
});

// Search products
server.tool('wc_search_products', {
  description: 'Search WooCommerce products',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string' },
      per_page: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      page: { type: 'integer', minimum: 1, default: 1 },
    },
    required: ['q'],
  },
  async handler({ q, per_page = 10, page = 1 }) {
    const data = await wcGet('/wp-json/wc/v3/products', {
      search: q, per_page, page, orderby: 'date', order: 'desc'
    });
    // Return trimmed product info + required permalinks
    const items = data.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      permalink: p.permalink,
      status: p.status,
      stock_status: p.stock_status,
      date_modified: p.date_modified,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  },
});

// Get one product
server.tool('wc_get_product', {
  description: 'Get a WooCommerce product by ID',
  inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  async handler({ id }) {
    const p = await wcGet(`/wp-json/wc/v3/products/${id}`);
    const out = {
      id: p.id,
      name: p.name,
      permalink: p.permalink,
      description: p.description,
      short_description: p.short_description,
      price: p.price,
      stock_status: p.stock_status,
    };
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  },
});

// Update product (SEO/description fields)
server.tool('wc_update_product', {
  description: 'Update WooCommerce product core fields (SEO copy, descriptions, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      slug: { type: 'string' },
      description: { type: 'string' },
      short_description: { type: 'string' },
      meta_data: {
        type: 'array',
        items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } } }
      }
    },
    required: ['id'],
  },
  async handler(input) {
    const { id, ...patch } = input;
    const updated = await wcPut(`/wp-json/wc/v3/products/${id}`, patch);
    const out = {
      id: updated.id,
      name: updated.name,
      permalink: updated.permalink,
      short_description: updated.short_description,
      description: updated.description?.slice(0, 200) + (updated.description?.length > 200 ? '…' : ''),
      date_modified: updated.date_modified,
    };
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  },
});

/* --------- HTTP + SSE routing --------- */
const app = express();

// helpful headers for proxies/SSE
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  next();
});

// Minimal “don’t crash” routes some clients probe
app.get('/.well-known/:anything', (_req, res) => res.sendStatus(404));

// SSE handler
async function handleSse(req, res) {
  const transport = new SseServerTransport(req, res);
  await server.connect(transport);
}
app.get('/sse', handleSse);
app.get('/', handleSse); // some validators hit root

// start server (long timeouts)
const port = Number(process.env.PORT || 8787);
const srv = app.listen(port, () => {
  console.log(`✅ MCP Woo server on :${port} (SSE at /sse)`);
});
try {
  srv.keepAliveTimeout = 0;
  srv.headersTimeout = 0;
  srv.requestTimeout = 0;
} catch {}
