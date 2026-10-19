'use strict';

/* ============================================================
   Кто кому — учёт долгов
   Проценты: годовая ставка от остатка, начисление каждый день.
   ============================================================ */

/* ---------- утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const eurFmt = new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const money = (v) => eurFmt.format(v);
const numFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const dayNum = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const ymdFromDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const addDays = (s, n) => ymdFromDay(dayNum(s) + n);
const daysBetween = (a, b) => Math.round(dayNum(b) - dayNum(a));
const ruDate = (s) => dateFmt.format(new Date(dayNum(s) * 86400000));
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const parseNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

/* ---------- хранилище ---------- */
const KEY_DATA = 'kto-komu:data:v1';
const KEY_SET = 'kto-komu:settings:v1';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
};

let canStore = store.set('kto-komu:probe', '1');

let data = { debts: [] };
let settings = { compound: true };
let filter = 'all';
let deferredPrompt = null;

function load() {
  try {
    const d = JSON.parse(store.get(KEY_DATA) || 'null');
    if (d && Array.isArray(d.debts)) data = d;
  } catch (e) { console.warn('данные не прочитаны', e); }
  try {
    const s = JSON.parse(store.get(KEY_SET) || 'null');
    if (s && typeof s === 'object') settings = Object.assign(settings, s);
  } catch (e) { /* ignore */ }
}
function save() {
  if (!store.set(KEY_DATA, JSON.stringify(data))) canStore = false;
  store.set(KEY_SET, JSON.stringify(settings));
}
const findDebt = (id) => data.debts.find((d) => d.id === id) || null;

function formValues(form) {
  const out = {};
  $$('input, textarea, select', form).forEach((el) => { if (el.name) out[el.name] = el.value; });
  return out;
}

/* ---------- расчёт долга ----------
   direction: 'lent'  — я дал в долг (мне должны)
              'borrowed' — я взял в долг (я должен)
   balance = остаток тела долга + неоплаченные начисленные проценты
------------------------------------------------- */
function compute(debt, asOfStr = todayISO(), compound = settings.compound) {
  const start = debt.startDate || asOfStr;
  const asOf = asOfStr;
  const end = debt.endDate && debt.endDate < asOf ? debt.endDate : asOf;
  const startDay = dayNum(start);
  const n = Math.max(0, daysBetween(start, end));
  const dailyRate = Math.max(0, Number(debt.rate) || 0) / 100 / 365;

  let principal = Number(debt.principal) || 0;
  let accrued = 0;
  let paid = 0;

  const apply = (amount) => {
    let rem = amount;
    if (accrued > 0) { const use = Math.min(rem, accrued); accrued -= use; rem -= use; }
    if (rem !== 0) principal -= rem;
  };

  const byDay = new Map();
  for (const p of debt.payments || []) {
    const amt = Number(p.amount) || 0;
    paid += amt;
    const k = dayNum(p.date);
    byDay.set(k, (byDay.get(k) || 0) + amt);
  }
  for (const [k, amt] of byDay) if (k <= startDay) { apply(amt); byDay.delete(k); }

  for (let k = 1; k <= n; k++) {
    if (dailyRate > 0) {
      const base = compound ? principal + accrued : principal;
      if (base > 0) accrued += base * dailyRate;
    }
    const pay = byDay.get(startDay + k);
    if (pay) apply(pay);
  }

  const balance = principal + accrued;
  return {
    balance,
    principal,
    accrued,
    paid,
    days: n,
    start,
    end: debt.endDate || null,
    dailyRate,
    closed: !!debt.endDate,
  };
}

/* обороты по всем долгам */
function totals() {
  let toMe = 0, iOwe = 0;
  const cache = new Map();
  const today = todayISO();
  for (const d of data.debts) {
    const r = compute(d, today);
    cache.set(d.id, r);
    if (d.endDate) continue;
    if (d.direction === 'lent') toMe += r.balance;
    else iOwe += r.balance;
  }
  return { toMe, iOwe, net: toMe - iOwe, cache };
}

