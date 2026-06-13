// 唯一の DOM 層。グループ選択・順位表・通過ステータス・ピボット操作・マトリックス・凡例を描画する。
// イベントはルートの click / change リスナーで data-action 委譲（kisei/moshirasu パターン）。
// 再描画は可変リージョンの innerHTML 差し替え。select/number 入力は change で拾い、再描画でのフォーカス喪失を許容。
import type { CompiledTournament, GroupId, Match, Score, Standings } from "../engine/types";
import { scoreLabel, tricode } from "../engine/format";
import type { TeamStatus } from "../engine/status";
import type { ScenarioMatrix, Outcome } from "../engine/scenario/matrix";

export type Command =
  | { type: "set-group"; group: GroupId }
  | { type: "set-pivot"; pivotId: string }
  | { type: "set-assume"; matchId: string; score: Score };
export type Dispatch = (cmd: Command) => void;

export interface RenderView {
  group: GroupId;
  standings: Standings;
  status: TeamStatus[];
  matrix: ScenarioMatrix;
  pivotId: string;
  /** ピボット選択肢（組の全試合） */
  pivotOptions: Match[];
  /** 仮定スコアが必要な他の未消化試合 */
  assumeMatches: Match[];
  /** matchId → 現在の仮定スコア */
  assumeValues: Map<string, Score>;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const PALETTE = 8;
const colorClass = (i: number) => `cell-c${i % PALETTE}`;
const swatchVar = (i: number) => `var(--cell-${i % PALETTE})`;

export function createRenderer(root: HTMLElement, ct: CompiledTournament, dispatch: Dispatch) {
  const team = (id: string) => ct.teamsById.get(id)!;
  const tlabel = (id: string) => `${team(id).flag} ${esc(team(id).name)}`;
  const tc = (id: string) => esc(tricode(team(id)));

  const groupTabs = ct.groups
    .map((g) => `<button type="button" class="group-tab" data-action="set-group" data-group="${g}">${g}</button>`)
    .join("");

  root.innerHTML = `
    <div class="wrap">
      <header class="site-header">
        <h1>⚽ WCUP 通過シミュレーター</h1>
        <p class="site-sub">${esc(ct.meta.title)} ／ 決着試合のスコア次第で、どの国が・何位で通過するかが変わります。</p>
      </header>

      <nav class="group-tabs" id="group-tabs" aria-label="グループ選択">${groupTabs}</nav>

      <h2 class="section-title">順位表 <span class="hint" id="group-caption"></span></h2>
      <div id="standings"></div>

      <h2 class="section-title">通過ステータス</h2>
      <div id="status"></div>

      <h2 class="section-title">通過条件マトリックス <span class="hint">この試合のスコアで通過がどう変わるか</span></h2>
      <div id="pivot"></div>
      <div id="matrix"></div>
      <div id="legend"></div>

      <footer class="site-footer">
        <p class="disclaimer">⚠️ ${esc(ct.meta.disclaimer)}</p>
        <p class="tnum">データ最終更新: ${esc(ct.meta.dataLastUpdated)}（${esc(ct.meta.edition)}）</p>
        <p><a href="${esc(ct.meta.source)}" target="_blank" rel="noopener">データ出典</a></p>
      </footer>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const elStandings = $("#standings");
  const elStatus = $("#status");
  const elPivot = $("#pivot");
  const elMatrix = $("#matrix");
  const elLegend = $("#legend");
  const elCaption = $("#group-caption");

  // ---- イベント委譲 ----
  root.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!t) return;
    if (t.dataset.action === "set-group") {
      dispatch({ type: "set-group", group: t.dataset.group as GroupId });
    }
  });
  root.addEventListener("change", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.id === "pivot-select") {
      dispatch({ type: "set-pivot", pivotId: (t as HTMLSelectElement).value });
    } else if (t.classList.contains("assume-input")) {
      const matchId = (t as HTMLInputElement).dataset.match!;
      const home = Number((root.querySelector(`.assume-input[data-match="${matchId}"][data-side="home"]`) as HTMLInputElement).value || "0");
      const away = Number((root.querySelector(`.assume-input[data-match="${matchId}"][data-side="away"]`) as HTMLInputElement).value || "0");
      dispatch({ type: "set-assume", matchId, score: { home: Math.max(0, home), away: Math.max(0, away) } });
    }
  });

  // ---- 各リージョンの HTML ビルダ ----
  function gdLabel(gd: number): string {
    return gd > 0 ? `+${gd}` : String(gd);
  }

  function standingsHTML(st: Standings): string {
    const adv = ct.meta.advancePerGroup;
    const rows = st.rows
      .map((r, i) => {
        const cls = [r.advances ? "row-advance" : "", i + 1 === adv ? "advance-line" : ""].filter(Boolean).join(" ");
        const tie = r.tiedGroupKey ? `<span class="tie-badge">抽選</span>` : "";
        return `
          <tr class="${cls}">
            <td class="col-rank"><span class="rank-badge">${r.rank}</span></td>
            <td class="col-team"><span class="team-cell"><span class="team-flag">${team(r.teamId).flag}</span><span class="team-name">${esc(team(r.teamId).name)}</span>${tie}</span></td>
            <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
            <td>${r.gf}</td><td>${r.ga}</td><td>${gdLabel(r.gd)}</td>
            <td class="col-pts">${r.points}</td>
          </tr>`;
      })
      .join("");
    return `
      <div class="card standings tnum">
        <table class="standings-table">
          <thead><tr>
            <th class="col-rank">順位</th><th class="col-team">チーム</th>
            <th>試</th><th>勝</th><th>分</th><th>敗</th><th>得</th><th>失</th><th>差</th><th>点</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function statusHTML(status: TeamStatus[]): string {
    const meta: Record<TeamStatus["status"], { cls: string; word: string }> = {
      advanced: { cls: "is-advanced", word: "突破確定" },
      alive: { cls: "is-alive", word: "可能性あり" },
      eliminated: { cls: "is-eliminated", word: "敗退" },
    };
    const order: TeamStatus["status"][] = ["advanced", "alive", "eliminated"];
    const sorted = [...status].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    const chips = sorted
      .map((s) => {
        const m = meta[s.status];
        return `<span class="chip ${m.cls}" title="${m.word}"><span class="chip-flag">${team(s.teamId).flag}</span>${esc(team(s.teamId).name)}</span>`;
      })
      .join("");
    return `
      <p class="site-sub">🟢 突破確定 ／ 🟠 可能性あり ／ ⚪ 敗退</p>
      <div class="status-chips">${chips}</div>`;
  }

  function matchOptionLabel(m: Match): string {
    return `${team(m.home).flag} ${team(m.home).name} × ${team(m.away).name} ${team(m.away).flag}（第${m.matchday}節）`;
  }

  function pivotHTML(view: RenderView): string {
    const options = view.pivotOptions
      .map((m) => `<option value="${m.id}"${m.id === view.pivotId ? " selected" : ""}>${esc(matchOptionLabel(m))}</option>`)
      .join("");

    let assume = "";
    if (view.assumeMatches.length > 0) {
      const rows = view.assumeMatches
        .map((m) => {
          const sc = view.assumeValues.get(m.id) ?? { home: 0, away: 0 };
          return `
            <div class="assume-row">
              <span class="assume-team">${tlabel(m.home)}</span>
              <input class="assume-input" type="number" min="0" inputmode="numeric" data-match="${m.id}" data-side="home" value="${sc.home}" aria-label="${esc(team(m.home).name)}の得点" />
              <span>-</span>
              <input class="assume-input" type="number" min="0" inputmode="numeric" data-match="${m.id}" data-side="away" value="${sc.away}" aria-label="${esc(team(m.away).name)}の得点" />
              <span class="assume-team">${tlabel(m.away)}</span>
            </div>`;
        })
        .join("");
      assume = `
        <div class="assume-list">
          <p class="assume-hint">⚠️ 他にも未消化の試合があります。仮のスコアを入れてください（マトリックスはこの仮定の上で計算します）。</p>
          ${rows}
        </div>`;
    }

    return `
      <div class="card pivot-controls">
        <div class="pivot-field">
          <label class="pivot-field-label" for="pivot-select">マトリックスの2軸にする試合</label>
          <select id="pivot-select">${options}</select>
        </div>
        ${assume}
      </div>`;
  }

  function cellContent(o: Outcome): string {
    if (!o.undecided && o.first && o.second) {
      return `<span class="cell-1st">①${tc(o.first)}</span><span class="cell-2nd">②${tc(o.second)}</span>`;
    }
    if (o.contested.length > 0) {
      const top = o.advancing.length > 0 ? `<span class="cell-1st">①${o.advancing.map(tc).join("/")}</span>` : "";
      return `${top}<span class="cell-2nd">🎲抽選</span>`;
    }
    // 1-2位タイ（両者通過・順序のみ抽選）
    return `<span class="cell-1st">${o.advancing.map(tc).join("/")}</span><span class="cell-2nd">🎲順</span>`;
  }

  function cellTitle(o: Outcome): string {
    const elim = o.eliminated.length > 0 ? ` ／ ${o.eliminated.map((id) => team(id).name).join("・")} 敗退` : "";
    return esc(`${o.label}${elim}`);
  }

  function matrixHTML(m: ScenarioMatrix): string {
    const cols = Array.from({ length: m.maxGoals + 1 }, (_, b) => `<th class="head-x">${scoreLabel(b, m.maxGoals, m.overflow)}</th>`).join("");
    const cellByAB = new Map<string, ScenarioMatrix["cells"][number]>();
    for (const c of m.cells) cellByAB.set(`${c.a}:${c.b}`, c);

    const body = Array.from({ length: m.maxGoals + 1 }, (_, a) => {
      const tds = Array.from({ length: m.maxGoals + 1 }, (_, b) => {
        const c = cellByAB.get(`${a}:${b}`)!;
        const cls = ["cell", colorClass(c.colorIndex), c.isDraw ? "is-draw" : "", c.outcome.undecided ? "is-undecided" : ""]
          .filter(Boolean)
          .join(" ");
        return `<td class="${cls}" data-a="${a}" data-b="${b}" title="${cellTitle(c.outcome)}">${cellContent(c.outcome)}</td>`;
      }).join("");
      return `<tr><th class="head-y">${scoreLabel(a, m.maxGoals, m.overflow)}</th>${tds}</tr>`;
    }).join("");

    return `
      <div class="card matrix-wrap">
        <p class="matrix-axislabel">
          行（縦）= <b class="axis-y">${team(m.teamA).flag} ${esc(team(m.teamA).name)}</b> の得点 ／
          列（横）= <b class="axis-x">${team(m.teamB).flag} ${esc(team(m.teamB).name)}</b> の得点
        </p>
        <div class="matrix-scroll">
          <table class="matrix tnum">
            <thead><tr><th class="corner"><span class="axis-y">↓${tc(m.teamA)}</span><br><span class="axis-x">→${tc(m.teamB)}</span></th>${cols}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
  }

  function legendHTML(m: ScenarioMatrix): string {
    const items = m.legend
      .map((l) => {
        const dice = l.undecided ? " 🎲" : "";
        return `
          <div class="legend-item">
            <span class="legend-swatch" style="background:${swatchVar(l.colorIndex)}"></span>
            <span>${esc(l.label)}${dice}</span>
            <span class="legend-count">${l.count}通り</span>
          </div>`;
      })
      .join("");
    return `
      <div class="card legend">
        <p class="legend-title">凡例（このピボットでの通過結果・全49通りの内訳）</p>
        ${items}
      </div>`;
  }

  function render(view: RenderView): void {
    // グループタブの選択状態
    for (const tab of root.querySelectorAll<HTMLElement>(".group-tab")) {
      tab.classList.toggle("is-on", tab.dataset.group === view.group);
    }
    elCaption.textContent = `グループ ${view.group}`;
    elStandings.innerHTML = standingsHTML(view.standings);
    elStatus.innerHTML = statusHTML(view.status);
    elPivot.innerHTML = pivotHTML(view);
    elMatrix.innerHTML = matrixHTML(view.matrix);
    elLegend.innerHTML = legendHTML(view.matrix);
  }

  return { render };
}
