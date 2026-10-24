"""
按剪映草稿的同一套参数，用 ffmpeg 直接渲染成片 MP4。

为什么需要它：
  剪映 11.6 的导出控件和 skill 内置的 GUI 自动化版本不匹配（自动导出会超时），
  而草稿本身是可用的 —— 用户仍可以在剪映里手动导出、继续改。
  为了同时给出一个能直接播放的成片，这里用草稿里的关键帧/字幕时间轴做一次等效渲染。

为什么用 PIL 画字：
  剪映自带的 ffmpeg 是精简构建，没有 drawtext / subtitles 滤镜，
  所以文字先由 PIL 渲染成透明 PNG，再用 overlay 滤镜按时间叠上去。

与草稿的差异（诚实记录）：
  - 没有配乐：云端曲目是剪映 CDN 的签名链接，脚本侧下载被 403 拒绝。
    草稿里 BGM 轨是完整的，剪映打开时能正常解析和播放。
  - 缩放用等效的 crop+scale 近似，运动曲线一致，插值算法与剪映不同。
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
W, H = 1920, 1080
CAPTION_TOP = 852

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\Deng.ttf",
]

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


def resolve_ffmpeg() -> str:
    explicit = os.environ.get("FFMPEG")
    if explicit and Path(explicit).exists():
        return explicit
    found = shutil.which("ffmpeg")
    if found:
        return found
    bundled = Path(os.environ.get("LOCALAPPDATA", "")) / "JianyingPro" / "Apps"
    if bundled.is_dir():
        for c in sorted(bundled.glob("*/ffmpeg.exe"), reverse=True):
            return str(c)
    raise SystemExit("找不到 ffmpeg")


def probe_duration(ffmpeg: str, path: Path) -> float:
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)],
                       capture_output=True, text=True, encoding="utf-8", errors="ignore")
    for line in r.stderr.splitlines():
        if "Duration:" in line:
            hh, mm, ss = line.split("Duration:")[1].split(",")[0].strip().split(":")
            return int(hh) * 3600 + int(mm) * 60 + float(ss)
    return 75.0


def pick_font():
    from PIL import ImageFont
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return path
    raise SystemExit("找不到可用的中文字体")


def caption_layer(path: Path, title: str, sub: str, font_path: str, y: int):
    """渲染字幕条：暗色衬底 + 标题 + 说明。

    衬底是必须的 —— 演示片后半段是浅色网站页面，纯白字压上去几乎看不见。
    """
    from PIL import Image, ImageDraw, ImageFont

    band_h = 200
    img = Image.new("RGBA", (W, band_h), (0, 0, 0, 0))
    # 横竖都渐隐的软衬底：硬边会把字幕条切成一个方块，很出戏
    scrim = Image.new("RGBA", (W, band_h), (0, 0, 0, 0))
    px = scrim.load()
    edge = 340
    for y in range(band_h):
        # 纵向：上下各留 26px 渐隐
        fy = min(1.0, y / 44.0) * min(1.0, (band_h - 1 - y) / 44.0)
        for x in range(W):
            if x < edge:
                fx = (x / edge) ** 1.5
            elif x > W - edge:
                fx = ((W - 1 - x) / edge) ** 1.5
            else:
                fx = 1.0
            a = int(196 * fx * fy)
            if a:
                px[x, y] = (4, 8, 14, a)
    img.alpha_composite(scrim)

    draw = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(font_path, 46)
    f_sub = ImageFont.truetype(font_path, 29)

    def centered(text, font, ty, fill):
        bbox = draw.textbbox((0, 0), text, font=font, stroke_width=2)
        tw = bbox[2] - bbox[0]
        draw.text(((W - tw) / 2, ty), text, font=font, fill=fill, stroke_width=2, stroke_fill=(0, 0, 0, 190))

    centered(title, f_title, 14, (255, 255, 255, 255))
    if sub:
        centered(sub, f_sub, 82, (206, 220, 229, 255))
    img.save(path)
    return band_h


def card_layer(path: Path, text: str, size: int, rgb, font_path: str):
    """渲染一张只有文字高度的横条（带暗色衬底），返回高度。"""
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(font_path, size)
    probe = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    pd = ImageDraw.Draw(probe)
    bbox = pd.textbbox((0, 0), text, font=font, stroke_width=2)
    band_h = bbox[3] - bbox[1] + 40
    img = Image.new("RGBA", (W, band_h), (0, 0, 0, 0))

    scrim = Image.new("RGBA", (W, band_h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    sd.rounded_rectangle([W / 2 - 420, 0, W / 2 + 420, band_h], radius=14, fill=(4, 8, 14, 165))
    img.alpha_composite(scrim)

    draw = ImageDraw.Draw(img)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) / 2, 20 - bbox[1]), text, font=font, fill=rgb,
              stroke_width=2, stroke_fill=(0, 0, 0, 180))
    img.save(path)
    return band_h


def lerp_expr(pts):
    """把 [(t, v), …] 折线写成 ffmpeg 表达式（scale/crop 参数按时间插值）。"""
    if not pts:
        return "0"
    expr = f"{pts[-1][1]:.6f}"
    for i in range(len(pts) - 2, -1, -1):
        t0, v0 = pts[i]
        t1, v1 = pts[i + 1]
        dt = t1 - t0
        if dt <= 1e-9:
            continue
        inner = f"({v0:.6f}+({v1 - v0:.6f})*(t-{t0:.6f})/{dt:.6f})"
        expr = f"if(lt(t,{t1:.6f}),{inner},{expr})"
    return f"if(lt(t,{pts[0][0]:.6f}),{pts[0][1]:.6f},{expr})"


def clean(pts):
    pts = sorted(pts, key=lambda p: p[0])
    out = []
    for p in pts:
        if out and abs(p[0] - out[-1][0]) < 1e-6:
            out[-1] = p
        else:
            out.append(p)
    return out


def build_zoom(events):
    scale_pts, px_pts, py_pts = [], [], []
    for e in events:
        if e.get("typing"):
            continue
        t = e["time"]
        hold = 0.8 if e.get("nav") else 3.2
        s = 1.34
        tx = (e["x"] - 0.5) * 2
        ty = (0.5 - e["y"]) * 2
        limit = s - 1.0
        px = max(-limit, min(-tx * s, limit))
        py = max(-limit, min(-ty * s, limit))
        scale_pts += [(max(0.0, t - 0.32), 1.0), (t, s), (t + hold, s), (t + hold + 0.62, 1.0)]
        px_pts += [(max(0.0, t - 0.32), 0.0), (t, px), (t + hold, px), (t + hold + 0.62, 0.0)]
        py_pts += [(max(0.0, t - 0.32), 0.0), (t, py), (t + hold, py), (t + hold + 0.62, 0.0)]

    sx = lerp_expr(clean(scale_pts))
    ex = lerp_expr(clean(px_pts))
    ey = lerp_expr(clean(py_pts))
    sv = f"max(1.0,({sx}))"
    cw = f"iw/({sv})"
    chh = f"ih/({sv})"
    cx = f"(iw/2-(({ex})/(2*({sv})))*iw)"
    cy = f"(ih/2+(({ey})/(2*({sv})))*ih)"
    cxx = f"max(0,min(iw-({cw}),({cx})-({cw})/2))"
    cyy = f"max(0,min(ih-({chh}),({cy})-({chh})/2))"
    return f"crop=w='{cw}':h='{chh}':x='{cxx}':y='{cyy}',scale={W}:{H}:flags=bicubic"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--events", required=True)
    ap.add_argument("--script", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workdir", default="tmp/overlays")
    args = ap.parse_args()

    video = Path(args.video)
    events = json.loads(Path(args.events).read_text(encoding="utf-8"))
    marks = json.loads(Path(args.script).read_text(encoding="utf-8"))["marks"]
    by_label = {m["label"]: m["t"] for m in marks}
    scene_marks = sorted(m["t"] for m in marks if m["label"].startswith("scene:"))

    font_path = pick_font()
    work = Path(args.workdir)
    work.mkdir(parents=True, exist_ok=True)
    for stale in work.glob("*.png"):
        stale.unlink()

    overlays = []  # (path, start, end, overlay_y)

    for i, (label, dur, title, sub) in enumerate(CHAPTERS):
        t = by_label.get(label)
        if t is None:
            continue
        # 截断点用「下一个任意 scene 标记」而不是下一个章节：
        # 章节之间还夹着切页动作，按章节截断会让字幕拖到别的界面上。
        nxt = next((t2 for t2 in scene_marks if t2 > t + 0.01), None)
        span = (nxt - t - 0.08) if nxt else dur
        span = max(2.2, min(span, 7.0))
        if span < 1.2:
            continue
        p = work / f"cap_{i:02d}.png"
        caption_layer(p, title, sub, font_path, CAPTION_TOP)
        overlays.append((p, t, t + span, CAPTION_TOP))

    video_s = probe_duration(resolve_ffmpeg(), video)
    end_s = video_s
    scene_end = by_label.get("scene:end", video_s)
    p_close = work / "card_close.png"
    h_close = card_layer(p_close, "github.com/Knox-gao/OrchestrAI", 32, (217, 230, 236, 255), font_path)
    overlays.append((p_close, max(0.0, end_s - 2.6), end_s - 0.4, H - h_close - 60))

    ffmpeg = resolve_ffmpeg()

    # 把 13 张图层按时间拼成一条透明轨道，只用一个 overlay 输入。
    # 十几路 -loop 1 输入各自全宽解码，会把这个精简版 ffmpeg 的显存/内存吃穿。
    order = sorted(overlays, key=lambda o: o[1])
    total_s = float(end_s) + 1.0

    def trans_frame(path: Path):
        from PIL import Image
        Image.new("RGBA", (W, H), (0, 0, 0, 0)).save(path)

    trans = work / "transparent.png"
    trans_frame(trans)

    # 先给 caption 图层补成整帧：主字幕在底部，把条带贴到整帧对应位置
    full_layers = []
    for path, start, end, oy in order:
        from PIL import Image
        band = Image.open(path).convert("RGBA")
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        frame.alpha_composite(band, (0, oy))
        full = work / (path.stem + "_full.png")
        frame.save(full)
        full_layers.append((full, start, end))

    concat_lines = []
    cursor = 0.0
    for full, start, end in full_layers:
        if start > cursor + 0.01:
            concat_lines.append(f"file '{trans.resolve().as_posix()}'")
            concat_lines.append(f"duration {start - cursor:.3f}")
        concat_lines.append(f"file '{full.resolve().as_posix()}'")
        concat_lines.append(f"duration {max(0.04, end - start):.3f}")
        cursor = end
    if total_s > cursor:
        concat_lines.append(f"file '{trans.resolve().as_posix()}'")
        concat_lines.append(f"duration {total_s - cursor + 1.0:.3f}")
    concat_lines.append(f"file '{trans.resolve().as_posix()}'")

    list_path = work / "layers.txt"
    list_path.write_text(chr(10).join(concat_lines) + chr(10), encoding="utf-8")

    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "warning",
           "-i", str(video),
           "-f", "concat", "-safe", "0", "-i", str(list_path)]

    filters = [f"[0:v]{build_zoom(events)}[z]",
               "[1:v]fps=30,format=rgba[lay]",
               "[z][lay]overlay=0:0:format=auto[vout]",
               "[vout]format=yuv420p[v]"]
    cmd += ["-filter_complex", ";".join(filters), "-map", "[v]",
            "-c:v", "h264_mf", "-rate_control", "quality", "-quality", "95",
            "-r", "30", str(args.out)]

    print(f"layers: {len(full_layers)}  concat entries: {len(concat_lines)//2}  zoom: {len([e for e in events if not e.get('typing')])}")
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if r.returncode != 0:
        print((r.stderr or "")[-2500:])
        sys.exit(1)
    print(json.dumps({"out": str(args.out), "captions": len(full_layers),
                      "size_mb": round(Path(args.out).stat().st_size / 1e6, 1)},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
