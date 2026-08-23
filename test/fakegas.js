/**
 * Google Apps Script の偽物。テストで触る範囲だけを用意する。
 * スプレッドシートはメモリ上の 2 次元配列。LINE への送信は記録するだけ。
 */

function makeSheet(name, id) {
  const data = [];

  const at = (r, c) => {
    while (data.length < r) data.push([]);
    const row = data[r - 1];
    while (row.length < c) row.push('');
    return row;
  };

  const lastRow = () => {
    let last = 0;
    data.forEach((row, i) => {
      if (row.some(v => v !== '' && v !== null && v !== undefined)) last = i + 1;
    });
    return last;
  };

  const lastCol = () => {
    let last = 0;
    data.forEach(row => {
      for (let c = row.length; c > 0; c--) {
        if (row[c - 1] !== '' && row[c - 1] !== null && row[c - 1] !== undefined) {
          if (c > last) last = c;
          break;
        }
      }
    });
    return last;
  };

  function makeRange(r, c, nr, nc) {
    const range = {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) {
            const src = data[r - 1 + i];
            row.push(src && src[c - 1 + j] !== undefined ? src[c - 1 + j] : '');
          }
          out.push(row);
        }
        return out;
      },
      setValues(values) {
        for (let i = 0; i < values.length; i++) {
          const row = at(r + i, c + values[i].length - 1);
          for (let j = 0; j < values[i].length; j++) row[c - 1 + j] = values[i][j];
        }
        return range;
      },
      setValue(v) {
        at(r, c)[c - 1] = v;
        return range;
      },
      getRow() { return r; },
      getColumn() { return c; }
    };
    // 見た目に関わるものは何もしない
    // 本物の insertCheckboxes はセルに FALSE を書き込む。
    // つまり内容ができるので getLastRow が動く。ここを甘くすると実機で壊れる。
    range.insertCheckboxes = () => {
      for (let i = 0; i < nr; i++) {
        const row = at(r + i, c + nc - 1);
        for (let j = 0; j < nc; j++) {
          if (row[c - 1 + j] === '' || row[c - 1 + j] === undefined) row[c - 1 + j] = false;
        }
      }
      return range;
    };
    ['setBackground', 'setFontColor', 'setFontWeight', 'setFontSize', 'setFontFamily',
      'setHorizontalAlignment', 'setVerticalAlignment', 'setNumberFormat', 'setBorder',
      'setDataValidation', 'setDataValidations', 'clearDataValidations',
      'setWrap'].forEach(m => { range[m] = () => range; });
    return range;
  }

  const sheet = {
    getName: () => name,
    getSheetId: () => id,
    getLastRow: lastRow,
    getLastColumn: lastCol,
    getRange: (r, c, nr, nc) => makeRange(r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc),
    getDataRange: () => makeRange(1, 1, Math.max(lastRow(), 1), Math.max(lastCol(), 1)),
    appendRow(row) {
      const r = lastRow() + 1;
      const target = at(r, row.length);
      for (let j = 0; j < row.length; j++) target[j] = row[j];
      return sheet;
    },
    deleteRow(r) {
      data.splice(r - 1, 1);
      return sheet;
    },
    _dump: () => data.map(r => r.slice())
  };
  ['setFrozenRows', 'setFrozenColumns', 'setColumnWidth', 'setColumnWidths',
    'setRowHeights', 'setConditionalFormatRules', 'setTabColor', 'clear',
    'hideSheet', 'activate'].forEach(m => { sheet[m] = () => sheet; });
  return sheet;
}

function makeBook() {
  const sheets = [];
  let nextId = 100;
  return {
    getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    insertSheet(n, index) {
      const s = makeSheet(n, nextId++);
      if (index === undefined) sheets.splice(0, 0, s);  // 本物は現在の位置に差し込む
      else sheets.splice(index, 0, s);
      return s;
    },
    getSheets: () => sheets.slice(),
    deleteSheet(sh) {
      const i = sheets.indexOf(sh);
      if (i >= 0) sheets.splice(i, 1);
    }
  };
}

function chainBuilder(extra) {
  const b = new Proxy({}, {
    get(_, prop) {
      if (prop === 'build') return () => (extra || {});
      return () => b;
    }
  });
  return b;
}

/** 偽物一式を作る。sent には LINE へ送ったものが溜まる */
function makeGas() {
  const book = makeBook();
  const sent = [];
  let now = new Date(2026, 7, 15, 9, 0, 0); // 2026-08-15 09:00

  const pad = (n, w) => String(n).padStart(w, '0');

  const gas = {
    sent,
    book,
    setNow(d) { now = d; },
    getNow() { return now; },

    SpreadsheetApp: {
      openById: () => book,
      flush: () => {},
      newConditionalFormatRule: () => chainBuilder(),
      newDataValidation: () => chainBuilder()
    },

    UrlFetchApp: {
      fetch(url, options) {
        const payload = options && options.payload ? JSON.parse(options.payload) : null;
        sent.push({ url, method: options.method, payload });

        // 失敗を起こしたいときに差し込む
        const fail = gas.failNext.shift();
        if (fail === 'throw') throw new Error('つながりませんでした');
        if (typeof fail === 'number') return fakeResponse(fail, '{"message":"error"}');

        if (url.indexOf('/profile/') >= 0 || url.indexOf('/member/') >= 0) {
          const id = url.split('/').pop();
          const name = (gas.names && gas.names[id]) || '';
          return fakeResponse(200, JSON.stringify({ displayName: name }));
        }
        return fakeResponse(200, '{}');
      }
    },

    LockService: {
      getScriptLock: () => ({
        tryLock: () => gas.lockAvailable,
        releaseLock: () => {}
      })
    },

    ContentService: {
      createTextOutput: t => ({ text: t })
    },

    Utilities: {
      formatDate(date, tz, fmt) {
        return fmt
          .replace('yyyy', pad(date.getFullYear(), 4))
          .replace('MM', pad(date.getMonth() + 1, 2))
          .replace('dd', pad(date.getDate(), 2))
          .replace('HH', pad(date.getHours(), 2))
          .replace('mm', pad(date.getMinutes(), 2))
          .replace(/\bd\b/, String(date.getDate()));
      }
    },

    names: {},

    // テストから触るつまみ
    failNext: [],        // 'throw' か HTTP コードを積むと、その順に送信が失敗する
    lockAvailable: true  // false にすると順番待ちが取れない
  };
  return gas;
}

function fakeResponse(code, text) {
  return { getResponseCode: () => code, getContentText: () => text };
}

module.exports = { makeGas };
