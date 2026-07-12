// DOM レベルのスモークテスト: boot → 日程・結果（上部・ドリル）→ 最終順位/ステータス →
// タイムライン（チャート＋試合別得点ログ）→ ランキング(右レール)/決勝T(左) → 共有URL復元 → 大会切替 を jsdom で検証。
// 実行: npx tsx scripts/domtest.ts
import { JSDOM } from "jsdom";
import { boot } from "../src/app/main";
import { decodeQuery } from "../src/app/url";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
}

function setupDom(url: string): JSDOM {
  const dom = new JSDOM(`<!DOCTYPE html><body><main id="app"></main></body>`, { url, pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.location = dom.window.location;
  g.history = dom.window.history;
  g.requestAnimationFrame = () => 0;
  return dom;
}
function app(dom: JSDOM): HTMLElement {
  return dom.window.document.getElementById("app") as unknown as HTMLElement;
}
function click(dom: JSDOM, el: Element): void {
  el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}
const BASE_URL = "https://satory074.github.io/wcup-tsuuka/";

// ---- 0) デフォルト = 最新大会の一覧（2026 overview）。無クエリ。 ----
{
  const dom = setupDom(BASE_URL);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2026", "0: 既定大会は2026（最新）");
  assert((root.querySelector("#overview") as HTMLElement).hidden === false, "0: 既定は一覧（overview）表示");
  assert((root.querySelector("#detail-view") as HTMLElement).hidden === true, "0: 既定で詳細は非表示");
  assert(root.querySelectorAll(".overview-grid .mini-group").length === 12, "0: 2026 は12カード");
  assert(!dom.window.location.search.includes("scope"), "0: 既定 overview は URL に scope を出さない");
  console.log("[dom] デフォルト = 最新大会の一覧（2026 overview）OK");
}

// ---- 1) 初期描画（2022 詳細を明示）----
{
  const dom = setupDom(`${BASE_URL}?cup=2022&scope=detail`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".group-tab").length === 8, "1: グループタブ8");
  assert((root.querySelector("#overview") as HTMLElement).hidden === true, "1: 詳細指定で一覧は非表示");
  assert((root.querySelector("#detail-view") as HTMLElement).hidden === false, "1: 詳細表示");
  // 日程・結果（本文トップ・全試合の横並びカルーセル）。2022は全48試合・組Aの6試合を強調。
  assert(!!root.querySelector("#schedule .sched-carousel"), "1: 日程カルーセルがある");
  assert(root.querySelectorAll("#schedule .sched-card").length === 64, `1: 全試合48＋決勝T16=64カード（実際: ${root.querySelectorAll("#schedule .sched-card").length}）`);
  assert(root.querySelectorAll("#schedule .sched-card.is-ko").length === 16, "1: 決勝Tカード16（R16〜決勝）");
  assert(root.querySelectorAll("#schedule .sched-card.is-current").length === 6, `1: 該当グループAの6試合を強調（実際: ${root.querySelectorAll("#schedule .sched-card.is-current").length}）`);
  assert(root.querySelectorAll("#schedule .sched-card.is-upcoming").length === 0, "1: 2022は全消化＝未消化なし（KO結果入り）");
  assert([...root.querySelectorAll("#schedule .sched-date")].some((e) => /\d+\/\d+/.test(e.textContent ?? "")), "1: カードに日付");
  // カードはクリックでそのグループ詳細へドリル（drill-group）。
  assert(root.querySelectorAll('#schedule .sched-card[data-action="drill-group"]').length === 48, "1: 日程カードはドリル可能（data-action）");
  // レイアウト順序: 左カラム＝日程・結果(最上部) → 詳細ビュー → 決勝トーナメント。詳細内は 最終順位 → タイムライン。
  {
    const mainKids = [...root.querySelector(".layout-main")!.children].map((c) => c.id);
    assert(mainKids.indexOf("schedule") === 0, "1: 日程・結果が左カラム最上部");
    assert(mainKids.indexOf("schedule") < mainKids.indexOf("detail-view"), "1: 日程は詳細ビューより前");
    assert(mainKids.indexOf("detail-view") < mainKids.indexOf("knockout"), "1: 決勝トーナメントは左カラム末尾");
    const dv = [...root.querySelector("#detail-view")!.children].map((c) => c.id);
    assert(dv.indexOf("detail-main") < dv.indexOf("detail-timeline"), "1: 最終順位(detail-main)がタイムラインより前");
  }
  assert(root.querySelectorAll(".standings-table tbody tr").length === 4, "1: 順位表4行");
  assert(!!root.querySelector(".standings .tiebreak-legend"), "1: タイブレーク優先順位の凡例がある");
  assert(root.querySelectorAll(".standings-table thead .th-pri").length === 3, "1: 列見出しに優先順位番号3つ(点/差/得)");
  assert(root.querySelectorAll(".status-chips .chip").length === 4, "1: ステータスチップ4");
  // タイムライン（主役・単一・順位バンプチャート: 線=各国, 点=各イベント列, 右端=最終順位）。
  // 組Aは全試合15ゴール＋節末3列 → (15+3)×4=72頂点。表示モードトグルは廃止。
  assert(!root.querySelector(".view-toggle"), "1: 表示モードトグルは廃止された");
  assert(!!root.querySelector("svg.tl-chart"), "1: タイムラインがバンプチャート(SVG)で描画される");
  assert(root.querySelectorAll(".tl-chart .tl-line").length === 4, "1: 線=4チーム");
  // 線色は国旗由来＝4本が4色に分離（潰れ回帰の検出。正確なHEXは brittle なので入れない）
  const lineStrokes = new Set(
    [...root.querySelectorAll(".tl-chart .tl-line")].map(
      (el) => (el.getAttribute("style") ?? "").match(/stroke:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? "",
    ),
  );
  assert(lineStrokes.size === 4 && !lineStrokes.has(""), `1: 線色は旗由来で4色に分離（実際: ${[...lineStrokes].join(",")}）`);
  assert(root.querySelectorAll(".tl-chart .tl-dot").length === 72, `1: 頂点=4チーム×(15ゴール+3節末)=72（実際: ${root.querySelectorAll(".tl-chart .tl-dot").length}）`);
  assert(root.querySelectorAll(".tl-chart .tl-dot.is-roundend").length === 12, `1: 節末頂点=4チーム×3節=12（実際: ${root.querySelectorAll(".tl-chart .tl-dot.is-roundend").length}）`);
  assert(root.querySelectorAll(".tl-chart .tl-md").length === 3, "1: 節ラベルは3（第1〜3節）");
  assert([...root.querySelectorAll(".tl-chart .tl-md")].some((e) => /第\d節/.test(e.textContent ?? "")), "1: 節ラベルに第n節");
  assert(root.querySelectorAll(".tl-chart .tl-poslabel").length === 4, "1: 順位ラベル4（1〜4）");
  assert(root.querySelectorAll(".tl-chart .tl-endlabel").length === 4, "1: 右端の最終順位ラベル4");
  assert(root.querySelectorAll(".tl-chart .tl-dot.is-scorer").length === 15, "1: 得点で動いた頂点=全15ゴール");
  assert((root.querySelector('.tl-chart .tl-endlabel[data-team="ned"]')?.textContent ?? "").includes("オランダ"), "1: 右端ラベルは国名（オランダ）");
  // 最終順位1位（凡例先頭）がオランダ
  const leg0 = root.querySelector(".tl-legend .tl-leg-item")?.textContent ?? "";
  assert(leg0.includes("オランダ") && leg0.includes("1位"), `1: 凡例先頭=オランダ1位（実際: ${leg0}）`);
  assert((root.querySelector(".tl-chart")?.innerHTML ?? "").includes("ガクポ"), "1: 得点者名がツールチップに表示される");
  // チャート上に節結果スコア（各レーン上＝両参加チームに紐づく）= 3節×4チーム=12（組A 全消化）
  assert(root.querySelectorAll(".tl-chart .tl-round-score").length === 12, `1: チャートに節結果スコア12（実際: ${root.querySelectorAll(".tl-chart .tl-round-score").length}）`);
  assert([...root.querySelectorAll(".tl-chart .tl-round-score")].some((e) => /\d-\d/.test(e.textContent ?? "")), "1: 節結果スコアにスコア表記");
  // --- a11y / モバイル強化 ---
  assert(!!root.querySelector('a.skip-link[href="#main-content"]'), "1: スキップリンク（本文へ）がある");
  assert(!!root.querySelector("#main-content"), "1: スキップ先 #main-content がある");
  assert(!!root.querySelector("#detail-timeline .tl-readout"), "1: 得点者の読み取り行(.tl-readout)がある＝ホバー専用情報をタッチ/キーボードでも");
  assert(root.querySelectorAll('.tl-chart .tl-dot.is-scorer[tabindex="0"]').length === 15, "1: 得点点はキーボード/タッチで到達可能(tabindex)");
  assert(root.querySelectorAll('.tl-chart .tl-dot.is-roundend[tabindex="0"]').length === 12, "1: 節末点もキーボード/タッチで到達可能(tabindex)");
  assert(root.querySelectorAll(".tl-chart .tl-dot.is-scorer[aria-label]").length === 15, "1: 得点点に aria-label（得点者・SR用）");
  assert(root.querySelectorAll('.tl-legend .tl-leg-item[tabindex="0"]').length === 4, "1: 凡例はキーボードでフォーカス可能");
  assert(root.querySelectorAll('.standings-table thead th[scope="col"]').length === 10, "1: 順位表ヘッダに scope=col（SR）");
  // 線種（色覚非依存の冗長化）: 4本中3本に stroke-dasharray＝色以外でも識別可能。
  const dashed = [...root.querySelectorAll(".tl-chart .tl-line")].filter((el) => (el.getAttribute("style") ?? "").includes("stroke-dasharray")).length;
  assert(dashed === 3, `1: 4本中3本に線種(dasharray)＝色覚非依存の識別（実際: ${dashed}）`);
  // 得点タイムライン（チャート下）: 試合別カラム＝1節2カラム。組A=3節×2試合=6カラム・節見出し3・対戦見出し6。
  assert(root.querySelectorAll(".tl-log .tlog-goal:not(.tlog-noscore)").length === 15, `1: 得点行=全15ゴール（実際: ${root.querySelectorAll(".tl-log .tlog-goal:not(.tlog-noscore)").length}）`);
  assert(root.querySelectorAll(".tl-log .tlog-cols .tlog-md-group").length === 3, "1: 節グループ3（第1〜3節）");
  assert(root.querySelectorAll(".tl-log .tlog-col").length === 6, "1: 試合カラム6（3節×2試合）");
  assert(root.querySelectorAll(".tl-log .tlog-md-head").length === 3, "1: 節見出し3（第1〜3節）");
  assert(root.querySelectorAll(".tl-log .tlog-match").length === 6, "1: 各試合カラムに対戦見出し6");
  assert([...root.querySelectorAll(".tl-log .tlog-match")].some((e) => (e.textContent ?? "").includes("オランダ")), "1: 対戦見出しは国名（オランダ）");
  assert((root.querySelector(".tl-log")?.textContent ?? "").includes("ガクポ"), "1: 得点タイムラインに得点者名が見える");
  assert([...root.querySelectorAll(".tl-md-date")].some((e) => /\d+\/\d+/.test(e.textContent ?? "")), "1: 節ラベルに日付 M/D");
  // 順位表に FIFA順位を併記（組A=ned8/sen18/ecu44/qat50）。
  assert(root.querySelectorAll(".standings-table .team-fifa").length === 4, "1: 順位表に FIFA順位を4チーム併記");
  assert((root.querySelector(".standings-table .team-fifa")?.textContent ?? "").includes("FIFA"), "1: 併記は『FIFA ◯位』");
  // 2カラム共通シェル: ランキングは右レール(.layout-side)、決勝トーナメントは左カラム(.layout-main)。
  assert(!!root.querySelector(".layout-grid .layout-side #rankings"), "1: ランキングは右レール(.layout-side)内");
  assert(!!root.querySelector(".layout-grid .layout-main #knockout"), "1: 決勝トーナメントは左カラム(.layout-main)内");
  assert(!root.querySelector(".layout-side #knockout"), "1: 決勝トーナメントは右レールに無い");
  // FIFAランキングは一覧・詳細で共通の #rankings セクション内（scope 非依存・縦積み）。
  assert(!!root.querySelector("#rankings .rankings-stack #fifa-ranking .fr-table"), "1: FIFAランキングは共通 #rankings 内（縦積み）");
  assert(root.querySelectorAll("#fifa-ranking .fr-table tbody tr").length === 211, `1: FIFAランキングは世界全211カ国（実際: ${root.querySelectorAll("#fifa-ranking .fr-table tbody tr").length}）`);
  // 常時表示は出場最下位（2022=ガーナ61位）まで＝61行・以降は details.fr-more に折りたたみ。
  assert(root.querySelectorAll("#fifa-ranking .fr-card > .fr-table tbody tr").length === 61, `1: 常時表示は出場最下位61位まで=61行（実際: ${root.querySelectorAll("#fifa-ranking .fr-card > .fr-table tbody tr").length}）`);
  assert(!!root.querySelector("#fifa-ranking details.fr-more"), "1: 以降は折りたたみ（details.fr-more）");
  assert(root.querySelectorAll("#fifa-ranking .fr-more .fr-table tbody tr").length === 211 - 61, "1: 折りたたみは残り150カ国");
  assert(root.querySelectorAll("#fifa-ranking .fr-table tbody tr.is-team").length === 32, "1: 出場32カ国を強調（.is-team）");
  assert(root.querySelectorAll("#fifa-ranking .fr-table tbody tr.is-out").length === 211 - 32, "1: 非出場179カ国は淡色（.is-out）");
  assert(root.querySelectorAll("#fifa-ranking .fr-table tbody tr[data-team]").length === 32, "1: 出場国のみ data-team（ホバー連動）");
  assert(root.querySelectorAll("#fifa-ranking .fr-table tbody tr.is-current").length === 4, "1: 現在の組（A）4チームを強調");
  assert((root.querySelector("#fifa-ranking .fr-table tbody tr .fr-rank")?.textContent ?? "") === "1", "1: 先頭はFIFA1位");
  // 得点ランキングも共通 #rankings 内。2022 得点王はムバッペ（KO込み）。
  assert(!!root.querySelector("#rankings #top-scorers .ts-table"), "1: 得点ランキングは共通 #rankings 内");
  assert(root.querySelectorAll("#top-scorers .ts-table tbody tr").length >= 1, "1: 得点ランキングに行がある");
  assert((root.querySelector("#top-scorers")?.textContent ?? "").includes("バレンシア"), "1: バレンシア(3点)も得点ランキングに載る");
  // 通過条件（シナリオ）は削除済み＝パネルは存在しない。
  assert(!root.querySelector("#scenario-details") && !root.querySelector("#scenario"), "1: 通過条件パネルは削除されている");
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "A", "1: 既定はグループA");
  console.log("[dom] 初期描画（タイムライン＝順位バンプチャート）OK");
}

// ---- 1b) 単一タイムライン＋節末＋縦型ログ（組E） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2022&group=E&scope=detail`);
  boot(app(dom));
  const root = app(dom);
  // 分刻みなので頂点多数（24より多い）＋節末リング・節末ブロック3。
  assert(!!root.querySelector("svg.tl-chart"), "1b: 単一バンプチャート");
  assert(root.querySelectorAll(".tl-chart .tl-md").length === 3, "1b: 節ラベル3（第1〜3節）");
  const dots = root.querySelectorAll(".tl-chart .tl-dot").length;
  assert(dots > 24, `1b: 分刻みは頂点が多い（実際: ${dots}）`);
  assert(root.querySelectorAll(".tl-chart .tl-dot.is-roundend").length === 12, "1b: 節末リング=4×3=12");
  assert(root.querySelectorAll(".tl-chart .tl-round-score").length === 12, `1b: チャートに節結果スコア12（実際: ${root.querySelectorAll(".tl-chart .tl-round-score").length}）`);
  assert(root.querySelectorAll(".tl-log .tlog-col").length === 6, `1b: 試合カラム6（3節×2試合）（実際: ${root.querySelectorAll(".tl-log .tlog-col").length}）`);
  assert(root.querySelectorAll(".tl-log .tlog-md-head").length === 3, "1b: 縦型ログに節見出し3");
  // 節末リングの <title> に試合結果が入る（ツールチップ）
  assert([...root.querySelectorAll(".tl-chart .tl-dot.is-roundend title")].some((t) => /\d-\d/.test(t.textContent ?? "")), "1b: 節末頂点ツールチップに試合結果");
  console.log("[dom] 単一タイムライン＋節末＋縦型ログ OK");
}

