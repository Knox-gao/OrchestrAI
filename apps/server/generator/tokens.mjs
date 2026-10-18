/**
 * Design Tokens（阶段二任务 B）：由 Brief 的方向 + tokens 段驱动生成设计变量。
 * 与 styles.mjs 的关系：styles 决定"皮肤变量"（基底/色板），tokens 决定"结构变量"
 * （内容宽度/栅格/间距/圆角/断点/字体层级）——布局骨架由 tokens 驱动，不再被 pageShell 的 640px 垄断。
 */

const FONT_BY_MOOD = (desc = '') => {
  const s = String(desc);
  if (/衬线|宋|Georgia|serif|杂志|书卷|编辑/.test(s)) return { display: `Georgia,'Times New Roman','STSong','Songti SC',serif`, body: `Georgia,'STSong','Songti SC',serif` };
  if (/等宽|mono|终端|代码/.test(s)) return { display: `'Cascadia Mono',ui-monospace,monospace`, body: `'Segoe UI','Microsoft YaHei',sans-serif` };
  return { display: `'Segoe UI','Microsoft YaHei',sans-serif`, body: `'Segoe UI','Microsoft YaHei',sans-serif` };
};

const numFrom = (s, dflt) => {
  const m = String(s ?? '').match(/(\d{3,4})/);
  return m ? Math.min(1920, Math.max(360, Number(m[1]))) : dflt;
};

/**
 * @param {{direction:Object, brief:Object}} opts — brief.directions[i] 与 brief.tokens
 * @returns {{maxWidth:number, grid:string, spacingScale:string, radius:string,
 *            font:{display:string,body:string}, accent:string, bgMood:string,
 *            breakpoints:string, motion:string, layoutStrategy:string}}
 */
export function tokensFromDirection(direction, brief) {
  const t = brief?.tokens ?? {};
  const layoutStrategy = direction?.layoutStrategy ?? 'editorial';
  const defaultWidth = layoutStrategy === 'workbench' ? 1020 : 1240;
  return {
    layoutStrategy,
    maxWidth: numFrom(t.maxWidth, defaultWidth),
    grid: t.grid || (layoutStrategy === 'workbench' ? '12 列紧凑（含统计卡 4 列与数据表整行）' : '12 列宽幅（图文 7/5 交错）'),
    spacingScale: t.spacingScale || (layoutStrategy === 'workbench' ? '4/8/12/16/24（紧凑）' : '16/32/64/96（大留白）'),
    radius: t.radius || (layoutStrategy === 'workbench' ? '4px' : '0px'),
    font: FONT_BY_MOOD(`${direction?.typography?.display ?? ''} ${direction?.name ?? ''} ${brief?.brandKeywords ?? ''}`),
    accent: direction?.color?.accent ?? '#64748b',
    bgMood: /深|暗|dark|黑/.test(String(direction?.color?.bg ?? '')) ? 'dark' : 'light',
    breakpoints: t.breakpoints || '820px（单列回退）',
    motion: direction?.motion || '克制：仅 hover 与滚动显现',
  };
}

/** tokens → CSS 变量（注入布局骨架；与皮肤变量正交） */
export function tokensCss(tk) {
  return `:root {
  --layout-max: ${tk.maxWidth}px;
  --layout-radius: ${tk.radius};
  --layout-accent: ${tk.accent};
  --font-display: ${tk.font.display};
  --font-body: ${tk.font.body};
}
`;
}
