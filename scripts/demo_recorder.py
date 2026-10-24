"""
无交互屏幕录制器：给 Agent 驱动 UI 时使用。

与 skill 自带的 recorder.py 区别：
  - 不弹 tkinter 窗口，不依赖人工点击"开始/停止"
  - 通过哨兵文件（--stop-file）或时长（--duration）自动停止
  - 输出 events JSON，格式与 recorder.py 完全一致，可直接喂给
    `scripts/jy_wrapper.py apply-zoom`

用法：
    python scripts/demo_recorder.py --out recordings/demo_01 --duration 90
    python scripts/demo_recorder.py --out recordings/demo_01 --stop-file tmp/stop.flag
"""

import argparse
import ctypes
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

# 与 recorder.py 一致：先声明 DPI 感知，否则 GetSystemMetrics 返回的是缩放后的
# 逻辑尺寸，和 gdigrab 抓到的物理像素对不上，归一化坐标会整体偏移。
if sys.platform == "win32":
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

from pynput import keyboard, mouse  # noqa: E402


def resolve_ffmpeg() -> str:
    explicit = os.environ.get("FFMPEG")
    if explicit and Path(explicit).exists():
        return explicit
    found = shutil.which("ffmpeg")
    if found:
        return found
    bundled = Path(os.environ.get("LOCALAPPDATA", "")) / "JianyingPro" / "Apps"
    if bundled.is_dir():
        candidates = sorted(bundled.glob("*/ffmpeg.exe"), reverse=True)
        if candidates:
            return str(candidates[0])
    raise SystemExit("找不到 ffmpeg：请设置 FFMPEG 环境变量或把 ffmpeg 加入 PATH")


