'use strict';

const fs = require('fs');
const path = require('path');

const STATUSES = ['pending', 'requested', 'served'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * config.json 의 메뉴 옵션을 한 가지 형태로 맞춘다.
 *   "options": [{ "name": "온도", "choices": ["HOT", { "name": "ICE", "price": 500 }] }]
 * 선택지는 글자만 적거나, 추가 금액이 있으면 { name, price } 로 적는다. 첫 선택지가 기본값이다.
 */
function normalizeMenus(menus) {
  return menus.map((m) => {
    const groups = m.options == null ? [] : m.options;
    if (!Array.isArray(groups)) throw new Error(`메뉴 "${m.name}"의 options는 목록([...])이어야 합니다.`);
    const options = groups.map((g, gi) => {
      const groupName = String((g && g.name) || `옵션${gi + 1}`);
      if (!g || !Array.isArray(g.choices) || g.choices.length === 0) {
        throw new Error(`메뉴 "${m.name}"의 옵션 "${groupName}"에 choices(선택지 목록)가 없습니다.`);
      }
      const choices = g.choices.map((c) => {
        const choice = typeof c === 'string' ? { name: c, price: 0 } : { name: String((c && c.name) || ''), price: Number(c && c.price) || 0 };
        if (!choice.name) throw new Error(`메뉴 "${m.name}"의 옵션 "${groupName}"에 이름 없는 선택지가 있습니다.`);
        return choice;
      });
      if (new Set(choices.map((c) => c.name)).size !== choices.length) {
        throw new Error(`메뉴 "${m.name}"의 옵션 "${groupName}"에 같은 이름의 선택지가 있습니다.`);
      }
      return { name: groupName, choices };
    });
    return { ...m, options };
  });
}

function emptyState() {
  return { nextOrderId: 1, orders: [], soldOut: {} };
}

/**
 * 주문 상태를 메모리에 들고 있으면서, 변경될 때마다 JSON 파일에 저장한다.
 * 하루 운영 규모(주문 수백 건)에서는 이것으로 충분하다.
 */
class Store {
  constructor(config, filePath) {
    this.config = config;
    this.menus = normalizeMenus(config.menus);
    this.filePath = filePath;
    this.listeners = new Set();
    this.version = 0;
    this.state = this.load();
  }

  load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return emptyState();
    try {
      return { ...emptyState(), ...JSON.parse(fs.readFileSync(this.filePath, 'utf8')) };
    } catch (err) {
      const backup = `${this.filePath}.broken-${Date.now()}`;
      fs.renameSync(this.filePath, backup);
      console.error(`저장 파일을 읽지 못해 ${backup} 로 옮기고 새로 시작합니다:`, err.message);
      return emptyState();
    }
  }

  save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  commit() {
    this.save();
    this.version += 1;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    const { title, tables, stations } = this.config;
    return {
      version: this.version,
      title,
      tables,
      stations,
      menus: this.menus.map((m) => ({ ...m, soldOut: !!this.state.soldOut[m.id] })),
      orders: this.state.orders,
    };
  }

  menu(menuId) {
    return this.menus.find((m) => m.id === menuId);
  }

  /** 고른 옵션(선택지 이름, 옵션 순서대로)을 확인하고 추가 금액을 계산한다. 비우면 기본값(첫 선택지). */
  resolveOptions(menu, picked) {
    const groups = menu.options;
    if (picked == null) picked = groups.map((g) => g.choices[0].name);
    if (!Array.isArray(picked) || picked.length !== groups.length) {
      throw new HttpError(400, `${menu.name}의 옵션이 올바르지 않습니다.`);
    }
    let extra = 0;
    const names = groups.map((g, i) => {
      const choice = g.choices.find((c) => c.name === picked[i]);
      if (!choice) throw new HttpError(400, `${menu.name}의 옵션이 올바르지 않습니다.`);
      extra += choice.price;
      return choice.name;
    });
    return { names, extra };
  }

  findOrder(orderId) {
    const order = this.state.orders.find((o) => o.id === Number(orderId));
    if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다.');
    return order;
  }

  createOrder({ tableNo, items, note, requestId }) {
    if (requestId) {
      const dup = this.state.orders.find((o) => o.requestId === requestId);
      if (dup) return dup;
    }

    tableNo = Number(tableNo);
    if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > this.config.tables) {
      throw new HttpError(400, '테이블 번호가 올바르지 않습니다.');
    }
    if (!Array.isArray(items)) throw new HttpError(400, '메뉴를 선택해 주세요.');

    const lines = [];
    for (const item of items) {
      const qty = Number(item.qty);
      if (!qty) continue;
      if (!Number.isInteger(qty) || qty < 0 || qty > 99) throw new HttpError(400, '수량이 올바르지 않습니다.');
      const menu = this.menu(item.menuId);
      if (!menu) throw new HttpError(400, '없는 메뉴입니다.');
      if (this.state.soldOut[menu.id]) throw new HttpError(409, `${menu.name}은(는) 품절입니다.`);
      const { names, extra } = this.resolveOptions(menu, item.options);
      const key = JSON.stringify([menu.id, names]);
      const existing = lines.find((l) => l.key === key);
      if (existing) existing.qty += qty;
      else lines.push({ key, menuId: menu.id, name: menu.name, options: names, price: menu.price + extra, station: menu.station, qty });
    }
    if (lines.length === 0) throw new HttpError(400, '메뉴를 선택해 주세요.');

    const tickets = this.config.stations
      .map((s) => ({
        stationId: s.id,
        status: 'pending',
        requestedAt: null,
        servedAt: null,
        items: lines.filter((l) => l.station === s.id).map(({ key, station, ...rest }) => rest),
      }))
      .filter((t) => t.items.length > 0);

    const order = {
      id: this.state.nextOrderId++,
      tableNo,
      note: typeof note === 'string' ? note.trim().slice(0, 100) : '',
      requestId: requestId || null,
      createdAt: new Date().toISOString(),
      cancelled: false,
      total: lines.reduce((sum, l) => sum + l.price * l.qty, 0),
      tickets,
    };
    this.state.orders.push(order);
    this.commit();
    return order;
  }

  setTicketStatus(orderId, stationId, status) {
    if (!STATUSES.includes(status)) throw new HttpError(400, '상태 값이 올바르지 않습니다.');
    const order = this.findOrder(orderId);
    if (order.cancelled) throw new HttpError(409, '취소된 주문입니다.');
    const ticket = order.tickets.find((t) => t.stationId === Number(stationId));
    if (!ticket) throw new HttpError(404, '해당 주방의 주문이 없습니다.');
    applyStatus(ticket, status);
    this.commit();
    return order;
  }

  /** 해당 주방의 '대기' 주문을 모두 '주방 요청'으로 바꾼다. */
  requestAll(stationId) {
    stationId = Number(stationId);
    let count = 0;
    for (const order of this.state.orders) {
      if (order.cancelled) continue;
      for (const ticket of order.tickets) {
        if (ticket.stationId === stationId && ticket.status === 'pending') {
          applyStatus(ticket, 'requested');
          count += 1;
        }
      }
    }
    if (count > 0) this.commit();
    return count;
  }

  setCancelled(orderId, cancelled) {
    const order = this.findOrder(orderId);
    order.cancelled = !!cancelled;
    this.commit();
    return order;
  }

  setSoldOut(menuId, soldOut) {
    if (!this.menu(menuId)) throw new HttpError(404, '없는 메뉴입니다.');
    if (soldOut) this.state.soldOut[menuId] = true;
    else delete this.state.soldOut[menuId];
    this.commit();
  }

  reset() {
    if (this.filePath && fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, `${this.filePath}.backup-${Date.now()}`);
    }
    this.state = emptyState();
    this.commit();
  }
}

function applyStatus(ticket, status) {
  const now = new Date().toISOString();
  ticket.status = status;
  if (status === 'pending') {
    ticket.requestedAt = null;
    ticket.servedAt = null;
  } else if (status === 'requested') {
    ticket.requestedAt = ticket.requestedAt || now;
    ticket.servedAt = null;
  } else {
    ticket.requestedAt = ticket.requestedAt || now;
    ticket.servedAt = now;
  }
}

module.exports = { Store, HttpError, STATUSES, normalizeMenus };
