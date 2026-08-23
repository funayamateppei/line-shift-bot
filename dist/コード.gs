/**
 * 当番Bot ── GAS に貼る用にまとめたもの。
 *
 * このファイルは src/ から機械的に作っています。直接編集しないでください。
 * 直すのは src/ の各ファイル。そのあと node tools/bundle.js を実行します。
 *
 * 貼ったあと、すぐ下の 2 行だけ書き換えてください。
 */

// ==================================================== 00_config.gs
/**
 * 設定。
 *
 * 書き換えるのは下の 2 つだけ。運用で変わる値（管理者ID・グループID・お知らせ日・
 * 締切日）は「設定」シートに置く。シートを直せば再デプロイなしで反映される。
 */

// ===== ここだけ書き換える =====
var SPREADSHEET_ID = '1VMJ8pT4M0pJFaTXZ4bOWr2BrpqJhlOQV9-S1b5BXtf0';
var CHANNEL_ACCESS_TOKEN = '';
// =============================

var TZ = 'Asia/Tokyo';

/** シート名 */
var SHEET = {
  設定: '設定',
  名簿: '名簿',
  状態: '状態',
  回答ログ: '回答ログ'
};

/** 段階（仕様 9） */
var STAGE = {
  なし: 'なし',
  対象月待ち: '対象月待ち',
  部制待ち: '部制待ち',
  日数待ち: '日数待ち',
  日程編集中: '日程編集中',
  回答受付中: '回答受付中',
  確認待ち: '確認待ち',
  公開済み: '公開済み'
};

/** 部制 */
var PART = {
  一部: '1部制',
  二部: '2部制'
};

/** 設定シートの既定値 */
var DEFAULT_NOTICE_DAY = 15;
var DEFAULT_DUE_DAY = 25;

/** 見た目 */
var COLOR = {
  ヘッダー背景: '#2c3e50',
  ヘッダー文字: '#ffffff',
  編集可: '#fff7d9',
  担当セル: '#e8f7ea',
  空欄警告: '#fcd9d9',
  無効: '#f2f2f2',
  無効文字: '#b3b3b3',
  月見出し: '#e0e8f0',
  未追加行: '#ffedd9',
  退会文字: '#a6a6a6',
  補足文字: '#808080',
  土: '#3373cc',
  日: '#d94040',
  緑: '#2f7d5a',
  枠線: '#cfd6dd'
};

/** スプレッドシートを開く */
function book_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * シートを取得する。無ければ作る。
 * insertSheet は位置を指定しないと今いるタブの手前に入ってしまうので、必ず指定する。
 */
function sheet_(name, index) {
  var book = book_();
  var sh = book.getSheetByName(name);
  if (sh) return sh;
  var at = index === undefined ? book.getSheets().length : index;
  return book.insertSheet(name, at);
}

/**
 * 設定シートを読む。
 * 未設定のプレースホルダ（Uxxxx… など）は空として扱う。
 */
function settings_() {
  var values = sheet_(SHEET.設定).getDataRange().getValues();
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) map[key] = String(values[i][1] || '').trim();
  }
  return {
    adminId: realId_(map['管理者ID']),
    groupId: realId_(map['グループID']),
    noticeDay: toInt_(map['お知らせ日'], DEFAULT_NOTICE_DAY),
    dueDay: toInt_(map['締切日'], DEFAULT_DUE_DAY)
  };
}

/** 設定シートの 1 項目を書き換える（グループIDの自動取得に使う） */
function setSetting_(key, value) {
  var sh = sheet_(SHEET.設定);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value, '']);
}

/** プレースホルダを空とみなす */
function realId_(v) {
  if (!v) return '';
  if (v.indexOf('xxxx') >= 0) return '';
  return v;
}

function toInt_(v, fallback) {
  var n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

/** 年度シートの名前。4 月始まり */
function yearSheetName_(ym) {
  var y = ymYear_(ym);
  var m = ymMonth_(ym);
  var fiscal = m >= 4 ? y : y - 1;
  return '当番_' + fiscal + '年度';
}

/** シートを開く URL */
function sheetUrl_(name) {
  var sh = book_().getSheetByName(name);
  var gid = sh ? sh.getSheetId() : 0;
  return 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit#gid=' + gid;
}

function log_(message) {
  console.log(message);
}

function logError_(err) {
  console.error(err && err.stack ? err.stack : String(err));
}

// ==================================================== 01_setup.gs
/**
 * シートの自動作成。
 *
 * 導入時に setup() を 1 回実行する。既にあるシートは作り直さない。
 * 年度シートは集計のたびに ensureYearSheet_() で用意する。
 */

/** 導入時に 1 回だけ実行する */
function setup() {
  ensureSettingsSheet_();
  ensureRosterSheet_();
  ensureStateSheet_();
  ensureAnswerSheet_();
  ensureYearSheet_(ymOf_(new Date()));
  removeDefaultSheet_();
  log_('セットアップ完了');
}

/** 「シート1」など初期シートが残っていれば消す */
function removeDefaultSheet_() {
  var book = book_();
  var known = {};
  known[SHEET.設定] = true;
  known[SHEET.名簿] = true;
  known[SHEET.状態] = true;
  known[SHEET.回答ログ] = true;
  var sheets = book.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (known[name]) continue;
    if (name.indexOf('当番_') === 0) continue;
    if (sheets[i].getLastRow() > 0) continue;
    if (book.getSheets().length <= 1) return;
    book.deleteSheet(sheets[i]);
  }
}

/** 見出し行の体裁 */
function styleHeader_(sh, columns) {
  sh.getRange(1, 1, 1, columns)
    .setBackground(COLOR.ヘッダー背景)
    .setFontColor(COLOR.ヘッダー文字)
    .setFontWeight('bold');
  sh.setFrozenRows(1);
}

function isNewSheet_(sh) {
  return sh.getLastRow() === 0;
}

// ---------------------------------------------------------------- 設定

function ensureSettingsSheet_() {
  var sh = sheet_(SHEET.設定, 0);
  if (!isNewSheet_(sh)) return sh;

  sh.getRange(1, 1, 5, 3).setValues([
    ['項目', '値', '説明'],
    ['管理者ID', '', '管理者の LINE userId。LINE Developers のチャネル基本設定で確認'],
    ['グループID', '', 'Bot をグループに招待すると自動で入る'],
    ['お知らせ日', DEFAULT_NOTICE_DAY, '管理者に「始めますか」を送る日'],
    ['締切日', DEFAULT_DUE_DAY, '未回答の一覧を管理者に送る日']
  ]);
  styleHeader_(sh, 3);
  sh.getRange(2, 2, 4, 1).setBackground(COLOR.編集可);
  sh.getRange(2, 3, 4, 1).setFontColor(COLOR.補足文字).setFontSize(10);

  // お知らせ日と締切日はプルダウンにする。
  // 手入力できると 31 のような値が入り、31 日のない月では一度も送られなくなる
  var dayChoices = [];
  for (var d = 1; d <= 28; d++) dayChoices.push(d);
  sh.getRange(4, 2, 2, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(dayChoices, true)
      .setAllowInvalid(false)
      .build()
  );
  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 340);
  sh.setColumnWidth(3, 360);
  sh.setTabColor('#f5c333');
  return sh;
}

// ---------------------------------------------------------------- 名簿

function ensureRosterSheet_() {
  var sh = sheet_(SHEET.名簿, 1);
  if (!isNewSheet_(sh)) return sh;

  sh.getRange(1, 1, 1, 5).setValues([['userId', '表示名', '在籍', '友だち追加', '更新日時']]);
  styleHeader_(sh, 5);
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 140);
  sh.setColumnWidth(3, 100);
  sh.setColumnWidth(4, 100);
  sh.setColumnWidth(5, 160);

  // チェックボックスは行を足すときに 1 行ずつ置く。
  // ここでまとめて置くとセルに FALSE が入り、名簿が 999 行ぶん埋まってしまう。
  sh.getRange(2, 3, 999, 2).setHorizontalAlignment('center');
  sh.getRange(2, 1, 999, 1).setFontSize(10).setFontColor(COLOR.補足文字);

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($C2=TRUE,$D2=FALSE)')
      .setBackground(COLOR.未追加行)
      .setRanges([sh.getRange(2, 1, 999, 5)])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$C2=FALSE')
      .setFontColor(COLOR.退会文字)
      .setRanges([sh.getRange(2, 1, 999, 5)])
      .build()
  ]);
  sh.setTabColor('#4587a0');
  return sh;
}

// ---------------------------------------------------------------- 状態

function ensureStateSheet_() {
  var sh = sheet_(SHEET.状態, 2);
  if (!isNewSheet_(sh)) return sh;

  sh.getRange(1, 1, 2, 4).setValues([
    ['対象年月', '段階', '部制', '当番の日'],
    ['', STAGE.なし, '', '']
  ]);
  styleHeader_(sh, 4);
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 130);
  sh.setColumnWidth(4, 260);
  // 「2026-09」や「2,6,9」を日付や数と解釈させない。
  // 化けると書いた文字と読んだ文字が変わり、対象年月の照合が通らなくなる
  sh.getRange(2, 1, 1, 4).setNumberFormat('@');
  sh.setTabColor('#999999');
  return sh;
}

// ---------------------------------------------------------------- 回答ログ

