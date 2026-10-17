/**
 * 核心领域模型。
 *
 * 铁律（来自项目计划 V1.0）：
 * 1. 测试结论必须来自真实/模拟"测试运行器"的执行记录（TestRun.exitCode），模型自述不算证据。
 * 2. 未通过门禁时不得标记为可交付（见 gates.ts / deliveryBlockers）。
 * 3. 需求变更必须走 ChangeRequest + 影响分析 + 新版本记录，不静默覆盖。
 * 4. Agent 可视状态只是事件的可视化，权威状态在这里。
 */

/** 9 个 Agent 角色（计划第四章组织结构） */
export type AgentRole =
  | 'supervisor' // 主 Agent / 项目主管
  | 'product'    // 产品分析
  | 'architect'  // 架构
  | 'designer'   // UI/UX
  | 'frontend'   // 前端
  | 'backend'    // 后端
  | 'tester'     // 测试
  | 'reviewer'   // 代码审查
  | 'docs';      // 文档/交付

export const AGENT_ROLES: AgentRole[] = [
  'supervisor', 'product', 'architect', 'designer',
  'frontend', 'backend', 'tester', 'reviewer', 'docs',
];

export const ROLE_LABELS: Record<AgentRole, string> = {
  supervisor: '项目主管',
  product: '产品分析',
  architect: '架构',
  designer: 'UI/UX',
  frontend: '前端',
  backend: '后端',
  tester: '测试',
  reviewer: '代码审查',
  docs: '文档交付',
};

/** Agent 可视状态（计划 3.2：状态必须来自运行事件） */
export type AgentVisualStatus =
  | 'idle'           // 空闲
  | 'analyzing'      // 分析/规划
  | 'working'        // 编码/设计
  | 'testing'        // 运行测试
  | 'awaiting_review'// 等待审核（举手）
  | 'blocked'        // 阻塞/需要用户
  | 'failed';        // 失败

/** 任务状态机状态（左侧看板 5 列由此聚合） */
export type TaskStatus =
  | 'pending'         // 待处理（含就绪）
  | 'ready'           // 依赖满足，可执行（看板归入待处理）
  | 'in_progress'     // 进行中（含 rework）
  | 'rework'          // 被退回，待重做（看板归入进行中）
  | 'awaiting_review' // 待审核
  | 'blocked'         // 阻塞/需要用户
  | 'done';           // 已完成

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待处理',
  ready: '就绪',
  in_progress: '进行中',
  rework: '重做中',
  awaiting_review: '待审核',
  blocked: '阻塞',
  done: '已完成',
};

/** 看板列（计划 3.1：待处理、进行中、阻塞、待审核、已完成） */
export type KanbanColumn = 'backlog' | 'active' | 'blocked' | 'review' | 'done';
export const KANBAN_COLUMNS: { key: KanbanColumn; label: string }[] = [
  { key: 'backlog', label: '待处理' },
  { key: 'active', label: '进行中' },
  { key: 'blocked', label: '阻塞' },
  { key: 'review', label: '待审核' },
  { key: 'done', label: '已完成' },
];

export function kanbanOf(status: TaskStatus): KanbanColumn {
  switch (status) {
    case 'pending':
    case 'ready': return 'backlog';
    case 'in_progress':
    case 'rework': return 'active';
    case 'blocked': return 'blocked';
    case 'awaiting_review': return 'review';
    case 'done': return 'done';
  }
}

export type TaskKind =
  | 'analysis' | 'architecture' | 'design' | 'backend' | 'frontend'
  | 'integration' | 'test' | 'review' | 'docs';

export type GateName =
  | 'format' | 'types' | 'static' | 'unit' | 'integration' | 'e2e'
  | 'review' | 'acceptance' | 'delivery';

export const GATE_LABELS: Record<GateName, string> = {
  format: '格式检查', types: '类型检查', static: '静态检查',
  unit: '单元测试', integration: '集成测试', e2e: '端到端测试',
  review: '代码审查', acceptance: '主管验收', delivery: '交付门禁',
};

export interface ModelRef {
  provider: string;
  modelId: string;
}

/** 需求版本（第六章：为变更创建新版本，保留旧版本） */
export interface RequirementVersion {
  id: string;
  version: string; // v0.1
  userText: string;
  overview: string;
  userStories: UserStory[];
  assumptions: string[];
  risks: string[];
  status: 'draft' | 'confirmed' | 'superseded';
  createdAt: number;
  confirmedAt?: number;
  supersedes?: string; // 前一版本 id
}

export interface UserStory {
  id: string;        // US1
  story: string;
  acceptance: string[]; // 验收标准
}

