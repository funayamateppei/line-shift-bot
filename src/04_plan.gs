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