class Recorder:
    def __init__(self, out_base: Path, fps: int, quality: int, vf: str = "", region: str = "", draw_mouse: bool = True):
        self.out_base = out_base
        self.out_base.parent.mkdir(parents=True, exist_ok=True)
        self.video_path = out_base.with_suffix(".mp4")
        self.events_path = Path(str(out_base) + "_recorder_events.json")
        self.fps = fps
        self.quality = quality
        self.vf = vf
        self.region = region
        self.draw_mouse = draw_mouse
        self.events = []
        self.is_recording = False
        self.start_time = 0.0
        self.proc = None
        self._last_move_time = 0.0
        self._last_move_pos = (0, 0)

        user32 = ctypes.windll.user32
        self.screen_w = user32.GetSystemMetrics(0)
        self.screen_h = user32.GetSystemMetrics(1)

    def on_click(self, x, y, button, pressed):
        if self.is_recording and pressed:
            self.events.append(
                {
                    "type": "click",
                    "time": round(time.time() - self.start_time, 3),
                    "x": round(x / self.screen_w, 3),
                    "y": round(y / self.screen_h, 3),
                }
            )

    def on_move(self, x, y):
        if not self.is_recording:
            return
        now = time.time()
        if now - self._last_move_time <= 0.1:
            return
        last_x, last_y = self._last_move_pos
        if (x - last_x) ** 2 + (y - last_y) ** 2 <= 25:
            return
        self.events.append(
            {
                "type": "move",
                "time": round(now - self.start_time, 3),
                "x": round(x / self.screen_w, 4),
                "y": round(y / self.screen_h, 4),
            }
        )
        self._last_move_time = now
        self._last_move_pos = (x, y)

    def on_press(self, key):
        if self.is_recording:
            self.events.append({"type": "keypress", "time": round(time.time() - self.start_time, 3)})

    def start(self):
        cmd = [
            resolve_ffmpeg(), "-y",
            "-f", "gdigrab", "-framerate", str(self.fps),
        ]
        if self.region:
            # region 是物理像素：只录浏览器窗口，避免把任务栏和别的窗口录进去
            x, y, w, h = (int(v) for v in self.region.split(","))
            cmd.extend(["-offset_x", str(x), "-offset_y", str(y),
                        "-video_size", f"{w}x{h}"])
        if self.draw_mouse:
            cmd.extend(["-draw_mouse", "1"])
        else:
            cmd.extend(["-draw_mouse", "0"])
        cmd.extend(["-i", "desktop"])
        if self.vf:
            cmd.extend(["-vf", self.vf])
        cmd.extend([
            # 剪映自带的 ffmpeg 是精简版：没有 libx264 / libx265，也没有 ffprobe。
            # 可用的 H.264 编码器只有硬件加速那几家；h264_mf 走 MediaFoundation，
            # 在 Intel / AMD / NVIDIA 机器上都存在，兼容性最好。
            "-c:v", "h264_mf", "-rate_control", "quality", "-quality", str(self.quality),
            "-pix_fmt", "yuv420p",
            str(self.video_path),
        ])
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        self.log_path = Path(str(self.out_base) + "_ffmpeg.log")
        self.log_fh = open(self.log_path, "w", encoding="utf-8")
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=self.log_fh,
                                     stderr=subprocess.STDOUT, env=env)
        time.sleep(1.2)  # 等 ffmpeg 真正打开设备，避免前几帧丢
        self.is_recording = True
        self.start_time = time.time()

        self.m_listener = mouse.Listener(on_click=self.on_click, on_move=self.on_move)
        self.k_listener = keyboard.Listener(on_press=self.on_press)
        self.m_listener.start()
        self.k_listener.start()
        sidecar = Path(str(self.out_base) + "_started.json")
        sidecar.write_text(json.dumps({
            "epoch": self.start_time,
            "video": str(self.video_path),
            "region": [int(v) for v in self.region.split(",")] if self.region else [0, 0, self.screen_w, self.screen_h],
            "screen": [self.screen_w, self.screen_h],
        }), encoding="utf-8")
        print(json.dumps({"status": "recording", "video": str(self.video_path),
                          "region": self.region or "fullscreen",
                          "screen": [self.screen_w, self.screen_h]}, ensure_ascii=False), flush=True)

    def stop(self):
        self.is_recording = False
        try:
            self.m_listener.stop()
            self.k_listener.stop()
        except Exception:
            pass
        elapsed = time.time() - self.start_time
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.write(b"q")
                self.proc.stdin.flush()
                self.proc.wait(timeout=15)
            except Exception:
                self.proc.kill()
        try:
            self.log_fh.close()
        except Exception:
            pass
        self.events_path.write_text(json.dumps(self.events, indent=2), encoding="utf-8")
        size = self.video_path.stat().st_size if self.video_path.exists() else 0
        print(json.dumps({"status": "stopped", "video": str(self.video_path),
                          "events": str(self.events_path), "bytes": size,
                          "seconds": round(elapsed, 2), "n_events": len(self.events)},
                         ensure_ascii=False), flush=True)
        return size > 100_000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="输出基名，不含扩展名")
    ap.add_argument("--duration", type=float, default=0, help="最长录制秒数，0=不限")
    ap.add_argument("--stop-file", default="", help="该文件出现时停止录制")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--quality", type=int, default=90, help="h264_mf 质量 0-100")
    ap.add_argument("--vf", default="", help="ffmpeg 视频滤镜，如 scale=1920:-2")
    ap.add_argument("--region", default="", help="物理像素区域 x,y,w,h；空=全屏")
    ap.add_argument("--no-mouse", action="store_true", help="不把系统光标录进画面")
    ap.add_argument("--max-wait", type=float, default=1800, help="兜底最长等待")
    args = ap.parse_args()

    rec = Recorder(Path(args.out), args.fps, args.quality, args.vf, args.region, not args.no_mouse)
    rec.start()
    stop_file = Path(args.stop_file) if args.stop_file else None
    deadline = time.time() + (args.duration or args.max_wait)
    try:
        while time.time() < deadline:
            if stop_file and stop_file.exists():
                break
            if rec.proc and rec.proc.poll() is not None:
                print(json.dumps({"status": "ffmpeg_exited_early", "code": rec.proc.returncode}))
                break
            time.sleep(0.25)
    finally:
        ok = rec.stop()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
