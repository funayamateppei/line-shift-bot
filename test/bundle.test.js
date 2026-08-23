/**
 * dist/コード.gs が src/ と一致しているか。
 *
 * ずれたまま GAS に貼ると、手元と動いているものが食い違う。
 * dist は Git に入れていないので、まだ作っていない場合は何も言わない。
 * 直し方: node tools/bundle.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

console.log('--- GAS に貼る 1 枚が src/ と一致しているか（作ってあれば）');
try {
  execFileSync('node', [path.join(ROOT, 'tools', 'bundle.js'), '--check'], { stdio: 'pipe' });
} catch (err) {
  console.error(String(err.stderr || '').trim() || 'dist/コード.gs が古いです');
  process.exit(1);
}

console.log('\nすべて通過');
