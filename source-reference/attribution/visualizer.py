"""
visualizer.py
生成两张可视化图表：

  图表 ①：错误类别出现次数（水平条形图，按出现次数降序）
  图表 ②：错误归因到模块分布（分层分组条形图 + 热力图双视角）

依赖：matplotlib, pandas（可选 plotly 用于交互式 HTML 版本）
"""

from __future__ import annotations

import os
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import pandas as pd
import numpy as np

# ── 中文字体配置（跨平台）────────────────────────────────────────────────────────
def _setup_chinese_font():
    """尝试配置中文字体，按平台优先顺序查找。"""
    import platform
    import matplotlib.font_manager as fm

    candidates = []
    sys = platform.system()
    if sys == "Windows":
        candidates = ["Microsoft YaHei", "SimHei", "FangSong", "KaiTi"]
    elif sys == "Darwin":
        candidates = ["PingFang SC", "Heiti SC", "STSong"]
    else:
        candidates = ["WenQuanYi Micro Hei", "Noto Sans CJK SC", "DejaVu Sans"]

    available = {f.name for f in fm.fontManager.ttflist}
    for font in candidates:
        if font in available:
            matplotlib.rcParams["font.family"] = font
            matplotlib.rcParams["axes.unicode_minus"] = False
            return font

    # 兜底：不报错，只是中文可能显示为方块
    matplotlib.rcParams["axes.unicode_minus"] = False
    return None


_FONT = _setup_chinese_font()

# ── 配色方案 ─────────────────────────────────────────────────────────────────────

# 8 层对应的颜色
LAYER_COLORS = {
    "L1": "#4E79A7",  # 蓝
    "L2": "#F28E2B",  # 橙
    "L3": "#E15759",  # 红
    "L4": "#76B7B2",  # 青
    "L5": "#59A14F",  # 绿
    "L6": "#EDC948",  # 黄
    "L7": "#B07AA1",  # 紫
    "L8": "#FF9DA7",  # 粉
    "UNKNOWN": "#BAB0AC",  # 灰
}

OUTPUT_DPI = 150
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./output")


# ── 图表 ① ───────────────────────────────────────────────────────────────────────

