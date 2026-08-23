/**
 * 計算ロジックの検証。
 *   ・当番の日は等間隔になっているか
 *   ・割り当ては「埋める」「均等」を総当たりの最適と同じところまで満たしているか
 */
const { load, seeded } = require('./harness');

const ctx = load(['00_config.gs', '02_dates.gs', '04_plan.gs', '05_assign.gs'], {
  SpreadsheetApp: {},
  console
});

let failures = 0;
function check(name, ok, detail) {
  if (!ok) {
    failures++;
    console.log('NG  ' + name + (detail ? '  ' + detail : ''));
  }
}
function section(name) { console.log('--- ' + name); }

// ---------------------------------------------------------------- 等間隔

section('当番の日は等間隔か');
{
  let cases = 0;
  for (const ym of ['2026-02', '2026-04', '2026-09', '2026-12', '2027-01']) {
    const D = ctx.daysInMonth_(ym);
    for (let n = 1; n <= D; n++) {
      for (let seed = 1; seed <= 30; seed++) {
        const days = ctx.spreadDays_(ym, n, seeded(seed * 7919 + n));
        cases++;
        check('日数が合う', days.length === n, `${ym} n=${n} → ${days.length}`);
        check('月内に収まる', days.every(d => d >= 1 && d <= D), `${ym} ${days}`);
        check('重複なし', new Set(days).size === days.length, `${ym} ${days}`);
        check('昇順', days.every((d, i) => i === 0 || d > days[i - 1]), `${ym} ${days}`);

        const q = Math.floor(D / n);
        const gaps = days.slice(1).map((d, i) => d - days[i]);
        check('間隔は q か q+1 だけ',
          gaps.every(g => g === q || g === q + 1),
          `${ym} n=${n} q=${q} gaps=${gaps}`);
      }
    }
  }
  console.log(`    ${cases} 通り`);
}

section('広い間隔と開始位置がばらけるか');
{
  // 30 日を 4 日に分けると 8,8,7,7。並びが固定だと前だけ広くなってしまう
  const firstGaps = new Set();
  const starts = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const days = ctx.spreadDays_('2026-09', 4, seeded(seed));
    firstGaps.add(days[1] - days[0]);
    starts.add(days[0]);
  }
  check('広い間隔が前に固まらない', firstGaps.size > 1, `先頭の間隔 = ${[...firstGaps]}`);
  check('開始位置がばらける', starts.size > 1, `開始日 = ${[...starts]}`);
}

// ---------------------------------------------------------------- 割り当て

section('割り当ては総当たりの最適と一致するか');

/** 総当たりで「埋めた数の最大」と、そのときの「担当回数の差の最小」を求める */
function brute(workDays, isTwoPart, availability, members) {
  const slots = [];
  workDays.forEach(d => {
    if (isTwoPart) { slots.push({ day: d, part: 'am' }); slots.push({ day: d, part: 'pm' }); }
    else slots.push({ day: d, part: 'am' });
  });
  const cand = slots.map(s => members.filter(u => availability[u].includes(s.day)));

  let bestFill = -1;
  let bestSpread = Infinity;

  const pick = new Array(slots.length).fill(null);
  (function rec(i) {
    if (i === slots.length) {
      const load = {};
      members.forEach(u => (load[u] = 0));
      let fill = 0;
      for (const u of pick) if (u !== null) { load[u]++; fill++; }
      const vals = members.map(u => load[u]);
      const spread = Math.max(...vals) - Math.min(...vals);
      if (fill > bestFill) { bestFill = fill; bestSpread = spread; }
      else if (fill === bestFill && spread < bestSpread) { bestSpread = spread; }
      return;
    }
    // 空欄のまま
    pick[i] = null;
    rec(i + 1);
    // 誰かを入れる（同じ日に二重で入らないこと）
    for (const u of cand[i]) {
      let dup = false;
      for (let j = 0; j < i; j++) {
        if (pick[j] === u && slots[j].day === slots[i].day) { dup = true; break; }
      }
      if (dup) continue;
      pick[i] = u;
      rec(i + 1);
    }
    pick[i] = null;
  })(0);

  return { fill: bestFill, spread: bestSpread };
}

