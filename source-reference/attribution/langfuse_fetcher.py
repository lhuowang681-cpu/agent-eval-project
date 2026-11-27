"""
langfuse_fetcher.py
从 Langfuse 拉取 badcase traces / observations。

支持两种模式：
  1. 拉取带 error score 的 traces（score name 配置为 LANGFUSE_ERROR_SCORE_NAME）
  2. 拉取 observation level = ERROR 的所有 observations
"""

from __future__ import annotations

import os
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from dotenv import load_dotenv
from langfuse import Langfuse

load_dotenv()

# ── 配置 ────────────────────────────────────────────────────────────────────────

LANGFUSE_PUBLIC_KEY = os.environ["LANGFUSE_PUBLIC_KEY"]
LANGFUSE_SECRET_KEY = os.environ["LANGFUSE_SECRET_KEY"]
LANGFUSE_HOST = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
ANALYSIS_DAYS = int(os.getenv("ANALYSIS_DAYS", "7"))
ANALYSIS_LIMIT = int(os.getenv("ANALYSIS_LIMIT", "500"))

# Langfuse score name 用于标识 badcase（如果你已经打了 score）
LANGFUSE_ERROR_SCORE_NAME = os.getenv("LANGFUSE_ERROR_SCORE_NAME", "quality")
LANGFUSE_ERROR_SCORE_THRESHOLD = float(os.getenv("LANGFUSE_ERROR_SCORE_THRESHOLD", "0.5"))


# ── 客户端 ───────────────────────────────────────────────────────────────────────

def get_client() -> Langfuse:
    return Langfuse(
        public_key=LANGFUSE_PUBLIC_KEY,
        secret_key=LANGFUSE_SECRET_KEY,
        host=LANGFUSE_HOST,
    )


# ── 拉取逻辑 ─────────────────────────────────────────────────────────────────────

def fetch_badcase_traces(
    days: int = ANALYSIS_DAYS,
    limit: int = ANALYSIS_LIMIT,
    tags: Optional[list[str]] = None,
) -> list[dict]:
    """
    拉取 Langfuse 中的 badcase traces。

    策略：
      1. 先拉取最近 `days` 天内的所有 traces（按 from_timestamp 过滤）
      2. 过滤条件（满足任一）：
         - trace 有 output error 字段
         - observation level = ERROR / WARNING
         - 有 tags 包含 "badcase" / "error"
         - 有 score name=quality 且值低于阈值
    
    Returns:
        list of dict, 每条包含：
          id, name, timestamp, input, output, error,
          metadata, tags, scores, observations_summary
    """
    client = get_client()
    since = datetime.now(tz=timezone.utc) - timedelta(days=days)

    print(f"[Fetcher] 拉取最近 {days} 天 traces (from {since.isoformat()})...")

    # 拉取 traces
    page = 1
    all_traces = []
    while len(all_traces) < limit:
        batch_size = min(100, limit - len(all_traces))
        resp = client.fetch_traces(
            from_timestamp=since,
            limit=batch_size,
            page=page,
            tags=tags,  # 如果传了 tags 就过滤
        )
        if not resp.data:
            break
        all_traces.extend(resp.data)
        if len(resp.data) < batch_size:
            break
        page += 1

    print(f"[Fetcher] 拉取到 {len(all_traces)} 条 traces，开始筛选 badcase...")

    badcases = []
    for trace in all_traces:
        # 判断是否为 badcase
        is_badcase = False
        error_text = ""

        # 条件 1：trace 本身有 output 且 output 含 error 字样
        if trace.output:
            out_str = json.dumps(trace.output, ensure_ascii=False) if isinstance(trace.output, dict) else str(trace.output)
            if any(k in out_str.lower() for k in ["error", "exception", "traceback", "failed", "失败", "错误"]):
                is_badcase = True
                error_text = out_str[:2000]

        # 条件 2：trace metadata 有 error 字段
        if trace.metadata:
            meta_str = json.dumps(trace.metadata, ensure_ascii=False)
            if "error" in meta_str.lower():
                is_badcase = True
                error_text = error_text or meta_str[:2000]

        # 条件 3：trace tags 包含 badcase / error
        if trace.tags:
            for t in trace.tags:
                if t.lower() in ("badcase", "error", "bug", "fail", "failed"):
                    is_badcase = True

        # 条件 4：scores 中有低分
        scores = []
        try:
            score_resp = client.fetch_scores(trace_id=trace.id)
            scores = score_resp.data if score_resp.data else []
            for s in scores:
                if (
                    s.name == LANGFUSE_ERROR_SCORE_NAME
                    and s.value is not None
                    and s.value < LANGFUSE_ERROR_SCORE_THRESHOLD
                ):
                    is_badcase = True
        except Exception:
            pass

        if not is_badcase:
            continue

        # 拉取 observations（找 ERROR level 的）
        obs_summary = []
        try:
            obs_resp = client.fetch_observations(trace_id=trace.id)
            for obs in (obs_resp.data or []):
                if obs.level in ("ERROR", "WARNING") or (obs.status_message and "error" in obs.status_message.lower()):
                    obs_summary.append({
                        "name": obs.name,
                        "level": obs.level,
                        "status_message": obs.status_message,
                        "input_preview": str(obs.input)[:500] if obs.input else "",
                        "output_preview": str(obs.output)[:500] if obs.output else "",
                    })
                    if not error_text and obs.status_message:
                        error_text = obs.status_message
        except Exception:
            pass

        badcases.append({
            "id": trace.id,
            "name": trace.name or "",
            "timestamp": trace.timestamp.isoformat() if trace.timestamp else "",
            "input": str(trace.input)[:1000] if trace.input else "",
            "output": str(trace.output)[:1000] if trace.output else "",
            "error_text": error_text[:2000],
            "metadata": trace.metadata or {},
            "tags": trace.tags or [],
            "scores": [{"name": s.name, "value": s.value} for s in scores],
            "observations": obs_summary,
        })

    print(f"[Fetcher] 筛选后得到 {len(badcases)} 条 badcase。")
    return badcases


def load_from_json(path: str) -> list[dict]:
    """从本地 JSON 文件加载（离线模式）。"""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_to_json(data: list[dict], path: str) -> None:
    """保存到本地 JSON（供调试复用）。"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[Fetcher] 保存到 {path}")


if __name__ == "__main__":
    # 独立运行：验证连接，打印前 3 条
    traces = fetch_badcase_traces(days=3, limit=20)
    print(f"\n共找到 {len(traces)} 条 badcase。示例：")
    for t in traces[:3]:
        print(f"  [{t['timestamp']}] {t['name']}: {t['error_text'][:100]}")
    save_to_json(traces, "./output/raw_badcases.json")
