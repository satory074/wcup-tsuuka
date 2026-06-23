// 唯一の DOM 層。グループ選択・順位表・通過ステータス・タイムライン（主役）・
// 通過条件シナリオ（折りたたみ）を描画する。
// イベントはルートの click リスナーで data-action 委譲（kisei/moshirasu パターン）。
import type { CompiledTournament, GroupId, Standings } from "../engine/types";
import { rankMark, tricode } from "../engine/format";
import type { TeamStatus } from "../engine/status";
import type { GroupQualification, TeamQualification, BoundaryNote, TeamCondition } from "../engine/scenario/qualify";
import type { Snapshot } from "../engine/timeline";
import type { ScorerEntry } from "../engine/scorers";
import type { BestThirdsResult, ThirdEntry } from "../engine/thirds";
import type { Cup, Scope } from "./url";

/** 一覧カードの安価な進行フェーズ（消化試合数から導出。列挙ベースの analyzeGroup とは別物）。 */
export type OverviewPhase = "early" | "final-round" | "decided";

const CUPS: { id: Cup; label: string }[] = [
  { id: "2022", label: "2022 カタール" },
  { id: "2026", label: "2026 北中米" },
];

export type Command =
  | { type: "set-group"; group: GroupId }
  | { type: "set-cup"; cup: Cup }
  | { type: "set-scope"; scope: Scope };
export type Dispatch = (cmd: Command) => void;