function ensureAnswerSheet_() {
  var sh = sheet_(SHEET.回答ログ, 3);
  if (!isNewSheet_(sh)) return sh;

  sh.getRange(1, 1, 1, 5).setValues([['日時', '対象年月', 'userId', '表示名', '都合がつく日']]);
  styleHeader_(sh, 5);
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 300);
  sh.setColumnWidth(4, 140);
  sh.setColumnWidth(5, 220);
  sh.getRange(2, 3, 999, 1).setFontSize(10).setFontColor(COLOR.補足文字);
  // 対象年月と都合がつく日を、日付や数に化けさせない
  sh.getRange(2, 2, 999, 1).setNumberFormat('@');
  sh.getRange(2, 5, 999, 1).setNumberFormat('@');
  sh.setTabColor('#999999');
  return sh;
}

// ---------------------------------------------------------------- 当番_YYYY年度

/** その年月が属する年度シートを用意して返す */
function ensureYearSheet_(ym) {
  var name = yearSheetName_(ym);
  var book = book_();
  var sh = book.getSheetByName(name);
  if (sh) return sh;

  sh = book.insertSheet(name, book.getSheets().length);
  sh.getRange(1, 1, 1, 6).setValues([['年月', '日', '曜', '午前', '午後', '来られる人']]);
  styleHeader_(sh, 6);
  sh.getRange(1, 1, 1, 6).setHorizontalAlignment('center');
  sh.setFrozenColumns(3);

  sh.setColumnWidth(1, 110);
  sh.setColumnWidth(2, 56);
  sh.setColumnWidth(3, 56);
  sh.setColumnWidth(4, 150);
  sh.setColumnWidth(5, 150);
  sh.setColumnWidth(6, 260);

  var rows = 400;
  sh.getRange(2, 1, rows, 3).setHorizontalAlignment('center').setFontColor('#595959');
  sh.getRange(2, 2, rows, 1).setFontWeight('bold').setFontSize(13).setFontColor('#1a1a1a');
  sh.getRange(2, 4, rows, 2)
    .setBackground(COLOR.担当セル)
    .setHorizontalAlignment('center')
    .setFontWeight('bold')
    .setFontSize(13);
  sh.getRange(2, 6, rows, 1).setFontSize(10).setFontColor(COLOR.補足文字);
  sh.setRowHeights(2, rows, 34);

  sh.setConditionalFormatRules([
    // 月の見出し行（年月はあるが日が空）。まだ書かれていない行には当てない
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2<>"",$B2="")')
      .setBackground(COLOR.月見出し)
      .setFontColor(COLOR.ヘッダー背景)
      .setBold(true)
      .setRanges([sh.getRange(2, 1, rows, 6)])
      .build(),
    // 担当が決まっていない枠
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($B2<>"",D2="")')
      .setBackground(COLOR.空欄警告)
      .setRanges([sh.getRange(2, 4, rows, 2)])
      .build(),
    // 午前と午後が同じ人になってしまったとき
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($B2<>"",$D2<>"",$D2=$E2)')
      .setBackground(COLOR.空欄警告)
      .setRanges([sh.getRange(2, 4, rows, 2)])
      .build(),
    // 1部制の午後
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('—')
      .setBackground(COLOR.無効)
      .setFontColor(COLOR.無効文字)
      .setBold(false)
      .setRanges([sh.getRange(2, 4, rows, 2)])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('土')
      .setFontColor(COLOR.土)
      .setBold(true)
      .setRanges([sh.getRange(2, 3, rows, 1)])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('日')
      .setFontColor(COLOR.日)
      .setBold(true)
      .setRanges([sh.getRange(2, 3, rows, 1)])
      .build()
  ]);
  sh.setTabColor('#429e6b');
  return sh;
}

// ==================================================== 02_dates.gs
/**
 * 日付。
 *
 * 対象年月は 'YYYY-MM' の文字列で持ち回る（例 '2026-09'）。
 * 表示は必ず「2026年9月」のように年と月を書く（仕様 1-2）。
 */

var WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土'];

/** Date → 'YYYY-MM' */
function ymOf_(date) {
  return Utilities.formatDate(date, TZ, 'yyyy-MM');
}

/** 'YYYY-MM' の翌月 */
function nextYm_(ym) {
  var y = ymYear_(ym);
  var m = ymMonth_(ym) + 1;
  if (m > 12) { y++; m = 1; }
  return pad4_(y) + '-' + pad2_(m);
}

/** いまの翌月 */
function targetYm_(now) {
  return nextYm_(ymOf_(now || new Date()));
}

function ymYear_(ym) {
  return parseInt(String(ym).slice(0, 4), 10);
}

function ymMonth_(ym) {
  return parseInt(String(ym).slice(5, 7), 10);
}

/** その月の日数 */
function daysInMonth_(ym) {
  return new Date(ymYear_(ym), ymMonth_(ym), 0).getDate();
}

/** その月の 1 日の曜日（0=日） */
function firstWeekday_(ym) {
  return new Date(ymYear_(ym), ymMonth_(ym) - 1, 1).getDay();
}

/** 日 → 曜日文字 */
function weekdayOf_(ym, day) {
  return WEEKDAY_JP[new Date(ymYear_(ym), ymMonth_(ym) - 1, day).getDay()];
}

/** '2026年9月' */
function ymLabel_(ym) {
  return ymYear_(ym) + '年' + ymMonth_(ym) + '月';
}

/** '9/2, 9/6, 9/9' */
function daysLabel_(ym, days) {
  var m = ymMonth_(ym);
  return days.map(function (d) { return m + '/' + d; }).join(', ');
}

