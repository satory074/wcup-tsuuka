// タイムライン・エンジン（純TS・computeStandings を再利用）。
// 「その時点のスコアを入れた Match[]」を作って computeStandings に渡すだけ。DOM/Date 非依存。
// (A) buildStageTimeline: 大会全体を試合単位で（全組で常に可能）。
// (B) buildLiveTimeline: 最終節（同時刻2試合）を分刻みで（第3節の goals が揃う組のみ）。
import type { CompiledTournament, GoalSide, GroupId, Match, Score, Standings } from "./types";
import { computeStandings } from "./standings";
import type { Goal } from "./types";

/** スナップショットのイベント文脈（描画側が旗・国名で整形する。ここでは id で保持） */
export interface SnapshotEvent {
  matchId: string;
  homeId: string;
  awayId: string;
  /** イベント時点での当該試合スコア */
  homeScore: number;
  awayScore: number;
  matchday: number;
  /** ゴールイベントのとき、得点した側 */
  scorerSide?: GoalSide;
  /** ゴールイベントのとき、得点選手名（あれば） */
  scorer?: string;
}

export interface Snapshot {
  /** keyed 更新用の一意キー */
  key: string;
  /** 表示用ラベル: "キックオフ" / "11'" / "90+5'" / "第1節" */
  clockLabel: string;
  kind: "kickoff" | "goal" | "matchEnd";
  /** kickoff のときは undefined */
  event?: SnapshotEvent;
  /** その時点の順位 */
  standings: Standings;
  /** その時点で暫定通過圏（上位 advancePerGroup の席を占めるチーム） */
  advancing: string[];
  /** 直前スナップショット比の順位変動 */
  movements: Record<string, "up" | "down" | "same">;
}

/** 整列用クロック値（分*100 + アディショナル）。 */
export function clockOf(g: Goal): number {
  return g.minute * 100 + (g.plus ?? 0);
}

function clockLabel(g: Goal): string {
  return g.plus ? `${g.minute}+${g.plus}'` : `${g.minute}'`;
}

/** goals のうち clock 以下を数えて、その時点のスコアを返す。 */
export function scoreAtClock(goals: Goal[], clock: number): Score {
  let home = 0;
  let away = 0;
  for (const g of goals) {
    if (clockOf(g) <= clock) {
      if (g.side === "home") home++;
      else away++;
    }
  }
  return { home, away };
}

function isPlayed(m: Match): boolean {
  return m.score !== undefined && m.score !== null;
}

function diffRanks(prev: Standings | null, curr: Standings): Record<string, "up" | "down" | "same"> {
  const out: Record<string, "up" | "down" | "same"> = {};
  const prevRank = new Map<string, number>();
  if (prev) for (const r of prev.rows) prevRank.set(r.teamId, r.rank);
  for (const r of curr.rows) {
    const p = prevRank.get(r.teamId);
    out[r.teamId] = p === undefined ? "same" : r.rank < p ? "up" : r.rank > p ? "down" : "same";
  }
  return out;
}

function snapshotFrom(
  group: GroupId,
  teamIds: string[],
  ct: CompiledTournament,
  matches: Match[],
  prev: Standings | null,
  base: Omit<Snapshot, "standings" | "advancing" | "movements">,
): Snapshot {
  const standings = computeStandings(group, matches, teamIds, ct.meta);
  const adv = ct.meta.advancePerGroup;
  const advancing = standings.rows.slice(0, adv).map((r) => r.teamId);
  const movements = diffRanks(prev, standings);
  return { ...base, standings, advancing, movements };
}

/** (A) 大会全体を試合単位で。組の6試合を (matchday, id) 昇順に消化していく。 */
export function buildStageTimeline(ct: CompiledTournament, group: GroupId): Snapshot[] {
  const all = ct.matchesByGroup.get(group);
  if (!all) return [];
  const teamIds = ct.teamsByGroup.get(group)!.map((t) => t.id);
  const ordered = [...all].sort((a, b) => a.matchday - b.matchday || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const snaps: Snapshot[] = [];
  let prev: Standings | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const completed = new Set(ordered.slice(0, i + 1).map((m) => m.id));
    // 消化済みのみ score を残し、未消化は score を外す
    const view = ordered.map((m) => (completed.has(m.id) ? m : { ...m, score: undefined }));
    const last = ordered[i];
    const s = isPlayed(last) ? last.score! : { home: 0, away: 0 };
    const snap = snapshotFrom(group, teamIds, ct, view, prev, {
      key: `${group}-stage-${i}`,
      clockLabel: `第${last.matchday}節`,
      kind: "matchEnd",
      event: {
        matchId: last.id,
        homeId: last.home,
        awayId: last.away,
        homeScore: s.home,
        awayScore: s.away,
        matchday: last.matchday,
      },
    });
    snaps.push(snap);
    prev = snap.standings;
  }
  return snaps;
}

/** (B) 最終節（同時刻2試合）を分刻みで。第3節の全試合に goals が要る。無ければ null。 */
export function buildLiveTimeline(ct: CompiledTournament, group: GroupId): Snapshot[] | null {
  const all = ct.matchesByGroup.get(group);
  if (!all) return null;
  const teamIds = ct.teamsByGroup.get(group)!.map((t) => t.id);
  const finalRound = all.filter((m) => m.matchday === 3);
  if (finalRound.length === 0 || finalRound.some((m) => !Array.isArray(m.goals))) return null;

  // 第1・2節は実スコア固定
  const prior = all.filter((m) => m.matchday !== 3);

  // 第3節の全ゴールを統合（clock 昇順、同clockは matchId で安定化）
  type Ev = { matchId: string; clock: number; goal: Goal };
  const events: Ev[] = [];
  for (const m of finalRound) {
    for (const g of m.goals!) events.push({ matchId: m.id, clock: clockOf(g), goal: g });
  }
  events.sort((a, b) => a.clock - b.clock || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0));

  const matchById = new Map(finalRound.map((m) => [m.id, m]));
  const running = new Map<string, Score>(finalRound.map((m) => [m.id, { home: 0, away: 0 }]));

  const viewNow = (): Match[] => [
    ...prior,
    ...finalRound.map((m) => ({ ...m, score: { ...running.get(m.id)! } })),
  ];

  const snaps: Snapshot[] = [];
  let prev: Standings | null = null;

  // キックオフ（第3節すべて 0-0）
  const kickoff = snapshotFrom(group, teamIds, ct, viewNow(), prev, {
    key: `${group}-live-0`,
    clockLabel: "キックオフ",
    kind: "kickoff",
  });
  snaps.push(kickoff);
  prev = kickoff.standings;

  events.forEach((ev, i) => {
    const sc = running.get(ev.matchId)!;
    if (ev.goal.side === "home") sc.home++;
    else sc.away++;
    const m = matchById.get(ev.matchId)!;
    const snap = snapshotFrom(group, teamIds, ct, viewNow(), prev, {
      key: `${group}-live-${i + 1}`,
      clockLabel: clockLabel(ev.goal),
      kind: "goal",
      event: {
        matchId: ev.matchId,
        homeId: m.home,
        awayId: m.away,
        homeScore: sc.home,
        awayScore: sc.away,
        matchday: 3,
        scorerSide: ev.goal.side,
        scorer: ev.goal.player,
      },
    });
    snaps.push(snap);
    prev = snap.standings;
  });

  return snaps;
}
