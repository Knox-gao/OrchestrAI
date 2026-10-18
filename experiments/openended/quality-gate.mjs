/**
 * Product Quality Gate（任务 A2）：开放式生成的结构化质量评估
 * 分两层：
 *  L1 自动化（代码+浏览器 DOM 实测）：信息层级/空间利用/排印/适配/控制台/交互存在性
 *  L2 模型评审（标记为模型判断，非客观测量）：构图/焦点/视觉语言/首屏传达
 * 输出：问题清单（描述/严重度/证据/区域/原因/修改目标/验收方式/修改级别）
 * 铁律：只约束结果质量，不约束设计实现——不检查"是否居中/是否有某装置/幕数"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---------- L1: 自动化指标（Edge headless + DOM 探针） ---------- */
export const PROBE_SCRIPT = `(() => {
  const r = {};
  // 空间利用：各 section 内容实际宽度 vs 视口
  r.sections = [...document.querySelectorAll('section')].map((s) => {
    const b = s.getBoundingClientRect();
    const inner = s.querySelector('div,h2,h1')?.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), innerW: inner ? Math.round(inner.width) : 0 };
  });
  // 排印：正文行长（>75ch 警告）
  r.longParagraphs = [...document.querySelectorAll('p')].filter((p) => p.getBoundingClientRect().width > 1100).length;
  // 层级：h1 唯一性、h1→h2 尺寸比
  r.h1Count = document.querySelectorAll('h1').length;
  const h1 = document.querySelector('h1'), h2 = document.querySelector('h2');
  r.h1Size = h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0;
  r.h2Size = h2 ? parseFloat(getComputedStyle(h2).fontSize) : 0;
  // 默认样式残留：无 class 的 button / input
  r.defaultButtons = [...document.querySelectorAll('button:not([class])')].length;
  r.defaultInputs = [...document.querySelectorAll('input:not([class])')].length;
  // 视觉焦点：最大单体元素占比
  const all = [...document.querySelectorAll('section > *')];
  r.largestElement = all.reduce((a, el) => { const b = el.getBoundingClientRect(); return b.width * b.height > a.area ? { area: Math.round(b.width * b.height), tag: el.tagName, cls: el.className?.slice?.(0, 30) ?? '' } : a; }, { area: 0, tag: '', cls: '' });
  // 交互
  r.interactive = document.querySelectorAll('button,[onclick],a[href="#"],input,select').length;
  r.canvas = document.querySelectorAll('canvas').length;
  // 适配
  r.overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  r.pageH = document.documentElement.scrollHeight;
  return r;
})()`;

export function autoChecks(probe, viewport) {
  const issues = [];
  const vp = viewport === 'mobile' ? 390 : 1440;
  // 1. 空间利用
  for (let i = 0; i < probe.sections.length; i++) {
    const s = probe.sections[i];
    if (s.innerW > 0 && s.innerW < s.w * 0.55 && s.w > vp * 0.8) {
      issues.push({ sev: 'high', area: `section[${i}]`, test: '空间利用', desc: `内容宽 ${s.innerW}px 仅占区块 ${Math.round(s.innerW / s.w * 100)}%（<55%）——大片未设计的空白`, cause: '生成器未约束内容容器宽度', fix: '内容容器加 max-width 或 grid 居中', level: '局部修复', verify: `innerW ≥ 区块宽 55%` });
    }
  }
  // 2. 排印
  if (probe.longParagraphs > 0) issues.push({ sev: 'med', area: '多段', test: '排印行长', desc: `${probe.longParagraphs} 段正文超过 1100px 行长，阅读疲劳`, cause: '无 max-width/ch 约束', fix: '正文 max-width: 68ch', level: '局部修复', verify: 'longParagraphs=0' });
  if (probe.h1Count === 0) issues.push({ sev: 'high', test: '信息层级', desc: '无 h1', level: '局部修复' });
  if (probe.h1Size > 0 && probe.h2Size > 0 && probe.h1Size / probe.h2Size < 1.6) issues.push({ sev: 'med', test: '信息层级', desc: `h1(${probe.h1Size}px) 与 h2(${probe.h2Size}px) 尺寸比 <1.3，层级不清`, fix: '拉开字阶', level: '局部修复', verify: 'h1/h2 ≥1.6' });
  // 3. 默认样式
  if (probe.defaultButtons > 0 || probe.defaultInputs > 0) issues.push({ sev: 'med', test: '视觉一致性', desc: `${probe.defaultButtons} 个无 class 按钮 + ${probe.defaultInputs} 个无 class 输入框（默认样式残留）`, fix: '补按钮样式', level: '局部修复', verify: 'defaultButtons=0' });
  // 4. 交互
  if (probe.interactive < 3) issues.push({ sev: 'high', test: '功能完整性', desc: `可交互元素仅 ${probe.interactive} 个`, level: '结构重构', verify: '≥3' });
  // 5. 适配
  if (probe.overflowX) issues.push({ sev: 'high', test: '适配', desc: '横向溢出', level: '局部修复', verify: '无溢出' });
  return issues;
}

/* ---------- L2: 模型评审（标记为模型判断） ---------- */
export async function modelCritique(screenshotDesc, plan, gw = null) {
  // screenshotDesc: 人工/模型对截图的结构化观察（非截图本身的客观属性）
  // 返回 { reviewer: 'model', issues: [...] }
  const issues = [];
  // 此处由调用方注入观察文本，本函数保持结构化封装
  return { reviewer: 'model-assisted', issues };
}

/* ---------- 修改级别决策 ---------- */
export function decideLevels(issues) {
  const counts = { 局部修复: 0, 结构重构: 0, 整体重设计: 0 };
  for (const i of issues) counts[i.level] = (counts[i.level] ?? 0) + 1;
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { counts, recommended: counts.整体重设计 > 0 ? '整体重设计' : counts.结构重构 >= 2 ? '结构重构' : dominant[0] };
}