// ---- 2) グループ切替（A → E） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2022&scope=detail`);
  boot(app(dom));
  const root = app(dom);
  const tabE = root.querySelector<HTMLElement>('.group-tab[data-group="E"]')!;
  click(dom, tabE);
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "E", "2: E が選択状態");
  assert(decodeQuery(dom.window.location.search).group === "E", "2: URL に group=E");
  // E の1位は日本（順位表先頭）
  const firstTeam = root.querySelector(".standings-table tbody tr .team-name")?.textContent ?? "";
  assert(firstTeam.includes("日本"), `2: E の1位は日本（実際: ${firstTeam}）`);
  console.log("[dom] グループ切替 OK");
}

// ---- 6) 共有URL復元（?group=H） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2022&group=H&scope=detail`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "H", "6: H が復元");
  const firstTeam = root.querySelector(".standings-table tbody tr .team-name")?.textContent ?? "";
  assert(firstTeam.includes("ポルトガル"), `6: H の1位はポルトガル（実際: ${firstTeam}）`);
  console.log("[dom] 共有URL復元 OK");
}

// ---- 6b) 旧 ?view= は無視され壊れない（後方互換） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2022&group=E&scope=detail&view=stage`);
  boot(app(dom));
  const root = app(dom);
  // view は廃止。group=E は復元され、単一タイムラインが描画される。URL から view は消える。
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "E", "6b: group=E は復元");
  assert(!!root.querySelector("svg.tl-chart"), "6b: 単一タイムライン描画");
  assert(!dom.window.location.search.includes("view"), "6b: 同期後の URL から view= が消える");
  console.log("[dom] 旧 ?view= 後方互換 OK");
}

