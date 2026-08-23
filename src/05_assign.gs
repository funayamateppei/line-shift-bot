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
