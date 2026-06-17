// 通過条件（シナリオ）。グループの状態に適応してチームごとの「何が必要か / どう決着したか」を出す。
// 旧マトリックス（決着済み試合のスコアを格子で振る反実仮想）を置換する。
//
// フェーズ:
//   decided     … 全試合消化。隣接順位を分けた「決め手（タイブレーク）」を解説する（反実仮想は出さない）。
//   final-round … 最終節だけ残っている（4チーム組なら同時刻2試合）。各チームの自分の試合結果(勝/分/敗)で
//                 通過条件を分類する。「他会場（同時刻のもう1試合）しだい」は結合結果として正しく扱う。
//   early       … まだ複数節が残る（条件は流動的）。捏造せず現状＋次の対戦だけ示す。
//
// 決定的（同入力 → 同出力）。エンジンは DOM・Date 非依存。
import type { CompiledTournament, GroupId, Match, Meta, ResultOverride, StandingRow } from "../types";
import { computeStandings, headToHead } from "../standings";
import { groupStatus, type QualStatus } from "../status";

export type GroupPhase = "decided" | "final-round" | "early";
export type Verdict = "advance" | "depends" | "out";
export type TiebreakReason =
  | "points"
  | "gd"
  | "gf"
  | "h2h_pts"
  | "h2h_gd"
  | "h2h_gf"
  | "fairplay"
  | "lottery";

/** decided 用: 隣接する2順位を分けた決め手。 */
export interface BoundaryNote {
  /** 上位チーム id */
  higher: string;
  /** 下位チーム id */
  lower: string;
  /** 上位側の順位（例 2 なら 2位↔3位の境界） */
  rankHigher: number;
  /** この境界が通過枠の境目か（rankHigher === advancePerGroup） */
  cutoff: boolean;
  reason: TiebreakReason;
  /** 決着クラウズの素片（例 "総得点 4-2"）。テストと表示の保険。 */
  detail: string;
}

/** final-round 用: 自チームの試合結果ごとの通過可否。 */
export interface TeamCondition {
  result: "win" | "draw" | "loss";
  verdict: Verdict;
  /** 例 "2点差以上の勝利で" / "他会場・得失点しだい" */
  note?: string;
}

export interface TeamQualification {
  teamId: string;
  rank: number;
  points: number;
  gd: number;
  gf: number;
  status: QualStatus;
  /** final-round で自チームが出る残り試合（無い＝既に消化 or その節に出ない） */
  ownMatch?: Match;
  /** final-round のみ。win/draw/loss の順。 */
  conditions: TeamCondition[];
  /** early のみ。次に対戦する相手 teamId。 */
  nextOpponent?: string;
}

export interface GroupQualification {
  group: GroupId;
  phase: GroupPhase;
  /** 現順位昇順 */
  teams: TeamQualification[];
  /** decided: 1↔2 と 2↔3 の決め手 */
  boundaries: BoundaryNote[];
  /** final-round / early: 未消化試合 */
  remaining: Match[];
  /** final-round かつ未消化が同時刻（同一 kickoff）2試合以上 */
  simultaneous: boolean;
  /** final-round: 勝点で並びうる（＝タイブレークで通過/上位が決まりうる）チーム。現順位昇順。 */
  tiebreakWatch?: string[];
}

/** 1試合あたりの片側得点レンジ（0..5）。status.ts と同じ刻み。 */
const PER_SIDE = 6;
/** これを超える未消化数なら列挙しない（＝序盤）。 */
const MAX_SCENARIOS = 500_000;

interface ResolvedMatch {
  home: string;
  away: string;
  hs: number;
  as: number;
}

function isPlayed(m: Match): boolean {
  return m.score !== undefined && m.score !== null;
}

function resolvedFromMatches(matches: Match[]): ResolvedMatch[] {
  const out: ResolvedMatch[] = [];
  for (const m of matches) {
    const s = m.score;
    if (s === undefined || s === null) continue;
    out.push({ home: m.home, away: m.away, hs: s.home, as: s.away });
  }
  return out;
}

function fmtGd(gd: number): string {
  return gd > 0 ? `+${gd}` : String(gd);
}

/** フェアプレーポイント（イエロー=1・レッド=4）の合計を teamId 別に集計。カード無しは 0。 */
function fairPlayByTeam(matches: Match[], teamIds: string[]): Map<string, number> {
  const fp = new Map<string, number>(teamIds.map((id) => [id, 0]));
  for (const m of matches) {
    if (!m.cards) continue;
    fp.set(m.home, (fp.get(m.home) ?? 0) + m.cards.home.y + m.cards.home.r * 4);
    fp.set(m.away, (fp.get(m.away) ?? 0) + m.cards.away.y + m.cards.away.r * 4);
  }
  return fp;
}

