// DOM レベルのスモークテスト: boot → グループ選択 → 順位/FIFA/ステータス/シナリオ描画 →
// 単一タイムライン（分刻み＋節末＋縦型ログ）→ 得点ランキング → 共有URL復元 → 大会切替 を jsdom で検証。
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

// ---- 1) 初期描画 ----
{
  const dom = setupDom(BASE_URL);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".group-tab").length === 8, "1: グループタブ8");
  assert((root.querySelector("#overview") as HTMLElement).hidden === true, "1: 既定は詳細（一覧は非表示）");
  assert((root.querySelector("#detail-view") as HTMLElement).hidden === false, "1: 既定は詳細表示");
  // 日程・結果（本文トップ・全試合の横並びカルーセル）。2022は全48試合・組Aの6試合を強調。
  assert(!!root.querySelector("#schedule .sched-carousel"), "1: 日程カルーセルがある");
  assert(root.querySelectorAll("#schedule .sched-card").length === 48, `1: 全試合48カード（実際: ${root.querySelectorAll("#schedule .sched-card").length}）`);
  assert(root.querySelectorAll("#schedule .sched-card.is-current").length === 6, `1: 該当グループAの6試合を強調（実際: ${root.querySelectorAll("#schedule .sched-card.is-current").length}）`);
  assert(root.querySelectorAll("#schedule .sched-card.is-upcoming").length === 0, "1: 2022は全消化＝未消化なし");
  assert([...root.querySelectorAll("#schedule .sched-date")].some((e) => /\d+\/\d+/.test(e.textContent ?? "")), "1: カードに日付");
  // レイアウト順序（レビュー反映）: チャート(全幅)が先頭 → 本文(順位表→…→日程) → サイドバー。
  // 日程カルーセルは「主役の下＝secondary」位置へ降格、順位表が本文先頭。
  {
    const order = [...root.querySelector("#detail-view")!.children].map((c) => c.id);
    const tlIdx = order.indexOf("detail-timeline");
    const mainIdx = order.indexOf("detail-main");
    assert(tlIdx === 0 && mainIdx > tlIdx, "1: タイムライン(全幅)が本文より先頭");
    const kids = [...root.querySelector("#detail-main")!.children];
    const finalH2Idx = kids.findIndex((c) => (c.textContent ?? "").includes("最終順位"));
    const schedIdx = kids.findIndex((c) => c.id === "schedule");
    assert(finalH2Idx === 0 && schedIdx > finalH2Idx, "1: 本文は順位表が先・日程はその下へ降格");
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
  assert((root.querySelector('.tl-chart .tl-endlabel[data-team="ned"]')?.textContent ?? "").includes("NED"), "1: 右端ラベルにオランダ(NED)");
  // 最終順位1位（凡例先頭）がオランダ
  const leg0 = root.querySelector(".tl-legend .tl-leg-item")?.textContent ?? "";
  assert(leg0.includes("オランダ") && leg0.includes("1位"), `1: 凡例先頭=オランダ1位（実際: ${leg0}）`);
  assert((root.querySelector(".tl-chart")?.innerHTML ?? "").includes("ガクポ"), "1: 得点者名がツールチップに表示される");
  // チャート上に節結果スコア（各レーン上＝両参加チームに紐づく）= 3節×4チーム=12（組A 全消化）
  assert(root.querySelectorAll(".tl-chart .tl-round-score").length === 12, `1: チャートに節結果スコア12（実際: ${root.querySelectorAll(".tl-chart .tl-round-score").length}）`);
  assert([...root.querySelectorAll(".tl-chart .tl-round-score")].some((e) => /\d-\d/.test(e.textContent ?? "")), "1: 節結果スコアにスコア表記");
  // 得点タイムライン（縦型・チャート下）: 節見出し3・ゴール15・「第n節 結果」3
  assert(root.querySelectorAll(".tl-log .tlog-goal").length === 15, `1: 得点行=全15ゴール（実際: ${root.querySelectorAll(".tl-log .tlog-goal").length}）`);
  assert(root.querySelectorAll(".tl-log .tlog-cols .tlog-col").length === 3, "1: 節カラム3（第1〜3節を横並び）");
  assert(root.querySelectorAll(".tl-log .tlog-md-head").length === 3, "1: 節見出し3（第1〜3節）");
  assert(root.querySelectorAll(".tl-log .tlog-round").length === 3, "1: 節末『第n節 結果』ブロック3");
  assert((root.querySelector(".tl-log .tlog-round")?.textContent ?? "").includes("結果"), "1: 節末ブロックに『結果』");
  assert((root.querySelector(".tl-log")?.textContent ?? "").includes("ガクポ"), "1: 得点タイムラインに得点者名が見える");
  assert([...root.querySelectorAll(".tl-md-date")].some((e) => /\d+\/\d+/.test(e.textContent ?? "")), "1: 節ラベルに日付 M/D");
  // 順位表に FIFA順位を併記（組A=ned8/sen18/ecu44/qat50）。専用パネルは廃止。
  assert(root.querySelectorAll(".standings-table .team-fifa").length === 4, "1: 順位表に FIFA順位を4チーム併記");
  assert((root.querySelector(".standings-table .team-fifa")?.textContent ?? "").includes("FIFA"), "1: 併記は『FIFA ◯位』");
  assert(!root.querySelector("#fifa-ranking .fifa-item"), "1: FIFAランキング専用パネルは廃止");
  // 得点ランキング（大会全体）は右サイドバー(#detail-side)内。2022 得点王=エクアドルのバレンシア。
  assert(!!root.querySelector("#detail-side #top-scorers .ts-table"), "1: 得点ランキングは右サイドバー内");
  assert(root.querySelectorAll("#top-scorers .ts-table tbody tr").length >= 1, "1: 得点ランキングに行がある");
  assert((root.querySelector("#top-scorers")?.textContent ?? "").includes("バレンシア"), "1: 得点王バレンシアが載る");
  // 通過条件シナリオは折りたたみ <details> 内に降格（2022 組Aは全消化=決め手解説）
  assert(!!root.querySelector("details#scenario-details"), "1: シナリオは details 内");
  assert(!!root.querySelector("#scenario-details .scenario-boundaries"), "1: decided は決着の分かれ目を表示");
  assert(root.querySelectorAll("#scenario-details .boundary-note").length === 2, "1: 境界ノート2件（1↔2/2↔3）");
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "A", "1: 既定はグループA");
  console.log("[dom] 初期描画（タイムライン＝順位バンプチャート）OK");
}