function measure(rows, members, isTwoPart) {
  const load = {};
  members.forEach(u => (load[u] = 0));
  let fill = 0;
  rows.forEach(r => {
    [r.am, r.pm].forEach(u => {
      if (u === null || u === undefined || u === '') return;
      load[u]++; fill++;
    });
  });
  const vals = members.map(u => load[u]);
  return { fill, spread: Math.max(...vals) - Math.min(...vals), load };
}

{
  let cases = 0, fillGap = 0, spreadGap = 0, dup = 0, illegal = 0;

  const memberSets = [['A', 'B'], ['A', 'B', 'C']];
  const dayCounts = [1, 2, 3];

  for (const members of memberSets) {
    for (const nDays of dayCounts) {
      const workDays = [];
      for (let i = 0; i < nDays; i++) workDays.push(2 + i * 3);

      // 各メンバーが「出られる日」の全パターン
      const patterns = [];
      const total = 1 << nDays;
      (function build(idx, acc) {
        if (idx === members.length) { patterns.push(acc.slice()); return; }
        for (let mask = 0; mask < total; mask++) { acc.push(mask); build(idx + 1, acc); acc.pop(); }
      })(0, []);

      for (const twoPart of [false, true]) {
        for (const pat of patterns) {
          const availability = {};
          members.forEach((u, i) => {
            availability[u] = workDays.filter((d, k) => (pat[i] >> k) & 1);
          });

          const rows = ctx.buildShift_(workDays, twoPart, availability, members, seeded(cases + 1));
          const got = measure(rows, members, twoPart);
          const want = brute(workDays, twoPart, availability, members);
          cases++;

          if (got.fill !== want.fill) fillGap++;
          if (got.spread !== want.spread) spreadGap++;

          rows.forEach(r => {
            if (twoPart && r.am && r.pm && r.am === r.pm) dup++;
            [r.am, r.pm].forEach(u => {
              if (u && !availability[u].includes(r.day)) illegal++;
            });
          });
        }
      }
    }
  }

  console.log(`    ${cases} 通り`);
  check('入れられるのに空いている枠がない', fillGap === 0, `${fillGap} 件`);
  check('担当回数の差が最小', spreadGap === 0, `${spreadGap} 件`);
  check('同じ日に同じ人が二重で入らない', dup === 0, `${dup} 件`);
  check('出られない日に入っていない', illegal === 0, `${illegal} 件`);
}

section('人数を増やしても埋め残しがないか');
{
  // 1 日の枠は多くても 2 つで日どうしは干渉しないので、貪欲法だけで最大まで埋まるはず
  const members = ['A', 'B', 'C', 'D'];
  const workDays = [2, 5, 8];
  const total = 1 << workDays.length;
  let cases = 0, gap = 0;

  const fillOf = rows => rows.reduce((n, r) => n + (r.am ? 1 : 0) + (r.pm ? 1 : 0), 0);

  for (let a = 0; a < total; a++)
    for (let b = 0; b < total; b++)
      for (let c = 0; c < total; c++)
        for (let d = 0; d < total; d++) {
          const availability = {};
          [a, b, c, d].forEach((mask, i) => {
            availability[members[i]] = workDays.filter((_, k) => (mask >> k) & 1);
          });
          for (const twoPart of [false, true]) {
            for (let seed = 1; seed <= 2; seed++) {
              const rows = ctx.buildShift_(workDays, twoPart, availability, members,
                seeded(seed * 131 + a * 7 + b * 3 + c));
              cases++;
              if (fillOf(rows) !== brute(workDays, twoPart, availability, members).fill) gap++;
            }
          }
        }
  console.log(`    ${cases} 通り`);
  check('埋め残しがない', gap === 0, `${gap} 件`);
}

