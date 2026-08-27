/**
 * 設定。
 *
 * 書き換えるのは下の 2 つだけ。運用で変わる値（管理者ID・グループID・お知らせ日・
 * 締切日）は「設定」シートに置く。シートを直せば再デプロイなしで反映される。
 */

// ===== ここだけ書き換える（空のまま置いてあります）=====
// SPREADSHEET_ID       スプレッドシートの URL の /d/ と /edit の間
// CHANNEL_ACCESS_TOKEN LINE Developers → Messaging API 設定 →
//                      チャネルアクセストークン（長期）を発行
var SPREADSHEET_ID = '';
var CHANNEL_ACCESS_TOKEN = '';
// =====================================================

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
    dueDay: toInt_(map['締切日'], DEFAULT_DUE_DAY),
    webhookSecret: map['webhook合言葉'] || '',
    entryUrl: map['入口URL'] || ''
  };
}

/**
 * ウェブアプリ（カレンダーを開く画面）の URL。
 *
 * ふつうは自分で自分の URL を取れる。取れないとき（デプロイのしかたによっては
 * 空が返る）のために、設定シートの「入口URL」で上書きできるようにしておく。
 */
function webAppUrl_() {
  var fixed = settings_().entryUrl;
  if (fixed) return fixed;
  try {
    return String(ScriptApp.getService().getUrl() || '');
  } catch (e) {
    log_('ウェブアプリの URL が取れませんでした: ' + e);
    return '';
  }
}

/**
 * その人だけの入口 URL。
 * 鍵が無い／URL が取れないときは空を返す。空のまま uri ボタンは作れない。
 *
 * base を渡すと URL を引き直さない。人数ぶんまとめて作るときは渡すこと
 * （webAppUrl_ は毎回 設定 シートを読む）。
 */
function entryUrl_(key, base) {
  var url = base === undefined ? webAppUrl_() : base;
  if (!url || !key) return '';
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(key);
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
