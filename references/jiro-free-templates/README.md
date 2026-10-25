# Jiro.build 免费模板参考库

> 来源：https://jiro.build/templates/free（站点自行标注为 Free 的 7 个模板）
> 抓取时间：2026-10-25
> 用途：作为 OrchestrAI 模板质量与信息架构的**内部参考**，学习别人家模板的
> 板块划分、文案结构、动效与转化设计。

## 这里有什么

每个模板目录包含：

| 文件 | 说明 |
|---|---|
| `preview.rendered.html` | 渲染后的完整落地页 DOM（113–219KB，含全部文案与结构） |
| `preview.html` | 服务端原始返回（未渲染的 Next.js 壳，仅存档） |
| `meta.json` | 公开元数据：名称/分类/描述/标签/详情页与预览页 URL |

7 个模板：

1. `smm-agency-landing-page-growlio` — 社媒营销机构
2. `online-yoga-programs-landing-page-solra` — 瑜伽课程
3. `mindfulness-landing-page-design-solra` — 正念冥想
4. `finance-management-landing-page-finsyc` — AI 记账理财
5. `ai-budget-tracking-landing-page-velara-ai` — AI 预算追踪
6. `ai-marketing-landing-page-kelo` — AI 营销
7. `ai-customer-support-landing-page-kelo` — AI 客服

## 没有什么、为什么

**提示词（prompt）正文不在其中。** 实测：匿名状态下打开模板详情页，
提示词区域一直停在 Loading；点击 Copy Prompt 没有发起任何数据请求、
剪贴板为空 —— 提示词文本只对登录用户下发。站点同时提供官方 MCP
（mcp.jiro.build），但同样要求 OAuth 登录。

绕过登录拿内容这类事不做；如果你需要原文提示词，两条正路：

1. 自己在 jiro.build 注册/登录后复制（免费模板不需要付费）；
2. 用你自己的账号接入它的官方 MCP。

## 授权提示

站点有 Terms & Conditions，免费模板的具体再授权范围页面未明示。
这批文件按「内部参考、学习研究」目的保存；如果未来要把这些设计
**直接用于交付产物或对外分发**，应先确认授权范围或在页面上联系
站点方确认。出处（来源 URL 与抓取时间）已记录在 `MANIFEST.json`
与每个 `meta.json` 里，方便追溯。