// ---- 7) フッタ ----
{
  const dom = setupDom(BASE_URL);
  boot(app(dom));
  const root = app(dom);
  assert(!!root.querySelector(".site-footer .disclaimer"), "7: disclaimer 表示");
  assert(!!root.querySelector('.site-footer a[href^="http"]'), "7: 出典リンク");
  console.log("[dom] フッタ OK");
}

// ---- 8) 大会切替（?cup=2026: 12組・ベスト3位パネル。詳細を明示） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2026&scope=detail`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".cup-tab").length === 3, "8: 大会タブ3");
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2026", "8: 2026 が選択状態");
  assert(root.querySelectorAll(".group-tab").length === 12, `8: 2026 はグループタブ12（実際: ${root.querySelectorAll(".group-tab").length}）`);
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "A", "8: 既定はグループA");
  assert(root.querySelectorAll(".standings-table tbody tr").length === 4, "8: 順位表4行（単一組）");
  // 日程カルーセル: 2026 は全72試合＋決勝T32＝104カード。組Aの6試合を強調。R32＋R16＋QF全4試合が消化。
  assert(root.querySelectorAll("#schedule .sched-card").length === 104, `8: 2026 は全72＋決勝T32=104カード（実際: ${root.querySelectorAll("#schedule .sched-card").length}）`);
  assert(root.querySelectorAll("#schedule .sched-card.is-ko").length === 32, "8: 決勝Tカード32（R32〜決勝）");
  assert(root.querySelectorAll("#schedule .sched-card.is-current").length === 6, "8: 該当グループAの6試合を強調");
  assert(root.querySelectorAll("#schedule .sched-card.is-ko.is-upcoming").length === 4, "8: 2026 KOは R32＋R16＋QF全4試合消化＝残り4カード（SF2/3P/F）が is-upcoming");
  assert(root.querySelectorAll("#schedule .sched-card.is-ko:not(.is-upcoming)").length === 28, "8: 2026 KOで消化済みは R32 全16＋R16 全8＋QF 全4＝28カード");
  // 3位比較は一覧のみ＝詳細には無い。
  assert(!root.querySelector("#best-thirds"), "8: 3位比較は詳細に無い（一覧のみ）");
  // FIFAランキング（大会全体）: 2026 は全48出場国を FIFA順位順。組Aの4チームを強調。
  assert(root.querySelectorAll("#fifa-ranking .fr-table tbody tr").length === 211, `8: FIFAランキングは世界全211カ国（実際: ${root.querySelectorAll("#fifa-ranking .fr-table tbody tr").length}）`);
  // 常時表示は出場最下位（2026=NZL 85位）まで＝85行・以降は折りたたみ。
  assert(root.querySelectorAll("#fifa-ranking .fr-card > .fr-table tbody tr").length === 85, `8: 常時表示は出場最下位85位まで=85行（実際: ${root.querySelectorAll("#fifa-ranking .fr-card > .fr-table tbody tr").length}）`);
  assert(!!root.querySelector("#fifa-ranking details.fr-more"), "8: 以降は折りたたみ（details.fr-more）");
  assert(root.querySelectorAll("#fifa-ranking .fr-table tbody tr.is-team").length === 48, "8: 出場48カ国を強調（.is-team）");
  assert(root.querySelectorAll("#fifa-ranking .fr-table tbody tr.is-current").length === 4, "8: 現在の組（A）4チームを強調");
  // 決勝トーナメント（ブラケット）: 2026=R32 全32試合・R32は16試合＝3位8枠も割当済みで全32枠が実チーム・プールは消滅。
  assert(!!root.querySelector("#knockout .ko-bracket"), "8: 決勝トーナメント ブラケットがある");
  assert(root.querySelectorAll("#knockout .ko-match").length === 32, `8: KO 全32試合（実際: ${root.querySelectorAll("#knockout .ko-match").length}）`);
  assert(root.querySelectorAll("#knockout .ko-round-R32 .ko-match").length === 16, "8: KO R32=16試合");
  assert(root.querySelectorAll("#knockout .ko-round-R32 .ko-side.is-team[data-team]").length === 32, "8: R32 全32枠が実チーム（3位割当済み）");
  assert(root.querySelectorAll("#knockout .ko-round-R32 .ko-side.is-team .ko-fifa").length === 32, "8: R32 全32枠に FIFA順位を併記");
  assert(!root.querySelector("#knockout .ko-pool"), "8: 3位割当済み＝『未割当』プールは出さない");
  assert(!!root.querySelector('#knockout .ko-match .ko-date'), "8: ブラケット各試合に日付（knockoutSchedule）");
  // 会場ごとの正確なJST変換: KOカードを試合番号で引き、日付+時刻を検証（会場tzの回帰防止）。
  const koWhen = (no: string): string => {
    const card = [...root.querySelectorAll("#knockout .ko-match")].find(
      (c) => c.querySelector(".ko-no")?.textContent === `M${no}`,
    );
    return `${card?.querySelector(".ko-date")?.textContent ?? ""} ${card?.querySelector(".ko-time")?.textContent ?? ""}`;
  };
  assert(koWhen("76") === "6/30(火) 02:00", `8: M76 ブラジル-日本(ヒューストン/中部)は JST 6/30(火) 02:00（実際: ${koWhen("76")}）`);
  assert(koWhen("73") === "6/29(月) 04:00", `8: M73 南ア-カナダ(SoFi/太平洋)は JST 6/29(月) 04:00（実際: ${koWhen("73")}）`);
  assert(koWhen("75") === "6/30(火) 10:00", `8: M75 蘭-モロッコ(モンテレイ/メキシコ)は JST 6/30(火) 10:00（実際: ${koWhen("75")}）`);
  assert(koWhen("104") === "7/20(月) 04:00", `8: M104 決勝(MetLife/東部)は JST 7/20(月) 04:00（実際: ${koWhen("104")}）`);
  // R32＋R16＋QF全4試合: M73-M100 全28試合が消化済み＝勝者を強調＋スコア併記（SF/3P/F は未消化）。
  assert(root.querySelectorAll("#knockout .ko-side.is-winner").length === 28, "8: 2026 KO R32 全16＋R16 全8＋QF 全4＝勝者ハイライト28");
  assert(root.querySelectorAll("#knockout .ko-score").length === 56, "8: 2026 KO スコア併記は R32 16＋R16 8＋QF 4 の28試合×2=56枠");
  assert(!!root.querySelector("#knockout .ko-round-R32 .ko-so"), "8: 2026 R32 にPK戦表記あり（M74/M75）");
  assert(root.querySelector('#knockout .ko-round-R32 .ko-match.is-played .ko-side.is-winner')?.getAttribute("data-team") === "can", "8: 2026 R32 で最初の消化済み試合の勝者はカナダ");
  // 通過条件パネルは削除済み。
  assert(!root.querySelector("#scenario-details"), "8: 通過条件パネルは無い");
  // 組K に切替えても順位表が描画される（タブ動作の確認）。
  click(dom, root.querySelector<HTMLElement>('.group-tab[data-group="K"]')!);
  assert(root.querySelectorAll(".standings-table tbody tr").length === 4, "8: 組K 切替で順位表4行");
  console.log("[dom] 大会切替 ?cup=2026（12組・KO・FIFA）OK");
}

