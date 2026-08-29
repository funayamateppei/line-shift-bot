/**
 * 設定。
 *
 * 秘密の 2 つは**スクリプト プロパティ**に置く。GAS エディタの
 * 〔プロジェクトの設定〕→〔スクリプト プロパティ〕で人が入れる。
 *
 *   SPREADSHEET_ID       スプレッドシートの URL の /d/ と /edit の間
 *   CHANNEL_ACCESS_TOKEN LINE Developers → Messaging API 設定 →
 *                        チャネルアクセストークン（長期）を発行
 *
 * コードに書かないのは、隠すためではない（スクリプトを開ける人はプロパティも読める）。
 * 直すたびに dist/コード.gs を貼り直す作りなので、コードに書くと**貼り直すたびに
 * 2 行を入れ直す**ことになり、入れ忘れれば全部落ち、古いトークンを貼れば LINE だけが黙る。
 *
 * 運用で変わる値（管理者ID・グループID・お知らせ日・締切日）は「設定」シートに置く。
 * シートを直せば再デプロイなしで反映される。
 */

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

/**
 * スクリプト プロパティを 1 つ読む。
 *
 * 1 回の実行のあいだに book_() は何十回も呼ばれる。まとめて 1 回だけ読み、あとは
 * 変数から返す（1 つずつ getProperty を呼ぶと、その回数だけ往復する）。実行が
 * 終われば変数も消えるので、プロパティを替えたのに古い値のまま、ということは起きない。
 *
 * 空なら落とす。空のまま進むと openById('') の「見つかりません」や LINE の 401 になり、
 * どこを直せばいいのか分からなくなる。
 */
var props_ = null;

function prop_(name) {
  if (!props_) props_ = PropertiesService.getScriptProperties().getProperties();
  var value = String(props_[name] || '').trim();
  if (!value) {
    throw new Error('スクリプト プロパティ「' + name + '」が空です。GAS エディタの'
      + '〔プロジェクトの設定〕→〔スクリプト プロパティ〕で入れてください。');
  }
  return value;
}

/** スプレッドシートを開く */
function book_() {
  return SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));
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
    webhookSecret: map['webhook合言葉'] || ''
  };
}

/**
 * ウェブアプリ（カレンダーを開く画面）の URL。まだ公開していなければ空。
 *
 * webhook や画面の処理中に呼べば、公開した URL（/exec）が返る。
 * ところが**エディタから実行したときは開発モードの URL（/dev）が返る**。
 * /dev は自分が Google にログインしているときしか開けないので、LINE にも
 * メンバーにも渡せない。/exec とは ID そのものが違うので作り替えもできない。
 * 空として扱い、「画面をひらけませんでした」と言わせる。
 */
function webAppUrl_() {
  var url;
  try {
    url = String(ScriptApp.getService().getUrl() || '');
  } catch (e) {
    log_('ウェブアプリの URL が取れませんでした: ' + e);
    return '';
  }
  if (/\/dev$/.test(url)) return '';
  return url;
}

/**
 * LINE に登録する Webhook URL。合言葉つき。
 * エディタから実行したときは組み立てられない（上のとおり）ので空を返す。
 */
function webhookUrl_() {
  var base = webAppUrl_();
  if (!base) return '';
  return base + '?w=' + encodeURIComponent(settings_().webhookSecret);
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
  return 'https://docs.google.com/spreadsheets/d/' + prop_('SPREADSHEET_ID') + '/edit#gid=' + gid;
}

function log_(message) {
  console.log(message);
}

function logError_(err) {
  console.error(err && err.stack ? err.stack : String(err));
}
