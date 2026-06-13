// DOM レベルのスモークテスト: boot → グループ選択 → 順位/ステータス/マトリックス描画 →
// ピボット切替 → 仮定スコア入力 → 共有URL復元 を jsdom で検証。
// 実行: npx tsx scripts/domtest.ts
import { JSDOM } from "jsdom";
import worldcupJson from "../src/data/worldcup2022.json";
import { boot } from "../src/app/main";
import { compileTournament } from "../src/engine/compile";
import { buildMatrix } from "../src/engine/scenario/matrix";
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
function fireChange(dom: JSDOM, el: Element): void {
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

const BASE_URL = "https://satory074.github.io/wcup-tsuuka/";

// ---- 1) 初期描画 ----
{
  const dom = setupDom(BASE_URL);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelectorAll(".group-tab").length === 8, "1: グループタブ8");
  assert(root.querySelectorAll(".standings-table tbody tr").length === 4, "1: 順位表4行");
  assert(root.querySelectorAll(".status-chips .chip").length === 4, "1: ステータスチップ4");
  // タイムライン（主役・既定は live）。組A: キックオフ + A-5(3) + A-6(2) = 6スナップ
  assert(!!root.querySelector("ol.timeline"), "1: タイムラインが描画される");
  assert(root.querySelectorAll(".timeline .tl-item").length === 6, `1: 組A live は6スナップ（実際: ${root.querySelectorAll(".timeline .tl-item").length}）`);
  assert(!!root.querySelector(".timeline .tl-item.tl-kickoff"), "1: 先頭にキックオフ");
  assert(root.querySelectorAll(".timeline .tl-move").length > 0, "1: 順位変動マーカーがある");
  // マトリックスは折りたたみ <details> 内に降格
  assert(!!root.querySelector("details#matrix-details"), "1: マトリックスは details 内");
  assert(root.querySelectorAll("#matrix-details .matrix td.cell").length === 49, "1: マトリックス49セル（details内）");
  assert(root.querySelectorAll("#matrix-details .legend .legend-item").length >= 2, "1: 凡例2件以上（details内）");
  // 既定グループ A が選択
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "A", "1: 既定はグループA");
  console.log("[dom] 初期描画（タイムライン主役）OK");
}

// ---- 1b) タイムライン表示モード切替（live → stage） ----
{
  const dom = setupDom(`${BASE_URL}?group=E`);
  boot(app(dom));
  const root = app(dom);
  // 既定 live: キックオフがある
  assert(!!root.querySelector(".timeline .tl-item.tl-kickoff"), "1b: live にキックオフ");
  const stageBtn = root.querySelector<HTMLElement>('.view-toggle [data-view="stage"]')!;
  click(dom, stageBtn);
  assert(decodeQuery(dom.window.location.search).view === "stage", "1b: URL に view=stage");
  // stage: 試合単位（キックオフ無し・第n節ラベル）
  assert(!root.querySelector(".timeline .tl-item.tl-kickoff"), "1b: stage はキックオフ無し");
  assert(root.querySelectorAll(".timeline .tl-item").length === 6, "1b: 組E stage は6スナップ（6試合）");
  assert((root.querySelector(".timeline .tl-time")?.textContent ?? "").includes("第"), "1b: stage は第n節ラベル");
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
  assert(root.querySelectorAll(".matrix td.cell").length === 49, "2: 切替後も49セル");
  // E の1位は日本（順位表先頭）
  const firstTeam = root.querySelector(".standings-table tbody tr .team-name")?.textContent ?? "";
  assert(firstTeam.includes("日本"), `2: E の1位は日本（実際: ${firstTeam}）`);
  console.log("[dom] グループ切替 OK");
}

// ---- 3) ピボット切替（select change）＋ 選択状態の維持 ----
{
  const dom = setupDom(`${BASE_URL}?group=E`);
  boot(app(dom));
  const root = app(dom);
  const sel = root.querySelector<HTMLSelectElement>("#pivot-select")!;
  sel.value = "E-6"; // crc vs ger
  fireChange(dom, sel);
  assert(decodeQuery(dom.window.location.search).pivot === "E-6", "3: URL に pivot=E-6");
  const sel2 = root.querySelector<HTMLSelectElement>("#pivot-select")!;
  assert(sel2.value === "E-6", "3: 再描画後も E-6 が選択維持");
  assert(root.querySelectorAll(".matrix td.cell").length === 49, "3: 切替後も49セル");
  console.log("[dom] ピボット切替 OK");
}

