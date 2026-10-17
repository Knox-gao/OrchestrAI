/** 双原型布局差异量化（复用 H3 探针手法） */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROBE = `<script>window.addEventListener('load', () => { setTimeout(() => {
  const t = 'PROBE::' + JSON.stringify({
    pageH: document.documentElement.scrollHeight,
    heroH: Math.round((document.querySelector('.hero') || document.querySelector('.top'))?.getBoundingClientRect().height || 0),
    imgArea: Math.round([...document.images].reduce((a, i) => a + i.getBoundingClientRect().width * i.getBoundingClientRect().height, 0)),
    textLen: document.body.innerText.replace(/\s/g, '').length,
    fontFam: getComputedStyle(document.body).fontFamily.slice(0, 22),
    gridCols: getComputedStyle(document.querySelector('.stats, .intro') || document.body).gridTemplateColumns.split(' ').length,
  });
  document.title = t; const h = document.querySelector('title'); if (h) h.textContent = t;
}, 900); });</script>`;
const dom = (file) => new Promise((res, rej) => execFile(EDGE, ['--headless=new', '--disable-gpu', '--dump-dom', '--window-size=1440,900', '--virtual-time-budget=6000', 'file:///' + file.replaceAll('\\', '/')], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (e, so) => (e ? rej(e) : res(so))));
const out = {};
for (const v of ['A', 'B']) {
  const html = fs.readFileSync(path.join(HERE, `proto-${v}.html`), 'utf8').replace('</head>', PROBE + '</head>');
  const f = path.join(HERE, `proto-${v}-probe.html`);
  fs.writeFileSync(f, html);
  const d = await dom(f);
  out[v] = JSON.parse(d.match(/PROBE::(\{[^<]*)/)[1]);
  fs.unlinkSync(f);
}
const diff = {
  首屏: `${out.A.heroH}px 沉浸图 vs ${out.B.heroH}px 紧凑顶栏`,
  页面高度: `${out.A.pageH} vs ${out.B.pageH}（A 叙事长页）`,
  图片总面积: `${out.A.imgArea} vs ${out.B.imgArea}（A 图主导）`,
  文本密度: `${out.A.textLen} vs ${out.B.textLen} 字符（B 信息密集）`,
  字体: `${out.A.fontFam} vs ${out.B.fontFam}`,
};
fs.writeFileSync(path.join(HERE, 'proto-diff.json'), JSON.stringify({ metrics: out, diff }, null, 1));
console.log(JSON.stringify(diff, null, 1));
