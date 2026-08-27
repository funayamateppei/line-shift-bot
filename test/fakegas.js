/**
 * Google Apps Script の偽物。テストで触る範囲だけを用意する。
 * スプレッドシートはメモリ上の 2 次元配列。LINE への送信は記録するだけ。
 */

function makeSheet(name, id) {
  const data = [];
  // 本物のシートには行数の上限がある。消せば減り、範囲を超えて書こうとすると落ちる
  let maxRows = 1000;
  const validations = {};
  const formats = {};

  /** 置かれた入力規則を覚える。空の候補リストは本物が受け付けない */
  const putRule = (r, c, rule) => {
    if (rule && rule.list) {
      const real = rule.list.filter(v => v !== '' && v !== null && v !== undefined);
      if (!real.length) throw new Error(`候補が空のプルダウンは置けません: ${name} ${r}行${c}列`);
    }
    validations[r + ',' + c] = rule || null;
  };

  // 本物のシートは、書いた文字列を人が打ったものとして解釈しなおす。
  // 「2026-09」は日付になり、getValues() は文字列ではなく Date を返す。
  // 表示形式が「@」のセルだけが文字列のまま残る。
  // 「2026-09」だけでなく「2026年9月」も日付として解釈される
  const DATE_LIKE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
  const DATE_JP = /^(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?$/;
  const coerce = (r, c, v) => {
    if (typeof v !== 'string') return v;
    if (formats[r + ',' + c] === '@') return v;
    const m = DATE_LIKE.exec(v) || DATE_JP.exec(v);
    if (!m) return v;
    return new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
  };

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
    if (r < 1 || r - 1 + nr > maxRows) {
      throw new Error(`範囲が広すぎます: ${name} 行 ${r}〜${r + nr - 1}（このシートは ${maxRows} 行）`);
    }
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
          for (let j = 0; j < values[i].length; j++) {
            row[c - 1 + j] = coerce(r + i, c + j, values[i][j]);
          }
        }
        return range;
      },
      setValue(v) {
        at(r, c)[c - 1] = coerce(r, c, v);
        return range;
      },
      getRow() { return r; },
      getColumn() { return c; },
      // 入力規則は本当に何が置かれたか覚えておく。
      // 素通しにすると「候補が空のプルダウン」のような形をテストで見つけられない
      setDataValidation(rule) {
        for (let i = 0; i < nr; i++) {
          for (let j = 0; j < nc; j++) putRule(r + i, c + j, rule);
        }
        return range;
      },
      setDataValidations(rules) {
        rules.forEach((row, i) => row.forEach((rule, j) => putRule(r + i, c + j, rule)));
        return range;
      },
      getDataValidation: () => validations[r + ',' + c] || null,
      setNumberFormat(f) {
        for (let i = 0; i < nr; i++) {
          for (let j = 0; j < nc; j++) formats[(r + i) + ',' + (c + j)] = f;
        }
        return range;
      },
      getNumberFormat: () => formats[r + ',' + c] || ''
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
      'setHorizontalAlignment', 'setVerticalAlignment', 'setBorder',
      'clearDataValidations',
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
    // 本物の appendRow は、書いたセルの表示形式を既定に戻してしまう。
    // 先に「@」を置いておいても消えるので、「2026-09」が日付に化ける。
    appendRow(row) {
      const r = lastRow() + 1;
      if (r > maxRows) maxRows = r;   // 本物は足りなければ行が増える
      const target = at(r, row.length);
      for (let j = 0; j < row.length; j++) {
        delete formats[r + ',' + (j + 1)];
        target[j] = coerce(r, j + 1, row[j]);
      }
      return sheet;
    },
    deleteRow(r) { return sheet.deleteRows(r, 1); },
    deleteRows(r, n) {
      data.splice(r - 1, n);
      maxRows -= n;              // 本物も行が減る
      return sheet;
    },
    getMaxRows: () => maxRows,
    insertRowsAfter(after, n) {
      maxRows += n;
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
    setSpreadsheetTimeZone() {},
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
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
      newDataValidation: () => {
        const st = { list: null };
        const b = {
          requireValueInList(list) { st.list = list; return b; },
          requireCheckbox() { st.checkbox = true; return b; },
          setAllowInvalid() { return b; },
          setHelpText() { return b; },
          build: () => st
        };
        return b;
      }
    },

    UrlFetchApp: {
      fetch(url, options) {
        const payload = options && options.payload ? JSON.parse(options.payload) : null;
        if (payload && payload.messages) {
          if (payload.messages.length > 5) gas.badMessages.push('1 回に 5 件を超えて送っている');
          payload.messages.forEach(m => checkMessage(m, gas.badMessages));
        }
        sent.push({ url, method: options.method, payload });

        // 失敗を起こしたいときに差し込む
        const fail = gas.failNext.shift();
        if (fail === 'throw') throw new Error('つながりませんでした');
        if (typeof fail === 'number') return fakeResponse(fail, '{"message":"error"}');

        if (url.indexOf('/members/ids') >= 0) {
          // 無料アカウントでは使えない
          return fakeResponse(403, '{"message":"Access to this API is not available for your account"}');
        }
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

    // ウェブ画面。中身は文字列なので、そのまま持っておいて検査できるようにする
    HtmlService: {
      createHtmlOutput(html) {
        const out = {
          html,
          title: '',
          meta: {},
          getContent: () => out.html,
          setTitle(t) { out.title = t; return out; },
          addMetaTag(name, content) { out.meta[name] = content; return out; },
          setXFrameOptionsMode() { return out; }
        };
        gas.pages.push(out);
        return out;
      }
    },

    ScriptApp: {
      getService: () => ({ getUrl: () => gas.webAppUrl })
    },

    Utilities: {
      // 本物は毎回ちがう UUID を返す。鍵が重ならないことに意味があるので数える
      getUuid() {
        gas.uuidCount++;
        return 'uuid-' + pad(gas.uuidCount, 4) + '-0000-0000-000000000000';
      },
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
    pages: [],           // doGet が返した画面
    uuidCount: 0,
    webAppUrl: 'https://script.google.com/macros/s/AKfyTEST/exec',

    // テストから触るつまみ
    failNext: [],        // 'throw' か HTTP コードを積むと、その順に送信が失敗する
    lockAvailable: true, // false にすると順番待ちが取れない
    badMessages: []      // 送れない形のメッセージが見つかるとここに溜まる
  };
  return gas;
}

function fakeResponse(code, text) {
  return { getResponseCode: () => code, getContentText: () => text };
}

/**
 * 送ろうとしているメッセージの形を確かめる。
 * LINE は受け取れないものを 400 で返すが、そうなると同じ送信に載せた
 * ほかの吹き出しも丸ごと届かない。届かない形を作っていないかここで見る。
 */
function checkMessage(m, bad) {
  if (!m || !m.type) { bad.push('type がない: ' + JSON.stringify(m)); return; }

  if (m.quickReply) {
    const items = m.quickReply.items || [];
    if (!items.length) bad.push('中身の空の quickReply');
    if (items.length > 13) bad.push('quickReply が 13 件を超える');
  }
  if (JSON.stringify(m).length > 50000) bad.push('メッセージが大きすぎる');

  if (m.type === 'text' || m.type === 'textV2') {
    if (!m.text) bad.push('本文が空の text');
    else if (m.text.length > 5000) bad.push('text が 5000 文字を超える');
    return;
  }
  if (m.type === 'flex') {
    if (!m.altText) bad.push('altText がない flex');
    else if (m.altText.length > 400) bad.push('altText が 400 文字を超える');
    checkContainer(m.contents, bad);
    return;
  }
  bad.push('知らない type: ' + m.type);
}

function checkContainer(c, bad) {
  if (!c) { bad.push('contents がない flex'); return; }
  if (c.type === 'carousel') {
    if (!c.contents || !c.contents.length) bad.push('中身の空の carousel');
    else c.contents.forEach(b => checkContainer(b, bad));
    return;
  }
  if (c.type !== 'bubble') { bad.push('bubble でも carousel でもない: ' + c.type); return; }
  // bubble は header / hero / body / footer のどれかが要る
  if (!c.header && !c.hero && !c.body && !c.footer) bad.push('中身の空の bubble');
  ['header', 'body', 'footer'].forEach(k => { if (c[k]) checkComponent(c[k], bad); });
}

function checkComponent(v, bad) {
  if (!v || !v.type) { bad.push('type のない部品'); return; }
  if (v.type === 'box') {
    if (!Array.isArray(v.contents) || v.contents.length === 0) {
      bad.push('中身の空の box');          // ← LINE はこれを受け取れない
      return;
    }
    v.contents.forEach(child => checkComponent(child, bad));
    return;
  }
  if (v.type === 'text') {
    if (!v.text) bad.push('本文の空の text 部品');
    // Flex の文字は URL を書いてもリンクにならない。押せない URL は置かない
    else if (/https?:\/\//.test(v.text)) bad.push('リンクにならない URL を Flex の文字に置いている: ' + v.text);
    return;
  }
  if (v.type === 'button') {
    if (!v.action || !v.action.type) bad.push('action のない button');
    else if (v.action.type === 'postback' && !v.action.data) bad.push('data のない postback');
    else if (v.action.type === 'uri' && !/^https:\/\//.test(v.action.uri || '')) {
      bad.push('uri が https で始まらない button: ' + v.action.uri);
    }
    else if (v.action.data && v.action.data.length > 300) bad.push('postback の data が 300 文字を超える');
    if (v.action && v.action.label !== undefined && !v.action.label) bad.push('label が空の button');
    return;
  }
  if (v.type === 'filler' || v.type === 'separator' || v.type === 'spacer'
    || v.type === 'image' || v.type === 'icon') return;
  bad.push('知らない部品: ' + v.type);
}

module.exports = { makeGas };
