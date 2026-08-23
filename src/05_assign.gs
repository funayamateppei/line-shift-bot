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
 * 「その人がその日に入っている」という状態を (人, 日) という 1 回きりの席と見ると、
 * 枠と席の組み合わせ問題になる。埋める数を最大にしてから、席を付け替えて回数を均す。
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

  fillGreedy_(ctx, random);   // まず入れられるところに入れる
  fillMaximum_(ctx);          // 付け替えで埋まる枠が残っていれば埋める
  balance_(ctx);              // 回数を均す（埋まった枠は空けない）

  return toRows_(ctx);
}

function newContext_(workDays, isTwoPart, availability, memberIds) {
  var slots = [];
  workDays.slice().sort(function (a, b) { return a - b; }).forEach(function (day) {
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

  var load = {};
  memberIds.forEach(function (u) { load[u] = 0; });

  return {
    slots: slots,
    cand: cand,
    assign: slots.map(function () { return null; }),
    seat: {},          // '日#userId' → 埋めている枠の番号
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

/** 候補が少ない枠から、担当回数が最も少ない人を入れる */
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

/**
 * まだ空いている枠について、席の付け替えでたどれるところまでたどり、
 * 空いた席が見つかれば連鎖的にずらして埋める。
 * これで「入れられるのに空いている枠」は残らない。
 */
function fillMaximum_(ctx) {
  for (var i = 0; i < ctx.slots.length; i++) {
    if (ctx.assign[i] !== null) continue;
    tryTakeSeat_(ctx, i, {});
  }
}

function tryTakeSeat_(ctx, i, visited) {
  var day = ctx.slots[i].day;
  var cands = ctx.cand[i];
  for (var k = 0; k < cands.length; k++) {
    var key = seatKey_(day, cands[k]);
    if (visited[key]) continue;
    visited[key] = true;

    var holder = ctx.seat[key];
    if (holder === undefined || tryTakeSeat_(ctx, holder, visited)) {
      place_(ctx, i, cands[k]);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- 2. 均等

/** 差が 1 以下になるまで、玉突きで担当を渡す */
function balance_(ctx) {
  for (var guard = 0; guard < 2000; guard++) {
    if (!handOver_(ctx)) return;
  }
}

/**
 * 担当が最も多い人から最も少ない人へ 1 回渡せないか探す。
 * 直接渡せなくても、間に人をはさんだ受け渡し（玉突き）でよい。
 * 渡せたら true。
 */
function handOver_(ctx) {
  var users = Object.keys(ctx.load);
  if (!users.length) return false;

  var max = -Infinity;
  var min = Infinity;
  users.forEach(function (u) {
    if (ctx.load[u] > max) max = ctx.load[u];
    if (ctx.load[u] < min) min = ctx.load[u];
  });
  if (max - min < 2) return false;

  var from = {};
  var queue = [];
  users.forEach(function (u) {
    if (ctx.load[u] === max) { from[u] = null; queue.push(u); }
  });

  while (queue.length) {
    var u = queue.shift();

    for (var i = 0; i < ctx.slots.length; i++) {
      if (ctx.assign[i] !== u) continue;
      var day = ctx.slots[i].day;

      var cands = ctx.cand[i];
      for (var k = 0; k < cands.length; k++) {
        var v = cands[k];
        if (v === u) continue;
        if (from[v] !== undefined) continue;
        if (ctx.seat[seatKey_(day, v)] !== undefined) continue;

        from[v] = { user: u, slot: i };
        if (ctx.load[v] <= max - 2) {
          applyChain_(ctx, from, v);
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
function applyChain_(ctx, from, last) {
  var steps = [];
  var cur = last;
  while (from[cur]) {
    steps.push({ slot: from[cur].slot, to: cur });
    cur = from[cur].user;
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