/** 'YYYY/MM/DD HH:mm' */
function stamp_(date) {
  return Utilities.formatDate(date || new Date(), TZ, 'yyyy/MM/dd HH:mm');
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function pad4_(n) {
  return String(n);
}

/** '2,6,9' ⇄ [2,6,9] */
function parseDays_(text) {
  if (!text) return [];
  var out = [];
  String(text).split(',').forEach(function (s) {
    var n = parseInt(String(s).trim(), 10);
    if (isNaN(n) || n < 1 || n > 31) return;
    if (out.indexOf(n) < 0) out.push(n);   // 同じ日が並んでいても 1 つに
  });
  return out.sort(function (a, b) { return a - b; });
}

function joinDays_(days) {
  return days.slice().sort(function (a, b) { return a - b; }).join(',');
}

/**
 * 日の集合をビットマスクの 16 進文字列にする。
 * メンバーのカレンダーは「確定」まで保存しないので、選択中の状態は
 * ボタンの postback に載せて持ち回る（1〜31 日 → 8 文字以内）。
 */
function daysToMask_(days) {
  var mask = 0;
  days.forEach(function (d) {
    if (d >= 1 && d <= 31) mask |= (1 << (d - 1));
  });
  return (mask >>> 0).toString(16);
}

function maskToDays_(hex) {
  var mask = parseInt(hex || '0', 16);
  if (isNaN(mask)) mask = 0;
  var out = [];
  for (var d = 1; d <= 31; d++) {
    if (mask & (1 << (d - 1))) out.push(d);
  }
  return out;
}

function toggleInMask_(hex, day) {
  var days = maskToDays_(hex);
  var i = days.indexOf(day);
  if (i >= 0) days.splice(i, 1); else days.push(day);
  return daysToMask_(days);
}

// ==================================================== 03_store.gs
/**
 * シートの読み書き。
 *
 * 壊れないために守ること（仕様 12）
 *   ・回答は追記のみ。同時に押されても上書きが起きない
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
  var ym = String(v[0] || '').trim();
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

/** 回答を追記する。上書きはしない */
function appendAnswer_(ym, userId, name, days) {
  sheet_(SHEET.回答ログ).appendRow([
    stamp_(),
    ym,
    userId,
    name,
    joinDays_(days)
  ]);
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
  var hit = col.map(function (r) { return String(r[0] || '').trim() === ym; });
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
    if (String(values[i][1] || '').trim() !== ym) continue;
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

// ==================================================== 04_plan.gs
/**
 * 当番の日のたたき台（仕様 10）。
 *
 * 月の日数 D を当番の日数 N でわり、間隔を q か q+1 のどちらかだけにする。
 * どこを 1 日広くするかと、開始位置はランダム。かたまりができない。
 */

/** 等間隔に散らした日の配列を返す */
function spreadDays_(ym, count, rand) {
  var D = daysInMonth_(ym);
  var N = Math.max(1, Math.min(count, D));
  var random = rand || Math.random;

  var q = Math.floor(D / N);
  var r = D % N;

  var gaps = [];
  for (var i = 0; i < N; i++) gaps.push(i < r ? q + 1 : q);
  shuffle_(gaps, random);

  var offset = q > 1 ? Math.floor(random() * q) : 0;
  var out = [];
  var day = 1 + offset;
  for (var k = 0; k < N; k++) {
    if (day > D) break;
    out.push(day);
    day += gaps[k];
  }
  return out;
}

function shuffle_(arr, rand) {
  var random = rand || Math.random;
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// ==================================================== 05_assign.gs
/**
 * 担当の割り当て（仕様 11）。
 *
 * 絶対に守ること
 *   ・同じ人は 1 日に 1 回まで。2部制の午前と午後に同じ人は入れない
 *   ・都合がつくと答えていない日には入れない
 *
 * そのうえでの優先順位
 *   1. 埋める … 入れられる人がいる枠は必ず埋める
 *   2. 均等  … 担当回数の差をできるだけ小さくする
 *
 * 連投回避は考慮しない。
 *
 * 埋める数について:
 *   日どうしは干渉しない（同じ人を 1 日に 1 回までという決まりは、その日の中で
 *   閉じている）。だからその日に埋まる数は必ず min(枠の数, 出られる人の数) になり、
 *   どんな順で処理しても最大まで埋まる。並べ替えが効くのは「均等の出発点」だけ。
 *   総当たりと突き合わせて確かめてある。test/logic.test.js を見ること。
 */

/**
 * workDays      当番の日 [2, 6, 9, ...]
 * isTwoPart     2部制なら true
 * availability  {userId: [都合がつく日]}
 * memberIds     [userId]
 * 返り値        [{day, am, pm}]  pm は 1部制なら null。決まらない枠は ''
 */
function buildShift_(workDays, isTwoPart, availability, memberIds, rand) {
  var random = rand || Math.random;
  var ctx = newContext_(workDays, isTwoPart, availability, memberIds);

  fillGreedy_(ctx, random);   // 埋められる枠をすべて埋める
  balance_(ctx);              // 回数を均す。付け替えるだけなので枠は空かない

  return toRows_(ctx);
}

function newContext_(workDays, isTwoPart, availability, memberIds) {
  var slots = [];
  var days = [];
  workDays.forEach(function (d) { if (days.indexOf(d) < 0) days.push(d); });
  days.sort(function (a, b) { return a - b; }).forEach(function (day) {
    if (isTwoPart) {
      slots.push({ day: day, part: '午前' });
      slots.push({ day: day, part: '午後' });
    } else {
      slots.push({ day: day, part: '' });
    }
  });

  var cand = slots.map(function (s) {
    return memberIds.filter(function (u) {
      var days = availability[u] || [];
      return days.indexOf(s.day) >= 0;
    });
  });

  // userId は名簿シートで人が編集できる。toString のような名前が入っても
  // 壊れないよう、素の入れ物を使う
  var load = Object.create(null);
  memberIds.forEach(function (u) { load[u] = 0; });

  return {
    slots: slots,
    cand: cand,
    assign: slots.map(function () { return null; }),
    seat: Object.create(null),   // '日#userId' → 埋めている枠の番号
    load: load,
    isTwoPart: isTwoPart
  };
}

function seatKey_(day, user) {
  return day + '#' + user;
}

/** 枠 i に人 u を入れる。前の人がいれば席を空ける */
function place_(ctx, i, u) {
  var day = ctx.slots[i].day;
  var old = ctx.assign[i];
  if (old !== null) {
    delete ctx.seat[seatKey_(day, old)];
    ctx.load[old]--;
  }
  ctx.assign[i] = u;
  if (u !== null) {
    ctx.seat[seatKey_(day, u)] = i;
    ctx.load[u]++;
  }
}

// ---------------------------------------------------------------- 1. 埋める

/**
 * 候補が少ない枠から、担当回数が最も少ない人を入れる（仕様 11 手順 1〜3）。
 *
 * 同じ日の午前と午後は候補がまったく同じなので、この並べ替えが変えるのは
 * 「どの日から手をつけるか」だけ。埋まる数はどの順でも変わらない
 * （順序を完全にばらしても最大まで埋まることを確かめてある）。
 */
function fillGreedy_(ctx, random) {
  var order = ctx.slots.map(function (s, i) { return i; });
  order.sort(function (a, b) {
    var d = ctx.cand[a].length - ctx.cand[b].length;
    return d !== 0 ? d : a - b;
  });

  order.forEach(function (i) {
    var day = ctx.slots[i].day;
    var pool = ctx.cand[i].filter(function (u) {
      return ctx.seat[seatKey_(day, u)] === undefined;
    });
    if (!pool.length) return;

    var min = Infinity;
    pool.forEach(function (u) { if (ctx.load[u] < min) min = ctx.load[u]; });
    var best = pool.filter(function (u) { return ctx.load[u] === min; });
    place_(ctx, i, best[Math.floor(random() * best.length)]);
  });
}

// ---------------------------------------------------------------- 2. 均等

/** これ以上縮められなくなるまで、玉突きで担当を渡す */
function balance_(ctx) {
  for (var guard = 0; guard < 5000; guard++) {
    if (!handOver_(ctx)) return guard;
  }
  return 5000;
}

/**
 * 担当を 1 回ぶん、多い人から少ない人へ渡す。渡せたら true。
 *
 * 出し手は担当が多い人から順に試す。
 * 「最も多い人」だけを見ると、その人の枠がどれも動かせない（その日はその人しか
 * 出られない）ときにそこで止まってしまい、真ん中の人から最も少ない人へ渡せる
 * のに見逃す。だから多い順にすべて試す。
 */
function handOver_(ctx) {
  var users = Object.keys(ctx.load);
  if (users.length < 2) return false;

  var sorted = users.slice().sort(function (a, b) { return ctx.load[b] - ctx.load[a]; });
  var min = ctx.load[sorted[sorted.length - 1]];

  for (var i = 0; i < sorted.length; i++) {
    var from = sorted[i];
    if (ctx.load[from] - min < 2) break;   // ここから先はどう渡しても縮まらない
    if (searchChain_(ctx, from)) return true;
  }
  return false;
}

/**
 * from から受け渡しの列をたどり、担当が 2 回以上少ない人に届いたら反映する。
 * 直接渡せなくても、間に人をはさんでよい（玉突き）。
 */
function searchChain_(ctx, from) {
  var goal = ctx.load[from] - 2;
  // ふつうの {} だと userId が toString や constructor のときに
  // 中身がないのに「見た」ことになってしまう
  var parent = Object.create(null);
  parent[from] = null;
  var queue = [from];

  while (queue.length) {
    var u = queue.shift();

    for (var i = 0; i < ctx.slots.length; i++) {
      if (ctx.assign[i] !== u) continue;
      var day = ctx.slots[i].day;

      var cands = ctx.cand[i];
      for (var k = 0; k < cands.length; k++) {
        var v = cands[k];
        if (v === u) continue;
        if (parent[v] !== undefined) continue;
        if (ctx.seat[seatKey_(day, v)] !== undefined) continue;

        parent[v] = { user: u, slot: i };
        if (ctx.load[v] <= goal) {
          applyChain_(ctx, parent, v);
          return true;
        }
        queue.push(v);
      }
    }
  }
  return false;
}

/**
 * 受け渡しの列を後ろから順に反映する。
 * 後ろから動かすので、間の人はいったん空いてから受け取ることになり、
 * 「同じ日に 2 回」は起きない。
 */
function applyChain_(ctx, parent, last) {
  var steps = [];
  var cur = last;
  while (parent[cur]) {
    steps.push({ slot: parent[cur].slot, to: cur });
    cur = parent[cur].user;
  }
  steps.forEach(function (s) { place_(ctx, s.slot, s.to); });
}

// ---------------------------------------------------------------- 出力

function toRows_(ctx) {
  var rows = [];
  var index = {};
  ctx.slots.forEach(function (s, i) {
    if (index[s.day] === undefined) {
      index[s.day] = rows.length;
      rows.push({ day: s.day, am: '', pm: ctx.isTwoPart ? '' : null });
    }
    var row = rows[index[s.day]];
    var who = ctx.assign[i] === null ? '' : ctx.assign[i];
    if (s.part === '午後') row.pm = who; else row.am = who;
  });
  return rows;
}

// ==================================================== 06_line.gs
/**
 * LINE Messaging API。
 *
 * 通数は「送信対象の人数 × push の回数」で数える。1 回の push に吹き出しは 5 つまで
 * 入れられるので、同じ相手への連続した知らせは 1 回にまとめる（仕様 2）。
 * ボタンへの返事（reply）は通数に入らない。
 */

var LINE_API = 'https://api.line.me/v2/bot';

/** ボタンへの返事。通数 0 */
function reply_(replyToken, messages) {
  if (!replyToken || !messages || !messages.length) return;
  lineCall_('POST', LINE_API + '/message/reply', {
    replyToken: replyToken,
    messages: messages.slice(0, 5)
  });
}

/**
 * こちらから送る。通数は相手の人数分。
 * 送れたかどうかを返す。届いていないのに「送りました」と言わないため。
 */
function push_(to, messages) {
  if (!to || !messages || !messages.length) return false;
  var res = lineCall_('POST', LINE_API + '/message/push', {
    to: to,
    messages: messages.slice(0, 5)
  });
  return isOk_(res);
}

/** 送れたか。つながらなかったとき（code 0）を成功と数えないこと */
function isOk_(res) {
  return res.code >= 200 && res.code < 300;
}

/** 送信。つながらなかった場合も落とさず、失敗として返す */
function lineCall_(method, url, payload) {
  var options = {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);

  var res;
  try {
    res = UrlFetchApp.fetch(url, options);
  } catch (err) {
    log_('LINE ' + method + ' ' + url + ' → つながりませんでした: ' + err);
    return { code: 0, text: '' };
  }
  var code = res.getResponseCode();
  if (code >= 300) {
    log_('LINE ' + method + ' ' + url + ' → ' + code + ' ' + res.getContentText());
  }
  return { code: code, text: res.getContentText() };
}

/** 1 対 1 の表示名 */
function profileName_(userId) {
  var res = lineCall_('GET', LINE_API + '/profile/' + encodeURIComponent(userId), null);
  return pickName_(res);
}

/** グループでの表示名。無料アカウントでも 1 人ずつなら取れる */
function groupMemberName_(groupId, userId) {
  var res = lineCall_('GET',
    LINE_API + '/group/' + encodeURIComponent(groupId) + '/member/' + encodeURIComponent(userId), null);
  return pickName_(res);
}

function pickName_(res) {
  if (res.code >= 300) return '';
  try {
    return String(JSON.parse(res.text).displayName || '');
  } catch (e) {
    return '';
  }
}

/**
 * メンション付きの文。
 * people: [{userId, name}]
 * 本文の先頭に {u0} {u1} … を置き、その位置にメンションが入る。
 */
function mentionText_(people, body) {
  var keys = [];
  var substitution = {};
  people.forEach(function (p, i) {
    var key = 'u' + i;
    keys.push('{' + key + '}');
    substitution[key] = {
      type: 'mention',
      mentionee: { type: 'user', userId: p.userId }
    };
  });
  return {
    type: 'textV2',
    text: keys.join(' ') + '\n' + body,
    substitution: substitution
  };
}

/** メンションが使えなかったときに送る、名前を並べただけの文 */
function plainMentionText_(people, body) {
  var names = people.map(function (p) { return (p.name || '') + 'さん'; }).join(' ');
  return text_(names + '\n' + body);
}

// ==================================================== 07_ui.gs
/**
 * 画面と文面。
 *
 * ・操作はすべてボタン。文字入力は使わない（仕様 1-21）
 * ・年月は必ず「2026年9月」と書く（仕様 1-2）
 * ・用途を示す具体的な言葉は使わない（仕様 1-1）
 */

// ---------------------------------------------------------------- 部品

function text_(body) {
  return { type: 'text', text: body };
}

function postback_(label, data) {
  return { label: label, data: data };
}

/** 管理者にはいつでも押せるボタンを添える */
function withAdminMenu_(messages) {
  if (!messages.length) return messages;
  messages[messages.length - 1].quickReply = {
    items: [
      quickItem_('開始', 'a=start'),
      quickItem_('状況', 'a=status'),
      quickItem_('中止', 'a=cancel')
    ]
  };
  return messages;
}

function quickItem_(label, data) {
  return { type: 'action', action: { type: 'postback', label: label, data: data } };
}

/**
 * 文とボタンを 1 枚のカードにする。
 * 文がないときは本文の箱をまるごと置かない。中身の空の箱は送れない。
 */
function promptFlex_(altText, lines, actions) {
  var bubble = { type: 'bubble' };
  var body = (lines || []).filter(function (line) { return line; });
  if (body.length) {
    bubble.body = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: body.map(function (line) {
        return { type: 'text', text: line, wrap: true, size: 'md', color: '#333333' };
      })
    };
  }
  if (actions && actions.length) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: actions.map(function (a) {
        return {
          type: 'button',
          style: 'primary',
          color: COLOR.緑,
          height: 'sm',
          action: { type: 'postback', label: a.label, data: a.data }
        };
      })
    };
  }
  return { type: 'flex', altText: altText, contents: bubble };
}