// ---- 8b) 2022 は best-thirds 非表示（DOM 不変） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2022&scope=detail`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".cup-tab").length === 3, "8b: 大会タブ3");
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2022", "8b: 2022 を選択");
  assert(!root.querySelector("#best-thirds"), "8b: 3位比較は詳細に無い（一覧のみ）");
  // 決勝トーナメント: 2022=R16 全16試合・R16=8・全消化なので R16 の16枠すべて実チーム・3位プールなし。
  assert(root.querySelectorAll("#knockout .ko-match").length === 16, `8b: 2022 KO 全16試合（実際: ${root.querySelectorAll("#knockout .ko-match").length}）`);
  assert(root.querySelectorAll("#knockout .ko-round-R16 .ko-match").length === 8, "8b: 2022 KO R16=8試合");
  assert(root.querySelectorAll("#knockout .ko-round-R16 .ko-side.is-team[data-team]").length === 16, "8b: 2022 R16は全16枠が実チーム");
  assert(!root.querySelector("#knockout .ko-pool"), "8b: 2022 は3位プールなし");
  // R5: KO結果入り＝QF以降も実チームに解決し、各試合に勝者ハイライト＋スコア。優勝はアルゼンチン。
  assert(root.querySelectorAll("#knockout .ko-side.is-team[data-team]").length === 32, "8b: 2022 KO 全16試合×2=32枠が実チーム（QF以降も解決）");
  assert(root.querySelectorAll("#knockout .ko-side.is-winner").length === 16, "8b: 2022 KO 各試合に勝者ハイライト16");
  assert(root.querySelectorAll("#knockout .ko-score").length === 32, "8b: 2022 KO スコア併記32");
  assert(root.querySelector('#knockout .ko-round-F .ko-side.is-winner')?.getAttribute("data-team") === "arg", "8b: 2022 優勝はアルゼンチン");
  assert(!!root.querySelector("#knockout .ko-so"), "8b: 2022 決勝はPK戦表記あり");
  // R6: 得点ランキングは大会全体（グループ＋決勝T）＝得点王ムバッペ8点。
  assert((root.querySelector("#top-scorers")?.textContent ?? "").includes("決勝トーナメント"), "8b: 得点ランキング見出しが大会全体（グループ＋決勝T）");
  assert((root.querySelector("#top-scorers .ts-table tbody tr .team-name")?.textContent ?? "") === "ムバッペ", "8b: 2022 得点王はムバッペ（KO込み）");
  console.log("[dom] 2022 best-thirds非表示＋KO勝者解決＋得点ランキングKO込み OK");
}

