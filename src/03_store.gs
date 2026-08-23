/**
 * シートの読み書き。
 *
 * 壊れないために守ること（仕様 12）
 *   ・回答は 1 人 1 行。答え直したら上書きする（処理は順番待ちで囲う）
 *   ・状態は処理の最後に 1 回だけ書く
 *   ・設定は毎回シートから読む
 */

// ---------------------------------------------------------------- 名簿

/** 名簿を全部読む */
function rosterAll_() {
  var sh = sheet_(SHEET.名簿);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 5).getValues();
  // 手で編集して同じ userId が 2 行できても二重に数えない。後の行を採用する
  // userId は名簿シートで人が編集できる。toString のような名前が入っても
  // 「もうある」と誤って判断しないよう、素の入れ物を使う
  var byId = Object.create(null);
  var order = [];
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || '').trim();
    if (!id) continue;
    if (byId[id] === undefined) order.push(id);
    byId[id] = {
      userId: id,
      name: String(values[i][1] || '').trim(),
      inGroup: values[i][2] === true,
      friend: values[i][3] === true,
      row: i + 2
    };
  }
  return order.map(function (id) { return byId[id]; });
}

/** カレンダーを送る相手（在籍 かつ 友だち追加） */
function members_() {
  return rosterAll_().filter(function (p) { return p.inGroup && p.friend; });
}

/** 友だち追加をお願いする相手（在籍 かつ 未追加） */
function notAdded_() {
  return rosterAll_().filter(function (p) { return p.inGroup && !p.friend; });
}

function rosterFind_(userId) {
  var all = rosterAll_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].userId === userId) return all[i];
  }
  return null;
}

/**
 * 名簿を更新する。渡した項目だけ書き換える。
 * patch: {name, inGroup, friend}
 */
function rosterUpsert_(userId, patch) {
  if (!userId) return null;
  var sh = sheet_(SHEET.名簿);
  var found = rosterFind_(userId);

  if (!found) {
    var row = [
      userId,
      patch.name || '',
      patch.inGroup === true,
      patch.friend === true,
      stamp_()
    ];
    sh.appendRow(row);
    var r = sh.getLastRow();
    sh.getRange(r, 3, 1, 2).insertCheckboxes().setValues([[row[2], row[3]]]);
    return { userId: userId, name: row[1], inGroup: row[2], friend: row[3], row: r };
  }

  var name = patch.name !== undefined && patch.name ? patch.name : found.name;
  var inGroup = patch.inGroup !== undefined ? patch.inGroup : found.inGroup;
  var friend = patch.friend !== undefined ? patch.friend : found.friend;
  sh.getRange(found.row, 1, 1, 5).setValues([[userId, name, inGroup, friend, stamp_()]]);
  return { userId: userId, name: name, inGroup: inGroup, friend: friend, row: found.row };
}

/** 表示名。取れていなければ空を返す（userId は外へ出さない） */
function nameOf_(userId) {
  var p = rosterFind_(userId);
  return p && p.name ? p.name : '';
}

// ---------------------------------------------------------------- 状態

/** いまの状態 */
function state_() {
  var sh = sheet_(SHEET.状態);
  var v = sh.getRange(2, 1, 1, 4).getValues()[0];
  var stage = String(v[1] || '').trim() || STAGE.なし;
  var ym = ymOfCell_(v[0]);
  var days = parseDays_(v[3]);
  // 手で編集されて、その月に無い日（30日の月の 31 日など）が入っていても落とす。
  // 年月まで壊れているときは判断できないので、そのまま残す（全部消さない）
  var last = ym ? daysInMonth_(ym) : NaN;
  if (!isNaN(last)) {
    days = days.filter(function (d) { return d <= last; });
  }
  return { ym: ym, stage: stage, part: String(v[2] || '').trim(), days: days };
}

