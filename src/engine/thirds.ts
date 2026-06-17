// ベスト3位ランキング（2026方式: 全12組の3位から上位8組が R32 へ通過）。
// 純TS・決定的。組内3位がタイ/組未完なら順序を捏造せず contention として表面化する。
//
// FIFA 3位ランキング基準:
//   1) 勝点  2) 総得失点差  3) 総得点  4) フェアプレーポイント（カード少）  5) 抽選
//   ※ head-to-head は不適用（3位同士は対戦していない）。
import type { CompiledTournament, GroupId, Standings } from "./types";
import { fairPlayPoints, rankGroups } from "./standings";

export type ThirdState = "confirmed" | "contention";

export interface ThirdEntry {
  group: GroupId;
  teamId: string;
  points: number;
  gd: number;
  gf: number;
  /** フェアプレー点（3試合合計）。カードデータが一切無ければ undefined（比較はタイ扱い）。 */
  fairPlay?: number;
  /** confirmed=組内3位が単独確定 / contention=組内3位がタイ or 組が未完で暫定 */
  state: ThirdState;
  /** その組の全試合（各チーム3試合）が消化済みか */
  groupComplete: boolean;
  /** 横断順位 1..G（同値クラスタは rank を共有＝抽選並び） */
  rank: number;
  /** 上位 slots の席を（暫定でも）占めるか。straddle クラスタは false。 */
  advances: boolean;
  /** contention、または抽選で枠線を跨ぐため未確定か */
  undecided: boolean;
}

export interface BestThirdsResult {
  /** advanceBestThirds（0 のとき空配列＝呼び出し側は描画しない） */
  slots: number;
  /** rank 昇順。各組につき1エントリ（その組の現3位） */
  entries: ThirdEntry[];
  /** いずれかのエントリが contention or 抽選跨ぎで未確定なら true */
  undecided: boolean;
}

/** 3位チームの3試合ぶんカード合計をフェアプレー点に。カードが1試合も無ければ undefined。 */
function fairPlayOfThird(ct: CompiledTournament, gid: GroupId, teamId: string): number | undefined {
  const matches = ct.matchesByGroup.get(gid) ?? [];
  let total = 0;
  let any = false;
  for (const m of matches) {
    if (!m.cards) continue;
    if (m.home === teamId) {
      total += fairPlayPoints(m.cards.home);
      any = true;
    } else if (m.away === teamId) {
      total += fairPlayPoints(m.cards.away);
      any = true;
    }
  }
  return any ? total : undefined;
}

/** フェアプレー比較（少ない方が上位）。どちらか undefined はタイ扱い（0 とみなさない）。 */
function fpCompare(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) return 0;
  return a - b;
}

export function computeBestThirds(
  ct: CompiledTournament,
  standingsByGroup: Map<GroupId, Standings>,
): BestThirdsResult {
  const slots = ct.meta.advanceBestThirds ?? 0;
  if (slots <= 0) return { slots: 0, entries: [], undecided: false };

  // 1) 各組の3位（rank=3 クラスタ）を抽出
  const entries: ThirdEntry[] = [];
  for (const gid of ct.groups) {
    const st = standingsByGroup.get(gid);
    if (!st) continue;
    const cluster = rankGroups(st).find((g) => g[0].rank === 3);
    if (!cluster) continue;
    const groupComplete = st.rows.every((r) => r.played === 3);
    const state: ThirdState = cluster.length > 1 || !groupComplete ? "contention" : "confirmed";
    // タイ時の代表は teamId 昇順先頭（順位に使う数値はクラスタ共有なので実値）
    const rep = [...cluster].sort((a, b) => (a.teamId < b.teamId ? -1 : 1))[0];
    entries.push({
      group: gid,
      teamId: rep.teamId,
      points: rep.points,
      gd: rep.gd,
      gf: rep.gf,
      fairPlay: fairPlayOfThird(ct, gid, rep.teamId),
      state,
      groupComplete,
      rank: 0,
      advances: false,
      undecided: false,
    });
  }

  // 2) FIFA 3位ランキング: 勝点 → GD → GF → フェアプレー(少) → 抽選(teamId 昇順で決定的)
  entries.sort(
    (a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      fpCompare(a.fairPlay, b.fairPlay) ||
      (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0),
  );

  // 3) 同値クラスタ（勝点/GD/GF/フェアプレーまで完全一致）に rank を割当て。
  //    抽選でしか並ばないクラスタは rank を共有し、枠線を跨ぐなら advances=false（誰が入るか未確定）。
  const sameKey = (a: ThirdEntry, b: ThirdEntry): boolean =>
    a.points === b.points && a.gd === b.gd && a.gf === b.gf && fpCompare(a.fairPlay, b.fairPlay) === 0;

  let anyUndecided = false;
  let pos = 1;
  let i = 0;
  while (i < entries.length) {
    let j = i + 1;
    while (j < entries.length && sameKey(entries[i], entries[j])) j++;
    const size = j - i;
    const rank = pos;
    const tied = size > 1;
    // ブロック全体が通過枠に収まれば（暫定）通過。枠線を跨ぐ抽選なら誰が入るか未確定。
    const blockAdvances = rank + size - 1 <= slots;
    const straddle = rank <= slots && rank + size - 1 > slots;
    for (let k = i; k < j; k++) {
      const e = entries[k];
      e.rank = rank;
      e.advances = blockAdvances;
      // 組内3位が未確定(contention)、または抽選で枠線を跨ぐ → 未確定
      e.undecided = e.state === "contention" || (tied && straddle);
      if (e.undecided) anyUndecided = true;
    }
    pos += size;
    i = j;
  }

  return { slots, entries, undecided: anyUndecided };
}
