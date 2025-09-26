const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function copyFile(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  await ensureDir(destDir);
  await fsp.copyFile(src, dest);
}

async function copyGlob(pattern, baseDir, destDir) {
  // Minimal glob: only supports '*.ext' in a single directory (as required here)
  const dir = path.resolve(baseDir, path.dirname(pattern));
  const suffix = path.basename(pattern).replace('*', '');
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const name = entry.name;
      if (suffix === '' || name.endsWith(suffix)) {
        await copyFile(path.join(dir, name), destDir);
      }
    }
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const srcDb = path.join(root, 'src', 'database');
  const srcMigrations = path.join(srcDb, 'migrations');

  // Keep output paths identical to original script
  const distDb = path.join(root, 'dist', 'main', 'src', 'database');
  const distMigrations = path.join(distDb, 'migrations');

  // Copy *.sql from src/database -> dist/main/src/database
  if (fs.existsSync(srcDb)) {
    await copyGlob('*.sql', srcDb, distDb);
  }

  // Copy *.sql from src/database/migrations -> dist/main/src/database/migrations
  if (fs.existsSync(srcMigrations)) {
    await copyGlob('*.sql', srcMigrations, distMigrations);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

