/**
 * 静态质量门禁：交付前的资源完整性检查（真实文件系统检查，非形式校验）。
 * 由流水线（gate: static）与自检脚本共用。
 */
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED = [
  'index.html', 'style.css', 'app.mjs', 'logic.mjs',
  'manifest.webmanifest', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  'test/logic.test.mjs', 'package.json',
];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export function staticCheck(dir) {
  const problems = [];
  for (const rel of REQUIRED) {
    if (!fs.existsSync(path.join(dir, rel))) problems.push(`缺少文件：${rel}`);
  }
  if (problems.length) return problems;

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf-8');
  for (const mark of ['manifest.webmanifest', 'serviceWorker', 'theme-color', 'viewport']) {
    if (!html.includes(mark)) problems.push(`index.html 缺少标记：${mark}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf-8'));
    if (manifest.display !== 'standalone') problems.push('manifest.display 应为 standalone（可安装性）');
    if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) problems.push('manifest.icons 至少 2 个尺寸');
    if (!manifest.name || !manifest.start_url) problems.push('manifest 缺少 name/start_url');
  } catch {
    problems.push('manifest.webmanifest 不是合法 JSON');
  }

  for (const icon of ['icons/icon-192.png', 'icons/icon-512.png']) {
    const buf = fs.readFileSync(path.join(dir, icon));
    if (!buf.subarray(0, 4).equals(PNG_MAGIC)) problems.push(`${icon} 不是合法 PNG`);
    const size = Number(icon.match(/icon-(\d+)/)?.[1] ?? 0);
    if (size && buf.readUInt32BE(16) !== size) problems.push(`${icon} 尺寸应为 ${size}x${size}`);
  }

  const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf-8');
  if (!sw.includes('addAll') || !sw.includes('fetch')) problems.push('sw.js 缺少预缓存或 fetch 处理');

  return problems;
}