// ---- 1b) 単一タイムライン＋節末＋縦型ログ（組E） ----
{
  const dom = setupDom(`${BASE_URL}?group=E`);
  boot(app(dom));
  const root = app(dom);
  // 分刻みなので頂点多数（24より多い）＋節末リング・節末ブロック3。
  assert(!!root.querySelector("svg.tl-chart"), "1b: 単一バンプチャート");
  assert(root.querySelectorAll(".tl-chart .tl-md").length === 3, "1b: 節ラベル3（第1〜3節）");
  const dots = root.querySelectorAll(".tl-chart .tl-dot").length;
  assert(dots > 24, `1b: 分刻みは頂点が多い（実際: ${dots}）`);
  assert(root.querySelectorAll(".tl-chart .tl-dot.is-roundend").length === 12, "1b: 節末リング=4×3=12");
  assert(root.querySelectorAll(".tl-chart .tl-round-score").length === 12, `1b: チャートに節結果スコア12（実際: ${root.querySelectorAll(".tl-chart .tl-round-score").length}）`);
  assert(root.querySelectorAll(".tl-log .tlog-round").length === 3, `1b: 縦型ログに『第n節 結果』3（実際: ${root.querySelectorAll(".tl-log .tlog-round").length}）`);
  assert(root.querySelectorAll(".tl-log .tlog-md-head").length === 3, "1b: 縦型ログに節見出し3");
  // 節末リングの <title> に試合結果が入る（ツールチップ）
  assert([...root.querySelectorAll(".tl-chart .tl-dot.is-roundend title")].some((t) => /\d-\d/.test(t.textContent ?? "")), "1b: 節末頂点ツールチップに試合結果");
  console.log("[dom] 単一タイムライン＋節末＋縦型ログ OK");
}

