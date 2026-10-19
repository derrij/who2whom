/* Проверка расчёта процентов. Запуск: node tools\test-calc.cjs
   Контрольные суммы посчитаны «в столбик» и сверяются со ставкой банка. */
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
  const ok = a === b;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${a} (ожидалось ${b})`);
};
const ok = (cond, label) => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };
const method = (base, compounding) => T.setSettings({ base, compounding });

/* ============ 1. Банковский метод: база 365, зачисление раз в месяц ============ */
method('act365', 'monthly');
let d = { principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] };

/* за 2026 год: начисление со 2 января по 31 декабря — 364 дня, 12 зачислений */
let r = T.compute(d, '2026-12-31');
eq(r.days, 364, 'банк: дней начисления за 2026 год');
eq(r.rows.length, 12, 'банк: 12 строк по месяцам');
eq(r.rows[0].days, 30, 'банк: в январе 30 дней начисления (с 2 января)');
near(r.rows[0].accrued, 9.8630137, 1e-6, 'банк: начислено за январь');
eq(r.rows[0].credited, 9.86, 'банк: зачислено за январь — 9,86 €');
near(r.rows[0].balanceEnd, 1009.86, 0.01, 'банк: остаток на конец января');
eq(r.rows[1].days, 28, 'банк: в феврале 28 дней');
eq(r.rows[11].days, 31, 'банк: в декабре 31 день');
near(r.balance, 1126.4578, 0.01, 'банк: 1000 € под 12 % к 31.12.2026 (12 зачислений)');
near(r.credited, 126.46, 0.01, 'банк: зачислено за год');
ok(Math.abs(r.accrued) < 0.01, 'банк: непокрытым остаётся только дробь копейки');
near(r.rows.map((x) => x.credited).reduce((s, v) => s + v, 0), r.credited, 1e-9, 'банк: сумма зачисленного по месяцам = зачислено за год');
ok(r.rows.every((x) => Math.abs(x.credited * 100 - Math.round(x.credited * 100)) < 1e-9), 'банк: каждая месячная сумма округлена до копеек');
ok(r.rows.every((x) => !x.pending), 'банк: все прошедшие месяцы зачислены');

/* ещё один день: первое января нового месяца попадает в начисление */
r = T.compute(d, '2027-01-01');
eq(r.days, 365, 'банк: 365 дней начисления');
near(r.balance, 1126.8282, 0.01, 'банк: 1000 € под 12 % за 365 дней');
eq(r.rows.length, 13, 'банк: добавилась строка января 2027');
eq(r.rows[12].days, 1, 'банк: в новой строке один день');
ok(r.rows[12].pending, 'банк: январь 2027 ещё не зачислен');
near(T.effectiveRate(d), 12.6828, 0.002, 'банк: эффективная ставка ≈ 12,68 %');

/* високосный год: база 365, но дней 366 */
r = T.compute({ principal: 1000, rate: 12, startDate: '2028-01-01', payments: [] }, '2029-01-01');
eq(r.days, 366, 'банк: високосный год — 366 дней');
near(r.balance, 1127.1952, 0.01, 'банк: високосный год даёт больше обычного');

/* ============ 2. Оплата внутри месяца ============ */
d = { principal: 1000, rate: 12, startDate: '2026-01-01', payments: [{ id: 'p', date: '2026-01-10', amount: 500 }] };
r = T.compute(d, '2026-01-31');
near(r.paid, 500, 1e-9, 'оплата: учтена');
near(r.balance, 506.43, 0.01, 'оплата 500 € 10 января к 31 января');
eq(r.rows.length, 1, 'оплата: одна строка месяца');
near(r.rows[0].payments, 500, 1e-9, 'оплата: попала в строку месяца');
ok(r.rows[0].accrued > r.rows[0].credited, 'оплата: зачислено с округлением до копеек');

/* ============ 3. Простые проценты ============ */
method('act365', 'none');
r = T.compute({ principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] }, '2027-01-01');
near(r.balance, 1120, 1e-9, 'простые, 365 дней');
near(T.effectiveRate({ rate: 12, startDate: '2026-01-01' }), 12, 1e-9, 'простые: эффективная = номинальной');
near(T.compute({ principal: 1000, rate: 12, startDate: '2028-01-01', payments: [] }, '2029-01-01').balance, 1120.33, 0.005, 'простые, база 365, високосный год');

method('actact', 'none');
near(T.compute({ principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] }, '2027-01-01').balance, 1120, 1e-9, 'вклад 365/366, обычный год');
/* 365 дней високосного года делятся на 366; 1 января 2029 попадает уже в 2029 год и делится на 365 */
near(T.compute({ principal: 1000, rate: 12, startDate: '2028-01-01', payments: [] }, '2028-12-31').balance, 1119.6721, 0.001, 'вклад 365/366: год високосный, 365 дней делятся на 366');
near(T.compute({ principal: 1000, rate: 12, startDate: '2028-01-01', payments: [] }, '2029-01-01').balance, 1120.0009, 0.001, 'вклад 365/366: переход через год');

method('act360', 'none');
near(T.compute({ principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] }, '2027-01-01').balance, 1121.67, 0.005, 'база 360, 365 дней');
near(T.compute({ principal: 1000, rate: 12, startDate: '2028-01-01', payments: [] }, '2029-01-01').balance, 1122, 0.005, 'база 360, 366 дней');

eq(T.dayDenominator(0, 'actact'), 365, 'знаменатель actact, 1970 — не високосный');
eq(T.dayDenominator(Math.round(Date.UTC(2028, 1, 15) / 86400000), 'actact'), 366, 'знаменатель actact, 2028 — високосный');
eq(T.dayDenominator(0, 'act360'), 360, 'знаменатель act360');
eq(T.dayDenominator(0, 'act365'), 365, 'знаменатель act365');

/* ============ 4. Прежние режимы продолжают работать ============ */
method('act365', 'daily');
near(T.compute({ principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] }, '2027-01-01').balance, 1127.4746, 0.005, 'капитализация ежедневно, 365 дней');
near(T.effectiveRate({ rate: 12, startDate: '2026-01-01' }), 12.7475, 0.002, 'ежедневно: эффективная ≈ 12,75 %');

method('act365', 'yearly');
r = T.compute({ principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] }, '2027-12-31');
near(r.balance, 1254.0316, 0.01, 'капитализация раз в год: за два года');
eq(r.rows[11].credited, 119.67, 'раз в год: за 2026 зачислено 119,67 € (364 дня)');
eq(r.rows[23].credited, 134.36, 'раз в год: за 2027 зачислено 134,36 €');
eq(r.rows.length, 24, 'раз в год: 24 строки по месяцам за два года');
near(T.effectiveRate({ rate: 12, startDate: '2026-01-01' }), 12.0039, 0.005, 'раз в год: эффективная ставка за 365 дней');

/* ============ 5. Общие правила ============ */
method('act365', 'monthly');
eq(T.compute({ principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] }, '2026-01-01').days, 0, 'в день выдачи процентов нет');
near(T.compute({ principal: 1000, rate: 12, startDate: '2026-01-01', payments: [] }, '2026-01-01').balance, 1000, 1e-9, 'в день выдачи остаток = тело');

d = { principal: 1000, rate: 12, startDate: '2026-01-01', endDate: '2026-01-31', payments: [] };
const closed = T.compute(d, '2026-06-01');
near(closed.balance, T.compute({ ...d, endDate: null }, '2026-01-31').balance, 1e-9, 'закрытый долг не растёт');
eq(closed.days, 30, 'закрытый долг: дней');
eq(closed.closed, true, 'закрытый долг: флаг');

d = { principal: 1000, rate: 0, startDate: '2026-01-01', payments: [{ id: 'p', date: '2026-02-01', amount: 1200 }] };
near(T.compute(d, '2027-01-01').balance, -200, 1e-9, 'нулевая ставка: переплата');

d = { principal: 100, rate: 50, startDate: '2026-01-01', payments: [{ id: 'p', date: '2026-01-05', amount: 500 }] };
near(T.compute(d, '2026-06-01').balance, T.compute(d, '2026-01-05').balance, 1e-9, 'после переплаты проценты не капают');

d = { principal: 1000, rate: 12, startDate: '2026-01-01', payments: [{ id: 'p', date: '2026-01-01', amount: 400 }] };
r = T.compute(d, '2026-01-31');
near(r.principal, 600 + 600 * 0.12 * 30 / 365, 0.01, 'оплата в дату выдачи уменьшает тело сразу');

/* ============ 6. Настройки и утилиты ============ */
let m = T.migrateSettings({ compound: true });
eq(m.compounding, 'daily', 'миграция: compound: true → ежедневная капитализация');
eq(m.base, 'act365', 'миграция: база по умолчанию');
eq(m.compound, undefined, 'миграция: старое поле убрано');
eq(T.migrateSettings({ compound: false }).compounding, 'none', 'миграция: compound: false → без капитализации');
eq(T.migrateSettings({ base: 'act360', compounding: 'none' }).base, 'act360', 'миграция: новые настройки не портятся');
eq(T.migrateSettings(null).compounding, 'monthly', 'новые настройки по умолчанию — банковский метод');

eq(T.parseNum('1 000,50'), 1000.5, 'parseNum: "1 000,50"');
eq(T.parseNum('12.5'), 12.5, 'parseNum: "12.5"');
ok(Number.isNaN(T.parseNum('abc')), 'parseNum: "abc" → NaN');
eq(T.round2(1.005), 1.01, 'round2: 1.005 → 1.01');
eq(T.addDays('2028-02-28', 1), '2028-02-29', 'addDays: 28.02.2028 + 1');
eq(T.daysBetween('2028-02-28', '2028-03-01'), 2, 'daysBetween через 29 февраля');
eq(T.isLeapYear(2000), true, 'isLeapYear: 2000');
eq(T.isLeapYear(1900), false, 'isLeapYear: 1900');
eq(T.monthLabel('2026-03'), 'март 2026 г.', 'monthLabel');

/* окончания периодов зачисления */
const me = T.periodEnds(T.daysBetween('1970-01-01', '2026-01-15'), T.daysBetween('1970-01-01', '2026-03-15'), 'monthly');
eq(me.size, 2, 'periodEnds: два конца месяца в диапазоне (январь, февраль)');
const ye = T.periodEnds(T.daysBetween('1970-01-01', '2026-01-15'), T.daysBetween('1970-01-01', '2027-06-15'), 'yearly');
eq(ye.size, 1, 'periodEnds: один конец года в диапазоне');
eq(T.periodEnds(0, 100, 'none').size, 0, 'periodEnds: без капитализации периодов нет');

console.log(failed ? `\n${failed} проверок провалено` : '\nРасчёт: все проверки пройдены');
process.exit(failed ? 1 : 0);
