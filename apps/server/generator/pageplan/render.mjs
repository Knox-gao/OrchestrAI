import { createHash } from 'node:crypto';
import { validatePagePlan, isSafeUrl } from './schema.mjs';
import { getPagePlanRenderer } from './registry.mjs';
import { renderScene3DNode, SCENE3D_RUNTIME } from './scene3d.mjs';
import { renderSearchNode, renderFilterNode, renderTabsNode, INTERACTION_RUNTIME } from './interactions.mjs';
import { listExtensionPagePlanTypes } from './registry.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));
const attr = (value) => esc(value).replace(/`/g, '&#96;');

const FONT_STACKS = Object.freeze({
  serif: "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
  sans: "Inter, 'Segoe UI', Arial, sans-serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
});
const DENSITY_GAP = Object.freeze({ airy: 'clamp(2rem, 5vw, 5rem)', comfortable: 'clamp(1.4rem, 3vw, 3rem)', compact: 'clamp(1rem, 2vw, 1.8rem)' });
const RADIUS = Object.freeze({ sharp: '0.15rem', soft: '0.6rem', rounded: '1.1rem', pill: '999px' });

function cssFor(theme) {
  // Every value here is either a validated hex or a trusted enum lookup. No model-supplied CSS is emitted.
  const font = FONT_STACKS[theme.fontMood];
  const gap = DENSITY_GAP[theme.density];
  const radius = RADIUS[theme.radius];
  const base = `:root{color-scheme:light;--pp-bg:${theme.background};--pp-surface:${theme.surface};--pp-text:${theme.text};--pp-muted:${theme.muted};--pp-accent:${theme.accent};--pp-accent-soft:${theme.accentSoft};--pp-font:${font};--pp-gap:${gap};--pp-radius:${radius};--pp-border:rgba(85,70,90,.18);--pp-shadow:0 16px 48px rgba(40,30,50,.10)}@supports (color:color-mix(in srgb,black 10%,transparent)){:root{--pp-border:color-mix(in srgb,var(--pp-text) 13%,transparent);--pp-shadow:0 16px 48px color-mix(in srgb,var(--pp-text) 10%,transparent)}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:5rem}body{margin:0;background:var(--pp-bg);color:var(--pp-text);font-family:var(--pp-font);line-height:1.65}a{color:inherit}a:focus-visible,summary:focus-visible{outline:3px solid var(--pp-accent);outline-offset:3px}.pp-skip{position:absolute;left:-9999px;top:0;background:var(--pp-surface);padding:.7rem 1rem;z-index:20}.pp-skip:focus{left:1rem;top:1rem}.pp-header{max-width:1200px;margin:0 auto;padding:1.2rem clamp(1rem,4vw,3rem);display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--pp-border)}.pp-brand{font-weight:750;text-decoration:none}.pp-nav{display:flex;gap:.7rem;flex-wrap:wrap;justify-content:flex-end}.pp-nav a{color:var(--pp-muted);font-size:.88rem;text-decoration:none;padding:.25rem .45rem}.pp-nav a:hover{color:var(--pp-text)}main{width:min(1200px,100%);margin:0 auto;padding:0 clamp(1rem,4vw,3rem)}.pp-section{padding:var(--pp-gap) 0;border-bottom:1px solid var(--pp-border);scroll-margin-top:2rem}.pp-section--hero{min-height:58vh;display:flex;flex-direction:column;justify-content:center}.pp-section--panel{padding:clamp(1.5rem,4vw,3rem);margin:var(--pp-gap) 0;background:var(--pp-surface);border:1px solid var(--pp-border);border-radius:var(--pp-radius);box-shadow:var(--pp-shadow)}.pp-section--contrast{background:var(--pp-surface);padding-inline:clamp(1rem,3vw,2.5rem);border-radius:var(--pp-radius)}.pp-eyebrow{text-transform:uppercase;letter-spacing:.13em;font:600 .74rem/1.4 ${FONT_STACKS.mono};color:var(--pp-accent);margin:0 0 .7rem}.pp-section-title{font-size:clamp(1.8rem,4.3vw,3.9rem);line-height:1.06;letter-spacing:-.035em;margin:0 0 1rem;max-width:18ch}.pp-section-description{color:var(--pp-muted);max-width:68ch;font-size:1.04rem}.pp-heading{line-height:1.15;letter-spacing:-.025em;margin:1.1rem 0 .65rem}.pp-h1{font-size:clamp(2.5rem,7vw,5.8rem);line-height:.98;max-width:13ch}.pp-h2{font-size:clamp(1.7rem,3.8vw,3.1rem)}.pp-h3{font-size:1.28rem}.pp-text{max-width:76ch;color:var(--pp-muted);white-space:pre-wrap}.pp-container{display:grid;gap:clamp(1rem,2.5vw,2rem);margin-block:1rem}.pp-stack{grid-template-columns:minmax(0,1fr)}.pp-split{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}.pp-grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}.pp-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.pp-grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}.pp-card{min-width:0;background:var(--pp-surface);border:1px solid var(--pp-border);border-radius:var(--pp-radius);padding:clamp(1rem,2.4vw,1.7rem);box-shadow:var(--pp-shadow)}.pp-card h3{margin:.2rem 0 .55rem;line-height:1.2}.pp-card p{color:var(--pp-muted);margin:.35rem 0}.pp-image{display:block;width:100%;height:auto;max-height:620px;object-fit:cover;border-radius:var(--pp-radius);border:1px solid var(--pp-border)}.pp-figure{margin:1rem 0}.pp-caption{font-size:.82rem;color:var(--pp-muted);margin-top:.45rem}.pp-link{display:inline-flex;align-items:center;gap:.45rem;padding:.7rem 1rem;border-radius:var(--pp-radius);font-weight:650;text-decoration:none;margin:.4rem .4rem .4rem 0;border:1px solid var(--pp-border)}.pp-link--primary{background:var(--pp-accent);color:#fff;border-color:transparent}.pp-link--secondary{background:var(--pp-accent-soft);color:var(--pp-text)}.pp-link--quiet{color:var(--pp-text)}.pp-list{padding-left:1.35rem}.pp-list li+li{margin-top:.7rem}.pp-list-item-title{display:block;font-weight:700}.pp-details{border:1px solid var(--pp-border);border-radius:var(--pp-radius);padding:1rem 1.15rem;margin:.75rem 0;background:var(--pp-surface)}.pp-details summary{cursor:pointer;font-weight:700}.pp-details-body{padding-top:.7rem;color:var(--pp-muted)}.pp-timeline{list-style:none;padding:0;margin:1.2rem 0;border-left:2px solid var(--pp-border)}.pp-timeline-item{position:relative;margin:0 0 1rem 1.2rem}.pp-timeline-item:before{content:'';position:absolute;left:-1.67rem;top:.8rem;width:.7rem;height:.7rem;border-radius:50%;background:var(--pp-accent);box-shadow:0 0 0 4px var(--pp-bg)}.pp-timeline summary{display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap}.pp-date{font:600 .8rem/1.4 ${FONT_STACKS.mono};color:var(--pp-accent)}.pp-metric{padding:1.2rem;border-top:2px solid var(--pp-accent);background:var(--pp-surface)}.pp-metric-value{font-size:clamp(1.8rem,4vw,3.2rem);font-weight:750;line-height:1.1}.pp-metric-label{font-weight:700}.pp-metric-detail{color:var(--pp-muted);font-size:.88rem}.pp-callout{padding:1rem 1.2rem;border-left:4px solid var(--pp-accent);background:var(--pp-accent-soft);border-radius:0 var(--pp-radius) var(--pp-radius) 0;margin:1rem 0}.pp-callout--warning{border-left-color:#b45309}.pp-callout--success{border-left-color:#15803d}.pp-quote{font-size:clamp(1.2rem,2.5vw,2rem);line-height:1.35;max-width:45ch}.pp-quote-byline{color:var(--pp-muted);font-size:.9rem}.pp-divider{border:0;border-top:1px solid var(--pp-border);margin:2rem 0}.pp-footer{max-width:1200px;margin:0 auto;padding:2rem clamp(1rem,4vw,3rem);color:var(--pp-muted);font-size:.85rem}.pp-render-error{border:2px solid #b91c1c;background:#fef2f2;color:#7f1d1d;padding:1rem;margin:1rem 0}
.pp-scene3d{margin:clamp(1.5rem,4vw,3rem) 0;padding:clamp(1rem,2.5vw,1.6rem);border:1px solid var(--pp-border);border-radius:var(--pp-radius);background:var(--pp-surface);box-shadow:var(--pp-shadow);min-width:0}.pp-scene3d-heading h3{font-size:clamp(1.25rem,2.6vw,2rem);line-height:1.15;margin:0 0 .5rem}.pp-scene3d-description{color:var(--pp-muted);margin:.4rem 0 1rem}.pp-scene3d-stage{position:relative;min-width:0;overflow:hidden;border-radius:calc(var(--pp-radius)*.7);background:linear-gradient(140deg,#fce7f3,#dbeafe 60%,#bae6fd)}.pp-scene3d-canvas{display:block;width:100%;height:var(--pp-scene-height);touch-action:pan-y;cursor:grab;outline-offset:3px}.pp-scene3d-canvas:active{cursor:grabbing}.pp-scene3d-status{position:absolute;left:.7rem;bottom:.45rem;max-width:calc(100% - 1.4rem);margin:0;padding:.25rem .5rem;border-radius:999px;background:rgba(255,255,255,.82);color:#3f3444;font-size:.74rem;pointer-events:none}.pp-scene3d-controls{position:absolute;right:.65rem;top:.65rem;display:flex;gap:.45rem;flex-wrap:wrap;justify-content:flex-end;max-width:80%}.pp-scene3d-control,.pp-scene3d-tide{border:1px solid rgba(80,60,90,.2);border-radius:999px;background:rgba(255,255,255,.9);color:#3f3444;padding:.42rem .7rem;font:600 .78rem/1.2 var(--pp-font)}.pp-scene3d-control{cursor:pointer}.pp-scene3d-control[aria-pressed=true]{background:#352735;color:#fff}.pp-scene3d-tide{display:flex;align-items:center;gap:.35rem}.pp-scene3d-tide input{width:5rem}.pp-scene3d-inspector{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:1rem;margin-top:1rem}.pp-scene3d-inspector strong{display:block;margin-bottom:.25rem}.pp-scene3d-inspector p{margin:0;color:var(--pp-muted);white-space:pre-wrap}.pp-scene3d-object-list{display:flex;flex-wrap:wrap;gap:.45rem;align-content:start}.pp-scene3d-object{border:1px solid var(--pp-border);border-radius:999px;background:var(--pp-bg);color:var(--pp-text);padding:.42rem .7rem;font:inherit;font-size:.82rem;cursor:pointer}.pp-scene3d-object[aria-pressed=true]{background:var(--pp-accent);color:#fff;border-color:transparent}.pp-scene3d-error{margin:.75rem;padding:.75rem 1rem;background:#fff1f2;color:#881337;border:1px solid #fda4af;border-radius:.6rem;font-size:.9rem}.pp-scene3d-error[hidden]{display:none}@media(max-width:760px){.pp-scene3d-inspector{grid-template-columns:minmax(0,1fr)}.pp-scene3d-controls{max-width:95%;left:.45rem;right:.45rem;top:.45rem;justify-content:flex-end}.pp-scene3d-control,.pp-scene3d-tide{font-size:.7rem;padding:.35rem .5rem}.pp-scene3d-canvas{height:min(var(--pp-scene-height),420px)}}
.pp-search{display:grid;gap:.35rem;max-width:36rem;margin:.7rem 0}.pp-search span{font-size:.85rem;font-weight:700;color:var(--pp-muted)}.pp-search label{display:block}.pp-search input{min-width:0;width:100%;padding:.7rem .85rem;border:1px solid var(--pp-border);border-radius:var(--pp-radius);background:var(--pp-surface);color:var(--pp-text);font:inherit}.pp-filter{display:flex;gap:.5rem;flex-wrap:wrap;margin:.75rem 0}.pp-filter-option{border:1px solid var(--pp-border);border-radius:999px;padding:.45rem .8rem;background:var(--pp-surface);color:var(--pp-text);font:inherit;cursor:pointer}.pp-filter-option[aria-pressed=true]{background:var(--pp-accent);border-color:transparent;color:#fff}.pp-collection-status{grid-column:1/-1;margin:0;padding:.55rem .8rem;color:var(--pp-muted);font-size:.85rem;border:1px solid var(--pp-border);border-radius:var(--pp-radius)}.pp-collection-status.is-empty{color:var(--pp-text);border-color:var(--pp-accent);background:var(--pp-accent-soft)}.pp-card[hidden]{display:none!important}.pp-tabs{margin:1rem 0}.pp-tabs [role=tablist]{display:flex;gap:.35rem;flex-wrap:wrap;border-bottom:1px solid var(--pp-border);margin-bottom:1rem}.pp-tabs [role=tab]{appearance:none;border:0;border-bottom:3px solid transparent;padding:.7rem 1rem;background:transparent;color:var(--pp-muted);font:inherit;cursor:pointer}.pp-tabs [role=tab][aria-selected=true]{color:var(--pp-text);border-bottom-color:var(--pp-accent);font-weight:700}.pp-tabs [role=tabpanel][hidden]{display:none!important}.pp-tabs [role=tabpanel]:focus{outline:2px solid var(--pp-accent);outline-offset:3px}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;
  return base + `
.pp-section-title,.pp-heading{text-wrap:balance}.pp-section-description{font-size:clamp(1.04rem,1.6vw,1.22rem);line-height:1.7}.pp-section--hero{position:relative;isolation:isolate;overflow:hidden;min-height:min(76vh,780px);border-bottom:0;background:radial-gradient(ellipse at 88% 38%,var(--pp-accent-soft),transparent 42%)}.pp-section--hero:before{content:"";position:absolute;z-index:-1;pointer-events:none;right:clamp(-8rem,-5vw,-3rem);top:12%;width:clamp(18rem,38vw,34rem);aspect-ratio:1;border:1px solid var(--pp-accent-soft);border-radius:50%;box-shadow:0 0 0 2.6rem rgba(100,100,100,.035),0 0 0 5.2rem rgba(100,100,100,.02)}.pp-section--hero .pp-section-title{max-width:11ch;font-size:clamp(3.2rem,8vw,7rem);line-height:.92;letter-spacing:-.055em}.pp-section--hero .pp-section-description{max-width:54ch}.pp-section--panel{border-left:4px solid var(--pp-accent)}.pp-section--contrast{position:relative;overflow:hidden}.pp-grid-3>.pp-card:nth-child(3n+2){transform:translateY(.65rem)}.pp-card{transition:transform .22s ease,box-shadow .22s ease}.pp-card:hover{transform:translateY(-3px);box-shadow:0 22px 54px rgba(40,30,50,.16)}.pp-grid-3>.pp-card:nth-child(3n+2):hover{transform:translateY(calc(.65rem - 3px))}.pp-metric{border:1px solid var(--pp-border);border-radius:var(--pp-radius);padding:clamp(1.2rem,2.2vw,1.8rem)}.pp-quote-wrap{margin:1rem 0;padding:clamp(1.2rem,3vw,2rem);border-left:4px solid var(--pp-accent);background:var(--pp-accent-soft);border-radius:0 var(--pp-radius) var(--pp-radius) 0}.pp-quote{margin:0}.pp-quote-byline{margin-top:.8rem}.pp-figure{overflow:hidden;border-radius:var(--pp-radius)}.pp-image{transition:transform .5s ease}.pp-figure:hover .pp-image{transform:scale(1.025)}
`;
}

function renderNode(node, context) {
  const c = (children, childContext = context) => children.map((child) => renderNode(child, childContext)).join('\n');
  const id = ` id="${attr(node.id)}"`;
  const href = (raw) => { if (!isSafeUrl(raw)) throw new Error(`unsafe href on node ${node.id}`); return attr(raw); };
  switch (node.type) {
    case 'section': {
      const titleTag = node.variant === 'hero' ? 'h1' : 'h2';
      const titleClass = node.variant === 'hero' ? 'pp-section-title pp-h1' : 'pp-section-title pp-h2';
      const title = node.title ? `<${titleTag} class="${titleClass}" id="${attr(node.id)}-title">${esc(node.title)}</${titleTag}>` : '';
      const eyebrow = node.eyebrow ? `<p class="pp-eyebrow">${esc(node.eyebrow)}</p>` : '';
      const description = node.description ? `<p class="pp-section-description">${esc(node.description)}</p>` : '';
      const label = node.label ? ` aria-label="${attr(node.label)}"` : (node.title ? ` aria-labelledby="${attr(node.id)}-title"` : '');
      return `<section${id} class="pp-section pp-section--${attr(node.variant ?? 'plain')}"${label}>${eyebrow}${title}${description}${c(node.children)}</section>`;
    }
    case 'container': {
      const layout = node.layout;
      const columns = layout === 'grid' ? (node.columns ?? 3) : layout === 'split' ? 2 : 1;
      const cls = layout === 'stack' ? 'pp-stack' : layout === 'split' ? 'pp-split' : `pp-grid-${columns}`;
      const isCollection = context.collectionTargets.has(node.id);
      const childContext = isCollection ? { ...context, activeCollectionId: node.id } : context;
      const children = c(node.children, childContext);
      const status = isCollection ? '<p class="pp-collection-status" data-pp-collection-status aria-live="polite"></p>' : '';
      return `<div${id} class="pp-container ${cls}"${isCollection ? ' data-pp-collection' : ''}>${children}${status}</div>`;
    }
    case 'heading': return `<h${node.level}${id} class="pp-heading pp-h${node.level}">${esc(node.text)}</h${node.level}>`;
    case 'text': return `<p${id} class="pp-text">${esc(node.text)}</p>`;
    case 'image': {
      if (!String(node.src ?? '').trim()) return '';
      if (!isSafeUrl(node.src, { image: true })) throw new Error(`unsafe image src on node ${node.id}`);
      if (/^https:\/\//i.test(node.src)) context.externalAssets.push({ nodeId: node.id, origin: new URL(node.src).origin, kind: 'image' });
      const alt = attr(node.alt);
      const credit = context.imageCredits.get(node.id);
      const creditText = credit ? [credit.author, credit.license].filter(Boolean).join(' · ') : '';
      const creditLink = credit?.page && isSafeUrl(credit.page)
        ? ` · <a href="${href(credit.page)}" target="_blank" rel="noopener noreferrer">来源</a>`
        : '';
      const captionParts = [node.caption ? esc(node.caption) : '', creditText ? `${esc(creditText)}${creditLink}` : ''].filter(Boolean);
      return `<figure${id} class="pp-figure"><img class="pp-image" src="${attr(node.src)}" alt="${alt}" loading="lazy" decoding="async">${captionParts.length ? `<figcaption class="pp-caption">${captionParts.join(' · ')}</figcaption>` : ''}</figure>`;
    }
    case 'link': return `<a${id} class="pp-link pp-link--${attr(node.variant ?? 'quiet')}" href="${href(node.href)}">${esc(node.label)}</a>`;
    case 'card': {
      const collectionAttrs = context.activeCollectionId
        ? ` data-pp-item data-pp-search-text="${attr([node.eyebrow, node.title, node.description, ...(node.children ?? []).flatMap((item) => item.text ? [item.text] : [])].filter(Boolean).join(' '))}" data-pp-tags="${attr((node.tags ?? []).join(' '))}"`
        : '';
      return `<article${id} class="pp-card"${collectionAttrs}>${node.eyebrow ? `<p class="pp-eyebrow">${esc(node.eyebrow)}</p>` : ''}<h3>${esc(node.title)}</h3>${node.description ? `<p>${esc(node.description)}</p>` : ''}${node.children ? c(node.children) : ''}</article>`;
    }
    case 'search': return renderSearchNode(node);
    case 'filter': return renderFilterNode(node);
    case 'tabs': return renderTabsNode(node, (children) => c(children));
    case 'list': return `<ul${id} class="pp-list">${node.items.map((item) => `<li>${item.title ? `<span class="pp-list-item-title">${esc(item.title)}</span>` : ''}${esc(item.text)}</li>`).join('')}</ul>`;
    case 'details': return `<details${id} class="pp-details"><summary>${esc(node.summary)}</summary><div class="pp-details-body">${c(node.children)}</div></details>`;
    // 时间轴是"要读的正文"，默认展开；单独 details 节点才是渐进披露。
    case 'timeline': return `<ol${id} class="pp-timeline">${node.items.map((item) => `<li class="pp-timeline-item"><details class="pp-details" open><summary><time class="pp-date">${esc(item.date)}</time><span>${esc(item.title)}</span></summary><div class="pp-details-body">${esc(item.body)}</div></details></li>`).join('')}</ol>`;
    case 'metric': return `<div${id} class="pp-metric"><div class="pp-metric-value">${esc(node.value)}</div><div class="pp-metric-label">${esc(node.label)}</div>${node.detail ? `<div class="pp-metric-detail">${esc(node.detail)}</div>` : ''}</div>`;
    case 'callout': return `<aside${id} class="pp-callout pp-callout--${attr(node.tone ?? 'neutral')}" role="note"><strong>${esc(node.title)}</strong><p>${esc(node.body)}</p></aside>`;
    case 'divider': return `<hr${id} class="pp-divider">`;
    case 'quote': return `<figure${id} class="pp-quote-wrap"><blockquote class="pp-quote">“${esc(node.text)}”</blockquote>${node.byline ? `<figcaption class="pp-quote-byline">${esc(node.byline)}</figcaption>` : ''}</figure>`;
    // M7-B4D：把 plan 级 sceneBrief 一并交给场景节点，用于主体占幅对照
    case 'scene3d': return renderScene3DNode(node, context.sceneBrief ?? null);
    default: {
      const extension = getPagePlanRenderer(node.type);
      if (!extension) throw new Error(`unsupported renderer type: ${String(node.type)}`);
      // Extension code is trusted application code; plan data remains untrusted.
      return extension.render(structuredClone(node), { escapeHtml: esc, escapeAttribute: attr });
    }
  }
}

function collectSections(nodes, out = []) {
  for (const node of nodes) {
    if (node.type === 'section' && node.title) out.push({ id: node.id, title: node.title });
    if (Array.isArray(node.children)) collectSections(node.children, out);
  }
  return out;
}

export class PagePlanBlockedError extends Error {
  constructor(unsupportedRequests) {
    super(`PagePlan contains ${unsupportedRequests.length} blocking unsupported request(s)`);
    this.name = 'PagePlanBlockedError';
    this.code = 'PAGEPLAN_BLOCKED';
    this.unsupportedRequests = unsupportedRequests;
  }
}

export function renderPagePlan(planInput, options = {}) {
  const plan = validatePagePlan(planInput);
  const blockingUnsupported = plan.unsupportedRequests.filter((item) => item.severity === 'blocking');
  if (blockingUnsupported.length) throw new PagePlanBlockedError(blockingUnsupported);
  const collectionTargets = new Set(collectNodes(plan.nodes).filter((n) => n.type === 'search' || n.type === 'filter').map((n) => n.targetId));
  const imageCredits = options.imageCredits instanceof Map
    ? options.imageCredits
    : new Map(Object.entries(options.imageCredits ?? {}));
  const context = { externalAssets: [], collectionTargets, activeCollectionId: null, sceneBrief: plan.sceneBrief ?? null, imageCredits };
  // 限制说明只能有一处来源（unsupportedRequests）。模型若自己写了一整段"已知限制/未实现"，
  // 会和渲染器追加的披露重复，而且可能是模型臆造的限制；这里整段剔除，由渲染器统一生成。
  const LIMITS_SECTION_RE = /^(已知限制|本次限制|限制说明|未实现的功能|known limitations?|limitations?)$/i;
  const hasWarnings = plan.unsupportedRequests.some((item) => item.severity === 'nonblocking');
  const nodesToRender = hasWarnings
    ? plan.nodes.filter((node) => !(node.type === 'section' && LIMITS_SECTION_RE.test(String(node.title ?? '').trim())))
    : plan.nodes;
  const body = nodesToRender.map((node) => renderNode(node, context)).join('\n');
  const sections = collectSections(nodesToRender).slice(0, 10);
  const nav = sections.length >= 2
    ? `<nav class="pp-nav" aria-label="页面导航">${sections.map((s) => `<a href="#${attr(s.id)}">${esc(s.title)}</a>`).join('')}</nav>`
    : '';
  const lang = /^[A-Za-z0-9-]{2,20}$/.test(plan.meta.language) ? plan.meta.language : 'zh-CN';
  const unsupportedWarnings = plan.unsupportedRequests.filter((item) => item.severity === 'nonblocking');
  const unsupportedNotice = unsupportedWarnings.length
    ? `<aside class="pp-callout pp-callout--warning" role="note" aria-label="已知限制"><strong>本次生成的已知限制</strong><ul>${unsupportedWarnings.map((item) => `<li><strong>${esc(item.capability)}：</strong>${esc(item.reason)}</li>`).join('')}</ul></aside>`
    : '';
  const scene3dCount = countType(plan.nodes, 'scene3d');
  // 安全模型：3D 与交互 runtime 以**内联**方式嵌入，并用 CSP hash 精确白名单放行。
  // 不走外部 .js + SRI 的原因：`file://` 下浏览器按 opaque origin 处理，
  // 带 crossorigin 的外部脚本会被 CORS 直接拦截（file:// 下本地交付的交互会无法初始化）。
  // CSP hash 的强度不低于 SRI：脚本字节一变，浏览器就不执行。
  const interactionCount = collectNodes(plan.nodes).filter((n) => ['search', 'filter', 'tabs'].includes(n.type)).length;
  const runtime = [scene3dCount ? SCENE3D_RUNTIME : '', interactionCount ? INTERACTION_RUNTIME : ''].filter(Boolean).join('\n');
  const runtimeHash = runtime ? `sha256-${createHash('sha256').update(runtime, 'utf8').digest('base64')}` : '';
  const scriptTag = runtime ? `<script>${runtime}</script>` : '';
  const csp = runtime
    ? `default-src 'none'; script-src '${runtimeHash}'; style-src 'unsafe-inline'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; form-action 'none'`
    : `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const html = `<!doctype html>
<html lang="${attr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${attr(csp)}">
<meta name="description" content="${attr(plan.meta.description)}">
<meta name="color-scheme" content="light">
<title>${esc(plan.meta.title)}</title>
<style>${cssFor(plan.theme)}</style>
</head>
<body>
<a class="pp-skip" href="#main">跳转到主要内容</a>
<header class="pp-header"><a class="pp-brand" href="#main">${esc(plan.meta.title)}</a>${nav}</header>
<main id="main">${body}${unsupportedNotice}</main>
<footer class="pp-footer">由 OrchestrAI 结构化渲染引擎生成 · ${esc(plan.meta.title)}</footer>
${scriptTag}
</body>
</html>`;
  return {
    files: { 'index.html': html },
    report: {
      schemaVersion: plan.schemaVersion,
      title: plan.meta.title,
      nodeCount: countNodes(plan.nodes),
      externalAssets: context.externalAssets,
      features: { nativeDetails: countNativeDisclosures(plan.nodes), links: countType(plan.nodes, 'link'), images: countRenderedImages(plan.nodes), interactions: interactionCount, trustedRuntime: Boolean(runtime), scene3d: { scenes: scene3dCount, objects: countSceneObjects(plan.nodes), renderer: scene3dCount ? 'WebGL1-local-no-dependencies' : 'none', orbitControls: scene3dCount > 0, zoomControls: scene3dCount > 0, cspHash: runtimeHash || null, autoFrame: scene3dCount > 0 } },
      warnings: [
        ...(context.externalAssets.length ? ['External image URLs require network access; bundle approved assets for offline ZIP delivery.'] : []),
        ...unsupportedWarnings.map((item) => `Unsupported nonblocking request: ${item.requirementId} / ${item.capability}`),
      ],
      unsupportedRequests: structuredClone(plan.unsupportedRequests),
      mobileLayoutDelivery: false,
    },
  };
}

function nestedNodes(node) {
  return [
    ...(Array.isArray(node.children) ? node.children : []),
    ...(node.type === 'tabs' ? (node.panels ?? []).flatMap((panel) => panel.children ?? []) : []),
  ];
}
function countNodes(nodes) { return nodes.reduce((sum, node) => sum + 1 + countNodes(nestedNodes(node)), 0); }
function countNativeDisclosures(nodes) { return nodes.reduce((sum, node) => sum + (node.type === 'details' ? 1 : 0) + (node.type === 'timeline' ? (node.items?.length ?? 0) : 0) + countNativeDisclosures(nestedNodes(node)), 0); }
function countType(nodes, type) { return nodes.reduce((sum, node) => sum + (node.type === type ? 1 : 0) + countType(nestedNodes(node), type), 0); }
function countRenderedImages(nodes) { return nodes.reduce((sum, node) => sum + (node.type === 'image' && Boolean(String(node.src ?? '').trim()) ? 1 : 0) + countRenderedImages(nestedNodes(node)), 0); }
function countSceneObjects(nodes) { return nodes.reduce((sum, node) => sum + (node.type === 'scene3d' ? (node.objects?.length ?? 0) : 0) + countSceneObjects(nestedNodes(node)), 0); }

function collectNodes(nodes, out = []) {
  for (const node of nodes ?? []) {
    out.push(node);
    if (Array.isArray(node.children)) collectNodes(node.children, out);
    if (node.type === 'tabs') for (const panel of node.panels ?? []) collectNodes(panel.children, out);
  }
  return out;
}
