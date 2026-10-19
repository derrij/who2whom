"""Независимая сверка: та же спецификация, но написанная отдельно от app.js.
Дневное начисление, зачисление в конце месяца с округлением до копеек."""
import math
from datetime import date, timedelta

DAY = timedelta(days=1)


def r2(x):
    # как Math.round в JS: округление половины вверх
    return math.floor(x * 100 + 0.5) / 100 if x >= 0 else -math.floor(-x * 100 + 0.5) / 100


def last_day_of_month(d):
    if d.month == 12:
        nxt = date(d.year + 1, 1, 1)
    else:
        nxt = date(d.year, d.month + 1, 1)
    return nxt - DAY


def bank(principal, rate, start, as_of, payments=(), base=365, compounding="monthly"):
    pay = {}
    for p in payments:
        pay[p[0]] = pay.get(p[0], 0.0) + p[1]

    body = float(principal)
    accrued = 0.0
    credited = 0.0
    rows = {}
    day = start
    while day < as_of:
        day = day + DAY
        key = day.strftime("%Y-%m")
        row = rows.setdefault(key, {"accrued": 0.0, "credited": 0.0, "days": 0})
        row["days"] += 1
        if rate > 0:
            basis = body + accrued if compounding == "daily" else body
            if basis > 0:
                interest = basis * (rate / 100.0) / base
                accrued += interest
                row["accrued"] += interest
        if day in pay:
            rem = pay[day]
            if accrued > 0:
                use = min(rem, accrued)
                accrued -= use
                rem -= use
            body -= rem
        if (compounding == "monthly" and day == last_day_of_month(day)) or \
           (compounding == "yearly" and day.month == 12 and day.day == 31):
            c = r2(accrued)
            if c != 0:
                body += c
                credited += c
                accrued -= c
                row["credited"] = c
    return {"balance": body + accrued, "body": body, "accrued": accrued,
            "credited": credited, "rows": rows}


d = date(2026, 1, 1)
start = d
res = bank(1000, 12, start, date(2027, 1, 1))
print("BANK act365/monthly 1000 EUR 12% 2026-01-01 -> 2027-01-01")
print(f"  balance = {res['balance']:.10f}  (ожидание в тесте: 1126.81)")
print(f"  rounded to cents = {r2(res['balance']):.2f}")
print(f"  credited total = {res['credited']:.2f}, accrued left = {res['accrued']:.10f}")
print("  по месяцам:")
for k in sorted(res["rows"]):
    row = res["rows"][k]
    print(f"    {k}: дней {row['days']}, начислено {row['accrued']:.6f}, зачислено {row['credited']:.2f}")
print(f"  эффективная ставка за 365 дней = {(res['balance'] / 1000 - 1) * 100:.4f} %")

res2 = bank(1000, 12, date(2028, 1, 1), date(2029, 1, 1))
print(f"\nвисокосный 2028: balance = {res2['balance']:.4f} (база 365, дней 366)")

res3 = bank(1000, 12, date(2026, 1, 1), date(2026, 1, 31), payments=[(date(2026, 1, 10), 500)])
print(f"\nоплата 500 EUR 10.01.2026, расчёт на 31.01.2026: balance = {res3['balance']:.6f}")

res4 = bank(1000, 12, date(2026, 1, 1), date(2027, 12, 31), compounding="yearly")
print(f"\nзачисление раз в год (2026-01-01 -> 2027-12-31): balance = {res4['balance']:.6f}, зачислено {res4['credited']:.2f}")
print(f"  первый год зачислено: {res4['rows']['2026-12']['credited']:.2f}")

res5 = bank(1000, 12, date(2026, 1, 1), date(2027, 1, 1), base=360, compounding="none")
print(f"простые, база 360: balance = {res5['balance']:.4f}")

res6 = bank(1000, 12, date(2026, 1, 1), date(2026, 12, 31))
print(f"на 31.12.2026 (364 дня): balance = {res6['balance']:.6f}, зачислено {res6['credited']:.2f}, висит {res6['accrued']:.6f}")
print(f"  эффективная ставка (365 дней от выдачи) = {(bank(1000, 12, date(2026,1,1), date(2027,1,1))['balance']/1000-1)*100:.4f} %")
print(f"  раз в год, эффективная за 365 дней = {(bank(1000, 12, date(2026,1,1), date(2027,1,1), compounding='yearly')['balance']/1000-1)*100:.4f} %")
