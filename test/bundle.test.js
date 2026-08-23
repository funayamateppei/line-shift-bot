/**
 * 配布用の 1 枚（dist/コード.gs）が src/ と一致しているか。
 *
 * ここがずれると、渡した相手だけ古いコードを動かすことになる。
 * 直し方: node tools/bundle.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

console.log('--- 配布用の 1 枚が src/ と一致しているか');
try {
  execFileSync('node', [path.join(ROOT, 'tools', 'bundle.js'), '--check'], { stdio: 'pipe' });
} catch (err) {
  console.error(String(err.stderr || '').trim() || 'dist/コード.gs が古いです');
  process.exit(1);
}

console.log('\nすべて通過');