// ---- 2) グループ切替（A → E） ----
{
  const dom = setupDom(BASE_URL);
  boot(app(dom));
  const root = app(dom);
  const tabE = root.querySelector<HTMLElement>('.group-tab[data-group="E"]')!;
  click(dom, tabE);
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "E", "2: E が選択状態");
  assert(decodeQuery(dom.window.location.search).group === "E", "2: URL に group=E");
  assert(!!root.querySelector("#scenario-details .scenario-boundaries"), "2: 切替後もシナリオ（決め手）描画");
  // E の1位は日本（順位表先頭）
  const firstTeam = root.querySelector(".standings-table tbody tr .team-name")?.textContent ?? "";
  assert(firstTeam.includes("日本"), `2: E の1位は日本（実際: ${firstTeam}）`);
  console.log("[dom] グループ切替 OK");
}

// ---- 6) 共有URL復元（?group=H） ----
{
  const dom = setupDom(`${BASE_URL}?group=H`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "H", "6: H が復元");
  const firstTeam = root.querySelector(".standings-table tbody tr .team-name")?.textContent ?? "";
  assert(firstTeam.includes("ポルトガル"), `6: H の1位はポルトガル（実際: ${firstTeam}）`);
  assert(!!root.querySelector("#scenario-details .scenario-boundaries"), "6: シナリオ（決め手）描画");
  console.log("[dom] 共有URL復元 OK");
}

// ---- 6b) 旧 ?view= は無視され壊れない（後方互換） ----
{
  const dom = setupDom(`${BASE_URL}?group=E&view=stage`);
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

// ---- 8) 大会切替（?cup=2026: 12組・ベスト3位パネル） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2026`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".cup-tab").length === 3, "8: 大会タブ3");
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2026", "8: 2026 が選択状態");
  assert(root.querySelectorAll(".group-tab").length === 12, `8: 2026 はグループタブ12（実際: ${root.querySelectorAll(".group-tab").length}）`);
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "A", "8: 既定はグループA");
  assert(root.querySelectorAll(".standings-table tbody tr").length === 4, "8: 順位表4行（単一組）");
  // 日程カルーセル: 2026 は全72試合。組Aの6試合を強調。グループステージ全消化＝未消化(is-upcoming)なし。
  assert(root.querySelectorAll("#schedule .sched-card").length === 72, `8: 2026 は全72カード（実際: ${root.querySelectorAll("#schedule .sched-card").length}）`);
  assert(root.querySelectorAll("#schedule .sched-card.is-current").length === 6, "8: 該当グループAの6試合を強調");
  assert(root.querySelectorAll("#schedule .sched-card.is-upcoming").length === 0, "8: 全消化＝未消化カードなし");
  assert(!!root.querySelector("#best-thirds .bt-table"), "8: 3位比較パネルがある");
  assert(root.querySelectorAll("#best-thirds .bt-row").length >= 1, "8: 3位比較に行がある");
  assert(!root.querySelector("#best-thirds .bt-note"), "8: 全消化＝『暫定』注記は出さない");
  // 決勝トーナメント（ブラケット）: 2026=R32 全32試合・R32は16・確定枠は実チーム・3位枠はラベル・通過3位プール。
  assert(!!root.querySelector("#knockout .ko-bracket"), "8: 決勝トーナメント ブラケットがある");
  assert(root.querySelectorAll("#knockout .ko-match").length === 32, `8: KO 全32試合（実際: ${root.querySelectorAll("#knockout .ko-match").length}）`);
  assert(root.querySelectorAll("#knockout .ko-round-R32 .ko-match").length === 16, "8: KO R32=16試合");
  assert(root.querySelectorAll("#knockout .ko-side.is-team[data-team]").length >= 6, "8: 確定組由来の枠は実チーム（data-team）");
  assert([...root.querySelectorAll("#knockout .ko-side.is-undecided")].some((e) => (e.textContent ?? "").startsWith("3位")), "8: 3位枠は集合ラベル表示");
  assert(root.querySelectorAll("#knockout .ko-pool .ko-pool-chip").length >= 1, "8: 通過する3位プールを併記");
  // 2026 組A は全3節消化＝decided＝シナリオパネルに「決着の分かれ目」を表示
  assert((root.querySelector("details#scenario-details") as HTMLElement)?.hidden === false, "8: 2026 decided(組A)はシナリオパネル表示");
  assert(!!root.querySelector("#scenario-details .scenario-boundaries"), "8: 2026 decided は決着の分かれ目を表示");
  // 全12組消化＝どの組も decided。組K に切替えても「決着の分かれ目」を表示。
  click(dom, root.querySelector<HTMLElement>('.group-tab[data-group="K"]')!);
  assert((root.querySelector("details#scenario-details") as HTMLElement)?.hidden === false, "8: 2026 decided(組K)はシナリオパネル表示");
  assert(!!root.querySelector("#scenario-details .scenario-boundaries"), "8: 2026 decided(組K)は決着の分かれ目を表示");
  console.log("[dom] 大会切替 ?cup=2026（12組・3位比較パネル）OK");
}