/* ---------- виды ---------- */
function header(sub, right = '') {
  return `
  <header class="top">
    <div class="logo">⇄</div>
    <div class="grow">
      <h1>Кто кому</h1>
      <div class="sub">${esc(sub)}</div>
    </div>
    ${right}
  </header>`;
}

function bannerNoStorage() {
  return canStore ? '' : `<div class="banner">Данные не сохраняются: браузер блокирует хранилище для файлов с диска.
    Откройте приложение по адресу <b>http://localhost</b> или <b>https://</b>.</div>`;
}

function viewList() {
  const t = totals();
  const items = data.debts
    .filter((d) => {
      const r = t.cache.get(d.id);
      if (filter === 'closed') return !!d.endDate;
      if (filter === 'lent') return !d.endDate && d.direction === 'lent';
      if (filter === 'borrowed') return !d.endDate && d.direction === 'borrowed';
      return !d.endDate;
    })
    .sort((a, b) => {
      if (!!a.endDate !== !!b.endDate) return a.endDate ? 1 : -1;
      return Math.abs(t.cache.get(b.id).balance) - Math.abs(t.cache.get(a.id).balance);
    });

  const seg = [
    ['all', 'Активные'],
    ['lent', 'Мне должны'],
    ['borrowed', 'Я должен'],
    ['closed', 'Закрытые'],
  ].map(([k, label]) => `<button data-act="filter" data-filter="${k}" class="${filter === k ? 'active' : ''}">${label}</button>`).join('');

  const list = items.length
    ? `<ul class="debts">${items.map((d) => card(d, t.cache.get(d.id))).join('')}</ul>`
    : `<div class="empty"><div class="big">🪙</div>
        ${filter === 'closed' ? 'Закрытых долгов пока нет' : 'Долгов пока нет.<br>Добавьте первый — и всё будет под контролем.'}
      </div>`;

  return `
  ${header('долги и проценты', `<button class="icon-btn" data-act="go" data-to="#/settings" aria-label="Настройки">⚙</button>`)}
  ${bannerNoStorage()}
  <section class="summary">
    <div class="s-card pos"><span>Мне должны</span><strong>${money(t.toMe)}</strong></div>
    <div class="s-card neg"><span>Я должен</span><strong>${money(t.iOwe)}</strong></div>
    <div class="s-card net"><span>Сальдо</span><strong class="${t.net >= 0 ? 'pos' : 'neg'}">${money(t.net)}</strong></div>
  </section>
  <div class="segmented">${seg}</div>
  ${list}
  <button class="fab" data-act="go" data-to="#/new">＋ Добавить долг</button>`;
}

function card(d, r) {
  const lent = d.direction === 'lent';
  const closed = !!d.endDate;
  const bal = Math.abs(r.balance) < 0.005 ? 0 : r.balance;
  const metaText = [
    `тело ${money(r.principal)}`,
    r.accrued > 0.005 ? `проценты ${money(r.accrued)}` : null,
    d.rate > 0 ? `${numFmt.format(d.rate)} % годовых` : null,
    `${r.days} ${plural(r.days, 'день', 'дня', 'дней')}`,
  ].filter(Boolean).join(' · ');

  return `
  <li class="debt ${closed ? 'closed' : ''}" data-act="go" data-to="#/debt/${d.id}">
    <div class="d-top">
      <span class="d-name">${esc(d.counterparty)}</span>
      ${closed
        ? `<span class="chip off">закрыт ${esc(ruDate(d.endDate))}</span>`
        : `<span class="chip ${lent ? 'pos' : 'neg'}">${lent ? 'мне должны' : 'я должен'}</span>`}
    </div>
    <div class="d-amount ${closed ? '' : (lent ? 'pos' : 'neg')}">${money(bal)}</div>
    <div class="d-meta">${metaText}</div>
    <div class="d-meta">с ${esc(ruDate(r.start))}${d.note ? ' · ' + esc(d.note) : ''}</div>
  </li>`;
}

