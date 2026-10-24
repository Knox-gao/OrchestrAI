# OrchestrAI

**一句话生成网站。** 你只描述想要什么，OrchestrAI 组织一组 Agent 完成真实的需求理解、页面生成、质量门禁、浏览器验收与网页 ZIP 交付。

> **当前版本：内测版（Private Beta）**
> - ✅ 只生成**桌面版网页**（不生成移动端页面、不打包 .exe / .apk）
> - ✅ **必须使用你自己的 API 模型**（无模型时直接阻断，只产出模板页没有意义）
> - ✅ AI 遇到主观审美选择时会**先问你**（字体气质 / 视觉风格 / 页面方向 / 文案调性），而不是替你做主

---

## 快速开始

```bash
# 1. 安装依赖（Node 20+）
npm install

# 2. 启动生成服务
node apps/server/index.mjs          # → http://127.0.0.1:8787

# 3. 启动前端工作室
npm run dev                          # → http://127.0.0.1:5175
```

### 配置你自己的模型（必做）

打开工作室首页右上角 **🔑 API Key** → **自定义服务**，填写：

| 字段 | 说明 |
|---|---|
| 服务名称 | 任意，如 `my-deepseek` |
| 接口地址 | OpenAI 兼容地址，如 `https://api.deepseek.com/v1` |
| API Key | 你的密钥 |
| 模型名 | 如 `deepseek-chat`、`gpt-4o-mini`、`glm-4-flash` |

也可以用内置选项：智谱 GLM / OpenAI / Anthropic。

密钥只存本机 `apps/server/keys.json`（已在 `.gitignore`），接口只返回掩码，不写日志、不进入交付 ZIP。

PagePlan 默认请求 `20000` 个输出 token。不同 OpenAI 兼容网关的输出上限可能不同；如遇到供应商拒绝 `max_tokens` 的错误，可在**启动服务端前**设置 `ORCHESTRAI_PAGEPLAN_MAX_TOKENS`，允许值为 `1000`–`100000` 的整数，设置后重启服务端。例如 PowerShell：

```powershell
$env:ORCHESTRAI_PAGEPLAN_MAX_TOKENS = '12000'
node apps/server/index.mjs
```

无效或越界的值会使用默认 `20000`。调低预算可能让大型页面的 JSON 输出被截断；应结合所选模型的输出限制调整。

PagePlan 是默认生成路径。非纯文字网站必须至少有一张配图：生成器优先从已配置的 Pexels / Unsplash 和公开图源搜索相关、清晰的真实图片，下载进交付文件并保留可获得的作者、许可和来源页；若搜索或下载未得到合适图片，则按主题与当前配色绘制本地矢量插画补位。最终门禁检查 HTML 中确有图片、每张图片都有 alt，且资源路径指向已落地的本地文件；空图位、坏链接或只有卡片/文字均不能通过。用户明确要求纯文字网站时才跳过配图门禁。公开图源返回的来源或许可字段不等同于对使用权的独立核验。

### 生成一个网站

1. 首页输入项目名 → 创建
2. 左下角 💬 面板输入需求（支持 `.docx` / `.txt` / `.md` 附件）
3. AI 若需要你拍板审美，会弹出选择卡 → 选完开始
4. 生成完成后在「预览」页签查看，或下载网页 ZIP

---

## 内测版的三条硬规则

### 1. 只交付桌面版网页

- `rendercheck` 只跑 **1440×900** 单视口，作为交付阻断门禁
- 移动视口能力保留但**不参与门禁**（仅诊断用，传入 `desktopOnly: false` 时）
- `.exe` / `.apk` 导出接口返回 **409**，UI 已移除对应按钮

理由：内测阶段先在一个明确的交付形态上做到可靠，比同时兼顾多端更有价值。

### 2. 必须自带模型

无可用模型配置时，生成**直接阻断**并给出配置指引（`gate: model_required`），不会静默降级成模板页。

```js
// apps/server/pipeline.mjs
if (!gw) {
  // 发射 gate_result(model_required, passed:false) → delivered:false → 终止
}
```

理由：模板页与本项目的目标（按需创作）相悖，产出低质页面比不产出更糟。

### 3. AI 选择必须问人