// ---- 8b) 2022 は best-thirds 非表示（DOM 不変・既定大会） ----
{
  const dom = setupDom(BASE_URL);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".cup-tab").length === 3, "8b: 大会タブ3");
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2022", "8b: 既定は2022");
  assert((root.querySelector("#best-thirds")?.innerHTML ?? "").trim() === "", "8b: 2022 は best-thirds 空");
  // 決勝トーナメント: 2022=R16 全16試合・R16=8・全消化なので R16 の16枠すべて実チーム・3位プールなし。
  assert(root.querySelectorAll("#knockout .ko-match").length === 16, `8b: 2022 KO 全16試合（実際: ${root.querySelectorAll("#knockout .ko-match").length}）`);
  assert(root.querySelectorAll("#knockout .ko-round-R16 .ko-match").length === 8, "8b: 2022 KO R16=8試合");
  assert(root.querySelectorAll("#knockout .ko-round-R16 .ko-side.is-team[data-team]").length === 16, "8b: 2022 R16は全16枠が実チーム");
  assert(!root.querySelector("#knockout .ko-pool"), "8b: 2022 は3位プールなし");
  console.log("[dom] 2022 は best-thirds 非表示 OK");
}

// ---- 8c) 大会切替（?cup=2018: 8組・全消化・組H フェアプレーで日本2位） ----
{
  const dom = setupDom(`${BASE_URL}?cup=2018`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".cup-tab").length === 3, "8c: 大会タブ3");
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2018", "8c: 2018 が選択状態");
  assert(root.querySelectorAll(".group-tab").length === 8, `8c: 2018 はグループタブ8（実際: ${root.querySelectorAll(".group-tab").length}）`);
  // 全48試合・全消化（is-upcoming なし）
  assert(root.querySelectorAll("#schedule .sched-card").length === 48, `8c: 2018 は全48カード（実際: ${root.querySelectorAll("#schedule .sched-card").length}）`);
  assert(root.querySelectorAll("#schedule .sched-card.is-upcoming").length === 0, "8c: 2018 は全消化（未消化カードなし）");
  // 2018 は advanceBestThirds 無し＝best-thirds 空（2022 と同じ DOM 不変契約）
  assert((root.querySelector("#best-thirds")?.innerHTML ?? "").trim() === "", "8c: 2018 は best-thirds 空");
  // 組H へ切替＝日本が2位（フェアプレー確定・抽選🎲ではない）。順位表2行目が日本。
  click(dom, root.querySelector<HTMLElement>('.group-tab[data-group="H"]')!);
  const rowsH = root.querySelectorAll(".standings-table tbody tr");
  assert(rowsH.length === 4, "8c: 組H 順位表4行");
  assert(rowsH[1].getAttribute("data-team") === "jpn", "8c: 組H 2位は日本（フェアプレー通過）");
  assert(root.querySelectorAll(".standings-table .tie-badge").length === 0, "8c: 組H に抽選バッジなし（フェアプレーで確定）");
  console.log("[dom] 大会切替 ?cup=2018（8組・全消化・組H 日本2位フェアプレー）OK");
}

