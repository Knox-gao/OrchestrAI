/**
 * 打包工程生成：
 *  - exe → Electron 工程（用户机器上 npm i && npm run dist 产出 Windows .exe / NSIS 安装包）
 *  - apk → TWA 工程（bubblewrap 产出 .apk）+ PWA 直接安装说明（Android Chrome 生成 WebAPK）
 * 全部为真实可构建的工程文件，工作室不伪造编译产物。
 */
import { collectDir } from './zip.mjs';

function electronProject(meta) {
  const appId = `com.agentstudio.${meta.id.toLowerCase()}`;
  const main = `// ${meta.name} · Electron 桌面外壳
const { app, BrowserWindow, shell } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 520,
    height: 860,
    autoHideMenuBar: true,
    backgroundColor: '#0f1226',
    title: ${JSON.stringify(meta.name)},
    webPreferences: { contextIsolation: true },
  });
  // 外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;
  const pkg = {
    name: `app-${meta.id.toLowerCase()}`,
    productName: meta.name,
    version: meta.deliveryVersion ?? '1.0.0',
    private: true,
    main: 'main.js',
    scripts: {
      start: 'electron .',
      dist: 'electron-builder --win',
    },
    devDependencies: { electron: '^33.0.0', 'electron-builder': '^25.0.0' },
    build: {
      appId,
      productName: meta.name,
      directories: { output: 'dist' },
      files: ['main.js', '../app/**/*'],
      win: { target: ['nsis', 'portable'] },
    },
  };
  return { 'main.js': main, 'package.json': JSON.stringify(pkg, null, 2) };
}

function twaProject(meta) {
  return {
    'assetlinks.json': JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: `com.agentstudio.${meta.id.toLowerCase()}`,
        sha256_cert_fingerprints: ['<<YOUR_UPLOAD_KEY_SHA256>>'],
      },
    }], null, 2),
  };
}

function readmeFor(fmt, meta) {
  if (fmt === 'exe') {
    return `# ${meta.name} · Windows 桌面版（.exe）构建指南

本 ZIP 是一个可直接构建出 .exe 的 Electron 工程。

\`\`\`
1. 解压后进入 electron/ 目录
2. npm install          # 首次需联网下载 Electron（约 100MB）
3. npm run start        # 本地预览桌面窗口
4. npm run dist         # 产出 dist/*.exe（NSIS 安装包 + portable 便携版）
\`\`\`

- 应用源码位于 app/（由 Agent Studio 真实生成，测试通过：${meta.testSummary}）
- 如需更换图标：替换 app/icons/icon-512.png 后重新 dist
`;
  }
  if (fmt === 'apk') {
    return `# ${meta.name} · Android 版（.apk）两条路径

## 路径 A（推荐 · 零工具链，产出真 WebAPK）
1. 把 app/ 目录托管到任意 HTTPS 地址（GitHub Pages / Vercel / 内网穿透均可）
2. Android Chrome 打开该地址 → 菜单「添加到主屏幕/安装应用」
3. Chrome 会下载并安装一个真正的 WebAPK（系统级 .apk，离线可用，有独立图标）

## 路径 B（产出独立 .apk 工程文件）
1. 托管 app/ 到 HTTPS（同上）
2. 安装 Node 后：npm i -g @bubblewrap/cli
3. bubblewrap init --manifest https://你的域名/manifest.webmanifest
4. bubblewrap build → app-release-signed.apk（可上架/直接安装）
5. 上架 Google Play 需在托管目录放 .well-known/assetlinks.json（模板见 twa/ 目录，替换你的上传证书 SHA256）
`;
  }
  return `# ${meta.name} · 完整导出

- app/ —— 应用全部源码（PWA：可离线、可安装）
- 本地使用：进入 app/ 目录执行 npx serve 或 python -m http.server，浏览器打开后可「安装为应用」
- 测试：cd app && node --test（${meta.testSummary}）
`;
}

/**
 * 组装导出 entries
 * @param {'zip'|'exe'|'apk'} fmt
 */
export function buildExport(fmt, meta, workspaceDir) {
  const entries = [];
  const appPrefix = fmt === 'zip' ? '' : 'app/';
  for (const [rel, buf] of collectDir(workspaceDir)) {
    entries.push([appPrefix + rel, buf]);
  }
  if (fmt === 'exe') {
    for (const [rel, content] of Object.entries(electronProject(meta))) {
      entries.push([`electron/${rel}`, Buffer.from(content)]);
    }
  }
  if (fmt === 'apk') {
    for (const [rel, content] of Object.entries(twaProject(meta))) {
      entries.push([`twa/${rel}`, Buffer.from(content)]);
    }
  }
  entries.push(['README.md', Buffer.from(readmeFor(fmt, meta))]);
  return entries;
}
