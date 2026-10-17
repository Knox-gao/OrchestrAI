/**
 * 真实测试运行器：node --test 子进程执行，采集真实退出码 / 输出 / 耗时，日志落盘。
 * 铁律：退出码是唯一事实；任何包装层的"看起来通过"都不算。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function runNodeTests(workspaceDir) {
  const logsDir = path.join(workspaceDir, '..', '_logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, `${path.basename(workspaceDir)}-test-${Date.now()}.log`);

  const startedAt = Date.now();
  const result = await new Promise((resolve) => {
    // Windows 下 `node --test <dir>` 会把目录当作入口模块，因此用无参形式
    // （默认匹配 cwd 下 **/*.test.mjs，工作区内仅 test/logic.test.mjs）
    const child = spawn('node', ['--test'], {
      cwd: workspaceDir,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ exitCode: 124, out, timedOut: true });
    }, 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, out, timedOut: false });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, out: out + '\n[runner] ' + err.message, timedOut: false });
    });
  });
  const endedAt = Date.now();
  const durationMs = endedAt - startedAt;

  fs.writeFileSync(logFile, `$ node --test\ncwd: ${workspaceDir}\nexit: ${result.exitCode}\nduration: ${durationMs}ms\n\n${result.out}`);

  // node --test spec 报告汇总行（ℹ pass N / ℹ fail N）优先，✔/✖ 计数为兜底
  const passMarks = (result.out.match(/^✔ .*\(.*ms\)/gm) || []).length;
  const failMarks = (result.out.match(/^✖ .*\(.*ms\)/gm) || []).length;
  const sumPass = Number(result.out.match(/^ℹ pass (\d+)/m)?.[1] ?? NaN);
  const sumFail = Number(result.out.match(/^ℹ fail (\d+)/m)?.[1] ?? NaN);
  const tapPass = Number(result.out.match(/^# pass (\d+)/m)?.[1] ?? NaN);
  const tapFail = Number(result.out.match(/^# fail (\d+)/m)?.[1] ?? NaN);
  const passed = [sumPass, tapPass].find((v) => Number.isFinite(v) && v > 0) ?? passMarks;
  const failed = [sumFail, tapFail].find((v) => Number.isFinite(v) && v > 0) ?? (failMarks || (result.exitCode === 0 ? 0 : 1));

  const lines = result.out.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const excerpt = lines.slice(-14);

  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs,
    passed,
    failed,
    logExcerpt: excerpt,
    logRelPath: path.relative(process.cwd(), logFile).replaceAll('\\', '/'),
    logAbsPath: logFile,
  };
}
