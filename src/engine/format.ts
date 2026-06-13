// 表示用の純フォーマッタ（DOM・Date 非依存）。
import type { Team } from "./types";

const RANK_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"] as const;

/** 1 → "①"。範囲外は "(n)" にフォールバック。 */
export function rankMark(n: number): string {
  return RANK_MARKS[n - 1] ?? `(${n})`;
}

/** 表示用トリコード（"ned" → "NED"）。 */
export function tricode(team: Team): string {
  return team.id.toUpperCase();
}

/** 国旗 + 国名。 */
export function teamLabel(team: Team): string {
  return `${team.flag} ${team.name}`;
}

/** マトリックス軸の得点表示。overflow バケットは "N+"。 */
export function scoreLabel(goals: number, maxGoals: number, overflow: boolean): string {
  return overflow && goals >= maxGoals ? `${goals}+` : String(goals);
}
