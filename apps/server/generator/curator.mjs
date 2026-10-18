/**
 * 图片策展器（阶段二任务 C）：候选四维分离评分 + 项目级视觉协调 + 图位(slot)解析
 * 四维各自保留、可解释：
 *   tech    解码/尺寸/比例 容差（客观）
 *   content 与图位目标的语义匹配（完整词命中=强，片段=弱，无=失配）
 *   visual  与项目 Profile 的亮度/饱和/主色偏离 + 媒介类别（辅助信号——颜色相近≠风格一致，仅作排序参考）
 *   source  来源可追溯（作者/许可/来源页）
 * 诚实约定：默认权重与离群阈值是**工程初值**，须经真实案例（任务 D 漫威）验证后调参，不宣称客观最优。
 */
import { imageFeaturesFromFile, imageFeaturesFromBuf, mediaClass } from '../imaging.mjs';

export const DEFAULT_WEIGHTS = { tech: 0.35, content: 0.4, visual: 0.15, source: 0.1 };

const tokenHit = (hay, t) => {
  const h = String(hay ?? '').toLowerCase();
  const tk = String(t ?? '').toLowerCase();
  if (!tk) return 0;
  if (h.includes(tk)) return tk.length >= 2 ? 2 : 1; // 完整命中
  for (let len = Math.min(tk.length, 6); len >= 2; len--) {
    for (let i = 0; i + len <= tk.length; i++) {
      if (h.includes(tk.slice(i, i + len))) return 1; // 片段弱命中
    }
  }
  return 0;
};

/**
 * 单候选评分（候选须已下载到本地文件）。
 * @param {{file:string, title:string, author?:string, license?:string, page?:string}} cand
 * @param {{targets:string[], aspect?:number, profile?:{brightness?:number, saturation?:number, media?:string}}} slot
 */
export function scoreCandidate(cand, slot, weights = DEFAULT_WEIGHTS) {
  const dims = {};
  const reasons = [];
  // 1) tech
  try {
    const f = cand.buf ? imageFeaturesFromBuf(cand.buf) : imageFeaturesFromFile(cand.file);
    const aspectReq = slot.aspect;
    const aspectOk = !aspectReq || Math.abs(f.aspect - aspectReq) / aspectReq < 0.6;
    const sizeOk = f.width >= 360 && f.height >= 240;
    dims.tech = { score: sizeOk && aspectOk ? 1 : sizeOk ? 0.6 : 0, width: f.width, height: f.height, aspect: f.aspect, bytes: f.bytes };
    reasons.push(`tech: ${f.width}x${f.height}${aspectOk ? '' : '（比例偏差大）'}${sizeOk ? '' : '（尺寸不足）'}`);
    // 3) visual（媒介辅助 + 若有项目画像则算亮度/饱和偏离）
    const media = mediaClass(cand.author, cand.page);
    let vScore = 0.6; // 无画像时的中性分
    const vNotes = [`媒介=${media}`];
    if (slot.profile) {
      const db = Math.abs(f.brightness - (slot.profile.brightness ?? f.brightness)) / 255;
      const ds = Math.abs(f.saturation - (slot.profile.saturation ?? f.saturation));
      const mediaOk = !slot.profile.media || slot.profile.media === media;
      vScore = Math.max(0, 1 - db * 1.2 - ds * 1.2) * (mediaOk ? 1 : 0.75);
      vNotes.push(`亮度偏离${(db * 100).toFixed(0)}% 饱和偏离${(ds * 100).toFixed(0)}%${mediaOk ? '' : `（媒介与画像不符）`}`);
    }
    dims.visual = { score: +vScore.toFixed(2), brightness: f.brightness, saturation: f.saturation, dominant: f.dominant[0]?.hex ?? '', media, notes: vNotes.join(' · ') };
    reasons.push(`visual: ${vNotes.join(' · ')}`);
  } catch (e) {
    dims.tech = { score: 0, error: String(e.message).slice(0, 60) };
    reasons.push(`tech: 解码失败 ${dims.tech.error}`);
    dims.visual = { score: 0, notes: '未解码，无特征' };
  }
  // 2) content
  const hay = `${cand.title} ${cand.page}`;
  const hitLevel = Math.max(0, ...(slot.targets ?? []).map((t) => tokenHit(hay, t)));
  dims.content = { score: hitLevel === 2 ? 1 : hitLevel === 1 ? 0.45 : 0, level: ['miss', 'weak', 'strong'][hitLevel] };
  reasons.push(`content: ${dims.content.level}（${(slot.targets ?? []).join('/')} vs "${String(cand.title).slice(0, 30)}"）`);
  // 4) source
  const hasLicense = Boolean(cand.license && cand.license !== '生成内容');
  const hasAuthor = Boolean(cand.author);
  const hasPage = Boolean(cand.page && /^https?:/.test(cand.page));
  dims.source = { score: (hasLicense ? 0.5 : 0) + (hasAuthor ? 0.3 : 0) + (hasPage ? 0.2 : 0), license: cand.license ?? '', licenseState: hasLicense ? 'ok' : 'unconfirmed' };
  reasons.push(`source: 许可${hasLicense ? '可溯' : '待确认'}/${hasAuthor ? '有署名' : '无署名'}/${hasPage ? '有来源页' : '无来源页'}`);

  const total = +(dims.tech.score * weights.tech + dims.content.score * weights.content
    + dims.visual.score * weights.visual + dims.source.score * weights.source).toFixed(3);
  return { dims, total, reasons, licenseState: dims.source.licenseState };
}

/** 候选集排序：返回按总分降序 + 逐个评分记录（不下载的候选标 skipped） */
export function rankCandidates(cands, slot, weights = DEFAULT_WEIGHTS) {
  const scored = (cands ?? []).map((c) => scoreCandidate(c, slot, weights));
  const order = scored.map((s, i) => i).sort((a, b) => scored[b].total - scored[a].total);
  return { ranked: order.map((i) => ({ cand: cands[i], ...scored[i] })), all: scored };
}

/** 项目视觉画像：从一组已选图特征聚合（亮度/饱和中位数 + 主导媒介） */
export function profileFromFeatures(list) {
  const ok = (list ?? []).filter((x) => x && x.brightness !== undefined);
  if (!ok.length) return null;
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const mediaCount = {};
  for (const x of ok) mediaCount[x.media ?? 'unknown'] = (mediaCount[x.media ?? 'unknown'] ?? 0) + 1;
  const media = Object.entries(mediaCount).sort((a, b) => b[1] - a[1])[0][0];
  return { brightness: median(ok.map((x) => x.brightness)), saturation: median(ok.map((x) => x.saturation)), media, sample: ok.length };
}
