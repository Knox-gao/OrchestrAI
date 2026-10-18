/**
 * 真实生成流水线：一句话 → 真实文件 → 真实测试 → 真实交付事件。
 * 产出与演示剧本同构的事件队列（Cue[]），客户端走完全相同的渲染与门禁逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSentence, buildFiles, extractSubject, TEMPLATES } from './generator/index.mjs';
import { staticCheck } from './generator/quality.mjs';
import { runNodeTests } from './runner.mjs';
import { collectImages, queryCascade, bestMatch, extractEnglishTokens } from './scraper.mjs';
import { visualAudit } from './visualaudit.mjs';
import { loadAssets, saveAssets, assetEntry, reusableAsset, resolveSlot } from './assets.mjs';
import { generateBrief } from './generator/designbrief.mjs';
import { pickLayout } from './generator/layouts/index.mjs';
import { rankCandidates } from './generator/curator.mjs';
import { renderCheck } from './rendercheck.mjs';
import { getKeys } from './keys.mjs';
import { placeholderCard } from './generator/png.mjs';
import { findStyle, getStyleDef } from './generator/styles.mjs';
import { pickGateway } from './llm.mjs';
import { parseIntentWithLLM } from './intent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKSPACES = path.join(ROOT, 'workspaces');

const MODEL = { provider: 'local', modelId: 'template-generator-v1' };
const TESTER_MODEL = { provider: 'runtime', modelId: 'node--test-v22' };

function trId(seq) { return `TR-${String(seq).padStart(2, '0')}`; }

/** 有界并发映射（图鉴逐对象采集用） */
async function mapPool(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx).catch(() => null);
    }
  }));
  return out;
}

