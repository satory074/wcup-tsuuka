// 唯一の DOM 層。グループ選択・順位表・通過ステータス・タイムライン（主役）・
// もしものスコア=マトリックス（折りたたみ）を描画する。
// イベントはルートの click / change リスナーで data-action 委譲（kisei/moshirasu パターン）。
import type { CompiledTournament, GroupId, Match, Score, Standings } from "../engine/types";
import { scoreLabel, tricode } from "../engine/format";
import type { TeamStatus } from "../engine/status";
import type { ScenarioMatrix, Outcome } from "../engine/scenario/matrix";
import type { Snapshot } from "../engine/timeline";
import type { BestThirdsResult, ThirdEntry } from "../engine/thirds";
import type { Cup } from "./url";

export type ViewMode = "live" | "stage";

const CUPS: { id: Cup; label: string }[] = [
  { id: "2022", label: "2022 カタール" },
  { id: "2026", label: "2026 北中米" },
];

export type Command =
  | { type: "set-group"; group: GroupId }
  | { type: "set-view"; view: ViewMode }
  | { type: "set-cup"; cup: Cup }
  | { type: "set-pivot"; pivotId: string }
  | { type: "set-assume"; matchId: string; score: Score };
export type Dispatch = (cmd: Command) => void;

export interface RenderView {
  group: GroupId;
  view: ViewMode;
  standings: Standings;
  status: TeamStatus[];
  /** 2026方式のベスト3位（advanceBestThirds>0 のときのみ中身が出る） */
  bestThirds?: BestThirdsResult;
  liveTimeline: Snapshot[] | null;
  stageTimeline: Snapshot[];
  // もしものスコア（マトリックス）用
  matrix: ScenarioMatrix;
  pivotId: string;
  pivotOptions: Match[];
  assumeMatches: Match[];
  assumeValues: Map<string, Score>;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const PALETTE = 8;
const colorClass = (i: number) => `cell-c${i % PALETTE}`;
const swatchVar = (i: number) => `var(--cell-${i % PALETTE})`;

export function createRenderer(root: HTMLElement, ct: CompiledTournament, cup: Cup, dispatch: Dispatch) {
  const team = (id: string) => ct.teamsById.get(id)!;
  const tlabel = (id: string) => `${team(id).flag} ${esc(team(id).name)}`;
  const tc = (id: string) => esc(tricode(team(id)));

  const cupTabs = CUPS
    .map((c) => `<button type="button" class="cup-tab seg-btn${c.id === cup ? " seg-on" : ""}" data-action="set-cup" data-cup="${c.id}">${esc(c.label)}</button>`)
    .join("");

  const groupTabs = ct.groups
    .map((g) => `<button type="button" class="group-tab" data-action="set-group" data-group="${g}">${g}</button>`)
    .join("");

  const btSlots = ct.meta.advanceBestThirds ?? 0;
  const btNote = btSlots > 0 ? ` ＋ 各組3位の上位${btSlots}` : "";

  root.innerHTML = `
    <header class="site-header">
      <div class="hero-inner">
        <h1><span class="hero-mark">⚽</span><span class="hero-title">WCUP <span class="hero-em">通過タイムライン</span></span></h1>
        <p class="site-sub">${esc(ct.meta.title)} ／ いつ誰が得点して、その時点で通過国がどう入れ替わったかを時系列で可視化します。</p>
        <nav class="cup-tabs seg" id="cup-tabs" aria-label="大会選択">${cupTabs}</nav>
      </div>
    </header>
    <div class="wrap">
      <nav class="group-tabs" id="group-tabs" aria-label="グループ選択">${groupTabs}</nav>

      <h2 class="section-title">最終順位 <span class="hint" id="group-caption"></span></h2>
      <div id="standings"></div>
      <div id="status"></div>
      <div id="best-thirds"></div>

      <h2 class="section-title">タイムライン <span class="hint">この時間に得点 → この時点ではこの順位</span></h2>
      <div class="view-toggle seg" role="group" aria-label="タイムライン表示モード">
        <button type="button" class="seg-btn" data-action="set-view" data-view="live">全試合（分刻み）</button>
        <button type="button" class="seg-btn" data-action="set-view" data-view="stage">大会全体（試合単位）</button>
      </div>
      <p class="tl-legend-note">🟩 暫定通過圏（上位${ct.meta.advancePerGroup}${btNote}） ／ ▲▼ 直前からの順位変動</p>
      <div id="timeline"></div>

      <details class="matrix-details" id="matrix-details">
        <summary>もしものスコア（通過条件マトリックス）を見る</summary>
        <div class="matrix-details-body">
          <p class="site-sub">決着試合のスコアを2軸に振り、各スコアでの通過結果（①1位 ②2位／敗退）を色分け表示します。</p>
          <div id="pivot"></div>
          <div id="matrix"></div>
          <div id="legend"></div>
        </div>
      </details>

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
  const elBestThirds = $("#best-thirds");
  const elTimeline = $("#timeline");
  const elPivot = $("#pivot");
  const elMatrix = $("#matrix");
  const elLegend = $("#legend");
  const elCaption = $("#group-caption");

  // ---- イベント委譲 ----
  root.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!t) return;
    if (t.dataset.action === "set-group") dispatch({ type: "set-group", group: t.dataset.group as GroupId });
    else if (t.dataset.action === "set-view") dispatch({ type: "set-view", view: t.dataset.view as ViewMode });
    else if (t.dataset.action === "set-cup") dispatch({ type: "set-cup", cup: t.dataset.cup as Cup });
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

  function gdLabel(gd: number): string {
    return gd > 0 ? `+${gd}` : String(gd);
  }

  // ---- 最終順位表 ----
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
            <th>試</th><th>勝</th><th>分</th><th>敗</th>
            <th title="優先③: 総得点">得<sup class="th-pri">③</sup></th><th>失</th>
            <th title="優先②: 総得失点差">差<sup class="th-pri">②</sup></th>
            <th title="優先①: 総勝点">点<sup class="th-pri">①</sup></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="tiebreak-legend">
          <span class="tb-head">順位決定の優先順位</span>
          <span><b>①</b>総勝点 <b>②</b>総得失点差 <b>③</b>総得点</span>
          <span>→ 同点は直接対決のみで <b>④</b>勝点→得失点差→得点</span>
          <span>→ <b>⑤</b>フェアプレー（警告少）→ <b>⑥</b>抽選 <span class="tb-dice">🎲</span></span>
        </p>
      </div>`;
  }

