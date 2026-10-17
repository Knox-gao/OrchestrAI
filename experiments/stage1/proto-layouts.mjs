/**
 * 阶段一最小差异化原型：同一需求（境屿建筑设计事务所）→ 两种实质差异布局
 *   Variant A「editorial 编辑式」：1200px 宽幅 / 全屏沉浸首图+超大衬线标题 / 图文交错长叙事 / 低密度大留白
 *   Variant B「workbench 工作台式」：960px 紧凑 / 顶部导航+统计条 / 项目列表行(小缩略+数据列) / 高密度
 * 内容数据完全相同——差异只在信息架构/首屏构图/密度/字体/节奏（H2 Brief 的两个方向落地）。
 * 产出：proto-A.html / proto-B.html（用 Edge headless 截图存证）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const DATA = {
  name: '境屿建筑',
  tagline: '以材料与光，构建沉默的纪念性',
  intro: '境屿建筑成立于 2012 年，专注于美术馆、文化设施与私人收藏空间。我们相信建筑的价值不在于表达的密度，而在于体验的秩序。',
  projects: [
    { n: '屿间美术馆', y: 2024, loc: '杭州 · 千岛湖', area: '4,200㎡', typ: '文化建筑' },
    { n: '沉壁艺术中心', y: 2023, loc: '秦皇岛 · 北戴河', area: '6,800㎡', typ: '文化建筑' },
    { n: '拾光藏家宅邸', y: 2022, loc: '上海 · 西郊', area: '1,150㎡', typ: '私人住宅' },
    { n: '雾岭观星台', y: 2021, loc: '丽水 · 遂昌', area: '380㎡', typ: '公共设施' },
    { n: '白帆社区图书馆', y: 2020, loc: '深圳 · 盐田', area: '2,600㎡', typ: '文化建筑' },
    { n: '砚山茶事空间', y: 2019, loc: '泉州 · 安溪', area: '540㎡', typ: '商业空间' },
  ],
  stats: [{ k: '建成项目', v: '34' }, { k: '设计奖项', v: '17' }, { k: '平均周期', v: '26 月' }, { k: '回头客户', v: '61%' }],
  contact: { email: 'studio@jingyu.archi', tel: '+86 571 8890 0000', addr: '杭州市西湖区转塘街道象山艺术公社 2-301' },
};
// 原型用程序化占位图（真实采集图在阶段二接入 Image Brief 管线；此处聚焦布局差异验证）
const ph = (w, h, c1, c2, label) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><rect x="${w * 0.12}" y="${h * 0.18}" width="${w * 0.3}" height="${h * 0.64}" fill="rgba(255,255,255,.16)"/><text x="${w * 0.12}" y="${h * 0.92}" font-family="Georgia" font-size="${Math.round(h * 0.05)}" fill="rgba(255,255,255,.75)">${label}</text></svg>`)}`;

/* ---------- Variant A：编辑式 ---------- */
const A = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${DATA.name} · 编辑式方向</title><style>
:root { --ink:#171614; --paper:#efece6; --bronze:#8a7355; --line:rgba(23,22,20,.18); }
* { margin:0; box-sizing:border-box; }
body { background:var(--paper); color:var(--ink); font-family:Georgia,'Songti SC',serif; }
.hero { position:relative; height:92vh; min-height:560px; overflow:hidden; }
.hero img { width:100%; height:100%; object-fit:cover; display:block; }
.hero .cap { position:absolute; left:8vw; bottom:9vh; max-width:760px; }
.hero h1 { font-size:clamp(52px,7.2vw,108px); font-weight:400; letter-spacing:.06em; line-height:1.04; color:#f5f2ec; text-shadow:0 2px 30px rgba(0,0,0,.35); }
.hero p { margin-top:22px; color:rgba(245,242,236,.85); font-size:clamp(15px,1.3vw,19px); letter-spacing:.22em; }
.intro { display:grid; grid-template-columns:repeat(12,1fr); gap:24px; padding:11vh 8vw; max-width:1280px; margin:0 auto; }
.intro .kicker { grid-column:1/4; color:var(--bronze); letter-spacing:.3em; font-size:12px; }
.intro p { grid-column:5/12; font-size:clamp(17px,1.5vw,22px); line-height:2.1; }
.proj { display:grid; grid-template-columns:repeat(12,1fr); gap:24px; padding:0 8vw 12vh; max-width:1280px; margin:0 auto; align-items:end; }
.proj:nth-of-type(odd) .img { grid-column:1/9; } .proj:nth-of-type(odd) .meta { grid-column:9/13; }
.proj:nth-of-type(even) .img { grid-column:5/13; order:2; } .proj:nth-of-type(even) .meta { grid-column:1/5; order:1; }
.proj .img img { width:100%; aspect-ratio:3/2; object-fit:cover; display:block; }
.proj .meta h3 { font-size:clamp(24px,2.4vw,34px); font-weight:400; margin-bottom:14px; }
.proj .meta dl { font-size:13px; line-height:2.2; color:rgba(23,22,20,.66); }
.proj .meta dt { display:inline; letter-spacing:.14em; } .proj .meta dd { display:inline; margin:0 14px 0 6px; }
.contact { border-top:1px solid var(--line); margin-top:4vh; padding:9vh 8vw 12vh; display:grid; grid-template-columns:1fr 1fr; gap:40px; max-width:1280px; margin-inline:auto; }
.contact h2 { font-size:clamp(26px,2.6vw,38px); font-weight:400; }
.contact .v { font-size:14px; line-height:2.4; color:rgba(23,22,20,.7); }
@media (max-width:820px){ .intro .kicker,.intro p{grid-column:1/13} .proj .img,.proj .meta{grid-column:1/13 !important; order:initial !important} .contact{grid-template-columns:1fr} }
</style></head><body>
<section class="hero"><img src="${ph(1440, 900, '#3d4138', '#8f8672', 'HERO · 屿间美术馆')}" alt="">
  <div class="cap"><h1>${DATA.name}</h1><p>${DATA.tagline}</p></div></section>
<section class="intro"><div class="kicker">事务所 · PROFILE</div><p>${DATA.intro}</p></section>
${DATA.projects.slice(0, 4).map((p) => `<section class="proj"><div class="img"><img src="${ph(960, 640, '#6a6a5e', '#a89e88', p.n)}" alt=""></div>
  <div class="meta"><h3>${p.n}</h3><dl><dt>年份</dt><dd>${p.y}</dd><dt>地点</dt><dd>${p.loc}</dd><dt>规模</dt><dd>${p.area}</dd><dt>类型</dt><dd>${p.typ}</dd></dl></div></section>`).join('\n')}
<section class="contact"><h2>委托咨询</h2><div class="v">${DATA.contact.email}<br>${DATA.contact.tel}<br>${DATA.contact.addr}</div></section>
</body></html>`;

/* ---------- Variant B：工作台式 ---------- */
const B = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${DATA.name} · 工作台方向</title><style>
:root { --ink:#1b1d22; --bg:#f4f5f7; --panel:#fff; --accent:#2f5d50; --line:#dfe2e7; --mono:'Cascadia Mono',ui-monospace,monospace; }
* { margin:0; box-sizing:border-box; }
body { background:var(--bg); color:var(--ink); font:14px/1.6 'Segoe UI','Microsoft YaHei',sans-serif; }
.top { display:flex; align-items:center; gap:26px; padding:14px 28px; background:var(--panel); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:5; }
.top b { font-size:16px; letter-spacing:.28em; }
.top nav { display:flex; gap:20px; font-size:13px; color:#5a6068; }
.top .sp { flex:1; } .top .em { font-family:var(--mono); font-size:12px; color:var(--accent); }
.wrap { max-width:1020px; margin:0 auto; padding:26px 28px 70px; }
.stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:22px; }
.stat { background:var(--panel); border:1px solid var(--line); padding:14px 16px; }
.stat b { display:block; font-family:var(--mono); font-size:26px; color:var(--accent); }
.stat span { font-size:11.5px; color:#70767e; letter-spacing:.1em; }
table.proj { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); }
table.proj th { text-align:left; font-size:11px; letter-spacing:.16em; color:#70767e; padding:10px 14px; border-bottom:1px solid var(--line); background:#fafbfc; }
table.proj td { padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:middle; }
table.proj tr:hover td { background:#f2f6f4; }
td.thumb { width:120px; } td.thumb img { width:104px; height:64px; object-fit:cover; display:block; }
td.n { font-weight:600; } td.y,td.a { font-family:var(--mono); font-size:13px; }
.filters { display:flex; gap:8px; margin:18px 0 10px; }
.filters i { font-style:normal; font-size:12px; padding:5px 12px; border:1px solid var(--line); border-radius:99px; background:var(--panel); }
.filters i.on { background:var(--accent); color:#fff; border-color:var(--accent); }
.about { display:grid; grid-template-columns:1.2fr 1fr; gap:16px; margin:20px 0; }
.about .card { background:var(--panel); border:1px solid var(--line); padding:16px 18px; font-size:13px; line-height:1.9; color:#3c4148; }
.contact { background:var(--panel); border:1px solid var(--line); padding:16px 18px; display:flex; gap:34px; font-family:var(--mono); font-size:12.5px; }
.contact span { color:#70767e; }
@media (max-width:820px){ .stats{grid-template-columns:repeat(2,1fr)} .about{grid-template-columns:1fr} .top nav{display:none} }
</style></head><body>
<header class="top"><b>境屿建筑</b><nav><span>项目</span><span>事务所</span><span>奖项</span><span>联系</span></nav>
  <span class="sp"></span><span class="em">EST. 2012 · HANGZHOU</span></header>
<div class="wrap">
  <div class="stats">${DATA.stats.map((s) => `<div class="stat"><b>${s.v}</b><span>${s.k}</span></div>`).join('')}</div>
  <div class="filters"><i class="on">全部 ${DATA.projects.length}</i><i>文化建筑 3</i><i>私人住宅 1</i><i>公共设施 1</i><i>商业空间 1</i></div>
  <table class="proj"><tr><th></th><th>项目</th><th>年份</th><th>地点</th><th>规模</th><th>类型</th></tr>
    ${DATA.projects.map((p) => `<tr><td class="thumb"><img src="${ph(208, 128, '#5d6b62', '#9aa79b', p.n)}" alt=""></td><td class="n">${p.n}</td><td class="y">${p.y}</td><td>${p.loc}</td><td class="a">${p.area}</td><td>${p.typ}</td></tr>`).join('')}
  </table>
  <div class="about"><div class="card">${DATA.intro}</div>
    <div class="contact"><div><span>EMAIL</span><br>${DATA.contact.email}<br><span>TEL</span><br>${DATA.contact.tel}</div><div><span>STUDIO</span><br>${DATA.contact.addr}</div></div></div>
</div></body></html>`;

fs.writeFileSync(path.join(HERE, 'proto-A.html'), A);
fs.writeFileSync(path.join(HERE, 'proto-B.html'), B);
console.log('proto-A.html / proto-B.html 已生成，内容同源，布局：A=编辑式宽幅交错叙事 vs B=工作台高密度表格');
