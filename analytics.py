"""Аналитика риска пожара для IoT-детектора (Ирландия).

Запуск: python analytics.py test_data.csv
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")  # без GUI, только сохранение PNG
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

# ---------------------------------------------------------------------------
# Конфиг: все пороги и веса в одном месте
# ---------------------------------------------------------------------------
CONFIG = {
    # Пороги риска: [повышенный, высокий, критический]
    "risk_thresholds": {
        "vpd_kpa":  {"dir": ">",  "levels": [0.7, 1.2, 1.8]},
        "rh_pct":   {"dir": "<",  "levels": [50, 35, 25]},
        "temp_c":   {"dir": ">",  "levels": [15, 20, 25]},
        "wind_ms":  {"dir": ">",  "levels": [5, 8, 10]},
        "dry_days": {"dir": ">=", "levels": [3, 7, 10]},
    },
    # Веса: VPD 0.4, остальные делят 0.6 поровну (нет данных, чтобы обосновать иное)
    "risk_weights": {
        "vpd_kpa": 0.40, "rh_pct": 0.15, "temp_c": 0.15,
        "wind_ms": 0.15, "dry_days": 0.15,
    },
    # Границы уровней риска, %
    "risk_levels": [(0, "низкий"), (25, "умеренный"), (50, "высокий"), (75, "критический")],
    # Сезонный множитель по месяцу (фев-окт = сезон пожаров)
    "season_factor": {m: (1.0 if 2 <= m <= 10 else 0.5) for m in range(1, 13)},
    "rain_day_mm": 1.0,          # день с осадками, если сумма >= 1 мм
    "smooth_window": "60min",    # сглаживание метео-входов риска

    # Обнаружение горения
    "fire": {
        "temp_rate_c_per_min": 8.0,   # рост T, °C/мин
        "temp_abs_c": 57.0,           # абсолютная T
        # Доп. критерий (не из ТЗ): скачок T над фоном. Без него нагрев корпуса
        # солнцем (+37.6 °C за 5 мин = 7.5 °C/мин, 56 °C) не даёт даже "подозрения".
        "temp_jump_c": 15.0,
        "co_rise_ppm": 30.0,          # рост CO над фоном (нижняя граница 30-50)
        "co_crit_ppm": 100.0,         # критичное значение CO
        "pm_ratio": 3.0,              # PM2.5 во столько раз выше фона
        "pm_abs_ugm3": 150.0,         # сильный дым
        "background_window": "120min",  # скользящий фон
        "coincidence_window": "10min",  # окно совпадения сигналов
        "min_signals_fire": 2,
    },
}

LEVEL_COLORS = {"низкий": "#4caf50", "умеренный": "#ffc107",
                "высокий": "#ff7043", "критический": "#c62828"}
LEVEL_ORDER = [name for _, name in CONFIG["risk_levels"]]


# ---------------------------------------------------------------------------
# 1. VPD
# ---------------------------------------------------------------------------
def compute_vpd(temp_c, rh_pct):
    """Дефицит давления пара, кПа (формула Тетенса)."""
    es = 0.6108 * np.exp(17.27 * temp_c / (temp_c + 237.3))
    return es * (1 - rh_pct / 100.0)


# ---------------------------------------------------------------------------
# 2. Риск (до возгорания)
# ---------------------------------------------------------------------------
def _points(values, rule):
    """Балл 0..3 по порогам."""
    lv = rule["levels"]
    if rule["dir"] == ">":
        hits = [values > t for t in lv]
    elif rule["dir"] == ">=":
        hits = [values >= t for t in lv]
    else:
        hits = [values < t for t in lv]
    return sum(h.astype(int) for h in hits)


def dry_days_series(df, cfg=CONFIG):
    """Дни без осадков на каждый момент (причинно, без заглядывания вперёд).

    Сухие сутки подряд до текущих + текущие, если с полуночи выпало < 1 мм.
    История до начала ряда неизвестна: считаем 0, т.е. для первых суток
    значение — нижняя оценка.
    """
    day = df.index.normalize()
    daily_rain = df["rain_mm"].groupby(day).sum()
    before, run = {}, 0
    for d, total in daily_rain.items():
        before[d] = run                   # сухие сутки ДО текущих
        run = 0 if total >= cfg["rain_day_mm"] else run + 1
    rain_so_far = df["rain_mm"].groupby(day).cumsum()
    today_dry = (rain_so_far < cfg["rain_day_mm"]).astype(int).to_numpy()
    return pd.Series(day.map(before), index=df.index, dtype=float) + today_dry


def _level(prob):
    names = [n for _, n in CONFIG["risk_levels"]]
    bins = [b for b, _ in CONFIG["risk_levels"]][1:]
    return pd.Series(np.array(names)[np.digitize(prob, bins, right=True)], index=prob.index)


def risk_score(df, anomaly_mask=None, cfg=CONFIG):
    """Вероятность риска 0-100 % и уровень.

    anomaly_mask: точки, где сенсор T искажён (тревоги горения/нагрева) — они
    исключаются из метео-входов, чтобы не завышать риск.
    """
    met = df[["temp_c", "rh_pct", "wind_ms"]].copy()
    if anomaly_mask is not None:
        met.loc[anomaly_mask, ["temp_c", "rh_pct"]] = np.nan
        met = met.interpolate(limit_direction="both")
    clean = met.copy()
    # сглаживание 1 ч
    met = met.rolling(cfg["smooth_window"], min_periods=1).mean()
    met["vpd_kpa"] = compute_vpd(met["temp_c"], met["rh_pct"])
    met["dry_days"] = dry_days_series(df, cfg)

    score = 0.0
    out = pd.DataFrame(index=df.index)
    for var, w in cfg["risk_weights"].items():
        pts = _points(met[var], cfg["risk_thresholds"][var])
        out[f"pts_{var}"] = pts
        score = score + w * pts
    season = df.index.month.map(cfg["season_factor"]).to_numpy()
    out["risk_prob_meteo"] = (score / 3.0 * 100.0 * season).clip(0, 100).round(1)
    out["dry_days"] = met["dry_days"]
    out["vpd_smooth"] = met["vpd_kpa"]
    # очищенные (без искажённых точек) несглаженные значения — для сводки
    out["temp_clean"] = clean["temp_c"]
    out["rh_clean"] = clean["rh_pct"]
    out["vpd_clean"] = compute_vpd(clean["temp_c"], clean["rh_pct"])
    return out


# ---------------------------------------------------------------------------
# 3. Обнаружение горения
# ---------------------------------------------------------------------------
def detect_fire(df, cfg=CONFIG):
    """Сигналы T/CO/PM и статус: норма / подозрение / пожар."""
    f = cfg["fire"]
    step_min = df.index.to_series().diff().dt.total_seconds().div(60)
    # фон: медиана за предыдущие 2 ч (без текущей точки — устойчив к выбросам)
    bg = df[["temp_c", "co_ppm", "pm25_ugm3"]].rolling(
        f["background_window"], closed="left", min_periods=3).median()
    bg = bg.bfill()

    t_rate = df["temp_c"].diff() / step_min
    sig = pd.DataFrame(index=df.index)
    sig["sig_temp"] = ((t_rate > f["temp_rate_c_per_min"])
                       | (df["temp_c"] > f["temp_abs_c"])
                       | (df["temp_c"] - bg["temp_c"] > f["temp_jump_c"]))
    sig["sig_co"] = ((df["co_ppm"] - bg["co_ppm"] > f["co_rise_ppm"])
                     | (df["co_ppm"] > f["co_crit_ppm"]))
    sig["sig_pm"] = ((df["pm25_ugm3"] >= f["pm_ratio"] * bg["pm25_ugm3"])
                     | (df["pm25_ugm3"] > f["pm_abs_ugm3"]))
    sig["co_critical"] = df["co_ppm"] > f["co_crit_ppm"]
    sig["temp_rate"] = t_rate.round(2)

    sigs = ["sig_temp", "sig_co", "sig_pm"]
    # сигнал «активен», если сработал в окне до 10 мин
    recent = sig[sigs].astype(int).rolling(f["coincidence_window"], closed="both").max()
    n_recent = recent.sum(axis=1)
    any_now = sig[sigs].any(axis=1)
    sig["n_signals"] = sig[sigs].sum(axis=1)
    sig["status"] = np.where(any_now & (n_recent >= f["min_signals_fire"]), "пожар",
                             np.where(any_now, "подозрение", "норма"))
    return sig


def list_events(df, sig):
    """Группировка подряд идущих тревог в события."""
    alarm = sig["status"] != "норма"
    grp = (alarm != alarm.shift()).cumsum()
    step = df.index.to_series().diff().median()
    rows = []
    for _, idx in sig[alarm].groupby(grp[alarm]).groups.items():
        part = sig.loc[idx]
        fired = [n for n, c in [("T", "sig_temp"), ("CO", "sig_co"), ("PM2.5", "sig_pm")]
                 if part[c].any()]
        status = "пожар" if (part["status"] == "пожар").any() else "подозрение"
        d = df.loc[idx]
        rows.append({
            "начало": idx[0], "конец": idx[-1] + step,
            "длительность_мин": int(((idx[-1] + step) - idx[0]).total_seconds() / 60),
            "статус": status, "сигналы": "+".join(fired),
            "T_max": d["temp_c"].max(), "CO_max": d["co_ppm"].max(),
            "PM_max": d["pm25_ugm3"].max(),
            "интерпретация": _interpret(status, fired),
        })
    return pd.DataFrame(rows)


def _interpret(status, fired):
    if status == "пожар":
        return "активное горение"
    if fired == ["T"]:
        return "ложная: нагрев корпуса (солнце)"
    if fired == ["CO"]:
        return "ложная: выхлоп техники"
    if fired == ["PM2.5"]:
        return "пыль/дым издалека"
    return "неясно"


# ---------------------------------------------------------------------------
# 4. Аналитика
# ---------------------------------------------------------------------------
def daily_summary(df):
    """Сводка по суткам (T/RH/VPD — без точек с искажённым сенсором T)."""
    day = df.index.normalize()
    rows = []
    for d, g in df.groupby(day):
        r = g["risk_prob_meteo"]
        # пик: при плато берём момент максимального сглаженного VPD
        peak_t = g.loc[r == r.max(), "vpd_smooth"].idxmax()
        shares = g["risk_level"].value_counts(normalize=True).mul(100)
        row = {
            "дата": d.date(),
            "VPD_ср": g["vpd_clean"].mean(), "VPD_макс": g["vpd_clean"].max(),
            "T_ср": g["temp_clean"].mean(), "T_макс": g["temp_clean"].max(),
            "T_сенсор_макс": g["temp_c"].max(),
            "RH_ср": g["rh_clean"].mean(), "RH_мин": g["rh_clean"].min(),
            "ветер_ср": g["wind_ms"].mean(), "ветер_макс": g["wind_ms"].max(),
            "осадки_мм": g["rain_mm"].sum(),
            "сухих_дней": int(g["dry_days"].iloc[-1]),
            "риск_макс_%": g["risk_prob_meteo"].max(),
            "пик_риска": peak_t.strftime("%H:%M"),
        }
        for lvl in LEVEL_ORDER:
            row[f"{lvl}_%"] = shares.get(lvl, 0.0)
        rows.append(row)
    return pd.DataFrame(rows).set_index("дата").round(2)


def diurnal_profile(df):
    """Суточный ритм риска: средняя вероятность по часу."""
    return df.groupby(df.index.hour)["risk_prob_meteo"].mean().round(1)


def quality_report(df):
    """Confusion matrix и метрики по event_label."""
    cm = pd.crosstab(df["event_label"], df["status"],
                     rownames=["метка"], colnames=["прогноз"])
    for c in ["норма", "подозрение", "пожар"]:
        if c not in cm.columns:
            cm[c] = 0
    cm = cm[["норма", "подозрение", "пожар"]]
    is_fire = df["event_label"] == "fire"
    pred_fire = df["status"] == "пожар"
    tp = int((is_fire & pred_fire).sum())
    fp = int((~is_fire & pred_fire).sum())
    fn = int((is_fire & ~pred_fire).sum())
    fa_labels = df["event_label"].str.startswith("false_alarm")
    return cm, {
        "recall_пожар": tp / (tp + fn) if tp + fn else float("nan"),
        "precision_пожар": tp / (tp + fp) if tp + fp else float("nan"),
        "ложных_пожаров_(точек)": fp,
        "подозрений_на_нормальных_точках": int(((df["event_label"] == "normal")
                                                 & (df["status"] == "подозрение")).sum()),
        "ложные_тревоги_пойманы_как_подозрение": f"{int((fa_labels & (df['status'] == 'подозрение')).sum())}"
                                                 f"/{int(fa_labels.sum())}",
    }


# ---------------------------------------------------------------------------
# 5. Графики
# ---------------------------------------------------------------------------
def _shade_events(ax, events):
    for _, e in events.iterrows():
        color = "#c62828" if e["статус"] == "пожар" else "#ff9800"
        ax.axvspan(e["начало"], e["конец"], color=color, alpha=0.25, lw=0)


def plot_all(df, events, summary, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(exist_ok=True)
    fmt = mdates.DateFormatter("%d.%m\n%H:%M")

    # 1) VPD и вероятность риска
    fig, ax1 = plt.subplots(figsize=(14, 5))
    bounds = [b for b, _ in CONFIG["risk_levels"]] + [100]
    for (lo, name), hi in zip(CONFIG["risk_levels"], bounds[1:]):
        ax1.axhspan(lo, hi, color=LEVEL_COLORS[name], alpha=0.12, label=f"зона: {name}")
    ax1.plot(df.index, df["risk_prob_meteo"], color="#37474f", lw=1.2, label="риск (метео), %")
    ax1.plot(df.index, df["risk_prob"], color="#c62828", lw=1.0, ls="--",
             label="риск итоговый, % (с учётом пожара)")
    ax1.set_ylim(0, 105)
    ax1.set_ylabel("вероятность риска, %")
    ax2 = ax1.twinx()
    ax2.plot(df.index, df["vpd_kpa"], color="#1e88e5", lw=0.6, alpha=0.5, label="VPD")
    ax2.plot(df.index, df["vpd_smooth"], color="#0d47a1", lw=1.2, label="VPD (1 ч)")
    ax2.set_ylabel("VPD, кПа")
    ax2.set_ylim(0, max(3.0, df["vpd_smooth"].max() * 1.1))
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper left", fontsize=8, ncol=2)
    ax1.xaxis.set_major_formatter(fmt)
    ax1.set_title("VPD и вероятность риска пожара")
    fig.tight_layout()
    fig.savefig(out_dir / "1_vpd_risk.png", dpi=120)
    plt.close(fig)

    # 2) T, CO, PM2.5 с событиями
    fig, axes = plt.subplots(3, 1, figsize=(14, 9), sharex=True)
    for ax, col, label, color in [
        (axes[0], "temp_c", "T, °C", "#e53935"),
        (axes[1], "co_ppm", "CO, ppm", "#6d4c41"),
        (axes[2], "pm25_ugm3", "PM2.5, µг/м³", "#546e7a"),
    ]:
        ax.plot(df.index, df[col], color=color, lw=0.9)
        _shade_events(ax, events)
        ax.set_ylabel(label)
        ax.grid(alpha=0.3)
    for _, e in events.iterrows():
        axes[0].annotate(f"{e['статус']}\n{e['сигналы']}", (e["начало"], df["temp_c"].max()),
                         fontsize=8, ha="right", va="top")
    axes[0].set_title("Сенсоры горения (оранжевый — подозрение, красный — пожар)")
    axes[2].xaxis.set_major_formatter(fmt)
    fig.tight_layout()
    fig.savefig(out_dir / "2_sensors_events.png", dpi=120)
    plt.close(fig)

    # 3) Доли уровней риска по суткам
    fig, ax = plt.subplots(figsize=(9, 5))
    shares = summary[[f"{l}_%" for l in LEVEL_ORDER]]
    bottom = np.zeros(len(shares))
    labels = [str(d) for d in shares.index]
    for lvl in LEVEL_ORDER:
        vals = shares[f"{lvl}_%"].to_numpy()
        ax.bar(labels, vals, bottom=bottom, color=LEVEL_COLORS[lvl], label=lvl)
        bottom += vals
    ax.set_ylabel("доля времени, %")
    ax.set_title("Доли уровней риска по суткам (метео)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_dir / "3_risk_levels_daily.png", dpi=120)
    plt.close(fig)


# ---------------------------------------------------------------------------
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "test_data.csv"
    df = pd.read_csv(path, parse_dates=["timestamp"]).set_index("timestamp").sort_index()
    out_dir = Path(path).resolve().parent / "output"

    # 1. VPD по сырым данным
    df["vpd_kpa"] = compute_vpd(df["temp_c"], df["rh_pct"]).round(3)

    # 3. Горение (считаем до риска, чтобы исключить искажённые точки)
    sig = detect_fire(df)
    df = df.join(sig)

    # 2. Риск; при пожаре — сразу 100 %
    df = df.join(risk_score(df, anomaly_mask=df["sig_temp"]))
    df["risk_prob"] = np.where(df["status"] == "пожар", 100.0, df["risk_prob_meteo"])
    df["risk_level_meteo"] = _level(df["risk_prob_meteo"])
    df["risk_level"] = df["risk_level_meteo"]
    df["risk_level_final"] = _level(pd.Series(df["risk_prob"], index=df.index))

    # 4. Аналитика
    events = list_events(df, sig)
    summary = daily_summary(df)
    cm, metrics = quality_report(df)

    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 30)
    print("=" * 80)
    print("СВОДКА ПО СУТКАМ (риск по метео, без учёта пожара)")
    print("=" * 80)
    print(summary.T.to_string())

    print("\n" + "=" * 80)
    print("СОБЫТИЯ")
    print("=" * 80)
    if events.empty:
        print("нет")
    else:
        ev = events.copy()
        ev["начало"] = ev["начало"].dt.strftime("%Y-%m-%d %H:%M")
        ev["конец"] = ev["конец"].dt.strftime("%H:%M")
        print(ev.to_string(index=False))

    print("\n" + "=" * 80)
    print("ДРУГИЕ ЯВЛЕНИЯ")
    print("=" * 80)
    dd = summary["сухих_дней"]
    rain = summary["осадки_мм"]
    print("Осадки по суткам, мм: " + ", ".join(f"{d}: {v}" for d, v in rain.items()))
    last_rain = rain[rain >= CONFIG["rain_day_mm"]].index.max()
    print(f"Сухой период: {int(dd.iloc[-1])} сут. подряд без дождя к концу ряда "
          f"(последний дождливый день {last_rain}). "
          f"История до {summary.index[0]} неизвестна — принята за 0.")
    soil = df["soil_moisture_pct"].groupby(df.index.date).last().round(2)
    print("Влажность почвы на конец суток, %: " + ", ".join(f"{d}: {v}" for d, v in soil.items()))
    prof = diurnal_profile(df)
    print(f"Суточный ритм: максимум риска в среднем в {prof.idxmax()}:00 "
          f"({prof.max()} %), минимум в {prof.idxmin()}:00 ({prof.min()} %).")
    print("Средний риск по часам, %:")
    print(" ".join(f"{h:02d}:{v:>5}" for h, v in prof.items()))
    fa = events[events["статус"] == "подозрение"] if not events.empty else events
    for _, e in fa.iterrows():
        print(f"Ложная тревога {e['начало']:%Y-%m-%d %H:%M}: сигнал {e['сигналы']} "
              f"без остальных -> {e['интерпретация']}")

    print("\n" + "=" * 80)
    print("ОЦЕНКА КАЧЕСТВА (по event_label)")
    print("=" * 80)
    print(cm.to_string())
    for k, v in metrics.items():
        print(f"{k}: {v:.2f}" if isinstance(v, float) else f"{k}: {v}")

    # 5. Графики и выгрузка
    plot_all(df, events, summary, out_dir)
    df.to_csv(out_dir / "analytics_result.csv")
    summary.to_csv(out_dir / "daily_summary.csv")
    events.to_csv(out_dir / "events.csv", index=False)
    print(f"\nГрафики и таблицы сохранены в {out_dir}")


if __name__ == "__main__":
    main()
