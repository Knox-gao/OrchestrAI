/**
 * 需求覆盖审计（M7-B4A 阶段 C）
 *
 * 问题背景：旧 visual_audit 只报"1 个按键绑定事件"，无法证明用户要求的核心能力
 * （可交互 3D 岛 / 点击建筑档案 / 动植物档案 / 日夜潮汐 / 发展时间线）真的实现了。
 *
 * 设计：从用户原始需求里识别"能力声明"，逐条到产物代码里找**实现证据**，
 * 输出 requirement → evidence → status 的对应表。只做静态可达性判断，
 * 真实交互仍需 rendercheck / CDP 探针；两者不可互相替代。
 *
 * 状态语义：
 *   implemented   找到实现证据（关键字 + 结构）
 *   unsupported   需求超出当前渲染器能力（如实标注，不算失败交付）
 *   unverified    没有任何证据（既不实现也不声明不支持 → 必须暴露）
 */

/** 需求能力字典：命中 trigger 即视为用户要求了该能力 */
const CAPABILITIES = [
  {
    id: 'interactive3d',
    label: '可交互 3D 主体',
    trigger: /3d|三维|立体|可旋转|可缩放|拖拽旋转/i,
    evidence: [
      { name: 'canvas 元素', test: (html) => /<canvas[\s>]/i.test(html) },
      { name: '投影/旋转数学', test: (all) => /project3d|rotate|cos\(|sin\(|mat4|perspective/i.test(all) },
      { name: '拖拽交互', test: (all) => /mousedown|pointerdown|touchstart/i.test(all) },
    ],
    minEvidence: 2,
  },
  {
    id: 'clickDetail',
    label: '点击查看详情/档案',
    trigger: /点击.{0,6}(查看|建筑|档案|详情)|点击交互|档案/i,
    evidence: [
      { name: '点击处理', test: (all) => /addEventListener\(\s*['"]click|onclick/i.test(all) },
      { name: '详情面板容器', test: (html) => /id="(info|dossier|detail|panel)"|class="[^"]*(dossier|detail|info-panel)/i.test(html) },
    ],
    minEvidence: 2,
  },
  {
    id: 'archives',
    label: '对象档案（人/植物/动物等）',
    trigger: /档案|介绍.{0,8}岛上的|人物|居民|动物|植物|风物/i,
    evidence: [
      { name: '对象数据集合', test: (all) => /objects\s*:|items\s*:|records\s*:|\{\s*name\s*:/i.test(all) },
      { name: '对象数量 ≥ 5', test: (all) => (all.match(/["']name["']\s*:\s*["']/g) ?? []).length >= 5 },
    ],
    minEvidence: 2,
  },
  {
    id: 'dayNight',
    label: '日夜/潮汐变化',
    trigger: /日夜|昼夜|白天|夜晚|潮汐|潮水|时间变化/i,
    evidence: [
      { name: '时间/昼夜状态变量', test: (all) => /dayNight|daynight|isNight|sunAngle|tide|潮汐|nightMode/i.test(all) },
      { name: '状态切换控件', test: (html) => /id="[^"]*(tide|time|daynight|toggle)|data-(time|tide)/i.test(html) },
    ],
    minEvidence: 1,
  },
  {
    id: 'timeline',
    label: '发展时间线',
    trigger: /时间线|时间轴|timeline|发展史|演变|按年份|年份浏览|发展脉络/i,
    evidence: [
      { name: '时间轴元素', test: (html) => /id="timeline"|class="[^"]*timeline/i.test(html) },
      { name: '年份游标逻辑', test: (all) => /year|年份|tl-dot|yearCursor/i.test(all) },
    ],
    minEvidence: 2,
  },
];

/**
 * @param {string} requirement 用户原始需求（含 preflight 指令）
 * @param {Record<string,string|Buffer>} files 产物文件
 * @param {string[]} [acceptance] 需求草案里的验收标准（比原句更完整，优先参与匹配）
 * @returns {{items: Array, uncovered: Array, summary: string, coverageRate: number}}
 */
export function auditRequirementCoverage(requirement, files, acceptance = []) {
  // 原始需求 + 验收标准合并判定（验收标准常常比一句话需求更具体）
  const requirementText = [String(requirement ?? ''), ...(Array.isArray(acceptance) ? acceptance : [])].join(' ');
  const html = String(files['index.html'] ?? '');
  const all = Object.entries(files)
    .filter(([k]) => /\.(m?js|html|css)$/i.test(k))
    .map(([, v]) => String(v))
    .join('\n');
  const wanted = CAPABILITIES.filter((c) => c.trigger.test(requirementText));

  const items = wanted.map((cap) => {
    // 逐项判定：DOM 类证据查 index.html，代码类证据查全部产物
    const evidence = cap.evidence.map((e) => {
      const domOnly = /元素|容器|控件|时间轴/.test(e.name);
      let found = false;
      try { found = domOnly ? e.test(html) : e.test(all); } catch { found = false; }
      return { name: e.name, found };
    });
    const reached = evidence.filter((e) => e.found).length;
    const status = reached >= cap.minEvidence ? 'implemented' : 'unverified';
    return { id: cap.id, label: cap.label, status, evidence, required: cap.minEvidence, reached };
  });

  const uncovered = items.filter((i) => i.status === 'unverified');
  const coverageRate = items.length ? (items.length - uncovered.length) / items.length : 1;
  const summary = items.length === 0
    ? '需求未声明可审计的能力项（跳过覆盖审计）'
    : uncovered.length === 0
      ? `需求覆盖审计通过：${items.length} 项能力全部找到实现证据（${items.map((i) => i.label).join('、')}）`
      : `需求覆盖不足：${uncovered.length}/${items.length} 项缺少实现证据（${uncovered.map((i) => `${i.label} ${i.reached}/${i.required}`).join('；')}）`;

  return { items, uncovered, summary, coverageRate };
}