/** 状態を書く。処理の最後に 1 回だけ呼ぶ */
function saveState_(st) {
  sheet_(SHEET.状態).getRange(2, 1, 1, 4).setValues([[
    st.ym || '',
    st.stage || STAGE.なし,
    st.part || '',
    joinDays_(st.days || [])
  ]]);
}

/** 進行中のものを消す */
function clearState_() {
  saveState_({ ym: '', stage: STAGE.なし, part: '', days: [] });
}

/** 進行中か */
function isRunning_(st) {
  return st.stage !== STAGE.なし && st.stage !== '';
}

// ---------------------------------------------------------------- 回答ログ

/**
 * 回答を保存する。同じ月の同じ人の行があれば上書きする。
 *
 * 処理全体を順番待ちで囲っているので、上書きでも取りこぼさない。
 * 1 人 1 行に保たれるので、ログを見れば誰がどう答えたかがそのまま分かる。
 *
 * 表示形式について。appendRow は書いたセルの表示形式を既定に戻してしまう。
 * シートを作るときに B 列と E 列へ入れておいた「@」（テキスト）が消え、
 * 「2026-09」が日付に、「2,4」が数として解釈される。対象年月が日付になると
 * 照合が通らなくなり、回答が 1 件も拾えない。書く行に毎回 @ を置いてから値を入れる。
 */
function appendAnswer_(ym, userId, name, days) {
  var sh = sheet_(SHEET.回答ログ);
  var r = answerRow_(sh, ym, userId);
  if (!r) {
    r = sh.getLastRow() + 1;
    if (sh.getMaxRows() < r) sh.insertRowsAfter(sh.getMaxRows(), r - sh.getMaxRows());
  }
  sh.getRange(r, 2, 1, 1).setNumberFormat('@');
  sh.getRange(r, 5, 1, 1).setNumberFormat('@');
  sh.getRange(r, 1, 1, 5).setValues([[
    stamp_(),
    ym,
    userId,
    name,
    joinDays_(days)
  ]]);
}

/**
 * その月のその人の行を探す。無ければ 0。
 * 手で編集して同じ組み合わせが 2 行できていたら、後の行を採用する。
 */
function answerRow_(sh, ym, userId) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var values = sh.getRange(2, 2, last - 1, 2).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (ymOfCell_(values[i][0]) !== ym) continue;
    if (String(values[i][1] || '').trim() !== userId) continue;
    return i + 2;
  }
  return 0;
}

/**
 * その月の回答をすべて消す。
 * 〔中止〕したときだけ呼ぶ。同じ月をやり直したときに前回の回答が
 * 生き残って、誤った当番表ができるのを防ぐ。
 */
function clearAnswers_(ym) {
  if (!ym) return 0;
  var sh = sheet_(SHEET.回答ログ);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var col = sh.getRange(2, 2, last - 1, 1).getValues();
  var hit = col.map(function (r) { return ymOfCell_(r[0]) === ym; });
  return deleteMarkedRows_(sh, hit, 2);
}

/**
 * 印の付いた行をまとめて消す。
 * 続いている行は 1 回で消す（1 行ずつ消すと遅く、書式の範囲も痩せていく）。
 * 後ろから消すので行番号はずれない。
 */
function deleteMarkedRows_(sh, hit, offset) {
  var removed = 0;
  var end = -1;
  for (var i = hit.length - 1; i >= -1; i--) {
    if (i >= 0 && hit[i]) {
      if (end < 0) end = i;
      continue;
    }
    if (end >= 0) {
      var count = end - i;
      sh.deleteRows(i + 1 + offset, count);
      removed += count;
      end = -1;
    }
  }
  return removed;
}

/**
 * その月の回答を集める。同じ人が何度も答えていれば最新の行を採用する。
 * 返り値: { userId: [日, ...] }
 */
