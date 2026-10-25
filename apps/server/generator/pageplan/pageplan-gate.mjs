/**
 * PagePlan 专属质量门禁（M7-B4B）
 *
 * 旧模板门禁（generator/quality.mjs）要求 PWA 清单/SW/图标/逻辑测试文件，
 * 那是模板产物的契约；PagePlan 产物是"单页静态站点 + 结构化节点树"，
 * 用旧门禁会误判为缺失文件。这里给出与 PagePlan 产物契约一致的真实检查：
 *
 *   1) 结构：doctype / lang / title / viewport / 唯一 main
 *   2) 安全：无可执行脚本（唯一例外是与内置 scene3d / 交互 runtime 字节级一致的脚本）、
 *            无内联事件处理器、无可执行 URL、scene3d 配置块是合法 JSON 且无 </script 逃逸
 *   3) 可达：所有 #fragment 锚点都能在文档里找到对应 id
 *   4) 无障碍：每个 <img> 必须有 alt 属性
 *   5) 主题：PagePlan 主题变量存在且为 #RRGGBB
 *   6) 交互有效性：搜索 / 筛选必须绑定卡片集合，标签页必须有面板与可信运行时
 *   7) 计划一致性：plan 里的 section id 必须真的出现在产物里
 *
 * 所有检查都读落盘/待写盘的**真实文本**，不做形式化声明。
 */

import fs from 'node:fs';
import path from 'node:path';
import { SCENE3D_RUNTIME } from './scene3d.mjs';
import { SCROLL_RUNTIME } from './scrollcinema.mjs';
import { INTERACTION_RUNTIME } from './interactions.mjs';

const THEME_VARS = ['--pp-bg', '--pp-surface', '--pp-text', '--pp-muted', '--pp-accent', '--pp-accent-soft'];

function extractIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

/**
 * 检查 PagePlan 产物 HTML 文本。
 * @param {string} html
 * @param {{sectionIds?: string[], title?: string}} expect
 * @returns {{problems: string[], metrics: Object}}
 */
