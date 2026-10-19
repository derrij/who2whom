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

/* ---------- способ расчёта процентов ---------- */
const BASE_LABELS = {
  act365: 'база 365',
  actact: 'база «365 или 366»',
  act360: 'база 360',
};
const COMPOUND_LABELS = {
  monthly: 'зачисление раз в месяц',
  yearly: 'зачисление раз в год',
  none: 'без капитализации',
  daily: 'капитализация ежедневно',
};
/* значения по умолчанию — как у накопительного счёта в банке еврозоны */
const METHOD_PRESETS = [
  { key: 'eur-monthly', title: 'EUR-банк: раз в месяц', base: 'act365', compounding: 'monthly' },
  { key: 'eur-yearly', title: 'EUR-банк: раз в год', base: 'act365', compounding: 'yearly' },
  { key: 'simple-365', title: 'Простые проценты, 365', base: 'act365', compounding: 'none' },
  { key: 'ru-deposit', title: 'Вклад 365/366', base: 'actact', compounding: 'none' },
  { key: 'daily', title: 'Капитализация ежедневно', base: 'act365', compounding: 'daily' },
  { key: 'loans-360', title: 'Кредит, база 360', base: 'act360', compounding: 'none' },
];

let data = { debts: [] };
let settings = { base: 'act365', compounding: 'monthly' };
let filter = 'all';
let deferredPrompt = null;

/* настройки из старых версий: было поле compound (да/нет) */
function migrateSettings(s) {
  const out = Object.assign({ base: 'act365', compounding: 'monthly' }, s || {});
  if (s && typeof s.compound === 'boolean' && s.compounding === undefined) {
    out.compounding = s.compound ? 'daily' : 'none';
  }
  delete out.compound;
  return out;
}

