/* Проверка расчёта процентов. Запуск: node tools\test-calc.cjs */
'use strict';
const { loadApp } = require('./harness.cjs');
const T = loadApp();

let failed = 0;
const near = (a, b, eps, label) => {
  const ok = Math.abs(a - b) <= eps;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: получилось ${a.toFixed(4)}, ожидалось ${b.toFixed(4)} (±${eps})`);
};
const eq = (a, b, label) => {
  const ok2 = a === b;
  if (!ok2) failed++;
  console.log(`${ok2 ? 'PASS' : 'FAIL'}  ${label}: ${a} (ожидалось ${b})`);
};
const ok = (cond, label) => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

const D = 0.12 / 365; // дневная ставка для 12 % годовых
T.setSettings({ compound: true });

/* 1. В день выдачи процентов нет */
let d = { principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] };
let r = T.compute(d, '2026-01-01');
eq(r.days, 0, 'день выдачи: дней начисления');
near(r.balance, 1000, 1e-9, 'день выдачи: остаток');

/* 2. Год с капитализацией (2026 — не високосный, ровно 365 дней) */
r = T.compute(d, '2027-01-01');
eq(r.days, 365, 'год: дней');
near(r.balance, 1000 * Math.pow(1 + D, 365), 0.005, 'год, капитализация');
near(r.accrued, r.balance - 1000, 1e-6, 'год: проценты = остаток − тело');

/* 3. Год без капитализации (простые проценты) */
T.setSettings({ compound: false });
r = T.compute(d, '2027-01-01');
near(r.balance, 1120, 0.005, 'год, простые проценты');
T.setSettings({ compound: true });

/* 4. Один день: 1000 € × 12 % / 365 */
r = T.compute(d, '2026-01-02');
near(r.accrued, 1000 * D, 1e-9, 'один день процентов');

/* 5. Оплата 500 € на второй день, всего 30 дней */
d = { principal: 1000, rate: 12, startDate: '2026-01-01', payments: [{ id: 'p1', date: '2026-01-02', amount: 500 }] };
r = T.compute(d, '2026-01-31');
eq(r.days, 30, 'с оплатой: дней');
near(r.paid, 500, 1e-9, 'с оплатой: оплачено');
near(r.principal, 500 + 1000 * D, 1e-9, 'с оплатой: тело после оплаты (сначала гасятся проценты)');
near(r.balance, (500 + 1000 * D) * Math.pow(1 + D, 29), 0.005, 'с оплатой: остаток');

/* 6. Оплата в дату выдачи уменьшает тело сразу */
d = { principal: 1000, rate: 12, startDate: '2026-01-01', payments: [{ id: 'p1', date: '2026-01-01', amount: 400 }] };
r = T.compute(d, '2026-01-31');
near(r.principal, 600, 1e-9, 'оплата в дату выдачи: тело');
near(r.accrued, 600 * (Math.pow(1 + D, 30) - 1), 1e-6, 'оплата в дату выдачи: проценты');

/* 7. Закрытый долг замирает на дате закрытия */
d = { principal: 1000, rate: 12, startDate: '2026-01-01', endDate: '2026-01-31', payments: [] };
const closed = T.compute(d, '2026-06-01');
near(closed.balance, T.compute({ ...d, endDate: null }, '2026-01-31').balance, 1e-9, 'закрытый долг не растёт');
eq(closed.days, 30, 'закрытый долг: дней');
eq(closed.closed, true, 'закрытый долг: флаг');

/* 8. Нулевая ставка и переплата */
d = { principal: 1000, rate: 0, startDate: '2026-01-01', payments: [{ id: 'p', date: '2026-02-01', amount: 1200 }] };
r = T.compute(d, '2027-01-01');
near(r.balance, -200, 1e-9, 'нулевая ставка: переплата');

/* 9. Выплаты сверх остатка не начисляют проценты */
d = { principal: 100, rate: 50, startDate: '2026-01-01', payments: [{ id: 'p', date: '2026-01-05', amount: 500 }] };
r = T.compute(d, '2026-06-01');
const before = T.compute(d, '2026-01-05').balance;
near(r.balance, before, 1e-9, 'после переплаты проценты не капают');

/* 10. Разбор чисел, округление, даты */
eq(T.parseNum('1 000,50'), 1000.5, 'parseNum: "1 000,50"');
eq(T.parseNum('12.5'), 12.5, 'parseNum: "12.5"');
ok(Number.isNaN(T.parseNum('abc')), 'parseNum: "abc" → NaN');
eq(T.round2(1.005), 1.01, 'round2: 1.005 → 1.01');
eq(T.addDays('2028-02-28', 1), '2028-02-29', 'addDays: 28.02.2028 + 1');
eq(T.daysBetween('2028-02-28', '2028-03-01'), 2, 'daysBetween через 29 февраля');

console.log(failed ? `\n${failed} проверок провалено` : '\nРасчёт: все проверки пройдены');
process.exit(failed ? 1 : 0);