// ---------------------------------------------------------------- カレンダー

/**
 * 1 か月のカレンダーカード。
 * opt: {
 *   altText, ym, title, lines,
 *   marked:[日],            緑にする日
 *   pressable:[日]|null,    押せる日。null なら全部押せる
 *   dataFor:function(day),  押したときの postback
 *   footer:{label, data}
 * }
 */
function calendarFlex_(opt) {
  var D = daysInMonth_(opt.ym);
  var first = firstWeekday_(opt.ym);
  var marked = {};
  (opt.marked || []).forEach(function (d) { marked[d] = true; });
  var pressable = null;
  if (opt.pressable) {
    pressable = {};
    opt.pressable.forEach(function (d) { pressable[d] = true; });
  }

  var head = { type: 'box', layout: 'horizontal', spacing: 'xs', contents: [] };
  WEEKDAY_JP.forEach(function (w, i) {
    head.contents.push({
      type: 'text',
      text: w,
      flex: 1,
      align: 'center',
      size: 'xs',
      weight: 'bold',
      color: i === 0 ? COLOR.日 : (i === 6 ? COLOR.土 : '#8a8a8a')
    });
  });

  var weeks = [];
  var row = [];
  for (var i = 0; i < first; i++) row.push(blankCell_());
  for (var d = 1; d <= D; d++) {
    row.push(dayCell_(d, marked[d] === true, pressable === null || pressable[d] === true, opt.dataFor));
    if (row.length === 7) { weeks.push(weekBox_(row)); row = []; }
  }
  if (row.length) {
    while (row.length < 7) row.push(blankCell_());
    weeks.push(weekBox_(row));
  }

  var body = { type: 'box', layout: 'vertical', spacing: 'sm', contents: [] };
  body.contents.push({
    type: 'text', text: ymLabel_(opt.ym), weight: 'bold', size: 'lg', color: COLOR.ヘッダー背景
  });
  (opt.lines || []).forEach(function (line) {
    body.contents.push({ type: 'text', text: line, wrap: true, size: 'sm', color: '#666666' });
  });
  body.contents.push({ type: 'separator', margin: 'md' });
  body.contents.push(head);
  weeks.forEach(function (w) { body.contents.push(w); });

  var bubble = { type: 'bubble', size: 'giga', body: body };
  if (opt.footer) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color: COLOR.緑,
        height: 'sm',
        action: { type: 'postback', label: opt.footer.label, data: opt.footer.data }
      }]
    };
  }
  return { type: 'flex', altText: opt.altText, contents: bubble };
}

function weekBox_(cells) {
  return { type: 'box', layout: 'horizontal', spacing: 'xs', contents: cells };
}

function blankCell_() {
  return {
    type: 'box', layout: 'vertical', flex: 1, height: '38px',
    contents: [{ type: 'filler' }]
  };
}

function dayCell_(day, isMarked, canPress, dataFor) {
  var cell = {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    height: '38px',
    cornerRadius: '6px',
    justifyContent: 'center',
    backgroundColor: isMarked ? COLOR.緑 : (canPress ? '#ffffff' : '#f7f7f7'),
    borderWidth: '1px',
    borderColor: isMarked ? COLOR.緑 : (canPress ? COLOR.枠線 : '#f0f0f0'),
    contents: [{
      type: 'text',
      text: String(day),
      align: 'center',
      size: 'sm',
      weight: isMarked ? 'bold' : 'regular',
      color: isMarked ? '#ffffff' : (canPress ? '#333333' : '#c6cbd1')
    }]
  };
  if (canPress && dataFor) {
    cell.action = { type: 'postback', data: dataFor(day) };
  }
  return cell;
}

/** 1〜その月の日数のボタン */
function numberGridFlex_(ym) {
  var D = daysInMonth_(ym);
  var rows = [];
  var row = [];
  for (var d = 1; d <= D; d++) {
    row.push(dayCell_(d, false, true, function (n) { return 'a=num&v=' + n; }));
    if (row.length === 7) { rows.push(weekBox_(row)); row = []; }
  }
  if (row.length) {
    while (row.length < 7) row.push(blankCell_());
    rows.push(weekBox_(row));
  }
  return {
    type: 'flex',
    altText: '当番の日数を選んでください',
    contents: {
      type: 'bubble',
      size: 'giga',
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: rows }
    }
  };
}

// ---------------------------------------------------------------- 一覧の文

/** 「Aさん、Bさん」 */
function nameList_(people) {
  return people.map(function (p) { return p.name || '名前未取得'; }).join('、');
}

/** コピーしてグループに送ってもらう文 */
function askCopyText_(pendingPeople, notAddedPeople) {
  var parts = [];
  if (pendingPeople.length) {
    parts.push(pendingPeople.map(function (p) {
      return (p.name || '名前未取得') + 'さん';
    }).join('、') + '、回答お願いします。');
  }
  if (notAddedPeople.length) {
    parts.push(notAddedPeople.map(function (p) {
      return (p.name || '名前未取得') + 'さん';
    }).join('、') + '、Bot の友だち追加をお願いします。');
  }
  return parts.join('');
}

/** 当番表の本文 */
function shiftText_(ym, part, rows) {
  var m = ymMonth_(ym);
  var lines = rows.map(function (r) {
    var head = m + '/' + r.day;
    if (part === PART.二部) {
      return head + '　午前：' + person_(r.am) + '　午後：' + person_(r.pm);
    }
    return head + '　' + person_(r.am);
  });
  return lines.join('\n');
}

function person_(name) {
  if (!name || name === '—') return '—';
  return name + 'さん';
}

/** 決まっていない枠の、コピー用の文 */
function shortageCopyText_(ym, part, rows) {
  var labels = [];
  rows.forEach(function (r) {
    var head = ymLabel_(ym) + r.day + '日';
    if (part !== PART.二部) {
      if (!r.am) labels.push(head);
      return;
    }
    // 午前も午後も決まっていない日は、まとめて 1 つに書く
    if (!r.am && !r.pm) { labels.push(head); return; }
    if (!r.am) labels.push(head + '(午前)');
    if (!r.pm) labels.push(head + '(午後)');
  });
  if (!labels.length) return '';
  return labels.join('、') + 'の担当が決まっていません。ご都合がつく方は連絡をお願いします。';
}

// ==================================================== 08_messages.gs
/**
 * 送る文の一覧。仕様 4〜8 の文面をそのまま置く。
 * 文言を直すときはここだけを見ればよい。
 */

// ---------------------------------------------------------------- 4. 導入

/** 4.2 友だち追加された */
function msgFollowed_() {
  return [text_('友だち追加ありがとうございます。\n当番の相談はこちらに届きます。')];
}

/** 4.3 Bot がグループに招待された */
function msgJoinedGroup_() {
  return [text_('当番の連絡を担当する Bot です。\nこの Bot を友だち追加してください。\n当番の相談はこの Bot から届きます。')];
}

/** 4.4 新しい人がグループに参加した */
function msgMemberJoined_(name) {
  var head = name ? name + 'さん、はじめまして。' : 'はじめまして。';
  return [text_(head + '\n当番の相談を送るため、この Bot を友だち追加してください。')];
}

// ---------------------------------------------------------------- 5. 管理者（前半）