// ---- 9) 一覧（overview）2022: 8カード + ドリルイン ----
{
  const dom = setupDom(BASE_URL);
  boot(app(dom));
  const root = app(dom);
  const ovBtn = root.querySelector<HTMLElement>('.scope-toggle [data-scope="overview"]')!;
  click(dom, ovBtn);
  assert(decodeQuery(dom.window.location.search).scope === "overview", "9: URL に scope=overview");
  assert((root.querySelector("#overview") as HTMLElement).hidden === false, "9: 一覧が表示");
  assert((root.querySelector("#detail-view") as HTMLElement).hidden === true, "9: 詳細は非表示");
  assert(root.querySelectorAll(".overview-grid .mini-group").length === 8, "9: 2022 はカード8");
  assert(root.querySelectorAll(".overview-grid .mini-group .mini-table tbody tr").length === 32, "9: 8組×4行=32");
  assert(root.querySelectorAll(".overview-grid .mini-group .row-advance").length === 16, "9: 各組上位2が緑=計16");
  assert(root.querySelectorAll(".overview-grid .mini-group .mini-fifa").length === 32, "9: 一覧カードに FIFA順位を併記（8組×4）");
  assert(!root.querySelector(".overview-bt"), "9: 2022 はベスト3位表なし");
  // 決勝トーナメントは一覧でも全幅表示（両スコープ要件）。2022=R16 全16試合。
  assert(root.querySelectorAll("#knockout .ko-match").length === 16, "9: 一覧でも決勝トーナメント（2022 R16=16）が表示");
  // カード E をクリック → 詳細（E）へドリルイン
  const cardE = root.querySelector<HTMLElement>('.mini-group[data-group="E"]')!;
  click(dom, cardE);
  assert(decodeQuery(dom.window.location.search).scope === undefined, "9: ドリルで scope が消える（detail）");
  assert((root.querySelector("#detail-view") as HTMLElement).hidden === false, "9: ドリル後は詳細表示");
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "E", "9: ドリル先は E");
  assert(!!root.querySelector("svg.tl-chart"), "9: ドリル後にタイムライン(バンプチャート)描画");
  console.log("[dom] 一覧 2022（8カード・ドリルイン）OK");
}

// ---- 9b) 一覧（overview）2026: 12カード + ベスト3位表 ----
{
  const dom = setupDom(`${BASE_URL}?cup=2026&scope=overview`);
  boot(app(dom));
  const root = app(dom);
  assert((root.querySelector("#overview") as HTMLElement).hidden === false, "9b: 一覧が復元表示");
  assert(root.querySelector('.scope-toggle [data-scope="overview"]')?.classList.contains("seg-on") === true, "9b: 一覧トグルが選択状態で復元");
  assert(root.querySelectorAll(".overview-grid .mini-group").length === 12, `9b: 2026 はカード12（実際: ${root.querySelectorAll(".overview-grid .mini-group").length}）`);
  assert(!!root.querySelector(".overview-bt .bt-table"), "9b: 一覧にベスト3位表がある");
  assert(!root.querySelector(".overview-bt .bt-note"), "9b: 全消化＝一覧の3位比較も暫定注記なし");
  // 決勝トーナメントは一覧でも全幅表示。2026=R32 全32試合＋通過3位プール。
  assert(root.querySelectorAll("#knockout .ko-match").length === 32, "9b: 一覧でも決勝トーナメント（2026 R32=32）が表示");
  assert(root.querySelectorAll("#knockout .ko-pool .ko-pool-chip").length >= 1, "9b: 一覧でも通過3位プールを併記");
  console.log("[dom] 一覧 2026（12カード・ベスト3位表）OK");
}

console.log("✅ domtest 通過");
