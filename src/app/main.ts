// アプリの配線: compileTournament → standings / thirds / status / timeline → render → URL（パス）同期。
// エンジン（純TS）と render（DOM）をつなぐ唯一の場所。
//   - mount(): 渡された状態で描画する。ビルド時の事前描画（src/lib/prerender.ts・jsdom）もこれを呼ぶ＝
//     配信 HTML と JS 実行後の画面は同じ関数から出る。location / history / document には触らない。
//   - boot(): ブラウザ用。<main id="app" data-cup data-scope data-group data-base> から初期状態を読み、
//     旧 ?cup=&group=&scope= のリンクは新しいパスへ location.replace し、操作に合わせてパスと <title> を書き換える。
import { compileTournament } from "../engine/compile";
import { computeStandings } from "../engine/standings";
import { computeBestThirds } from "../engine/thirds";
import { computeKnockout } from "../engine/knockout";
import { groupStatus } from "../engine/status";
import { buildTimeline } from "../engine/timeline";
import { computeScorers } from "../engine/scorers";
import type { CompiledTournament, GroupId, Standings } from "../engine/types";
import { createRenderer, type OverviewPhase } from "./render";
import { pageInfo, type PageInfo } from "./pageInfo";
import { DATA, groupsOf } from "./data";
import { DEFAULT_CUP, isCup, legacyQueryPath, pagePath, type Cup, type Scope } from "./url";

// 一覧カードのフェーズを消化試合数から安価に導出（列挙ベースの analyzeGroup は使わない）。
// 4チーム組=6試合。各試合が2チームの played を+1するので matchesPlayed = Σplayed / 2（0..6）。
function derivePhase(st: Standings): OverviewPhase {
  const played = st.rows.reduce((n, r) => n + r.played, 0) / 2;
  return played >= 6 ? "decided" : played >= 4 ? "final-round" : "early";
}

export interface InitialState {
  cup: Cup;
  scope: Scope;
  /** detail のときの組。無い・その大会に無い組なら先頭の組。 */
  group?: GroupId;
}

export interface MountOptions {
  /** サイトの base（末尾 "/"。例 "/wcup-tsuuka/"）。タブのリンク先に使う。 */
  base: string;
  /** 利用者の操作で表示が変わったとき（初回描画では呼ばない）。path は base からの相対。 */
  onChange?: (path: string, page: PageInfo) => void;
}

export interface Mounted {
  /** 初回描画で使った組（事前描画が data 属性に書く）。 */
  group: GroupId;
  page: PageInfo;
}

/** 渡された状態で root に描画し、操作を受け付ける。データが不正ならエラー表示して null。 */
export function mount(root: HTMLElement, data: unknown, init: InitialState, opts: MountOptions): Mounted | null {
  const cup = init.cup;
  let ct: CompiledTournament;
  try {
    ct = compileTournament(data);
  } catch (e) {
    const pre = root.ownerDocument.createElement("pre");
    pre.className = "error-panel";
    pre.textContent = `データ読み込みエラー:\n${e instanceof Error ? e.message : String(e)}`;
    root.replaceChildren(pre);
    return null;
  }

  let group: GroupId = init.group && ct.groups.includes(init.group) ? init.group : ct.groups[0];
  let scope: Scope = init.scope;

  const renderer = createRenderer(root, ct, cup, opts.base, (cmd) => {
    switch (cmd.type) {
      case "open-group":
        // グループタブ・一覧カード・日程カード → そのグループの詳細へ（一覧からでもドリル）。
        if (!ct.groups.includes(cmd.group)) return;
        if (group === cmd.group && scope === "detail") return;
        group = cmd.group;
        scope = "detail";
        changed();
        break;
      case "set-scope":
        if (scope === cmd.scope) return;
        scope = cmd.scope;
        changed();
        break;
    }
  });

  function changed(): void {
    const page = rerender();
    opts.onChange?.(pagePath(cup, scope, group), page);
  }

  function rerender(): PageInfo {
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
    // 見出し・要約・<title>（事前描画の <head> とブラウザでの切替が同じ関数を使う）。
    const page = pageInfo({ ct, cup, scope, group, standingsByGroup, knockout, scorers });

    // 一覧（overview）は順位の投影のみ。列挙コストのある詳細計算は detail のときだけ行う。
    if (scope !== "detail") {
      renderer.render({ scope, group, page, standingsByGroup, phaseByGroup, bestThirds, knockout, scorers });
      return page;
    }

    const standings = standingsByGroup.get(group)!;
    const status = groupStatus(ct, group);
    const timeline = buildTimeline(ct, group);
    renderer.render({
      scope,
      group,
      page,
      standingsByGroup,
      phaseByGroup,
      bestThirds,
      knockout,
      scorers,
      standings,
      status,
      timeline,
    });
    return page;
  }

  const page = rerender();
  return { group, page };
}

/** ブラウザ用の起動。初期状態は事前描画が付けた data 属性から読む（URL は解析しない）。 */
export function boot(root: HTMLElement, dataArg?: unknown): void {
  const ds = root.dataset;
  const base = ds.base ?? "/";
  const cup: Cup = isCup(ds.cup) ? ds.cup : DEFAULT_CUP;

  // 旧形式の共有URL（/wcup-tsuuka/?cup=2022&group=E&scope=detail）→ 新しいパスへ。履歴は増やさない。
  const legacy = legacyQueryPath(location.search, cup, groupsOf);
  if (legacy !== null) {
    location.replace(`${base}${legacy}${location.hash}`);
    return;
  }

  mount(
    root,
    dataArg ?? DATA[cup],
    { cup, scope: ds.scope === "detail" ? "detail" : "overview", group: ds.group as GroupId | undefined },
    {
      base,
      // 一覧⇔詳細・グループ切替は再読込せずに描き替え、URL はそのページの本当のパスにする（共有・再読込で同じ画面）。
      onChange: (path, page) => {
        history.replaceState(null, "", `${base}${path}`);
        document.title = page.title;
      },
    },
  );
}