/** 5.1 お知らせ */
function msgNotice_(ym) {
  return withAdminMenu_([
    promptFlex_(ymLabel_(ym) + '分の当番づくりを始めますか？',
      [ymLabel_(ym) + '分の当番づくりを始めますか？'],
      [postback_('開始', 'a=start')])
  ]);
}

/** 選べる対象月。当月・翌月・翌々月 */
function monthChoices_(now) {
  var base = ymOf_(now);
  var next = nextYm_(base);
  return [base, next, nextYm_(next)];
}

/** 5.2 何月分を作るかたずねる。当月・翌月・翌々月から選ぶ */
function msgAskMonth_(now, prefix) {
  var choices = monthChoices_(now);
  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push('何月分の当番づくりをしますか？');
  return withAdminMenu_([
    promptFlex_('何月分の当番づくりをしますか？', lines,
      choices.map(function (ym) {
        return postback_(ymLabel_(ym) + '分', 'a=ym&v=' + ym);
      }))
  ]);
}

/** 5.3 部制をたずねる */
function msgAskPart_(ym, prefix) {
  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push(ymLabel_(ym) + '分の当番づくりを始めます。');
  lines.push('1日の担当人数を選んでください。');
  return withAdminMenu_([
    promptFlex_('1日の担当人数を選んでください', lines, [
      postback_('1部制（1人）', 'a=part&v=1'),
      postback_('2部制（午前・午後）', 'a=part&v=2')
    ])
  ]);
}

/** 5.4 日数をたずねる */
function msgAskCount_(ym, part, prefix) {
  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push(part + 'ですね。');
  lines.push(ymLabel_(ym) + 'の当番の日数を選んでください。');
  return withAdminMenu_([
    text_(lines.join('\n')),
    numberGridFlex_(ym)
  ]);
}

/** 5.5 たたき台のカレンダー */
function msgDraft_(ym, days, isFirst, prefix) {
  var lines = [];
  if (prefix) lines.push(prefix);
  if (isFirst) {
    lines.push(ymLabel_(ym) + 'に' + days.length + '日、均等に散らした案です。');
    lines.push('日付を押すと当番の日を付け外しできます。');
  } else {
    lines.push('いま' + days.length + '日です。');
  }
  lines.push('よければ〔この日程でOK〕を押してください。');

  return withAdminMenu_([
    calendarFlex_({
      altText: ymLabel_(ym) + 'の当番の日',
      ym: ym,
      lines: lines,
      marked: days,
      pressable: null,
      dataFor: function (d) { return 'a=atog&d=' + d; },
      footer: { label: 'この日程でOK', data: 'a=aok' }
    })
  ]);
}

/** 5.5 0 日のまま押された */
function msgNeedOneDay_() {
  return withAdminMenu_([text_('1日以上選んでください。')]);
}

/** 5.6 日程を確定した */
function msgFixed_(ym, days) {
  return withAdminMenu_([
    promptFlex_(ymLabel_(ym) + 'の当番の日を確定しました', [
      ymLabel_(ym) + 'の当番の日を確定しました（' + days.length + '日）。',
      daysLabel_(ym, days),
      'メンバーに都合を聞きます。全員の回答がそろったら当番表を送ります。'
    ], [postback_('状況', 'a=status')])
  ]);
}

// ---------------------------------------------------------------- 6. メンバー

/** 6.1 都合がつく日をたずねるカレンダー */
function msgAskAvailability_(ym, workDays, selected) {
  return [
    calendarFlex_({
      altText: ymLabel_(ym) + 'の当番で都合がつく日を選んでください',
      ym: ym,
      lines: [
        ymLabel_(ym) + 'の当番で、都合がつく日を押してください。',
        '押した日は緑になります。',
        '選び終わったら〔確定〕を押してください。'
      ],
      marked: selected || [],
      pressable: workDays,
      dataFor: function (d) {
        return 'a=mtog&ym=' + ym + '&s=' + daysToMask_(selected || []) + '&d=' + d;
      },
      footer: { label: '確定', data: 'a=mok&ym=' + ym + '&s=' + daysToMask_(selected || []) }
    })
  ];
}

/** 6.1 未追加の人へ、グループでお願いする */
function msgAskFriendAdd_(ym, people) {
  var body = ymLabel_(ym) + 'の当番の相談を送るため、この Bot を友だち追加してください。\n'
    + '追加していただいた方から順にお聞きしています。';
  return { mention: mentionText_(people, body), plain: plainMentionText_(people, body) };
}

/** 6.2 回答を受け付けた */
function msgAnswerTaken_(ym, days) {
  var list = days.length ? daysLabel_(ym, days) : '都合がつく日なし';
  return [text_(
    'ありがとうございます。' + ymLabel_(ym) + 'は次の日で受け付けました。\n'
    + list + '\n'
    + '変えたいときは、もう一度カレンダーで選んで〔確定〕を押してください。'
  )];
}

/** 6.2 1 日も選ばずに確定した 1 回目 */
function msgConfirmZero_(ym) {
  return [
    promptFlex_('都合がつく日がないということでよろしいですか？', [
      '1日も選ばれていません。',
      ymLabel_(ym) + 'は都合がつく日がない、ということでよろしいですか？',
      'よろしければもう一度〔確定〕を押してください。'
    ], [postback_('確定', 'a=mok&ym=' + ym + '&s=0&c=1')])
  ];
}

/** 6.3 受け付けられないとき */
function msgClosed_(ym, isJustAggregated) {
  var body = ymLabel_(ym) + '分の回答は締め切りました。';
  if (isJustAggregated) body += '\n変更は管理者に連絡してください。';
  return [text_(body)];
}

// ---------------------------------------------------------------- 7. 管理者（後半）

/**
 * 7.1 当番表。
 * lead は先頭に添える 1 行。集計が終わった直後と、あとから見に来たときで変わる。
 */
function msgShift_(ym, part, rows, lead) {
  var messages = [];
  var shortage = shortageCopyText_(ym, part, rows);
  if (shortage) {
    messages.push(text_(
      '担当が決まらなかった日があります。\n'
      + '表を直してから〔グループに送る〕を押してください。\n'
      + 'グループで協力を募るときは、次の文をコピーして送ってください。'
    ));
    messages.push(text_(shortage));
  }
  messages.push(text_(
    (lead ? lead + '\n' : '') + ymLabel_(ym) + 'の当番表です。\n' + shiftText_(ym, part, rows)
  ));
  messages.push(promptFlex_(ymLabel_(ym) + 'の当番表', [], [
    postback_('グループに送る', 'a=publish'),
    postback_('担当を入れ替える（表を開く）', 'a=open')
  ]));
  return withAdminMenu_(messages);
}

/** 7.2 表を開く */
function msgOpenSheet_(url) {
  return withAdminMenu_([
    promptFlex_('当番表を開いて担当を直してください', [
      '当番表を開いて担当を直してください。',
      '直したあと〔グループに送る〕を押すと、シートの内容でそのまま送ります。',
      url
    ], [postback_('グループに送る', 'a=publish')])
  ]);
}

/** 7.3 グループへ送る当番表 */
function msgPublish_(ym, part, rows) {
  return [text_(ymLabel_(ym) + 'の当番表です。\n' + shiftText_(ym, part, rows))];
}

/** 7.3 グループに送れなかった */
function msgPublishFailed_() {
  return withAdminMenu_([
    promptFlex_('グループに送れませんでした', [
      'グループに送れませんでした。',
      'しばらく待ってから、もう一度〔グループに送る〕を押してください。'
    ], [
      postback_('グループに送る', 'a=publish'),
      postback_('担当を入れ替える（表を開く）', 'a=open')
    ])
  ]);
}

/** 7.3 当番表が当番の日とそろっていない */
function msgNoShift_(ym, wantCount, gotCount) {
  return withAdminMenu_([
    promptFlex_('当番表を確かめてください', [
      ymLabel_(ym) + 'の当番表が、決めた日程とそろっていません。',
      '決めた日は' + wantCount + '日、表にあるのは' + gotCount + '日です。',
      '行を消したり「日」の欄を書き換えたりしていないか、表を開いて確かめてください。'
    ], [postback_('担当を入れ替える（表を開く）', 'a=open')])
  ]);
}

/** 7.3 グループが登録されていない */
function msgNoGroup_() {
  return withAdminMenu_([
    promptFlex_('送り先のグループがわかりません', [
      '送り先のグループがわかりません。',
      'Bot をグループに招待してください。招待すると送れるようになります。'
    ], [postback_('グループに送る', 'a=publish')])
  ]);
}

/** 7.3 送ったあとの返事 */
function msgPublished_(ym) {
  return withAdminMenu_([text_('グループに送りました。' + ymLabel_(ym) + '分はこれで完了です。')]);
}

// ---------------------------------------------------------------- 8. 途中操作

/** 8.1 締切日の連絡 */
function msgDue_(ym, pendingPeople, notAddedPeople) {
  var lines = [ymLabel_(ym) + 'の回答がまだそろっていません。'];
  if (pendingPeople.length) lines.push('未回答：' + nameList_(pendingPeople));
  if (notAddedPeople.length) lines.push('未追加：' + nameList_(notAddedPeople));
  lines.push('次の文をコピーしてグループに送ってください。');
  return withAdminMenu_([
    text_(lines.join('\n')),
    text_(askCopyText_(pendingPeople, notAddedPeople))
  ]);
}

/** 8.2 状況：何も進めていない */
function msgStatusIdle_() {
  return withAdminMenu_([
    promptFlex_('いま進めているものはありません', ['いま進めているものはありません。'],
      [postback_('開始', 'a=start')])
  ]);
}

