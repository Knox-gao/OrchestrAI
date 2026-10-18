# Recovery 2：多页面产品体验重建 — 实验报告

- 基线：`86c9059`；正式管线零改动
- 目标：单页→多页面完整产品体验

## 一、Bug 清单复现（阶段 0，全部有 DOM 证据）

| # | Bug | 复现 | 严重度 |
|---|---|---|---|
| 1 | 表单无 JS 处理器（提交=GET 到自身=刷新） | `form.onsubmit: false`，按钮无 onclick | high |
| 2 | 无导航 | `nav: false, links: 2` | high |
| 3 | 内容极薄 | 3 sections, 2 h2, pageH 2664 | high |
| 4 | 裸 checkbox ×4 | `input:not([class])` 4 个 | med |

## 二、构建过程（阶段 1-4）

**架构决策**：单页→SPA hash 路由 4 页面（#home/#camps/#book/#guide）。

**分 3 次调用**（HTML/CSS/JS 各一次，因单次 4k token 限制无法产出完整多页面站）：
| 调用 | 内容 | 耗时 | 产出 |
|---|---|---|---|
| HTML | 4 页面结构+导航+页脚 | ~55s | 6515 字符（宽松提取——围栏格式漂移） |
| CSS | 全站样式+响应式 | ~34s | 8830 字符 ✓ |
| JS | 路由+表单状态机+价格计算 | ~19s | 5578 字符 ✓ |

## 三、实际结果（阶段 5 验收）

### 改善了的（有 DOM 证据）

| 维度 | v2 旧 | v3 新 |
|---|---|---|
| 导航 | 无 | ✓ 固定导航 4 链接 |
| sections | 3 | 4 |
| h2 数量 | 2 | 4 |
| 裸 input | 4 | **0** |
| 溢出 | 无 | 无 |
| 交互元素 | 10 | 11 inputs + 1 button |

### 未解决的（如实）

**路由不工作**：JS 用 `data-page` 属性做路由，但 HTML 生成的 section 没有该属性——因为 **HTML 和 JS 在两次独立调用中生成，属性名约定不一致**。这是本轮最重要的架构发现：

> **分体生成的接口一致性问题**：LLM 分次生成 HTML/JS 时，DOM 契约（属性名/ID/class）不会被自动协调。上轮拼合 Scene Composer 能工作是因为共享编译器强制了命名——而开放式生成没有这层保障。

## 四、三版对比

截图：`shots/c-recovery2/v0-v2-v3-comparison.png`（v0 原始→v2 重设计→v3 多页面）

- v0：4816px 单页，无导航，日历塌陷，表单乱序
- v2：2664px 紧凑单页，首屏行动导向，表单决策序——但无导航/内容薄
- v3：导航+4 页面区块+更多 h2/inputs/零裸控件——但路由失效

## 五、结论

**v3 修复了 v2 的 3 个 bug（导航/裸 input/内容薄），但暴露了新的架构问题（跨调用 DOM 契约）**。

**架构发现**（比页面本身更有价值）：开放式生成需要一层"DOM 契约"保障——要么单次调用产全栈代码（当前 token 限制不够），要么编译器强制属性命名空间（Scene Composer 的做法），要么生成后自动校验+修补 DOM/JS 匹配。

## 六、证据

`out/c/{index.html（v3）, index-v2-recovery.html, _body.html, index-v0-original.html}` / `shots/c-recovery2/{v3-desktop.png, v3-mobile.png, v0-v2-v3-comparison.png}`
