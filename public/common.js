'use strict';

/* 모든 화면이 함께 쓰는 도우미: 실시간 연결, API 호출, 표시 형식 */
const Kiosk = (() => {
  const STATUS_LABEL = { pending: '대기', requested: '주방 요청', served: '서빙 완료' };

  const PING_INTERVAL_MS = 5000;
  const SLOW_MS = 300;        // 이 이상이면 노란색으로 표시
  let connected = false;
  let latency = null;         // 최근 왕복 지연 시간(ms)

  function renderConn() {
    const el = document.getElementById('conn');
    if (!el) return;
    const slow = connected && latency != null && latency >= SLOW_MS;
    el.classList.toggle('ok', connected && !slow);
    el.classList.toggle('slow', slow);
    el.classList.toggle('bad', !connected);
    el.textContent = !connected
      ? '연결 끊김 — 재연결 중'
      : latency == null ? '연결됨' : `연결됨 · ${latency}ms`;
  }

  function setConn(ok) {
    if (!ok) latency = null;
    if (ok !== connected) {
      connected = ok;
      if (ok) ping();
    }
    renderConn();
  }

  /** 서버까지 왕복 시간을 잰다. */
  async function ping() {
    if (!connected) return;
    const t0 = performance.now();
    try {
      const res = await fetch('/api/ping', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      latency = Math.round(performance.now() - t0);
    } catch {
      latency = null;
    }
    renderConn();
  }
  setInterval(ping, PING_INTERVAL_MS);

  /** 서버에서 전체 상태를 실시간으로 받는다. 끊기면 자동으로 다시 연결하고 최신 상태를 새로 받는다. */
  function connect(onState) {
    let source;
    let retryTimer;
    const open = () => {
      clearTimeout(retryTimer);
      source = new EventSource('/api/events');
      source.onopen = () => setConn(true);
      source.onmessage = (e) => {
        setConn(true);
        onState(JSON.parse(e.data));
      };
      source.onerror = () => {
        setConn(false);
        if (source.readyState === EventSource.CLOSED) {
          retryTimer = setTimeout(open, 2000);
        }
      };
    };
    open();
  }

  async function api(path, body, headers = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `요청 실패 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(message, isError = false) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 4000 : 2500);
  }

  const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

  const time = (iso) =>
    new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

  function elapsedMinutes(iso) {
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  }

  function elapsed(iso) {
    const min = elapsedMinutes(iso);
    return min < 1 ? '방금' : `${min}분 전`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function requestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /** 화면 꺼짐 방지 (HTTPS 또는 localhost 에서만 동작) */
  async function keepAwake() {
    if (!('wakeLock' in navigator)) return false;
    const acquire = async () => {
      try {
        await navigator.wakeLock.request('screen');
      } catch {
        /* 지원하지 않거나 거부됨 */
      }
    };
    await acquire();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') acquire();
    });
    return true;
  }

  /** Lucide 아이콘을 인라인 SVG 문자열로 돌려준다. (public/icons.js 필요) */
  function icon(name, className = '') {
    const body = (window.LUCIDE_ICONS || {})[name];
    if (!body) return '';
    return `<svg class="icon ${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  /** HTML 에 적어 둔 <i data-icon="이름"></i> 을 아이콘으로 바꾼다. */
  function renderIcons(root = document) {
    for (const el of root.querySelectorAll('i[data-icon]')) {
      el.outerHTML = icon(el.dataset.icon, el.className);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => renderIcons());
  else renderIcons();

  return { STATUS_LABEL, icon, renderIcons, connect, api, toast, won, time, elapsed, elapsedMinutes, esc, requestId, keepAwake };
})();
