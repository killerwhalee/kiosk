'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Store, HttpError } = require('./lib/store');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PAGES = {
  '/': 'index.html',
  '/order': 'order.html',
  '/admin': 'admin.html',
};

function loadConfig(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createServer({ config, store, adminPin = '' }) {
  const clients = new Set();

  store.subscribe((snapshot) => {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const res of clients) res.write(payload);
  });

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 15000);
  heartbeat.unref();

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function sendFile(res, file) {
    fs.readFile(file, (err, data) => {
      if (err) return sendJson(res, 404, { error: '페이지를 찾을 수 없습니다.' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 100000) reject(new HttpError(413, '요청이 너무 큽니다.'));
      });
      req.on('end', () => {
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new HttpError(400, 'JSON 형식이 올바르지 않습니다.'));
        }
      });
      req.on('error', reject);
    });
  }

  function requireAdmin(req) {
    if (adminPin && req.headers['x-admin-pin'] !== adminPin) {
      throw new HttpError(401, '관리자 PIN이 올바르지 않습니다.');
    }
  }

  function openEventStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n');
    res.write(`data: ${JSON.stringify(store.snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    let m;

    if (method === 'GET' && pathname === '/api/events') return openEventStream(req, res);
    if (method === 'GET' && pathname === '/api/ping') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (method === 'GET' && pathname === '/api/state') return sendJson(res, 200, store.snapshot());

    if (method !== 'POST') throw new HttpError(404, '없는 API입니다.');
    const body = await readBody(req);

    if (pathname === '/api/orders') {
      return sendJson(res, 201, store.createOrder(body));
    }
    if ((m = pathname.match(/^\/api\/orders\/(\d+)\/tickets\/(\d+)\/status$/))) {
      return sendJson(res, 200, store.setTicketStatus(m[1], m[2], body.status));
    }
    if ((m = pathname.match(/^\/api\/stations\/(\d+)\/request-all$/))) {
      return sendJson(res, 200, { count: store.requestAll(m[1]) });
    }
    if (pathname === '/api/admin/check') {
      requireAdmin(req);
      return sendJson(res, 200, { ok: true });
    }
    if ((m = pathname.match(/^\/api\/orders\/(\d+)\/cancel$/))) {
      requireAdmin(req);
      return sendJson(res, 200, store.setCancelled(m[1], body.cancelled !== false));
    }
    if ((m = pathname.match(/^\/api\/menus\/([\w-]+)\/sold-out$/))) {
      requireAdmin(req);
      store.setSoldOut(m[1], !!body.soldOut);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/reset') {
      requireAdmin(req);
      store.reset();
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(404, '없는 API입니다.');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET') throw new HttpError(405, '허용되지 않는 요청입니다.');

      if (PAGES[url.pathname]) return sendFile(res, path.join(PUBLIC_DIR, PAGES[url.pathname]));
      if (/^\/station\/\d+$/.test(url.pathname)) return sendFile(res, path.join(PUBLIC_DIR, 'station.html'));

      const file = path.normalize(path.join(PUBLIC_DIR, url.pathname));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, '페이지를 찾을 수 없습니다.');
      return sendFile(res, file);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : err.message });
      else res.end();
    }
  });

  server.on('close', () => {
    clearInterval(heartbeat);
    for (const res of clients) res.end();
  });
  return server;
}

function localAddresses() {
  const result = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) result.push({ name, address: addr.address });
    }
  }
  return result;
}

if (require.main === module) {
  const config = loadConfig(process.env.KIOSK_CONFIG || path.join(ROOT, 'config.json'));
  const dataFile = process.env.KIOSK_DATA || path.join(ROOT, 'data', 'state.json');
  const store = new Store(config, dataFile);
  const port = Number(process.env.PORT || config.port || 3000);
  const server = createServer({ config, store, adminPin: process.env.ADMIN_PIN || '' });

  server.listen(port, '0.0.0.0', () => {
    console.log(`\n${config.title} 주문 시스템이 시작되었습니다.`);
    console.log(`  이 컴퓨터에서: http://localhost:${port}`);
    for (const { name, address } of localAddresses()) {
      console.log(`  ${name.padEnd(12)} http://${address}:${port}`);
    }
    console.log(`\n  주문 입력:   /order`);
    for (const s of config.stations) console.log(`  ${s.name.padEnd(8)}: /station/${s.id}`);
    console.log(`  관리자:      /admin${process.env.ADMIN_PIN ? ' (PIN 필요)' : ''}`);
    console.log(`  저장 파일:   ${dataFile}\n`);
  });
}

module.exports = { createServer, loadConfig };