function viewDetail(d) {
  const r = compute(d, todayISO());
  const lent = d.direction === 'lent';
  const bal = Math.abs(r.balance) < 0.005 ? 0 : r.balance;
  const over = r.balance < -0.005;

  const pays = (d.payments || []).slice().sort((a, b) => dayNum(b.date) - dayNum(a.date));
  const payList = pays.length
    ? pays.map((p) => `
      <div class="pay">
        <div>
          <div class="amt">${money(p.amount)}</div>
          <div class="note">${esc(ruDate(p.date))}${p.note ? ' · ' + esc(p.note) : ''}</div>
        </div>
        <button class="mini danger" data-act="delpay" data-id="${d.id}" data-pay="${p.id}">удалить</button>
      </div>`).join('')
    : '<div class="muted small" style="padding:10px 0">Оплат пока не было.</div>';

  return `
  <button class="btn block back" data-act="back">← Назад</button>
  ${bannerNoStorage()}
  <div class="card">
    <div class="d-top">
      <span class="d-name">${esc(d.counterparty)}</span>
      ${d.endDate
        ? `<span class="chip off">закрыт</span>`
        : `<span class="chip ${lent ? 'pos' : 'neg'}">${lent ? 'мне должны' : 'я должен'}</span>`}
    </div>
    <div class="d-amount ${d.endDate ? '' : (lent ? 'pos' : 'neg')}" style="font-size:30px">${money(bal)}</div>
    ${over ? `<div class="small neg">Переплата на ${money(Math.abs(r.balance))}</div>` : ''}
    ${d.endDate ? `<div class="small muted">Закрыт ${esc(ruDate(d.endDate))}, начисление остановлено</div>` : ''}
  </div>

  <div class="card">
    <h2>Расчёт</h2>
    <div class="rows">
      <div class="row"><span class="k">Остаток тела долга</span><span class="v">${money(r.principal)}</span></div>
      <div class="row"><span class="k">Начисленные проценты</span><span class="v">${money(r.accrued)}</span></div>
      <div class="row"><span class="k">Оплачено всего</span><span class="v">${money(r.paid)}</span></div>
      <div class="row total"><span class="k">К возврату</span><span class="v">${money(r.balance)}</span></div>
    </div>
    <div class="spacer"></div>
    <div class="rows">
      <div class="row"><span class="k">Ставка</span><span class="v">${numFmt.format(d.rate || 0)} % годовых${
        d.rate > 0 ? ` <span class="muted small">(${(d.rate / 365).toFixed(4)} %/день)</span>` : ''}</span></div>
      <div class="row"><span class="k">Период</span><span class="v">${esc(ruDate(r.start))} → ${esc(ruDate(r.end || todayISO()))}</span></div>
      <div class="row"><span class="k">Дней начисления</span><span class="v">${r.days}</span></div>
      <div class="row"><span class="k">Капитализация</span><span class="v">${settings.compound ? 'да' : 'нет'}</span></div>
      ${d.note ? `<div class="row"><span class="k">Заметка</span><span class="v">${esc(d.note)}</span></div>` : ''}
    </div>
  </div>

  <div class="card">
    <h2>Оплаты</h2>
    ${payList}
    ${d.endDate ? '' : `
    <div class="spacer"></div>
    <details>
      <summary>Добавить оплату</summary>
      <div class="inner">
        <form id="payForm" data-id="${d.id}">
          <div class="field">
            <label>Сумма, €</label>
            <input name="amount" type="text" inputmode="decimal" placeholder="100,00" required>
          </div>
          <div class="field">
            <label>Дата</label>
            <input name="date" type="date" value="${todayISO()}" required>
          </div>
          <div class="field">
            <label>Комментарий (необязательно)</label>
            <input name="note" type="text" placeholder="перевод на карту">
          </div>
          <button class="btn primary block" type="submit">Записать оплату</button>
          <div class="hint">Оплата сначала гасит начисленные проценты, затем — тело долга.</div>
        </form>
      </div>
    </details>`}
  </div>

  <div class="btn-row">
    ${d.endDate
      ? `<button class="btn" data-act="reopen" data-id="${d.id}">Открыть заново</button>`
      : `<button class="btn primary" data-act="settle" data-id="${d.id}">Погасить полностью</button>`}
    ${d.endDate ? '' : `<button class="btn" data-act="go" data-to="#/debt/${d.id}/edit">Изменить</button>`}
    <button class="btn danger" data-act="del" data-id="${d.id}">Удалить</button>
  </div>`;
}

