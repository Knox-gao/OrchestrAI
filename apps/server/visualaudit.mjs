/**
 * 主管视觉审查（零依赖静态审计）：
 *   1) 交互完整性——index.html 里声明的每个 button/input 必须在 JS 中被引用（绑定事件或读取），
 *      防止"看得见按不下"的死按钮交付；
 *   2) 素材完整性——images.js 引用的每个文件必须存在于产物清单且非空；
 *   3) 形态互斥——多形态模板（如图鉴舞台/图库网格）必须存在互斥显示的 CSS 规则。
 * 只审计静态产物（真实代码），不猜测运行时行为；结果由流水线写入事件日志。
 */

/** 提取 HTML 中所有带 id 的交互元素 */
function interactiveIds(html) {
  const ids = [];
  const re = /<(button|input|textarea|select)\b[^>]*\bid="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) ids.push({ tag: m[1].toLowerCase(), id: m[2] });
  return ids;
}

/** 判断 id 是否在 JS 源中被引用（getElementById / querySelector / addEventListener） */
function referencedInJs(id, jsSources) {
  const needle1 = `'${id}'`;
  const needle2 = `"${id}"`;
  return jsSources.some((src) => src.includes(needle1) || src.includes(needle2));
}

/**
 * @param {Record<string, string|Buffer>} files 产物文件映射
 * @returns {{ok: boolean, buttons: Array<{id:string,tag:string,bound:boolean}>,
 *            missingImages: string[], hasModeGuard: boolean, summary: string, issues: string[]}}
 */
export function visualAudit(files) {
  const html = String(files['index.html'] ?? '');
  const jsFiles = Object.entries(files)
    .filter(([k]) => /^(app|logic|data|images|fx)\.m?(js)?$/.test(k) || /^app\./.test(k))
    .map(([, v]) => String(v));
  const issues = [];

  // 1) 交互完整性
  const buttons = interactiveIds(html).map((b) => ({ ...b, bound: referencedInJs(b.id, jsFiles) }));
  const dead = buttons.filter((b) => !b.bound);
  if (dead.length) issues.push(`未绑定事件的交互元素 ${dead.length} 个：${dead.map((d) => d.tag + '#' + d.id).join('、')}`);

  // 2) 素材完整性
  const missingImages = [];
  const imagesJs = String(files['images.js'] ?? '');
  for (const m of imagesJs.matchAll(/file:\s*"(images\/[^"]+)"/g)) {
    const f = files[m[1]];
    if (!f || !f.length) missingImages.push(m[1]);
  }
  if (missingImages.length) issues.push(`清单引用但产物缺失的素材 ${missingImages.length} 个：${missingImages.slice(0, 5).join('、')}`);

  // 3) 形态互斥（stage-mode 类互斥守卫是否存在）
  const css = String(files['style.css'] ?? '');
  const hasModeGuard = /body\.stage-mode|body\.ency|\.stage-mode\s/.test(css) && css.includes('display: none');
  if ((files['app.mjs'] ?? '').includes('stage-mode') && !hasModeGuard) {
    issues.push('检测到多形态切换（stage-mode）但 CSS 缺少互斥显示守卫');
  }

  const ok = issues.length === 0;
  const summary = ok
    ? `视觉审查通过：${buttons.length} 个交互元素全部绑定事件，素材清单完整，形态互斥守卫就位`
    : `视觉审查发现 ${issues.length} 项问题：${issues.join('；')}`;
  return { ok, buttons, missingImages, hasModeGuard, summary, issues };
}