/** 任务（第十三章核心数据结构） */
export interface Task {
  id: string;              // T1
  title: string;
  kind: TaskKind;
  role: AgentRole;         // 负责人
  status: TaskStatus;
  dependsOn: string[];
  requirementVersionId: string;
  inputs: string[];        // 输入契约
  outputs: string[];       // 输出契约 / 完成定义（DoD）
  artifacts: string[];     // artifact ids
  testRuns: string[];      // testRun ids
  attempts: number;        // 执行次数（含重做）
  blockingReason?: string; // 阻塞原因（真实原因必须可见）
  createdAt: number;
  updatedAt: number;
}

/** Agent 执行记录（含模型与用量） */
export interface AgentRun {
  id: string;
  taskId: string;
  role: AgentRole;
  model: ModelRef;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  endedAt?: number;
  steps: RunStep[];
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface RunStep {
  at: number;
  kind: 'think' | 'tool' | 'message';
  tool?: string;   // write_file / run_command / read_file ...
  detail: string;
}

/** 产物 */
export interface Artifact {
  id: string;
  taskId: string;
  kind: 'code' | 'design' | 'doc' | 'test' | 'report';
  path: string;      // 工作区相对路径
  summary: string;
  linesAdded?: number;
  linesRemoved?: number;
}

/**
 * 测试运行记录 —— 证据的载体。
 * 只有这里记录的 exitCode 才能作为"测试通过/失败"的事实来源。
 * supersededBy：代码变化后旧测试结果按影响范围失效，由重跑记录取代。
 */
export interface TestRun {
  id: string;
  taskId: string;
  kind: 'build' | 'static' | 'unit' | 'integration' | 'e2e';
  command: string;
  startedAt: number;
  endedAt: number;
  exitCode: number;
  passed: number;
  failed: number;
  summary: string;
  logExcerpt: string[];
  logPath: string; // 日志落盘位置（模拟路径）
  supersedes?: string;
  supersededBy?: string;
}

export type ApprovalKind =
  | 'requirement' | 'plan' | 'merge' | 'change' | 'delivery' | 'high_risk';

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  requirement: '需求确认',
  plan: '任务计划',
  merge: '合并请求',
  change: '需求变更',
  delivery: '交付发布',
  high_risk: '高风险操作',
};

export interface Approval {
  id: string;
  kind: ApprovalKind;
  subject: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: number;
  decidedAt?: number;
  decidedBy?: 'user';
  note?: string;
}

/** 需求变更（第六章） */
export interface ChangeRequest {
  id: string; // CR-1
  userText: string;
  classification: 'clarification' | 'minor' | 'major';
  classificationNote: string;
  impact?: {
    tasks: string[];       // 受影响/新增任务 id
    files: string[];       // 受影响文件
    tests: string[];       // 需重跑/新增的测试
    budgetDelta: string;   // 预算影响
    notes: string;
  };
  newRequirementVersionId?: string;
  status: 'analyzing' | 'awaiting_approval' | 'approved' | 'rejected' | 'implemented';
  createdAt: number;
}

export interface GateResult {
  gate: GateName;
  passed: boolean;
  detail: string;
  at: number;
  testRunId?: string;
  taskId?: string;
}

export interface DeliveryInfo {
  version: string;
  manifest: string[];
  knownLimits: string[];
  testSummary: string;
  packagedAt: number;
}

export interface Budget {
  spentUsd: number;
  capUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export type ProjectStatus =
  | 'initialized' | 'clarifying' | 'planning' | 'developing'
  | 'integrating' | 'deliverable' | 'delivered' | 'iterating';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  initialized: '已初始化',
  clarifying: '需求澄清',
  planning: '方案规划',
  developing: '开发中',
  integrating: '集成验证',
  deliverable: '待交付',
  delivered: '已交付',
  iterating: '迭代中',
};

/** Agent 权威可视状态（由 agent_state_changed 事件驱动） */
export interface AgentState {
  role: AgentRole;
  status: AgentVisualStatus;
  currentTaskId?: string;
  detail?: string;   // 人类可读的当前动作说明
  reason?: string;   // blocked/failed 的真实原因
  since: number;
}

/** 由事件流重建的完整项目状态 */
export interface ProjectState {
  projectId: string;
  projectName: string;
  workspace: string;
  status: ProjectStatus;
  phase: string;               // 当前研发阶段标签（阶段 0-8）
  currentVersion: string;      // 当前需求版本号
  requirementVersions: Record<string, RequirementVersion>;
  tasks: Record<string, Task>;
  agentRuns: Record<string, AgentRun>;
  artifacts: Record<string, Artifact>;
  testRuns: Record<string, TestRun>;
  approvals: Record<string, Approval>;
  changeRequests: Record<string, ChangeRequest>;
  agents: Record<AgentRole, AgentState>;
  gates: GateResult[];
  budget: Budget;
  delivery?: DeliveryInfo;
  deliveries: DeliveryInfo[];   // 历史交付（含版本）
}