function viewForm(d) {
  const isEdit = !!d;
  const v = d || {
    id: '', counterparty: '', direction: 'lent', principal: '',
    rate: 0, startDate: todayISO(), note: '',
  };
  return `
  <button class="btn block back" data-act="back">← Назад</button>
  <div class="card">
    <h2>${isEdit ? 'Изменить долг' : 'Новый долг'}</h2>
    <form id="debtForm" data-id="${esc(v.id)}">
      <input type="hidden" name="direction" id="direction" value="${v.direction}">
      <div class="field">
        <label>Направление</label>
        <div class="segmented" style="margin:0">
          <button type="button" data-act="dir" data-dir="lent" class="${v.direction === 'lent' ? 'active' : ''}">Мне должны</button>
          <button type="button" data-act="dir" data-dir="borrowed" class="${v.direction === 'borrowed' ? 'active' : ''}">Я должен</button>
        </div>
      </div>
      <div class="field">
        <label>Кто / кому</label>
        <input name="counterparty" type="text" value="${esc(v.counterparty)}" placeholder="Иван" required>
      </div>
      <div class="field">
        <label>Сумма, €</label>
        <input name="principal" type="text" inputmode="decimal" value="${v.principal === '' ? '' : esc(String(v.principal))}" placeholder="1000" required>
      </div>
      <div class="field">
        <label>Ставка, % годовых</label>
        <input name="rate" type="text" inputmode="decimal" value="${esc(String(v.rate ?? 0))}" placeholder="0">
        <div class="hint">Проценты идут на остаток: ставка ÷ 365 за каждый день, начиная со дня, следующего за датой выдачи.</div>
      </div>
      <div class="field">
        <label>Дата выдачи</label>
        <input name="startDate" type="date" value="${esc(v.startDate)}" required>
      </div>
      <div class="field">
        <label>Заметка (необязательно)</label>
        <textarea name="note" placeholder="договорились вернуть до конца года">${esc(v.note || '')}</textarea>
      </div>
      <button class="btn primary block" type="submit">${isEdit ? 'Сохранить' : 'Добавить долг'}</button>
    </form>
  </div>`;
}

function viewSettings() {
  return `
  <button class="btn block back" data-act="back">← Назад</button>
  ${bannerNoStorage()}
  <div class="card">
    <h2>Проценты</h2>
    <div class="row" style="border:0;padding:0">
      <span class="k" style="max-width:75%">Капитализация: начисленные проценты прибавляются к остатку, и на них тоже идут проценты</span>
      <button class="mini" data-act="toggle-compound">${settings.compound ? 'включена' : 'выключена'}</button>
    </div>
    <div class="hint">Выключено — проценты считаются простые, только на тело долга.</div>
  </div>

  <div class="card">
    <h2>Данные</h2>
    <p class="small muted">Всё хранится только в этом браузере (localStorage). Регулярно делайте копию.</p>
    <div class="btn-row">
      <button class="btn" data-act="export">Скачать копию (JSON)</button>
      <button class="btn" data-act="import">Загрузить копию</button>
    </div>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
  </div>

  <div class="card">
    <h2>Приложение</h2>
    <button class="btn primary block" data-act="install">Установить на телефон</button>
    <div class="hint">В Chrome: меню ⋮ → «Установить приложение» / «Добавить на главный экран». После установки работает офлайн.</div>
    <div class="spacer"></div>
    <button class="btn danger block" data-act="wipe">Удалить все долги</button>
  </div>

  <div class="card">
    <h2>О программе</h2>
    <div class="rows">
      <div class="row"><span class="k">Версия</span><span class="v">1.0</span></div>
      <div class="row"><span class="k">Долгов в базе</span><span class="v">${data.debts.length}</span></div>
      <div class="row"><span class="k">Открытых</span><span class="v">${data.debts.filter((d) => !d.endDate).length}</span></div>
    </div>
  </div>`;
}

