// ピボット（マトリックスの2軸にスコアを振る試合）の検出と、固定/仮定試合の振り分け。
import type { Match } from "../types";

export interface GroupMatchState {
  /** 確定スコアがある試合 */
  played: Match[];
  /** 未消化（スコア無し）試合 */
  unplayed: Match[];
}

function isPlayed(m: Match): boolean {
  return m.score !== undefined && m.score !== null;
}

export function splitGroupMatches(matches: Match[]): GroupMatchState {
  return {
    played: matches.filter(isPlayed),
    unplayed: matches.filter((m) => !isPlayed(m)),
  };
}

/** 既定ピボット = 最終節（最大 matchday）の試合のうち id が最小のもの。
    matches は compile 済みで matchday→id 昇順を想定するが、念のためここでも決定的に選ぶ。 */
export function defaultPivot(matches: Match[]): string {
  if (matches.length === 0) throw new Error("defaultPivot: 試合が無い");
  const maxMd = Math.max(...matches.map((m) => m.matchday));
  const candidates = matches
    .filter((m) => m.matchday === maxMd)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates[0].id;
}

/** ピボット以外で、まだスコアが無く「仮定」が必要な試合。 */
export function otherUnplayed(pivotId: string, matches: Match[]): Match[] {
  return matches.filter((m) => m.id !== pivotId && !isPlayed(m));
}
