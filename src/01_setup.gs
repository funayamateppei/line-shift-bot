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
  var sh = sheet_(SHEET.設定);
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
  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 340);
  sh.setColumnWidth(3, 360);
  sh.setTabColor('#f5c333');
  return sh;
}

// ---------------------------------------------------------------- 名簿

function ensureRosterSheet_() {
  var sh = sheet_(SHEET.名簿);
  if (!isNewSheet_(sh)) return sh;

  sh.getRange(1, 1, 1, 5).setValues([['userId', '表示名', '在籍', '友だち追加', '更新日時']]);
  styleHeader_(sh, 5);
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 140);
  sh.setColumnWidth(3, 100);
  sh.setColumnWidth(4, 100);
  sh.setColumnWidth(5, 160);

  var flags = sh.getRange(2, 3, 999, 2);
  flags.insertCheckboxes();
  flags.setHorizontalAlignment('center');
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
  var sh = sheet_(SHEET.状態);
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
  sh.setTabColor('#999999');
  return sh;
}

// ---------------------------------------------------------------- 回答ログ

function ensureAnswerSheet_() {
  var sh = sheet_(SHEET.回答ログ);
  if (!isNewSheet_(sh)) return sh;

  sh.getRange(1, 1, 1, 5).setValues([['日時', '対象年月', 'userId', '表示名', '都合がつく日']]);
  styleHeader_(sh, 5);
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 300);
  sh.setColumnWidth(4, 140);
  sh.setColumnWidth(5, 220);
  sh.getRange(2, 3, 999, 1).setFontSize(10).setFontColor(COLOR.補足文字);
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

  sh = book.insertSheet(name);
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
    // 月の見出し行（日が空）
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$B2=""')
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