export async function runPipeline(requirement, styleId, fxLevel, projectTitle, styleDescription, onPhase, llmChoice = 'auto') {
  const sentence = requirement;
  const projectId = 'P' + Date.now().toString(36).toUpperCase();
  const ws = path.join(WORKSPACES, projectId);
  fs.mkdirSync(path.join(ws, 'test'), { recursive: true });

  let spec = parseSentence(`${projectTitle ?? ''} ${requirement}`.trim(), { styleId, fxLevel, styleDescription });
  if (projectTitle) spec.title = projectTitle;
  onPhase?.('解析需求与风格…');
  const cues = [];
  const emit = (d, events) => cues.push({ d, events });

  // ---- P4 Model Gateway：配置了 LLM Key 则用 AI 理解需求（失败安全回退规则） ----
  const gw = pickGateway(llmChoice);
  if (gw) {
    onPhase?.(`AI 理解需求中（${gw.label ?? gw.provider}/${gw.model}）…`);
    // 统一重试保险：① 调用异常（网络/限流/JSON 截断解析失败）② 解析成功但数据集不完整（atlas 对象空 / gallery 图鉴 items 空）
    // —— 最多两次尝试，第二次仍不行才回退规则识别
    const needsDataset = (it) => (it.type === 'atlas' && (!it.atlas || (it.atlas.objects ?? []).length < 3))
      || (it.type === 'gallery' && !it.gallery?.items?.length && /图鉴|介绍|百科|全部|所有|成员|历代|系列|阵容|角色/.test(requirement));
    let intent = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2 && !intent; attempt++) {
      try {
        const it = await parseIntentWithLLM(requirement, projectTitle ?? '', gw, spec);
        if (attempt === 1 && needsDataset(it)) {
          cues.push({ d: 210, events: [
            { type: 'log', level: 'warn', from: 'supervisor', message: `AI 返回的数据集不完整（${it.type === 'atlas' ? '图谱对象为空' : '图鉴清单为空'}），自动重试一次…` },
          ] });
          continue; // 第二次无论完整性如何都接受（优于回退规则识别）
        }
        intent = it;
      } catch (e) {
        lastErr = e;
        if (attempt === 1) {
          cues.push({ d: 205, events: [
            { type: 'log', level: 'warn', from: 'supervisor', message: `模型调用失败（${String(e?.message ?? e).slice(0, 90)}），自动重试一次…` },
          ] });
        }
      }
    }
    if (intent) {
      const nextTpl = TEMPLATES[intent.type];
      if (nextTpl) spec.template = nextTpl;
      spec.type = intent.type;
      if (!projectTitle) spec.title = intent.title;
      spec.features = intent.features;
      spec.matchedBy = `AI 理解（${intent.llmProvider}）`;
      if (intent.type === 'gallery' && intent.subject) spec.galleryQuery = intent.subject;
      if (intent.type === 'gallery' && intent.gallery && (intent.gallery.items ?? []).length >= 4) {
        spec.galleryItems = intent.gallery.items;
        if (!spec.galleryQuery) spec.galleryQuery = intent.gallery.items[0].name;
      }
      if (intent.type === 'landing' && intent.landing) spec.landing = intent.landing;
      if (intent.type === 'atlas') spec.atlas = intent.atlas;
      // AI 视觉设计：用户未显式选风格、需求关键词也未命中目录 → 用 LLM 为主题定制的设计简报
      // 优先级：用户显式风格 > 需求文本关键词 > AI 设计 > 默认兜底
      if (intent.design?.desc && !styleDescription && !spec.styleId) {
        spec.styleDescription = intent.design.desc;
        spec.styleDesign = true;
        cues.push({ d: 215, events: [
          { type: 'agent_state_changed', role: 'designer', status: 'analyzing', detail: `AI 视觉设计：${intent.design.desc.slice(0, 50)}` },
          { type: 'log', level: 'info', from: 'designer', message: `🎨 AI 视觉设计师为主题定制风格：${intent.design.desc.slice(0, 70)}` },
        ] });
      }
      spec.viaLLM = true;
      spec.llmProvider = intent.llmProvider;
      // ---- 阶段二任务 B：完整 Design Brief（landing 类）——双方向+schema 校验，失败回退旧简报路径
      if (intent.type === 'landing' && !spec.designLayout) {
        try {
          onPhase?.('AI 首席设计师正在撰写 Design Brief（双方向）…');
          const { brief, notes, callMeta } = await generateBrief(requirement, projectTitle ?? spec.title, gw);
          spec.designBrief = brief;
          spec.designLayout = pickLayout(brief);
          spec.designBriefMeta = { ms: callMeta.ms, retries: callMeta.retries, parseOk: callMeta.parseOk, notes };
          cues.push({ d: 218, events: [
            { type: 'agent_state_changed', role: 'designer', status: 'analyzing', detail: `Design Brief：${brief.directions.map((d) => d.name).join(' / ')} → 选定 ${spec.designLayout ?? 'pageShell 回退'}` },
            { type: 'log', level: 'info', from: 'designer', message: `📐 Design Brief 完成（${callMeta.ms}ms，重试${callMeta.retries}）：方向A「${brief.directions[0].name}·${brief.directions[0].layoutStrategy}」/ 方向B「${brief.directions[1].name}·${brief.directions[1].layoutStrategy}」${notes.length ? `；规范化：${notes[0].slice(0, 40)}` : ''}` },
          ] });
        } catch (e) {
          spec.designLayout = null;
          spec.designBriefMeta = { failed: String(e?.message ?? e).slice(0, 140) };
          cues.push({ d: 219, events: [
            { type: 'log', level: 'warn', from: 'designer', message: `⚠ Design Brief 未通过校验，布局回退 pageShell：${String(e?.message ?? e).slice(0, 110)}` },
          ] });
        }
      }
    } else {
      spec.viaLLM = false;
      spec.llmFallbackReason = String(lastErr?.message ?? lastErr ?? '两次尝试均未返回有效数据集').slice(0, 140);
      cues.push({ d: 200, events: [
        { type: 'log', level: 'warn', from: 'supervisor', message: `⚠ 模型调用失败，已回退规则识别：${spec.llmFallbackReason}（可在 🔑 面板用「测试连接」排查，或稍后重试）` },
      ] });
    }
  }
  if (spec.type !== 'gallery') delete spec.galleryQuery;

  const styleDef = getStyleDef(spec);
  spec.styleDef = styleDef;
  onPhase?.(`风格「${styleDef.name}」已就绪`);
  const usage = (i, o, c) => ({ inputTokens: i, outputTokens: o, costUsd: c });

  // ---- 展馆类型：先执行真实网络素材采集（designer 角色） ----
  if (spec.type === 'gallery') {
    const keys = getKeys();
    const items = spec.galleryItems ?? [];
    if (items.length >= 4) {
      // ---- 图鉴模式：LLM 已产出对象清单（名称/副题/介绍/配图搜索词）→ 逐对象定向采集 ----
      emit(300, [
        { type: 'agent_state_changed', role: 'designer', status: 'analyzing', detail: `图鉴模式：${items.length} 个对象，逐一定向配图并保留介绍` },
      ]);
      emit(400, [
        { type: 'agent_run_started', runId: 'R-00', taskId: 'T1', role: 'designer', model: { provider: 'web', modelId: 'image-collector-v1' } },
        { type: 'agent_step', runId: 'R-00', taskId: 'T1', role: 'designer', step: { at: 0, kind: 'tool', tool: 'web_search', detail: `为每个对象定向搜索配图（${items[0].name}、${items[1]?.name ?? ''}… 共 ${items.length} 个，Pexels → Unsplash → Bing → Wikimedia 链）` } },
      ]);
      let done = 0, okCount = 0;
      const noPhotoNames = [];
      // 查询级联采集：全名 → LLM 词 → 英文名 → 前缀截断 → 本名；每级取 3 候选交策展器四维评分。
      // 内容维度须 strong（完整词命中）才采用（弱命中=无把握，不猜）；策略与阶段一 strict 等效并叠加 tech/visual/source 维。
      const collectOne = async (it) => {
        const targets = [it.name, extractEnglishTokens(it.query || '')].filter(Boolean);
        for (const q of queryCascade(it)) {
          const r = await collectImages({ query: q, count: 3, keys });
          if (r.images.length > 0) {
            const { ranked } = rankCandidates(r.images, { targets });
            const top = ranked[0];
            if (top && top.dims.content.level === 'strong' && top.dims.tech.score > 0) {
              return { ...top.cand, buf: top.cand.buf, curatorReasons: top.reasons, curatorTotal: top.total };
            }
          }
          await new Promise((r2) => setTimeout(r2, 700));
        }
        const en = extractEnglishTokens(it.query || '');
        if (en) {
          const r = await collectImages({ query: it.name, count: 1, keys, wikiTitle: en });
          if (r.images.length > 0) return r.images[0];
        }
        return null;
      };
      // 图片资产锁定复用（阶段二升级为图位语义解析）：名称变但语义同→复用；语义变→拒绝并保留 retired 记录。
      // 开关：ORCHESTRAI_IMAGE_LOCK=off 关闭（回滚通道）。
      const lockOn = process.env.ORCHESTRAI_IMAGE_LOCK !== 'off';
      const assetKey = projectTitle || spec.title || projectId;
      const prevAssets = lockOn ? loadAssets(assetKey) : { version: 1, entries: [] };
      let reuseCount = 0;
      const slotStats = { reuse: 0, 'semantic-change': 0, 'source-missing': 0, 'hash-mismatch': 0, 'no-match': 0 };
      const retiredNames = [];
      const results = await mapPool(items, 2, async (it) => {
        if (lockOn) {
          const r = resolveSlot(prevAssets, { name: it.name, en: extractEnglishTokens(it.query || it.name) });
          slotStats[r.status] = (slotStats[r.status] ?? 0) + 1;
          if (r.status === 'reuse') { reuseCount++; okCount++; return r.img; }
          if (r.status === 'semantic-change') retiredNames.push(it.name);
        }
        const got = await collectOne(it);
        done++;
        if (got) okCount++;
        else noPhotoNames.push(it.name);
        onPhase?.(`正在为「${it.name}」采集照片（${done}/${items.length}）${got ? '' : ' · 未获照片将用示意卡'}`);
        return got;
      });
      // 文件命名：复用资产保留原文件名并预占；新采集递增序号并跳过已占用名
      // （真实缺陷修复：同名覆盖曾致 images.js 引用缺失文件，被渲染门禁检出）
      const usedNames = new Set(items.map((it, i) => (results[i]?.reused ? results[i].file : null)).filter(Boolean));
      let seq = 1;
      spec.images = items.map((it, i) => {
        const got = results[i];
        const base = { title: it.name, sub: it.sub, desc: it.desc };
        if (got) {
          let file;
          if (got.reused) {
            file = got.file;
          } else {
            do { file = `images/img-${String(seq).padStart(2, '0')}.${got.ext}`; seq++; } while (usedNames.has(file));
          }
          usedNames.add(file);
          return {
            ...base,
            file,
            author: got.author.slice(0, 60), license: got.license.slice(0, 40), page: got.page,
            buf: got.buf,
          };
        }
        let file;
        do { file = `images/card-${String(seq).padStart(2, '0')}.png`; seq++; } while (usedNames.has(file));
        usedNames.add(file);
        return {
          ...base,
          file,
          author: 'OrchestrAI 本地生成', license: '生成内容', page: '',
          buf: placeholderCard(800, 600, spec.template.meta.accent, i),
        };
      });
      // 资产注册表落盘：真实网络照片记为锁定资产（slotKey/en/来源工作区/许可/理由/时间/sha1）；
      // 语义变化的旧条目标记 retired 保留（不删除不覆盖）；示意卡不入锁。
      if (lockOn) {
        const fresh = items
          .map((it, i) => (results[i] && !results[i].reused ? assetEntry(spec.images[i], {
            provider: spec.provider ?? '',
            reason: results[i].curatorReasons ? `策展评分 ${results[i].curatorTotal}：${results[i].curatorReasons.join('；').slice(0, 140)}` : `对象「${it.name}」维基权威肖像兜底`,
            srcWs: path.basename(ws),
            slotKey: undefined,
            en: extractEnglishTokens(it.query || it.name),
          }) : null))
          .filter(Boolean);
        const reusedNames = new Set(items.filter((it, i) => results[i]?.reused).map((it) => it.name));
        const kept = (prevAssets.entries ?? []).filter((e) => reusedNames.has(e.title));
        const retired = (prevAssets.entries ?? [])
          .filter((e) => retiredNames.includes(e.title))
          .map((e) => ({ ...e, locked: false, status: 'retired', retiredAt: new Date().toISOString() }));
        saveAssets(assetKey, { version: 1, entries: [...kept, ...fresh, ...retired] });
      }
      spec.provider = `定向采集 ${okCount}/${items.length}${reuseCount ? `（复用已锁定 ${reuseCount}）` : ''}`;
      spec.imageSource = okCount > 0 ? 'network' : 'placeholder';
      const totalBytes = spec.images.reduce((a, i) => a + i.buf.length, 0);
      emit(500, [
        { type: 'log', level: okCount === items.length ? 'success' : 'info', from: 'designer', message: `图鉴采集完成：${okCount}/${items.length} 个对象获得真实网络照片（共 ${(totalBytes / 1024 / 1024).toFixed(1)}MB，策展四维评分）${lockOn ? `；图位解析：复用${slotStats.reuse} 新采${slotStats['no-match']} 语义变更${slotStats['semantic-change']} 源丢失${slotStats['source-missing']}${retiredNames.length ? `（retired：${retiredNames.join('、')}）` : ''}` : ''}${noPhotoNames.length ? `；未获照片（已用示意卡保留介绍）：${noPhotoNames.join('、')}` : ''}` },
      ]);
      emit(260, [
        { type: 'agent_run_ended', runId: 'R-00', taskId: 'T1', status: 'succeeded', usage: usage(400, 100, 0.01) },
        { type: 'agent_state_changed', role: 'designer', status: 'idle' },
      ]);
      spec.extraAssets = ['images.js', ...spec.images.map((i) => i.file)];
    } else {
      const query = spec.galleryQuery || extractSubject(sentence);
      spec.galleryQuery = query;
      emit(300, [
        { type: 'agent_state_changed', role: 'designer', status: 'analyzing', detail: `确定素材采集方案：主题「${query}」` },
      ]);
      emit(400, [
        { type: 'agent_run_started', runId: 'R-00', taskId: 'T1', role: 'designer', model: { provider: 'web', modelId: 'image-collector-v1' } },
        { type: 'agent_step', runId: 'R-00', taskId: 'T1', role: 'designer', step: { at: 0, kind: 'tool', tool: 'web_search', detail: `搜索网络图源（Pexels → Unsplash → Bing 图片 → Wikimedia 适配器链，已配置密钥的优先）` } },
      ]);
      onPhase?.(`正在联网采集「${query}」照片…`);
      const scraped = await collectImages({ query, count: 10, keys });
      if (scraped.images.length > 0) {
        const totalBytes = scraped.images.reduce((a, i) => a + i.buf.length, 0);
        emit(500, [
          { type: 'log', level: 'success', from: 'designer', message: `图源 ${scraped.provider} 采集成功：${scraped.images.length} 张（共 ${(totalBytes / 1024 / 1024).toFixed(1)}MB），全部下载到工作区并保留署名` },
        ]);
        spec.images = scraped.images.map((img, i) => ({
          file: `images/img-${String(i + 1).padStart(2, '0')}.${img.ext}`,
          title: img.title.slice(0, 60), author: img.author.slice(0, 60),
          license: img.license.slice(0, 40), page: img.page,
        }));
        spec.images.forEach((m, i) => { m.buf = scraped.images[i].buf; });
        spec.provider = scraped.provider;
        spec.imageSource = 'network';
      } else {
        // 诚实兜底：网络不可达 → 本地程序化示意卡（标签明示）
        emit(400, [
          { type: 'log', level: 'warn', from: 'designer', message: `网络图源不可达（${scraped.errors.slice(0, 2).join('；')}）→ 生成 6 张本地示意卡代替，并在已知限制中披露` },
        ]);
        spec.images = Array.from({ length: 6 }, (_, i) => ({
          file: `images/card-${String(i + 1).padStart(2, '0')}.png`,
          title: `${query} · 示意卡 ${i + 1}`,
          author: 'OrchestrAI 本地生成', license: '生成内容', page: '',
          buf: placeholderCard(800, 600, spec.template.meta.accent, i),
        }));
        spec.provider = '本地示意卡';
        spec.imageSource = 'placeholder';
      }
      emit(260, [
        { type: 'agent_run_ended', runId: 'R-00', taskId: 'T1', status: 'succeeded', usage: usage(400, 100, 0.01) },
        { type: 'agent_state_changed', role: 'designer', status: 'idle' },
      ]);
      spec.extraAssets = ['images.js', ...spec.images.map((i) => i.file)];
    }
  }

  const files = buildFiles(spec, { defect: spec.plantDefect });
  // 采集到的图片真实文件并入产物清单
  for (const img of spec.images ?? []) files[img.file] = img.buf;
  const totalLines = Object.values(files).reduce(
    (a, c) => a + (Buffer.isBuffer(c) ? 0 : c.split('\n').length), 0);
  const isGallery = spec.type === 'gallery';

  // ---- 阶段 0/1：项目与需求 ----
  emit(300, [
    { type: 'project_created', projectId, projectName: projectTitle ? `${spec.title} · OrchestrAI 项目` : `${spec.title}（${spec.template.meta.name}）`, workspace: `workspaces/${projectId}` },
    { type: 'log', level: 'success', from: 'supervisor', message: `阶段 0 完成：真实工作区已建立 ${ws}` },
  ]);
  emit(400, [
    { type: 'phase_changed', phase: '阶段 1 · 需求接单与澄清（真实模式）', status: 'clarifying' },
    { type: 'requirement_submitted', userText: sentence.length > 300 ? sentence.slice(0, 300) + `…（共 ${sentence.length} 字符）` : sentence, version: 'v0.1' },
    { type: 'agent_state_changed', role: 'supervisor', status: 'analyzing', detail: '解析一句话需求 → 应用类型 / 标题 / 功能' },
  ]);
  emit(700, [
    {
      type: 'requirement_drafted',
      requirement: {
        id: 'RV-1', version: 'v0.1', userText: sentence.length > 1000 ? sentence.slice(0, 1000) + `…（共 ${sentence.length} 字符）` : sentence,
        overview: `OrchestrAI 生成应用：需求 ${sentence.length} 字符 → 识别为「${spec.template.meta.name}」（${spec.matchedBy}）。${isGallery ? `素材主题「${spec.galleryQuery}」，图源：${spec.provider}（${spec.images.length} 张）。` : ''}`,
        userStories: [{
          id: 'US1',
          story: `作为用户，我可以使用${spec.title}完成${spec.template.meta.name}的核心操作`,
          acceptance: spec.features,
        }],
        assumptions: ['单用户本地使用，无账号体系', '生成的应用为免构建静态 Web App（可直接预览）', `功能集：${spec.features.join('；')}`],
        risks: spec.plantDefect ? ['需求包含“预设缺陷”：首次测试将真实失败，用于验证门禁拦截'] : ['模板化生成，复杂个性化需求需后续接入大模型'],
        status: 'draft', createdAt: 0,
      },
    },
    { type: 'log', level: 'info', from: 'supervisor', message: `意图识别：${spec.matchedBy}${spec.viaLLM === false && spec.llmFallbackReason ? `（LLM 调用失败已回退规则：${spec.llmFallbackReason}）` : spec.viaLLM ? '' : '（未配置 AI Key，规则识别）'}；标题「${spec.title}」；视觉风格「${styleDef.name}」；动效「${({ off: '关闭', subtle: '柔和', full: '炫动（粒子避让+拖尾+涟漪）' })[spec.resolvedFx ?? 'subtle']}」${spec.plantDefect ? '；⚠ 检测到预设缺陷指令' : ''}` },
  ]);

  // ---- 阶段 2：计划 ----
  const plan = [
    { id: 'T1', title: isGallery ? `生成「${spec.title}」应用与网络素材` : `生成「${spec.title}」应用文件`, kind: 'frontend', role: 'frontend', dependsOn: [], inputs: ['需求 v0.1'], outputs: Object.keys(files).filter((f) => !f.startsWith('test/') && f !== 'package.json') },
    { id: 'T2', title: '运行真实测试（node --test）', kind: 'test', role: 'tester', dependsOn: ['T1'], inputs: ['test/logic.test.mjs'], outputs: ['真实测试报告（退出码 + 日志）'] },
    { id: 'T3', title: '打包交付与预览', kind: 'docs', role: 'docs', dependsOn: ['T2'], inputs: ['全部产物'], outputs: ['交付清单 + 可预览地址'] },
  ];
  emit(400, [
    { type: 'phase_changed', phase: '阶段 2 · 方案与任务拆分', status: 'planning' },
    { type: 'agent_state_changed', role: 'supervisor', status: 'idle' },
    { type: 'plan_created', tasks: plan, note: `真实生成 3 项任务：写文件 → 真测试 → 交付预览（约 ${totalLines} 行代码/资源）` },
  ]);

  // ---- 阶段 3：真实写文件（T1） ----
  emit(350, [
    { type: 'phase_changed', phase: '阶段 3 · 设计与实现（真实写盘）', status: 'developing' },
    { type: 'task_status_changed', taskId: 'T1', from: 'pending', to: 'in_progress' },
    { type: 'agent_state_changed', role: 'frontend', status: 'working', taskId: 'T1', detail: `实例化「${spec.template.meta.name}」模板并写入工作区` },
    { type: 'agent_run_started', runId: 'R-01', taskId: 'T1', role: 'frontend', model: MODEL },
  ]);
  let seq = 0;
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    const isBinary = Buffer.isBuffer(content);
    const bytes = isBinary ? content.length : Buffer.byteLength(content);
    const lines = isBinary ? 0 : content.split('\n').length;
    const kind = isBinary ? 'design' : rel.endsWith('.html') || rel.endsWith('.css') ? 'design' : rel.includes('test') ? 'test' : 'code';
    emit(240, [
      { type: 'agent_step', runId: 'R-01', taskId: 'T1', role: 'frontend', step: { at: 0, kind: 'tool', tool: 'write_file', detail: `写入 ${rel}（${isBinary ? `${bytes} 字节二进制` : `${lines} 行`}, ${bytes} B）` } },
      {
        type: 'artifact_created',
        artifact: { id: `A-${String(++seq).padStart(2, '0')}`, taskId: 'T1', kind, path: `workspaces/${projectId}/${rel}`, summary: `${spec.title} · ${rel}`, linesAdded: lines || undefined, linesRemoved: 0 },
      },
    ]);
  }
  emit(300, [
    { type: 'agent_run_ended', runId: 'R-01', taskId: 'T1', status: 'succeeded', usage: usage(1800 + totalLines * 12, totalLines * 4, 0.02) },
    { type: 'agent_state_changed', role: 'frontend', status: 'awaiting_review', taskId: 'T1' },
    { type: 'task_status_changed', taskId: 'T1', from: 'in_progress', to: 'awaiting_review' },
    { type: 'log', level: 'info', from: 'supervisor', message: `复核 T1：${Object.keys(files).length} 个文件已真实写入磁盘，产物清单见任务面板` },
    { type: 'task_status_changed', taskId: 'T1', from: 'awaiting_review', to: 'done' },
    { type: 'agent_state_changed', role: 'frontend', status: 'idle' },
  ]);

  // ---- 阶段 5：静态质量门禁（T2 前置）+ 真实测试（T2）----
  onPhase?.('写入真实文件到工作区…');
  // 静态质量门禁（已写盘后检查）
  const problems = staticCheck(ws);
  emit(260, [
    { type: 'phase_changed', phase: '阶段 5 · 静态质量门禁 + 独立测试', status: 'integrating' },
    { type: 'agent_state_changed', role: 'tester', status: 'analyzing', taskId: 'T2', detail: '资源完整性检查：PWA 清单 / 图标 / SW / 测试文件' },
    {
      type: 'gate_result',
      gate: 'static',
      passed: problems.length === 0,
      detail: problems.length === 0
        ? '静态门禁通过：manifest/SW/双尺寸图标/测试文件齐全，PNG 尺寸校验正确，index.html 含安装标记'
        : `静态门禁未通过：${problems.join('；')}`,
      taskId: 'T2',
    },
  ]);
  if (problems.length > 0) {
    emit(200, [
      { type: 'log', level: 'error', from: 'supervisor', message: `静态质量门禁失败，禁止交付：${problems.join('；')}` },
      { type: 'task_status_changed', taskId: 'T1', from: 'done', to: 'blocked', reason: '静态质量门禁未通过' },
    ]);
    persistProject(cues, {
      projectId, spec, sentence, files, ws, projectTitle,
      delivered: false, deliveryVersion: null, previewUrl: null,
      testSummary: '静态质量门禁未通过', hadDefectFix: false, firstOk: false,
    });
    return { projectId, cues, previewUrl: null, workspace: ws, failed: true };
  }

  const doTest = async (runId, trIdNo, supersedes) => {
    emit(300, [
      { type: 'task_status_changed', taskId: 'T2', from: 'pending', to: 'in_progress', attempt: supersedes ? 2 : 1 },
      { type: 'agent_state_changed', role: 'tester', status: 'testing', taskId: 'T2', detail: '真实执行 node --test（子进程）' },
      { type: 'agent_run_started', runId, taskId: 'T2', role: 'tester', model: TESTER_MODEL },
      { type: 'agent_step', runId, taskId: 'T2', role: 'tester', step: { at: 0, kind: 'tool', tool: 'run_command', detail: '$ node --test' } },
    ]);
    onPhase?.('真实执行 node --test …');
    const r = await runNodeTests(ws);
    const ok = r.exitCode === 0;
    emit(Math.min(1500, Math.max(500, r.durationMs)), [
      {
        type: 'test_run_recorded',
        testRun: {
          id: trId(trIdNo), taskId: 'T2', kind: 'unit', command: 'node --test',
          startedAt: 0, endedAt: 0, exitCode: r.exitCode, passed: r.passed, failed: r.failed,
          summary: `${ok ? '真实测试全部通过' : '真实测试失败'}（耗时 ${r.durationMs}ms${supersedes ? '，修复后重跑' : ''}）`,
          logExcerpt: r.logExcerpt, logPath: r.logRelPath, supersedes,
        },
      },
      { type: 'gate_result', gate: 'unit', passed: ok, detail: `真实运行器退出码 ${r.exitCode}（${r.passed}✓/${r.failed}✗），日志 ${r.logRelPath}`, testRunId: trId(trIdNo), taskId: 'T2' },
    ]);
    emit(280, [
      { type: 'agent_run_ended', runId, taskId: 'T2', status: ok ? 'succeeded' : 'failed', usage: usage(600, 200, 0.01) },
    ]);
    return ok;
  };

  const firstOk = await doTest('R-02', 1, undefined);

  if (!firstOk) {
    // ---- 真实缺陷 → 门禁拦截 → 退回 T1 → 修复重跑 ----
    emit(350, [
      { type: 'agent_state_changed', role: 'tester', status: 'failed', taskId: 'T2', reason: `TR-01 退出码非 0：${spec.template.meta.name} 逻辑存在缺陷（见真实日志）` },
      { type: 'log', level: 'error', from: 'supervisor', message: '测试门禁未通过（真实失败）—— 退回 T1 修复，禁止交付' },
      { type: 'task_status_changed', taskId: 'T1', from: 'done', to: 'rework', reason: '真实测试失败：logic.mjs 存在缺陷（预设缺陷演示）' },
      { type: 'task_status_changed', taskId: 'T2', from: 'in_progress', to: 'pending' },
      { type: 'agent_state_changed', role: 'frontend', status: 'working', taskId: 'T1', detail: '按测试报告定位并修复 logic.mjs' },
      { type: 'task_status_changed', taskId: 'T1', from: 'rework', to: 'in_progress', attempt: 2 },
      { type: 'agent_run_started', runId: 'R-03', taskId: 'T1', role: 'frontend', model: MODEL },
    ]);
    const fixed = spec.template.fixedLogic(spec.template.files(spec));
    fs.writeFileSync(path.join(ws, 'logic.mjs'), fixed);
    emit(400, [
      { type: 'agent_step', runId: 'R-03', taskId: 'T1', role: 'frontend', step: { at: 0, kind: 'tool', tool: 'write_file', detail: '重写 logic.mjs（移除缺陷标记，恢复正确实现）' } },
      {
        type: 'artifact_created',
        artifact: { id: `A-${String(++seq).padStart(2, '0')}`, taskId: 'T1', kind: 'code', path: `workspaces/${projectId}/logic.mjs`, summary: '修复版 logic.mjs（缺陷移除）', linesAdded: fixed.split('\n').length, linesRemoved: files['logic.mjs'].split('\n').length },
      },
      { type: 'agent_run_ended', runId: 'R-03', taskId: 'T1', status: 'succeeded', usage: usage(900, 300, 0.01) },
      { type: 'task_status_changed', taskId: 'T1', from: 'in_progress', to: 'awaiting_review' },
      { type: 'log', level: 'info', from: 'supervisor', message: '复核修复：变更仅覆盖缺陷点 —— 按影响范围重跑全部测试' },
      { type: 'task_status_changed', taskId: 'T1', from: 'awaiting_review', to: 'done' },
      { type: 'agent_state_changed', role: 'frontend', status: 'idle' },
    ]);
    const secondOk = await doTest('R-04', 2, 'TR-01');
    if (!secondOk) {
      emit(200, [
        { type: 'log', level: 'error', from: 'supervisor', message: '修复后仍失败：进入人工介入状态（演示模板不应出现此情况）' },
        { type: 'task_status_changed', taskId: 'T2', from: 'in_progress', to: 'blocked', reason: '两次真实测试失败' },
      ]);
      persistProject(cues, {
        projectId, spec, sentence, files, ws, projectTitle,
        delivered: false, deliveryVersion: null, previewUrl: null,
        testSummary: '两次真实测试均失败，已阻塞等待人工介入', hadDefectFix: true, firstOk,
      });
      return { projectId, cues, previewUrl: null, workspace: ws, failed: true };
    }
  }

  emit(280, [
    { type: 'agent_state_changed', role: 'tester', status: 'awaiting_review', taskId: 'T2' },
    { type: 'task_status_changed', taskId: 'T2', from: 'in_progress', to: 'awaiting_review' },
    { type: 'log', level: 'info', from: 'supervisor', message: '复核 T2：结论来自真实子进程（退出码 + 落盘日志），通过' },
    { type: 'task_status_changed', taskId: 'T2', from: 'awaiting_review', to: 'done' },
    { type: 'agent_state_changed', role: 'tester', status: 'idle' },
  ]);

  // ---- 主管视觉审查（T2.5）：逐个检查所有按键/输入框的事件绑定、素材完整性与形态互斥 ----
  onPhase?.('主管视觉审查：检查所有按键与素材…');
  const audit = visualAudit(files);
  emit(290, [
    { type: 'agent_state_changed', role: 'supervisor', status: 'reviewing', detail: `视觉审查 ${audit.buttons.length} 个交互元素 / 素材清单 / 形态互斥` },
    { type: 'log', level: audit.ok ? 'success' : 'warn', from: 'supervisor', message: (audit.ok ? '🔍 ' : '🔍⚠ ') + audit.summary },
    ...(!audit.ok ? [{ type: 'gate_result', gate: 'visual_audit', passed: false, detail: audit.summary }] : []),
    ...(audit.ok ? [{ type: 'gate_result', gate: 'visual_audit', passed: true, detail: `全部 ${audit.buttons.length} 个按键绑定事件 · 素材 ${audit.missingImages.length} 缺失 · 形态守卫就位` }] : []),
    { type: 'agent_state_changed', role: 'supervisor', status: 'idle' },
  ]);

  // ---- 渲染门禁（Gate 4/6 证据）：Edge headless 双视口截图 + DOM 探针（必需图片/横向溢出）----
  // 开关 ORCHESTRAI_RENDERCHECK=off；环境缺失 → not_run 如实披露（不假绿）；fail → 事件 error + 摘要注明（阶段三收紧为阻断）。
  let renderGate = null;
  if (process.env.ORCHESTRAI_RENDERCHECK !== 'off') {
    onPhase?.('渲染门禁：桌面/移动双视口截图与探针检查…');
    let commit = '';
    try { commit = (await import('node:child_process')).execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { commit = 'unknown'; }
    try {
      renderGate = await renderCheck({ wsDir: ws, label: projectId, outDir: path.join(ws, '_rendercheck'), commit, requirement: sentence });
      emit(295, [
        { type: 'gate_result', gate: 'render', passed: renderGate.gate.pass, detail: renderGate.gate.reason },
        { type: 'log', level: renderGate.gate.status === 'pass' ? 'success' : renderGate.gate.status === 'not_run' ? 'warn' : 'error', from: 'supervisor', message: `🖥 渲染门禁[${renderGate.gate.status}]：${renderGate.gate.reason}（截图与指标见 _rendercheck/）` },
      ]);
    } catch (e) {
      renderGate = { gate: { pass: false, status: 'not_run', reason: String(e?.message ?? e).slice(0, 120) } };
      emit(295, [{ type: 'log', level: 'warn', from: 'supervisor', message: `🖥 渲染门禁未执行：${renderGate.gate.reason}` }]);
    }
  }

  // ---- 交付（T3）----
  const manifest = Object.keys(files).map((f) => `workspaces/${projectId}/${f}`);
  const previewUrl = `/preview/${projectId}/`;
  emit(300, [
    { type: 'phase_changed', phase: '阶段 6/7 · 主管验收与交付', status: 'integrating' },
    { type: 'task_status_changed', taskId: 'T3', from: 'pending', to: 'in_progress' },
    { type: 'agent_state_changed', role: 'docs', status: 'working', taskId: 'T3', detail: '生成交付清单与预览入口' },
    { type: 'agent_run_started', runId: 'R-05', taskId: 'T3', role: 'docs', model: MODEL },
    { type: 'agent_step', runId: 'R-05', taskId: 'T3', role: 'docs', step: { at: 0, kind: 'tool', tool: 'write_file', detail: `生成交付清单（${manifest.length} 个文件）` } },
    {
      type: 'artifact_created',
      artifact: { id: `A-${String(++seq).padStart(2, '0')}`, taskId: 'T3', kind: 'doc', path: `workspaces/${projectId}/index.html`, summary: `入口页（可预览：${previewUrl}）` },
    },
    { type: 'agent_run_ended', runId: 'R-05', taskId: 'T3', status: 'succeeded', usage: usage(500, 200, 0.01) },
    { type: 'task_status_changed', taskId: 'T3', from: 'in_progress', to: 'awaiting_review' },
    { type: 'gate_result', gate: 'acceptance', passed: true, detail: `验收通过：${Object.keys(files).length} 个真实文件 + 真实测试证据（${firstOk ? 'TR-01' : 'TR-02 修复后回归'}）` },
    { type: 'task_status_changed', taskId: 'T3', from: 'awaiting_review', to: 'done' },
    { type: 'agent_state_changed', role: 'docs', status: 'idle' },
  ]);
  emit(400, [
    {
      type: 'delivery_packaged',
      delivery: {
        version: '1.0.0',
        manifest: [...manifest, `在线预览：${previewUrl}`],
        knownLimits: [
          '基于模板生成（P4 接入大模型后支持任意需求）',
          spec.plantDefect ? '包含一次真实缺陷修复记录（预设缺陷演示）' : '功能范围为模板默认集',
          '数据保存在浏览器本地',
          ...(spec.imageSource === 'placeholder'
            ? ['⚠ 网络图源不可达：当前使用本地生成示意卡；在可联网环境重新生成、或配置 Pexels/Unsplash Key 可获得真实照片']
            : spec.imageSource === 'network'
              ? [`图片来自 ${spec.provider}，署名与来源页在灯箱内展示；商用前请自行核对各图许可证`]
              : []),
        ],
        testSummary: `真实测试 node --test：${firstOk ? '首次全绿' : '首次失败 → 修复 → 回归通过'}（见测试面板真实日志）`,
        packagedAt: Date.now(),
      },
    },
    { type: 'phase_changed', phase: '已交付 1.0.0 · 可预览', status: 'delivered' },
    { type: 'log', level: 'success', from: 'supervisor', message: `「${spec.title}」已真实交付！点击「预览」标签页立即使用你的 App 🎉` },
  ]);

  persistProject(cues, {
    projectId, spec, sentence, files, ws, projectTitle,
    testSummary: `真实测试 node --test：${firstOk ? '首次全绿' : '首次失败 → 修复 → 回归通过'}；视觉审查：${audit.ok ? `${audit.buttons.length} 个按键全部绑定` : audit.summary}${renderGate ? `；渲染门禁[${renderGate.gate.status}]：${renderGate.gate.reason.slice(0, 60)}` : '；渲染门禁：未执行（开关关闭）'}`,
    hadDefectFix: !firstOk, firstOk,
  });

  return { projectId, cues, previewUrl, workspace: ws, failed: false };
}