  // ---- 通過ステータス ----
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

  // ---- ベスト3位（2026方式: 各組3位を横断ランキングし上位 slots 組が通過） ----
  function bestThirdsHTML(bt: BestThirdsResult): string {
    if (bt.slots <= 0 || bt.entries.length === 0) return "";
    const stateBadge = (e: ThirdEntry): string => {
      if (!e.groupComplete) return `<span class="tie-badge">暫定</span>`;
      if (e.undecided) return `<span class="tie-badge">抽選</span>`;
      return "";
    };
    const rows = bt.entries
      .map((e) => {
        const cls = [e.advances ? "row-advance" : "", e.rank === bt.slots ? "advance-line" : ""].filter(Boolean).join(" ");
        return `
          <tr class="bt-row ${cls}">
            <td class="col-rank"><span class="rank-badge">${e.rank}</span></td>
            <td class="bt-group">${e.group}</td>
            <td class="col-team"><span class="team-cell"><span class="team-flag">${team(e.teamId).flag}</span><span class="team-name">${esc(team(e.teamId).name)}</span>${stateBadge(e)}</span></td>
            <td>${e.points}</td><td>${gdLabel(e.gd)}</td><td>${e.gf}</td>
          </tr>`;
      })
      .join("");
    const note = bt.undecided
      ? `<p class="site-sub">⚠️ グループステージ進行中のため暫定です（🟩＝現時点で上位${bt.slots}圏／🎲抽選・暫定あり）。</p>`
      : "";
    return `
      <h2 class="section-title">3位チーム比較 <span class="hint">各組3位を横断ランキング → 上位${bt.slots}組が通過（R32）</span></h2>
      ${note}
      <div class="card bt-card tnum">
        <table class="bt-table">
          <thead><tr>
            <th class="col-rank">順</th><th class="bt-group">組</th><th class="col-team">チーム</th>
            <th>点</th><th>差</th><th>得</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ---- タイムライン（主役・横グリッド: 列=時間, 行=チーム, セル=順位） ----
  function moveMark(kind: "up" | "down" | "same"): string {
    if (kind === "up") return `<span class="tl-mv is-up">▲</span>`;
    if (kind === "down") return `<span class="tl-mv is-down">▼</span>`;
    return "";
  }

  function colHeadHTML(snap: Snapshot): string {
    if (snap.kind === "kickoff") {
      return `<th class="tl-colhead tl-kickoff"><div class="tl-ch-time">${esc(snap.clockLabel)}</div><div class="tl-ch-score">0-0</div></th>`;
    }
    const e = snap.event!;
    if (snap.kind === "goal") {
      const scorerId = e.scorerSide === "home" ? e.homeId : e.awayId;
      const who = e.scorer ? `${team(scorerId).flag}${esc(e.scorer)}` : `${team(scorerId).flag}`;
      return `<th class="tl-colhead tl-goal">
        <div class="tl-ch-time">${esc(snap.clockLabel)}</div>
        <div class="tl-ch-scorer">⚽${who}</div>
        <div class="tl-ch-score">${tc(e.homeId)} ${e.homeScore}-${e.awayScore} ${tc(e.awayId)}</div>
      </th>`;
    }
    // matchEnd（試合単位）
    return `<th class="tl-colhead tl-matchend">
      <div class="tl-ch-time">${esc(snap.clockLabel)}</div>
      <div class="tl-ch-score">${team(e.homeId).flag}${tc(e.homeId)} ${e.homeScore}-${e.awayScore} ${tc(e.awayId)}${team(e.awayId).flag}</div>
    </th>`;
  }

  function timelineHTML(view: RenderView): string {
    const snaps = view.view === "live" ? view.liveTimeline : view.stageTimeline;
    if (!snaps || snaps.length === 0) {
      return `<p class="empty-msg">このグループにはタイムラインデータがありません。</p>`;
    }
    const adv = ct.meta.advancePerGroup;
    // 行＝順位（位置）, 列＝時間。各スナップショットの「位置index → teamId」「teamId → 位置index」
    const posByCol = snaps.map((s) => s.standings.rows.map((r) => r.teamId)); // [col][pos] = teamId
    const idxByCol = posByCol.map((arr) => new Map(arr.map((id, i) => [id, i])));
    const teamCount = posByCol[0].length;

    const bodyRows = Array.from({ length: teamCount }, (_, pos) => {
      const advCls = pos < adv ? " is-adv" : "";
      const cells = posByCol
        .map((col, ci) => {
          const tid = col[pos];
          // 位置ベースの上下（直前列での同チームの位置と比較）= 国旗が上下する動き
          let mv: "up" | "down" | "same" = "same";
          if (ci > 0) {
            const prev = idxByCol[ci - 1].get(tid);
            if (prev !== undefined) mv = pos < prev ? "up" : pos > prev ? "down" : "same";
          }
          return `<td class="tl-flagcell${advCls}" title="${esc(team(tid).name)}"><span class="tl-flag">${team(tid).flag}</span><span class="tl-code">${tc(tid)}</span>${moveMark(mv)}</td>`;
        })
        .join("");
      return `<tr><th scope="row" class="tl-poscol${advCls}">${pos + 1}</th>${cells}</tr>`;
    }).join("");

    // ヘッダ: live は「第n節帯 + 日時帯 + 時刻行 + 2レーン（試合①/②）」、stage は1行（試合ごとの列）
    let theadHTML: string;
    if (view.view === "live") {
      const matches = ct.matchesByGroup.get(view.group) ?? [];
      const koByMatch = new Map(matches.map((m) => [m.id, m.kickoff ?? ""]));
      // 節ごとの試合を (kickoff, matchId) 昇順で slotA/slotB に（早いキックオフ＝試合①）
      const byMd = new Map<number, Match[]>();
      for (const m of matches) {
        const arr = byMd.get(m.matchday) ?? [];
        arr.push(m);
        byMd.set(m.matchday, arr);
      }
      const koCmp = (a: Match, b: Match) =>
        (a.kickoff ?? "") < (b.kickoff ?? "") ? -1 : (a.kickoff ?? "") > (b.kickoff ?? "") ? 1 : a.id < b.id ? -1 : 1;
      for (const arr of byMd.values()) arr.sort(koCmp);
      const slotOf = (s: Snapshot): 0 | 1 => (byMd.get(s.event!.matchday)![0]?.id === s.event!.matchId ? 0 : 1);

      // 連続列を keyFn でまとめて colspan 帯を作る（snaps は絶対時刻昇順なので matchday も kickoff も連続）
      const bandRow = (keyFn: (s: Snapshot) => string, label: (key: string) => string, cls: string): string => {
        let cells = "";
        for (let bi = 0; bi < snaps.length; ) {
          const key = keyFn(snaps[bi]);
          let span = 0;
          while (bi + span < snaps.length && keyFn(snaps[bi + span]) === key) span++;
          cells += `<th class="${cls}" colspan="${span}">${esc(label(key))}</th>`;
          bi += span;
        }
        return cells;
      };
      const fmtKO = (iso: string): string =>
        iso.length >= 16 ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}` : iso;

      const mdBand = bandRow((s) => String(s.event!.matchday), (k) => `第${k}節`, "tl-band");
      const koBand = bandRow((s) => koByMatch.get(s.event!.matchId) ?? "", (k) => fmtKO(k), "tl-dateband");

      const timeCells = snaps
        .map((s) => `<th class="tl-th-time ${slotOf(s) === 0 ? "is-A" : "is-B"}">${esc(s.clockLabel)}</th>`)
        .join("");

      const laneRow = (slot: 0 | 1, cls: string, label: string): string => {
        const cells = snaps
          .map((s) => {
            if (slotOf(s) === slot) {
              const e = s.event!;
              const scorerId = e.scorerSide === "home" ? e.homeId : e.awayId;
              const who = e.scorer ? `${team(scorerId).flag}${esc(e.scorer)}` : `${team(scorerId).flag}`;
              return `<td class="tl-lane-cell ${cls}"><div class="tl-ch-scorer">⚽${who}</div><div class="tl-ch-score">${tc(e.homeId)} ${e.homeScore}-${e.awayScore} ${tc(e.awayId)}</div></td>`;
            }
            return `<td class="tl-lane-empty ${cls}"></td>`;
          })
          .join("");
        return `<tr><th class="tl-lane-label ${cls}">${label}</th>${cells}</tr>`;
      };

      theadHTML = `
        <tr><th class="tl-corner tl-band-corner"></th>${mdBand}</tr>
        <tr><th class="tl-corner tl-band-corner"></th>${koBand}</tr>
        <tr><th class="tl-corner">時刻</th>${timeCells}</tr>
        ${laneRow(0, "is-A", "試合①")}
        ${laneRow(1, "is-B", "試合②")}`;
    } else {
      const headCols = snaps.map(colHeadHTML).join("");
      theadHTML = `<tr><th class="tl-corner">順位</th>${headCols}</tr>`;
    }

