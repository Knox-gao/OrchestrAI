/**
 * 演示剧本（P1 模拟 Agent 版）—— 严格对应《项目计划》第十二章的演示流程：
 * 1. 用户输入"做一个任务管理 App…"
 * 2. 主管生成需求与验收标准，用户确认
 * 3. UI/前端/后端 Agent 分工实现
 * 4. 测试 Agent 发现一个预设缺陷；主管退回对应任务
 * 5. 修复后重新运行相关测试和回归测试
 * 6. 用户提出"增加按优先级筛选"；主管生成变更单并调整任务
 * 7. 生成可运行项目、运行指南、测试报告和已知限制
 *
 * P2 将把本剧本替换为真实 Agent 执行；事件契约保持不变。
 */
import type { Cue, Scenario } from './engine';
import type { StudioEvent, TaskSeed } from './events';
import type {
  AgentRole, Artifact, ChangeRequest, GateName, ModelRef,
  RequirementVersion, TaskStatus, TestRun, UserStory,
} from './types';

export const DEMO_REQUIREMENT = '做一个任务管理 App，支持新增、完成、筛选任务，界面简洁。';
export const DEMO_CHANGE_HINT = '增加按优先级筛选';

/** 模拟的模型路由表（P4 接入真实 Model Gateway 后由配置替换） */
export const MODELS: Record<AgentRole, ModelRef> = {
  supervisor: { provider: 'zai', modelId: 'GLM-5.3' },
  product: { provider: 'zai', modelId: 'GLM-5.3-air' },
  architect: { provider: 'zai', modelId: 'GLM-5.3' },
  designer: { provider: 'anthropic', modelId: 'claude-sonnet-4.6' },
  frontend: { provider: 'anthropic', modelId: 'claude-sonnet-4.6' },
  backend: { provider: 'zai', modelId: 'GLM-5.3-coder' },
  tester: { provider: 'openai', modelId: 'gpt-5.2' },
  reviewer: { provider: 'zai', modelId: 'GLM-5.3' },
  docs: { provider: 'zai', modelId: 'GLM-5.3-air' },
};

// ---------- 构造工具 ----------

let artSeq = 0;
const nextArtId = () => `A-${String(++artSeq).padStart(2, '0')}`;

function art(taskId: string, kind: Artifact['kind'], path: string, summary: string, lines?: { add: number; del: number }): Artifact {
  return {
    id: nextArtId(), taskId, kind, path, summary,
    linesAdded: lines?.add, linesRemoved: lines?.del,
  };
}

function testRun(o: {
  id: string; taskId: string; kind: TestRun['kind']; command: string;
  exitCode: number; passed: number; failed: number; summary: string;
  logExcerpt: string[]; logPath: string; supersedes?: string;
}): TestRun {
  return { startedAt: 0, endedAt: 0, ...o };
}

interface WorkStep {
  kind?: 'think' | 'tool' | 'message';
  tool?: string;
  detail: string;
  artifacts?: Artifact[];
}

