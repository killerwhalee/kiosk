'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { createServer, loadConfig } = require('../server');
const { Store } = require('../lib/store');

const config = loadConfig(path.join(__dirname, 'fixtures', 'config.json'));

async function start(adminPin = '') {
  const store = new Store(config, null);
  const server = createServer({ config, store, adminPin });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, store, base };
}

async function post(base, p, body, headers = {}) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json() };
}

/** SSE 스트림에서 조건을 만족하는 상태가 올 때까지 기다린다. */
function waitForEvent(base, predicate) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const snapshot = JSON.parse(line.slice(6));
          if (predicate(snapshot)) {
            req.destroy();
            resolve(snapshot);
          }
        }
      });
    });
    req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
  });
}

test('페이지를 제공한다', async () => {
  const { server, base } = await start();
  try {
    for (const p of ['/', '/order', '/station/1', '/admin', '/common.js']) {
      const res = await fetch(base + p);
      assert.strictEqual(res.status, 200, p);
    }
    assert.strictEqual((await fetch(base + '/../server.js')).status, 404);
    assert.strictEqual((await fetch(base + '/api/ping')).status, 204);
  } finally {
    server.close();
  }
});

test('주문하면 실시간 스트림으로 주방에 전달된다', async () => {
  const { server, base } = await start();
  try {
    const initial = waitForEvent(base, () => true);
    assert.strictEqual((await initial).orders.length, 0);

    const arrived = waitForEvent(base, (s) => s.orders.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    const created = await post(base, '/api/orders', { tableNo: 7, items: [{ menuId: 'bulgogi', qty: 2 }, { menuId: 'lasagna', qty: 1 }] });
    assert.strictEqual(created.status, 201);
    const snapshot = await arrived;
    assert.strictEqual(snapshot.orders[0].tableNo, 7);
    assert.strictEqual(snapshot.orders[0].tickets.length, 2);

    const res = await post(base, `/api/orders/${created.body.id}/tickets/1/status`, { status: 'requested' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tickets[0].status, 'requested');

    const bad = await post(base, '/api/orders', { tableNo: 7, items: [] });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.error, /메뉴/);
  } finally {
    server.close();
  }
});

test('관리자 PIN 이 설정되면 관리 기능에 PIN 이 필요하다', async () => {
  const { server, base } = await start('1234');
  try {
    assert.strictEqual((await post(base, '/api/menus/bulgogi/sold-out', { soldOut: true })).status, 401);
    assert.strictEqual((await post(base, '/api/menus/bulgogi/sold-out', { soldOut: true }, { 'X-Admin-Pin': '1234' })).status, 200);
    // 주문 입력과 주방 화면은 PIN 없이 동작해야 한다
    assert.strictEqual((await post(base, '/api/orders', { tableNo: 1, items: [{ menuId: 'lasagna', qty: 1 }] })).status, 201);
    assert.strictEqual((await post(base, '/api/stations/2/request-all')).body.count, 1);
  } finally {
    server.close();
  }
});
