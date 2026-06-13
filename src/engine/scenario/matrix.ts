// シナリオ・マトリックス（ヒーロー機能）。
// ピボット試合のスコア（teamA 得点 × teamB 得点）を 0..maxGoals で振り、各セルでグループ順位を
// ゼロから再計算して「①1位 ②2位 / 敗退」を出す。同じ通過結果のセルを同色領域にまとめる。
// 決定的（同入力 → 同出力）。サッカーは引き分けが有効なので対角（a==b）も通常セル。
import type { CompiledTournament, GroupId, ResultOverride, Standings } from "../types";
import { computeStandings, rankGroups } from "../standings";

export interface Outcome {
  /** 1位（単独で確定したときのみ。同順位タイなら null） */
  first: string | null;
  /** 2位（通過の2枠目。単独確定時のみ。タイなら null） */
  second: string | null;
  /** 確実に通過するチーム */
  advancing: string[];
  /** 確実に敗退するチーム */
  eliminated: string[];
  /** 通過枠をまたぐ同順位タイ（抽選でしか決まらない＝誰が通過か未確定） */
  contested: string[];
  /** 通過の顔ぶれ or 順序が抽選依存か */
  undecided: boolean;
  /** 同一通過結果を識別するキー（言語非依存。色領域の同一性） */
  outcomeKey: string;
  /** 凡例・ツールチップ用の人間向けラベル（チーム名） */
  label: string;
}

export interface MatrixCell {
  /** teamA（行）の得点 */
  a: number;
  /** teamB（列）の得点 */
  b: number;
  /** 引き分けセル（a==b） */
  isDraw: boolean;
  outcome: Outcome;
  /** 結果領域の色インデックス（0..） */
  colorIndex: number;
}

export interface LegendEntry {
  colorIndex: number;
  outcomeKey: string;
  label: string;
  /** この結果になるセル数 */
  count: number;
  undecided: boolean;
}

export interface ScenarioMatrix {
  group: GroupId;
  pivotMatchId: string;
  /** 行 = home の得点 */
  teamA: string;
  /** 列 = away の得点 */
  teamB: string;
  maxGoals: number;
  /** 最終バケットを "N+" 扱いにするか */
  overflow: boolean;
  /** row-major（a 昇順 → 各 a で b 昇順）。(maxGoals+1)^2 セル */
  cells: MatrixCell[];
  legend: LegendEntry[];
  /** 他の未消化試合に置いた仮定スコア */
  assumptions: ResultOverride[];
}

export interface BuildMatrixArgs {
  ct: CompiledTournament;
  group: GroupId;
  pivotMatchId: string;
  assumptions: ResultOverride[];
  maxGoals?: number;
}

/** Standings から「誰がどう通過するか」を抽出する。3-4位の抽選など通過に無関係なタイは無視する。 */
export function deriveOutcome(st: Standings, ct: CompiledTournament): Outcome {
  const adv = ct.meta.advancePerGroup;
  const groups = rankGroups(st);
  const nm = (id: string) => ct.teamsById.get(id)?.name ?? id;

  const advancing: string[] = [];
  const contested: string[] = [];
  const eliminated: string[] = [];
  for (const g of groups) {
    const rank = g[0].rank;
    const size = g.length;
    const fullyIn = rank + size - 1 <= adv;
    const straddle = rank <= adv && rank + size - 1 > adv;
    for (const r of g) {
      if (fullyIn) advancing.push(r.teamId);
      else if (straddle) contested.push(r.teamId);
      else eliminated.push(r.teamId);
    }
  }

  // first / second（通過枠を単独で占めるときだけ確定）
  let first: string | null = null;
  let second: string | null = null;
  const g0 = groups[0];
  if (g0.length === 1) {
    first = g0[0].teamId;
    const g1 = groups[1];
    if (g1 && g1.length === 1 && g1[0].rank === 2) second = g1[0].teamId;
  }

  const undecided = contested.length > 0 || first === null || second === null;

  let outcomeKey: string;
  let label: string;
  if (contested.length > 0) {
    outcomeKey = `tie@${adv}:${[...advancing].sort().join(",")}|${[...contested].sort().join(",")}`;
    const slots = adv - advancing.length;
    const tieNames = contested.map(nm).join("・");
    label =
      advancing.length > 0
        ? `① ${advancing.map(nm).join("・")}　＋ 残り${slots}枠は抽選（${tieNames}）`
        : `通過${adv}枠は抽選（${tieNames}）`;
  } else if (undecided) {
    // 通過は2チーム確定だが順序が抽選（1-2位タイ）
    outcomeKey = `top:${[...advancing].sort().join("=")}`;
    label = `①② ${advancing.map(nm).join("・")}（順序は抽選）`;
  } else {
    outcomeKey = `${first}>${second}`;
    label = `① ${nm(first!)}　② ${nm(second!)}`;
  }

  return { first, second, advancing, eliminated, contested, undecided, outcomeKey, label };
}

export function buildMatrix(args: BuildMatrixArgs): ScenarioMatrix {
  const { ct, group, pivotMatchId, assumptions } = args;
  const maxGoals = args.maxGoals ?? 6;
  const overflow = true;

  const matches = ct.matchesByGroup.get(group);
  if (!matches) throw new Error(`buildMatrix: 組 ${group} が無い`);
  const pivot = matches.find((m) => m.id === pivotMatchId);
  if (!pivot) throw new Error(`buildMatrix: ピボット ${pivotMatchId} が組 ${group} に無い`);
  const teamIds = ct.teamsByGroup.get(group)!.map((t) => t.id);

  const cells: MatrixCell[] = [];
  // 結果キー → colorIndex（初出順）と凡例集計
  const keyToColor = new Map<string, number>();
  const legendByKey = new Map<string, LegendEntry>();

  for (let a = 0; a <= maxGoals; a++) {
    for (let b = 0; b <= maxGoals; b++) {
      const overrides: ResultOverride[] = [...assumptions, { matchId: pivot.id, score: { home: a, away: b } }];
      const st = computeStandings(group, matches, teamIds, ct.meta, overrides);
      const outcome = deriveOutcome(st, ct);

      let colorIndex = keyToColor.get(outcome.outcomeKey);
      if (colorIndex === undefined) {
        colorIndex = keyToColor.size;
        keyToColor.set(outcome.outcomeKey, colorIndex);
        legendByKey.set(outcome.outcomeKey, {
          colorIndex,
          outcomeKey: outcome.outcomeKey,
          label: outcome.label,
          count: 0,
          undecided: outcome.undecided,
        });
      }
      legendByKey.get(outcome.outcomeKey)!.count++;

      cells.push({ a, b, isDraw: a === b, outcome, colorIndex });
    }
  }

  const legend = [...legendByKey.values()].sort((x, y) => x.colorIndex - y.colorIndex);

  return {
    group,
    pivotMatchId: pivot.id,
    teamA: pivot.home,
    teamB: pivot.away,
    maxGoals,
    overflow,
    cells,
    legend,
    assumptions,
  };
}
