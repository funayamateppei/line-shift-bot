/**
 * .gs ファイルを Node で読み込んで動かすための土台。
 * Google Apps Script の API のうち、テストで触れるものだけを偽物で用意する。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ふだんは src/。ミューテーションのときだけ、使い捨てのコピーを指す
const SRC = process.env.GS_SRC || path.join(__dirname, '..', 'src');

function fakeUtilities() {
  const pad = (n, w) => String(n).padStart(w, '0');
  return {
    formatDate(date, tz, fmt) {
      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      const d = date.getDate();
      const hh = date.getHours();
      const mm = date.getMinutes();
      return fmt
        .replace('yyyy', pad(y, 4))
        .replace('MM', pad(m, 2))
        .replace('dd', pad(d, 2))
        .replace('HH', pad(hh, 2))
        .replace('mm', pad(mm, 2));
    }
  };
}

/** 指定したファイルだけを読み込んだ箱を返す */
function load(files, extra) {
  const sandbox = Object.assign({
    console,
    Utilities: fakeUtilities(),
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    isNaN,
    parseInt,
    parseFloat,
    Infinity
  }, extra || {});

  const context = vm.createContext(sandbox);
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    vm.runInContext(code, context, { filename: f });
  }
  return context;
}

/** 決まった順番で数を返す乱数。テストを再現できるようにする */
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

module.exports = { load, seeded, SRC };