section('担当回数の差が最小になるか（別の考え方で検算）');
{
  // 実装とは別の考え方で最適を出す。
  // 日どうしは独立なので、1 日ずつ「誰を入れるか」を全部試しながら
  // 担当回数の組み合わせを持ち回る。埋める数は日ごとに min(枠数, 出られる人数)
  // で決まるので、そのうえで「最大−最小」が一番小さいものを選ぶ。
  function bestSpread(workDays, twoPart, availability, members) {
    const slots = twoPart ? 2 : 1;
    let states = new Map();
    states.set(members.map(() => 0).join(','), members.map(() => 0));

    for (const day of workDays) {
      const avail = members.filter(u => availability[u].includes(day));
      const take = Math.min(slots, avail.length);
      const combos = [];
      (function pick(start, acc) {
        if (acc.length === take) { combos.push(acc.slice()); return; }
        for (let i = start; i < avail.length; i++) { acc.push(avail[i]); pick(i + 1, acc); acc.pop(); }
      })(0, []);

      const next = new Map();
      for (const load of states.values()) {
        for (const combo of combos) {
          const nl = load.slice();
          combo.forEach(u => nl[members.indexOf(u)]++);
          next.set(nl.join(','), nl);
        }
      }
      states = next;
    }
    let best = Infinity;
    for (const load of states.values()) best = Math.min(best, Math.max(...load) - Math.min(...load));
    return best;
  }

  const spreadOf = (rows, members) => {
    const l = {}; members.forEach(u => (l[u] = 0));
    rows.forEach(r => { if (r.am) l[r.am]++; if (r.pm) l[r.pm]++; });
    const v = members.map(u => l[u]);
    return Math.max(...v) - Math.min(...v);
  };

  let cases = 0, bad = 0, example = null;
  for (const nMembers of [3, 4]) {
    const members = [...Array(nMembers).keys()].map(i => 'U' + i);
    for (const nDays of [4, 5, 6]) {
      const workDays = [...Array(nDays).keys()].map(i => 1 + i * 2);
      const total = 1 << nDays;
      for (let iter = 0; iter < 800; iter++) {
        const rnd = seeded(iter * 7919 + nMembers * 131 + nDays);
        const availability = {};
        members.forEach(u => {
          const m = Math.floor(rnd() * total);
          availability[u] = workDays.filter((_, k) => (m >> k) & 1);
        });
        for (const twoPart of [false, true]) {
          const rows = ctx.buildShift_(workDays, twoPart, availability, members, seeded(iter * 31 + 7));
          const got = spreadOf(rows, members);
          const want = bestSpread(workDays, twoPart, availability, members);
          cases++;
          if (got !== want && !example) example = { availability, workDays, twoPart, got, want };
          if (got !== want) bad++;
        }
      }
    }
  }
  console.log(`    ${cases} 通り`);
  check('担当回数の差が最小', bad === 0, `${bad} 件  例=${JSON.stringify(example)}`);
}

section('重い条件でも止まるか');
{
  // 31 日ぜんぶ当番・2部制・20 人。GAS の実行時間に収まる必要がある
  const workDays = [...Array(31).keys()].map(i => i + 1);
  const members = [...Array(20).keys()].map(i => 'U' + i);
  let maxSteps = 0;
  for (let iter = 0; iter < 50; iter++) {
    const rnd = seeded(iter * 7919);
    const availability = {};
    members.forEach(u => { availability[u] = workDays.filter(() => rnd() < 0.15); });
    const c = ctx.newContext_(workDays, true, availability, members);
    ctx.fillGreedy_(c, seeded(iter + 1));
    maxSteps = Math.max(maxSteps, ctx.balance_(c));
  }
  check('受け渡しが打ち切りに達しない', maxSteps < 5000, `最大 ${maxSteps} 回`);
  console.log(`    受け渡しの最大回数 ${maxSteps} 回`);
}

section('同じ日が重なって書かれていても壊れないか');
{
  // 状態シートを手で「2,2,5」のように直された場合
  const rows = ctx.buildShift_([2, 2, 5], true, { A: [2, 5], B: [2, 5] }, ['A', 'B'], seeded(1));
  check('重なった日はひとつにまとめる', rows.length === 2, JSON.stringify(rows));
  const day2 = rows.find(r => r.day === 2);
  check('重なっても担当が消えない', !!day2.am && !!day2.pm, JSON.stringify(day2));
  check('午前と午後は別人', day2.am !== day2.pm, JSON.stringify(day2));
}

console.log(failures === 0 ? '\nすべて通過' : `\n${failures} 件の不一致`);
process.exit(failures === 0 ? 0 : 1);
