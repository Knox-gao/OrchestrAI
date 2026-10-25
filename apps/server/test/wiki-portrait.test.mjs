/**
 * Wikipedia 角色肖像的回归测试（准确性优先的取图路径）。
 *
 * 背景：用户反馈「照片准确性不够」。搜索路径对漫威角色会拿到：
 *   - 漫展 cosplay（"Doctor Strange Marvel" → Pat Loika 的 cosplay 合影）
 *   - 演员生活照（黑豹 → Chadwick Boseman 出席漫展）
 *   - 完全无关物（黑豹 → 古希腊陶罐、蜘蛛侠 → 出租车旁玩偶）
 *
 * Wikipedia 条目正文里的图天然属于该角色本身，且文件名通常含角色名，
 * 因此准确率高得多。这组测试锁住筛选规则（不测网络）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../wiki-portrait.mjs', import.meta.url), 'utf8');

// 从源码里取出纯函数做测试（不触发网络）
function loadPure(fnName) {
  const i = SRC.indexOf(`function ${fnName}(`);
  if (i < 0) throw new Error(`${fnName} not found`);
  // 找到函数体结束的花括号
  let depth = 0;
  let j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k += 1) {
    if (SRC[k] === '{') depth += 1;
    else if (SRC[k] === '}') {
      depth -= 1;
      if (depth === 0) { j = k; break; }
    }
  }
  const body = SRC.slice(i, j + 1);
  // 依赖的常量
  const consts = ['CHARACTER_HINT', 'NON_CHARACTER_OBJECT'];
  const prelude = consts
    .map((c) => {
      const m = SRC.match(new RegExp(`const ${c} = [^;]+;`));
      return m ? m[0] : '';
    })
    .join('\n');
  return new Function(`${prelude}\n${body}\nreturn ${fnName};`)();
}

const fileNameScore = loadPure('fileNameScore');

test('文件名以角色名开头 → 最高分', () => {
  assert.equal(fileNameScore('Gamora-cover.jpg', 'Gamora'), 1.0);
  assert.equal(fileNameScore('DoctorStrange-177.jpg', 'Doctor Strange') < 1, true);
});

test('文件名含角色名且带角色图线索 → 高分', () => {
  assert.equal(fileNameScore('Black Panther (TChalla).png', 'Black Panther'), 1.0);
  assert.ok(fileNameScore('Web of Spider-Man Vol 1 129-1.png', 'Spider-Man') >= 0.9);
});

test('演员照片得 0 分（文件名不含角色名）', () => {
  assert.equal(fileNameScore('Chadwick Boseman by Gage Skidmore July 2017 (cropped).jpg', 'Black Panther'), 0);
  // 文件名含角色名所以拿到中等分，但 'as <Name>' 形态由 ACTOR_FILE 在更早一步剔除。
  assert.ok(fileNameScore('Zoe Saldana as Gamora.jpeg', 'Gamora') < 1, '不得拿到最高分');
  assert.equal(fileNameScore('Robert Downey Jr 2014 Comic Con (cropped).jpg', 'Iron Man'), 0);
});

test('完全无关的图得 0 分', () => {
  assert.equal(fileNameScore('Ancient Greek pottery.jpg', 'Black Panther'), 0);
  assert.equal(fileNameScore('ST1.PNG', 'Star-Lord'), 0, '文件名无角色名 → 不可信，应回退搜索');
});

test('演员照与状态图有专门的黑名单', () => {
  assert.match(SRC, /const ACTOR_FILE/, '应有演员照判定');
  assert.match(SRC, /const NON_CONTENT_FILE/, '应有非内容图判定');
  // 演员照正则必须能命中 "as Gamora" 这种形态
  const m = SRC.match(/const ACTOR_FILE = (\/[^/]+\/[a-z]*);/);
  assert.ok(m, 'ACTOR_FILE 正则应可解析');
  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')), m[1].slice(m[1].lastIndexOf('/') + 1));
  assert.equal(re.test('Zoe Saldana as Gamora.jpeg'), true);
  assert.equal(re.test('Gamora-cover.jpg'), false, '角色图不得被演员规则误伤');
});

test('神话/通用词会跳到漫威角色条目', () => {
  assert.match(SRC, /MYTH_OR_COMM_COMMON|MYTH_OR_COMMON/, '应有神话词表');
  const m = SRC.match(/const MYTH_OR_COMMON = new Set\(\[([^\]]+)\]\);/);
  assert.ok(m, 'MYTH_OR_COMMON 应可解析');
  const words = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  // 实测 Thor 会落到北欧神话条目，必须重定向
  assert.ok(words.includes('thor'), 'thor 必须在神话词表里');
});

test('有请求节流，避免 Wikipedia 限流返回纯文本', () => {
  assert.match(SRC, /WIKI_MIN_INTERVAL_MS/);
  assert.match(SRC, /You are making too many requests|非 JSON 响应/);
});

test('空标题不发起请求', async () => {
  const { wikipediaCharacterPortraitCandidates } = await import('../wiki-portrait.mjs');
  assert.deepEqual(await wikipediaCharacterPortraitCandidates('', 2), []);
  assert.deepEqual(await wikipediaCharacterPortraitCandidates(null, 2), []);
});

// ---------- 物件误配防护（本轮实测 bug） ----------

test('明显是物件的文件名判 0：黑寡妇条目里曾混进手机照片', () => {
  assert.equal(fileNameScore('Black Widow phone.jpg', 'Black Widow'), 0);
  assert.equal(fileNameScore('BlackBerry Bold 9000.jpg', 'Black Widow'), 0, '只命中部分词也判 0');
  assert.equal(fileNameScore('Iron Man ores mining.jpg', 'Iron Man'), 0);
});

test('只命中部分角色名词 → 判 0，宁可回退搜索', () => {
  assert.equal(fileNameScore('BlackBerry Bold 9000.jpg', 'Black Widow'), 0);
});

test('正向证据要求：角色图线索或角色名后紧跟分隔符', () => {
  assert.equal(fileNameScore('Gamora-cover.jpg', 'Gamora'), 1.0, '角色名+分隔符');
  assert.equal(fileNameScore('Iron Man (circa 2018).png', 'Iron Man'), 1.0, '角色名+分隔符');
  assert.equal(fileNameScore('Web of Spider-Man Vol 1 129-1.png', 'Spider-Man'), 0.9, '含角色图线索');
  // 既不以角色名开头、也无角色图线索 → 不可信
  assert.equal(fileNameScore('Some Random Photo of Gamora fans.jpg', 'Gamora'), 0);
});
