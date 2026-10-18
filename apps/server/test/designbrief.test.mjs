import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAccent, normalizeBrief, validateBrief, FALLBACK_ACCENT } from '../generator/designbrief.mjs';
import { tokensFromDirection, tokensCss } from '../generator/tokens.mjs';
import { editorial, workbench, pickLayout } from '../generator/layouts/index.mjs';

const mkBrief = (over = {}) => ({
  positioning: { audience: 'a', mission: 'm', conversion: 'c' },
  brandKeywords: ['k'],
  references: [{ site: 's', takeaway: 't' }],
  concept: '以档案排印让数据成为主角',
  directions: [
    { name: 'A', layoutStrategy: 'editorial', heroStrategy: 'ledger-label', heroComposition: 'h1', density: '低', typography: { display: '衬线', body: 'x', data: '等宽' }, imageUse: '大图', color: { bg: '浅', accent: '#1a1a1a', mood: 'm' }, motion: 'mo1', rhythm: 'r1' },
    { name: 'B', layoutStrategy: 'workbench', heroStrategy: 'data-first', heroComposition: 'h2', density: '高', typography: { display: '等宽', body: 'x', data: '等宽' }, imageUse: '缩略', color: { bg: '深', accent: '#c8a96a', mood: 'm' }, motion: 'mo2', rhythm: 'r2' },
  ],
  artDirection: { graphics: '程序化星域', dataViz: '星等→点径', imagery: '不用位图' },
  iaNarrative: '概念→清单→详情',
  densityBudget: '3-5',
  tokens: { maxWidth: '1240px', grid: 'g', spacingScale: 's', radius: '0', breakpoints: 'b' },
  motionPurpose: { whitelist: ['进场淡入:建立层级'], avoid: '视差滚动:干扰数据阅读' },
  mobileStrategy: '单列重组，星图置顶',
  imageDirection: { style: 's', mood: 'm', composition: 'c', palette: 'p', avoid: 'a' },
  a11y: { contrast: 'c', minBodyPx: '14' },
  acceptance: ['首屏无滚动可辨主题', '点击任一恒星出数据卡'],
  ...over,
});

test('accent 严格提取：附注污染被清理，非法值回退并记录（缺陷检测点）', () => {
  assert.equal(extractAccent('#1A1A1A 近黑 + 细线分隔，辅以 #8A7355 点缀'), '#1a1a1a', '取首个合法 hex');
  assert.equal(extractAccent('红色'), null);
  const { brief, notes } = normalizeBrief(mkBrief({
    directions: [
      { ...mkBrief().directions[0], color: { bg: 'x', accent: '#ABC123 琥珀，用于标题' } },
      { ...mkBrief().directions[1], color: { bg: 'x', accent: '深蓝（未给色值）' } },
    ],
  }));
  assert.equal(brief.directions[0].color.accent, '#abc123');
  assert.equal(brief.directions[1].color.accent, FALLBACK_ACCENT);
  assert.ok(brief.directions[1].color.accentFallback);
  assert.ok(notes.length === 2, '两条规范化记录');
});

test('schema 校验：缺字段/非法枚举/非法色值/差异不足全部报出（缺陷检测点：不静默）', () => {
  const bad1 = mkBrief({ positioning: { audience: '', mission: 'm', conversion: 'c' } });
  assert.equal(validateBrief(bad1).ok, false);
  assert.ok(validateBrief(bad1).errors.some((e) => e.includes('positioning.audience')));
  const bad2 = mkBrief({ directions: [mkBrief().directions[0], { ...mkBrief().directions[1], layoutStrategy: 'fancy' }] });
  assert.ok(validateBrief(bad2).errors.some((e) => e.includes('非法枚举')));
  const bad3 = mkBrief();
  bad3.directions[1] = { ...bad3.directions[0], name: 'B', color: { ...bad3.directions[0].color, accent: '#c8a96a' } };
  assert.ok(validateBrief(bad3).errors.some((e) => e.includes('差异不足')), '仅换色必须被拒');
  assert.equal(validateBrief(mkBrief()).ok, true, '完整 Brief 通过');
});

test('决策字段校验：heroStrategy 枚举/动效白名单≤3/验收条件≥2（缺陷检测点）', () => {
  const badHero = mkBrief({ directions: [mkBrief().directions[0], { ...mkBrief().directions[1], heroStrategy: 'cinematic' }] });
  assert.ok(validateBrief(badHero).errors.some((e) => e.includes('heroStrategy 非法枚举')));
  const badMotion = mkBrief({ motionPurpose: { whitelist: ['a:1', 'b:2', 'c:3', 'd:4'], avoid: 'x' } });
  assert.ok(validateBrief(badMotion).errors.some((e) => e.includes('whitelist 最多 3 项')));
  const badAcc = mkBrief({ acceptance: ['只有一条'] });
  assert.ok(validateBrief(badAcc).errors.some((e) => e.includes('acceptance 至少 2 条')));
  const noConcept = mkBrief({ concept: '' });
  assert.ok(validateBrief(noConcept).errors.some((e) => e.includes('concept')));
  // 双方向 hero+layout 全同 → 构图无实质差异拒绝
  const sameHero = mkBrief();
  sameHero.directions[1] = { ...sameHero.directions[1], heroStrategy: 'ledger-label', layoutStrategy: 'editorial', heroComposition: 'h9', density: '高', motion: 'x', rhythm: 'y', imageUse: 'z' };
  assert.ok(validateBrief(sameHero).errors.some((e) => e.includes('构图策略无实质差异')));
});

test('tokens：宽度解析与字体气质映射 + CSS 变量输出', () => {
  const b = mkBrief();
  const tk = tokensFromDirection(b.directions[0], b);
  assert.equal(tk.maxWidth, 1240);
  assert.ok(tk.font.display.includes('Georgia'), '衬线关键词→衬线字体');
  const tk2 = tokensFromDirection({ ...b.directions[1], layoutStrategy: 'workbench' }, { ...b, tokens: { maxWidth: '随便' } });
  assert.equal(tk2.maxWidth, 1020, '无有效宽度时按工作台默认回退');
  const css = tokensCss(tk);
  assert.ok(css.includes('--layout-max: 1240px') && css.includes('--layout-accent: #1a1a1a'));
});

test('双布局结构性差异：同一数据产出不同骨架（缺陷检测点：不得同构）', () => {
  const data = { title: '境屿建筑', tagline: 't', intro: 'i', sections: [
    { title: '项目一', text: '说明', facts: ['2024', '杭州'], img: '', stats: [{ k: '建成', v: '34' }] },
  ], contact: 'a@b.c', tokens: tokensFromDirection(mkBrief().directions[0], mkBrief()) };
  const A = editorial(data);
  const B = workbench(data);
  assert.ok(A.html.includes('class="hero"') && A.html.includes('ed-row'), 'editorial=沉浸首图+交错行');
  assert.ok(B.html.includes('wb-top') && B.html.includes('table class="wb-rows"'), 'workbench=顶栏+表格');
  assert.ok(!A.html.includes('wb-rows') && !B.html.includes('class="hero"'), '骨架不得混同');
  assert.ok(A.css.includes('88vh') && B.css.includes('position: sticky'), '首屏形态实质不同');
});

test('pickLayout：策略映射与回退', () => {
  assert.equal(pickLayout(mkBrief()), 'editorial');
  assert.equal(pickLayout({ directions: [{ layoutStrategy: 'workbench' }] }), 'workbench');
  assert.equal(pickLayout({ directions: [{ layoutStrategy: 'stage' }] }), null, 'stage→null 回退 pageShell');
  assert.equal(pickLayout(null), null);
});
