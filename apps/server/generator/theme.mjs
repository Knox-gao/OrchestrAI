/**
 * 生成 App 的共享主题层：消费风格引擎定义（styles.mjs）渲染完整 CSS。
 * 基础组件（card/button/input）用 CSS 变量；各风格的专属工艺由 styleDef.extraCss 叠加。
 */

export function buildThemeCss(styleDef) {
  const d = styleDef;
  const varCss = Object.entries(d.vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n  ');
  return `:root {
  --accent: ${d.accent};
  --accent-rgb: ${d.accentRgb};
  ${varCss}
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: ${d.font};
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 32px 16px;
}
.app { width: 100%; max-width: 640px; }
header { text-align: center; margin-bottom: 24px; }
header h1 { font-size: 26px; letter-spacing: 1px; }
header h1 span { color: var(--accent); }
header p { color: var(--text-dim); font-size: 13px; margin-top: 6px; }
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: ${d.radius};
  padding: 18px;
  box-shadow: 0 8px 32px rgba(0,0,0,.35);
  margin-bottom: 16px;
}
button {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: all .15s;
}
button:hover { border-color: var(--accent); color: var(--accent); }
button.primary {
  background: rgba(var(--accent-rgb), .15);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
button:disabled { opacity: .4; cursor: default; }
input, textarea, select {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 15px;
  outline: none;
  width: 100%;
}
input:focus, textarea:focus { border-color: var(--accent); }
.row { display: flex; gap: 10px; }
.grow { flex: 1; }
footer { text-align: center; color: var(--text-faint); font-size: 12px; margin-top: 8px; line-height: 1.8; }
.empty { text-align: center; color: var(--text-dim); padding: 28px 0; font-size: 14px; }

/* ---- 风格工艺叠加 ---- */
${d.extraCss}
`;
}

export function pageShell(title, subtitle, bodyHtml, extraHead = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<link rel="stylesheet" href="./style.css" />
${extraHead}
</head>
<body>
<div class="app">
  <header>
    <h1>${title.includes('<span>') ? title : `<span>◆</span> ${title}`}</h1>
    <p>${subtitle}</p>
  </header>
  ${bodyHtml}
  <footer>OrchestrAI 生成 · 数据保存在本地浏览器</footer>
</div>
<script type="module" src="./app.mjs"></script>
</body>
</html>
`;
}
