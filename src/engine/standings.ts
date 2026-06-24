// 順位表 + FIFA 2022 タイブレークエンジン（このアプリの正しさの核）。
// 決定的（同入力 → 同出力）であること。真の同点は順序を捏造せず undecided として表面化する。
//
// FIFA 2022 順位決定基準:
//   a) 総勝点  b) 総得失点差  c) 総得点
//   ここで並んだチーム同士の対戦のみで:  d) 勝点  e) 得失点差  f) 得点
//   g) フェアプレーポイント（カード少）  h) 抽選
// ※ d-f は「現在並んでいるチームだけ」の対戦で計算する。さらに同点が残れば、
//    その残った面子だけの対戦に d-f を再適用する（ここでは再帰で表現）。
import type { Cards, GroupId, Match, Meta, ResultOverride, Standings, StandingRow } from "./types";

interface Resolved {
  home: string;
  away: string;
  hs: number;
  as: number;
}

interface Accum {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

/** score + overrides を反映。未消化（score も override も無い）試合は除外。 */
function resolveMatches(matches: Match[], overrides?: ResultOverride[]): Resolved[] {
  const ov = new Map<string, { home: number; away: number }>();
  for (const o of overrides ?? []) ov.set(o.matchId, o.score);
  const out: Resolved[] = [];
  for (const m of matches) {
    const s = ov.get(m.id) ?? m.score;
    if (s === undefined || s === null) continue;
    out.push({ home: m.home, away: m.away, hs: s.home, as: s.away });
  }
  return out;
}

/** teamIds の各チームについて、与えられた試合集合で勝点・得失点を集計する。 */
export function accumulate(teamIds: string[], resolved: Resolved[], meta: Meta): Map<string, Accum> {
  const map = new Map<string, Accum>();
  for (const id of teamIds) {
    map.set(id, { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 });
  }
  for (const r of resolved) {
    const h = map.get(r.home);
    const a = map.get(r.away);
    if (!h || !a) continue; // この集計対象に含まれない試合（h2h フィルタ後など）
    h.played++;
    a.played++;
    h.gf += r.hs;
    h.ga += r.as;
    a.gf += r.as;
    a.ga += r.hs;
    if (r.hs > r.as) {
      h.won++;
      a.lost++;
      h.points += meta.points.win;
      a.points += meta.points.loss;
    } else if (r.hs < r.as) {
      a.won++;
      h.lost++;
      a.points += meta.points.win;
      h.points += meta.points.loss;
    } else {
      h.drawn++;
      a.drawn++;
      h.points += meta.points.draw;
      a.points += meta.points.draw;
    }
  }
  for (const s of map.values()) s.gd = s.gf - s.ga;
  return map;
}

/** 総合基準 a-c の比較（a が上位なら負）。 */
export function compareOverall(a: Accum, b: Accum): number {
  return b.points - a.points || b.gd - a.gd || b.gf - a.gf;
}

/** クラスタ（並んでいる面子）同士の対戦のみで集計（基準 d-f 用）。 */
export function headToHead(cluster: string[], resolved: Resolved[], meta: Meta): Map<string, Accum> {
  const set = new Set(cluster);
  const sub = resolved.filter((r) => set.has(r.home) && set.has(r.away));
  return accumulate(cluster, sub, meta);
}

/** フェアプレーポイント（少ないほど上位）。カードデータがある場合のみ使う。
    Cards は {y, r} の枚数のみ保持するため、イエロー=1・レッド=4 の簡易ペナルティで近似する。 */
export function fairPlayPoints(cards: Cards): number {
  return cards.y * 1 + cards.r * 4;
}

/** 各チームのフェアプレーポイント合計（基準g用）。値が確定するのは「消化した試合すべてにカードがある」チームのみ。
    1試合でもカード欠落 or 反実仮想（override）の試合があれば undefined＝そのチームは基準g を適用せず抽選にフォールバック。
    2022/2026 は cards 皆無なので全チーム undefined＝従来どおり抽選（＝この関数を入れても挙動不変）。 */
function teamFairPlay(
  teamIds: string[],
  matches: Match[],
  overrides?: ResultOverride[],
): Map<string, number | undefined> {
  const ovIds = new Set((overrides ?? []).map((o) => o.matchId));
  const teamSet = new Set(teamIds);
  const total = new Map<string, number>(teamIds.map((id) => [id, 0]));
  const complete = new Map<string, boolean>(teamIds.map((id) => [id, true]));
  for (const m of matches) {
    // 消化済み = score あり or override で結果が与えられている。未消化はカード集計対象外。
    const played = ovIds.has(m.id) || (m.score !== undefined && m.score !== null);
    if (!played) continue;
    for (const side of ["home", "away"] as const) {
      const tid = side === "home" ? m.home : m.away;
      if (!teamSet.has(tid)) continue;
      const c = m.cards?.[side];
      if (c) total.set(tid, total.get(tid)! + fairPlayPoints(c));
      else complete.set(tid, false); // 消化済みなのにカードが無い → このチームは基準g 不適用
    }
  }
  const out = new Map<string, number | undefined>();
  for (const id of teamIds) out.set(id, complete.get(id) ? total.get(id) : undefined);
  return out;
}

/** クラスタをフェアプレーポイント（少ない順）で連続グループに分割する（基準g）。
    全員が確定値を持ち、かつ2グループ以上に分かれるときのみ返す。さもなくば null（＝抽選へ）。 */
function splitByFairPlay(cluster: string[], fp: Map<string, number | undefined>): string[][] | null {
  if (cluster.some((id) => fp.get(id) === undefined)) return null;
  const ordered = [...cluster].sort((x, y) => fp.get(x)! - fp.get(y)!);
  const groups: string[][] = [];
  for (const id of ordered) {
    const last = groups[groups.length - 1];
    if (last && fp.get(last[0]) === fp.get(id)) last.push(id);
    else groups.push([id]);
  }
  return groups.length > 1 ? groups : null;
}

/** クラスタ内の最終並びを「同順位グループの配列」で返す。
    各要素 = 同じ最終順位を共有するチーム群（通常サイズ1、抽選待ちなら2以上）。
    h2h で分割できれば再帰、分割できなければ（カード無し前提で）抽選＝1グループにまとめる。 */
function resolveCluster(
  cluster: string[],
  resolved: Resolved[],
  meta: Meta,
  fp: Map<string, number | undefined>,
): string[][] {
  if (cluster.length === 1) return [[cluster[0]]];

  const h2h = headToHead(cluster, resolved, meta);
  const ordered = [...cluster].sort((x, y) => compareOverall(h2h.get(x)!, h2h.get(y)!));

  // h2h の (pts,gd,gf) が同一のものを連続クラスタに分割
  const sub: string[][] = [];
  for (const id of ordered) {
    const last = sub[sub.length - 1];
    if (last) {
      const a = h2h.get(last[0])!;
      const b = h2h.get(id)!;
      if (a.points === b.points && a.gd === b.gd && a.gf === b.gf) {
        last.push(id);
        continue;
      }
    }
    sub.push([id]);
  }

  // h2h で分割できなかった（全員 h2h でも同値）→ 基準g フェアプレーを抽選の前に試す。
  // カードが揃っていれば確定（例: 2018 組H 日本 vs セネガル）。揃わなければ従来どおり抽選。
  if (sub.length === 1) {
    const fpSplit = splitByFairPlay(cluster, fp);
    if (fpSplit) {
      const result: string[][] = [];
      for (const s of fpSplit) {
        for (const g of resolveCluster(s, resolved, meta, fp)) result.push(g);
      }
      return result;
    }
    // 抽選（決定的表示のため id 昇順で固める）
    return [[...cluster].sort()];
  }

  // 分割できた → 各サブクラスタを再帰（サイズ2以上は当該面子のみの対戦で再適用）
  const result: string[][] = [];
  for (const s of sub) {
    for (const g of resolveCluster(s, resolved, meta, fp)) result.push(g);
  }
  return result;
}

export function computeStandings(
  group: GroupId,
  matches: Match[],
  teamIds: string[],
  meta: Meta,
  overrides?: ResultOverride[],
): Standings {
  const resolved = resolveMatches(matches, overrides);
  const overall = accumulate(teamIds, resolved, meta);
  const fp = teamFairPlay(teamIds, matches, overrides);

  // 総合基準 a-c で整列し、同値を連続クラスタに分割
  const byOverall = [...teamIds].sort((x, y) => compareOverall(overall.get(x)!, overall.get(y)!));
  const clusters: string[][] = [];
  for (const id of byOverall) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const a = overall.get(last[0])!;
      const b = overall.get(id)!;
      if (a.points === b.points && a.gd === b.gd && a.gf === b.gf) {
        last.push(id);
        continue;
      }
    }
    clusters.push([id]);
  }

  // クラスタごとに h2h 以降で並びを確定（→ 同順位グループの列）
  const rankGroups: string[][] = [];
  for (const c of clusters) {
    for (const g of resolveCluster(c, resolved, meta, fp)) rankGroups.push(g);
  }

  // 同順位グループに rank を割り当てて StandingRow を生成
  const rows: StandingRow[] = [];
  let undecided = false;
  let pos = 1; // 次に割り当てる順位
  for (const g of rankGroups) {
    const size = g.length;
    const rank = pos;
    const tied = size > 1;
    if (tied) undecided = true;
    // ブロック全体が通過ラインに収まるときのみ「確定通過」
    const advances = rank + size - 1 <= meta.advancePerGroup;
    for (const id of g) {
      const s = overall.get(id)!;
      rows.push({
        teamId: id,
        played: s.played,
        won: s.won,
        drawn: s.drawn,
        lost: s.lost,
        gf: s.gf,
        ga: s.ga,
        gd: s.gd,
        points: s.points,
        rank,
        advances,
        tiedGroupKey: tied ? `${group}@${rank}` : undefined,
      });
    }
    pos += size;
  }

  return { group, rows, undecided };
}

/** rank が同じ連続行をまとめて返す（マトリックスの結果判定に使う）。 */
export function rankGroups(standings: Standings): StandingRow[][] {
  const groups: StandingRow[][] = [];
  for (const row of standings.rows) {
    const last = groups[groups.length - 1];
    if (last && last[0].rank === row.rank) last.push(row);
    else groups.push([row]);
  }
  return groups;
}
