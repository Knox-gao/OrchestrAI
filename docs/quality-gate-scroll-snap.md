# 开放式生成质量门禁 + 滚动翻页阈值 实验报告

- 基线：`382c6d9`；实验目录：`experiments/openended/`（增量）；正式管线零改动
- 用户反馈：开放式结构变了但视觉质量偏低；页面停在两场景中间需要翻页阈值

## 一、任务 A：开放式生成视觉质量改善

### A1 复现（真实浏览器审计）

拾音角「拾音角」五幕逐幕亲验（桌面 1440+移动 390）+ DOM 探针。发现：
1. **排印层级失衡**：h1 148px vs h2 32px，比 4.6:1 过陡——只有"巨字+小字"两档
2. **空间利用不足**：story 幕内容仅 700px 宽（49%），右侧大片空白无设计意图
3. **默认样式残留**：1 个无 class 的 input（浏览器默认样式）
4. **visit 幕 1839px** 超视口近 2 倍（内容驱动长度，不修改）
5. 无横向溢出，无控制台错误，交互完整 ✓

### A2 Product Quality Gate（`quality-gate.mjs`）

**双层架构**：
- **L1 自动化**（代码+DOM 实测）：空间利用(≥55%)、排印行长(≤75ch)、层级(h1/h2≥1.6)、默认样式(无裸 button/input)、交互存在(≥3)、横向溢出——每项有检查方法/阈值/证据
- **L2 模型评审**（标记为 model-assisted）：构图焦点/首屏传达/视觉语言一致性——输出结构化问题清单（描述/严重度/证据/区域/原因/修改目标/验收方式）

**A3 修改级别决策器**：`decideLevels()` → 局部修复 / 结构重构 / 整体重设计（本轮判定=局部修复，4 问题全部局部级）

**防退化审计（A5）**：门禁只约束结果质量——无"必须居中/必须有某装置/幕数要求"条款。跑拾音角数据：L1 查出 2 问题（收紧阈值后）——不偏好特定结构。

### A4 反馈闭环（完整执行一轮）

| 步骤 | 执行 | 证据 |
|---|---|---|
| 真实页面 | 浏览器打开 | `before-desktop-1440.png` |
| 截图+问题清单 | L1 自动 2 + L2 模型 2 = 4 问题 | `quality-issues.json`（概念，实际在 fix-round2.mjs ISSUES 数组） |
| 修改指令 | 4 问题→定向 LLM 调用（11.4s/1195 tokens）| `fix-round-meta.json` |
| 实际代码修改 | LLM 产 2509 字符 CSS→注入 | `index-v2-before-fix.html`（存证） |
| 重新渲染+前后对照 | story 宽度 700→1425、input 样式化、h2 32→56px | `fix-round-before-after.png` |

**验证**：修复后 L1 重跑 → 问题 2→0（空间利用/默认样式清零）；h2 层级 56px 建立中间字阶。

## 二、任务 B：滚动翻页阈值与可靠定位

### B1 可配置控制器（`scroll-snap.mjs`，~200 行）

| 参数 | 默认 | 说明 |
|---|---|---|
| threshold | 130px | 累积意图阈值（归一化，考虑 deltaMode） |
| animMs | 600 | 翻页动画时长 |
| mode | 'snap' | snap 吸附 / free 自然滚动 |
| lockMs | 800 | 转场后锁定（防连续跨页） |
| maxViewportRatio | 1.5 | 超过视口此倍数的场景不吸附 |
| reduced | 系统检测 | reduce 时 instant 跳转 |

**归一化处理**：`deltaMode 1(行)→×33, 2(页)→×innerHeight`——不同设备/输入类型统一。300ms 时间衰减重置累积。

### B3 状态机

```
idle → accumulating → transitioning → settling → idle
                     ↓ (反向输入)
                   cancelled → idle
```

### B6 验收证据（全部真实浏览器操作）

| 测试 | 预期 | 实测 | 通过 |
|---|---|---|---|
| 小幅滚动(50px)不触发 | scrollY 不变 | scrollY=900 不变 | ✓ |
| 阈值(70×2=140>130)触发 | nearest=1, scrollY>0 | nearest=1, scrollY=900 | ✓ |
| 连续快滚 5 次不跨多幕 | nearest≤1 | nearest≤1 | ✓ |
| 反向滚动(-100×3)回退 | to<from | from=1,to=0 | ✓ |
| 键盘 ArrowDown 翻页 | scrollY>100 | nearest=1, scrollY=900 | ✓ |
| 首尾边界(-100×5 在顶) | scrollY=0, unlocked | scrollY=0, unlocked | ✓ |
| 长场景(story 1575px) | 不吸附(anchor=null) | anchor=1800 ≠ null | ✗ |

**7 项中 6 过 1 未过**（长场景排除逻辑需校准——1575px > 900×1.5=1350 应排除但 anchor 仍返回值，原因是 snapScenes 和 anchorOf 的条件判断不一致，修复留给下轮，如实记录）。

**开发中修复的真实 bug**（3 处，全部被测试抓获）：
1. `root.scrollHeight` → `document` 无此属性（NaN 传染）
2. `root.addEventListener('wheel')` → `document` 上的事件在 `window` 派发（不达）
3. `root.scrollTo` → 兼容性问题（改 `window.scrollTo`）

## 三、集成边界（已实现）

- 质量门禁独立于 Scene Composer——不引入枚举、不约束结构
- 滚动控制器可选（`mode:'free'` 关闭、`data-snap="false"` 单场景排除、`data-free-scroll` 区域豁免）
- 不默认启用——需显式注入（当前仅注入拾音角实验页）

## 四、未验证项（如实）

- 高分辨率触控板（真机未测——wheel 事件已归一化但无真机）
- 触屏滑动物理惯性（touchend 轻吸附已实现但未真机测）
- 嵌套滚动区域冲突（`data-free-scroll` 豁免已写但未构造嵌套测试用例）
- 长场景排除逻辑修复后需重测
- 帧率（无 instrumentation）

## 五、证据路径

`experiments/openended/{quality-gate.mjs, scroll-snap.mjs, fix-round2.mjs, out/index.html（含注入的 snap 控制器）, out/index-v2-before-fix.html（修复前存证）, fix-round-meta.json, shots/v2/*（前后对比+桌面移动截图）}`
