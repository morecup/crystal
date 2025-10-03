// 将 monaco-editor 的最小化资源复制到打包产物中（frontend/dist/monaco/vs）
// 这样生产环境可以离线加载，不依赖 CDN

const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function main() {
  try {
    const monacoPkg = require.resolve('monaco-editor/package.json', { paths: [process.cwd()] });
    const monacoDir = path.dirname(monacoPkg);
    const vsSrc = path.join(monacoDir, 'min', 'vs');
    const distVs = path.join(process.cwd(), 'dist', 'monaco', 'vs');
    copyDir(vsSrc, distVs);
    console.log(`[copy-monaco] Copied ${vsSrc} -> ${distVs}`);
  } catch (e) {
    console.warn('[copy-monaco] Failed to copy monaco-editor assets:', e && e.message ? e.message : e);
    process.exitCode = 0; // 不阻断构建
  }
}

main();