// ---- 8c) 大会切替（?cup=2018: 8組・全消化・組H フェアプレーで日本2位。詳細を明示） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2018&scope=detail`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".cup-tab").length === 3, "8c: 大会タブ3");
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2018", "8c: 2018 が選択状態");
  assert(root.querySelectorAll(".group-tab").length === 8, `8c: 2018 はグループタブ8（実際: ${root.querySelectorAll(".group-tab").length}）`);
  // 全48試合＋決勝T16＝64カード・全消化（KO結果入り＝is-upcoming なし）
  assert(root.querySelectorAll("#schedule .sched-card").length === 64, `8c: 2018 は全48＋決勝T16=64カード（実際: ${root.querySelectorAll("#schedule .sched-card").length}）`);
  assert(root.querySelectorAll("#schedule .sched-card.is-ko").length === 16, "8c: 2018 決勝Tカード16");
  assert(root.querySelectorAll("#schedule .sched-card.is-upcoming").length === 0, "8c: 2018 は全消化（KO結果入り＝未消化なし）");
  // 3位比較は一覧のみ＝詳細に無い。
  assert(!root.querySelector("#best-thirds"), "8c: 3位比較は詳細に無い（一覧のみ）");
  // R5: KO結果入り＝優勝フランス・勝者ハイライト。R6: 得点王ケイン6点（グループ5+KO1）。
  assert(root.querySelector('#knockout .ko-round-F .ko-side.is-winner')?.getAttribute("data-team") === "fra", "8c: 2018 優勝はフランス");
  assert(root.querySelectorAll("#knockout .ko-side.is-winner").length === 16, "8c: 2018 KO 各試合に勝者ハイライト16");
  assert((root.querySelector("#top-scorers .ts-table tbody tr .team-name")?.textContent ?? "") === "ケイン", "8c: 2018 得点王はケイン（KO込み6点）");
  // 組H へ切替＝日本が2位（フェアプレー確定・抽選🎲ではない）。順位表2行目が日本。
  click(dom, root.querySelector<HTMLElement>('.group-tab[data-group="H"]')!);
  const rowsH = root.querySelectorAll(".standings-table tbody tr");
  assert(rowsH.length === 4, "8c: 組H 順位表4行");
  assert(rowsH[1].getAttribute("data-team") === "jpn", "8c: 組H 2位は日本（フェアプレー通過）");
  assert(root.querySelectorAll(".standings-table .tie-badge").length === 0, "8c: 組H に抽選バッジなし（フェアプレーで確定）");
  console.log("[dom] 大会切替 ?cup=2018（8組・全消化・組H 日本2位フェアプレー）OK");
}