生成前会先调用 `/api/preflight`：AI 判断是否有**主观审美选择**需要用户拍板。

```bash
POST /api/preflight
{ "requirement": "做一个咖啡店官网", "llm": "auto" }
→ { "ok": true, "questions": [
      { "id": "font", "title": "标题字体气质",
        "options": [{"value":"serif","label":"典雅衬线","hint":"适合文化/高端品牌"}, ...] }
   ] }
```

用户选完后 `/api/generate` 会带上 `choices`，并把选择写成明确指令注入需求。每个问题都提供「让你决定」跳过项。

理由：审美是用户的权利，不是模型的默认值。

---

## 架构

```
需求输入
  ↓
/api/preflight        AI 判断是否需要用户拍板（字体/风格/方向/调性）
  ↓ (用户选择)
pipeline.mjs
  ├─ 模型网关守卫      无模型 → 阻断
  ├─ 意图解析 (LLM)    类型 / 标题 / 功能 / 数据集
  ├─ Design Brief      双方向设计简报 + schema 校验
  ├─ 模板渲染          8 模板（todo/pomodoro/counter/notes/gallery/countdown/landing/atlas）
  ├─ 静态门禁          quality.mjs
  ├─ 单元门禁          runner.mjs（真实 node --test）
  ├─ 视觉审查          visualaudit.mjs（按键绑定 / 素材完整）
  ├─ 渲染门禁          rendercheck.mjs（CDP 精确视口 1440×900）
  └─ 交付              delivered / previewUrl / ZIP
```

```
apps/server/          生成服务（零依赖 Node）
  pipeline.mjs        生成流水线
  preflight.mjs       开工前确认（AI 选择问用户）
  cdp-viewport.mjs    CDP 精确视口（修复 --window-size 钳制）
  rendercheck.mjs     渲染门禁
  keys.mjs            密钥存储（ORCHESTRAI_KEYS_FILE 可重定向）
  generator/          模板与风格引擎
    styles.mjs        148 种风格（16 基底 × 9 色彩）
    designbrief.mjs   结构化设计简报
    layouts/          布局原语
    templates/        8 个应用模板
  scraper.mjs         真实图片采集（Bing / Reddit / DDG / Wikimedia）
  proxy.mjs           系统代理探测 + CONNECT 隧道

apps/studio/          React + Vite 工作室前端
  components/ChoiceModal.tsx   AI 选择卡
  components/ChatDock.tsx      需求输入面板
  components/HomePage.tsx      项目首页

packages/core/        TypeScript 域内核（事件溯源状态机，23 测试）
docs/                 研究报告与实验记录
experiments/          设计/图片/生成实验（隔离，不影响正式管线）
```

---

## 测试

```bash
npm test                          # 核心域内核（vitest，23 项）
node --test apps/server/test/     # 服务端测试（21 项）
node apps/server/selftest.mjs     # 模板自检（16 项，含缺陷注入）
npm run build                     # 前端构建
```

渲染门禁需要本机有 Edge（或设 `RENDERCHECK_EDGE` 指向 Chromium 内核浏览器）。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 服务端口 |
| `ORCHESTRAI_KEYS_FILE` | `apps/server/keys.json` | 密钥库路径（E2E 隔离用） |
| `ORCHESTRAI_RENDERCHECK` | 开 | 设 `off` 关闭渲染门禁 |
| `RENDERCHECK_EDGE` | Edge 默认路径 | 浏览器可执行文件 |

---

## 设计原则

1. **测试必须真跑** — 退出码 + 日志落盘，模型自述不算证据
2. **门禁未过不得交付** — 静态 / 单元 / 视觉 / 渲染四道门禁，任一失败即阻断
3. **变更必须留痕** — 事件流 + 版本链，历史不删除
4. **AI 不做用户的选择** — 主观审美必须先问，技术决策模型自主

---

## 已知限制（内测版）

- 只支持桌面版网页；移动端未纳入交付范围
- 依赖模型能力：模型越强，产出质量越高；弱模型仍可能出现结构单薄
- 图片采集依赖网络与图源可用性
- 不提供真实支付 / 后端业务逻辑（生成的站点为静态网页）
- `.exe` / `.apk` 打包已移出本版本范围

---

## License

[MIT](./LICENSE)
