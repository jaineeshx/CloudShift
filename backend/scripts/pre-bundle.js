/**
 * pre-bundle.js — run before CDK deploy
 * Creates dist/ packages for each Lambda: function code + shared utils + node_modules
 */
const fs = require('fs');
const path = require('path');

const FUNCTIONS = ['upload', 'assess', 'plan', 'migrate-start', 'migrate-status', 'dashboard'];
const BACKEND = path.join(__dirname, '..');
const DIST = path.join(BACKEND, 'dist');

// Clean dist
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

for (const fn of FUNCTIONS) {
  const srcDir = path.join(BACKEND, 'functions', fn);
  const destDir = path.join(DIST, fn);
  const sharedDest = path.join(destDir, 'shared');

  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(sharedDest, { recursive: true });

  // Copy function index.js
  fs.copyFileSync(path.join(srcDir, 'index.js'), path.join(destDir, 'index.js'));

  // Copy shared/utils.js — functions require('../../shared/utils') which resolves differently
  // Rewrite the require path to './shared/utils'
  const sharedSrc = path.join(BACKEND, 'shared', 'utils.js');
  fs.copyFileSync(sharedSrc, path.join(sharedDest, 'utils.js'));

  // Patch the require path in index.js
  let code = fs.readFileSync(path.join(destDir, 'index.js'), 'utf8');
  code = code.replace(/require\(['"]\.\.\/\.\.\/shared\/utils['"]\)/g, "require('./shared/utils')");
  fs.writeFileSync(path.join(destDir, 'index.js'), code);

  // Copy node_modules (symlink-friendly copy)
  const nmSrc = path.join(BACKEND, 'node_modules');
  const nmDest = path.join(destDir, 'node_modules');
  copyDir(nmSrc, nmDest);

  console.log(`✅ Bundled: ${fn}`);
}

console.log('\n🚀 All Lambda bundles ready in backend/dist/\n');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      try { const target = fs.readlinkSync(s); fs.symlinkSync(target, d); } catch {}
    } else if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