function load() {
  try {
    const d = JSON.parse(store.get(KEY_DATA) || 'null');
    if (d && Array.isArray(d.debts)) data = d;
  } catch (e) { console.warn('данные не прочитаны', e); }
  try {
    const s = JSON.parse(store.get(KEY_SET) || 'null');
    if (s && typeof s === 'object') settings = migrateSettings(s);
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

/* ---------- календарь и базы дней ---------- */
const MONTH_FMT = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' });
const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return MONTH_FMT.format(new Date(Date.UTC(y, m - 1, 1)));
};
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const yearOfDay = (d) => new Date(d * 86400000).getUTCFullYear();
const monthKey = (d) => ymdFromDay(d).slice(0, 7);

/* знаменатель дневной ставки: 365, 360 или 366 в високосном году */
function dayDenominator(day, base) {
  if (base === 'act360') return 360;
  if (base === 'actact') return isLeapYear(yearOfDay(day)) ? 366 : 365;
  return 365;
}

/* дни, когда проценты зачисляются в тело долга */
function periodEnds(fromDay, toDay, compounding) {
  const set = new Set();
  if (compounding !== 'monthly' && compounding !== 'yearly') return set;
  let y = yearOfDay(fromDay);
  let m = new Date(fromDay * 86400000).getUTCMonth();
  while (true) {
    const last = compounding === 'yearly'
      ? Date.UTC(y, 11, 31) / 86400000
      : Date.UTC(y, m + 1, 0) / 86400000; // последний день месяца
    if (last > toDay) break;
    if (last >= fromDay) set.add(last);
    if (compounding === 'yearly') y++;
    else { m++; if (m > 11) { m = 0; y++; } }
  }
  return set;
}

/* ---------- расчёт долга ----------
   direction: 'lent'  — я дал в долг (мне должны)
              'borrowed' — я взял в долг (я должен)

   Проценты начисляются за каждый день на остаток (база 365/360/365-366),
   а зачисляются в тело долга в зависимости от способа:
     monthly — в последний день месяца, с округлением до копеек (банковская схема)
     yearly  — 31 декабря, с округлением до копеек
     daily   — каждый день (капитализация непрерывная)
     none    — не зачисляются, копятся отдельно (простые проценты)

   balance = тело долга + начисленное, но ещё не зачисленное
------------------------------------------------- */
function compute(debt, asOfStr = todayISO(), opt = settings) {
  const base = opt.base || 'act365';
  const compounding = opt.compounding || 'none';
  const start = debt.startDate || asOfStr;
  const end = debt.endDate && debt.endDate < asOfStr ? debt.endDate : asOfStr;
  const startDay = dayNum(start);
  const n = Math.max(0, daysBetween(start, end));
  const rate = Math.max(0, Number(debt.rate) || 0) / 100;

  let principal = Number(debt.principal) || 0;
  let accrued = 0;   // начислено, но ещё не зачислено в тело долга
  let credited = 0;  // зачислено процентами за всё время
  let paid = 0;      // оплачено всего

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

  const ends = periodEnds(startDay, startDay + n, compounding);
  const rows = [];
  let row = null;

  for (let k = 1; k <= n; k++) {
    const d = startDay + k;

    const key = monthKey(d);
    if (!row || row.key !== key) {
      if (row) row.balanceEnd = principal + accrued;
      row = { key, days: 0, accrued: 0, credited: 0, payments: 0, balanceEnd: 0, pending: false };
      rows.push(row);
    }
    row.days++;

    if (rate > 0) {
      const basis = compounding === 'daily' ? principal + accrued : principal;
      if (basis > 0) {
        const dayInterest = basis * rate / dayDenominator(d, base);
        accrued += dayInterest;
        row.accrued += dayInterest;
      }
    }

    const pay = byDay.get(d);
    if (pay) { apply(pay); row.payments += pay; }

    if (ends.has(d)) {
      const toCredit = round2(accrued);
      if (toCredit !== 0) {
        principal += toCredit;
        credited += toCredit;
        accrued -= toCredit;
        row.credited = toCredit;
      }
      row.pending = false;
    }
  }

  if (row) {
    row.balanceEnd = principal + accrued;
    if (row.accrued > 0 && !ends.has(startDay + n)) row.pending = true;
  }

  return {
    balance: principal + accrued,
    principal,
    accrued,
    credited,
    interest: credited + accrued, // всего начислено процентов за время долга
    paid,
    days: n,
    start,
    end: debt.endDate || null,
    rows,
    base,
    compounding,
    closed: !!debt.endDate,
  };
}

/* эффективная годовая ставка для текущего способа расчёта (сравнить со ставкой банка) */
function effectiveRate(debt, opt = settings) {
  const r = Number(debt.rate) || 0;
  if (!(r > 0)) return 0;
  const start = debt.startDate || todayISO();
  const probe = { principal: 1000, rate: r, startDate: start, payments: [], endDate: null };
  const res = compute(probe, addDays(start, 365), opt);
  return (res.balance / 1000 - 1) * 100;
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
    r.interest > 0.005 ? `проценты ${money(r.interest)}` : null,
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
  const eff = d.rate > 0 ? effectiveRate(d) : 0;
  const methodText = `${BASE_LABELS[r.base]} · ${COMPOUND_LABELS[r.compounding]}`;
  const showCredited = r.compounding === 'monthly' || r.compounding === 'yearly';
  const monthsTable = !r.rows.length ? '' : `
    <table class="months">
      <thead>
        <tr><th>Месяц</th><th>Дней</th><th>Начислено</th>${showCredited ? '<th>Зачислено</th>' : ''}<th>Остаток</th></tr>
      </thead>
      <tbody>
        ${r.rows.map((row) => `<tr>
          <td>${esc(monthLabel(row.key))}</td>
          <td class="num">${row.days}</td>
          <td class="num">${money(row.accrued)}</td>
          ${showCredited ? `<td class="num">${row.credited ? money(row.credited) : (row.pending ? '<span class="muted">ожидает</span>' : '<span class="muted">—</span>')}</td>` : ''}
          <td class="num">${money(row.balanceEnd)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${showCredited && r.accrued > 0.005 ? '<div class="hint">«Начислено» — проценты за месяц, «зачислено» — сколько из них уже прибавлено к телу долга. Последняя строка может быть неполной: месяц ещё не закончился.</div>' : ''}`;

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
      <div class="row"><span class="k">Начислено, ещё не зачислено</span><span class="v">${money(r.accrued)}</span></div>
      <div class="row"><span class="k">Зачислено процентами за всё время</span><span class="v">${money(r.credited)}</span></div>
      <div class="row"><span class="k">Оплачено всего</span><span class="v">${money(r.paid)}</span></div>
      <div class="row total"><span class="k">К возврату</span><span class="v">${money(r.balance)}</span></div>
    </div>
    <div class="spacer"></div>
    <div class="rows">
      <div class="row"><span class="k">Ставка</span><span class="v">${numFmt.format(d.rate || 0)} % годовых</span></div>
      <div class="row"><span class="k">Способ расчёта</span><span class="v">${esc(methodText)}</span></div>
      ${eff > 0 ? `<div class="row"><span class="k">Эффективная ставка</span><span class="v">≈ ${numFmt.format(eff)} % <span class="muted small">за 365 дней</span></span></div>` : ''}
      <div class="row"><span class="k">Период</span><span class="v">${esc(ruDate(r.start))} → ${esc(ruDate(r.end || todayISO()))}</span></div>
      <div class="row"><span class="k">Дней начисления</span><span class="v">${r.days}</span></div>
      ${d.note ? `<div class="row"><span class="k">Заметка</span><span class="v">${esc(d.note)}</span></div>` : ''}
    </div>
  </div>

  ${monthsTable ? `<div class="card"><h2>Начисления по месяцам</h2>${monthsTable}</div>` : ''}

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
        <div class="hint">Проценты идут на остаток за каждый день использования. Способ расчёта общий для всех долгов, меняется в настройках: сейчас ${esc(BASE_LABELS[settings.base])}, ${esc(COMPOUND_LABELS[settings.compounding])}.</div>
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
  const opt = (value, label, current) =>
    `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;

  const demo = compute({ principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] }, '2027-01-01');
  const demoEff = effectiveRate({ rate: 12, startDate: '2026-01-01' });

  const presets = METHOD_PRESETS.map((p) => {
    const active = p.base === settings.base && p.compounding === settings.compounding;
    return `<button class="chip-btn${active ? ' active' : ''}" data-act="preset" data-base="${p.base}" data-comp="${p.compounding}">${p.title}</button>`;
  }).join('');

  return `
  <button class="btn block back" data-act="back">← Назад</button>
  ${bannerNoStorage()}
  <div class="card">
    <h2>Способ расчёта процентов</h2>
    <p class="small muted">Один способ для всех долгов — как в договоре банка.</p>
    <div class="presets">${presets}</div>

    <div class="field">
      <label>База дней в году</label>
      <select id="setBase">
        ${opt('act365', '365 — фактических дней / 365 (банки в еврозоне)', settings.base)}
        ${opt('actact', '365 или 366 — високосный год делится на 366 (вклады в РФ)', settings.base)}
        ${opt('act360', '360 — как по кредитам и овердрафтам', settings.base)}
      </select>
    </div>

    <div class="field">
      <label>Когда проценты зачисляются в тело долга</label>
      <select id="setCompounding">
        ${opt('monthly', 'Раз в месяц, с капитализацией (обычная схема накопительного счёта)', settings.compounding)}
        ${opt('yearly', 'Раз в год, с капитализацией', settings.compounding)}
        ${opt('none', 'Не зачисляются — копятся отдельно (простые проценты)', settings.compounding)}
        ${opt('daily', 'Каждый день, с капитализацией', settings.compounding)}
      </select>
    </div>

    <div class="rows">
      <div class="row"><span class="k">Выбрано</span><span class="v">${esc(BASE_LABELS[settings.base])} · ${esc(COMPOUND_LABELS[settings.compounding])}</span></div>
      <div class="row"><span class="k">Пример: 1000 € под 12 % за 365 дней</span><span class="v">${money(demo.balance)}</span></div>
      <div class="row"><span class="k">Эффективная ставка</span><span class="v">${numFmt.format(demoEff)} % годовых</span></div>
    </div>
    <div class="hint">Проценты начисляются за каждый день на остаток, начиная со дня, следующего за датой выдачи, по день возврата включительно. При зачислении раз в месяц или в год сумма округляется до копеек — так же, как в выписке банка.</div>
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
      <div class="row"><span class="k">Версия</span><span class="v">1.1</span></div>
      <div class="row"><span class="k">Способ расчёта</span><span class="v">${esc(BASE_LABELS[settings.base])} · ${esc(COMPOUND_LABELS[settings.compounding])}</span></div>
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
  const payload = { app: 'kto-komu', version: 2, exportedAt: new Date().toISOString(), settings, debts: data.debts };
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
      if (obj.settings) settings = migrateSettings(Object.assign({}, settings, obj.settings));
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
function setMethod(patch) {
  if (patch.base) settings.base = patch.base;
  if (patch.compounding) settings.compounding = patch.compounding;
  save();
  render();
}

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
    case 'preset':
      setMethod({ base: el.dataset.base, compounding: el.dataset.comp });
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
  const t = e.target;
  if (t.id === 'importFile') {
    importJSON(t.files && t.files[0]);
    t.value = '';
  }
  if (t.id === 'setBase') setMethod({ base: t.value });
  if (t.id === 'setCompounding') setMethod({ compounding: t.value });
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
