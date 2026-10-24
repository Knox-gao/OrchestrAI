"""
把 demo02 录屏剪成一条产品演示片，并生成剪映草稿。

流程：
  1. 导入录屏，按 events.json 打智能缩放关键帧（跟着点击位置放大/回位）
  2. 按 script.json 的分镜时间轴叠加章节标题与说明字幕
  3. 铺一条时长匹配的 BGM（云端曲库，淡入淡出）
  4. 保存草稿，输出时间轴审计

运行：
  JY_SKILL_ROOT=<skill> python scripts/build_demo_draft.py --name "OrchestrAI 演示" --video recordings/demo02.mp4
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SKILL_ROOT = os.getenv("JY_SKILL_ROOT", "").strip() or r"C:\Users\1\.zcode\skills\jianying-editor"
sys.path.insert(0, str(Path(SKILL_ROOT) / "scripts"))

from utils.env_setup import setup_env  # noqa: E402

setup_env()

import pyJianYingDraft as draft  # noqa: E402
from jy_wrapper import JyProject  # noqa: E402
from pyJianYingDraft.keyframe import KeyframeProperty as KP  # noqa: E402

Z = 1_000_000  # 微秒


def resolve_ffmpeg() -> str:
    explicit = os.environ.get("FFMPEG")
    if explicit and Path(explicit).exists():
        return explicit
    found = shutil.which("ffmpeg")
    if found:
        return found
    bundled = Path(os.environ.get("LOCALAPPDATA", "")) / "JianyingPro" / "Apps"
    if bundled.is_dir():
        for cand in sorted(bundled.glob("*/ffmpeg.exe"), reverse=True):
            return str(cand)
    return "ffmpeg"


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def apply_zoom(seg, events: list, scale: float = 1.34, hold_s: float = 3.2, nav_hold_s: float = 0.8):
    """点击处推进放大，停一会儿再拉回全景。

    与 skill 自带的 smart_zoomer 同思路，但做了两点必要调整：
      1. 打字时的点击不参与缩放 —— 镜头本来就在输入框上，再推近没意义，
         而且它的停留期会和下一次点击的进场期重叠，把关键帧挤成抖动。
      2. 停留期按"下一次点击前必须完成回位"截断，保证关键帧时间轴单调、不交叠。
    """
    zoom_events = [e for e in events if e.get("type") == "click" and not e.get("typing")]
    zoom_events.sort(key=lambda e: e["time"])

    made = 0
    for i, e in enumerate(zoom_events):
        t = int(e["time"] * Z)
        hold = nav_hold_s if e.get("nav") else hold_s

        nxt = zoom_events[i + 1]["time"] if i + 1 < len(zoom_events) else None
        if nxt is not None:
            # 下一次点击的进场提前 0.32s，回位还要 0.62s，都要留出来
            budget = nxt - 0.32 - 0.62 - e["time"]
            if budget < 0.2:
                continue
            hold = min(hold, budget)

        tx = (e["x"] - 0.5) * 2
        ty = (0.5 - e["y"]) * 2
        limit = max(0.0, scale - 1.0)
        px = max(-limit, min(-tx * scale, limit))
        py = max(-limit, min(-ty * scale, limit))

        t_in = max(0, t - 320_000)
        t_up = t
        t_hold = t + int(hold * Z)
        t_out = t_hold + 620_000

        for kp, a, b in (
            (KP.uniform_scale, 1.0, scale),
            (KP.position_x, 0.0, px),
            (KP.position_y, 0.0, py),
        ):
            seg.add_keyframe(kp, t_in, a)
            seg.add_keyframe(kp, t_up, b)
            seg.add_keyframe(kp, t_hold, b)
            seg.add_keyframe(kp, t_out, a)
        made += 1
    return made


CHAPTERS = [
    ("scene:home", 3.4, "一句话开始", "输入项目名，选择基调"),
    ("scene:pick-style", 3.4, "选风格", "也可以留给系统按主题定制"),
    ("scene:create-project", 4.2, "创建项目", "进入 Agent 协作工作台"),
    ("scene:studio", 4.6, "多人协作工作台", "像素办公室实时显示每个 Agent 的状态"),
    ("scene:requirement-typed", 3.0, "描述需求", "支持 Word / TXT / Markdown 文档"),
    ("scene:library", 3.4, "项目库", "每个项目都有交付状态与素材计数"),
    ("scene:open-delivered", 3.4, "打开已交付项目", "这里是一份真实跑完七道门禁的成品"),
    ("scene:tab-test", 3.2, "真实测试", "node --test 退出码 0，7 项全过"),
    ("scene:tab-events", 3.0, "全链路事件", "每道门禁的通过/未通过都有记录"),
    ("scene:preview-embed", 3.0, "在线预览", "生成的网站可以直接在面板里用"),
    ("scene:site-full", 3.4, "成品网站", "AI 生成、可下载、解压即运行的静态站点"),
]


def add_captions(project, marks, video_end_s):
    by_label = {m["label"]: m["t"] for m in marks}
    for i, (label, dur, title, sub) in enumerate(CHAPTERS):
        t = by_label.get(label)
        if t is None:
            continue
        nxt = None
        for j in range(i + 1, len(CHAPTERS)):
            t2 = by_label.get(CHAPTERS[j][0])
            if t2 is not None:
                nxt = t2
                break
        # 相邻字幕之间留 80ms 空隙：剪映不接受首尾相接的片段，
        # 而 time 是浮点秒，直接相接会因为四舍五入判定为重叠。
        gap = 0.08
        span = min(dur, (nxt - t - gap) if nxt else dur)
        span = min(span, max(0.0, video_end_s - 2.8 - t))
        span = max(0.0, span)
        if span < 1.2:
            continue

        project.add_text_simple(
            text=title,
            start_time=f"{t:.2f}s",
            duration=f"{span:.2f}s",
            track_name="Titles",
            clip_settings=draft.ClipSettings(transform_y=-0.74),
            style=draft.TextStyle(size=6.0, color=(0.98, 0.99, 1.0)),
            border=draft.TextBorder(color=(0.0, 0.0, 0.0), alpha=0.9, width=22.0),
        )
        project.add_text_simple(
            text=sub,
            start_time=f"{t + 0.25:.2f}s",
            duration=f"{max(1.0, span - 0.35):.2f}s",
            track_name="Subtitles",
            clip_settings=draft.ClipSettings(transform_y=-0.86),
            style=draft.TextStyle(size=3.9, color=(0.80, 0.87, 0.92)),
            border=draft.TextBorder(color=(0.0, 0.0, 0.0), alpha=0.92, width=20.0),
        )


def add_closing_card(project, end_s: float):
    if end_s < 4:
        return
    project.add_text_simple(
        text="OrchestrAI",
        start_time=f"{end_s - 2.6:.2f}s",
        duration="2.2s",
        track_name="Titles",
        clip_settings=draft.ClipSettings(transform_y=0.06),
        style=draft.TextStyle(size=9.5, color=(0.44, 0.86, 0.79)),
        border=draft.TextBorder(color=(0.0, 0.0, 0.0), alpha=0.6, width=16.0),
    )
    project.add_text_simple(
        text="github.com/Knox-gao/OrchestrAI",
        start_time=f"{end_s - 2.4:.2f}s",
        duration="2.0s",
        track_name="Subtitles",
        clip_settings=draft.ClipSettings(transform_y=-0.16),
        style=draft.TextStyle(size=4.0, color=(0.85, 0.91, 0.95)),
        border=draft.TextBorder(color=(0.0, 0.0, 0.0), alpha=0.85, width=18.0),
    )


def add_opening_card(project):
    project.add_text_simple(
        text="OrchestrAI",
        start_time="0.3s",
        duration="2.6s",
        track_name="Titles",
        clip_settings=draft.ClipSettings(transform_y=0.06),
        style=draft.TextStyle(size=10.0, color=(0.44, 0.86, 0.79)),
        border=draft.TextBorder(color=(0.0, 0.0, 0.0), alpha=0.55, width=16.0),
    )
    project.add_text_simple(
        text="一句话生成网站 · 内测版",
        start_time="0.55s",
        duration="2.3s",
        track_name="Subtitles",
        clip_settings=draft.ClipSettings(transform_y=-0.16),
        style=draft.TextStyle(size=4.2, color=(0.90, 0.94, 0.97)),
        border=draft.TextBorder(color=(0.0, 0.0, 0.0), alpha=0.8, width=18.0),
    )


def find_music(total_s: float):
    """从云端曲库挑一条时长足够的科技/企业氛围曲。"""
    csv_path = Path(SKILL_ROOT) / "data" / "cloud_music_library.csv"
    if not csv_path.exists():
        return None, None
    prefer = ["企业形象", "Android Hi Tech", "Scifi", "Ambient"]
    rows = []
    for line in csv_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split(",")
        if len(parts) < 3:
            continue
        try:
            dur = float(parts[2])
        except ValueError:
            continue
        if dur + 2 < total_s:
            continue
        rows.append((parts[0], parts[1], dur, line))
    for key in prefer:
        for mid, title, dur, _ in rows:
            if key.lower() in title.lower():
                return mid, f"{title} ({dur:.0f}s)"
    if rows:
        return rows[0][0], f"{rows[0][1]} ({rows[0][2]:.0f}s)"
    return None, None


def finalize_meta(project, video: Path, total_s: float):
    """补齐剪映草稿列表需要的两样东西。

    skill 的 save() 只写 draft_content.json 和一份 tm_duration=0 的 meta，
    结果草稿在剪映首页显示成 00:00、封面全黑。这里把真实时长和一张首帧封面补上，
    否则用户点进列表根本认不出这个草稿是多长的片子。
    """
    draft_dir = Path(project.draft_dir) if hasattr(project, "draft_dir") else None
    if not draft_dir or not draft_dir.exists():
        return
    meta_path = draft_dir / "draft_meta_info.json"
    content_path = draft_dir / "draft_content.json"
    if not meta_path.exists() or not content_path.exists():
        return

    content = json.loads(content_path.read_text(encoding="utf-8"))
    duration_us = int(content.get("duration") or total_s * Z)

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["tm_duration"] = duration_us
    meta["tm_draft_modified"] = int(time.time() * Z)
    if not meta.get("tm_draft_create"):
        meta["tm_draft_create"] = meta["tm_draft_modified"]
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    cover = draft_dir / (meta.get("draft_cover") or "draft_cover.jpg")
    if not cover.exists():
        ffmpeg = resolve_ffmpeg()
        subprocess.run(
            [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
             "-ss", "8", "-i", str(video), "-frames:v", "1",
             "-vf", "scale=960:-2", str(cover)],
            check=False,
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True, help="剪映项目名")
    ap.add_argument("--video", required=True)
    ap.add_argument("--events", default="")
    ap.add_argument("--script", default="")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--no-music", action="store_true")
    args = ap.parse_args()

    video = Path(args.video)
    if not video.is_absolute():
        video = PROJECT_ROOT / video
    if not video.exists():
        raise SystemExit(f"video not found: {video}")

    stem = video.with_suffix("")
    events_path = Path(args.events) if args.events else Path(str(stem) + "_events.json")
    script_path = Path(args.script) if args.script else Path(str(stem) + "_script.json")
    events = load_json(events_path) if events_path.exists() else []
    script = load_json(script_path) if script_path.exists() else {"marks": []}
    marks = script.get("marks", [])

    project = JyProject(args.name, width=args.width, height=args.height, overwrite=True)
    seg = project.add_media_safe(str(video), "0s")
    total_us = seg.target_timerange.duration if hasattr(seg, "target_timerange") else 0
    total_s = total_us / Z if total_us else 75.0

    n_zoom = apply_zoom(seg, events)
    add_opening_card(project)
    add_captions(project, marks, total_s)
    add_closing_card(project, total_s)

    music_title = None
    if not args.no_music:
        mid, music_title = find_music(total_s)
        if mid:
            print(f"🎵 选用配乐：{music_title}")
            bgm = project.add_cloud_music(mid, start_time="0.2s", duration=f"{total_s - 0.4:.2f}s", track_name="BGM")
            if bgm:
                bgm.volume = 0.42
            else:
                music_title = f"{music_title}（导入失败）"
        else:
            music_title = "未找到合适云端配乐（跳过）"

    project.save()
    finalize_meta(project, video, total_s)
    print(json.dumps({
        "draft": args.name,
        "draft_dir": str(project.draft_dir) if hasattr(project, "draft_dir") else None,
        "video": str(video),
        "duration_s": round(total_s, 2),
        "zoom_keyframes": n_zoom,
        "click_events": len([e for e in events if e.get("type") == "click"]),
        "captions": len(marks),
        "music": music_title,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
