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

console.log(failures === 0 ? '\nすべて通過' : `\n${failures} 件の不一致`);
process.exit(failures === 0 ? 0 : 1);