/** 8.2 状況：日程を決めている途中 */
function msgStatusPlanning_(ym) {
  var body = ym ? ymLabel_(ym) + '分の日程を決めている途中です。'
                : '何月分を作るか選んでいる途中です。';
  return withAdminMenu_([
    promptFlex_(body, [body], [postback_('中止', 'a=cancel')])
  ]);
}

/** 8.2 状況：回答受付中 */
function msgStatusWaiting_(ym, answeredCount, pendingPeople, notAddedPeople, prefix) {
  var lines = [];
  if (prefix) lines.push(prefix);
  lines.push(ymLabel_(ym) + '分の回答を受け付け中です。');
  var counts = ['回答済み：' + answeredCount + '人'];
  if (pendingPeople.length) counts.push('未回答：' + nameList_(pendingPeople));
  if (notAddedPeople.length) counts.push('未追加：' + nameList_(notAddedPeople));
  lines.push(counts.join('　'));

  var messages = [];
  var copy = askCopyText_(pendingPeople, notAddedPeople);
  if (copy) {
    lines.push('次の文をコピーしてグループに送れます。');
    messages.push(text_(lines.join('\n')));
    messages.push(text_(copy));
  } else {
    messages.push(text_(lines.join('\n')));
  }
  var actions = [];
  if (pendingPeople.length || notAddedPeople.length) {
    actions.push(postback_('この人抜きで進める', 'a=skip'));
  }
  actions.push(postback_('中止', 'a=cancel'));
  messages.push(promptFlex_('操作', [], actions));
  return withAdminMenu_(messages);
}

/** 「Aさん、Bさん」 */
function withSan_(people) {
  return people.map(function (p) {
    return (p.name || '名前未取得') + 'さん';
  }).join('、');
}

/** 8.3 進める前に一度たずねる */
function msgConfirmSkip_(ym, pendingPeople, notAddedPeople) {
  var lines = [];
  if (pendingPeople.length) {
    lines.push(withSan_(pendingPeople) + 'は、' + ymLabel_(ym) + 'は都合がつく日なしとして進めます。');
  }
  if (notAddedPeople.length) {
    lines.push(withSan_(notAddedPeople) + 'は名簿から外します。友だち追加すればまた入ります。');
  }
  lines.push('よろしければもう一度〔この人抜きで進める〕を押してください。');

  // どの月の・何人についての確認だったかをボタンに持たせる。
  // このカードはトークに残り続けるので、あとから押されたときに
  // 別の月の人を巻き込まないようにする
  var data = 'a=skip&c=1&ym=' + ym
    + '&n=' + pendingPeople.length + '&m=' + notAddedPeople.length;

  return withAdminMenu_([
    promptFlex_('この人抜きで進めてよろしいですか？', lines, [
      postback_('この人抜きで進める', data),
      postback_('やめる', 'a=status')
    ])
  ]);
}

/** 8.3 進めた */
function msgSkipped_(ym, pendingPeople, notAddedPeople) {
  var lines = [];
  if (pendingPeople.length) {
    lines.push(withSan_(pendingPeople) + 'を' + ymLabel_(ym) + 'は都合がつく日なしとしました。');
  }
  if (notAddedPeople.length) {
    lines.push(withSan_(notAddedPeople) + 'を名簿から外しました。');
  }
  lines.push('残りの人で当番表を作ります。');
  lines.push('この先ずっと外したいときは、名簿シートでその人の行を削除してください。');
  return withAdminMenu_([text_(lines.join('\n'))]);
}

/** 8.3 全員がいなくなってしまうので進められない */
function msgSkipAll_() {
  return withAdminMenu_([
    promptFlex_('全員がいなくなってしまいます', [
      '進めると当番を割り当てられる人がいなくなります。',
      'このまま待つか、〔中止〕してやり直してください。'
    ], [postback_('中止', 'a=cancel')])
  ]);
}

/** 8.2 状況を押したところで集計が走った */
function msgAggregatedNow_(ym) {
  return withAdminMenu_([
    promptFlex_('当番表を送りました', [
      ymLabel_(ym) + 'の当番表ができました。別のメッセージで送っています。',
      '届いていないときは、もう一度〔状況〕を押してください。'
    ], [postback_('状況', 'a=status')])
  ]);
}

/** 8.2 状況：公開済み */
function msgStatusPublished_(ym) {
  return withAdminMenu_([
    promptFlex_(ymLabel_(ym) + '分は公開済みです', [ymLabel_(ym) + '分は公開済みです。'],
      [postback_('開始', 'a=start')])
  ]);
}

/** 8.4 進行中に開始を押したときの前置き */
function alreadyStartedPrefix_(ym) {
  if (!ym) return 'すでに当番づくりを始めています。続きはこちらです。';
  return 'すでに' + ymLabel_(ym) + '分は開始されています。続きはこちらです。';
}

/** 8.6 混み合って順番が回ってこなかった */
function msgBusy_() {
  return [text_('いま混み合っています。\nもう一度押してください。')];
}

/** 8.5 中止 */
function msgCancelled_() {
  return withAdminMenu_([text_('中止しました。')]);
}

// ==================================================== 09_flow.gs
/**
 * ボタンを押されたときの処理。
 *
 * 状態は処理の最後に 1 回だけ書く。途中で失敗しても中途半端な状態が残らない。
 */

// ---------------------------------------------------------------- 管理者

/** 8.4 開始。進行中ならその段階のカードを出しなおす */
function onStart_(replyToken) {
  var st = state_();

  if (!isRunning_(st) || st.stage === STAGE.公開済み) {
    reply_(replyToken, msgAskMonth_(new Date(), null));
    saveState_({ ym: '', stage: STAGE.対象月待ち, part: '', days: [] });
    return;
  }

  var prefix = alreadyStartedPrefix_(st.ym);
  switch (st.stage) {
    case STAGE.対象月待ち:
      reply_(replyToken, msgAskMonth_(new Date(), prefix));
      return;
    case STAGE.部制待ち:
      reply_(replyToken, msgAskPart_(st.ym, prefix));
      return;
    case STAGE.日数待ち:
      reply_(replyToken, msgAskCount_(st.ym, st.part, prefix));
      return;
    case STAGE.日程編集中:
      reply_(replyToken, msgDraft_(st.ym, st.days, false, prefix));
      return;
    case STAGE.回答受付中:
      reply_(replyToken, statusWaitingMessages_(st.ym, prefix));
      return;
    case STAGE.確認待ち:
      reply_(replyToken, shiftMessages_(st.ym, prefix));
      return;
    default:
      // 状態シートを手で書き換えられて知らない段階になっていたら、始めからやり直す
      clearState_();
      onStart_(replyToken);
  }
}

/**
 * 5.3 何月分を作るかを選んだ。
 * 押した瞬間の翌月を機械が決めると、公開した直後に押したときに同じ月をもう一度
 * 始めてしまったり、お知らせを遅れて押したときに月が飛んだりする。管理者に選ばせる。
 */
function onPickMonth_(replyToken, value) {
  var st = state_();
  if (st.stage !== STAGE.対象月待ち) { onStart_(replyToken); return; }

  // 見せた 3 つ以外は受け付けない。古いカードや壊れた値で
  // 「2026年13月」のような月に進んでしまうのを防ぐ
  if (monthChoices_(new Date()).indexOf(String(value || '')) < 0) {
    reply_(replyToken, msgAskMonth_(new Date(), null));
    return;
  }

  reply_(replyToken, msgAskPart_(value, null));
  saveState_({ ym: value, stage: STAGE.部制待ち, part: '', days: [] });
}

/** 5.4 部制を選んだ */
function onPart_(replyToken, value) {
  var st = state_();
  if (st.stage !== STAGE.部制待ち) { onStart_(replyToken); return; }

  var part = value === '2' ? PART.二部 : PART.一部;
  reply_(replyToken, msgAskCount_(st.ym, part, null));
  saveState_({ ym: st.ym, stage: STAGE.日数待ち, part: part, days: [] });
}

/** 5.5 日数を選んだ。たたき台を出す */
function onCount_(replyToken, value) {
  var st = state_();
  if (st.stage !== STAGE.日数待ち) { onStart_(replyToken); return; }

  var count = parseInt(value, 10);
  if (isNaN(count) || count < 1) { onStart_(replyToken); return; }

  var days = spreadDays_(st.ym, count);
  reply_(replyToken, msgDraft_(st.ym, days, true, null));
  saveState_({ ym: st.ym, stage: STAGE.日程編集中, part: st.part, days: days });
}

/**
 * 5.5 たたき台の日付を押した。
 * 編集の途中を〔開始〕でたどり直せるように、選んでいる日はその都度残す。
 * メンバーには何も送らない。
 */
function onAdminToggle_(replyToken, day) {
  var st = state_();
  if (st.stage !== STAGE.日程編集中) { onStart_(replyToken); return; }
  if (isNaN(day) || day < 1 || day > daysInMonth_(st.ym)) {
    reply_(replyToken, msgDraft_(st.ym, st.days, false, null));
    return;
  }

  var days = st.days.slice();
  var i = days.indexOf(day);
  if (i >= 0) days.splice(i, 1); else days.push(day);
  days.sort(function (a, b) { return a - b; });

  reply_(replyToken, msgDraft_(st.ym, days, false, null));
  saveState_({ ym: st.ym, stage: STAGE.日程編集中, part: st.part, days: days });
}

