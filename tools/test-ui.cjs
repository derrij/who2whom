/* Проверка экранов и действий (добавить, оплатить, закрыть, удалить).
   Запуск: node tools\test-ui.cjs                                        */
'use strict';
const { loadApp, makeForm, makeEl } = require('./harness.cjs');
const T = loadApp();

let failed = 0;
const ok = (cond, label) => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };
const has = (html, needle, label) => ok(String(html).includes(needle), label + ` — есть «${needle}»`);
const alerts = [];
global.alert = (m) => alerts.push(String(m));

/* ---------- экраны ---------- */
const seed = [
  {
    id: 'a1', counterparty: 'Иван', direction: 'lent', principal: 1000, rate: 12,
    startDate: '2026-01-01', note: 'на ремонт', payments: [{ id: 'p1', date: '2026-02-01', amount: 200, note: 'перевод' }],
    endDate: null, createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'b2', counterparty: 'Мария', direction: 'borrowed', principal: 500, rate: 0,
    startDate: '2026-03-10', note: '', payments: [], endDate: null, createdAt: '2026-03-10T00:00:00.000Z',
  },
];
T.setData({ debts: JSON.parse(JSON.stringify(seed)) });

const list = T.viewList();
has(list, 'Иван', 'список');
has(list, 'Мария', 'список');
has(list, 'Мне должны', 'сводка');
has(list, 'Я должен', 'сводка');
has(list, 'Сальдо', 'сводка');
has(list, '＋ Добавить долг', 'кнопка добавления');
ok((list.match(/class="debt /g) || []).length === 2, 'в списке две карточки');

const detail = T.viewDetail(T.data.debts[0]);
has(detail, 'Расчёт', 'детали долга');
has(detail, 'К возврату', 'детали долга');
has(detail, 'тело', 'детали долга: остаток тела');
has(detail, 'Иван', 'детали долга: имя');
has(detail, 'Погасить полностью', 'детали долга: закрытие');
has(detail, 'перевод', 'детали долга: оплата в списке');
has(detail, 'Зачислено процентами', 'детали долга: зачисленные проценты');
has(detail, 'Начислено, ещё не зачислено', 'детали долга: незачисленные проценты');
has(detail, 'Способ расчёта', 'детали долга: способ расчёта');
has(detail, 'Эффективная ставка', 'детали долга: эффективная ставка');
has(detail, 'Начисления по месяцам', 'детали долга: разбивка по месяцам');
has(detail, 'март 2026 г.', 'детали долга: строки месяцев');

const closedDebt = { ...T.data.debts[0], endDate: '2026-04-01' };
has(T.viewDetail(closedDebt), 'Открыть заново', 'закрытый долг: можно открыть заново');
has(T.viewDetail(closedDebt), 'закрыт', 'закрытый долг: пометка');

has(T.viewForm(null), 'Новый долг', 'форма нового долга');
has(T.viewForm(T.data.debts[1]), 'Изменить долг', 'форма редактирования');
has(T.viewForm(T.data.debts[1]), 'borrowed', 'форма: направление подставлено');
has(T.viewSettings(), 'Способ расчёта процентов', 'настройки');
has(T.viewSettings(), 'EUR-банк: раз в месяц', 'настройки: пресет банка');
has(T.viewSettings(), 'Пример: 1000', 'настройки: пример расчёта');
has(T.viewSettings(), 'Скачать копию', 'настройки: экспорт');

/* маршруты */
T.setData({ debts: JSON.parse(JSON.stringify(seed)) });
const route = (hash) => { global.location.hash = hash; return T.routeHTML(); };
has(route('#/'), 'Сальдо', 'маршрут: список');
has(route('#/new'), 'Новый долг', 'маршрут: новый долг');
has(route('#/settings'), 'Способ расчёта', 'маршрут: настройки');
has(route('#/debt/a1'), 'Расчёт', 'маршрут: детали');
has(route('#/debt/a1/edit'), 'Изменить долг', 'маршрут: редактирование');
has(route('#/debt/нет-такого'), 'Сальдо', 'маршрут: неизвестный id → список');

/* ---------- добавление долга ---------- */
T.setData({ debts: [] });
alerts.length = 0;
T.saveDebt(makeForm({ counterparty: '', principal: '100', rate: '0', startDate: '2026-05-01', direction: 'lent' }));
ok(T.data.debts.length === 0, 'пустое имя: долг не создан');
ok(alerts.length === 1, 'пустое имя: показано предупреждение');

alerts.length = 0;
T.saveDebt(makeForm({ counterparty: 'Пётр', principal: '-5', rate: '0', startDate: '2026-05-01', direction: 'lent' }));
ok(T.data.debts.length === 0, 'отрицательная сумма: долг не создан');

T.saveDebt(makeForm({ counterparty: 'Пётр', principal: '1 200,50', rate: '7,5', startDate: '2026-05-01', direction: 'borrowed', note: 'займ' }));
ok(T.data.debts.length === 1, 'долг добавлен');
const created = T.data.debts[0];
ok(created.counterparty === 'Пётр', 'имя записано');
ok(created.principal === 1200.5, 'сумма разобрана: 1 200,50 → 1200.5');
ok(created.rate === 7.5, 'ставка разобрана: 7,5 → 7.5');
ok(created.direction === 'borrowed', 'направление записано');
ok(created.note === 'займ', 'заметка записана');
ok(global.location.hash === '#/debt/' + created.id, 'после добавления открылись детали');
ok(T.storage().has('kto-komu:data:v1'), 'данные сохранены в хранилище');
ok(JSON.parse(T.storage().get('kto-komu:data:v1')).debts.length === 1, 'в хранилище один долг');

/* пустая ставка → 0, а не NaN */
T.saveDebt(makeForm({ counterparty: 'Аня', principal: '10', rate: '', startDate: '2026-05-01', direction: 'lent' }));
ok(T.data.debts[1].rate === 0, 'пустая ставка → 0');

/* ---------- редактирование ---------- */
const editForm = makeForm({ counterparty: 'Пётр В.', principal: '2000', rate: '10', startDate: '2026-05-02', direction: 'borrowed' }, created.id);
T.saveDebt(editForm);
ok(T.data.debts.length === 2, 'редактирование не создало второй долг');
ok(T.data.debts[0].counterparty === 'Пётр В.' && T.data.debts[0].principal === 2000, 'правки применены');
ok((T.data.debts[0].payments || []).length === 0, 'правки не тронули оплаты');

/* ---------- оплата ---------- */
T.savePayment(makeForm({ amount: '300', date: '2026-06-01', note: 'наличные' }, created.id));
ok(T.data.debts[0].payments.length === 1, 'оплата добавлена');
ok(T.data.debts[0].payments[0].amount === 300, 'сумма оплаты');
alerts.length = 0;
T.savePayment(makeForm({ amount: '0', date: '2026-06-01' }, created.id));
ok(T.data.debts[0].payments.length === 1, 'нулевая оплата не добавлена');
ok(alerts.length === 1, 'нулевая оплата: предупреждение');

/* ---------- закрытие полностью ---------- */
const debt = T.data.debts[0];
const beforeBalance = T.compute(debt, T.todayISO()).balance;
T.handleAction(makeEl('settle', { id: debt.id }));
ok(!!debt.endDate, 'долг закрыт');
ok(Math.abs(T.compute(debt, T.todayISO()).balance) < 1e-6, 'после закрытия остаток ноль');
ok(T.compute(debt, '2030-01-01').balance === T.compute(debt, T.todayISO()).balance, 'после закрытия проценты не растут');
ok(debt.payments.length === 2, 'закрытие добавило оплату');
ok(Math.abs(debt.payments[1].amount - beforeBalance) < 1e-6, 'оплата равна остатку');

/* закрытый долг не учитывается в итогах */
T.setData({ debts: [debt] });
ok(T.totals().iOwe === 0, 'закрытый долг вне итогов');

/* ---------- повторное открытие, удаление оплаты, удаление долга ---------- */
T.handleAction(makeEl('reopen', { id: debt.id }));
ok(!debt.endDate, 'долг открыт заново');

const payId = debt.payments[0].id;
T.handleAction(makeEl('delpay', { id: debt.id, pay: payId }));
ok(debt.payments.every((p) => p.id !== payId), 'оплата удалена');

T.handleAction(makeEl('del', { id: debt.id }));
ok(T.data.debts.length === 0, 'долг удалён');

/* ---------- настройки: способ расчёта ---------- */
ok(T.settings.base === 'act365' && T.settings.compounding === 'monthly', 'по умолчанию банковский метод');
T.handleAction(makeEl('preset', { base: 'actact', comp: 'none' }));
ok(T.settings.base === 'actact' && T.settings.compounding === 'none', 'пресет применяется');
ok(JSON.parse(T.storage().get('kto-komu:settings:v1')).base === 'actact', 'способ расчёта сохраняется в хранилище');
has(T.viewSettings(), 'Вклад 365/366', 'настройки: активный пресет отмечен');

T.setMethod({ compounding: 'daily' });
ok(T.settings.base === 'actact' && T.settings.compounding === 'daily', 'setMethod меняет только переданное поле');
T.setMethod({ base: 'act365', compounding: 'monthly' });

/* чем чаще капитализация, тем больше итог */
T.setData({ debts: [{
  id: 'x', counterparty: 'Тест', direction: 'lent', principal: 1000, rate: 12,
  startDate: '2026-01-01', payments: [], endDate: null, note: '',
}] });
const sumWith = (compounding) => { T.setMethod({ base: 'act365', compounding }); return T.totals().cache.get('x').balance; };
const mSimple = sumWith('none');
const mMonthly = sumWith('monthly');
const mDaily = sumWith('daily');
ok(mSimple < mMonthly && mMonthly < mDaily,
  `чаще зачисление — больше итог: простые ${mSimple.toFixed(2)} < месячные ${mMonthly.toFixed(2)} < ежедневные ${mDaily.toFixed(2)}`);
/* разница ежедневной и простой капитализации сверяется с формулой сложного процента */
const elapsed = T.daysBetween('2026-01-01', T.todayISO());
const expectDiff = 1000 * (Math.pow(1 + 0.12 / 365, elapsed) - 1) - 1000 * 0.12 * elapsed / 365;
ok(Math.abs((mDaily - mSimple) - expectDiff) < 0.02, `разница за ${elapsed} дн. совпадает с формулой (${expectDiff.toFixed(2)} €)`);
T.setMethod({ base: 'act365', compounding: 'monthly' });

/* ---------- экспорт не падает ---------- */
let threw = null;
try { T.exportJSON(); } catch (e) { threw = e.message; }
ok(!threw, 'экспорт JSON выполняется без ошибок' + (threw ? ': ' + threw : ''));

/* ---------- демонстрационные числа ---------- */
T.setData({ debts: JSON.parse(JSON.stringify(seed)) });
const t = T.totals();
ok(t.cache.get('a1').accrued > 0, 'по долгу со ставкой проценты начислены');
ok(t.cache.get('a1').paid === 200, 'оплата учтена');
ok(t.cache.get('b2').balance === 500, 'долг без процентов равен телу');

console.log(failed ? `\n${failed} проверок провалено` : '\nЭкраны и действия: все проверки пройдены');
process.exit(failed ? 1 : 0);