/** 隣接2チーム（higher が上位）の最終順位を分けた FIFA 基準を特定する。 */
function decisiveCriterion(
  higher: StandingRow,
  lower: StandingRow,
  rows: StandingRow[],
  resolved: ResolvedMatch[],
  meta: Meta,
  fairPlay: Map<string, number>,
): { reason: TiebreakReason; detail: string } {
  if (higher.points !== lower.points)
    return { reason: "points", detail: `勝点 ${higher.points}-${lower.points}` };
  if (higher.gd !== lower.gd)
    return { reason: "gd", detail: `総得失点差 ${fmtGd(higher.gd)}/${fmtGd(lower.gd)}` };
  if (higher.gf !== lower.gf) return { reason: "gf", detail: `総得点 ${higher.gf}-${lower.gf}` };

  // 総合 a-c が同値 → 直接対決（h2h）。同点クラスタ全体で集計する（FIFA 規定）。
  const cluster = rows
    .filter((r) => r.points === higher.points && r.gd === higher.gd && r.gf === higher.gf)
    .map((r) => r.teamId);
  const h2h = headToHead(cluster, resolved, meta);
  const ha = h2h.get(higher.teamId)!;
  const hb = h2h.get(lower.teamId)!;
  if (ha.points !== hb.points)
    return { reason: "h2h_pts", detail: `直接対決の勝点 ${ha.points}-${hb.points}` };
  if (ha.gd !== hb.gd)
    return { reason: "h2h_gd", detail: `直接対決の得失点差 ${fmtGd(ha.gd)}/${fmtGd(hb.gd)}` };
  if (ha.gf !== hb.gf)
    return { reason: "h2h_gf", detail: `直接対決の得点 ${ha.gf}-${hb.gf}` };

  const fa = fairPlay.get(higher.teamId);
  const fb = fairPlay.get(lower.teamId);
  if (fa !== undefined && fb !== undefined && fa !== fb)
    return { reason: "fairplay", detail: `フェアプレー ${fa}-${fb}` };
  return { reason: "lottery", detail: "抽選" };
}

