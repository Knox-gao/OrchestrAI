/**
 * 需求文档解析：.docx / .txt / .md → 纯文本。
 * docx = ZIP 包内的 word/document.xml（w:t 文本节点，w:p 段落换行）。
 */
import { readEntry } from './zip.mjs';

export const SUPPORTED_DOC_TYPES = ['docx', 'txt', 'md', 'markdown'];

export function isSupported(filename) {
  const ext = String(filename ?? '').toLowerCase().split('.').pop();
  return SUPPORTED_DOC_TYPES.includes(ext);
}

export function extractText(filename, buf) {
  const ext = String(filename ?? '').toLowerCase().split('.').pop();
  switch (ext) {
    case 'txt':
    case 'md':
    case 'markdown': {
      let text = buf.toString('utf-8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
      return text.trim();
    }
    case 'docx': {
      const xml = readEntry(buf, 'word/document.xml').toString('utf-8');
      const text = xml
        .replace(/<w:p\b[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<w:tab\b[^>]*\/>/g, '\t')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (!text) throw new Error('docx 中未提取到文本（可能是空文档）');
      return text;
    }
    default:
      throw new Error(`不支持的格式：.${ext}（支持 docx / txt / md）`);
  }
}
