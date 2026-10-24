"""
把录屏整理成可直接剪辑的正片：剪掉片头空转、尾巴定帧留白，并把事件/分镜时间轴一起重基。

为什么需要这一步：
  录制器先起、驱动脚本后连，中间有几秒黑屏等待；结尾也需要时间让字幕停留。
  直接在剪映里裁会把关键帧时间点全部对歪，所以在进剪辑前一次性处理掉。

输出：
  <clip>_final.mp4          整理后的正片
  <clip>_final_events.json  重基后的点击事件
  <clip>_final_script.json  重基后的分镜标记
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


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
    raise SystemExit("找不到 ffmpeg")


def probe_duration(ffmpeg: str, path: Path) -> float:
    # 剪映自带 ffmpeg 没有 ffprobe，从 stderr 里读 Duration
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)],
                       capture_output=True, text=True, encoding="utf-8", errors="ignore")
    for line in r.stderr.splitlines():
        if "Duration:" in line:
            hh, mm, ss = line.split("Duration:")[1].split(",")[0].strip().split(":")
            return int(hh) * 3600 + int(mm) * 60 + float(ss)
    raise SystemExit(f"无法读取时长：{path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--lead", type=float, default=1.6, help="首镜前保留的秒数")
    ap.add_argument("--tail", type=float, default=3.0, help="结尾定帧秒数")
    ap.add_argument("--min-start", type=float, default=4.0, help="片头最多敢裁掉的秒数下限保护")
    args = ap.parse_args()

    video = Path(args.video)
    if not video.is_absolute():
        video = PROJECT_ROOT / video
    stem = video.with_suffix("")
    events_path = Path(str(stem) + "_events.json")
    script_path = Path(str(stem) + "_script.json")

    events = json.loads(events_path.read_text(encoding="utf-8")) if events_path.exists() else []
    script = json.loads(script_path.read_text(encoding="utf-8")) if script_path.exists() else {"marks": []}
    marks = script.get("marks", [])

    scene_marks = [m["t"] for m in marks if m["label"].startswith("scene:")]
    if not scene_marks:
        raise SystemExit("分镜里没有 scene: 标记，无法确定裁切点")

    ffmpeg = resolve_ffmpeg()
    src_dur = probe_duration(ffmpeg, video)

    cut = max(0.0, min(scene_marks) - args.lead)
    keep = src_dur - cut
    out = Path(str(stem) + "_final.mp4")

    print(f"源时长 {src_dur:.2f}s，裁掉片头 {cut:.2f}s，保留 {keep:.2f}s，尾部补 {args.tail:.1f}s")

    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{cut:.3f}", "-i", str(video),
        "-vf", f"tpad=stop_mode=clone:stop_duration={args.tail},fps=30",
        "-c:v", "h264_mf", "-rate_control", "quality", "-quality", "92",
        "-pix_fmt", "yuv420p", str(out),
    ]
    subprocess.run(cmd, check=True)

    # 重基：所有时间点减去裁切偏移
    rebased_events = []
    for e in events:
        t = e["time"] - cut
        if t < 0:
            continue
        rebased_events.append({**e, "time": round(t, 3)})
    rebased_marks = [{**m, "t": round(m["t"] - cut, 3)} for m in marks if m["t"] - cut >= 0]

    Path(str(stem) + "_final_events.json").write_text(json.dumps(rebased_events, indent=2), encoding="utf-8")
    Path(str(stem) + "_final_script.json").write_text(json.dumps({"marks": rebased_marks, "ok": script.get("ok", True)}, indent=2), encoding="utf-8")

    final_dur = probe_duration(ffmpeg, out)
    print(json.dumps({
        "output": str(out),
        "duration_s": round(final_dur, 2),
        "clicks": len(rebased_events),
        "marks": len(rebased_marks),
        "expected_s": round(keep + args.tail, 2),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
