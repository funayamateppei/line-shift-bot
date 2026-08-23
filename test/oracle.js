/**
 * 割り当ての最適値を「流量（フロー）」で求める検算器。実装とは別の考え方で解く。
 *
 * 実装は「候補が少ない枠から埋めて、あとから玉突きで均す」局所的な手続き。
 * こちらは全体を 1 つの流れとみなして解くので、同じ思い込みを共有しない。
 * 多項式時間なので 31 日 20 人でも検算できる（担当回数の全列挙は 4 人 6 日が限界）。
 *
 *   ・その日に埋まる数は take = min(枠数, 出られる人数)。日どうしは干渉しない
 *   ・「全員の担当回数を lo 以上 hi 以下に収められるか」を下限つき流量で判定する
 *   ・幅 s を 0 から広げ、最初に収まった s が「担当回数の差」の最小値
 */

class Dinic {
  constructor(n) {
    this.n = n; this.to = []; this.cap = [];
    this.head = Array.from({ length: n }, () => []);
  }
  add(u, v, c) {
    this.head[u].push(this.to.length); this.to.push(v); this.cap.push(c);
    this.head[v].push(this.to.length); this.to.push(u); this.cap.push(0);
  }
  maxflow(s, t) {
    let flow = 0;
    for (;;) {
      const lv = new Array(this.n).fill(-1);
      lv[s] = 0;
      const q = [s];
      for (let qi = 0; qi < q.length; qi++) {
        for (const e of this.head[q[qi]]) {
          if (this.cap[e] > 0 && lv[this.to[e]] < 0) { lv[this.to[e]] = lv[q[qi]] + 1; q.push(this.to[e]); }
        }
      }
      if (lv[t] < 0) return flow;
      const it = this.head.map(() => 0);
      const dfs = (u, f) => {
        if (u === t) return f;
        for (; it[u] < this.head[u].length; it[u]++) {
          const e = this.head[u][it[u]], v = this.to[e];
          if (this.cap[e] > 0 && lv[v] === lv[u] + 1) {
            const d = dfs(v, Math.min(f, this.cap[e]));
            if (d > 0) { this.cap[e] -= d; this.cap[e ^ 1] += d; return d; }
          }
        }
        return 0;
      };
      for (;;) { const f = dfs(s, Infinity); if (f === 0) break; flow += f; }
    }
  }
}

/** 担当回数を [lo, hi] に収めつつ、各日ちょうど take 人を割り当てられるか */
function feasible(members, days, availOf, take, lo, hi) {
  const nP = members.length, nD = days.length;
  const S = 0, P = 1, D = 1 + nP, T = 1 + nP + nD, SS = T + 1, TT = T + 2, N = T + 3;
  const g = new Dinic(N);
  const excess = new Array(N).fill(0);
  const addLU = (u, v, l, h) => {
    if (h - l > 0) g.add(u, v, h - l);
    if (l) { excess[v] += l; excess[u] -= l; }
  };

  for (let i = 0; i < nP; i++) addLU(S, P + i, lo, hi);
  for (let i = 0; i < nP; i++) {
    for (let k = 0; k < nD; k++) if (availOf(members[i], days[k])) addLU(P + i, D + k, 0, 1);
  }
  for (let k = 0; k < nD; k++) addLU(D + k, T, take[k], take[k]);
  g.add(T, S, 1e9);

  let need = 0;
  for (let v = 0; v < N; v++) {
    if (excess[v] > 0) { g.add(SS, v, excess[v]); need += excess[v]; }
    else if (excess[v] < 0) g.add(v, TT, -excess[v]);
  }
  return g.maxflow(SS, TT) === need;
}

/** 埋められる最大数と、そのときの「担当回数の差」の最小値 */
function optimum(workDays, twoPart, availability, members) {
  const days = [...new Set(workDays)].sort((a, b) => a - b);
  const slots = twoPart ? 2 : 1;
  const availOf = (u, d) => (availability[u] || []).indexOf(d) >= 0;
  const take = days.map(d => Math.min(slots, members.filter(u => availOf(u, d)).length));
  const total = take.reduce((a, b) => a + b, 0);
  const n = members.length;

  for (let s = 0; s <= total; s++) {
    for (let lo = 0; lo <= Math.floor(total / n); lo++) {
      if (feasible(members, days, availOf, take, lo, lo + s)) return { fill: total, spread: s };
    }
  }
  return { fill: total, spread: Infinity };
}

module.exports = { optimum };