// ---- 9) 一覧（overview）2022: 8カード + サイドのランキング + ドリルイン ----
{
  const dom = setupDom(`${BASE_URL}?cup=2022`); // 既定 scope=overview
  boot(app(dom));
  const root = app(dom);
  assert((root.querySelector("#overview") as HTMLElement).hidden === false, "9: 既定で一覧が表示");
  assert((root.querySelector("#detail-view") as HTMLElement).hidden === true, "9: 詳細は非表示");
  assert(decodeQuery(dom.window.location.search).scope === undefined, "9: 既定 overview は URL に scope を出さない");
  // 日程・結果は一覧にも表示（左カラム最上部・両scope共通）。
  assert(!!root.querySelector(".layout-main #schedule .sched-carousel"), "9: 一覧にも日程・結果がある");
  assert(root.querySelectorAll('#schedule .sched-card[data-action="drill-group"]').length === 48, "9: 一覧の日程カードもドリル可能");
  assert(root.querySelectorAll(".overview-grid .mini-group").length === 8, "9: 2022 はカード8");
  assert(root.querySelectorAll(".overview-grid .mini-group .mini-table tbody tr").length === 32, "9: 8組×4行=32");
  assert(root.querySelectorAll(".overview-grid .mini-group .row-advance").length === 16, "9: 各組上位2が緑=計16");
  assert(root.querySelectorAll(".overview-grid .mini-group .mini-fifa").length === 32, "9: 一覧カードに FIFA順位を併記（8組×4）");
  assert(!root.querySelector(".overview-bt"), "9: 2022 はベスト3位表なし");
  // R1: サイドのコンテンツ（得点ランキング＋FIFAランキング）を一覧でも表示。
  assert(!!root.querySelector("#rankings .ts-table"), "9: 一覧に得点ランキング");
  assert(root.querySelectorAll("#rankings .fr-table tbody tr").length === 211, "9: 一覧のFIFAランキングも世界全211カ国");
  assert(root.querySelectorAll("#rankings .fr-table tbody tr.is-team").length === 32, "9: 一覧でも出場32カ国を強調");
  // 決勝トーナメントは一覧でも全幅表示（両スコープ要件）。2022=R16 全16試合。
  assert(root.querySelectorAll("#knockout .ko-match").length === 16, "9: 一覧でも決勝トーナメント（2022 R16=16）が表示");
  // カード E をクリック → 詳細（E）へドリルイン。新スキームでは scope=detail が明示される。
  const cardE = root.querySelector<HTMLElement>('.mini-group[data-group="E"]')!;
  click(dom, cardE);
  assert(decodeQuery(dom.window.location.search).scope === "detail", "9: ドリルで detail（scope=detail 明示）");
  assert((root.querySelector("#detail-view") as HTMLElement).hidden === false, "9: ドリル後は詳細表示");
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "E", "9: ドリル先は E");
  assert(!!root.querySelector("svg.tl-chart"), "9: ドリル後にタイムライン(バンプチャート)描画");
  console.log("[dom] 一覧 2022（8カード・サイドランキング・ドリルイン）OK");
}

