// DOM レベルのスモークテスト: boot → グループ選択 → 順位/ステータス/通過条件シナリオ描画 →
// タイムライン表示モード切替 → 共有URL復元 → 大会切替 を jsdom で検証。
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
  assert(root.querySelectorAll(".standings-table tbody tr").length === 4, "1: 順位表4行");
  assert(!!root.querySelector(".standings .tiebreak-legend"), "1: タイブレーク優先順位の凡例がある");
  assert(root.querySelectorAll(".standings-table thead .th-pri").length === 3, "1: 列見出しに優先順位番号3つ(点/差/得)");
  assert(root.querySelectorAll(".status-chips .chip").length === 4, "1: ステータスチップ4");
  // タイムライン（主役・既定 live・バンプチャート: 行=順位, セル=国旗。ヘッダ=節帯+時刻行+2レーン）。組Aは全試合15ゴール
  assert(!!root.querySelector("table.tl-grid"), "1: タイムラインが横グリッドで描画される");
  assert(root.querySelectorAll(".tl-grid tbody tr").length === 4, "1: 行=4順位");
  assert(root.querySelectorAll(".tl-th-time").length === 15, `1: 組A 全15ゴール列（実際: ${root.querySelectorAll(".tl-th-time").length}）`);
  assert(root.querySelectorAll(".tl-band").length === 3, "1: 節帯は3（第1〜3節）");
  assert(root.querySelectorAll(".tl-dateband").length === 5, `1: 日時帯は5枠（第1節2＋第2節2＋第3節1）（実際: ${root.querySelectorAll(".tl-dateband").length}）`);
  assert([...root.querySelectorAll(".tl-dateband")].some((e) => /\d+\/\d+ \d{2}:\d{2}/.test(e.textContent ?? "")), "1: 日時帯に M/D HH:MM");
  assert(root.querySelectorAll(".tl-lane-label").length === 2, "1: 2レーン（試合①/②）");
  assert(root.querySelectorAll(".tl-poscol").length === 4, "1: 先頭列に順位ラベル4");
  assert(root.querySelectorAll(".tl-flagcell").length === 60, "1: 国旗セル=4順位×15列=60");
  assert(root.querySelectorAll(".tl-grid .tl-mv").length > 0, "1: 順位変動（▲▼）マーカーがある");
  // 最終列の1位セルがオランダ（組A優勝）
  const firstRowCells = [...root.querySelectorAll(".tl-grid tbody tr:first-child .tl-flagcell")];
  assert((firstRowCells[firstRowCells.length - 1].textContent ?? "").includes("NED"), "1: 最終列の1位はオランダ(NED)");
  assert(root.querySelectorAll(".tl-lane-cell .tl-ch-scorer").length === 15, "1: 得点者がレーン内に15（全ゴール数）");
  assert([...root.querySelectorAll(".tl-ch-scorer")].some((e) => (e.textContent ?? "").includes("ガクポ")), "1: 得点者名が表示される");
  // 通過条件シナリオは折りたたみ <details> 内に降格（2022 組Aは全消化=決め手解説）
  assert(!!root.querySelector("details#scenario-details"), "1: シナリオは details 内");
  assert(!!root.querySelector("#scenario-details .scenario-boundaries"), "1: decided は決着の分かれ目を表示");
  assert(root.querySelectorAll("#scenario-details .boundary-note").length === 2, "1: 境界ノート2件（1↔2/2↔3）");
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "A", "1: 既定はグループA");
  console.log("[dom] 初期描画（タイムライン横グリッド）OK");
}

