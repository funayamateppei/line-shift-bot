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