/** 5.6 この日程でOK。ここで初めてメンバーへ送る */
function onFixDays_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.日程編集中) { onStart_(replyToken); return; }
  if (!st.days.length) { reply_(replyToken, msgNeedOneDay_()); return; }

  // 受付を始める前に、その月の古い回答を消す。
  // 一度作った月をもう一度選び直したとき、前回の回答が「回答済み」として
  // 数えられ、誰か 1 人の確定で集計が走ってしまうのを防ぐ。
  clearAnswers_(st.ym);

  reply_(replyToken, msgFixed_(st.ym, st.days));
  saveState_({ ym: st.ym, stage: STAGE.回答受付中, part: st.part, days: st.days });

  sendCalendars_(st.ym, st.days);
}

/** 追加済みの人へカレンダーを送り、未追加の人にはグループでお願いする */
function sendCalendars_(ym, workDays) {
  members_().forEach(function (p) {
    push_(p.userId, msgAskAvailability_(ym, workDays, []));
  });

  var waiting = notAdded_();
  if (!waiting.length) return;

  var s = settings_();
  if (!s.groupId) return;

  var built = msgAskFriendAdd_(ym, waiting);
  var res = lineCall_('POST', LINE_API + '/message/push', {
    to: s.groupId,
    messages: [built.mention]
  });
  if (!isOk_(res)) push_(s.groupId, [built.plain]);
}

/** 8.2 状況 */
function onStatus_(replyToken) {
  var st = state_();

  // 送信に失敗するなどで集計のきっかけを取りこぼしていた場合の受け皿。
  // ここで集計が走ったら、当番表は集計のなかで送られている。
  // そのまま下へ進むと段階が「確認待ち」になっていて、同じ表をもう一度返してしまう
  if (st.stage === STAGE.回答受付中 && maybeAggregate_()) {
    reply_(replyToken, msgAggregatedNow_(st.ym));
    return;
  }

  st = state_();
  switch (st.stage) {
    case STAGE.対象月待ち:
    case STAGE.部制待ち:
    case STAGE.日数待ち:
    case STAGE.日程編集中:
      reply_(replyToken, msgStatusPlanning_(st.ym));
      return;
    case STAGE.回答受付中:
      reply_(replyToken, statusWaitingMessages_(st.ym, null));
      return;
    case STAGE.確認待ち:
      // 当番表そのものを返す。集計のときの送信に失敗していても、ここで取り出せる
      reply_(replyToken, shiftMessages_(st.ym, '当番表を確認中です。'));
      return;
    case STAGE.公開済み:
      reply_(replyToken, msgStatusPublished_(st.ym));
      return;
    default:
      reply_(replyToken, msgStatusIdle_());
  }
}

function statusWaitingMessages_(ym, prefix) {
  var answered = answersFor_(ym);
  // 数えるのはいまのメンバーだけ。抜けた人の回答は残っているが人数には入れない
  var count = members_().filter(function (p) {
    return Object.prototype.hasOwnProperty.call(answered, p.userId);
  }).length;
  return msgStatusWaiting_(ym, count, pending_(ym), notAdded_(), prefix);
}

/**
 * 8.5 中止。
 * その月の回答も消す。消さないと、同じ月をやり直したときに前回の回答が
 * 「回答済み」として数えられ、誰か 1 人の確定で集計が走ってしまう。
 */
function onCancel_(replyToken) {
  var st = state_();
  // 公開まで終わった月の記録は消さない。誤って押しても失われないように
  var target = (st.stage === STAGE.回答受付中 || st.stage === STAGE.確認待ち) ? st.ym : '';

  clearState_();
  reply_(replyToken, msgCancelled_());
  clearAnswers_(target);   // 時間がかかるので状態と返事のあとに
}

/**
 * 8.3 この人抜きで進める。
 * ブロックされた人や、いつまでも答えない人が残ると集計が走らない。
 * そこから抜け出すための操作。
 *
 * 未回答の人 … その月だけ「都合がつく日なし」として記録する。名簿は触らない
 *              ので、翌月はまた普通にカレンダーが届く
 * 未追加の人 … 名簿から外す。友だち追加し直せばまた入る
 */
function onSkipNotAdded_(replyToken, data) {
  var st = state_();
  if (st.stage !== STAGE.回答受付中) { onStatus_(replyToken); return; }

  var waiting = pending_(st.ym);
  var missing = notAdded_();
  if (!waiting.length && !missing.length) { onStatus_(replyToken); return; }

  // 進めたあとに当番を任せられる人が残らないなら押させない。
  // 「都合がつく日なし」で答えた人は残っても割り当てられないので数に入れない
  var answers = answersFor_(st.ym);
  var usable = members_().filter(function (p) {
    return (answers[p.userId] || []).length > 0;
  }).length;
  if (usable < 1) { reply_(replyToken, msgSkipAll_()); return; }

  // 確認したときと顔ぶれが変わっていたら、もう一度たずねる。
  // 古いカードを別の月で押されたときや、確認のあいだに誰かが友だち追加した
  // ときに、カードに書いていない人を巻き込まないため
  var sameAsAsked = data.c === '1'
    && data.ym === st.ym
    && String(waiting.length) === String(data.n)
    && String(missing.length) === String(data.m);

  if (!sameAsAsked) {
    reply_(replyToken, msgConfirmSkip_(st.ym, waiting, missing));
    return;
  }

  waiting.forEach(function (p) {
    appendAnswer_(st.ym, p.userId, p.name || '', []);
  });
  missing.forEach(function (p) { rosterUpsert_(p.userId, { inGroup: false }); });

  reply_(replyToken, msgSkipped_(st.ym, waiting, missing));
  maybeAggregate_();
}

/** 7.2 表を開く */
function onOpenSheet_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.確認待ち) { onStatus_(replyToken); return; }
  reply_(replyToken, msgOpenSheet_(sheetUrl_(yearSheetName_(st.ym))));
}

/**
 * 7.3 グループに送る。シートの最新内容をそのまま送る。
 * 送れなかったときは段階を進めない。押し直せば送り直せる。
 */
function onPublish_(replyToken) {
  var st = state_();
  if (st.stage !== STAGE.確認待ち) { onStatus_(replyToken); return; }

  var s = settings_();
  if (!s.groupId) { reply_(replyToken, msgNoGroup_()); return; }

  // 表が壊れたまま送ると、見出しだけや 9/NaN の混じった表がグループに届いて
  // しかも公開済みになってしまう。当番の日とそろっているか確かめる
  var shift = readShift_(st.ym);
  var days = shift.rows.map(function (r) { return r.day; });
  if (joinDays_(days) !== joinDays_(st.days)) {
    reply_(replyToken, msgNoShift_(st.ym, st.days.length, days.length));
    return;
  }

  if (!push_(s.groupId, msgPublish_(st.ym, shift.part || st.part, shift.rows))) {
    reply_(replyToken, msgPublishFailed_());
    return;
  }

  reply_(replyToken, msgPublished_(st.ym));
  saveState_({ ym: st.ym, stage: STAGE.公開済み, part: st.part, days: st.days });
}

// ---------------------------------------------------------------- メンバー

/** 6.2 カレンダーの日付を押した。押しただけでは保存しない */
function onMemberToggle_(replyToken, ym, mask, day) {
  var st = state_();
  if (st.stage !== STAGE.回答受付中 || st.ym !== ym) {
    reply_(replyToken, msgClosed_(ym, false));
    return;
  }
  var selected = maskToDays_(toggleInMask_(mask, day));
  reply_(replyToken, msgAskAvailability_(ym, st.days, selected));
}

/** 6.2 確定 */
function onMemberConfirm_(replyToken, userId, ym, mask, confirmedZero) {
  var st = state_();

  if (st.ym !== ym || st.stage !== STAGE.回答受付中) {
    var justAggregated = (st.ym === ym && st.stage !== STAGE.なし);
    reply_(replyToken, msgClosed_(ym, justAggregated));
    return;
  }

  var selected = maskToDays_(mask).filter(function (d) {
    return st.days.indexOf(d) >= 0;
  });

  if (!selected.length && !confirmedZero) {
    reply_(replyToken, msgConfirmZero_(ym));
    return;
  }

  appendAnswer_(ym, userId, nameOf_(userId), selected);
  reply_(replyToken, msgAnswerTaken_(ym, selected));

  maybeAggregate_();
}

// ---------------------------------------------------------------- 集計

/**
 * 6.4 未追加ゼロ かつ 未回答ゼロ になった瞬間に 1 回だけ集計する。
 * メンバーには何も送らない。
 */
function maybeAggregate_() {
  var st = state_();
  if (st.stage !== STAGE.回答受付中) return false;
  if (notAdded_().length) return false;

  var people = members_();
  if (!people.length) return false;
  if (pending_(st.ym).length) return false;

  aggregate_(st);
  return true;
}

/** 割り当てて、シートに書いて、管理者に送る */
function aggregate_(st) {
  if (!st.days.length) return;

  var people = members_();
  var answers = answersFor_(st.ym);
  var ids = people.map(function (p) { return p.userId; });

  var availability = Object.create(null);
  ids.forEach(function (id) { availability[id] = answers[id] || []; });

  var isTwoPart = st.part === PART.二部;
  var assigned = buildShift_(st.days, isTwoPart, availability, ids);

  var nameById = displayNames_(people);

  var rows = assigned.map(function (r) {
    var cands = ids
      .filter(function (id) { return (availability[id] || []).indexOf(r.day) >= 0; })
      .map(function (id) { return nameById[id]; });
    return {
      day: r.day,
      weekday: weekdayOf_(st.ym, r.day),
      am: r.am ? nameById[r.am] : '',
      pm: isTwoPart ? (r.pm ? nameById[r.pm] : '') : '—',
      cands: cands
    };
  });

  writeShift_(st.ym, st.part, rows);

  // 段階を先に進める。送信で失敗しても集計をやり直さないため。
  // やり直すと乱数で割り当てが別物に変わり、管理者に違う当番表が二重に届く。
  // 送れなかったときは管理者が〔状況〕で取り出せる
  saveState_({ ym: st.ym, stage: STAGE.確認待ち, part: st.part, days: st.days });

  var s = settings_();
  if (s.adminId) push_(s.adminId, msgShift_(st.ym, st.part, rows, '全員の回答がそろいました。'));
}

