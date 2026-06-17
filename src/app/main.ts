// アプリの配線: compileTournament → standings / thirds / status / qualify → render → URL クエリ同期。
// エンジン（純TS）と render（DOM）をつなぐ唯一の場所。大会（2022/2026）は ?cup で選ぶ。
import worldcup2022 from "../data/worldcup2022.json";
import worldcup2026 from "../data/worldcup2026.json";
import { compileTournament } from "../engine/compile";
import { computeStandings } from "../engine/standings";
import { computeBestThirds } from "../engine/thirds";
import { groupStatus } from "../engine/status";
import { analyzeGroup } from "../engine/scenario/qualify";
import { buildLiveTimeline, buildStageTimeline } from "../engine/timeline";
import type { CompiledTournament, GroupId, Standings } from "../engine/types";
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

  const renderer = createRenderer(root, ct, cup, (cmd) => {
    switch (cmd.type) {
      case "set-group":
        if (!ct.groups.includes(cmd.group)) return;
        group = cmd.group;
        rerender();
        syncUrl();
        break;
      case "set-view":
        view = cmd.view;
        rerender();
        syncUrl();
        break;
      case "set-cup":
        // 大会切替は ?cup だけにして全再読込（group/view を破棄・リスナー重複も回避）。
        if (cmd.cup !== cup) location.search = `cup=${cmd.cup}`;
        break;
    }
  });

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

    const status = groupStatus(ct, group);
    const liveTimeline = buildLiveTimeline(ct, group);
    const stageTimeline = buildStageTimeline(ct, group);
    // live データが無い組では stage にフォールバック
    if (view === "live" && liveTimeline === null) view = "stage";
    const qualification = analyzeGroup(ct, group);
    renderer.render({
      group,
      view,
      standings,
      status,
      bestThirds,
      liveTimeline,
      stageTimeline,
      qualification,
    });
  }

  function syncUrl(): void {
    const qs = encodeQuery({ cup, group, view });
    history.replaceState(null, "", `${location.pathname}${qs}`);
  }

  // ---- URL クエリから復元（共有URL対応） ----
  const q = decodeQuery(location.search);
  if (q.group && ct.groups.includes(q.group)) group = q.group;
  if (q.view) view = q.view;

  rerender();
  syncUrl();
}
