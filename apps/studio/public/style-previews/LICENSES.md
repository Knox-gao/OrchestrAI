# 图片来源与许可（`apps/studio/public/style-previews/`）

本目录下的 11 张照片用于首页「风格图签」的视觉样例。全部来自 [Unsplash](https://unsplash.com)，
按 [Unsplash License](https://unsplash.com/license) 使用（可免费用于商业与非商业用途，无需署名；
本仓库仍保留作者信息以示尊重）。

界面内每张图都显示了 `Photo: <作者> / Unsplash` 的署名。

| 文件 | 用途 | 作者 |
|---|---|---|
| `auto.jpg` | 自动搭配 | Dell |
| `brutalist.jpg` | 新野兽派 | Francesco Albertazzi |
| `glass.jpg` | 毛玻璃 | Unsplash（**待补具体作者**） |
| `terminal.jpg` | 终端绿屏 | Leopold Stenger |
| `newspaper.jpg` | 复古报纸 | balesstudio |
| `aurora.jpg` | 极光渐变 | Jonatan Pie |
| `gold.jpg` | 鎏金奢华 | Rutger Lanser |
| `neon.jpg` | 暗夜霓虹 | Cai Fang |
| `organic.jpg` | 有机自然 | Unsplash（**待补具体作者**） |
| `zen.jpg` | 禅意留白 | Unsplash（**待补具体作者**） |
| `abstract.jpg` | 抽象几何 | Unsplash（**待补具体作者**） |

## 待办

标「**待补具体作者**」的 4 张需要补上 Unsplash 页面链接与作者名。补齐方式：

1. 在 Unsplash 搜索该图（或用反向图片搜索）找到原始页面；
2. 记录 `https://unsplash.com/photos/<id>` 与作者用户名；
3. 更新本文件与 `apps/studio/src/components/HomePage.tsx` 里的 `credit` 字段。

## 许可要点（Unsplash License）

- 可免费用于商业和非商业用途，无需许可或署名。
- **不可**：出售未经修改的照片副本、将照片用于竞争性图库服务、用他人照片注册商标。
- 本仓库的使用方式（作为产品 UI 的风格样例）在许可范围内。

## 替换建议

若要完全避免第三方授权依赖，可把这 11 张替换为：

- 项目内生成的示意图（`apps/server/generator/png.mjs` 已有 placeholder 生成器）；
- 或纯 CSS 渐变 / 纹理（体积更小，且无授权问题）。

替换时同步更新 `HomePage.tsx` 的 `image` 与 `credit` 字段。