/**
 * 当番表に書く名前を決める。
 *
 * 同じ表示名の人が複数いると、表を見ても誰が誰だか分からず、
 * 「午前と午後が同じ人」の警告も誤って出る。区別できるよう後ろに番号を付ける。
 * 表示名が取れていない人は、LINE の userId を出さずに済ませる。
 */
function displayNames_(people) {
  var seen = Object.create(null);
  var out = Object.create(null);

  people.forEach(function (p) {
    var name = p.name || '名前未取得';
    seen[name] = (seen[name] || 0) + 1;
    out[p.userId] = seen[name] === 1 ? name : name + '(' + seen[name] + ')';
  });
  return out;
}

/** 確認待ちのときに当番表をもう一度出す */
function shiftMessages_(ym, lead) {
  var st = state_();
  var shift = readShift_(ym);
  return msgShift_(ym, shift.part || st.part, shift.rows, lead);
}

// ==================================================== 10_webhook.gs
/**
 * Webhook。LINE から届くイベントの入口。
 *
 * ヘッダが読めないので署名の検証はしない。ウェブアプリの URL が推測できない長さ
 * であることで足りるとする（漏れて困る情報を持たない）。
 */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var events = body.events || [];
    if (events.length) withLock_(events, function () {
      events.forEach(function (ev) {
        try {
          handleEvent_(ev);
        } catch (err) {
          logError_(err);
        }
      });
    });
  } catch (err) {
    logError_(err);
  }
  return ContentService.createTextOutput('OK');
}

/**
 * シートの読み書きが重ならないようにする。
 *
 * 順番が回ってこなかったときは、ボタンを押した人に「もう一度押してください」と返す。
 * LINE は送り直してくれないので、黙って捨てると本人が気づけない。
 * 返すのはボタン（postback）だけ。友だち追加やグループの発言に返すと、
 * 押すもののない人に妙な返事をしたり、グループの雑談に割り込んだりする。
 */
function withLock_(events, fn) {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(20000)) {
    try {
      fn();
    } finally {
      lock.releaseLock();
    }
    return;
  }

  log_('ほかの処理が動いているため見送りました');
  events.forEach(function (ev) {
    // 名簿を書くだけのイベントは捨てない。
    // 捨てるとその人が名簿に載らず、未追加のまま集計を止め続ける。
    // 同じ人の行を上書きするだけなので、重なっても壊れない
    if (ROSTER_EVENTS[ev.type]) {
      try {
        handleEvent_(ev);
      } catch (err) {
        logError_(err);
      }
      return;
    }
    if (ev.type === 'postback' && ev.replyToken) reply_(ev.replyToken, msgBusy_());
  });
}

/** 名簿を書くだけのイベント */
var ROSTER_EVENTS = {
  follow: true,
  unfollow: true,
  join: true,
  memberJoined: true,
  memberLeft: true
};

function handleEvent_(ev) {
  switch (ev.type) {
    case 'follow':      return onFollow_(ev);
    case 'unfollow':    return onUnfollow_(ev);
    case 'join':        return onJoin_(ev);
    case 'memberJoined': return onMemberJoined_(ev);
    case 'memberLeft':  return onMemberLeft_(ev);
    case 'postback':    return onPostback_(ev);
    case 'message':     return onMessage_(ev);
    default:            return;
  }
}

// ---------------------------------------------------------------- 名簿に関わるもの

/** 4.2 友だち追加された */
function onFollow_(ev) {
  var userId = ev.source && ev.source.userId;
  if (!userId) return;

  var name = profileName_(userId);
  rosterUpsert_(userId, { name: name, friend: true, inGroup: true });

  var messages = msgFollowed_();
  var st = state_();
  if (st.stage === STAGE.回答受付中 && !hasAnswered_(st.ym, userId)) {
    messages = messages.concat(msgAskAvailability_(st.ym, st.days, []));
  }
  reply_(ev.replyToken, messages);

  // この人が最後の未追加者だったなら、これでそろう
  maybeAggregate_();
}

/** 友だち追加を外された。こちらからは送れないので記録だけ */
function onUnfollow_(ev) {
  var userId = ev.source && ev.source.userId;
  if (!userId) return;
  rosterUpsert_(userId, { friend: false });
}

/** 4.3 Bot がグループに招待された */
function onJoin_(ev) {
  var groupId = ev.source && ev.source.groupId;
  if (groupId) setSetting_('グループID', groupId);
  reply_(ev.replyToken, msgJoinedGroup_());
}

/** 4.4 新しい人がグループに参加した */
function onMemberJoined_(ev) {
  var groupId = ev.source && ev.source.groupId;
  var joined = (ev.joined && ev.joined.members) || [];
  var names = [];

  var any = false;
  joined.forEach(function (m) {
    if (!m.userId) return;
    var name = groupId ? groupMemberName_(groupId, m.userId) : '';
    rosterUpsert_(m.userId, { name: name, inGroup: true });
    any = true;
    if (name) names.push(name);   // 名前が取れなかった人は並べない
  });

  if (any) reply_(ev.replyToken, msgMemberJoined_(names.join('さん、')));
}

/** 4.5 グループを抜けた。何も送らない */
function onMemberLeft_(ev) {
  var left = (ev.left && ev.left.members) || [];
  left.forEach(function (m) {
    if (m.userId) rosterUpsert_(m.userId, { inGroup: false });
  });
  // 抜けたことで残りがそろうことがある
  maybeAggregate_();
}

// ---------------------------------------------------------------- ボタン

function onPostback_(ev) {
  var data = parseData_(ev.postback && ev.postback.data);
  var userId = ev.source && ev.source.userId;
  var isAdmin = userId && userId === settings_().adminId;

  switch (data.a) {
    // メンバーの操作。誰でも押せる
    case 'mtog':
      return onMemberToggle_(ev.replyToken, data.ym, data.s, parseInt(data.d, 10));
    case 'mok':
      return onMemberConfirm_(ev.replyToken, userId, data.ym, data.s, data.c === '1');
  }

  // ここから先は管理者だけ。ほかの人にはボタン自体が出ないので何も返さない
  if (!isAdmin) return;

  switch (data.a) {
    case 'start':   return onStart_(ev.replyToken);
    case 'status':  return onStatus_(ev.replyToken);
    case 'cancel':  return onCancel_(ev.replyToken);
    case 'skip':    return onSkipNotAdded_(ev.replyToken, data);
    case 'ym':      return onPickMonth_(ev.replyToken, data.v);
    case 'part':    return onPart_(ev.replyToken, data.v);
    case 'num':     return onCount_(ev.replyToken, data.v);
    case 'atog':    return onAdminToggle_(ev.replyToken, parseInt(data.d, 10));
    case 'aok':     return onFixDays_(ev.replyToken);
    case 'open':    return onOpenSheet_(ev.replyToken);
    case 'publish': return onPublish_(ev.replyToken);
  }
}

/** 'a=start&v=1' → {a:'start', v:'1'} */
function parseData_(raw) {
  var out = {};
  String(raw || '').split('&').forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf('=');
    if (i < 0) { out[pair] = ''; return; }
    out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  return out;
}

// ---------------------------------------------------------------- そのほかの発言

/**
 * 文字入力は使わない決まりだが、押すものを見失ったときの戻り道は用意しておく。
 * 管理者には状況を返し、メンバーには受付中ならカレンダーを出しなおす（どちらも通数 0）。
 */
function onMessage_(ev) {
  var source = ev.source || {};
  if (source.type !== 'user') return;

  var userId = source.userId;
  if (!userId) return;

  if (userId === settings_().adminId) {
    onStatus_(ev.replyToken);
    return;
  }

  var st = state_();
  if (st.stage === STAGE.回答受付中) {
    var p = rosterFind_(userId);
    if (p && p.inGroup && p.friend) {
      reply_(ev.replyToken, msgAskAvailability_(st.ym, st.days, []));
    }
  }
}

// ==================================================== 11_daily.gs
/**
 * 定時処理。毎日 9 時台に動くトリガーを 1 本だけ置く。
 *
 * 送るのは「お知らせ」と「締切の連絡」だけ。当番づくりは一切進めない（仕様 1-24）。
 * 再通知はしない。
 */

function daily() {
  var now = new Date();
  var day = Number(Utilities.formatDate(now, TZ, 'd'));
  var s = settings_();

  if (day === s.noticeDay) sendNotice_(now, s);
  if (day === s.dueDay) sendDue_(now, s);
}

/** 5.1 来月分を始めるかどうかのお知らせ */
function sendNotice_(now, s) {
  if (!s.adminId) return;
  push_(s.adminId, msgNotice_(targetYm_(now)));
}

/** 8.1 締切日の朝。まだそろっていなければ 1 回だけ */
function sendDue_(now, s) {
  if (!s.adminId) return;

  var st = state_();
  if (st.stage !== STAGE.回答受付中) return;

  var waiting = pending_(st.ym);
  var missing = notAdded_();
  if (!waiting.length && !missing.length) return;

  push_(s.adminId, msgDue_(st.ym, waiting, missing));
}