/* ---------- маршрутизация ---------- */
function routeHTML() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'new') return viewForm(null);
  if (parts[0] === 'settings') return viewSettings();
  if (parts[0] === 'debt' && parts[1]) {
    const d = findDebt(parts[1]);
    if (!d) return viewList();
    if (parts[2] === 'edit') return viewForm(d);
    return viewDetail(d);
  }
  return viewList();
}

function render(scrollTop = false) {
  $('#app').innerHTML = routeHTML();
  if (scrollTop) window.scrollTo(0, 0);
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

/* ---------- формы ---------- */
function saveDebt(form) {
  const fd = formValues(form);
  const name = String(fd.counterparty || '').trim();
  const amount = parseNum(fd.principal);
  const rate = parseNum(fd.rate);
  const rateVal = Number.isFinite(rate) ? Math.max(0, rate) : 0;
  const startDate = String(fd.startDate || todayISO());
  const note = String(fd.note || '').trim();
  const direction = String(fd.direction || 'lent');

  if (!name) return alert('Укажите, с кем связан долг.');
  if (!Number.isFinite(amount) || amount <= 0) return alert('Сумма должна быть больше нуля.');

  const id = form.dataset.id;
  const existing = id ? findDebt(id) : null;
  if (existing) {
    Object.assign(existing, { counterparty: name, direction, principal: amount, rate: rateVal, startDate, note });
  } else {
    const debt = {
      id: uid(), counterparty: name, direction, principal: amount,
      rate: rateVal, startDate, note, payments: [], endDate: null, createdAt: new Date().toISOString(),
    };
    data.debts.push(debt);
    save();
    return go(`#/debt/${debt.id}`);
  }
  save();
  go(`#/debt/${existing.id}`);
}

function savePayment(form) {
  const d = findDebt(form.dataset.id);
  if (!d) return;
  const fd = formValues(form);
  const amount = parseNum(fd.amount);
  const date = String(fd.date || todayISO());
  const note = String(fd.note || '').trim();
  if (!Number.isFinite(amount) || amount <= 0) return alert('Сумма оплаты должна быть больше нуля.');
  d.payments = d.payments || [];
  d.payments.push({ id: uid(), date, amount, note });
  save();
  render(true);
}

/* ---------- экспорт / импорт ---------- */
function exportJSON() {
  const payload = { app: 'kto-komu', version: 1, exportedAt: new Date().toISOString(), settings, debts: data.debts };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kto-komu-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function importJSON(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const obj = JSON.parse(String(fr.result));
      const list = Array.isArray(obj) ? obj : obj.debts;
      if (!Array.isArray(list)) throw new Error('нет списка долгов');
      let added = 0, updated = 0;
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        if (!raw.counterparty && !raw.principal) continue;
        const item = {
          id: raw.id || uid(),
          counterparty: String(raw.counterparty || 'Без имени'),
          direction: raw.direction === 'borrowed' ? 'borrowed' : 'lent',
          principal: Number(raw.principal) || 0,
          rate: Number(raw.rate) || 0,
          startDate: raw.startDate || todayISO(),
          note: String(raw.note || ''),
          payments: Array.isArray(raw.payments) ? raw.payments : [],
          endDate: raw.endDate || null,
          createdAt: raw.createdAt || new Date().toISOString(),
        };
        const idx = data.debts.findIndex((d) => d.id === item.id);
        if (idx >= 0) { data.debts[idx] = item; updated++; } else { data.debts.push(item); added++; }
      }
      if (obj.settings) settings = Object.assign(settings, obj.settings);
      save();
      render();
      alert(`Импорт готов: добавлено ${added}, обновлено ${updated}.`);
    } catch (e) {
      alert('Не получилось прочитать файл: ' + e.message);
    }
  };
  fr.readAsText(file);
}