def chart1_error_category(
    df_cat: pd.DataFrame,
    top_n: int = 25,
    output_path: str | None = None,
) -> str:
    """
    水平条形图：错误类别出现次数（降序）。

    Args:
        df_cat: aggregator.aggregate() 返回的 df_category
        top_n: 最多展示 N 个类别
        output_path: 保存路径，None 时自动放 OUTPUT_DIR

    Returns:
        实际保存路径
    """
    df = df_cat.head(top_n).copy()
    # 构建 label：中文 + 英文缩写
    labels = df["label"].tolist()
    counts = df["count"].tolist()
    pcts = df["pct"].tolist()

    fig_height = max(6, len(df) * 0.45 + 2)
    fig, ax = plt.subplots(figsize=(12, fig_height))

    # 颜色：用渐变蓝
    cmap = plt.get_cmap("Blues_r")
    colors = [cmap(0.3 + 0.5 * (i / max(len(df) - 1, 1))) for i in range(len(df))]

    bars = ax.barh(range(len(df)), counts, color=colors, edgecolor="white", linewidth=0.5)

    # 数值标注
    for i, (bar, cnt, pct) in enumerate(zip(bars, counts, pcts)):
        ax.text(
            bar.get_width() + max(counts) * 0.01,
            bar.get_y() + bar.get_height() / 2,
            f"{cnt}  ({pct}%)",
            va="center",
            ha="left",
            fontsize=9,
            color="#333333",
        )

    ax.set_yticks(range(len(df)))
    ax.set_yticklabels(labels, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("出现次数", fontsize=11)
    ax.set_title(
        f"TripYoYo Agent Badcase — 错误类别出现次数 (Top {top_n})",
        fontsize=14,
        fontweight="bold",
        pad=15,
    )
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_xlim(0, max(counts) * 1.2)

    # 总数注释
    total = df_cat["count"].sum()
    ax.annotate(
        f"总计 {total} 条 badcase",
        xy=(0.98, 0.02),
        xycoords="axes fraction",
        ha="right",
        va="bottom",
        fontsize=9,
        color="gray",
    )

    plt.tight_layout()
    path = output_path or f"{OUTPUT_DIR}/chart1_error_category.png"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    plt.savefig(path, dpi=OUTPUT_DPI, bbox_inches="tight")
    plt.close()
    print(f"[Visualizer] 图表 ① 已保存: {path}")
    return path


# ── 图表 ② ───────────────────────────────────────────────────────────────────────

def chart2_module_distribution(
    df_mod: pd.DataFrame,
    top_n: int = 30,
    output_path: str | None = None,
) -> str:
    """
    分层水平条形图：错误归因到模块分布（按层着色）。

    Args:
        df_mod: aggregator.aggregate() 返回的 df_module
        top_n: 最多展示 N 个模块（按 count 降序）
        output_path: 保存路径

    Returns:
        实际保存路径
    """
    df = df_mod.sort_values("count", ascending=False).head(top_n).copy()
    df = df.sort_values(["layer_id", "count"], ascending=[True, False])

    labels = df.apply(
        lambda r: f"{r['module_id']}  {r['module_name']}", axis=1
    ).tolist()
    counts = df["count"].tolist()
    pcts = df["pct"].tolist()
    layer_ids = df["layer_id"].tolist()

    bar_colors = [LAYER_COLORS.get(lid, "#BAB0AC") for lid in layer_ids]

    fig_height = max(8, len(df) * 0.5 + 3)
    fig, ax = plt.subplots(figsize=(14, fig_height))

    bars = ax.barh(range(len(df)), counts, color=bar_colors, edgecolor="white", linewidth=0.6)

    for i, (bar, cnt, pct) in enumerate(zip(bars, counts, pcts)):
        ax.text(
            bar.get_width() + max(counts) * 0.01,
            bar.get_y() + bar.get_height() / 2,
            f"{cnt}  ({pct}%)",
            va="center",
            ha="left",
            fontsize=8.5,
            color="#333333",
        )

    ax.set_yticks(range(len(df)))
    ax.set_yticklabels(labels, fontsize=8.5)
    ax.invert_yaxis()
    ax.set_xlabel("出现次数", fontsize=11)
    ax.set_title(
        f"TripYoYo Agent Badcase — 错误归因模块分布 (Top {top_n})",
        fontsize=14,
        fontweight="bold",
        pad=15,
    )
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_xlim(0, max(counts) * 1.25)

    # 图例（按层）
    legend_layers = sorted(set(layer_ids))
    from taxonomy import TAXONOMY
    handles = [
        mpatches.Patch(
            color=LAYER_COLORS.get(lid, "#BAB0AC"),
            label=f"{lid}: {TAXONOMY.get(lid, {}).get('name', lid)}",
        )
        for lid in legend_layers
        if lid != "UNKNOWN"
    ]
    if any(l == "UNKNOWN" for l in legend_layers):
        handles.append(mpatches.Patch(color="#BAB0AC", label="UNKNOWN: 未能归因"))
    ax.legend(
        handles=handles,
        loc="lower right",
        fontsize=8,
        framealpha=0.7,
        title="层次",
        title_fontsize=9,
    )

    # 层分隔线
    _prev_layer = None
    for i, lid in enumerate(layer_ids):
        if lid != _prev_layer and i > 0:
            ax.axhline(y=i - 0.5, color="gray", linewidth=0.8, linestyle="--", alpha=0.5)
        _prev_layer = lid

    plt.tight_layout()
    path = output_path or f"{OUTPUT_DIR}/chart2_module_distribution.png"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    plt.savefig(path, dpi=OUTPUT_DPI, bbox_inches="tight")
    plt.close()
    print(f"[Visualizer] 图表 ② 已保存: {path}")
    return path


# ── 可选：生成层级热力图（补充视角）────────────────────────────────────────────────

def chart3_layer_heatmap(
    df_mod: pd.DataFrame,
    output_path: str | None = None,
) -> str | None:
    """
    额外输出一张 8 层汇总热力图（可选）。
    """
    from taxonomy import TAXONOMY

    df_layer = (
        df_mod.groupby("layer_id")["count"].sum().reset_index()
    )
    layer_order = [f"L{i}" for i in range(1, 9)] + ["UNKNOWN"]
    layer_order = [l for l in layer_order if l in df_layer["layer_id"].values]

    df_layer = df_layer.set_index("layer_id").reindex(layer_order).fillna(0).reset_index()
    df_layer["layer_name"] = df_layer["layer_id"].apply(
        lambda lid: TAXONOMY.get(lid, {}).get("name", lid)
    )

    fig, ax = plt.subplots(figsize=(10, 4))
    counts = df_layer["count"].values.reshape(1, -1).astype(float)
    labels = [f"{r['layer_id']}\n{r['layer_name'][:6]}" for _, r in df_layer.iterrows()]

    im = ax.imshow(counts, cmap="YlOrRd", aspect="auto")
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_yticks([])
    ax.set_title("TripYoYo Badcase — 各层错误热力图", fontsize=13, fontweight="bold")

    for j, val in enumerate(counts[0]):
        ax.text(j, 0, str(int(val)), ha="center", va="center",
                fontsize=11, fontweight="bold",
                color="white" if val > counts.max() * 0.6 else "black")

    plt.colorbar(im, ax=ax, orientation="horizontal", pad=0.3, label="出现次数")
    plt.tight_layout()
    path = output_path or f"{OUTPUT_DIR}/chart3_layer_heatmap.png"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    plt.savefig(path, dpi=OUTPUT_DPI, bbox_inches="tight")
    plt.close()
    print(f"[Visualizer] 图表 ③（热力图）已保存: {path}")
    return path


# ── CLI 独立运行 ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from aggregator import load_classified, aggregate

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    df = load_classified()
    df_cat, df_mod = aggregate(df)

    chart1_error_category(df_cat)
    chart2_module_distribution(df_mod)
    chart3_layer_heatmap(df_mod)
    print("\n[Visualizer] 全部图表生成完毕！")