    return `
      <div class="timeline-scroll">
        <table class="tl-grid tnum">
          <thead>${theadHTML}</thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;
  }

  // ---- もしものスコア（マトリックス・折りたたみ内） ----
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
          <p class="assume-hint">⚠️ 他にも未消化の試合があります。仮のスコアを入れてください。</p>
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
    for (const tab of root.querySelectorAll<HTMLElement>(".group-tab")) {
      tab.classList.toggle("is-on", tab.dataset.group === view.group);
    }
    // 表示モードトグル（live が無い組では live を隠す）
    for (const btn of root.querySelectorAll<HTMLElement>(".view-toggle .seg-btn")) {
      const mode = btn.dataset.view as ViewMode;
      btn.classList.toggle("seg-on", mode === view.view);
      btn.hidden = mode === "live" && view.liveTimeline === null;
    }
    elCaption.textContent = `グループ ${view.group}`;
    elStandings.innerHTML = standingsHTML(view.standings);
    elStatus.innerHTML = statusHTML(view.status);
    elBestThirds.innerHTML = view.bestThirds ? bestThirdsHTML(view.bestThirds) : "";
    elTimeline.innerHTML = timelineHTML(view);
    elPivot.innerHTML = pivotHTML(view);
    elMatrix.innerHTML = matrixHTML(view.matrix);
    elLegend.innerHTML = legendHTML(view.matrix);
  }

  return { render };
}
