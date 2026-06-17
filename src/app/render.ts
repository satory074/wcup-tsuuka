// 唯一の DOM 層。グループ選択・順位表・通過ステータス・タイムライン（主役）・
// 通過条件シナリオ（折りたたみ）を描画する。
// イベントはルートの click リスナーで data-action 委譲（kisei/moshirasu パターン）。
import type { CompiledTournament, GroupId, Match, Standings } from "../engine/types";
import { rankMark, tricode } from "../engine/format";
import type { TeamStatus } from "../engine/status";
import type { GroupQualification, TeamQualification, BoundaryNote, TeamCondition } from "../engine/scenario/qualify";
import type { Snapshot } from "../engine/timeline";
import type { BestThirdsResult, ThirdEntry } from "../engine/thirds";
import type { Cup, Scope } from "./url";

export type ViewMode = "live" | "stage";
/** 一覧カードの安価な進行フェーズ（消化試合数から導出。列挙ベースの analyzeGroup とは別物）。 */
export type OverviewPhase = "early" | "final-round" | "decided";

const CUPS: { id: Cup; label: string }[] = [
  { id: "2022", label: "2022 カタール" },
  { id: "2026", label: "2026 北中米" },
];

export type Command =
  | { type: "set-group"; group: GroupId }
  | { type: "set-view"; view: ViewMode }
  | { type: "set-cup"; cup: Cup }
  | { type: "set-scope"; scope: Scope };
export type Dispatch = (cmd: Command) => void;

