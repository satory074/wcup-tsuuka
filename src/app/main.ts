// アプリの配線: compileTournament → standings / thirds / status / matrix → render → URL クエリ同期。
// エンジン（純TS）と render（DOM）をつなぐ唯一の場所。大会（2022/2026）は ?cup で選ぶ。
import worldcup2022 from "../data/worldcup2022.json";
import worldcup2026 from "../data/worldcup2026.json";
import { compileTournament } from "../engine/compile";
import { computeStandings } from "../engine/standings";
import { computeBestThirds } from "../engine/thirds";
import { groupStatus } from "../engine/status";
import { buildMatrix } from "../engine/scenario/matrix";
import { defaultPivot, otherUnplayed } from "../engine/scenario/pivot";
import { buildLiveTimeline, buildStageTimeline } from "../engine/timeline";
import type { CompiledTournament, GroupId, ResultOverride, Score, Standings } from "../engine/types";
import { createRenderer, type ViewMode } from "./render";
import { decodeQuery, encodeQuery, type Cup } from "./url";

const DATA: Record<Cup, unknown> = { "2022": worldcup2022, "2026": worldcup2026 };
// 既定大会は 2022（既存の共有URL＝?cup無し＝2022 を温存）。2026 は切替UIで前面に出す。
const DEFAULT_CUP: Cup = "2022";

export function boot(root: HTMLElement, dataArg?: unknown): void {
  // ?cup を compile 前に読み、データを選ぶ（テスト注入の dataArg は最優先）。
  const q0 = decodeQuery(location.search);
  const cup: Cup = q0.cup ?? DEFAULT_CUP;
  const data = dataArg ?? DATA[cup];

  let ct: CompiledTournament;
  try {
    ct = compileTournament(data);
  } catch (e) {
    const pre = document.createElement("pre");
    pre.className = "error-panel";
    pre.textContent = `データ読み込みエラー:\n${e instanceof Error ? e.message : String(e)}`;
    root.replaceChildren(pre);
    return;
  }

  let group: GroupId = ct.groups[0];
  let view: ViewMode = "live";
  let pivotId = "";
  // 他の未消化試合に置く仮定スコア（matchId → Score）。グループ切替でクリア。
  const assumeValues = new Map<string, Score>();

  const renderer = createRenderer(root, ct, cup, (cmd) => {
    switch (cmd.type) {
      case "set-group":
        if (!ct.groups.includes(cmd.group)) return;
        group = cmd.group;
        assumeValues.clear();
        pivotId = defaultPivot(ct.matchesByGroup.get(group)!);
        rerender();
        syncUrl();
        break;
      case "set-view":
        view = cmd.view;
        rerender();
        syncUrl();
        break;
      case "set-cup":
        // 大会切替は ?cup だけにして全再読込（group/pivot/assume を破棄・リスナー重複も回避）。
        if (cmd.cup !== cup) location.search = `cup=${cmd.cup}`;
        break;
      case "set-pivot": {
        const matches = ct.matchesByGroup.get(group)!;
        if (matches.some((m) => m.id === cmd.pivotId)) pivotId = cmd.pivotId;
        rerender();
        syncUrl();
        break;
      }
      case "set-assume":
        assumeValues.set(cmd.matchId, cmd.score);
        rerender();
        syncUrl();
        break;
    }
  });

  function currentAssumptions(): ResultOverride[] {
    const matches = ct.matchesByGroup.get(group)!;
    return otherUnplayed(pivotId, matches).map((m) => ({
      matchId: m.id,
      score: assumeValues.get(m.id) ?? { home: 0, away: 0 },
    }));
  }

  function rerender(): void {
    // 全組の順位を計算し、ベスト3位（2026方式）を横断算出する（12組×4チームで安価）。
    const standingsByGroup = new Map<GroupId, Standings>();
    for (const gid of ct.groups) {
      const gMatches = ct.matchesByGroup.get(gid)!;
      const gTeamIds = ct.teamsByGroup.get(gid)!.map((t) => t.id);
      standingsByGroup.set(gid, computeStandings(gid, gMatches, gTeamIds, ct.meta));
    }
    const standings = standingsByGroup.get(group)!;
    const bestThirds = computeBestThirds(ct, standingsByGroup);

    const matches = ct.matchesByGroup.get(group)!;
    const status = groupStatus(ct, group);
    const liveTimeline = buildLiveTimeline(ct, group);
    const stageTimeline = buildStageTimeline(ct, group);
    // live データが無い組では stage にフォールバック
    if (view === "live" && liveTimeline === null) view = "stage";
    const assumeMatches = otherUnplayed(pivotId, matches);
    const matrix = buildMatrix({ ct, group, pivotMatchId: pivotId, assumptions: currentAssumptions() });
    renderer.render({
      group,
      view,
      standings,
      status,
      bestThirds,
      liveTimeline,
      stageTimeline,
      matrix,
      pivotId,
      pivotOptions: matches,
      assumeMatches,
      assumeValues,
    });
  }

  function syncUrl(): void {
    const qs = encodeQuery({ cup, group, view, pivot: pivotId, assume: currentAssumptions() });
    history.replaceState(null, "", `${location.pathname}${qs}`);
  }

  // ---- URL クエリから復元（共有URL対応） ----
  const q = decodeQuery(location.search);
  if (q.group && ct.groups.includes(q.group)) group = q.group;
  if (q.view) view = q.view;
  const matches = ct.matchesByGroup.get(group)!;
  pivotId = q.pivot && matches.some((m) => m.id === q.pivot) ? q.pivot : defaultPivot(matches);
  if (q.assume) {
    const others = new Set(otherUnplayed(pivotId, matches).map((m) => m.id));
    for (const o of q.assume) {
      if (others.has(o.matchId)) assumeValues.set(o.matchId, o.score);
    }
  }

  rerender();
  syncUrl();
}
