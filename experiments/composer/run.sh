#!/bin/bash
# 主题 A 先行：Director → Composer → 落盘
set -e
cd "$(dirname "$0")"
node -e "
import('./director.mjs').then(async (d) => {
  const req = '为创意工作室「無境 MIRAGE」做官网：展示品牌世界观、四个代表作品（可用程序化视觉代替照片）、工作方法、联系方式；要有工作室辨识度，访客是品牌方与艺术总监，目标是让对方看完想约聊';
  const { plan, callMeta } = await d.runDirector(req, '無境 MIRAGE 创意工作室');
  console.log('Director ✓', callMeta.ms + 'ms 重试' + (callMeta.tries - 1), '| 幕次:', plan.scenes.map(s => s.id + ':' + s.capability).join(' → '));
  console.log('转场:', plan.transitions.map(t => t.after + '→' + t.mechanism).join(', '));
  console.log('概念:', plan.concept.claim.slice(0, 60));
  require('fs').writeFileSync('plans/mirage-plan.json', JSON.stringify({ plan, callMeta }, null, 1));
})" --input-type=module 2>/dev/null || node --experimental-default-type=module -e "
import('./director.mjs').then(async (d) => {
  const req = '为创意工作室「無境 MIRAGE」做官网：展示品牌世界观、四个代表作品（可用程序化视觉代替照片）、工作方法、联系方式；要有工作室辨识度，访客是品牌方与艺术总监，目标是让对方看完想约聊';
  const { plan, callMeta } = await d.runDirector(req, '無境 MIRAGE 创意工作室');
  console.log('Director ✓', callMeta.ms + 'ms 重试' + (callMeta.tries - 1), '| 幕次:', plan.scenes.map(s => s.id + ':' + s.capability).join(' → '));
  console.log('转场:', plan.transitions.map(t => t.after + '→' + t.mechanism).join(', '));
  console.log('概念:', plan.concept.claim.slice(0, 60));
  require('fs').writeFileSync('plans/mirage-plan.json', JSON.stringify({ plan, callMeta }, null, 1));
})"
mkdir -p plans