function answersFor_(ym) {
  var sh = sheet_(SHEET.回答ログ);
  var last = sh.getLastRow();
  if (last < 2) return {};
  var values = sh.getRange(2, 1, last - 1, 5).getValues();
  var out = Object.create(null);
  for (var i = 0; i < values.length; i++) {
    if (ymOfCell_(values[i][1]) !== ym) continue;
    var id = String(values[i][2] || '').trim();
    if (!id) continue;
    out[id] = parseDays_(values[i][4]);
  }
  return out;
}

/** その月に答えた人か */
function hasAnswered_(ym, userId) {
  return Object.prototype.hasOwnProperty.call(answersFor_(ym), userId);
}

/** 未回答の人（在籍 かつ 追加済み かつ その月の回答なし） */
function pending_(ym) {
  var answered = answersFor_(ym);
  return members_().filter(function (p) {
    return !Object.prototype.hasOwnProperty.call(answered, p.userId);
  });
}

// ---------------------------------------------------------------- 当番表

/**
 * 当番表を年度シートに書く。
 * 同じ年月のブロックがあれば作り直す。
 *
 * rows: [{day, weekday, am, pm, cands:[表示名]}]
 * 見出し行（日が空、午前に部制）＋日ごとの行を並べる。
 */
function writeShift_(ym, part, rows) {
  var sh = ensureYearSheet_(ym);
  removeMonthBlock_(sh, ym);

  var label = ymLabel_(ym);
  var values = [[label, '', '', part, '', '']];
  rows.forEach(function (r) {
    values.push([label, r.day, r.weekday, r.am || '', r.pm || '', r.cands.join(', ')]);
  });

  // 何度も作り直すと行を消したぶんシートが縮む。足りなければ足してから書く
  var start = sh.getLastRow() + 1;
  var need = start + values.length - 1;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  sh.getRange(start, 1, values.length, 6).setValues(values);

  // 担当セルのプルダウン。その日に来られる人だけを候補に入れる。
  // 手を挙げてくれた人を後から入れられるよう、候補以外も入力できるようにしておく。
  var rules = [];
  rules.push([null, null]);
  rows.forEach(function (r) {
    // その日に来られる人が 1 人もいないときはプルダウンを置かない。
    // 空だけの候補リストは作れない
    if (!r.cands.length) { rules.push([null, null]); return; }

    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(r.cands.concat(['']), true)
      .setAllowInvalid(true)
      .build();
    rules.push([rule, part === PART.二部 ? rule : null]);
  });
  sh.getRange(start, 4, rules.length, 2).setDataValidations(rules);

  SpreadsheetApp.flush();
  return sh;
}

/** その年月の行を消す */
function removeMonthBlock_(sh, ym) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var label = ymLabel_(ym);
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  var hit = col.map(function (r) { return String(r[0] || '').trim() === label; });
  deleteMarkedRows_(sh, hit, 2);
}

/**
 * 年度シートから、その年月の当番表を読む（公開はシートの最新内容を送る）。
 * 返り値: {part, rows:[{day, weekday, am, pm}]}
 */
function readShift_(ym) {
  var sh = book_().getSheetByName(yearSheetName_(ym));
  if (!sh) return { part: '', rows: [] };
  var last = sh.getLastRow();
  if (last < 2) return { part: '', rows: [] };

  var values = sh.getRange(2, 1, last - 1, 6).getValues();
  var label = ymLabel_(ym);
  var part = '';
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() !== label) continue;
    var day = values[i][1];
    if (day === '' || day === null) {
      part = String(values[i][3] || '').trim();
      continue;
    }
    // 手で「6日」などと直されて数にならない行は読まない。
    // 読むと 9/NaN のような表がそのままグループへ届いてしまう
    if (isNaN(Number(day))) continue;
    rows.push({
      day: Number(day),
      weekday: String(values[i][2] || ''),
      am: String(values[i][3] || '').trim(),
      pm: String(values[i][4] || '').trim()
    });
  }
  return { part: part, rows: rows };
}
