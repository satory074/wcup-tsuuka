// 各チームの通過ステータス（突破確定 / 可能性あり / 敗退）。
// 残り（未消化）試合のスコアを総当りで列挙し、「全シナリオで通過＝確定」「1つでも通過しうる＝可能性あり」を判定する。
// 全試合消化済み（シードデータ）なら 1 シナリオのみ＝確定 or 敗退に収束する。
import type { CompiledTournament, GroupId, Match, Meta, ResultOverride } from "./types";
import { computeStandings } from "./standings";

export type QualStatus = "advanced" | "eliminated" | "alive";

export interface TeamStatus {
  teamId: string;
  status: QualStatus;
  /** 少なくとも1シナリオで通過しうる */
  canFinishTop2: boolean;
  /** 全シナリオで通過（順序未確定の抽選含みは確定とみなさない） */
  clinchedTop2: boolean;
}

/** 1試合あたりの片側得点レンジ（0..5）。総当りは PER_SIDE^2 通り/試合。 */
const PER_SIDE = 6;
/** 列挙総数の上限。これを超える（＝未消化が多すぎる）場合は全員 alive とする（序盤は数学的に未確定）。 */
const MAX_SCENARIOS = 500_000;

function isPlayed(m: Match): boolean {
  return m.score !== undefined && m.score !== null;
}

/** 未消化試合の全スコア組合せを列挙してコールバック。 */
function enumerate(unplayed: Match[], cb: (overrides: ResultOverride[]) => void): void {
  const acc: ResultOverride[] = [];
  const rec = (i: number): void => {
    if (i === unplayed.length) {
      cb(acc);
      return;
    }
    for (let h = 0; h < PER_SIDE; h++) {
      for (let a = 0; a < PER_SIDE; a++) {
        acc.push({ matchId: unplayed[i].id, score: { home: h, away: a } });
        rec(i + 1);
        acc.pop();
      }
    }
  };
  rec(0);
}

export function groupStatus(ct: CompiledTournament, group: GroupId): TeamStatus[] {
  const matches = ct.matchesByGroup.get(group)!;
  const teamIds = ct.teamsByGroup.get(group)!.map((t) => t.id);
  const meta: Meta = ct.meta;
  const unplayed = matches.filter((m) => !isPlayed(m));

  const total = PER_SIDE ** (2 * unplayed.length);
  if (unplayed.length > 0 && total > MAX_SCENARIOS) {
    // 未消化が多すぎる（序盤）→ まだ誰も確定・敗退していない
    return teamIds.map((teamId) => ({ teamId, status: "alive", canFinishTop2: true, clinchedTop2: false }));
  }

  // 各チームの「通過しうるシナリオ数」「確定通過シナリオ数」「総シナリオ数」を集計
  const timesIn = new Map<string, number>();
  const timesPossible = new Map<string, number>();
  for (const id of teamIds) {
    timesIn.set(id, 0);
    timesPossible.set(id, 0);
  }
  let scenarios = 0;

  const classify = (overrides: ResultOverride[]): void => {
    scenarios++;
    const st = computeStandings(group, matches, teamIds, meta, overrides);
    for (const row of st.rows) {
      const definitelyIn = row.advances;
      // advances=false でも rank が通過枠内なら抽選待ち（possible）
      const contested = !row.advances && row.rank <= meta.advancePerGroup;
      if (definitelyIn) timesIn.set(row.teamId, timesIn.get(row.teamId)! + 1);
      if (definitelyIn || contested) timesPossible.set(row.teamId, timesPossible.get(row.teamId)! + 1);
    }
  };

  if (unplayed.length === 0) classify([]);
  else enumerate(unplayed, classify);

  return teamIds.map((teamId) => {
    const clinchedTop2 = timesIn.get(teamId)! === scenarios;
    const canFinishTop2 = timesPossible.get(teamId)! > 0;
    const status: QualStatus = clinchedTop2 ? "advanced" : !canFinishTop2 ? "eliminated" : "alive";
    return { teamId, status, canFinishTop2, clinchedTop2 };
  });
}
