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

/** キックオフ日時 "YYYY-MM-DDThh:mm" を順序保証の整数（分）に。Date 不使用・同年前提。 */
export function kickoffMinutes(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(iso);
  if (!m) return 0;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  // 月内日数差より十分大きい単位で日を分離（順序のみ保証できればよい）
  return (month * 31 + day) * 24 * 60 + hh * 60 + mm;
}

/** (B) 全試合（第1〜3節）を分刻みで。全試合に goals 配列と kickoff が要る。無ければ null。
    並べ替えは「キックオフ日時＋経過分」の絶対時刻順＝被る試合（同時刻開催）は分で並列、
    被らない試合は時系列で前後に並ぶ。 */
export function buildLiveTimeline(ct: CompiledTournament, group: GroupId): Snapshot[] | null {
  const all = ct.matchesByGroup.get(group);
  if (!all || all.length === 0) return null;
  const teamIds = ct.teamsByGroup.get(group)!.map((t) => t.id);
  // 全試合に goals 配列と kickoff が必要（0-0 は []）
  if (all.some((m) => !Array.isArray(m.goals) || !m.kickoff)) return null;

  // 各試合のキックオフ絶対分
  const koMin = new Map<string, number>(all.map((m) => [m.id, kickoffMinutes(m.kickoff!)]));

  // 全6試合の全ゴールを絶対時刻 (キックオフ + 経過分) 昇順で統合
  type Ev = { matchId: string; abs: number; clock: number; goal: Goal };
  const events: Ev[] = [];
  for (const m of all) {
    for (const g of m.goals!) {
      const abs = koMin.get(m.id)! + g.minute + (g.plus ?? 0);
      events.push({ matchId: m.id, abs, clock: clockOf(g), goal: g });
    }
  }
  if (events.length === 0) return null;
  events.sort(
    (a, b) => a.abs - b.abs || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0) || a.clock - b.clock,
  );

  const matchById = new Map(all.map((m) => [m.id, m]));
  const running = new Map<string, Score>(all.map((m) => [m.id, { home: 0, away: 0 }]));

  // 絶対時刻 absT 時点の試合スコア:
  //   kickoff <= absT … running（進行中/消化済み。0-0 進行中は現在引分扱い）
  //   kickoff >  absT … 未消化（score なし）
  // → 被らない試合は前の試合が終わってから次が running 入りし、被る試合は両方 running で分並列。
  const viewAt = (absT: number): Match[] =>
    all.map((m) => (koMin.get(m.id)! <= absT ? { ...m, score: { ...running.get(m.id)! } } : { ...m, score: undefined }));

  const snaps: Snapshot[] = [];
  let prev: Standings | null = null;

  events.forEach((ev, i) => {
    const sc = running.get(ev.matchId)!;
    if (ev.goal.side === "home") sc.home++;
    else sc.away++;
    const m = matchById.get(ev.matchId)!;
    const snap = snapshotFrom(group, teamIds, ct, viewAt(ev.abs), prev, {
      key: `${group}-live-${i}`,
      clockLabel: clockLabel(ev.goal),
      kind: "goal",
      event: {
        matchId: ev.matchId,
        homeId: m.home,
        awayId: m.away,
        homeScore: sc.home,
        awayScore: sc.away,
        matchday: m.matchday,
        scorerSide: ev.goal.side,
        scorer: ev.goal.player,
      },
    });
    snaps.push(snap);
    prev = snap.standings;
  });

  return snaps;
}
