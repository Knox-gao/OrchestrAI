/**
 * 布局原语（阶段二任务 B·最小版）：editorial / workbench
 * 从阶段一 proto-A/B 提炼为参数化骨架；content 为同一数据源，布局决定信息架构与节奏。
 * pageShell（theme.mjs）保留为回退布局——pickLayout 未命中或 Brief 缺失时使用。
 */

/** editorial：编辑式宽幅——全屏沉浸首图 + 超大标题 + 图文交错长叙事 + 大留白 */
export function editorial({ title, tagline, intro, sections = [], contact = '', tokens, heroImg = '' }) {
  const hero = heroImg || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f3230"/><stop offset="1" stop-color="#8f8672"/></linearGradient></defs><rect width="1440" height="900" fill="url(#g)"/></svg>`)}`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="./style.css"></head><body class="lay lay-editorial">
<section class="hero"><img src="${hero}" alt=""><div class="cap"><h1>${title}</h1><p>${tagline ?? ''}</p></div></section>
<section class="ed-intro"><div class="kicker">PROFILE</div><p class="lead">${intro ?? ''}</p></section>
${sections.map((s, i) => `<section class="ed-row${i % 2 ? ' flip' : ''}"><div class="ed-img"><img src="${s.img || hero}" alt="" loading="lazy"></div>
<div class="ed-meta"><h3>${s.title}</h3><p>${s.text ?? ''}</p>${(s.facts ?? []).map((f) => `<span class="fact">${f}</span>`).join('')}</div></section>`).join('\n')}
${contact ? `<section class="ed-contact"><h2>联系我们</h2><div class="v">${contact}</div></section>` : ''}
</body></html>`;
  const css = `.lay-editorial { font-family: var(--font-body); background: ${tokens.bgMood === 'dark' ? '#141513' : '#efece6'}; color: ${tokens.bgMood === 'dark' ? '#e8e5de' : '#171614'}; margin: 0; }
.lay-editorial .hero { position: relative; height: 88vh; min-height: 520px; overflow: hidden; }
.lay-editorial .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lay-editorial .hero .cap { position: absolute; left: 8vw; bottom: 9vh; max-width: 760px; }
.lay-editorial .hero h1 { font-family: var(--font-display); font-size: clamp(48px, 7vw, 104px); font-weight: 400; letter-spacing: .06em; line-height: 1.05; color: #f5f2ec; text-shadow: 0 2px 30px rgba(0,0,0,.35); margin: 0; }
.lay-editorial .hero p { margin: 22px 0 0; color: rgba(245,242,236,.85); letter-spacing: .22em; font-size: clamp(14px, 1.2vw, 18px); }
.lay-editorial .ed-intro { display: grid; grid-template-columns: repeat(12, 1fr); gap: 24px; padding: 10vh 8vw; max-width: var(--layout-max); margin: 0 auto; }
.lay-editorial .kicker { grid-column: 1/4; color: var(--layout-accent); letter-spacing: .3em; font-size: 12px; }
.lay-editorial .lead { grid-column: 5/12; font-size: clamp(17px, 1.5vw, 22px); line-height: 2.05; margin: 0; }
.lay-editorial .ed-row { display: grid; grid-template-columns: repeat(12, 1fr); gap: 24px; padding: 0 8vw 11vh; max-width: var(--layout-max); margin: 0 auto; align-items: end; }
.lay-editorial .ed-row .ed-img { grid-column: 1/9; } .lay-editorial .ed-row .ed-meta { grid-column: 9/13; }
.lay-editorial .ed-row.flip .ed-img { grid-column: 5/13; order: 2; } .lay-editorial .ed-row.flip .ed-meta { grid-column: 1/5; order: 1; }
.lay-editorial .ed-img img { width: 100%; aspect-ratio: 3/2; object-fit: cover; display: block; }
.lay-editorial .ed-meta h3 { font-family: var(--font-display); font-size: clamp(22px, 2.2vw, 32px); font-weight: 400; margin: 0 0 14px; }
.lay-editorial .ed-meta p { font-size: 14.5px; line-height: 2; opacity: .78; margin: 0 0 12px; }
.lay-editorial .fact { display: inline-block; font-size: 12px; letter-spacing: .12em; opacity: .6; margin: 0 14px 6px 0; }
.lay-editorial .ed-contact { border-top: 1px solid rgba(128,124,112,.3); max-width: var(--layout-max); margin: 4vh auto 0; padding: 9vh 8vw 12vh; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
.lay-editorial .ed-contact h2 { font-family: var(--font-display); font-size: clamp(24px, 2.4vw, 36px); font-weight: 400; margin: 0; }
.lay-editorial .ed-contact .v { font-size: 14px; line-height: 2.4; opacity: .7; }
@media (max-width: 820px) { .lay-editorial .kicker, .lay-editorial .lead { grid-column: 1/13 } .lay-editorial .ed-row .ed-img, .lay-editorial .ed-row .ed-meta { grid-column: 1/13 !important; order: initial !important } .lay-editorial .ed-contact { grid-template-columns: 1fr } }`;
  return { html, css };
}

/** workbench：工作台式——sticky 顶栏 + 统计条 + 高密度数据行 + 等宽细节 */
export function workbench({ title, tagline, intro, sections = [], contact = '', tokens, heroImg = '' }) {
  const thumb = heroImg || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="208" height="128"><rect width="208" height="128" fill="#5d6b62"/></svg>`)}`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="./style.css"></head><body class="lay lay-workbench">
<header class="wb-top"><b>${title}</b><nav><span>总览</span><span>条目</span><span>关于</span></nav><span class="sp"></span><span class="em">${tagline ?? ''}</span></header>
<div class="wb-wrap">
  <div class="wb-stats">${(sections[0]?.stats ?? []).map((s) => `<div class="stat"><b>${s.v}</b><span>${s.k}</span></div>`).join('')}</div>
  <table class="wb-rows"><tr><th></th><th>名称</th><th>说明</th><th>标签</th></tr>
    ${sections.map((s) => `<tr><td class="thumb"><img src="${s.img || thumb}" alt="" loading="lazy"></td><td class="n">${s.title}</td><td class="d">${s.text ?? ''}</td><td class="t">${(s.facts ?? []).join(' · ')}</td></tr>`).join('')}
  </table>
  <div class="wb-about"><div class="card">${intro ?? ''}</div>${contact ? `<div class="wb-contact">${contact}</div>` : ''}</div>
</div></body></html>`;
  const css = `.lay-workbench { font-family: var(--font-body); background: ${tokens.bgMood === 'dark' ? '#15171a' : '#f4f5f7'}; color: ${tokens.bgMood === 'dark' ? '#e6e8ea' : '#1b1d22'}; margin: 0; }
.lay-workbench .wb-top { display: flex; align-items: center; gap: 26px; padding: 14px 28px; background: ${tokens.bgMood === 'dark' ? '#1b1e22' : '#fff'}; border-bottom: 1px solid rgba(128,134,142,.25); position: sticky; top: 0; z-index: 5; }
.lay-workbench .wb-top b { letter-spacing: .28em; font-size: 16px; }
.lay-workbench .wb-top nav { display: flex; gap: 20px; font-size: 13px; opacity: .62; }
.lay-workbench .sp { flex: 1; } .lay-workbench .em { font-family: 'Cascadia Mono', ui-monospace, monospace; font-size: 12px; color: var(--layout-accent); }
.lay-workbench .wb-wrap { max-width: var(--layout-max); margin: 0 auto; padding: 26px 28px 70px; }
.lay-workbench .wb-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
.lay-workbench .stat { background: ${tokens.bgMood === 'dark' ? '#1b1e22' : '#fff'}; border: 1px solid rgba(128,134,142,.25); border-radius: var(--layout-radius); padding: 14px 16px; }
.lay-workbench .stat b { display: block; font-family: 'Cascadia Mono', ui-monospace, monospace; font-size: 26px; color: var(--layout-accent); }
.lay-workbench .stat span { font-size: 11.5px; opacity: .6; letter-spacing: .1em; }
.lay-workbench table.wb-rows { width: 100%; border-collapse: collapse; background: ${tokens.bgMood === 'dark' ? '#1b1e22' : '#fff'}; border: 1px solid rgba(128,134,142,.25); border-radius: var(--layout-radius); overflow: hidden; }
.lay-workbench .wb-rows th { text-align: left; font-size: 11px; letter-spacing: .16em; opacity: .55; padding: 10px 14px; border-bottom: 1px solid rgba(128,134,142,.25); }
.lay-workbench .wb-rows td { padding: 10px 14px; border-bottom: 1px solid rgba(128,134,142,.18); vertical-align: middle; font-size: 13.5px; }
.lay-workbench .wb-rows tr:hover td { background: rgba(90,140,120,.08); }
.lay-workbench td.thumb { width: 130px; } .lay-workbench td.thumb img { width: 112px; height: 66px; object-fit: cover; display: block; border-radius: var(--layout-radius); }
.lay-workbench td.n { font-weight: 600; white-space: nowrap; } .lay-workbench td.d { opacity: .75; } .lay-workbench td.t { font-size: 12px; opacity: .6; white-space: nowrap; }
.lay-workbench .wb-about { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; margin-top: 20px; }
.lay-workbench .card, .lay-workbench .wb-contact { background: ${tokens.bgMood === 'dark' ? '#1b1e22' : '#fff'}; border: 1px solid rgba(128,134,142,.25); border-radius: var(--layout-radius); padding: 16px 18px; font-size: 13px; line-height: 1.9; opacity: .9; }
.lay-workbench .wb-contact { font-family: 'Cascadia Mono', ui-monospace, monospace; font-size: 12.5px; }
@media (max-width: 820px) { .lay-workbench .wb-stats { grid-template-columns: repeat(2, 1fr) } .lay-workbench .wb-about { grid-template-columns: 1fr } .lay-workbench .wb-top nav { display: none } }`;
  return { html, css };
}

/** Brief → 布局原语映射（未命中回退 null → pageShell） */
export function pickLayout(brief) {
  const strategy = brief?.directions?.[0]?.layoutStrategy;
  if (strategy === 'editorial' || strategy === 'magazine' || strategy === 'minimal' || strategy === 'showcase') return 'editorial';
  if (strategy === 'workbench' || strategy === 'catalog') return 'workbench';
  return null; // stage 等由专属模板承接；null = 沿用 pageShell
}
