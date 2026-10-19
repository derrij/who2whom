/* Заглушки браузера для тестов в Node. Возвращает внутренние функции app.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function dummyEl() {
  return {
    innerHTML: '', value: '', textContent: '', style: {}, dataset: {},
    click() {}, remove() {}, focus() {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    querySelectorAll: () => [],
    querySelector: () => dummyEl(),
    parentElement: { querySelectorAll: () => [] },
    addEventListener() {},
  };
}

function loadApp() {
  const mem = new Map();
  globalThis.__mem = mem;
  global.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
  global.document = {
    addEventListener() {},
    querySelector: () => dummyEl(),
    querySelectorAll: () => [],
    createElement: () => dummyEl(),
    body: { appendChild() {} },
  };
  global.window = { addEventListener() {}, scrollTo() {} };
  global.location = { hash: '#/', protocol: 'file:' };
  global.history = { length: 1 };
  global.alert = () => {};
  global.confirm = () => true;
  global.Blob = class { constructor(parts) { this.parts = parts; } };
  global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };

  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const exportLine = `
globalThis.__T = {
  compute, todayISO, daysBetween, addDays, parseNum, round2, money, uid,
  totals, viewList, viewDetail, viewForm, viewSettings, routeHTML, render,
  saveDebt, savePayment, handleAction, setMethod, formValues, findDebt, exportJSON,
  migrateSettings, effectiveRate, dayDenominator, periodEnds, monthLabel, isLeapYear,
  get data() { return data; },
  get settings() { return settings; },
  setData(d) { data = d; },
  setSettings(s) { settings = s; },
  storage() { return globalThis.__mem; }
};`;
  vm.runInThisContext(src + exportLine, { filename: 'app.js' });
  return globalThis.__T;
}

/* вспомогательные фабрики для тестов */
const makeForm = (fields, id = '') => ({
  dataset: { id },
  querySelectorAll: () => Object.entries(fields).map(([name, value]) => ({ name, value: String(value) })),
});
const makeEl = (act, extra = {}) => ({
  dataset: Object.assign({ act }, extra),
  classList: { toggle() {} },
  parentElement: { querySelectorAll: () => [] },
});

module.exports = { loadApp, makeForm, makeEl, dummyEl };
