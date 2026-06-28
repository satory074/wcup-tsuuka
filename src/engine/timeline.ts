// タイムライン・エンジン（純TS・computeStandings を再利用）。
// 「その時点のスコアを入れた Match[]」を作って computeStandings に渡すだけ。DOM/Date 非依存。
// 全試合を分刻みで描き（消化済み試合に goals 配列と kickoff が要る）、
// さらに「完全消化の節」ごとに、その節の試合結果を持つ節末スナップを差し込む。
import type { CompiledTournament, GoalSide, GroupId, Match, Score, Standings } from "./types";
import { computeStandings } from "./standings";
import type { Goal } from "./types";

/** ゴールスナップのイベント文脈（描画側が旗・国名で整形する。ここでは id で保持） */
export interface SnapshotEvent {
  matchId: string;
  homeId: string;
  awayId: string;
  /** イベント時点での当該試合スコア */
  homeScore: number;
  awayScore: number;
  matchday: number;
  /** 得点した側 */
  scorerSide?: GoalSide;
  /** 得点選手名（あれば） */
  scorer?: string;
  /** 得点時の分（ツールチップ・得点ログの時刻表示用）。 */
  minute: number;
}

/** 節末スナップが持つ、その節の各試合の最終結果。 */
export interface RoundResult {
  matchId: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
}