// ---- 4) マトリックスのセル属性・対角 ----
{
  const dom = setupDom(`${BASE_URL}?group=E`);
  boot(app(dom));
  const root = app(dom);
  const cells = [...root.querySelectorAll<HTMLElement>(".matrix td.cell")];
  assert(cells.every((c) => c.dataset.a !== undefined && c.dataset.b !== undefined), "4: 全セルに data-a/data-b");
  assert(cells.every((c) => (c.getAttribute("title") ?? "").length > 0), "4: 全セルに title");
  const draws = cells.filter((c) => c.classList.contains("is-draw"));
  assert(draws.length === 7, `4: 対角(is-draw)セル7（実際: ${draws.length}）`);
  assert(draws.every((c) => c.dataset.a === c.dataset.b), "4: is-draw は a==b");
  console.log("[dom] セル属性・対角 OK");
}

// ---- 5) 仮定スコア入力（合成データ: E-1 を未消化に）→ マトリックスがエンジン計算と一致 ----
{
  const synth = structuredClone(worldcupJson) as { matches: { id: string; score?: unknown }[] };
  const e1 = synth.matches.find((m) => m.id === "E-1")!;
  delete e1.score; // 未消化化（既定ピボット E-5 とは別なので仮定入力欄が出る）

  const dom = setupDom(`${BASE_URL}?group=E`);
  boot(app(dom), synth);
  const root = app(dom);
  const inputs = [...root.querySelectorAll<HTMLInputElement>(".assume-input")];
  assert(inputs.length === 2, `5: E-1 用の仮定入力2つ（実際: ${inputs.length}）`);

  const home = root.querySelector<HTMLInputElement>('.assume-input[data-match="E-1"][data-side="home"]')!;
  const away = root.querySelector<HTMLInputElement>('.assume-input[data-match="E-1"][data-side="away"]')!;
  home.value = "5";
  away.value = "0";
  fireChange(dom, home);

  const q = decodeQuery(dom.window.location.search);
  assert(!!q.assume && q.assume.some((o) => o.matchId === "E-1" && o.score.home === 5 && o.score.away === 0), "5: URL に assume=E-1:5-0");

  // DOM の凡例件数が、同じ仮定でのエンジン計算と一致
  const ct = compileTournament(synth);
  const expected = buildMatrix({ ct, group: "E", pivotMatchId: "E-5", assumptions: [{ matchId: "E-1", score: { home: 5, away: 0 } }] });
  const domLegend = root.querySelectorAll(".legend .legend-item").length;
  assert(domLegend === expected.legend.length, `5: 凡例件数がエンジンと一致（DOM ${domLegend} / engine ${expected.legend.length}）`);
  assert(root.querySelectorAll(".matrix td.cell").length === 49, "5: 仮定入力後も49セル");
  console.log("[dom] 仮定スコア入力 OK");
}

// ---- 6) 共有URL復元（?group=H） ----
{
  const dom = setupDom(`${BASE_URL}?group=H`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelector(".group-tab.is-on")?.getAttribute("data-group") === "H", "6: H が復元");
  const firstTeam = root.querySelector(".standings-table tbody tr .team-name")?.textContent ?? "";
  assert(firstTeam.includes("ポルトガル"), `6: H の1位はポルトガル（実際: ${firstTeam}）`);
  assert(root.querySelectorAll(".matrix td.cell").length === 49, "6: マトリックス描画");
  console.log("[dom] 共有URL復元 OK");
}

// ---- 6b) view=stage の復元 ----
{
  const dom = setupDom(`${BASE_URL}?group=E&view=stage`);
  boot(app(dom));
  const root = app(dom);
  assert(root.querySelector('.view-toggle [data-view="stage"]')?.classList.contains("seg-on") === true, "6b: stage トグルが選択状態で復元");
  assert(!root.querySelector(".timeline .tl-item.tl-kickoff"), "6b: stage 表示（キックオフ無し）");
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

console.log("✅ domtest 通過");