// ---- 1b) タイムライン表示モード切替（live → stage） ----
{
  const dom = setupDom(`${BASE_URL}?group=E`);
  boot(app(dom));
  const root = app(dom);
  // 既定 live: 節帯3 + 2レーン
  assert(root.querySelectorAll(".tl-band").length === 3, "1b: live は節帯3（第1〜3節）");
  assert(root.querySelectorAll(".tl-lane-label").length === 2, "1b: live は2レーン");
  const stageBtn = root.querySelector<HTMLElement>('.view-toggle [data-view="stage"]')!;
  click(dom, stageBtn);
  assert(decodeQuery(dom.window.location.search).view === "stage", "1b: URL に view=stage");
  // stage: 試合単位（節帯/日時帯/レーン無し・colhead 6列・第n節ラベル）
  assert(root.querySelectorAll(".tl-band").length === 0, "1b: stage は節帯無し");
  assert(root.querySelectorAll(".tl-dateband").length === 0, "1b: stage は日時帯無し");
  assert(root.querySelectorAll(".tl-lane-label").length === 0, "1b: stage はレーン無し");
  assert(root.querySelectorAll(".tl-grid thead .tl-colhead").length === 6, "1b: 組E stage は6列（6試合）");
  assert([...root.querySelectorAll(".tl-colhead .tl-ch-time")].some((e) => (e.textContent ?? "").includes("第")), "1b: stage は第n節ラベル");
  console.log("[dom] タイムライン表示モード切替 OK");
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

// ---- 6b) view=stage の復元 ----
{
  const dom = setupDom(`${BASE_URL}?group=E&view=stage`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelector('.view-toggle [data-view="stage"]')?.classList.contains("seg-on") === true, "6b: stage トグルが選択状態で復元");
  assert(!root.querySelector(".tl-lane-label"), "6b: stage 表示（試合レーン無し）");
  console.log("[dom] view=stage 復元 OK");
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
  assert(root.querySelectorAll(".cup-tab").length === 2, "8: 大会タブ2");
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2026", "8: 2026 が選択状態");
  assert(root.querySelectorAll(".group-tab").length === 12, `8: 2026 はグループタブ12（実際: ${root.querySelectorAll(".group-tab").length}）`);
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "A", "8: 既定はグループA");
  assert(root.querySelectorAll(".standings-table tbody tr").length === 4, "8: 順位表4行（単一組）");
  assert(!!root.querySelector("#best-thirds .bt-table"), "8: 3位比較パネルがある");
  assert(root.querySelectorAll("#best-thirds .bt-row").length >= 1, "8: 3位比較に行がある");
  assert(root.querySelectorAll("#best-thirds .tie-badge").length >= 1, "8: 進行中は暫定/抽選バッジ");
  // 2026 組A は進行中（early）= シナリオが定まらないためパネル非表示
  assert((root.querySelector("details#scenario-details") as HTMLElement)?.hidden === true, "8: 2026 早期はシナリオパネル非表示");
  assert((root.querySelector("#scenario")?.innerHTML ?? "") === "", "8: 早期は #scenario 空");
  console.log("[dom] 大会切替 ?cup=2026（12組・3位比較パネル）OK");
}

// ---- 8b) 2022 は best-thirds 非表示（DOM 不変・既定大会） ----
{
  const dom = setupDom(BASE_URL);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".cup-tab").length === 2, "8b: 大会タブ2");
  assert(root.querySelector(".cup-tab.seg-on")?.getAttribute("data-cup") === "2022", "8b: 既定は2022");
  assert((root.querySelector("#best-thirds")?.innerHTML ?? "").trim() === "", "8b: 2022 は best-thirds 空");
  console.log("[dom] 2022 は best-thirds 非表示 OK");
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
  assert(!root.querySelector(".overview-bt"), "9: 2022 はベスト3位表なし");
  // カード E をクリック → 詳細（E）へドリルイン
  const cardE = root.querySelector<HTMLElement>('.mini-group[data-group="E"]')!;
  click(dom, cardE);
  assert(decodeQuery(dom.window.location.search).scope === undefined, "9: ドリルで scope が消える（detail）");
  assert((root.querySelector("#detail-view") as HTMLElement).hidden === false, "9: ドリル後は詳細表示");
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "E", "9: ドリル先は E");
  assert(!!root.querySelector("table.tl-grid"), "9: ドリル後にタイムライン描画");
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
  assert(root.querySelectorAll(".overview-bt .tie-badge").length >= 1, "9b: 進行中は暫定/抽選バッジ");
  console.log("[dom] 一覧 2026（12カード・ベスト3位表）OK");
}

console.log("✅ domtest 通過");
