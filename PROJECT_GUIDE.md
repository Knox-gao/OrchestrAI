# OrchestrAI — 项目工作文件介绍

> 提交基线：`febad39`（NEON城市脉搏跨主题验证）
> 日期：2026-10-18

## 一句话

OrchestrAI 是一个"一句话生成网站"的实验平台。从初始的模板化生成，经过多轮实验，正在从"固定模板+能力组合"转向"按需自主创作"的生成范式。

---

## 仓库结构（你会关心的文件）

### 核心生成管线（正式，未改动）

```
apps/server/
  index.mjs          # HTTP 服务（8787 端口），POST /api/generate
  pipeline.mjs       # 生成流水线：LLM→模板→采集→测试→交付
  intent.mjs         # LLM 需求解析（类型/标题/Brief/场景）
  llm.mjs            # GLM 网关（含截断修复/网页搜索）
  scraper.mjs        # 图片采集器（Bing→Reddit→DDG→Wikimedia，含代理）
  proxy.mjs          # 系统代理探测 + CONNECT 隧道
  keys.mjs           # API Key 管理（真实 Key 在 keys.json，已 gitignore）
  assets.mjs         # 图片资产注册表（锁定复用）
  visualaudit.mjs    # 主管视觉审查（按键绑定/素材/形态互斥）
  rendercheck.mjs    # 渲染门禁（Edge headless 截图+DOM探针）
  imaging.mjs        # 图片解码+色彩特征（PNG自研/JPEG vendor）
  generator/
    index.mjs        # buildFiles 入口（8 模板注册）
    theme.mjs        # 共享主题层（pageShell——旧回退布局）
    styles.mjs       # 148 风格引擎（16基底×9色彩，含AI视觉设计）
    tokens.mjs       # Design Tokens（结构变量，阶段二新增）
    designbrief.mjs  # 结构化 Design Brief（双方向+校验）
    layouts/index.mjs # 布局原语（editorial/workbench）
    templates/       # 8 模板（todo/pomodoro/counter/notes/countdown/landing/gallery/atlas）
    png.mjs          # PNG 编码器（程序化图标）
  vendor/
    jpeg-decoder.cjs # jpeg-js 解码器（Apache-2.0，from experiments/vendor）
  test/
    assets.test.mjs  # 资产注册表测试（3）
    curator.test.mjs # 策展器测试（6）
    rendercheck.test.mjs # 渲染门禁测试（4）
    designbrief.test.mjs # Brief 测试（6）
    （+ 各模板内嵌 logic.test.mjs）

apps/studio/        # React 前端（Vite，5175 端口）
packages/core/      # TypeScript 域内核（23 测试，vitest）
```

### 实验层（隔离，不影响正式管线）

```
experiments/
  stage1/            # 阶段一：H1/H2/H3 验证 + 双布局原型
    h1-image-meta.mjs    # 图片元数据实验（40/40 成功）
    h2-design-brief.mjs  # Brief 实验（6/6 通过）
    h3-render-check.mjs  # 渲染门禁实验
    proto-layouts.mjs    # editorial vs workbench 原型
    shots/               # 截图
  composer/          # Scene Composer 实验
    capabilities.mjs     # 能力池（7场景×4转场）
    director.mjs         # Creative Director（LLM 创意方案）
    compose.mjs          # 编译器（JSON→网页）
    plans/               # 三主题 Director 方案
    out/                 # 编译产物（mirage/vista/silkroad）
  metaphor/          # 隐喻驱动对照实验
    brief-metaphor.mjs   # 三主题 LLM 隐喻推导
    volcano/ tea/ coffee/ # 三隐喻首屏
    shots/               # 六版对比截图
    metaphor-briefs.json # LLM 推导产物
  benchmark/         # Creative Intelligence Benchmark
    benchmark.mjs        # 三差异需求全链（规划→分幕→修订）
    recovery.mjs         # 潮汐露营重设计（丰富探针+结构重构）
    recovery2b.mjs       # 多页面重建（分3调用）
    out/{a,b,c}/         # 三个项目产物+截图
  breakthrough/      # WILDFRAME 露营品牌（一句话→完整网站）
    breakthrough.mjs     # 全链（规划→单次全栈→反馈闭环）
    out/                 # 最终页面
    shots/               # 桌面+移动截图
  breakthrough02/    # NEON / 城市脉搏（跨主题验证）
    neon.mjs             # 全栈+定向补丁
    out/                 # 最终页面
    shots/
  openended/         # 开放式按需实现
    agent.mjs            # LLM 分幕产代码（无白名单）
    fix.mjs              # 完整性护栏（反馈补 JS）
    fix-round2.mjs       # 质量反馈修复
    quality-gate.mjs     # 质量门禁（双层）
    scroll-snap.mjs      # 滚动控制器（状态机+吸附）
    out/                 # 页面产物
```

