'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'config.json'), 'utf8'));

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-')), 'state.json');
}

test('주문을 주방별 주문표로 나눈다', () => {
  const store = new Store(config, null);
  const order = store.createOrder({
    tableNo: 3,
    items: [{ menuId: 'bulgogi', qty: 2 }, { menuId: 'lasagna', qty: 1 }, { menuId: 'bulgogi', qty: 1 }],
  });
  assert.strictEqual(order.total, 40000);
  assert.deepStrictEqual(
    order.tickets.map((t) => [t.stationId, t.status, t.items.map((i) => [i.menuId, i.qty])]),
    [[1, 'pending', [['bulgogi', 3]]], [2, 'pending', [['lasagna', 1]]]],
  );
});

test('한 주방 메뉴만 주문하면 그 주방 주문표만 생긴다', () => {
  const store = new Store(config, null);
  const order = store.createOrder({ tableNo: 1, items: [{ menuId: 'lasagna', qty: 2 }, { menuId: 'bulgogi', qty: 0 }] });
  assert.deepStrictEqual(order.tickets.map((t) => t.stationId), [2]);
});

test('잘못된 주문은 거부한다', () => {
  const store = new Store(config, null);
  assert.throws(() => store.createOrder({ tableNo: 0, items: [{ menuId: 'bulgogi', qty: 1 }] }), /테이블/);
  assert.throws(() => store.createOrder({ tableNo: 99, items: [{ menuId: 'bulgogi', qty: 1 }] }), /테이블/);
  assert.throws(() => store.createOrder({ tableNo: 1, items: [] }), /메뉴/);
  assert.throws(() => store.createOrder({ tableNo: 1, items: [{ menuId: 'pizza', qty: 1 }] }), /없는 메뉴/);
  assert.throws(() => store.createOrder({ tableNo: 1, items: [{ menuId: 'bulgogi', qty: -1 }] }), /수량/);
  store.setSoldOut('bulgogi', true);
  assert.throws(() => store.createOrder({ tableNo: 1, items: [{ menuId: 'bulgogi', qty: 1 }] }), /품절/);
});

test('같은 requestId 로 다시 보내면 중복 주문을 만들지 않는다', () => {
  const store = new Store(config, null);
  const a = store.createOrder({ tableNo: 2, items: [{ menuId: 'bulgogi', qty: 1 }], requestId: 'abc' });
  const b = store.createOrder({ tableNo: 2, items: [{ menuId: 'bulgogi', qty: 1 }], requestId: 'abc' });
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(store.state.orders.length, 1);
});

test('대기 → 주방 요청 → 서빙 완료, 그리고 되돌리기', () => {
  const store = new Store(config, null);
  const { id } = store.createOrder({ tableNo: 5, items: [{ menuId: 'bulgogi', qty: 1 }] });
  const ticket = () => store.state.orders[0].tickets[0];

  store.setTicketStatus(id, 1, 'requested');
  assert.strictEqual(ticket().status, 'requested');
  assert.ok(ticket().requestedAt);

  store.setTicketStatus(id, 1, 'served');
  assert.strictEqual(ticket().status, 'served');
  assert.ok(ticket().servedAt);

  store.setTicketStatus(id, 1, 'requested');
  assert.strictEqual(ticket().servedAt, null);

  assert.throws(() => store.setTicketStatus(id, 2, 'served'), /주방/);
  assert.throws(() => store.setTicketStatus(id, 1, 'cooking'), /상태/);
});

test('모두 주방에 요청은 해당 주방의 대기 주문만 바꾼다', () => {
  const store = new Store(config, null);
  store.createOrder({ tableNo: 1, items: [{ menuId: 'bulgogi', qty: 1 }, { menuId: 'lasagna', qty: 1 }] });
  store.createOrder({ tableNo: 2, items: [{ menuId: 'bulgogi', qty: 2 }] });
  const cancelled = store.createOrder({ tableNo: 3, items: [{ menuId: 'bulgogi', qty: 2 }] });
  store.setCancelled(cancelled.id, true);

  assert.strictEqual(store.requestAll(1), 2);
  const statuses = store.state.orders.map((o) => o.tickets.map((t) => `${t.stationId}:${t.status}`).join(','));
  assert.deepStrictEqual(statuses, ['1:requested,2:pending', '1:requested', '1:pending']);
  assert.throws(() => store.setTicketStatus(cancelled.id, 1, 'requested'), /취소/);
});

test('파일에 저장하고 다시 불러온다, 초기화하면 백업을 남긴다', () => {
  const file = tmpFile();
  const store = new Store(config, file);
  store.createOrder({ tableNo: 4, items: [{ menuId: 'lasagna', qty: 3 }] });
  store.setSoldOut('bulgogi', true);

  const reloaded = new Store(config, file);
  assert.strictEqual(reloaded.state.orders.length, 1);
  assert.strictEqual(reloaded.snapshot().menus.find((m) => m.id === 'bulgogi').soldOut, true);
  assert.strictEqual(reloaded.createOrder({ tableNo: 1, items: [{ menuId: 'lasagna', qty: 1 }] }).id, 2);

  reloaded.reset();
  assert.strictEqual(reloaded.state.orders.length, 0);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('.backup-')));
});

test('변경될 때마다 구독자에게 최신 상태를 알린다', () => {
  const store = new Store(config, null);
  const seen = [];
  store.subscribe((s) => seen.push(s.orders.length));
  store.createOrder({ tableNo: 1, items: [{ menuId: 'bulgogi', qty: 1 }] });
  store.requestAll(1);
  assert.deepStrictEqual(seen, [1, 1]);
});
