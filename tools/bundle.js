/**
 * src/ の .gs を 1 枚にまとめて dist/コード.gs に書き出す。
 *
 * GAS のエディタにはフォルダを置けず、ファイルは 1 枚ずつ手で作ることになる。
 * 渡す相手に 12 回貼らせないための束ね役。
 *
 *   node tools/bundle.js          書き出す
 *   node tools/bundle.js --check  中身がいまの src/ と一致するか見るだけ
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist', 'コード.gs');

const HEAD = [
  '/**',
  ' * 当番Bot ── GAS に貼る用にまとめたもの。',
  ' *',
  ' * このファイルは src/ から機械的に作っています。直接編集しないでください。',
  ' * 直すのは src/ の各ファイル。そのあと node tools/bundle.js を実行します。',
  ' *',
  ' * 貼ったあと、すぐ下の 2 行だけ書き換えてください。',
  ' */',
  ''
].join('\n');

function build() {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
  const parts = files.map(f =>
    '// ==================================================== ' + f + '\n'
    + fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\s*$/, '') + '\n'
  );
  return HEAD + '\n' + parts.join('\n');
}

const made = build();

if (process.argv.indexOf('--check') >= 0) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (now !== made) {
    console.error('dist/コード.gs が src/ より古いです。node tools/bundle.js を実行してください。');
    process.exit(1);
  }
  console.log('dist/コード.gs は最新です');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, made);
  console.log('書き出しました: dist/コード.gs（' + made.split('\n').length + ' 行）');
}
