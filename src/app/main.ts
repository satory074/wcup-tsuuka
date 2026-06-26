// アプリの配線: compileTournament → standings / thirds / status / qualify → render → URL クエリ同期。
// エンジン（純TS）と render（DOM）をつなぐ唯一の場所。大会（2022/2026）は ?cup で選ぶ。
import worldcup2018 from "../data/worldcup2018.json";
import worldcup2022 from "../data/worldcup2022.json";
import worldcup2026 from "../data/worldcup2026.json";
import { compileTournament } from "../engine/compile";
import { computeStandings } from "../engine/standings";
import { computeBestThirds } from "../engine/thirds";
import { computeKnockout } from "../engine/knockout";
import { groupStatus } from "../engine/status";
import { analyzeGroup } from "../engine/scenario/qualify";
import { buildTimeline } from "../engine/timeline";
import { computeScorers } from "../engine/scorers";
import type { CompiledTournament, GroupId, Standings } from "../engine/types";
import { createRenderer, type OverviewPhase } from "./render";
import { decodeQuery, encodeQuery, type Cup, type Scope } from "./url";

// 一覧カードのフェーズを消化試合数から安価に導出（列挙ベースの analyzeGroup は使わない）。
// 4チーム組=6試合。各試合が2チームの played を+1するので matchesPlayed = Σplayed / 2（0..6）。
function derivePhase(st: Standings): OverviewPhase {
  const played = st.rows.reduce((n, r) => n + r.played, 0) / 2;
  return played >= 6 ? "decided" : played >= 4 ? "final-round" : "early";
}

const DATA: Record<Cup, unknown> = { "2018": worldcup2018, "2022": worldcup2022, "2026": worldcup2026 };
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
  let scope: Scope = "detail";

  const renderer = createRenderer(root, ct, cup, (cmd) => {
    switch (cmd.type) {
      case "set-group":
        if (!ct.groups.includes(cmd.group)) return;
        group = cmd.group;
        rerender();
        syncUrl();
        break;
      case "set-scope":
        scope = cmd.scope;
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
    const phaseByGroup = new Map<GroupId, OverviewPhase>();
    for (const gid of ct.groups) {
      const gMatches = ct.matchesByGroup.get(gid)!;
      const gTeamIds = ct.teamsByGroup.get(gid)!.map((t) => t.id);
      const st = computeStandings(gid, gMatches, gTeamIds, ct.meta);
      standingsByGroup.set(gid, st);
      phaseByGroup.set(gid, derivePhase(st));
    }
    const bestThirds = computeBestThirds(ct, standingsByGroup);
    // 決勝トーナメント（ブラケット）は順位から解決。両スコープで全幅表示するので scope 非依存に算出。
    const knockout = computeKnockout(ct, standingsByGroup);
    // 得点ランキングは大会全体（全グループ横断）で安価に算出。両スコープで渡す。
    const scorers = computeScorers(ct);

    // 一覧（overview）は順位の投影のみ。列挙コストのある詳細計算は detail のときだけ行う。
    if (scope !== "detail") {
      renderer.render({ scope, group, standingsByGroup, phaseByGroup, bestThirds, knockout, scorers });
      return;
    }

    const standings = standingsByGroup.get(group)!;
    const status = groupStatus(ct, group);
    const timeline = buildTimeline(ct, group);
    const qualification = analyzeGroup(ct, group);
    renderer.render({
      scope,
      group,
      standingsByGroup,
      phaseByGroup,
      bestThirds,
      knockout,
      scorers,
      standings,
      status,
      timeline,
      qualification,
    });
  }

  function syncUrl(): void {
    const qs = encodeQuery({ cup, group, scope });
    history.replaceState(null, "", `${location.pathname}${qs}`);
  }

  // ---- URL クエリから復元（共有URL対応） ----
  const q = decodeQuery(location.search);
  if (q.group && ct.groups.includes(q.group)) group = q.group;
  if (q.scope) scope = q.scope;

  rerender();
  syncUrl();
}