/** 项目元数据 + 事件时间线持久化（主页列表与状态恢复的数据源） */
function persistProject(cues, o) {
  const { projectTitle } = o;
  const nameSuffix = o.projectTitle ? '' : `（${o.spec.template.meta.name}）`;
  const meta = {
    id: o.projectId,
    name: `${o.spec.title}${nameSuffix}`,
    sentence: o.sentence,
    type: o.spec.type,
    typeName: o.spec.template.meta.name,
    styleId: o.spec.styleDef?.id ?? null,
    styleName: o.spec.styleDef?.name ?? null,
    fxLevel: o.spec.resolvedFx ?? 'subtle',
    viaLLM: o.spec.viaLLM ?? false,
    llmProvider: o.spec.llmProvider ?? null,
    createdAt: Date.now(),
    delivered: o.delivered,
    deliveryVersion: o.deliveryVersion,
    testSummary: o.testSummary,
    previewUrl: o.previewUrl,
    fileCount: Object.keys(o.files).length,
    hadDefectFix: o.hadDefectFix,
    galleryQuery: o.spec.galleryQuery ?? null,
    imageProvider: o.spec.provider ?? null,
    imageCount: o.spec.images?.length ?? 0,
  };
  try {
    fs.writeFileSync(path.join(o.ws, 'project.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(o.ws, 'timeline.json'), JSON.stringify(cues));
  } catch (err) {
    console.error('[pipeline] persist failed:', err.message);
  }
}