export function checkPagePlanHtml(html, expect = {}) {
  const problems = [];
  const text = String(html ?? '');
  if (!text.trim()) return { problems: ['index.html 为空'], metrics: { bytes: 0 } };

  if (!/^<!doctype html>/i.test(text.trim())) problems.push('缺少 <!doctype html>');
  if (!/<html[^>]*\slang="[^"]+"/i.test(text)) problems.push('<html> 缺少 lang 属性');
  if (!/<title>[^<]+<\/title>/i.test(text)) problems.push('缺少非空 <title>');
  if (!/<meta[^>]+name="viewport"[^>]+content="[^"]*width=device-width/i.test(text)) problems.push('缺少移动自适应 viewport meta');
  const mains = (text.match(/<main\b/g) ?? []).length;
  if (mains !== 1) problems.push(`<main> 数量应为 1，实际 ${mains}`);

  // 安全：模型不得注入可执行内容。
  // 唯一允许的可执行脚本是**应用自己写的** scene3d 与 PagePlan 交互 runtime，判定标准是字节级完全一致，
  // 因此模型无法借道塞入任何额外代码；config 块必须是 application/json 且不含 </script 逃逸。
  const scriptBlocks = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const executable = scriptBlocks.filter((m) => !/type\s*=\s*"application\/json"/i.test(m[1]));
  const configBlocks = scriptBlocks.filter((m) => /type\s*=\s*"application\/json"/i.test(m[1]));
  // 渲染器按需组合 scene3d / interaction / scroll 三个运行时（canonical 顺序），
  // 门禁信任所有非空子集的组合；字节级完全一致仍是唯一放行标准。
  const RUNTIME_POOL = [SCENE3D_RUNTIME, INTERACTION_RUNTIME, SCROLL_RUNTIME];
  const TRUSTED_RUNTIMES = [];
  for (let mask = 1; mask < 8; mask += 1) {
    TRUSTED_RUNTIMES.push(RUNTIME_POOL.filter((_, i) => mask & (1 << i)).join('\n'));
  }
  const unexpected = executable.filter((m) => !TRUSTED_RUNTIMES.includes(m[2]));
  if (unexpected.length) {
    problems.push(`产物含 ${unexpected.length} 处非可信脚本（只允许与内置运行时字节完全一致的脚本）`);
  }
  const renderedMarkup = text.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const hasInteractionControls = /data-pp-(?:search-target|filter-target|tabs)\b/.test(renderedMarkup);
  const hasInteractionRuntime = executable.some((m) => m[2] === INTERACTION_RUNTIME || m[2] === [SCENE3D_RUNTIME, INTERACTION_RUNTIME].join('\n'));
  if (hasInteractionControls && !hasInteractionRuntime) problems.push('页面包含搜索、筛选或标签控件，但没有绑定可信交互运行时');
  const collectionIds = new Set([...renderedMarkup.matchAll(/<div\b[^>]*\bdata-pp-collection\b[^>]*>/gi)]
    .map((match) => match[0].match(/\sid="([^"]+)"/i)?.[1]).filter(Boolean));
  for (const match of renderedMarkup.matchAll(/\bdata-pp-(?:search|filter)-target="([^"]+)"/gi)) {
    if (!collectionIds.has(match[1])) problems.push(`交互控件目标 #${match[1]} 没有可筛选的卡片集合`);
  }
  const tabRoots = (renderedMarkup.match(/<div\b[^>]*class="pp-tabs"[^>]*\bdata-pp-tabs\b/gi) ?? []).length;
  const tabButtons = (renderedMarkup.match(/\bdata-pp-tab-button=/g) ?? []).length;
  const tabPanels = (renderedMarkup.match(/\bdata-pp-tab-panel=/g) ?? []).length;
  if (tabRoots && (!hasInteractionRuntime || !tabButtons || !tabPanels || tabButtons !== tabPanels)) {
    problems.push('标签页控件缺少对应面板或可信切换逻辑');
  }
  if (executable.length > 1) problems.push(`可执行脚本应至多 1 处（内置可信 runtime），实际 ${executable.length} 处`);
  for (const m of configBlocks) {
    if (/<\/script/i.test(m[2])) problems.push('scene3d 配置块含 </script 逃逸序列');
    try { JSON.parse(m[2]); } catch { problems.push('scene3d 配置块不是合法 JSON'); }
  }
  const inlineHandlers = [...text.matchAll(/\son(?:click|load|error|mouse\w+|key\w+|focus|blur|submit|change|input)\s*=/gi)];
  if (inlineHandlers.length) problems.push(`产物含内联事件处理器 ${inlineHandlers.length} 处`);
  const jsUrls = [...text.matchAll(/(?:href|src)\s*=\s*"(?:javascript|data:text\/html):/gi)];
  if (jsUrls.length) problems.push(`产物含可执行 URL ${jsUrls.length} 处`);

  // 锚点可达性：站内 #fragment 必须能解析
  const ids = extractIds(text);
  const anchors = [...text.matchAll(/\shref="#([^"]+)"/g)].map((m) => m[1]);
  const dangling = [...new Set(anchors.filter((a) => a && !ids.has(a)))];
  if (dangling.length) problems.push(`站内锚点无对应 id：${dangling.slice(0, 5).join('、')}`);

  // 页面插图必须有非空 alt，避免空壳图片通过门禁
  const imgs = [...text.matchAll(/<img\b[^>]*>/gi)];
  const noAlt = imgs.filter((tag) => {
    const alt = tag[0].match(/\salt\s*=\s*"([^"]*)"/i);
    return !alt || !alt[1].trim();
  });
  if (noAlt.length) problems.push(`${noAlt.length} 个 <img> 缺少有意义的 alt 文本`);
  const usableImageCount = imgs.filter((tag) => /\ssrc\s*=\s*"[^"\s]+"/i.test(tag[0])).length;
  if (expect.imageRequired && usableImageCount === 0) problems.push('非纯文字页面必须至少包含一张有来源的插图');

  // 主题变量
  for (const v of THEME_VARS) {
    const m = text.match(new RegExp(`${v.replace(/-/g, '\\-')}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) problems.push(`主题变量 ${v} 缺失或不是 #RRGGBB`);
  }

  // 计划一致性：模型产出的 section 必须真的被渲染
  for (const id of expect.sectionIds ?? []) {
    if (!ids.has(id)) problems.push(`PagePlan 声明的 section #${id} 未出现在产物中`);
  }
  if (expect.title && !text.includes(expect.title)) problems.push(`PagePlan 标题「${expect.title}」未出现在产物中`);

  return {
    problems,
    metrics: { bytes: Buffer.byteLength(text), anchors: anchors.length, images: imgs.length, ids: ids.size },
  };
}

/**
 * 落盘工作区的静态门禁（与旧模板 staticCheck 同签名：返回问题数组）。
 * @param {string} dir
 * @param {{sectionIds?: string[], title?: string}} expect
 */
export function staticCheckPagePlan(dir, expect = {}) {
  const parts = [];
  try {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf-8');
    parts.push(...checkPagePlanHtml(html, expect).problems);
    if (expect.imageRequired) {
      const root = path.resolve(dir);
      const images = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/gi)];
      for (const match of images) {
        const src = match[1].replace(/&amp;/g, '&').split(/[?#]/, 1)[0];
        if (!src || /^https?:\/\//i.test(src) || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) {
          parts.push(`图片必须是已打包的本地素材：${src.slice(0, 100)}`);
          continue;
        }
        let imagePath;
        try { imagePath = path.resolve(root, decodeURIComponent(src)); }
        catch { parts.push(`图片路径无法解析：${src.slice(0, 100)}`); continue; }
        const relative = path.relative(root, imagePath);
        const imageExt = path.extname(imagePath).toLowerCase();
        if (relative.startsWith('..') || path.isAbsolute(relative) || !['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(imageExt) || !fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile() || fs.statSync(imagePath).size === 0) {
          parts.push(`图片文件未落地：${src.slice(0, 100)}`);
        }
      }
    }
  } catch (e) {
    parts.push(`无法读取 index.html：${String(e?.message ?? e).slice(0, 120)}`);
  }
  return parts;
}

/**
 * 为 PagePlan 工作区生成真实可执行的 node:test 用例。
 * 断言的是"落盘产物 vs 模型计划"的一致性，而不是重跑渲染器。
 * scene3d 页面会额外带上可信 runtime 的完整文本作为比对基准（`scene3dRuntime`），
 * 这样交付物自身就能证明"页面里的脚本就是应用内置的那一份"。
 * @param {{sectionIds: string[], title: string, themeVars: string[], unsupported: Array<{capability:string,severity:string}>, scene3dRuntime?: string}} expect
 * @returns {string} test/pageplan.test.mjs 的内容
 */
export function buildWorkspaceTest(expect) {
  const fixture = JSON.stringify({
    sectionIds: expect.sectionIds ?? [],
    title: expect.title ?? '',
    themeVars: expect.themeVars ?? THEME_VARS,
    unsupported: expect.unsupported ?? [],
    scene3dRuntime: expect.scene3dRuntime ?? '',
  }, null, 2);
  return `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
const expect = ${fixture};

test('产物是完整 HTML 文档', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes('<main'), '缺少 main 容器');
  assert.match(html, /<title>[^<]+<\\/title>/);
});

test('模型计划中的每个 section 都被真实渲染', () => {
  assert.ok(expect.sectionIds.length > 0, '计划中应至少有一个 section');
  for (const id of expect.sectionIds) {
    assert.ok(html.includes(\`id="\${id}"\`), \`缺少 section #\${id}\`);
  }
});

test('页面不含模型可控脚本或内联事件处理器', () => {
  // scene3d 页面允许内置 runtime；除此之外的可执行脚本一律视为注入。
  const blocks = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)];
  const executable = blocks.filter((m) => !/type\\s*=\\s*"application\\/json"/i.test(m[1]));
  assert.ok(executable.length <= 1, \`可执行脚本应至多 1 处，实际 \${executable.length} 处\`);
  for (const m of executable) {
    assert.equal(m[2], expect.scene3dRuntime ?? '', '可执行脚本必须与应用内置 runtime 完全一致');
  }
  for (const m of blocks.filter((b) => /type\\s*=\\s*"application\\/json"/i.test(b[1]))) {
    assert.ok(!/<\\/script/i.test(m[2]), '配置块不得含 </script 逃逸');
    JSON.parse(m[2]);
  }
  assert.ok(!/\\son(?:click|load|error|mouse\\w+|key\\w+)\\s*=/i.test(html), '产物不得含内联事件处理器');
  assert.ok(!/(?:href|src)\\s*=\\s*"(?:javascript|data:text\\/html):/i.test(html), '产物不得含可执行 URL');
});

test('主题变量为合法十六进制', () => {
  for (const v of expect.themeVars) {
    const re = new RegExp(v.replace(/-/g, '\\\\-') + ':\\\\s*#[0-9a-fA-F]{6}');
    assert.match(html, re, \`主题变量 \${v} 缺失\`);
  }
});

test('站内锚点全部可达', () => {
  const ids = new Set([...html.matchAll(/\\sid="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...html.matchAll(/\\shref="#([^"]+)"/g)].map((m) => m[1]);
  for (const a of anchors) assert.ok(ids.has(a), \`锚点 #\${a} 无对应 id\`);
});

test('所有图片都有 alt 属性', () => {
  for (const m of html.matchAll(/<img\\b[^>]*>/gi)) {
    assert.match(m[0], /\\salt\\s*=/, '图片缺少 alt');
  }
});

test('nonblocking 未支持项对用户可见', () => {
  for (const item of expect.unsupported.filter((u) => u.severity === 'nonblocking')) {
    assert.ok(html.includes(item.capability), \`未在页面披露：\${item.capability}\`);
  }
});
`;
}