/** 未消化試合の全スコア組合せを列挙してコールバック。 */
function enumerate(unplayed: Match[], cb: (overrides: ResultOverride[]) => void): void {
  const acc: ResultOverride[] = [];
  const rec = (i: number): void => {
    if (i === unplayed.length) {
      cb([...acc]);
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

interface BucketSample {
  /** 自チームの得点 */
  gf: number;
  /** 自チームの失点 */
  ga: number;
  advances: boolean;
  /** 通過枠内だが抽選待ち */
  contested: boolean;
}

/** 1バケット（自チームの勝/分/敗）の通過可否を判定。win は得点差しきい値に精緻化する。 */
function bucketVerdict(samples: BucketSample[], isWin: boolean): { verdict: Verdict; note?: string } {
  if (samples.length === 0) return { verdict: "depends" };
  const advCount = samples.filter((s) => s.advances).length;
  const contestedCount = samples.filter((s) => s.contested).length;
  if (advCount === samples.length) return { verdict: "advance" };
  if (advCount === 0 && contestedCount === 0) return { verdict: "out" };

  // 勝ちバケットは「k点差以上の勝利なら（他会場に依らず）必ず通過」に精緻化を試みる。
  if (isWin) {
    const maxMargin = Math.max(...samples.map((s) => s.gf - s.ga));
    for (let k = 2; k <= maxMargin; k++) {
      const ge = samples.filter((s) => s.gf - s.ga >= k);
      if (ge.length > 0 && ge.every((s) => s.advances)) {
        return { verdict: "advance", note: `${k}点差以上の勝利で` };
      }
    }
  }
  return { verdict: "depends", note: "他会場・得失点しだい" };
}

export function analyzeGroup(ct: CompiledTournament, group: GroupId): GroupQualification {
  const matches = ct.matchesByGroup.get(group);
  if (!matches) throw new Error(`analyzeGroup: 組 ${group} が無い`);
  const teamIds = ct.teamsByGroup.get(group)!.map((t) => t.id);
  const meta: Meta = ct.meta;
  const adv = meta.advancePerGroup;

  const standings = computeStandings(group, matches, teamIds, meta);
  const rows = standings.rows;
  const rowOf = new Map(rows.map((r) => [r.teamId, r]));
  const statusList = groupStatus(ct, group);
  const statusOf = new Map(statusList.map((s) => [s.teamId, s.status]));

  const unplayed = matches.filter((m) => !isPlayed(m));
  const maxMd = Math.max(...matches.map((m) => m.matchday));
  const enumerable = unplayed.length > 0 && PER_SIDE ** (2 * unplayed.length) <= MAX_SCENARIOS;
  let phase: GroupPhase;
  if (unplayed.length === 0) phase = "decided";
  else if (unplayed.every((m) => m.matchday === maxMd) && enumerable) phase = "final-round";
  else phase = "early";

  const baseTeam = (teamId: string): TeamQualification => {
    const r = rowOf.get(teamId)!;
    return {
      teamId,
      rank: r.rank,
      points: r.points,
      gd: r.gd,
      gf: r.gf,
      status: statusOf.get(teamId) ?? "alive",
      conditions: [],
    };
  };

  // ---- decided: 決め手の解説 ----
  const boundaries: BoundaryNote[] = [];
  if (phase === "decided") {
    const resolved = resolvedFromMatches(matches);
    const fairPlay = fairPlayByTeam(matches, teamIds);
    // 隣接ペア (1↔2) と (2↔3) を解説（行 index 0-1 と 1-2）。
    for (const i of [0, 1]) {
      const higher = rows[i];
      const lower = rows[i + 1];
      if (!higher || !lower) continue;
      const { reason, detail } = decisiveCriterion(higher, lower, rows, resolved, meta, fairPlay);
      boundaries.push({
        higher: higher.teamId,
        lower: lower.teamId,
        rankHigher: higher.rank,
        cutoff: higher.rank === adv,
        reason,
        detail,
      });
    }
  }

  const teams: TeamQualification[] = rows.map((r) => baseTeam(r.teamId));

  // ---- final-round: 自チーム結果別の通過条件 ----
  let simultaneous = false;
  let tiebreakWatch: string[] | undefined;
  if (phase === "final-round") {
    const kicks = new Set(unplayed.map((m) => m.kickoff ?? ""));
    simultaneous = unplayed.length >= 2 && kicks.size === 1 && !kicks.has("");

    const ownMatch = new Map<string, Match>();
    for (const m of unplayed) {
      ownMatch.set(m.home, m);
      ownMatch.set(m.away, m);
    }
    // 1回の列挙で全チーム分のサンプルと「勝点で並びうるチーム」を集める。
    const samples = new Map<string, BucketSample[]>(teamIds.map((id) => [id, []]));
    const tieWatch = new Set<string>();
    enumerate(unplayed, (overrides) => {
      const ovById = new Map(overrides.map((o) => [o.matchId, o.score]));
      const st = computeStandings(group, matches, teamIds, meta, overrides);
      const stRow = new Map(st.rows.map((r) => [r.teamId, r]));
      for (const id of teamIds) {
        const own = ownMatch.get(id);
        if (!own) continue;
        const sc = ovById.get(own.id)!;
        const gf = own.home === id ? sc.home : sc.away;
        const ga = own.home === id ? sc.away : sc.home;
        const r = stRow.get(id)!;
        samples.get(id)!.push({
          gf,
          ga,
          advances: r.advances,
          contested: !r.advances && r.rank <= adv,
        });
      }
      // このシナリオで勝点が等しい連続ラン（先頭 rank<=adv＝通過/上位争いに絡む）を集める。
      const sr = st.rows;
      for (let i = 0; i < sr.length; ) {
        let j = i;
        while (j + 1 < sr.length && sr[j + 1].points === sr[i].points) j++;
        if (j > i && sr[i].rank <= adv) {
          for (let k = i; k <= j; k++) tieWatch.add(sr[k].teamId);
        }
        i = j + 1;
      }
    });
    if (tieWatch.size > 0) {
      tiebreakWatch = [...tieWatch].sort(
        (a, b) => rowOf.get(a)!.rank - rowOf.get(b)!.rank || (a < b ? -1 : a > b ? 1 : 0),
      );
    }

    for (const tq of teams) {
      const own = ownMatch.get(tq.teamId);
      tq.ownMatch = own;
      if (!own || tq.status === "advanced" || tq.status === "eliminated") continue;
      const all = samples.get(tq.teamId)!;
      const win = all.filter((s) => s.gf > s.ga);
      const draw = all.filter((s) => s.gf === s.ga);
      const loss = all.filter((s) => s.gf < s.ga);
      const conds: TeamCondition[] = [];
      for (const [result, bucket, isWin] of [
        ["win", win, true],
        ["draw", draw, false],
        ["loss", loss, false],
      ] as const) {
        if (bucket.length === 0) continue;
        const { verdict, note } = bucketVerdict(bucket, isWin);
        conds.push({ result, verdict, note });
      }
      tq.conditions = conds;
    }
  }

  // ---- early: 次の対戦だけ示す ----
  if (phase === "early") {
    const byTeamNext = new Map<string, Match>();
    const sorted = [...unplayed].sort((a, b) =>
      a.matchday - b.matchday || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const m of sorted) {
      if (!byTeamNext.has(m.home)) byTeamNext.set(m.home, m);
      if (!byTeamNext.has(m.away)) byTeamNext.set(m.away, m);
    }
    for (const tq of teams) {
      const next = byTeamNext.get(tq.teamId);
      if (next) tq.nextOpponent = next.home === tq.teamId ? next.away : next.home;
    }
  }

  return { group, phase, teams, boundaries, remaining: unplayed, simultaneous, tiebreakWatch };
}
