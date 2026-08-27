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

/**
 * セルから対象年月を読む。
 *
 * 「2026-09」はスプレッドシートが日付として解釈することがあり、そのとき
 * getValues() は文字列ではなく Date を返す。素直に String() すると
 * 「Tue Sep 01 2026 …」になって照合が通らず、回答が 1 件も拾えなくなる。
 * 書き込み側で表示形式を守っていても、手で直されれば同じことが起きる。
 */
function ymOfCell_(v) {
  // instanceof は実行領域が違うと偽になる。中身で判定する
  if (Object.prototype.toString.call(v) === '[object Date]') return ymOf_(v);
  return String(v === null || v === undefined ? '' : v).trim();
}

/**
 * セルから「2026年9月」の見出しを読む。
 *
 * 日本語のスプレッドシートは「2026年9月」も日付として解釈する。
 * ymOfCell_ と同じ理由で、Date で返ってきたら文字列に戻してから比べる。
 */
function ymLabelOfCell_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return ymLabel_(ymOf_(v));
  return String(v === null || v === undefined ? '' : v).trim();
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