export interface RenderView {
  /** 表示範囲（overview=全組一覧 / detail=1組詳細） */
  scope: Scope;
  group: GroupId;
  view: ViewMode;
  /** 一覧用: 全組の順位（detail でも算出済みなので常に渡す） */
  standingsByGroup: Map<GroupId, Standings>;
  /** 一覧用: 各組の安価な進行フェーズ（バッジ表示） */
  phaseByGroup: Map<GroupId, OverviewPhase>;
  /** 2026方式のベスト3位（advanceBestThirds>0 のときのみ中身が出る） */
  bestThirds?: BestThirdsResult;
  // ---- 以下は detail のときだけ渡る（overview では未使用） ----
  standings?: Standings;
  status?: TeamStatus[];
  liveTimeline?: Snapshot[] | null;
  stageTimeline?: Snapshot[];
  /** 通過条件（シナリオ）パネル用 */
  qualification?: GroupQualification;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createRenderer(root: HTMLElement, ct: CompiledTournament, cup: Cup, dispatch: Dispatch) {
  const team = (id: string) => ct.teamsById.get(id)!;
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

      <div class="scope-toggle seg" role="group" aria-label="表示範囲">
        <button type="button" class="seg-btn" data-action="set-scope" data-scope="overview">一覧</button>
        <button type="button" class="seg-btn" data-action="set-scope" data-scope="detail">詳細</button>
      </div>

      <div id="overview" hidden></div>

      <div id="detail-view">
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

        <details class="scenario-details" id="scenario-details">
          <summary>通過条件（シナリオ）を見る</summary>
          <div class="scenario-details-body">
            <div id="scenario"></div>
          </div>
        </details>
      </div>

      <footer class="site-footer">
        <p class="disclaimer">⚠️ ${esc(ct.meta.disclaimer)}</p>
        <p class="tnum">データ最終更新: ${esc(ct.meta.dataLastUpdated)}（${esc(ct.meta.edition)}）</p>
        <p><a href="${esc(ct.meta.source)}" target="_blank" rel="noopener">データ出典</a></p>
      </footer>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const elOverview = $("#overview");
  const elDetail = $("#detail-view");
  const elStandings = $("#standings");
  const elStatus = $("#status");
  const elBestThirds = $("#best-thirds");
  const elTimeline = $("#timeline");
  const elScenario = $("#scenario");
  const elScenarioDetails = $("#scenario-details");
  const elCaption = $("#group-caption");

  // ---- イベント委譲 ----
  root.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!t) return;
    if (t.dataset.action === "set-group") dispatch({ type: "set-group", group: t.dataset.group as GroupId });
    else if (t.dataset.action === "set-view") dispatch({ type: "set-view", view: t.dataset.view as ViewMode });
    else if (t.dataset.action === "set-cup") dispatch({ type: "set-cup", cup: t.dataset.cup as Cup });
    else if (t.dataset.action === "set-scope") dispatch({ type: "set-scope", scope: t.dataset.scope as Scope });
    else if (t.dataset.action === "drill-group") {
      // 一覧カード → そのグループの詳細へ（単機能 Command 2連発）。
      dispatch({ type: "set-group", group: t.dataset.group as GroupId });
      dispatch({ type: "set-scope", scope: "detail" });
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

  // ---- 一覧（全グループ）: コンパクト順位表カードのグリッド ----
  function phaseBadge(p: OverviewPhase): string {
    if (p === "decided") return `<span class="phase-badge is-decided">確定</span>`;
    if (p === "final-round") return `<span class="phase-badge is-final">最終節</span>`;
    return `<span class="phase-badge is-early">進行中</span>`;
  }

  function miniStandingsCard(gid: GroupId, st: Standings, phase: OverviewPhase): string {
    const adv = ct.meta.advancePerGroup;
    const rows = st.rows
      .map((r, i) => {
        const cls = [r.advances ? "row-advance" : "", i + 1 === adv ? "advance-line" : ""].filter(Boolean).join(" ");
        const tie = r.tiedGroupKey ? `<span class="tie-badge">🎲</span>` : "";
        // 未消化（played=0）の組は勝点・得失点差を 0-0-0 に見せず「–」表示。
        const gd = r.played === 0 ? "–" : gdLabel(r.gd);
        const pts = r.played === 0 ? "–" : String(r.points);
        return `
          <tr class="${cls}">
            <td class="mini-rank">${r.rank}</td>
            <td class="mini-team"><span class="mini-flag">${team(r.teamId).flag}</span><span class="mini-code">${tc(r.teamId)}</span>${tie}</td>
            <td class="mini-gd">${gd}</td>
            <td class="mini-pts">${pts}</td>
          </tr>`;
      })
      .join("");
    return `
      <button type="button" class="card mini-group" data-action="drill-group" data-group="${gid}" aria-label="グループ${gid}の詳細へ">
        <div class="mini-head"><span class="mini-letter">${gid}</span>${phaseBadge(phase)}</div>
        <table class="mini-table tnum"><tbody>${rows}</tbody></table>
      </button>`;
  }

  function overviewHTML(view: RenderView): string {
    const cards = ct.groups
      .map((gid) => miniStandingsCard(gid, view.standingsByGroup.get(gid)!, view.phaseByGroup.get(gid) ?? "early"))
      .join("");
    // 2026方式: グリッド下に全幅でベスト3位表（既存ビルダーを再利用）。2022は空。
    const bt =
      view.bestThirds && view.bestThirds.slots > 0
        ? `<div class="overview-bt">${bestThirdsHTML(view.bestThirds)}</div>`
        : "";
    return `
      <p class="tl-legend-note">🟩 暫定通過圏（上位${ct.meta.advancePerGroup}） ／ 🎲 抽選 ／ カードをタップでそのグループの詳細（タイムライン）へ</p>
      <div class="overview-grid">${cards}</div>
      ${bt}`;
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

  // ---- 通過条件シナリオ（折りたたみ内） ----
  const STATUS_META: Record<TeamStatus["status"], { cls: string; word: string }> = {
    advanced: { cls: "is-advanced", word: "突破確定" },
    alive: { cls: "is-alive", word: "可能性あり" },
    eliminated: { cls: "is-eliminated", word: "敗退" },
  };

  function statusBadge(status: TeamStatus["status"]): string {
    const m = STATUS_META[status];
    return `<span class="cond-status ${m.cls}">${m.word}</span>`;
  }

  // decided: 隣接順位を分けた決め手（タイブレーク）を1行の文章に。
  function boundaryHTML(b: BoundaryNote, st: Standings): string {
    const rowOf = (id: string) => st.rows.find((r) => r.teamId === id)!;
    const h = rowOf(b.higher);
    const l = rowOf(b.lower);
    const hN = `${team(b.higher).flag}${esc(team(b.higher).name)}`;
    const lN = `${team(b.lower).flag}${esc(team(b.lower).name)}`;
    const verb = b.cutoff ? "通過" : "上位";
    let prose: string;
    switch (b.reason) {
      case "points":
        prose = `勝点 ${h.points}-${l.points} で ${hN} が${verb}`;
        break;
      case "gd":
        prose = `勝点${h.points}で並び → 総得失点差 ${gdLabel(h.gd)} / ${gdLabel(l.gd)} で ${hN} が${verb}`;
        break;
      case "gf":
        prose = `勝点${h.points}・得失点差${gdLabel(h.gd)} で並び → 総得点 ${h.gf}-${l.gf} で ${hN} が${verb}`;
        break;
      case "h2h_pts":
      case "h2h_gd":
      case "h2h_gf":
        prose = `総合成績が並び → ${esc(b.detail)}で ${hN} が${verb}`;
        break;
      case "fairplay":
        prose = `総合・直接対決とも並び → フェアプレー（警告少）で ${hN} が${verb}`;
        break;
      default:
        prose = `総合・直接対決とも並び → 🎲抽選で決定`;
    }
    return `
      <li class="boundary-note${b.cutoff ? " is-cutoff" : ""}">
        <span class="boundary-rank">${rankMark(h.rank)}${hN} <span class="boundary-sep">/</span> ${rankMark(l.rank)}${lN}</span>
        <span class="boundary-prose">${prose}</span>
      </li>`;
  }

  // final-round: 自チームの結果（勝/分/敗）ごとの通過可否を ✅⚠️❌ で。
  function conditionHTML(c: TeamCondition): string {
    const ante =
      c.result === "win"
        ? c.verdict === "advance" && c.note
          ? esc(c.note)
          : "勝てば"
        : c.result === "draw"
          ? "引き分けなら"
          : "敗れると";
    const cons = c.verdict === "advance" ? "突破" : c.verdict === "out" ? "敗退" : "他会場・得失点しだい";
    const icon = c.verdict === "advance" ? "✅" : c.verdict === "out" ? "❌" : "⚠️";
    return `<li class="cond-line cond-${c.verdict}"><span class="cond-icon">${icon}</span><span>${ante}<b>${cons}</b></span></li>`;
  }

  // final-round のチームカード（decided は決め手リスト・early はパネル非表示なので呼ばれない）。
  function teamCondHTML(tq: TeamQualification): string {
    const head = `
      <div class="cond-head">
        <span class="cond-rank">${rankMark(tq.rank)}</span>
        <span class="cond-flag">${team(tq.teamId).flag}</span>
        <span class="cond-name">${esc(team(tq.teamId).name)}</span>
        <span class="cond-stat tnum">勝点${tq.points}・${gdLabel(tq.gd)}</span>
        ${statusBadge(tq.status)}
      </div>`;

    let body: string;
    if (tq.status === "advanced") {
      body = `<p class="cond-note">✅ すでに突破確定</p>`;
    } else if (tq.status === "eliminated") {
      body = `<p class="cond-note">❌ すでに敗退</p>`;
    } else if (tq.conditions.length > 0) {
      body = `<ul class="cond-list">${tq.conditions.map(conditionHTML).join("")}</ul>`;
    } else {
      body = `<p class="cond-note">⚠️ 他会場の結果しだい</p>`;
    }
    return `<div class="card team-cond">${head}${body}</div>`;
  }

  function scenarioHTML(view: RenderView): string {
    const q = view.qualification!;
    if (q.phase === "decided") {
      const notes = q.boundaries.map((b) => boundaryHTML(b, view.standings!)).join("");
      return `
        <p class="scenario-intro">全試合が終了。各順位を分けた<b>決め手（タイブレーク）</b>を解説します。</p>
        <div class="card scenario-boundaries">
          <p class="scenario-block-title">決着の分かれ目</p>
          <ul class="boundary-list">${notes}</ul>
        </div>`;
    }
    if (q.phase === "final-round") {
      const watch = q.tiebreakWatch ?? [];
      let tb = "";
      if (watch.length > 0) {
        const names = watch.map((id) => `${team(id).flag}${esc(team(id).name)}`);
        const joined = names.length === 2 ? names.join("と") : names.join("・");
        tb = `<p class="scenario-note">⚠️ ${joined} が<b>勝点で並ぶ可能性</b>。並んだ場合は ②総得失点差 → ③総得点 → 直接対決 の順で決まります。</p>`;
      }
      const simul = q.simultaneous
        ? `<p class="scenario-note">⏱️ 最終節の2試合は<b>同時刻キックオフ</b>。「他会場しだい」はもう1試合の結果に依存します。</p>`
        : "";
      const cards = q.teams.map((t) => teamCondHTML(t)).join("");
      return `
        <p class="scenario-intro">最終節の結果しだいで通過が決まります。各チームが<b>自分の試合でどうすれば通過するか</b>:</p>
        ${tb}
        ${simul}
        <div class="scenario-teams">${cards}</div>`;
    }
    // early はパネルごと非表示（render が呼ばない）。防御的に空を返す。
    return "";
  }

  function render(view: RenderView): void {
    // グループタブのハイライトは両モード共通で同期。
    for (const tab of root.querySelectorAll<HTMLElement>(".group-tab")) {
      tab.classList.toggle("is-on", tab.dataset.group === view.group);
    }
    // 表示範囲トグル（一覧／詳細）の状態と表示切替。
    const isOverview = view.scope === "overview";
    for (const btn of root.querySelectorAll<HTMLElement>(".scope-toggle .seg-btn")) {
      btn.classList.toggle("seg-on", btn.dataset.scope === view.scope);
    }
    elOverview.hidden = !isOverview;
    elDetail.hidden = isOverview;
    (root.querySelector(".wrap") as HTMLElement).classList.toggle("is-overview", isOverview);

    if (isOverview) {
      elOverview.innerHTML = overviewHTML(view);
      return; // detail 専用フィールドには触れない
    }

    // ---- detail（1グループ）。main.ts が detail のとき必ず渡す。 ----
    const qualification = view.qualification!;
    // 表示モードトグル（live が無い組では live を隠す）
    for (const btn of root.querySelectorAll<HTMLElement>(".view-toggle .seg-btn")) {
      const mode = btn.dataset.view as ViewMode;
      btn.classList.toggle("seg-on", mode === view.view);
      btn.hidden = mode === "live" && (view.liveTimeline ?? null) === null;
    }
    elCaption.textContent = `グループ ${view.group}`;
    elStandings.innerHTML = standingsHTML(view.standings!);
    elStatus.innerHTML = statusHTML(view.status!);
    elBestThirds.innerHTML = view.bestThirds ? bestThirdsHTML(view.bestThirds) : "";
    elTimeline.innerHTML = timelineHTML(view);
    // シナリオが定まらない early フェーズはパネルごと隠す（意味がある時だけ出す）。
    if (qualification.phase === "early") {
      elScenarioDetails.hidden = true;
      elScenario.innerHTML = "";
    } else {
      elScenarioDetails.hidden = false;
      elScenario.innerHTML = scenarioHTML(view);
    }
  }

  return { render };
}