export interface RenderView {
  /** 表示範囲（overview=全組一覧 / detail=1組詳細） */
  scope: Scope;
  group: GroupId;
  /** 一覧用: 全組の順位（detail でも算出済みなので常に渡す） */
  standingsByGroup: Map<GroupId, Standings>;
  /** 一覧用: 各組の安価な進行フェーズ（バッジ表示） */
  phaseByGroup: Map<GroupId, OverviewPhase>;
  /** 2026方式のベスト3位（advanceBestThirds>0 のときのみ中身が出る） */
  bestThirds?: BestThirdsResult;
  /** 得点ランキング（大会全体・全グループ横断）。常に渡る。 */
  scorers?: ScorerEntry[];
  // ---- 以下は detail のときだけ渡る（overview では未使用） ----
  standings?: Standings;
  status?: TeamStatus[];
  /** タイムライン（分刻みゴール＋節末）。データが無ければ null。 */
  timeline?: Snapshot[] | null;
  /** 通過条件（シナリオ）パネル用 */
  qualification?: GroupQualification;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createRenderer(root: HTMLElement, ct: CompiledTournament, cup: Cup, dispatch: Dispatch) {
  const team = (id: string) => ct.teamsById.get(id)!;
  const tc = (id: string) => esc(tricode(team(id)));
  /** 順位表に併記する FIFA世界ランキング（無ければ空）。 */
  const fifaInline = (id: string) => {
    const r = team(id).fifaRank;
    return r ? `<span class="team-fifa" title="FIFA世界ランキング">FIFA ${r}位</span>` : "";
  };

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
        <div id="detail-main">
          <h2 class="section-title">最終順位 <span class="hint" id="group-caption"></span></h2>
          <div id="standings"></div>
          <div id="status"></div>
          <div id="best-thirds"></div>

          <h2 class="section-title">タイムライン <span class="hint">この時間に得点 → この時点ではこの順位（節末に試合結果）</span></h2>
          <p class="tl-legend-note">🟩 暫定通過圏（上位${ct.meta.advancePerGroup}${btNote}） ／ 線＝各国の順位推移（右端＝最終順位・点＝得点で動いた瞬間・◇＝節末に各試合結果）</p>
          <div id="timeline"></div>

          <details class="scenario-details" id="scenario-details">
            <summary>通過条件（シナリオ）を見る</summary>
            <div class="scenario-details-body">
              <div id="scenario"></div>
            </div>
          </details>
        </div>

        <aside id="detail-side">
          <div id="top-scorers"></div>
        </aside>
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
  const elTopScorers = $("#top-scorers");
  const elScenario = $("#scenario");
  const elScenarioDetails = $("#scenario-details");
  const elCaption = $("#group-caption");

  // ---- イベント委譲 ----
  root.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!t) return;
    if (t.dataset.action === "set-group") dispatch({ type: "set-group", group: t.dataset.group as GroupId });
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
            <td class="col-team"><span class="team-cell"><span class="team-flag">${team(r.teamId).flag}</span><span class="team-name">${esc(team(r.teamId).name)}</span>${fifaInline(r.teamId)}${tie}</span></td>
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
    // 行ごとの「暫定」は全行に並んで冗長（下の注記が一括で説明）。本当に未決着な3位タイ＝🎲抽選だけ行に出す。
    const stateBadge = (e: ThirdEntry): string => {
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
      ? `<p class="site-sub bt-note">⚠️ グループステージ進行中のため<b>全行が暫定</b>です（🟩＝現時点で上位${bt.slots}圏／🎲＝3位タイの抽選）。</p>`
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
        // 🎲 は「消化済みなのに並んで未決着」のときだけ。未消化（played=0）は「–」表示で足り、🎲 の多発はノイズ。
        const tie = r.tiedGroupKey && r.played > 0 ? `<span class="tie-badge">🎲</span>` : "";
        // 未消化（played=0）の組は勝点・得失点差を 0-0-0 に見せず「–」表示。
        const gd = r.played === 0 ? "–" : gdLabel(r.gd);
        const pts = r.played === 0 ? "–" : String(r.points);
        return `
          <tr class="${cls}">
            <td class="mini-rank">${r.rank}</td>
            <td class="mini-team"><span class="mini-flag">${team(r.teamId).flag}</span><span class="mini-code">${tc(r.teamId)}</span>${team(r.teamId).fifaRank ? `<span class="mini-fifa" title="FIFA世界ランキング">FIFA${team(r.teamId).fifaRank}</span>` : ""}${tie}</td>
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

  // ---- タイムライン（主役・順位バンプチャート: x=イベント時系列, y=順位, 線=各国の推移） ----
  // 線にすることで全節が1画面に収まり、各国の軌跡を一目で追える（旧: 横スクロールする国旗の格子）。
  // engine の Snapshot[]（各列の standings 並び＝位置）をそのまま座標列に使う＝engine は不変。
  const TEAM_LINE_COLORS = ["#2563eb", "#ea7317", "#7c3aed", "#0d9488", "#db2777", "#475569"];
  const rawTc = (id: string) => tricode(team(id));

  // 節末スナップの試合結果を1行に: "MEX 2-0 RSA ／ KOR 2-1 CZE"。
  const roundResultText = (snap: Snapshot): string =>
    (snap.roundResults ?? [])
      .map((r) => `${rawTc(r.homeId)} ${r.homeScore}-${r.awayScore} ${rawTc(r.awayId)}`)
      .join(" ／ ");

  // 頂点ツールチップ: 「国名・順位｜（ゴール）クロック スコア（得点者）／（節末）第n節 終了 試合結果」。
  function tipText(tid: string, snap: Snapshot, scoring: boolean): string {
    const pos = snap.standings.rows.findIndex((r) => r.teamId === tid) + 1;
    let s = `${team(tid).name}・${pos}位`;
    if (snap.kind === "roundEnd") {
      s += `｜${snap.clockLabel}　${roundResultText(snap)}`;
    } else if (snap.event) {
      const e = snap.event;
      s += `｜${snap.clockLabel} ${rawTc(e.homeId)} ${e.homeScore}-${e.awayScore} ${rawTc(e.awayId)}`;
      if (scoring && e.scorer) s += ` ⚽${e.scorer}`;
    }
    return esc(s);
  }

  function timelineHTML(view: RenderView): string {
    const snaps = view.timeline;
    if (!snaps || snaps.length === 0) {
      return `<p class="empty-msg">このグループにはタイムラインデータがありません。</p>`;
    }
    const adv = ct.meta.advancePerGroup;
    const cols = snaps.length;
    const posByCol = snaps.map((s) => s.standings.rows.map((r) => r.teamId)); // [col][pos] = teamId
    const idxByCol = posByCol.map((arr) => new Map(arr.map((id, i) => [id, i])));
    const teamCount = posByCol[0].length;

    // 色は最終順位（最後の列の位置順）で固定割当＝1位から順に同じ色。決定的。
    const finalOrder = posByCol[cols - 1];
    const colorOf = new Map<string, string>(
      finalOrder.map((id, i) => [id, TEAM_LINE_COLORS[i % TEAM_LINE_COLORS.length]]),
    );

    // ジオメトリ（SVG ユーザー単位・幅1000固定で width:100% スケール）
    const VBW = 1000;
    const mL = 36;
    const mR = 132;
    const mT = 36;
    const mB = 16;
    const rowGap = 64;
    const plotL = mL;
    const plotR = VBW - mR;
    const plotT = mT;
    const plotB = plotT + rowGap * (teamCount - 1);
    const VBH = plotB + mB;
    // x座標: 列ごとに1単位進み、節末列の直後にガター(GUT)を足す＝そのガターに節結果スコアを置く。
    // 最終列が節末ならその右にもガターを残し、右端ラベルとの間にスコアを収める。
    const GUT = 2.6;
    const us: number[] = [];
    {
      let u = 0;
      for (let ci = 0; ci < cols; ci++) {
        us.push(u);
        u += 1 + (snaps[ci].kind === "roundEnd" ? GUT : 0);
      }
    }
    const span = Math.max(1e-6, us[cols - 1] + (snaps[cols - 1].kind === "roundEnd" ? GUT : 0));
    const xAt = (ci: number) => (cols === 1 ? (plotL + plotR) / 2 : plotL + ((plotR - plotL) * us[ci]) / span);
    const yAt = (pos: number) => plotT + rowGap * pos;
    const f1 = (n: number) => n.toFixed(1);

    // 暫定通過圏バンド（上位 adv 位のレーン）
    const bandTop = yAt(0) - rowGap * 0.3;
    const bandBot = yAt(adv - 1) + rowGap * 0.3;
    const band = `<rect class="tl-advband" x="${plotL}" y="${f1(bandTop)}" width="${plotR - plotL}" height="${f1(bandBot - bandTop)}" />`;

    // レーン線＋順位ラベル（左）
    let lanes = "";
    for (let p = 0; p < teamCount; p++) {
      const y = yAt(p);
      lanes += `<line class="tl-lane" x1="${plotL}" y1="${f1(y)}" x2="${plotR}" y2="${f1(y)}" />`;
      lanes += `<text class="tl-poslabel" x="${plotL - 12}" y="${f1(y)}" dominant-baseline="middle" text-anchor="end">${p + 1}</text>`;
    }

    // 節帯（連続する同 matchday をまとめてラベル＋区切り線・節に日付 M/D を併記）
    const gMatches = ct.matchesByGroup.get(view.group) ?? [];
    const koByMd = new Map<number, string>(); // matchday → 最早 kickoff iso
    for (const m of gMatches) {
      if (!m.kickoff) continue;
      const prev = koByMd.get(m.matchday);
      if (prev === undefined || m.kickoff < prev) koByMd.set(m.matchday, m.kickoff);
    }
    const mdDateLabel = (md: number): string => {
      const iso = koByMd.get(md);
      return iso && iso.length >= 10 ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "";
    };
    let mdBands = "";
    const mdOf = (ci: number) => snaps[ci].matchday;
    for (let bi = 0; bi < cols; ) {
      const md = mdOf(bi);
      let span = 0;
      while (bi + span < cols && mdOf(bi + span) === md) span++;
      const cx = (xAt(bi) + xAt(bi + span - 1)) / 2;
      const date = mdDateLabel(md);
      const dateTsp = date ? ` <tspan class="tl-md-date">${date}</tspan>` : "";
      mdBands += `<text class="tl-md" x="${f1(cx)}" y="${f1(plotT - 22)}" text-anchor="middle">第${md}節${dateTsp}</text>`;
      if (bi > 0) {
        // 区切り線はガター内の節結果スコアを跨がないよう、次バンド寄りに置く。
        const sep = xAt(bi) - (xAt(bi) - xAt(bi - 1)) * 0.18;
        mdBands += `<line class="tl-mdsep" x1="${f1(sep)}" y1="${f1(plotT - 30)}" x2="${f1(sep)}" y2="${f1(plotB)}" />`;
      }
      bi += span;
    }

    // 各国の折れ線＋頂点＋右端ラベル（最終順位の位置に flag + code）
    let lines = "";
    for (const tid of finalOrder) {
      const color = colorOf.get(tid)!;
      const pts = posByCol.map((_, ci) => `${f1(xAt(ci))},${f1(yAt(idxByCol[ci].get(tid)!))}`).join(" ");
      lines += `<polyline class="tl-line" data-team="${tid}" points="${pts}" style="stroke:${color}" />`;
      for (let ci = 0; ci < cols; ci++) {
        const snap = snaps[ci];
        const e = snap.event;
        const scorerId = e && e.scorerSide ? (e.scorerSide === "home" ? e.homeId : e.awayId) : undefined;
        const scoring = scorerId === tid;
        const isRE = snap.kind === "roundEnd";
        const cls = `tl-dot${scoring ? " is-scorer" : ""}${isRE ? " is-roundend" : ""}`;
        const r = scoring ? 5 : isRE ? 4 : 3;
        // 節末は色付きの中空リング（チェックポイント）、ゴールは塗りつぶし。
        const dotStyle = isRE ? `fill:var(--surface);stroke:${color}` : `fill:${color}`;
        lines += `<circle class="${cls}" data-team="${tid}" cx="${f1(xAt(ci))}" cy="${f1(yAt(idxByCol[ci].get(tid)!))}" r="${r}" style="${dotStyle}"><title>${tipText(tid, snap, scoring)}</title></circle>`;
      }
      const fy = yAt(idxByCol[cols - 1].get(tid)!);
      lines += `<text class="tl-endlabel" data-team="${tid}" x="${f1(plotR + 12)}" y="${f1(fy)}" dominant-baseline="middle"><tspan class="tl-end-flag">${team(tid).flag}</tspan><tspan class="tl-end-code" dx="4" style="fill:${color}">${tc(tid)}</tspan></text>`;
    }

    // 節結果スコア（節末リングの右隣・lane1/lane2 の高さ）。白ハローで線の上でも読める。
    let roundScores = "";
    for (let ci = 0; ci < cols; ci++) {
      const snap = snaps[ci];
      if (snap.kind !== "roundEnd" || !snap.roundResults) continue;
      const x = xAt(ci) + 10;
      snap.roundResults.forEach((rr, ri) => {
        if (ri >= teamCount) return;
        const txt = `${rawTc(rr.homeId)} ${rr.homeScore}-${rr.awayScore} ${rawTc(rr.awayId)}`;
        roundScores += `<text class="tl-round-score" x="${f1(x)}" y="${f1(yAt(ri))}" dominant-baseline="middle" text-anchor="start">${esc(txt)}</text>`;
      });
    }

    const aria = `グループ${view.group}の順位推移。縦軸=順位（上が1位・上位${adv}が通過圏）、横軸=時系列。色付きの線が各国の順位の動き。節末に各試合の結果。`;
    const svg = `<svg class="tl-chart" viewBox="0 0 ${VBW} ${VBH}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMid meet">${band}${lanes}${mdBands}${lines}${roundScores}</svg>`;

    // 凡例（色→国旗→和名→最終順位）= チャートの色対応＆名前を補う
    const legend = finalOrder
      .map(
        (tid, i) =>
          `<span class="tl-leg-item"><span class="tl-leg-swatch" style="background:${colorOf.get(tid)}"></span>${team(tid).flag}<span class="tl-leg-name">${esc(team(tid).name)}</span><span class="tl-leg-rank">${i + 1}位</span></span>`,
      )
      .join("");

    // 得点タイムライン（縦型）。各節の見出し → ゴール（時刻・得点者・スコア）→「第n節 結果」を時系列で並べる。
    // ゴール行の左ボーダー＝得点国の線色でチャートの折れ線と対応づける。
    let prevMd = 0;
    const items: string[] = [];
    for (const s of snaps) {
      if (s.matchday !== prevMd) {
        items.push(`<li class="tlog-md-head">第${s.matchday}節</li>`);
        prevMd = s.matchday;
      }
      if (s.kind === "roundEnd") {
        const res = (s.roundResults ?? [])
          .map(
            (r) =>
              `<span class="tlog-round-res">${team(r.homeId).flag}${tc(r.homeId)} <b>${r.homeScore}-${r.awayScore}</b> ${tc(r.awayId)}${team(r.awayId).flag}</span>`,
          )
          .join("");
        items.push(`<li class="tlog-round"><span class="tlog-round-head">第${s.matchday}節 結果</span>${res}</li>`);
      } else if (s.event) {
        const e = s.event;
        const scorerId = e.scorerSide === "home" ? e.homeId : e.awayId;
        const color = colorOf.get(scorerId) ?? "var(--border-strong)";
        const who = e.scorer ? `${team(scorerId).flag}${esc(e.scorer)}` : `${team(scorerId).flag}`;
        const score = `${tc(e.homeId)} ${e.homeScore}-${e.awayScore} ${tc(e.awayId)}`;
        items.push(
          `<li class="tlog-goal" style="border-left-color:${color}"><span class="tlog-time">${esc(s.clockLabel)}</span><span class="tlog-scorer">⚽${who}</span><span class="tlog-score">${score}</span></li>`,
        );
      }
    }
    const log = `<div class="tl-log"><p class="tl-log-head">得点タイムライン</p><ol class="tl-timeline">${items.join("")}</ol></div>`;

    return `
      <div class="timeline-scroll"><div class="tl-chart-wrap">${svg}</div></div>
      <div class="tl-legend">${legend}</div>
      ${log}`;
  }

  // ---- 得点ランキング（大会全体・全グループ横断） ----
  function topScorersHTML(scorers: ScorerEntry[], top = 12): string {
    if (!scorers || scorers.length === 0) return "";
    // 上位 top 件を出すが、最後の順位に同点が続くなら同点ぶんは全部出す（途中で切らない）。
    let cut = Math.min(top, scorers.length);
    while (cut < scorers.length && scorers[cut].goals === scorers[cut - 1].goals) cut++;
    const shown = scorers.slice(0, cut);
    const partial = (ct.meta.advanceBestThirds ?? 0) > 0; // 2026 は進行中＝暫定
    const rows = shown
      .map(
        (e) =>
          `<tr><td class="col-rank"><span class="rank-badge">${e.rank}</span></td>
            <td class="col-team"><span class="team-cell"><span class="team-flag">${team(e.teamId).flag}</span><span class="team-name">${esc(e.player)}</span><span class="ts-team">${tc(e.teamId)}</span></span></td>
            <td class="ts-goals tnum">${e.goals}${e.pk ? `<span class="ts-pk">PK${e.pk}</span>` : ""}</td>
          </tr>`,
      )
      .join("");
    const note = partial
      ? `<p class="site-sub bt-note">⚠️ グループステージ進行中のため<b>暫定</b>（消化済み試合のみ）。</p>`
      : "";
    return `
      <h2 class="section-title">得点ランキング <span class="hint">大会全体（グループステージ）の得点者</span></h2>
      ${note}
      <div class="card ts-card tnum">
        <table class="ts-table">
          <thead><tr><th class="col-rank">順</th><th class="col-team">選手</th><th class="ts-goals">得点</th></tr></thead>
          <tbody>${rows}</tbody>
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
    // ヒーロー内側幅を本文に合わせる（overview は本文 1200px に追従させ左端を揃える）。
    root.classList.toggle("scope-overview", isOverview);

    if (isOverview) {
      elOverview.innerHTML = overviewHTML(view);
      return; // detail 専用フィールドには触れない
    }

    // ---- detail（1グループ）。main.ts が detail のとき必ず渡す。 ----
    const qualification = view.qualification!;
    elCaption.textContent = `グループ ${view.group}`;
    elStandings.innerHTML = standingsHTML(view.standings!);
    elStatus.innerHTML = statusHTML(view.status!);
    elBestThirds.innerHTML = view.bestThirds ? bestThirdsHTML(view.bestThirds) : "";
    elTimeline.innerHTML = timelineHTML(view);
    elTopScorers.innerHTML = topScorersHTML(view.scorers ?? []);
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