// ---- 9b) 一覧（overview）2026: 12カード + ベスト3位表 + サイドのランキング ----
{
  const dom = setupDom(`${BASE_URL}?cup=2026`); // 既定 scope=overview
  boot(app(dom));
  const root = app(dom);
  assert((root.querySelector("#overview") as HTMLElement).hidden === false, "9b: 2026 既定で一覧が表示");
  assert(root.querySelector('.scope-toggle [data-scope="overview"]')?.classList.contains("seg-on") === true, "9b: 一覧トグルが選択状態");
  assert(root.querySelectorAll(".overview-grid .mini-group").length === 12, `9b: 2026 はカード12（実際: ${root.querySelectorAll(".overview-grid .mini-group").length}）`);
  assert(!!root.querySelector(".overview-bt .bt-table"), "9b: 一覧にベスト3位表がある");
  assert(root.querySelectorAll(".overview-bt .bt-table .team-fifa").length === 12, "9b: 3位比較の全12組にFIFA順位を併記");
  assert(!root.querySelector(".overview-bt .bt-note"), "9b: 全消化＝一覧の3位比較も暫定注記なし");
  // R1: サイドのコンテンツを一覧でも表示（2026=48出場国）。
  assert(!!root.querySelector("#rankings .ts-table"), "9b: 一覧に得点ランキング");
  assert(root.querySelectorAll("#rankings .fr-table tbody tr").length === 211, "9b: 一覧のFIFAランキングも世界全211カ国");
  assert(root.querySelectorAll("#rankings .fr-table tbody tr.is-team").length === 48, "9b: 一覧でも出場48カ国を強調");
  // 決勝トーナメントは一覧でも全幅表示。2026=R32 全32試合・3位割当済みで全32枠が実チーム。
  assert(root.querySelectorAll("#knockout .ko-match").length === 32, "9b: 一覧でも決勝トーナメント（2026 R32=32）が表示");
  assert(root.querySelectorAll("#knockout .ko-round-R32 .ko-side.is-team[data-team]").length === 32, "9b: 一覧でも R32 全32枠が実チーム（3位割当済み）");
  assert(!root.querySelector("#knockout .ko-pool"), "9b: 3位割当済み＝『未割当』プールは出さない");
  console.log("[dom] 一覧 2026（12カード・ベスト3位表・サイドランキング）OK");
}

console.log("✅ domtest 通過");