/* ---------- установка PWA ---------- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});
async function doInstall() {
  if (!deferredPrompt) {
    alert('Установка недоступна.\n\nВ Chrome откройте меню ⋮ → «Установить приложение» или «Добавить на главный экран».');
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
}

/* ---------- события ---------- */
function handleAction(el) {
  const act = el.dataset.act;
  const id = el.dataset.id;

  switch (act) {
    case 'go':
      go(el.dataset.to);
      break;
    case 'back':
      if (history.length > 1) history.back(); else go('#/');
      break;
    case 'filter':
      filter = el.dataset.filter;
      render();
      break;
    case 'dir': {
      $('#direction').value = el.dataset.dir;
      el.parentElement.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('active', b === el));
      break;
    }
    case 'del': {
      const d = findDebt(id);
      if (!d) break;
      if (!confirm(`Удалить долг «${d.counterparty}» со всеми оплатами? Действие необратимо.`)) break;
      data.debts = data.debts.filter((x) => x.id !== id);
      save();
      go('#/');
      break;
    }
    case 'settle': {
      const d = findDebt(id);
      if (!d) break;
      const r = compute(d, todayISO());
      const amount = Math.max(0, r.balance); // без округления: после закрытия остаток ровно ноль
      if (!confirm(`Закрыть долг «${d.counterparty}»?\n\nБудет записана оплата ${money(amount)} и начисление процентов остановится.`)) break;
      d.payments = d.payments || [];
      if (amount > 0.005) d.payments.push({ id: uid(), date: todayISO(), amount, note: 'Полное погашение' });
      d.endDate = todayISO();
      save();
      render(true);
      break;
    }
    case 'reopen': {
      const d = findDebt(id);
      if (!d) break;
      if (!confirm(`Открыть долг «${d.counterparty}» заново? Проценты продолжат начисляться.`)) break;
      d.endDate = null;
      save();
      render(true);
      break;
    }
    case 'delpay': {
      const d = findDebt(id);
      if (!d) break;
      const payId = el.dataset.pay;
      if (!confirm('Удалить эту оплату?')) break;
      d.payments = (d.payments || []).filter((p) => p.id !== payId);
      save();
      render(true);
      break;
    }
    case 'toggle-compound':
      settings.compound = !settings.compound;
      save();
      render();
      break;
    case 'export':
      exportJSON();
      break;
    case 'import':
      $('#importFile') && $('#importFile').click();
      break;
    case 'install':
      doInstall();
      break;
    case 'wipe':
      if (!confirm('Удалить ВСЕ долги и оплаты? Сначала лучше скачать копию.')) break;
      if (!confirm('Точно удалить? Отменить это будет нельзя.')) break;
      data = { debts: [] };
      save();
      render();
      break;
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) handleAction(el);
});

document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.id === 'debtForm') { e.preventDefault(); saveDebt(f); }
  if (f.id === 'payForm') { e.preventDefault(); savePayment(f); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'importFile') {
    importJSON(e.target.files && e.target.files[0]);
    e.target.value = '';
  }
});

window.addEventListener('hashchange', () => render(true));

/* ---------- старт ---------- */
load();
render();
if (!location.hash) location.hash = '#/';

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW не зарегистрирован', err));
  });
}
