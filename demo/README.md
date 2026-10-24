# 产品演示片

`OrchestrAI-demo.mp4` —— 75 秒，1920×1080 / 30fps，无旁白。

## 片子讲了什么

一条完整的使用路径，全部画面都来自产品本机真实运行：

| 时间 | 章节 | 内容 |
|---|---|---|
| 0:00 | 一句话开始 | 首页：输入项目名、选择基调 |
| 0:07 | 选风格 | 148 种照片图签，挑选「鎏金奢华」 |
| 0:12 | 创建项目 | 进入 Agent 协作工作台 |
| 0:15 | 多人协作工作台 | 像素办公室实时显示每个 Agent 的状态 |
| 0:23 | 描述需求 | 输入「生成漫威所有超级英雄的介绍网页，要带照片和介绍」 |
| 0:29 | 项目库 | 交付状态、素材计数、风格标签 |
| 0:31 | 打开已交付项目 | 一份真实跑完七道门禁的成品（PMVM8NC9A） |
| 0:36 | 真实测试 | `node --test` 退出码 0，7 项全过 |
| 0:41 | 全链路事件 | 每道门禁的通过/未通过都有事件记录 |
| 0:46 | 在线预览 | 预览页签里直接可用 |
| 0:52 | 成品网站 | AI 生成的静态站点，整屏滚动浏览 |

## 这条片子没有伪造任何东西

- **没有调用真实模型**：片子里输入需求后没有发送，因此不消耗 API 额度。
- **展示的成品是真的**：AE86 站点是之前用真实 deepseek 网关生成并通过七道门禁的交付物，测试日志、门禁结果、文件清单都来自那次真实执行。
- **标题与说明是后期加的**：画面本身没有改过，只在底部叠加了章节字幕。

## 怎么复现

```bash
# 1) 启动服务与前端
node apps/server/index.mjs        # :8787
npm run dev                       # :5175

# 2) 无头浏览器（供 CDP 驱动）
msedge --remote-debugging-port=9222 \
       --user-data-dir=tmp/edge-profile \
       --app="http://localhost:5175/" --window-size=1440,838

# 3) 录制（区域 = 网页内容区物理像素，避开标题栏；--no-mouse 用合成光标）
export FFMPEG="C:/Users/<你>/AppData/Local/JianyingPro/Apps/<版本>/ffmpeg.exe"
python scripts/demo_recorder.py --out recordings/demo --stop-file tmp/demo.stop \
    --region "13,70,2854,1606" --vf "scale=1920:1080" --no-mouse

# 4) 驱动界面（写出 events.json / script.json）
node scripts/demo_drive.mjs demo

# 5) 剪掉片头、重基时间轴
python scripts/prep_demo_clip.py --video recordings/demo.mp4 --lead 3.4

# 6) 生成剪映草稿（可继续手工调）
python scripts/build_demo_draft.py --name "OrchestrAI 演示" \
    --video recordings/demo_final.mp4

# 7) 直接渲染成片
python scripts/render_demo_mp4.py \
    --video recordings/demo_final.mp4 \
    --events recordings/demo_final_events.json \
    --script recordings/demo_final_script.json \
    --out demo/OrchestrAI-demo.mp4
```

## 为什么有两套渲染

`build_demo_draft.py` 生成的剪映草稿是**可编辑**的交付物（4 条轨：视频 / BGM / 标题 / 字幕，含智能缩放关键帧）。
但剪映 11.6 的导出控件与 skill 内置的 GUI 自动化版本对不上，自动导出会超时；同时云端 BGM 是签名链接，
脚本侧下载被 403 拒绝。所以另有一条 `render_demo_mp4.py` 用 ffmpeg 按同一套时间轴渲染成片 —— 差别是**没有配乐**，
缩放曲线一致但插值算法与剪映不同。

打开草稿：剪映首页 → 本地草稿 → 「OrchestrAI 内测版演示」。里面配乐轨是完整的。

## 已知取舍

- 无旁白。需要的话可以在剪映草稿里用 `add_tts_intelligent` 加 TTS。
- 结尾 3 秒是定帧，给字幕留停留时间。
- 屏幕上出现的 `$0.04 / $5.00` 是那次真实生成的实际 token 花费。