export interface Snapshot {
  /** keyed 更新用の一意キー */
  key: string;
  /** 表示用ラベル: "11'" / "90+5'" / "第1節 終了" */
  clockLabel: string;
  kind: "goal" | "roundEnd";
  /** 所属する節（goal=その試合のmd / roundEnd=その節のmd）。チャートの節バンド判定に使う。 */
  matchday: number;
  /** goal のときのみ。 */
  event?: SnapshotEvent;
  /** roundEnd のときのみ。その節の試合結果（id 昇順）。 */
  roundResults?: RoundResult[];
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

/** 試合長(<=~135分)より十分大・翌日キックオフ(+1440分)より小 → 節内最後のゴールの後・次節の前に必ず入る。 */
const ROUND_END_OFFSET = 600;

/** 唯一のタイムライン・ビルダー。
    全試合（第1〜3節）を分刻みで並べ、完全消化の節ごとにその節の試合結果スナップを挿入する。
    消化済み試合には goals 配列と kickoff が必要（0-0 は []）。返せる中身が無ければ null。
    大会進行中（一部が未消化）でも可: 未消化試合は「未来」として常に未消化側に落ちる。
    並べ替えは「キックオフ日時＋経過分」の絶対時刻順＝被る試合（同時刻開催）は分で並列、
    被らない試合は時系列で前後に並ぶ。節末は同節ゴールより後・次節より前に来る。 */
export function buildTimeline(ct: CompiledTournament, group: GroupId): Snapshot[] | null {
  const all = ct.matchesByGroup.get(group);
  if (!all || all.length === 0) return null;
  const teamIds = ct.teamsByGroup.get(group)!.map((t) => t.id);
  // 消化済み試合には goals 配列と kickoff が必要（0-0 は []）。1試合も消化していなければ null。
  const played = all.filter(isPlayed);
  if (played.length === 0) return null;
  if (played.some((m) => !Array.isArray(m.goals) || !m.kickoff)) return null;

  // 各試合のキックオフ絶対分（kickoff 無しの未消化は +∞＝常に未来）
  const koMin = new Map<string, number>(
    all.map((m) => [m.id, m.kickoff ? kickoffMinutes(m.kickoff) : Number.POSITIVE_INFINITY]),
  );

  // ---- イベント列: ゴール（消化済み試合）＋ 節末（完全消化の節） ----
  type GoalEv = { type: "goal"; matchId: string; abs: number; clock: number; goal: Goal };
  type RoundEv = { type: "roundEnd"; abs: number; matchday: number; matches: Match[] };
  type Ev = GoalEv | RoundEv;
  const events: Ev[] = [];

  for (const m of played) {
    for (const g of m.goals!) {
      const abs = koMin.get(m.id)! + g.minute + (g.plus ?? 0);
      events.push({ type: "goal", matchId: m.id, abs, clock: clockOf(g), goal: g });
    }
  }

  // 節ごとに「その節の全試合が消化済み」かを判定し、消化済みの節に節末イベントを足す。
  const byMatchday = new Map<number, Match[]>();
  for (const m of all) {
    const arr = byMatchday.get(m.matchday) ?? [];
    arr.push(m);
    byMatchday.set(m.matchday, arr);
  }
  for (const [md, ms] of byMatchday) {
    if (ms.length === 0 || ms.some((m) => !isPlayed(m))) continue; // 節が未完なら節末を出さない
    const abs = Math.max(...ms.map((m) => koMin.get(m.id)!)) + ROUND_END_OFFSET;
    const ordered = [...ms].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    events.push({ type: "roundEnd", abs, matchday: md, matches: ordered });
  }

  if (events.length === 0) return null;

  // 絶対時刻昇順（決定的）。同時刻は goal を先(0)→roundEnd(1)、goal同士は matchId→clock、roundEnd同士は matchday。
  const evKind = (e: Ev) => (e.type === "goal" ? 0 : 1);
  events.sort((a, b) => {
    if (a.abs !== b.abs) return a.abs - b.abs;
    if (evKind(a) !== evKind(b)) return evKind(a) - evKind(b);
    if (a.type === "goal" && b.type === "goal") {
      return (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0) || a.clock - b.clock;
    }
    if (a.type === "roundEnd" && b.type === "roundEnd") return a.matchday - b.matchday;
    return 0;
  });

  const matchById = new Map(all.map((m) => [m.id, m]));
  const running = new Map<string, Score>(all.map((m) => [m.id, { home: 0, away: 0 }]));

  // 絶対時刻 absT 時点の試合スコア:
  //   消化済み かつ kickoff <= absT … running（進行中/消化済み。0-0 進行中は現在引分扱い）
  //   それ以外（未来 or 未消化）       … 未消化（score なし）
  const viewAt = (absT: number): Match[] =>
    all.map((m) =>
      isPlayed(m) && koMin.get(m.id)! <= absT
        ? { ...m, score: { ...running.get(m.id)! } }
        : { ...m, score: undefined },
    );

  const snaps: Snapshot[] = [];
  let prev: Standings | null = null;

  events.forEach((ev, i) => {
    if (ev.type === "goal") {
      const sc = running.get(ev.matchId)!;
      if (ev.goal.side === "home") sc.home++;
      else sc.away++;
      const m = matchById.get(ev.matchId)!;
      const snap = snapshotFrom(group, teamIds, ct, viewAt(ev.abs), prev, {
        key: `${group}-ev-${i}`,
        clockLabel: clockLabel(ev.goal),
        kind: "goal",
        matchday: m.matchday,
        event: {
          matchId: ev.matchId,
          homeId: m.home,
          awayId: m.away,
          homeScore: sc.home,
          awayScore: sc.away,
          matchday: m.matchday,
          scorerSide: ev.goal.side,
          scorer: ev.goal.player,
          minute: ev.goal.minute,
        },
      });
      snaps.push(snap);
      prev = snap.standings;
    } else {
      // 節末: この節のゴールは全て処理済み（ソート順）なので running はその節の最終スコア。
      const roundResults: RoundResult[] = ev.matches.map((m) => {
        const sc = running.get(m.id)!;
        return { matchId: m.id, homeId: m.home, awayId: m.away, homeScore: sc.home, awayScore: sc.away };
      });
      const snap = snapshotFrom(group, teamIds, ct, viewAt(ev.abs), prev, {
        key: `${group}-re-${ev.matchday}`,
        clockLabel: `第${ev.matchday}節 終了`,
        kind: "roundEnd",
        matchday: ev.matchday,
        roundResults,
      });
      snaps.push(snap);
      prev = snap.standings;
    }
  });

  return snaps;
}