### 文档

```
docs/
  RESEARCH_AND_ENGINEERING_REPORT.md  # 主报告（工程日志+变更历史）
  design-benchmark/solar-system-atlas.md # 参考站审计
  design-quality-framework.md          # A-J 十维质量框架
  design-breakthrough-report.md        # 设计突破实验
  creative-quality-recovery.md         # 潮汐露营重设计
  cross-theme-experiment.md            # 跨主题泛化实验
  scene-composer-pilot.md              # Scene Composer 试运行
  showcase-first-experiment.md         # Showcase-First 实验
  breakthrough-report.md               # 一句话→完整网站实验
  breakthrough02-report.md             # NEON 跨主题验证
  recovery2-report.md                  # 多页面重建
  creative-benchmark.md                # Creative Benchmark
  paradigm-diagnosis.md                # 范式诊断（三层枚举封印证据链）
  quality-gate-scroll-snap.md          # 质量门禁+滚动翻页
```

### 截图证据

```
gui-test-screenshots/     # 各阶段验收截图（已 gitignore，需手动加）
experiments/*/shots/      # 实验截图
workspaces/               # 生成的工作区（含真实采集图片）
```

---

## 二、关键架构发现（读这些理解为什么系统是这样的）

1. **三层枚举封印**（paradigm-diagnosis.md）：intent.mjs 的 8 类型枚举 / designbrief.mjs 的 7 布局枚举 / capabilities.mjs 的 switch 垄断——LLM 只能填参数，不能创建新结构。这是"模板感"的机制根源。

2. **反馈闭环会破坏**（breakthrough-report.md）：让 LLM 全页重写会导致 19509→3075 字符递减。正确策略=初版单次生成+定向 CSS/JS 补丁。

3. **跨调用 DOM 契约失效**（recovery2-report.md）：HTML 和 JS 分次生成时属性名不自动协调。Scene Composer 能工作是因为编译器强制命名空间。

4. **系统级 reduced-motion**：你的浏览器 prefers-reduced-motion=reduce=true——所有动效被熔断为静态。用 `?motion=force` 强制查看。

5. **Bing 中文图搜特性**：多词混排会被 SEO 劫持，单一实体词最准。前缀匹配会把"钢铁侠"匹配成炼钢厂。

---

## 三、四条铁律

1. 测试必须真跑（退出码+日志落盘）
2. 门禁未过不得交付（静态+测试+视觉审查+渲染门禁）
3. 变更必须留痕（git 提交链+主报告变更历史）
4. UI 动画只是状态可视化（权威状态来自事件日志）

---

## 四、如何在新电脑上运行

```bash
# 1. 安装依赖
npm install -w packages/core -w apps/server -w apps/studio

# 2. 配置 API Key（编辑 apps/server/keys.json）
{ "zhipu": "你的GLM API Key" }

# 3. 启动服务
cd apps/server && node index.mjs
# → http://127.0.0.1:8787

# 4. 启动前端（可选）
cd apps/studio && npm run dev
# → http://127.0.0.1:5175

# 5. 生成一个网站
# 访问 5175 → 输入需求 → 等待
# 或 API：
curl -X POST http://127.0.0.1:8787/api/generate \
  -H "Content-Type: application/json" \
  -d '{"name":"项目名","sentence":"你的需求"}'

# 6. 预览
# http://127.0.0.1:8787/preview/{projectId}/
```

---

## 五、下一步（待你确认）

1. **护栏内开放式**：把 openended 路径（LLM 产真代码+完整性护栏）接入正式管线
2. **长场景排除校准**：scroll-snap.mjs 的 snapScenes/anchorOf 条件统一
3. **Scene Composer 处置**：降级为"快速路径"（保留）或参考库
4. **正式管线的作品模式**：让开放式生成的能力也覆盖 landing/gallery 之外的模板

---

## Git 提交链

```
febad39  NEON城市脉搏跨主题验证（最新）
4de9912  recovery2 多页面重建
86c9059  creative-quality-recovery 潮汐重设计
b2c4be2  creative-benchmark 三差异需求
0acc72e  quality-gate+scroll-snap 质量门禁
382c6d9  paradigm-diagnosis 范式诊断
4de9912  recovery2 多页面重建
b2c4be2  creative-benchmark 三差异需求
0acc72e  quality-gate+scroll-snap
48554ab  showcase-first 炫技型生成
5ee33b9  stage3 设计能力升级
c20ca38  stage1 阶段一
9c7071f  baseline 原始基线
```

所有提交可独立 revert。回滚到任一基线：`git revert {hash}..HEAD`
