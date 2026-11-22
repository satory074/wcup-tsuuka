// ビルド時の事前描画（Astro のページからだけ呼ぶ。ブラウザには載らない）。
// ブラウザと同じ描画コード（src/app/main.ts の mount → render.ts）を jsdom の上で 1 回動かし、
// 出来上がった HTML をそのまま配信 HTML に入れる＝JS を実行しないクローラーにも本文・順位表・チャート（SVG）が見える。
// ブラウザでは boot() が data 属性から同じ状態を読んで同じ HTML を描き直し、操作を受け付ける。
import { JSDOM } from "jsdom";
import { mount } from "../app/main";
import { DATA } from "../app/data";
import type { Cup, Scope } from "../app/url";
import type { PageInfo } from "../app/pageInfo";
import type { GroupId } from "../engine/types";

export interface Prerendered {
  /** <main id="app"> の中身 */
  html: string;
  /** <main id="app"> の class（一覧のとき scope-overview） */
  rootClass: string;
  /** 描画に使った組（data-group に書く） */
  group: GroupId;
  page: PageInfo;
}

export function prerender(cup: Cup, scope: Scope, group: GroupId | undefined, base: string): Prerendered {
  const dom = new JSDOM(`<!doctype html><html><body><main id="app"></main></body></html>`);
  try {
    const root = dom.window.document.getElementById("app") as unknown as HTMLElement;
    const m = mount(root, DATA[cup], { cup, scope, group }, { base });
    if (!m) throw new Error(`事前描画に失敗: ${cup} ${scope} ${group ?? ""}\n${root.textContent ?? ""}`);
    if (scope === "detail") {
      // グループのページでは、大会全体で同じ「FIFAランキング全211カ国」の表を配信 HTML に入れない
      // （28 ページに同じ大きな表が並ぶと、各ページ固有の中身＝順位表・得点経過が埋もれるため。1 ページ約 70KB 減）。
      // 一覧ページには入れる。ブラウザでは boot() が描き直すので、JS ありの画面は今までどおり表が出る。
      const fifa = root.querySelector("#fifa-ranking");
      if (fifa) fifa.innerHTML = "";
    }
    return { html: root.innerHTML, rootClass: root.className, group: m.group, page: m.page };
  } finally {
    dom.window.close();
  }
}