interface WorkOpts {
  taskId: string;
  role: AgentRole;
  runId: string;
  steps: WorkStep[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  testRuns?: TestRun[];
  gates?: { gate: GateName; passed: boolean; detail: string; testRunId?: string }[];
  reviewNote: string;
  attempt?: number;
  fromStatus?: TaskStatus;
}

/** 标准任务执行段落：就绪→执行(步骤+产物+测试)→待审核→主管复核→完成 */
function workTask(o: WorkOpts): Cue[] {
  const cues: Cue[] = [];
  const model = MODELS[o.role];
  cues.push({
    d: 420,
    events: [
      { type: 'task_status_changed', taskId: o.taskId, from: o.fromStatus ?? 'pending', to: 'in_progress', attempt: o.attempt },
      { type: 'agent_state_changed', role: o.role, status: 'working', taskId: o.taskId, detail: o.steps[0]?.detail ?? '执行中' },
      { type: 'agent_run_started', runId: o.runId, taskId: o.taskId, role: o.role, model },
    ],
  });
  for (const s of o.steps) {
    cues.push({
      d: 380,
      events: [
        { type: 'agent_step', runId: o.runId, taskId: o.taskId, role: o.role, step: { at: 0, kind: s.kind ?? 'tool', tool: s.tool, detail: s.detail } },
        ...(s.artifacts ?? []).map<StudioEvent>((a) => ({ type: 'artifact_created', artifact: a })),
      ],
    });
  }
  for (const tr of o.testRuns ?? []) {
    cues.push({ d: 520, events: [{ type: 'test_run_recorded', testRun: tr }] });
  }
  for (const g of o.gates ?? []) {
    cues.push({ d: 300, events: [{ type: 'gate_result', gate: g.gate, passed: g.passed, detail: g.detail, testRunId: g.testRunId, taskId: o.taskId }] });
  }
  cues.push({
    d: 420,
    events: [
      { type: 'agent_run_ended', runId: o.runId, taskId: o.taskId, status: 'succeeded', usage: o.usage },
      { type: 'agent_state_changed', role: o.role, status: 'awaiting_review', taskId: o.taskId, detail: '等待主管复核' },
      { type: 'task_status_changed', taskId: o.taskId, from: 'in_progress', to: 'awaiting_review' },
    ],
  });
  cues.push({
    d: 560,
    events: [
      { type: 'log', level: 'info', from: 'supervisor', message: `复核 ${o.taskId}：${o.reviewNote}` },
      { type: 'task_status_changed', taskId: o.taskId, from: 'awaiting_review', to: 'done' },
      { type: 'agent_state_changed', role: o.role, status: 'idle' },
    ],
  });
  return cues;
}

const planningCues = (detail: string): Cue[] => ([
  { d: 350, events: [{ type: 'agent_state_changed', role: 'supervisor', status: 'analyzing', detail }] },
]);

// ---------- 需求内容 ----------

function requirementV01(): RequirementVersion {
  const stories: UserStory[] = [
    {
      id: 'US1', story: '作为用户，我可以输入标题并回车来新增任务',
      acceptance: ['空标题不可提交', '新增成功后输入框清空并保持焦点', '新任务出现在列表顶部'],
    },
    {
      id: 'US2', story: '作为用户，我可以勾选完成状态',
      acceptance: ['完成的任务显示删除线与灰化样式', '刷新页面后完成状态保持', '再次点击可取消完成'],
    },
    {
      id: 'US3', story: '作为用户，我可以按状态筛选任务',
      acceptance: ['支持 全部 / 未完成 / 已完成 三种筛选', '筛选后计数与列表一致', '筛选状态刷新后保持'],
    },
  ];
  return {
    id: 'RV-1', version: 'v0.1', userText: DEMO_REQUIREMENT,
    overview: '一个本地任务管理 Web 应用：单用户、界面简洁，支持新增、完成、按状态筛选任务，数据刷新后保持。',
    userStories: stories,
    assumptions: ['单用户本地使用，暂不做账号体系（模拟身份）', '数据存储于浏览器 localStorage', '桌面浏览器优先，暂不适配移动端'],
    risks: ['完成状态持久化与筛选联动易出回归，需 E2E 覆盖', 'localStorage 容量有限（约 5MB）'],
    status: 'draft', createdAt: 0,
  };
}

function requirementV02(oldText: string): RequirementVersion {
  const base = requirementV01();
  const isPriority = oldText.includes('优先级');
  const story: UserStory = isPriority
    ? {
        id: 'US4', story: '作为用户，我可以为任务设置优先级并按优先级筛选',
        acceptance: ['新任务默认优先级为"中"', '支持 低/中/高 三档优先级', '筛选栏支持按优先级筛选', '优先级筛选与状态筛选可叠加'],
      }
    : {
        id: 'US4', story: '作为用户，我可以看到根据我的反馈微调后的界面',
        acceptance: ['界面细节按变更说明调整', '既有功能不受影响'],
      };
  return {
    ...base,
    id: 'RV-2', version: 'v0.2', userText: oldText, supersedes: 'RV-1',
    overview: base.overview + `（v0.2：${oldText}）`,
    userStories: [...base.userStories, story],
    risks: [...base.risks, '变更涉及已交付功能，必须全量回归 US1-US3'],
    createdAt: 0,
  };
}

const PLAN_V01: TaskSeed[] = [
  { id: 'T1', title: '需求规格定稿与验收清单', kind: 'analysis', role: 'product', dependsOn: [], inputs: ['需求规格 v0.1'], outputs: ['docs/requirements.md', '验收清单（US1-US3）'] },
  { id: 'T2', title: '技术选型与接口契约', kind: 'architecture', role: 'architect', dependsOn: ['T1'], inputs: ['需求规格'], outputs: ['docs/architecture.md', 'docs/api-contract.md'] },
  { id: 'T3', title: '页面结构与视觉规范', kind: 'design', role: 'designer', dependsOn: ['T1'], inputs: ['需求规格'], outputs: ['design/wireframe.png', 'design/ui-spec.md'] },
  { id: 'T4', title: '数据接口与存储实现', kind: 'backend', role: 'backend', dependsOn: ['T2'], inputs: ['API 契约'], outputs: ['server/src/api/tasks.ts', 'server/test/tasks.test.ts'] },
  { id: 'T5', title: '任务列表界面实现', kind: 'frontend', role: 'frontend', dependsOn: ['T2', 'T3'], inputs: ['API 契约', '视觉规范'], outputs: ['web/src/App.tsx', 'web/src/components/*', 'web/test/ui.test.ts'] },
  { id: 'T6', title: '集成与持续验证', kind: 'integration', role: 'backend', dependsOn: ['T4', 'T5'], inputs: ['前后端产物'], outputs: ['集成构建报告'] },
  { id: 'T7', title: '端到端测试（验收驱动）', kind: 'test', role: 'tester', dependsOn: ['T6'], inputs: ['验收清单'], outputs: ['test/e2e/spec.cy.ts', '测试报告'] },
  { id: 'T8', title: '代码审查（安全与质量）', kind: 'review', role: 'reviewer', dependsOn: ['T6'], inputs: ['全部代码变更'], outputs: ['审查报告'] },
  { id: 'T9', title: '交付文档与交付清单', kind: 'docs', role: 'docs', dependsOn: ['T7', 'T8'], inputs: ['测试报告', '审查报告'], outputs: ['README', '运行指南', '交付清单'] },
];

function planV02(userText: string): TaskSeed[] {
  if (userText.includes('优先级')) {
    return [
      { id: 'T10', title: '数据模型增加 priority 字段与排序接口', kind: 'backend', role: 'backend', dependsOn: [], inputs: ['需求 v0.2 / US4'], outputs: ['server/src/db/schema 迁移', 'GET /tasks?sort=priority', '单元测试'] },
      { id: 'T11', title: '优先级选择与筛选 UI', kind: 'frontend', role: 'frontend', dependsOn: ['T10'], inputs: ['排序接口'], outputs: ['FilterBar 扩展', 'TaskItem 优先级标记'] },
      { id: 'T12', title: '回归测试（US1-US4 全量）', kind: 'test', role: 'tester', dependsOn: ['T10', 'T11'], inputs: ['验收清单 v0.2'], outputs: ['回归测试报告'] },
    ];
  }
  return [
    { id: 'T10', title: '按用户反馈微调界面', kind: 'frontend', role: 'frontend', dependsOn: [], inputs: ['变更说明'], outputs: ['界面调整代码'] },
    { id: 'T11', title: '回归测试（US1-US3）', kind: 'test', role: 'tester', dependsOn: ['T10'], inputs: ['验收清单'], outputs: ['回归测试报告'] },
  ];
}

// ---------- 主剧本 ----------

export function createDemoScenario(): Scenario {
  return {
    boot(): Cue[] {
      const rv = requirementV01();
      return [
        {
          d: 600,
          events: [
            { type: 'project_created', projectId: 'P-demo-1', projectName: '任务管理 App（演示项目）', workspace: '~/AgentStudio/workspace/taskapp-demo' },
            { type: 'log', level: 'success', from: 'supervisor', message: '阶段 0 完成：独立工作区已建立，权限边界确认（只允许访问 workspace/taskapp-demo）' },
          ],
        },
        { d: 500, events: [{ type: 'phase_changed', phase: '阶段 1 · 需求接单与澄清', status: 'clarifying' }] },
        { d: 450, events: [{ type: 'requirement_submitted', userText: DEMO_REQUIREMENT, version: 'v0.1' }] },
        ...planningCues('澄清需求：识别缺失信息、约束与成功标准'),
        {
          d: 900,
          events: [
            { type: 'log', level: 'info', from: 'supervisor', message: '识别到 3 个需要确认的假设：无账号体系、localStorage 存储、桌面优先——已写入假设清单' },
            { type: 'requirement_drafted', requirement: rv },
            {
              type: 'approval_requested',
              approval: {
                id: 'AP-REQ-1', kind: 'requirement', subject: '需求规格 v0.1（3 个用户故事 / 9 条验收标准）',
                description: '请确认关键需求与假设。完整内容见右侧「任务/需求」面板。',
                status: 'pending', requestedAt: 0,
              },
            },
          ],
        },
        { d: 200, wait: 'approval' },
      ];
    },

    onApproval(id: string, approved: boolean, state): Cue[] {
      // ---- 需求确认 ----
      if (id.startsWith('AP-REQ')) {
        if (!approved) {
          const rv = { ...requirementV01(), id: 'RV-1b', version: 'v0.1.1' };
          return [
            { d: 300, events: [{ type: 'log', level: 'warn', from: 'supervisor', message: '用户驳回需求规格，根据反馈修订假设清单（新增：刷新后列表顺序保持稳定）' }] },
            { d: 700, events: [{ type: 'requirement_drafted', requirement: rv }] },
            {
              d: 200,
              events: [{
                type: 'approval_requested',
                approval: { id: 'AP-REQ-2', kind: 'requirement', subject: `需求规格 ${rv.version}（修订版）`, description: '已按反馈修订，请再次确认。', status: 'pending', requestedAt: 0 },
              }],
            },
            { d: 200, wait: 'approval' },
          ];
        }
        const rvId = state.requirementVersions['RV-1b'] && state.requirementVersions['RV-1b']?.status === 'draft' ? 'RV-1b' : 'RV-1';
        const rvv = state.requirementVersions[rvId]?.version ?? 'v0.1';
        return [
          { d: 300, events: [{ type: 'requirement_confirmed', requirementId: rvId, version: rvv }] },
          { d: 400, events: [{ type: 'phase_changed', phase: '阶段 2 · 方案与任务拆分', status: 'planning' }] },
          ...planningCues('协同产品/架构 Agent 拆分任务图'),
          { d: 800, events: [{ type: 'log', level: 'info', from: 'supervisor', message: '任务图：9 项任务，关键路径 T1→T2→T5→T6→T7/T8→T9；T3 与 T2 并行，T7 与 T8 并行' }] },
          {
            d: 400,
            events: [
              { type: 'plan_created', tasks: PLAN_V01, note: '每项任务均有输入/输出契约与完成定义' },
              {
                type: 'approval_requested',
                approval: {
                  id: 'AP-PLAN-1', kind: 'plan', subject: '任务计划（9 项任务 / 预算上限 $5.00）',
                  description: 'T1 需求定稿 → T2 架构 / T3 设计 → T4 后端 / T5 前端 → T6 集成 → T7 测试 ∥ T8 审查 → T9 交付文档。',
                  status: 'pending', requestedAt: 0,
                },
              },
            ],
          },
          { d: 200, wait: 'approval' },
        ];
      }

      // ---- 计划确认 ----
      if (id.startsWith('AP-PLAN')) {
        if (!approved) {
          return [
            { d: 300, events: [{ type: 'log', level: 'warn', from: 'supervisor', message: '用户要求调整计划：将 T5 拆分为「列表骨架」与「交互逻辑」两个更小的任务，降低单任务风险' }] },
            { d: 700, events: [{ type: 'log', level: 'info', from: 'supervisor', message: '计划已修订并重新请求批准' }] },
            {
              d: 200,
              events: [{
                type: 'approval_requested',
                approval: { id: 'AP-PLAN-2', kind: 'plan', subject: '任务计划（修订版）', description: 'T5 已拆分，其余不变。', status: 'pending', requestedAt: 0 },
              }],
            },
            { d: 200, wait: 'approval' },
          ];
        }
        return executionV01();
      }

      // ---- v0.1 交付确认 ----
      if (id === 'AP-DEL-1' || id === 'AP-DEL-1R') {
        if (!approved) {
          return [
            { d: 300, events: [{ type: 'log', level: 'warn', from: 'supervisor', message: '用户暂缓交付：补充「移动端说明」到已知限制后再次请求确认' }] },
            {
              d: 500,
              events: [{
                type: 'approval_requested',
                approval: { id: 'AP-DEL-1R', kind: 'delivery', subject: '交付包 v0.1.0（已补充说明）', description: '已知限制已补充移动端说明，请再次确认发布。', status: 'pending', requestedAt: 0 },
              }],
            },
            { d: 200, wait: 'approval' },
          ];
        }
        return [
          { d: 400, events: [{ type: 'phase_changed', phase: '阶段 7 · 交付', status: 'deliverable' }] },
          {
            d: 600,
            events: [{
              type: 'delivery_packaged',
              delivery: {
                version: '0.1.0',
                manifest: ['dist/taskapp-0.1.0.zip（源代码）', 'docs/README.md 与运行指南', 'reports/test-report-0.1.0.md', 'reports/change-log.md', 'docs/known-limits.md'],
                knownLimits: ['使用模拟身份，未接入真实鉴权', '数据仅存于浏览器 localStorage', '未适配移动端小屏', '高频输入下筛选未做性能优化'],
                testSummary: '单元 12/12 通过；集成 6/6 通过；E2E 5/5 通过（TR-05，含缺陷修复后回归）',
                packagedAt: 0,
              },
            }],
          },
          { d: 300, events: [{ type: 'phase_changed', phase: '已交付 v0.1.0', status: 'delivered' }] },
          { d: 300, events: [{ type: 'log', level: 'success', from: 'supervisor', message: 'v0.1.0 交付完成。现在可以随时提出新想法（阶段 8 · 变更与迭代）。' }] },
          { d: 200, wait: 'change', label: '等待新需求' },
        ];
      }

      // ---- 变更确认 ----
      if (id === 'AP-CR-1') {
        const cr = state.changeRequests['CR-1'];
        const text = cr?.userText ?? DEMO_CHANGE_HINT;
        if (!approved) {
          return [
            {
              d: 300,
              events: [
                { type: 'change_analyzed', cr: { ...cr!, status: 'rejected' } },
                { type: 'log', level: 'warn', from: 'supervisor', message: '变更被拒绝：需求保持 v0.1，交付版本仍为 0.1.0' },
              ],
            },
          ];
        }
        return iterationV02(text);
      }

      // ---- v0.2 交付确认 ----
      if (id === 'AP-DEL-2') {
        if (!approved) {
          return [
            { d: 300, events: [{ type: 'log', level: 'warn', from: 'supervisor', message: '用户暂缓 v0.2 交付：回归通过后再次请求确认' }] },
            {
              d: 500,
              events: [{
                type: 'approval_requested',
                approval: { id: 'AP-DEL-2R', kind: 'delivery', subject: '交付包 v0.2.0（再次确认）', description: '回归已通过，请确认发布。', status: 'pending', requestedAt: 0 },
              }],
            },
            { d: 200, wait: 'approval' },
          ];
        }
        const cr = state.changeRequests['CR-1'];
        return [
          { d: 400, events: [{ type: 'phase_changed', phase: '阶段 7 · 交付（v0.2）', status: 'deliverable' }] },
          {
            d: 600,
            events: [
              {
                type: 'delivery_packaged',
                delivery: {
                  version: '0.2.0',
                  manifest: ['dist/taskapp-0.2.0.zip（源代码）', 'docs/README.md 与运行指南', 'reports/test-report-0.2.0.md（含回归）', 'reports/change-log.md（CR-1）', 'docs/known-limits.md'],
                  knownLimits: ['使用模拟身份，未接入真实鉴权', '数据仅存于浏览器 localStorage', '未适配移动端小屏', '优先级不支持自定义排序权重'],
                  testSummary: '回归 E2E 9/9 通过（TR-08，US1-US4 全量）；单元 15/15 通过',
                  packagedAt: 0,
                },
              },
              { type: 'change_analyzed', cr: { ...cr!, status: 'implemented', newRequirementVersionId: 'RV-2' } },
            ],
          },
          { d: 300, events: [{ type: 'phase_changed', phase: '已交付 v0.2.0', status: 'delivered' }] },
          { d: 300, events: [{ type: 'log', level: 'success', from: 'supervisor', message: '演示流程完成：多 Agent 分工 ✅ 任务依赖 ✅ 测试门禁 ✅ 缺陷回退 ✅ 需求变更 ✅' }] },
        ];
      }

      return [];
    },

    onChange(text: string): Cue[] {
      const cr: ChangeRequest = {
        id: 'CR-1', userText: text, classification: 'minor',
        classificationNote: '', status: 'analyzing', createdAt: 0,
      };
      return [
        { d: 300, events: [{ type: 'phase_changed', phase: '阶段 8 · 变更与迭代', status: 'iterating' }] },
        { d: 350, events: [{ type: 'change_requested', cr }] },
        ...planningCues('评估变更：分类（澄清/低影响/重大）→ 影响分析'),
        {
          d: 900,
          events: [
            {
              type: 'change_analyzed',
              cr: {
                ...cr,
                classification: text.includes('优先级') ? 'major' : 'minor',
                classificationNote: text.includes('优先级')
                  ? '涉及数据结构（priority 字段）与 API 契约（排序参数）→ 判定为重大变更，需要用户确认'
                  : '仅影响界面细节，不触及架构/数据/API/验收标准 → 判定为低影响修改',
                impact: text.includes('优先级')
                  ? {
                      tasks: ['T10（新增）priority 字段与排序接口', 'T11（新增）优先级筛选 UI', 'T12（新增）US1-US4 全量回归'],
                      files: ['server/src/api/tasks.ts', 'server/src/db/memory-store.ts', 'web/src/components/FilterBar.tsx', 'web/src/components/TaskItem.tsx'],
                      tests: ['单元：priority 字段与排序', 'E2E：US1-US3 回归 + US4 新增'],
                      budgetDelta: '约 +$0.34 / +21k tokens（当前已用 $0.71 / $5.00）',
                      notes: 'v0.1 已完成工作保留；按"测试只对对应代码版本有效"原则，代码变化后需全量回归。',
                    }
                  : {
                      tasks: ['T10（新增）界面微调', 'T11（新增）US1-US3 回归'],
                      files: ['web/src/components/*（样式细节）'],
                      tests: ['E2E：US1-US3 回归'],
                      budgetDelta: '约 +$0.12 / +8k tokens（当前已用 $0.71 / $5.00）',
                      notes: '不触及架构与数据结构。',
                    },
                status: 'awaiting_approval',
              },
            },
            {
              type: 'approval_requested',
              approval: {
                id: 'AP-CR-1', kind: 'change', subject: `变更 CR-1 → 需求 v0.2：${text}`,
                description: text.includes('优先级')
                  ? '重大变更：新增 priority 字段与排序接口，3 项新任务，需全量回归。详见「变更」面板。'
                  : '低影响修改：2 项新任务，回归 US1-US3。详见「变更」面板。',
                status: 'pending', requestedAt: 0,
              },
            },
          ],
        },
        { d: 200, wait: 'approval' },
      ];
    },
  };
}

// ---------- v0.1 执行段落（含预设缺陷与退回重做） ----------

function executionV01(): Cue[] {
  return [
    { d: 400, events: [{ type: 'phase_changed', phase: '阶段 3 · 设计与实现', status: 'developing' }] },

    ...workTask({
      taskId: 'T1', role: 'product', runId: 'R-01', reviewNote: '验收标准覆盖 3 个用户故事，假设清单完整，通过',
      steps: [
        { detail: '阅读需求规格 v0.1，整理用户故事与边界条件' },
        { tool: 'write_file', detail: '写入 docs/requirements.md（US1-US3 + 验收清单）', artifacts: [art('T1', 'doc', 'docs/requirements.md', '需求规格定稿：3 个用户故事、9 条验收标准', { add: 86, del: 0 })] },
      ],
      usage: { inputTokens: 3200, outputTokens: 1500, costUsd: 0.04 },
    }),

    ...workTask({
      taskId: 'T2', role: 'architect', runId: 'R-02', reviewNote: '技术决策记录清晰，接口契约可执行，通过',
      steps: [
        { detail: '评估技术栈：前端 Vite+React、后端 Node+SQLite（演示环境用内存存储）' },
        { tool: 'write_file', detail: '写入 docs/architecture.md（技术决策记录 ADR-001）', artifacts: [art('T2', 'doc', 'docs/architecture.md', '架构说明与依赖图', { add: 64, del: 0 })] },
        { tool: 'write_file', detail: '写入 docs/api-contract.md（GET/POST/PATCH /tasks）', artifacts: [art('T2', 'doc', 'docs/api-contract.md', 'API 契约：3 个端点与错误码约定', { add: 52, del: 0 })] },
      ],
      usage: { inputTokens: 5400, outputTokens: 2600, costUsd: 0.08 },
    }),

    ...workTask({
      taskId: 'T3', role: 'designer', runId: 'R-03', reviewNote: '线框稿覆盖三屏状态，视觉规范与实现约束一致，通过',
      steps: [
        { detail: '绘制主界面线框：输入区 / 筛选栏 / 任务列表三段式' },
        { tool: 'write_file', detail: '导出 design/wireframe.png', artifacts: [art('T3', 'design', 'design/wireframe.png', '线框稿：默认 / 筛选完成 / 空列表三态')] },
        { tool: 'write_file', detail: '写入 design/ui-spec.md（组件与间距规范）', artifacts: [art('T3', 'design', 'design/ui-spec.md', '组件规范：12 个组件、8 项交互规则', { add: 71, del: 0 })] },
      ],
      usage: { inputTokens: 4100, outputTokens: 1900, costUsd: 0.06 },
    }),

    ...workTask({
      taskId: 'T4', role: 'backend', runId: 'R-04', reviewNote: '接口实现与契约一致，自测通过（TR-01），通过',
      steps: [
        { detail: '实现内存存储与 Task 模型（id/title/done/createdAt）' },
        { tool: 'write_file', detail: '写入 server/src/api/tasks.ts（GET/POST/PATCH）', artifacts: [art('T4', 'code', 'server/src/api/tasks.ts', '任务 CRUD 接口，含输入校验', { add: 118, del: 0 })] },
        { tool: 'run_command', detail: '运行 npm run test:api -- --run（任务级自测）' },
      ],
      testRuns: [testRun({
        id: 'TR-01', taskId: 'T4', kind: 'unit', command: 'npm run test:api -- --run',
        exitCode: 0, passed: 12, failed: 0, summary: 'API 单元测试全部通过',
        logExcerpt: ['✓ POST /tasks 创建任务并返回 201', '✓ POST /tasks 空标题返回 400', '✓ PATCH /tasks/:id 切换完成状态', '… 12 passed'],
        logPath: 'workspace/taskapp-demo/logs/api-unit-001.log',
      })],
      gates: [{ gate: 'unit', passed: true, detail: '任务级自测 12/12 通过（TR-01）', testRunId: 'TR-01' }],
      usage: { inputTokens: 7800, outputTokens: 3400, costUsd: 0.12 },
    }),

    ...workTask({
      taskId: 'T5', role: 'frontend', runId: 'R-05', reviewNote: '界面符合视觉规范，前端自测通过（TR-02），通过——注意：E2E 将在 T7 验证',
      steps: [
        { detail: '按线框稿实现三段式布局与组件' },
        { tool: 'write_file', detail: '写入 web/src/App.tsx 与组件（TaskList/FilterBar/TaskInput）', artifacts: [art('T5', 'code', 'web/src/App.tsx', '主界面：输入区+筛选栏+任务列表', { add: 96, del: 0 })] },
        { tool: 'write_file', detail: '写入 web/src/components/FilterBar.tsx', artifacts: [art('T5', 'code', 'web/src/components/FilterBar.tsx', '状态筛选栏（全部/未完成/已完成）', { add: 44, del: 0 })] },
        { tool: 'run_command', detail: '运行 npm run test:ui -- --run（组件测试）' },
      ],
      testRuns: [testRun({
        id: 'TR-02', taskId: 'T5', kind: 'unit', command: 'npm run test:ui -- --run',
        exitCode: 0, passed: 9, failed: 0, summary: '组件测试全部通过',
        logExcerpt: ['✓ TaskInput 空标题不触发提交', '✓ TaskList 渲染完成态删除线', '… 9 passed'],
        logPath: 'workspace/taskapp-demo/logs/ui-unit-001.log',
      })],
      gates: [{ gate: 'unit', passed: true, detail: '前端组件自测 9/9 通过（TR-02）', testRunId: 'TR-02' }],
      usage: { inputTokens: 8600, outputTokens: 3900, costUsd: 0.14 },
    }),

    // ---- T6 集成 ----
    ...workTask({
      taskId: 'T6', role: 'backend', runId: 'R-06', reviewNote: '集成构建与集成测试通过（TR-03），通过',
      steps: [
        { tool: 'run_command', detail: '运行 npm run build（前后端集成构建）' },
        { tool: 'run_command', detail: '运行 npm run test:integration -- --run' },
      ],
      testRuns: [
        testRun({
          id: 'TR-03a', taskId: 'T6', kind: 'build', command: 'npm run build',
          exitCode: 0, passed: 0, failed: 0, summary: '构建成功，产物 dist/ 生成',
          logExcerpt: ['vite v6 build for production... ✓ built in 3.2s'],
          logPath: 'workspace/taskapp-demo/logs/build-001.log',
        }),
        testRun({
          id: 'TR-03', taskId: 'T6', kind: 'integration', command: 'npm run test:integration -- --run',
          exitCode: 0, passed: 6, failed: 0, summary: '集成测试通过：API ↔ 存储 ↔ 契约一致',
          logExcerpt: ['✓ 契约一致性：GET /tasks 返回字段符合 api-contract.md', '… 6 passed'],
          logPath: 'workspace/taskapp-demo/logs/integration-001.log',
        }),
      ],
      gates: [{ gate: 'integration', passed: true, detail: '集成测试 6/6 通过（TR-03）', testRunId: 'TR-03' }],
      usage: { inputTokens: 3900, outputTokens: 1100, costUsd: 0.05 },
    }),

    // ---- T7 端到端测试：发现预设缺陷 → 退回 T5 → 修复 → 回归 ----
    { d: 400, events: [{ type: 'phase_changed', phase: '阶段 5 · 独立测试与代码审查', status: 'integrating' }] },
    {
      d: 420,
      events: [
        { type: 'task_status_changed', taskId: 'T7', from: 'pending', to: 'in_progress' },
        { type: 'agent_state_changed', role: 'tester', status: 'testing', taskId: 'T7', detail: '从验收标准出发编写并运行 E2E' },
        { type: 'agent_run_started', runId: 'R-07a', taskId: 'T7', role: 'tester', model: MODELS.tester },
      ],
    },
    { d: 500, events: [{ type: 'agent_step', runId: 'R-07a', taskId: 'T7', role: 'tester', step: { at: 0, kind: 'tool', tool: 'write_file', detail: '写入 test/e2e/spec.cy.ts（US1-US3 验收驱动）' } }, { type: 'artifact_created', artifact: art('T7', 'test', 'test/e2e/spec.cy.ts', 'E2E 用例：5 个场景覆盖验收标准', { add: 88, del: 0 }) }] },
    { d: 600, events: [{ type: 'agent_step', runId: 'R-07a', taskId: 'T7', role: 'tester', step: { at: 0, kind: 'tool', tool: 'run_command', detail: '运行 npm run test:e2e' } }] },
    {
      d: 900,
      events: [
        { type: 'test_run_recorded', testRun: testRun({
          id: 'TR-04', taskId: 'T7', kind: 'e2e', command: 'npm run test:e2e',
          exitCode: 1, passed: 3, failed: 2, summary: 'E2E 失败：2 项验收缺陷',
          logExcerpt: [
            '✗ US1 新增任务后列表计数不更新（需要手动刷新才显示）',
            '✗ US2 完成状态刷新后丢失（未写入 localStorage）',
            '✓ US3 筛选切换正常',
            '✓ US1 空标题拦截正常',
            '✓ US2 完成态样式正确',
            '2 failing / 3 passing',
          ],
          logPath: 'workspace/taskapp-demo/logs/e2e-001.log',
        }) },
        { type: 'gate_result', gate: 'e2e', passed: false, detail: 'E2E 2 项失败：列表计数不更新、完成状态不持久（证据 TR-04）', testRunId: 'TR-04', taskId: 'T7' },
      ],
    },
    { d: 400, events: [{ type: 'agent_run_ended', runId: 'R-07a', taskId: 'T7', status: 'succeeded', usage: { inputTokens: 5200, outputTokens: 2100, costUsd: 0.09 } }] },
    { d: 350, events: [{ type: 'agent_state_changed', role: 'tester', status: 'failed', taskId: 'T7', detail: 'E2E 发现 2 项验收缺陷', reason: 'TR-04 退出码 1：US1 计数不更新、US2 完成状态不持久' }] },
    { d: 450, events: [{ type: 'log', level: 'error', from: 'supervisor', message: 'E2E 门禁未通过（TR-04）：主管退回 T5 —— 不允许在失败状态下进入交付' }] },
    { d: 300, events: [{ type: 'task_status_changed', taskId: 'T5', from: 'done', to: 'rework', reason: '回归 reopen：E2E TR-04 两项验收缺陷（US1 计数 / US2 持久化）' }] },
    { d: 200, events: [{ type: 'agent_state_changed', role: 'frontend', status: 'working', taskId: 'T5', detail: '修复：状态更新后同步列表计数与 localStorage 持久化', reason: undefined }] },
    {
      d: 420,
      events: [
        { type: 'task_status_changed', taskId: 'T5', from: 'rework', to: 'in_progress', attempt: 2 },
        { type: 'agent_run_started', runId: 'R-05b', taskId: 'T5', role: 'frontend', model: MODELS.frontend },
      ],
    },
    { d: 500, events: [{ type: 'agent_step', runId: 'R-05b', taskId: 'T5', role: 'frontend', step: { at: 0, kind: 'think', detail: '定位：useTasks 未订阅 store 变更；localStorage 写入被条件短路' } }] },
    { d: 450, events: [{ type: 'agent_step', runId: 'R-05b', taskId: 'T5', role: 'frontend', step: { at: 0, kind: 'tool', tool: 'write_file', detail: '修复 web/src/hooks/useTasks.ts 与持久化逻辑' } }, { type: 'artifact_created', artifact: art('T5', 'code', 'web/src/hooks/useTasks.ts', '修复：订阅变更 + localStorage 持久化（+14/-6）', { add: 14, del: 6 }) }] },
    { d: 400, events: [{ type: 'agent_run_ended', runId: 'R-05b', taskId: 'T5', status: 'succeeded', usage: { inputTokens: 4400, outputTokens: 1300, costUsd: 0.06 } }] },
    { d: 350, events: [{ type: 'agent_state_changed', role: 'frontend', status: 'awaiting_review', taskId: 'T5', detail: '修复完成，等待复核与回归' }, { type: 'task_status_changed', taskId: 'T5', from: 'in_progress', to: 'awaiting_review' }] },
    { d: 400, events: [{ type: 'log', level: 'info', from: 'supervisor', message: '复核 T5 修复：变更聚焦缺陷本身，无范围蔓延，通过——按影响范围重跑 E2E' }, { type: 'task_status_changed', taskId: 'T5', from: 'awaiting_review', to: 'done' }] },
    { d: 300, events: [{ type: 'agent_state_changed', role: 'tester', status: 'testing', taskId: 'T7', detail: '重跑受影响 E2E + 回归' }, { type: 'agent_run_started', runId: 'R-07b', taskId: 'T7', role: 'tester', model: MODELS.tester }] },
    {
      d: 900,
      events: [
        { type: 'test_run_recorded', testRun: testRun({
          id: 'TR-05', taskId: 'T7', kind: 'e2e', command: 'npm run test:e2e',
          exitCode: 0, passed: 5, failed: 0, summary: '修复后 E2E 全量通过（取代 TR-04）',
          logExcerpt: ['✓ US1 新增任务列表实时更新', '✓ US2 完成状态刷新后保持', '✓ US3 筛选切换正常', '5 passing'],
          logPath: 'workspace/taskapp-demo/logs/e2e-002.log',
          supersedes: 'TR-04',
        }) },
        { type: 'gate_result', gate: 'e2e', passed: true, detail: 'E2E 5/5 通过（TR-05，已取代失败的 TR-04）', testRunId: 'TR-05', taskId: 'T7' },
      ],
    },
    { d: 400, events: [{ type: 'agent_run_ended', runId: 'R-07b', taskId: 'T7', status: 'succeeded', usage: { inputTokens: 3100, outputTokens: 900, costUsd: 0.05 } }, { type: 'agent_state_changed', role: 'tester', status: 'awaiting_review', taskId: 'T7' }, { type: 'task_status_changed', taskId: 'T7', from: 'in_progress', to: 'awaiting_review' }] },
    { d: 450, events: [{ type: 'log', level: 'info', from: 'supervisor', message: '复核 T7：测试结论有运行器证据（TR-05，退出码 0），缺陷闭环，通过' }, { type: 'task_status_changed', taskId: 'T7', from: 'awaiting_review', to: 'done' }, { type: 'agent_state_changed', role: 'tester', status: 'idle' }] },

    // ---- T8 代码审查（与 T7 并行时段，此处顺序演出） ----
    ...workTask({
      taskId: 'T8', role: 'reviewer', runId: 'R-08', reviewNote: '阻断级问题清零（1 条非阻断建议），通过',
      steps: [
        { tool: 'read_file', detail: '审查全部代码变更（T4/T5/T6 产物 + 修复 diff）' },
        { detail: '发现：tasks.ts 错误分支缺少 400 日志（非阻断，建议后续优化）' },
        { tool: 'write_file', detail: '写入 reports/review-001.md', artifacts: [art('T8', 'report', 'reports/review-001.md', '审查报告：0 阻断 / 1 建议', { add: 28, del: 0 })] },
      ],
      gates: [{ gate: 'review', passed: true, detail: '阻断级问题清零；1 条建议项已记录（不阻碍交付）' }],
      usage: { inputTokens: 6200, outputTokens: 1400, costUsd: 0.07 },
    }),

    // ---- T9 交付文档 ----
    ...workTask({
      taskId: 'T9', role: 'docs', runId: 'R-09', reviewNote: '运行指南在干净环境可复现（含依赖安装与启动命令），通过',
      steps: [
        { tool: 'write_file', detail: '写入 docs/README.md 与运行指南', artifacts: [art('T9', 'doc', 'docs/README.md', '项目说明 + 安装/运行指南（干净环境复现步骤）', { add: 58, del: 0 })] },
        { tool: 'write_file', detail: '写入 docs/交付清单.md 与已知限制', artifacts: [art('T9', 'doc', 'docs/交付清单.md', '交付清单：源码/文档/测试报告/已知限制', { add: 22, del: 0 })] },
      ],
      usage: { inputTokens: 2800, outputTokens: 1600, costUsd: 0.04 },
    }),

    // ---- 主管验收 ----
    { d: 400, events: [{ type: 'phase_changed', phase: '阶段 6 · 主管验收', status: 'integrating' }] },
    { d: 500, events: [{ type: 'agent_state_changed', role: 'supervisor', status: 'analyzing', detail: '对照需求、文件变更、测试证据与已知限制逐项验收' }] },
    { d: 700, events: [{ type: 'log', level: 'info', from: 'supervisor', message: '验收清单：US1 ✅（TR-05）US2 ✅（TR-05）US3 ✅（TR-05）；单元 12+9 ✅；集成 6 ✅；审查 0 阻断 ✅；已知限制 4 项已披露 ✅' }] },
    { d: 400, events: [{ type: 'gate_result', gate: 'acceptance', passed: true, detail: '主管验收通过：全部强制项满足，证据链完整（TR-01/02/03/05 + 审查报告）' }] },
    { d: 300, events: [{ type: 'agent_state_changed', role: 'supervisor', status: 'idle' }] },
    {
      d: 400,
      events: [{
        type: 'approval_requested',
        approval: {
          id: 'AP-DEL-1', kind: 'delivery', subject: '交付包 v0.1.0（发布确认）',
          description: '门禁全部通过：单元 21/21、集成 6/6、E2E 5/5、审查 0 阻断。已知限制 4 项。请确认发布。',
          status: 'pending', requestedAt: 0,
        },
      }],
    },
    { d: 200, wait: 'approval' },
  ];
}

// ---------- v0.2 迭代段落（变更实施 + 回归 + 再交付） ----------

function iterationV02(text: string): Cue[] {
  const isPriority = text.includes('优先级');
  const newTasks = planV02(text);
  return [
    { d: 350, events: [{ type: 'requirement_drafted', requirement: requirementV02(text) }] },
    { d: 300, events: [{ type: 'requirement_superseded', oldId: 'RV-1', newId: 'RV-2', newVersion: 'v0.2' }, { type: 'requirement_confirmed', requirementId: 'RV-2', version: 'v0.2' }, { type: 'log', level: 'info', from: 'supervisor', message: '需求版本化：v0.2 已创建并经变更审批确认，v0.1 保留为历史版本（不静默覆盖）' }] },
    { d: 400, events: [{ type: 'phase_changed', phase: '阶段 3 · 设计与实现（v0.2）', status: 'developing' }] },
    { d: 300, events: [{ type: 'plan_created', tasks: newTasks, note: `变更 CR-1 生成的增量任务（${newTasks.length} 项），旧任务及其证据保留` }] },

    ...(isPriority
      ? [
          ...workTask({
            taskId: 'T10', role: 'backend', runId: 'R-10', reviewNote: 'priority 字段迁移与排序接口符合契约，自测通过（TR-06）',
            steps: [
              { detail: '扩展 Task 模型：priority: "low"|"med"|"high"，默认 "med"' },
              { tool: 'write_file', detail: '更新 server/src/api/tasks.ts 与存储迁移', artifacts: [art('T10', 'code', 'server/src/api/tasks.ts', '+sort=priority 排序支持与迁移（+38/-4）', { add: 38, del: 4 })] },
              { tool: 'run_command', detail: '运行 npm run test:api -- --run' },
            ],
            testRuns: [testRun({
              id: 'TR-06', taskId: 'T10', kind: 'unit', command: 'npm run test:api -- --run',
              exitCode: 0, passed: 15, failed: 0, summary: '含 priority 的 API 单元测试全部通过',
              logExcerpt: ['✓ 新任务默认 priority=med', '✓ GET /tasks?sort=priority 返回高→低', '… 15 passed'],
              logPath: 'workspace/taskapp-demo/logs/api-unit-002.log',
            })],
            gates: [{ gate: 'unit', passed: true, detail: 'v0.2 单元测试 15/15 通过（TR-06）', testRunId: 'TR-06' }],
            usage: { inputTokens: 6900, outputTokens: 2800, costUsd: 0.11 },
          }),
          ...workTask({
            taskId: 'T11', role: 'frontend', runId: 'R-11', reviewNote: '优先级筛选 UI 符合规范，组件测试通过（TR-07）',
            steps: [
              { tool: 'write_file', detail: '扩展 FilterBar：优先级筛选与状态筛选叠加', artifacts: [art('T11', 'code', 'web/src/components/FilterBar.tsx', '优先级筛选（低/中/高）+ 叠加逻辑（+41/-3）', { add: 41, del: 3 })] },
              { tool: 'write_file', detail: 'TaskItem 增加优先级标记', artifacts: [art('T11', 'code', 'web/src/components/TaskItem.tsx', '优先级色点标记', { add: 12, del: 1 })] },
              { tool: 'run_command', detail: '运行 npm run test:ui -- --run' },
            ],
            testRuns: [testRun({
              id: 'TR-07', taskId: 'T11', kind: 'unit', command: 'npm run test:ui -- --run',
              exitCode: 0, passed: 12, failed: 0, summary: '含优先级筛选的组件测试通过',
              logExcerpt: ['✓ FilterBar 优先级与状态筛选叠加', '… 12 passed'],
              logPath: 'workspace/taskapp-demo/logs/ui-unit-002.log',
            })],
            gates: [{ gate: 'unit', passed: true, detail: 'v0.2 前端组件测试 12/12 通过（TR-07）', testRunId: 'TR-07' }],
            usage: { inputTokens: 5800, outputTokens: 2300, costUsd: 0.09 },
          }),
        ]
      : [
          ...workTask({
            taskId: 'T10', role: 'frontend', runId: 'R-10', reviewNote: '界面微调符合变更说明，组件测试通过（TR-06）',
            steps: [
              { tool: 'write_file', detail: '按变更说明调整界面细节', artifacts: [art('T10', 'code', 'web/src/components/*', '界面微调（+9/-5）', { add: 9, del: 5 })] },
              { tool: 'run_command', detail: '运行 npm run test:ui -- --run' },
            ],
            testRuns: [testRun({
              id: 'TR-06', taskId: 'T10', kind: 'unit', command: 'npm run test:ui -- --run',
              exitCode: 0, passed: 9, failed: 0, summary: '组件测试全部通过',
              logExcerpt: ['… 9 passed'],
              logPath: 'workspace/taskapp-demo/logs/ui-unit-002.log',
            })],
            gates: [{ gate: 'unit', passed: true, detail: 'v0.2 组件测试 9/9 通过（TR-06）', testRunId: 'TR-06' }],
            usage: { inputTokens: 3600, outputTokens: 1100, costUsd: 0.05 },
          }),
        ]),

    // ---- 回归测试（变更铁律：代码变化后按影响范围重新执行测试） ----
    {
      d: 420,
      events: [
        { type: 'task_status_changed', taskId: isPriority ? 'T12' : 'T11', from: 'pending', to: 'in_progress' },
        { type: 'agent_state_changed', role: 'tester', status: 'testing', taskId: isPriority ? 'T12' : 'T11', detail: 'US1-US3 全量回归 + 新增验收' },
        { type: 'agent_run_started', runId: 'R-12', taskId: isPriority ? 'T12' : 'T11', role: 'tester', model: MODELS.tester },
        { type: 'agent_step', runId: 'R-12', taskId: isPriority ? 'T12' : 'T11', role: 'tester', step: { at: 0, kind: 'tool', tool: 'run_command', detail: '运行 npm run test:e2e（v0.2 全量回归）' } },
      ],
    },
    {
      d: 950,
      events: [
        { type: 'test_run_recorded', testRun: testRun({
          id: 'TR-08', taskId: isPriority ? 'T12' : 'T11', kind: 'e2e', command: 'npm run test:e2e',
          exitCode: 0, passed: isPriority ? 9 : 5, failed: 0,
          summary: `v0.2 回归通过（取代 v0.1 的 TR-05）：US1-US3 回归${isPriority ? ' + US4 优先级筛选' : ''}`,
          logExcerpt: ['✓ US1 新增任务', '✓ US2 完成与持久化', '✓ US3 状态筛选', ...(isPriority ? ['✓ US4 优先级设置与筛选', '✓ 优先级×状态叠加筛选'] : []), `${isPriority ? 9 : 5} passing`],
          logPath: 'workspace/taskapp-demo/logs/e2e-003.log',
          supersedes: 'TR-05',
        }) },
        { type: 'gate_result', gate: 'e2e', passed: true, detail: `v0.2 回归 ${isPriority ? 9 : 5}/${isPriority ? 9 : 5} 通过（TR-08，已取代 TR-05）`, testRunId: 'TR-08' },
        { type: 'agent_run_ended', runId: 'R-12', taskId: isPriority ? 'T12' : 'T11', status: 'succeeded', usage: { inputTokens: 3400, outputTokens: 800, costUsd: 0.05 } },
        { type: 'agent_state_changed', role: 'tester', status: 'awaiting_review', taskId: isPriority ? 'T12' : 'T11' },
        { type: 'task_status_changed', taskId: isPriority ? 'T12' : 'T11', from: 'in_progress', to: 'awaiting_review' },
      ],
    },
    { d: 420, events: [{ type: 'log', level: 'info', from: 'supervisor', message: `复核回归任务：证据完整（TR-08，退出码 0），通过` }, { type: 'task_status_changed', taskId: isPriority ? 'T12' : 'T11', from: 'awaiting_review', to: 'done' }, { type: 'agent_state_changed', role: 'tester', status: 'idle' }] },

    // ---- v0.2 验收 ----
    { d: 350, events: [{ type: 'phase_changed', phase: '阶段 6 · 主管验收（v0.2）', status: 'integrating' }] },
    { d: 500, events: [{ type: 'agent_state_changed', role: 'supervisor', status: 'analyzing', detail: 'v0.2 验收：新增验收 + 全量回归' }] },
    { d: 600, events: [{ type: 'gate_result', gate: 'acceptance', passed: true, detail: 'v0.2 验收通过：US4 满足，US1-US3 回归无退化（TR-08），已知限制已更新' }] },
    { d: 250, events: [{ type: 'agent_state_changed', role: 'supervisor', status: 'idle' }] },
    {
      d: 350,
      events: [{
        type: 'approval_requested',
        approval: {
          id: 'AP-DEL-2', kind: 'delivery', subject: '交付包 v0.2.0（发布确认）',
          description: `变更 CR-1 已实施：${text}。回归全量通过。请确认发布。`,
          status: 'pending', requestedAt: 0,
        },
      }],
    },
    { d: 200, wait: 'approval' },
  ];
}
