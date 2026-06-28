// 唯一の DOM 層。グループ選択・順位表・通過ステータス・タイムライン（主役）・
// 通過条件シナリオ（折りたたみ）を描画する。
// イベントはルートの click リスナーで data-action 委譲（kisei/moshirasu パターン）。
import type { CompiledTournament, GroupId, KnockoutBracket, KoResolvedMatch, KoRound, KoSide, Standings } from "../engine/types";
import { tricode } from "../engine/format";
import type { TeamStatus } from "../engine/status";
import type { Snapshot } from "../engine/timeline";
import type { ScorerEntry } from "../engine/scorers";
import type { BestThirdsResult, ThirdEntry } from "../engine/thirds";
import type { Cup, Scope } from "./url";
import { assignGroupColors, type FlagPalette } from "./flagColors";
import flagColors from "../data/flag-colors.json";
import fifaRankings from "../data/fifa-rankings.json";

/** fifa-rankings.json の1エントリ（世界ランキングの1カ国）。 */
interface FifaRankRow {
  rank: number;
  code: string;
  name: string;
  flag: string;
}
const fifaRankingsByCup = fifaRankings as Record<string, FifaRankRow[]>;

/** 一覧カードの安価な進行フェーズ（消化試合数から導出。列挙ベースの analyzeGroup とは別物）。 */
export type OverviewPhase = "early" | "final-round" | "decided";

const CUPS: { id: Cup; label: string }[] = [
  { id: "2018", label: "2018 ロシア" },
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
  /** 決勝トーナメント（ブラケット）。一覧・詳細の両方で全幅表示。常に渡る。 */
  knockout?: KnockoutBracket;
  /** 得点ランキング（大会全体・全グループ横断）。常に渡る。 */
  scorers?: ScorerEntry[];
  // ---- 以下は detail のときだけ渡る（overview では未使用） ----
  standings?: Standings;
  status?: TeamStatus[];
  /** タイムライン（分刻みゴール＋節末）。データが無ければ null。 */
  timeline?: Snapshot[] | null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createRenderer(root: HTMLElement, ct: CompiledTournament, cup: Cup, dispatch: Dispatch) {
  const team = (id: string) => ct.teamsById.get(id)!;
  /** 表示用の国名（FIFAランキングと同じ日本語表記）。略号に代えて各所で使う。 */
  const tn = (id: string) => esc(team(id).name);
  /** 順位表に併記する FIFA世界ランキング（無ければ空）。 */
  const fifaInline = (id: string) => {
    const r = team(id).fifaRank;
    return r ? `<span class="team-fifa" title="FIFA世界ランキング">FIFA ${r}位</span>` : "";
  };
  /** kickoff "YYYY-MM-DDThh:mm" → 表示用の M/D・HH:MM・曜日（Date 不使用・slice＋Sakamoto）。 */
  const fmtKickoff = (iso: string): { date: string; time: string; dow: string } => {
    if (iso.length < 16) return { date: "", time: "", dow: "" };
    const y = Number(iso.slice(0, 4)),
      mo = Number(iso.slice(5, 7)),
      d = Number(iso.slice(8, 10));
    // Sakamoto のアルゴリズム（Date 不使用で曜日を算出）。w: 0=日 .. 6=土。
    const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    const yy = mo < 3 ? y - 1 : y;
    const w = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[mo - 1] + d) % 7;
    return { date: `${mo}/${d}`, time: iso.slice(11, 16), dow: "日月火水木金土"[w] };
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
        <p class="site-sub">いつ誰が得点して、その時点で通過国がどう入れ替わったかを時系列で可視化します。</p>
        <nav class="cup-tabs seg" id="cup-tabs" aria-label="大会選択">${cupTabs}</nav>
      </div>
    </header>
    <div class="wrap">
      <nav class="group-tabs" id="group-tabs" aria-label="グループ選択">${groupTabs}</nav>

      <div class="scope-toggle seg" role="group" aria-label="表示範囲">
        <button type="button" class="seg-btn" data-action="set-scope" data-scope="overview">一覧</button>
        <button type="button" class="seg-btn" data-action="set-scope" data-scope="detail">詳細</button>
      </div>

      <div class="layout-grid">
        <div class="layout-main">
      <!-- 日程・結果＝一覧・詳細共通・左カラム最上部。カードクリックでそのグループ詳細へドリル。 -->
      <div id="schedule"></div>

      <div id="overview" hidden></div>

      <div id="detail-view">
        <div id="detail-main">
          <h2 class="section-title">最終順位 <span class="hint" id="group-caption"></span></h2>
          <div id="standings"></div>
          <div id="status"></div>
        </div>

        <section id="detail-timeline">
          <h2 class="section-title">タイムライン <span class="hint">この時間に得点 → この時点ではこの順位（節末に試合結果）</span></h2>
          <p class="tl-legend-note">🟩 暫定通過圏（上位${ct.meta.advancePerGroup}${btNote}） ／ 線＝各国の順位推移（右端＝最終順位・●＝得点・◇＝節末に各試合結果）</p>
          <div id="timeline"></div>
        </section>
      </div>

          <!-- 決勝トーナメントは左カラム（主筋）に収める（両 scope）。 -->
          <section id="knockout"></section>
        </div>
        <aside class="layout-side">
          <!-- 得点＋FIFAランキング＝右レール（補足情報）。一覧・詳細で共通。 -->
          <section id="rankings"></section>
        </aside>
      </div>

      <footer class="site-footer">
        <p class="disclaimer">⚠️ ${esc(ct.meta.disclaimer)}</p>
        <p class="tnum">データ最終更新: ${esc(ct.meta.dataLastUpdated)}（${esc(ct.meta.edition)}）</p>
        <p><a href="${esc(ct.meta.source)}" target="_blank" rel="noopener">データ出典</a></p>
        <p><a href="https://satory074.com/apps/" target="_blank" rel="noopener">アプリ一覧へ</a></p>
      </footer>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const elOverview = $("#overview");
  const elDetail = $("#detail-view");
  const elSchedule = $("#schedule");
  const elStandings = $("#standings");
  const elStatus = $("#status");
  const elTimeline = $("#timeline");
  const elRankings = $("#rankings");
  const elCaption = $("#group-caption");
  const elKnockout = $("#knockout");

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

  // ---- ホバー連動ハイライト（凡例・順位表行・チャートの線/点・ランキング行を data-team で同期） ----
  // 1本に注目を集める selective highlighting。再描画で innerHTML が差し替わっても委譲リスナーは生存。
  // ランキングは scope 非依存の別セクション(#rankings)なので detail とランキングの両領域で同期する。
  const hlRoots = [elDetail, elRankings];
  let hoverTeam: string | null = null;
  function highlight(tid: string | null): void {
    if (tid === hoverTeam) return;
    hoverTeam = tid;
    for (const r of hlRoots) for (const el of r.querySelectorAll(".is-hl")) el.classList.remove("is-hl");
    const svg = elTimeline.querySelector(".tl-chart");
    if (!tid) {
      svg?.classList.remove("is-hovering");
      return;
    }
    for (const r of hlRoots) for (const el of r.querySelectorAll(`[data-team="${tid}"]`)) el.classList.add("is-hl");
    svg?.classList.add("is-hovering");
  }
  const onHover = (ev: Event): void => {
    const el = (ev.target as HTMLElement).closest("[data-team]") as HTMLElement | null;
    highlight(el ? el.dataset.team ?? null : null);
  };
  for (const r of hlRoots) {
    r.addEventListener("pointerover", onHover);
    r.addEventListener("pointerleave", () => highlight(null));
  }

  // ブラケットは elDetail の外（一覧でも表示）なので、自前のホバー連動を持つ。
  // 同チームの全セル（R32 と R16+ のプレースホルダは teamId が無いので R32 のみ）を .is-hl 同期。
  function highlightKo(tid: string | null): void {
    for (const el of elKnockout.querySelectorAll(".is-hl")) el.classList.remove("is-hl");
    if (!tid) return;
    for (const el of elKnockout.querySelectorAll(`[data-team="${tid}"]`)) el.classList.add("is-hl");
  }
  elKnockout.addEventListener("pointerover", (ev) => {
    const el = (ev.target as HTMLElement).closest("[data-team]") as HTMLElement | null;
    highlightKo(el ? el.dataset.team ?? null : null);
  });
  elKnockout.addEventListener("pointerleave", () => highlightKo(null));

  function gdLabel(gd: number): string {
    return gd > 0 ? `+${gd}` : String(gd);
  }

  // ---- 日程・結果（全試合＋決勝トーナメント・横並びカルーセル。時系列・該当グループを強調） ----
  const KO_SHORT: Record<KoRound, string> = { R32: "R32", R16: "R16", QF: "準々", SF: "準決", "3P": "3決", F: "決勝" };
  function scheduleHTML(view: RenderView): string {
    const group = view.group;
    const teamRow = (id: string, pts: string) =>
      `<div class="sched-card-row"><span class="sched-flag">${team(id).flag}</span><span class="sched-name">${tn(id)}</span><span class="sched-pts">${pts}</span></div>`;
    // グループステージの全試合（該当グループは強調＋クリックでドリル）。
    const groupCards = ct.groups
      .flatMap((g) => ct.matchesByGroup.get(g) ?? [])
      .map((m) => {
        const { date, time } = fmtKickoff(m.kickoff ?? "");
        const played = m.score !== undefined && m.score !== null;
        const cur = m.group === group;
        const cls = `sched-card${cur ? " is-current" : ""}${played ? "" : " is-upcoming"}`;
        const html =
          `<button type="button" class="${cls}" data-action="drill-group" data-group="${m.group}"${cur ? ' data-current="1"' : ""} aria-label="グループ${m.group}の詳細へ">` +
          `<div class="sched-card-head"><span class="sched-date">${esc(date)}</span><span class="sched-time">${esc(time)}</span><span class="sched-grp">${m.group}</span></div>` +
          teamRow(m.home, played ? String(m.score!.home) : "–") +
          teamRow(m.away, played ? String(m.score!.away) : "–") +
          `</button>`;
        return { kickoff: m.kickoff ?? "", key: m.id, html };
      });
    // 決勝トーナメント（kickoff を持つ＝日程確定の試合。確定チームは旗＋国名、未確定はスロットラベル）。
    const koRow = (side: KoSide, pts: string, win: boolean) =>
      `<div class="sched-card-row${win ? " is-winner" : ""}">` +
      (side.teamId
        ? `<span class="sched-flag">${team(side.teamId).flag}</span><span class="sched-name">${tn(side.teamId)}</span>`
        : `<span class="sched-name sched-ko-label">${esc(side.label)}</span>`) +
      `<span class="sched-pts">${pts}</span></div>`;
    const koCards = (view.knockout?.matches ?? [])
      .filter((m) => m.kickoff)
      .map((m) => {
        const { date, time } = fmtKickoff(m.kickoff!);
        const r = m.result;
        const s1 = r ? String(r.side1Score) : "–";
        const s2 = r ? String(r.side2Score) : "–";
        const html =
          `<div class="sched-card is-ko${r ? "" : " is-upcoming"}">` +
          `<div class="sched-card-head"><span class="sched-date">${esc(date)}</span><span class="sched-time">${esc(time)}</span><span class="sched-grp sched-ko-badge">${KO_SHORT[m.round]}</span></div>` +
          koRow(m.side1, s1, r?.winnerSide === 1) +
          koRow(m.side2, s2, r?.winnerSide === 2) +
          `</div>`;
        return { kickoff: m.kickoff!, key: m.id, html };
      });
    const all = [...groupCards, ...koCards];
    if (all.length === 0) return "";
    // キックオフ昇順（ISO は辞書順＝時系列）・同時刻は id 安定化。KO は全グループ後の日付なので末尾に並ぶ。
    all.sort((a, b) => (a.kickoff < b.kickoff ? -1 : a.kickoff > b.kickoff ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return `
      <h2 class="section-title">日程・結果 <span class="hint">全試合＋決勝トーナメント（該当＝グループ${group}を強調・横スクロール）</span></h2>
      <div class="card sched-carousel-wrap tnum"><div class="sched-carousel">${all.map((c) => c.html).join("")}</div></div>`;
  }

  // ---- 最終順位表 ----
  function standingsHTML(st: Standings): string {
    const adv = ct.meta.advancePerGroup;
    const rows = st.rows
      .map((r, i) => {
        const cls = [r.advances ? "row-advance" : "", i + 1 === adv ? "advance-line" : ""].filter(Boolean).join(" ");
        const tie = r.tiedGroupKey ? `<span class="tie-badge">抽選</span>` : "";
        return `
          <tr class="${cls}" data-team="${r.teamId}">
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

  // ---- 決勝トーナメント（ブラケット）。一覧・詳細の両方で全幅表示 ----
  const ROUND_LABEL: Record<KoRound, string> = {
    R32: "ラウンド32",
    R16: "ラウンド16",
    QF: "準々決勝",
    SF: "準決勝",
    "3P": "3位決定戦",
    F: "決勝",
  };

  function koSideHTML(side: KoSide, score?: number, isWinner?: boolean): string {
    const sc = score != null ? `<span class="ko-score">${score}</span>` : "";
    if (side.teamId) {
      return `<span class="ko-side is-team${isWinner ? " is-winner" : ""}" data-team="${side.teamId}"><span class="ko-flag">${team(side.teamId).flag}</span><span class="ko-name">${tn(side.teamId)}</span>${sc}</span>`;
    }
    return `<span class="ko-side is-undecided">${esc(side.label)}</span>`;
  }

  function koMatchHTML(m: KoResolvedMatch): string {
    const no = m.no ? `<span class="ko-no">M${esc(m.no)}</span>` : "";
    const k = m.kickoff ? fmtKickoff(m.kickoff) : null;
    const when = k
      ? `<span class="ko-when"><span class="ko-date">${esc(k.date)}(${esc(k.dow)})</span><span class="ko-time">${esc(k.time)}</span></span>`
      : "";
    const head = no || when ? `<div class="ko-head">${no}${when}</div>` : "";
    const r = m.result;
    // PK戦は勝者側のスコアを先に「PK 4-2」表記（勝者視点）。
    const so = r?.shootout
      ? `<span class="ko-so">PK ${r.winnerSide === 1 ? `${r.shootout.side1}-${r.shootout.side2}` : `${r.shootout.side2}-${r.shootout.side1}`}</span>`
      : "";
    return `<div class="ko-match${r ? " is-played" : ""}">${head}<div class="ko-sides">${koSideHTML(m.side1, r?.side1Score, r?.winnerSide === 1)}${koSideHTML(m.side2, r?.side2Score, r?.winnerSide === 2)}</div>${so}</div>`;
  }

  function knockoutHTML(view: RenderView): string {
    const ko = view.knockout;
    if (!ko || ko.matches.length === 0) return "";
    const cols = ko.rounds
      .map((r) => {
        const ms = ko.matches.filter((m) => m.round === r);
        return `<div class="ko-round ko-round-${r}"><div class="ko-round-head">${ROUND_LABEL[r]}</div><div class="ko-round-body">${ms.map(koMatchHTML).join("")}</div></div>`;
      })
      .join("");

    // 2026: 「勝者 vs 3位」枠の通過3位を凡例として併記（割当が未確定のときだけ。確定済み＝R32 に実チームが入る）。
    let pool = "";
    const bt = view.bestThirds;
    const hasUnassignedThird = ko.matches.some(
      (m) => (m.side1.undecided && m.side1.label.startsWith("3位")) || (m.side2.undecided && m.side2.label.startsWith("3位")),
    );
    if (bt && bt.slots > 0 && hasUnassignedThird) {
      const adv = bt.entries.filter((e) => e.advances);
      if (adv.length > 0) {
        const chips = adv
          .map(
            (e) =>
              `<span class="ko-pool-chip" data-team="${e.teamId}"><span class="ko-flag">${team(e.teamId).flag}</span>${tn(e.teamId)}<span class="ko-pool-grp">${e.group}</span></span>`,
          )
          .join("");
        const poolLabel = bt.undecided ? `暫定通過の3位（${bt.slots}枠）:` : `通過する3位（${bt.slots}組）:`;
        pool = `<div class="ko-pool"><span class="ko-pool-label">${poolLabel}</span>${chips}<span class="ko-pool-note">※ どの3位がどの「3位枠」に入るかは未割当</span></div>`;
      }
    }

    return `
      <h2 class="section-title">決勝トーナメント 組み合わせ <span class="hint">確定枠は実チーム（消化済みは勝者を強調＋スコア併記・PK戦は「PK 4-2」）／未確定はスロット（1A=A組1位・2B=B組2位・3位=対象組の最良3位）</span></h2>
      ${pool}
      <div class="ko-scroll"><div class="ko-bracket">${cols}</div></div>`;
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
            <td class="mini-team"><span class="mini-flag">${team(r.teamId).flag}</span><span class="mini-name">${tn(r.teamId)}</span>${team(r.teamId).fifaRank ? `<span class="mini-fifa" title="FIFA世界ランキング">FIFA${team(r.teamId).fifaRank}</span>` : ""}${tie}</td>
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
    // ランキング（得点＋FIFA）は #rankings（scope 非依存・一覧/詳細共通）で別途描画する。
    return `
      <p class="tl-legend-note">🟩 暫定通過圏（上位${ct.meta.advancePerGroup}） ／ 🎲 抽選 ／ カードをタップでそのグループの詳細（タイムライン）へ</p>
      <div class="overview-grid">${cards}</div>
      ${bt}`;
  }

  // ---- ランキング（得点＋FIFA）= 右レール（#rankings）。一覧・詳細で共通＝縦積み（得点→FIFA） ----
  function rankingsHTML(view: RenderView): string {
    return `<div class="rankings-stack">`
      + `<div class="rankings-panel" id="top-scorers">${topScorersHTML(view.scorers ?? [])}</div>`
      + `<div class="rankings-panel" id="fifa-ranking">${fifaRankingHTML(view.group)}</div>`
      + `</div>`;
  }

  // ---- タイムライン（主役・順位バンプチャート: x=イベント時系列, y=順位, 線=各国の推移） ----
  // 線にすることで全節が1画面に収まり、各国の軌跡を一目で追える（旧: 横スクロールする国旗の格子）。
  // engine の Snapshot[]（各列の standings 並び＝位置）をそのまま座標列に使う＝engine は不変。
  // 線色は各国の国旗の色から算出（flagColors.ts）。同組で近すぎる色は ΔE で検出し段階的にずらす。
  const rawTc = (id: string) => tricode(team(id));
  // ツールチップ用の素の国名（最後に esc される）。
  const rawName = (id: string) => team(id).name;

  // 節末スナップの試合結果を1行に: "メキシコ 2-0 南アフリカ ／ 韓国 2-1 チェコ"。
  const roundResultText = (snap: Snapshot): string =>
    (snap.roundResults ?? [])
      .map((r) => `${rawName(r.homeId)} ${r.homeScore}-${r.awayScore} ${rawName(r.awayId)}`)
      .join(" ／ ");

  // 頂点ツールチップ: 「国名・順位｜（ゴール）クロック スコア（得点者）／（節末）第n節 終了 試合結果」。
  function tipText(tid: string, snap: Snapshot, scoring: boolean): string {
    const pos = snap.standings.rows.findIndex((r) => r.teamId === tid) + 1;
    let s = `${team(tid).name}・${pos}位`;
    if (snap.kind === "roundEnd") {
      s += `｜${snap.clockLabel}　${roundResultText(snap)}`;
    } else if (snap.event) {
      const e = snap.event;
      s += `｜${snap.clockLabel} ${rawName(e.homeId)} ${e.homeScore}-${e.awayScore} ${rawName(e.awayId)}`;
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

    // 色は各国の国旗の色から算出（同組内で判別可能に分離）。最終順位順で割当＝決定的。
    const finalOrder = posByCol[cols - 1];
    const colorOf = assignGroupColors(finalOrder, flagColors as FlagPalette);
    // 最終的に通過圏（上位 adv）に入る国＝主役として強調、圏外＝淡く（selective highlighting）。
    const advancingSet = new Set(finalOrder.slice(0, adv));

    // ジオメトリ（SVG ユーザー単位・幅1000固定で width:100% スケール）
    const VBW = 1000;
    const mL = 36;
    const mR = 132;
    const mT = 36;
    const mB = 16;
    const rowGap = 72; // レーン分離を確保（全幅化と相乗で交差が読みやすい）
    const plotL = mL;
    const plotR = VBW - mR;
    const plotT = mT;
    const plotB = plotT + rowGap * (teamCount - 1);
    const VBH = plotB + mB;
    // x座標: 列ごとに1単位進み、節末列の直後にガター(GUT)を足す＝そのガターに節結果スコアを置く。
    // 最終列が節末ならその右にもガターを残し、右端ラベルとの間にスコアを収める。
    // ガターはスコアチップ（不透明）が線と重ならず収まる幅を確保する。
    const GUT = 3.4;
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
      const out = !advancingSet.has(tid); // 圏外＝淡く（主役を際立たせる）
      const oc = out ? " is-out" : "";
      const pts = posByCol.map((_, ci) => `${f1(xAt(ci))},${f1(yAt(idxByCol[ci].get(tid)!))}`).join(" ");
      lines += `<polyline class="tl-line${oc}" data-team="${tid}" points="${pts}" style="stroke:${color}" />`;
      for (let ci = 0; ci < cols; ci++) {
        const snap = snaps[ci];
        const e = snap.event;
        const scorerId = e && e.scorerSide ? (e.scorerSide === "home" ? e.homeId : e.awayId) : undefined;
        const scoring = scorerId === tid;
        const isRE = snap.kind === "roundEnd";
        // 得点点は前半/後半を問わず一律で強調丸（is-scorer）。
        const cls = `tl-dot${scoring ? " is-scorer" : ""}${isRE ? " is-roundend" : ""}${oc}`;
        const r = scoring ? 5 : isRE ? 4 : 3;
        // 節末は色付きの中空リング（チェックポイント）、ゴールは塗りつぶし。
        const dotStyle = isRE ? `fill:var(--surface);stroke:${color}` : `fill:${color}`;
        lines += `<circle class="${cls}" data-team="${tid}" cx="${f1(xAt(ci))}" cy="${f1(yAt(idxByCol[ci].get(tid)!))}" r="${r}" style="${dotStyle}"><title>${tipText(tid, snap, scoring)}</title></circle>`;
      }
      const fy = yAt(idxByCol[cols - 1].get(tid)!);
      lines += `<text class="tl-endlabel${oc}" data-team="${tid}" x="${f1(plotR + 12)}" y="${f1(fy)}" dominant-baseline="middle"><tspan class="tl-end-flag">${team(tid).flag}</tspan><tspan class="tl-end-code" dx="4" style="fill:${color}">${tn(tid)}</tspan></text>`;
    }

    // 節結果スコア: 各試合のスコアを「対戦した両チームそれぞれのレーン上」に置く＝1スコアが両レーンに2回出る。
    // 各レーンに「そのチームが戦った試合結果」が乗るので、対戦していない第3チームのレーンと重ならない（中点方式の紛らわしさを解消）。
    // 4チーム×1試合＝節ごと2試合→4チップ。レーンは rowGap=72 間隔・チップ高 18 なので縦に重ならない。
    // 両トリコードを各チームの線色で色分け＝乗っているレーン＋色で「自分の試合」が読める。等幅フォント(13px)でチップ幅を概算＝決定的。
    // レーンの当該チームは常に左（自分視点のスコア）＝away 側のレーンでは home/away を反転して描く。
    let roundScores = "";
    const CHAR_W = 7.4;
    const CHIP_H = 18;
    for (let ci = 0; ci < cols; ci++) {
      const snap = snaps[ci];
      if (snap.kind !== "roundEnd" || !snap.roundResults) continue;
      // 節末列は全レーンに is-roundend リング（cx=xAt(ci)）が出るので、被らないよう +12 右へずらす。
      const x = xAt(ci) + 12;
      const idx = idxByCol[ci];
      for (const rr of snap.roundResults) {
        for (const tid of [rr.homeId, rr.awayId]) {
          const pos = idx.get(tid);
          if (pos == null) continue;
          // 自分のレーンには「自分を左」に置く＝tid が away 側ならスコア・並びを反転（自分視点）。
          const selfHome = tid === rr.homeId;
          const selfId = tid;
          const oppId = selfHome ? rr.awayId : rr.homeId;
          const selfScore = selfHome ? rr.homeScore : rr.awayScore;
          const oppScore = selfHome ? rr.awayScore : rr.homeScore;
          const inner = `<tspan style="fill:${colorOf.get(selfId)!}">${esc(rawTc(selfId))}</tspan> ${selfScore}-${oppScore} <tspan style="fill:${colorOf.get(oppId)!}">${esc(rawTc(oppId))}</tspan>`;
          const w = (rawTc(selfId).length + rawTc(oppId).length + 5) * CHAR_W + 12;
          const cy = yAt(pos);
          roundScores += `<rect class="tl-round-chip" x="${f1(x - 5)}" y="${f1(cy - 9)}" width="${f1(w)}" height="${CHIP_H}" rx="4" />`;
          roundScores += `<text class="tl-round-score" x="${f1(x)}" y="${f1(cy)}" dominant-baseline="middle" text-anchor="start">${inner}</text>`;
        }
      }
    }

    const aria = `グループ${view.group}の順位推移。縦軸=順位（上が1位・上位${adv}が通過圏）、横軸=時系列。色付きの線が各国の順位の動き。節末に各試合の結果。`;
    const svg = `<svg class="tl-chart" viewBox="0 0 ${VBW} ${VBH}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMid meet">${band}${lanes}${mdBands}${lines}${roundScores}</svg>`;

    // 凡例（色→国旗→和名→最終順位）= チャートの色対応＆名前を補う
    const legend = finalOrder
      .map(
        (tid, i) =>
          `<span class="tl-leg-item" data-team="${tid}"><span class="tl-leg-swatch" style="background:${colorOf.get(tid)}"></span>${team(tid).flag}<span class="tl-leg-name">${esc(team(tid).name)}</span><span class="tl-leg-rank">${i + 1}位</span></span>`,
      )
      .join("");

    // 得点タイムラインを「節カラム」に: 節ごとに1列（見出し→ゴール→第n節結果）を横並び＝全幅を使い高さを圧縮。
    // 得点ログ＝試合ごとのカラム（1節=2試合=2カラム）。matchId で集約し、節→試合id順に並べる。
    // ゴール行の左ボーダー＝得点国の線色でチャートの折れ線と対応づける。
    interface MatchLog { matchday: number; homeId: string; awayId: string; goals: string[]; home: number; away: number; hasResult: boolean }
    const byMatch = new Map<string, MatchLog>();
    const order: string[] = [];
    const ensure = (id: string, matchday: number, homeId: string, awayId: string): MatchLog => {
      let m = byMatch.get(id);
      if (!m) {
        m = { matchday, homeId, awayId, goals: [], home: 0, away: 0, hasResult: false };
        byMatch.set(id, m);
        order.push(id);
      }
      return m;
    };
    for (const s of snaps) {
      if (s.kind === "roundEnd") {
        for (const r of s.roundResults ?? []) {
          const m = ensure(r.matchId, s.matchday, r.homeId, r.awayId);
          m.home = r.homeScore;
          m.away = r.awayScore;
          m.hasResult = true;
        }
      } else if (s.event) {
        const e = s.event;
        const m = ensure(e.matchId, e.matchday, e.homeId, e.awayId);
        if (!m.hasResult) {
          m.home = e.homeScore;
          m.away = e.awayScore;
        }
        const scorerId = e.scorerSide === "home" ? e.homeId : e.awayId;
        const color = colorOf.get(scorerId) ?? "var(--border-strong)";
        const who = e.scorer ? `${team(scorerId).flag}${esc(e.scorer)}` : `${team(scorerId).flag}`;
        m.goals.push(
          `<li class="tlog-goal" style="border-left-color:${color}"><span class="tlog-time">${esc(s.clockLabel)}</span><span class="tlog-scorer">⚽${who}</span><span class="tlog-score">${tn(e.homeId)} ${e.homeScore}-${e.awayScore} ${tn(e.awayId)}</span></li>`,
        );
      }
    }
    // 節id順（matchId 昇順で各節2試合が並ぶ）→ 節ごとに2カラムをまとめる。
    order.sort((a, b) => {
      const ma = byMatch.get(a)!;
      const mb = byMatch.get(b)!;
      return ma.matchday - mb.matchday || (a < b ? -1 : a > b ? 1 : 0);
    });
    const mdGroups = new Map<number, string[]>();
    const mdOrder: number[] = [];
    for (const id of order) {
      const m = byMatch.get(id)!;
      if (!mdGroups.has(m.matchday)) {
        mdGroups.set(m.matchday, []);
        mdOrder.push(m.matchday);
      }
      const matchup = `${team(m.homeId).flag}${tn(m.homeId)} <b class="tlog-match-score">${m.home}-${m.away}</b> ${tn(m.awayId)}${team(m.awayId).flag}`;
      const goals = m.goals.length ? m.goals.join("") : `<li class="tlog-goal tlog-noscore">得点なし</li>`;
      mdGroups.get(m.matchday)!.push(
        `<div class="tlog-col"><p class="tlog-match">${matchup}</p><ol class="tlog-goals">${goals}</ol></div>`,
      );
    }
    const logCols = mdOrder
      .map((md) => `<div class="tlog-md-group"><p class="tlog-md-head">第${md}節</p><div class="tlog-md-cols">${mdGroups.get(md)!.join("")}</div></div>`)
      .join("");
    // 常設（折りたたみ廃止）。「誰が・何分に」を試合カラムで常に見せる。
    const goalCount = snaps.filter((s) => s.kind !== "roundEnd" && s.event).length;
    const log = `<section class="tl-log"><p class="tl-log-head">得点タイムライン<span class="tl-log-count">全${goalCount}ゴール</span></p><div class="tlog-cols">${logCols}</div></section>`;

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
    // 未消化試合が残るうちは暫定（全消化＝グループステージ確定なら注記を出さない）。
    const partial = ct.groups.some((g) => ct.matchesByGroup.get(g)!.some((m) => m.score == null));
    const rows = shown
      .map(
        (e) =>
          `<tr><td class="col-rank"><span class="rank-badge">${e.rank}</span></td>
            <td class="col-team"><span class="team-cell"><span class="team-flag">${team(e.teamId).flag}</span><span class="team-name">${esc(e.player)}</span><span class="ts-team">${tn(e.teamId)}</span></span></td>
            <td class="ts-goals tnum">${e.goals}${e.pk ? `<span class="ts-pk">PK${e.pk}</span>` : ""}</td>
          </tr>`,
      )
      .join("");
    const note = partial
      ? `<p class="site-sub bt-note">⚠️ グループステージ進行中のため<b>暫定</b>（消化済み試合のみ）。</p>`
      : "";
    // KO結果が入っている大会は「グループ＋決勝T」、無ければ従来表記。
    const scopeLabel = ct.knockout.length > 0 ? "グループ＋決勝トーナメント" : "グループステージ";
    return `
      <h2 class="section-title">得点ランキング <span class="hint">大会全体（${scopeLabel}）の得点者</span></h2>
      ${note}
      <div class="card ts-card tnum">
        <table class="ts-table">
          <thead><tr><th class="col-rank">順</th><th class="col-team">選手</th><th class="ts-goals">得点</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ---- FIFAランキング（その大会時点の世界ランキング全カ国・出場国を強調） ----
  // ランキング値の「時点」ラベル（大会直前のスナップショット。データは fifa-rankings.json）。
  const FIFA_AS_OF: Record<Cup, string> = { "2018": "2018年6月", "2022": "2022年10月", "2026": "2026年6月" };
  function fifaRankingHTML(currentGroup: GroupId): string {
    const list = fifaRankingsByCup[cup] ?? [];
    if (list.length === 0) return "";
    const rowHTML = (e: FifaRankRow): string => {
      const t = ct.teamsById.get(e.code); // 出場国なら team（旗/国名は team データを正とする）
      const isPart = !!t;
      const cur = isPart && t!.group === currentGroup;
      const flag = isPart ? t!.flag : e.flag;
      const name = isPart ? t!.name : e.name;
      // 出場国は強調(.is-team)＋data-team でホバー連動。非出場国は淡色(.is-out)。現在の組は .is-current。
      const cls = `fr-row${isPart ? " is-team" : " is-out"}${cur ? " is-current" : ""}`;
      const dt = isPart ? ` data-team="${e.code}"` : "";
      const grp = isPart ? `<span class="fr-grp-badge">${t!.group}</span>` : "";
      return `<tr class="${cls}"${dt}>
            <td class="fr-rank">${e.rank}</td>
            <td class="col-team"><span class="team-cell"><span class="team-flag">${flag}</span><span class="team-name">${esc(name)}</span><span class="fr-code">${esc(e.code.toUpperCase())}</span></span></td>
            <td class="fr-grp">${grp}</td>
          </tr>`;
    };
    // 出場国の最下位順位まで常時表示・以降（出場国より下位）は折りたたむ。
    const partRanks = list.filter((e) => ct.teamsById.has(e.code)).map((e) => e.rank);
    const partCount = partRanks.length;
    const lastPartRank = partRanks.length ? Math.max(...partRanks) : list[list.length - 1].rank;
    const shown = list.filter((e) => e.rank <= lastPartRank);
    const rest = list.filter((e) => e.rank > lastPartRank);
    const lastRank = list[list.length - 1].rank;
    const more = rest.length
      ? `<details class="fr-more"><summary class="fr-more-summary">以降の${rest.length}カ国（${lastPartRank + 1}位〜${lastRank}位・出場国なし）を表示</summary>
          <table class="fr-table fr-table-rest"><tbody>${rest.map(rowHTML).join("")}</tbody></table>
        </details>`
      : "";
    return `
      <h2 class="section-title">FIFAランキング <span class="hint">${FIFA_AS_OF[cup]}時点の世界ランキング（<b>出場${partCount}カ国を強調</b>・最下位${lastPartRank}位まで表示／以降は折りたたみ）</span></h2>
      <div class="card fr-card tnum">
        <table class="fr-table">
          <thead><tr><th class="fr-rank">順</th><th class="col-team">国</th><th class="fr-grp">組</th></tr></thead>
          <tbody>${shown.map(rowHTML).join("")}</tbody>
        </table>
        ${more}
      </div>`;
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

    // 日程・結果（左カラム最上部）・ランキング・決勝トーナメントは一覧/詳細で共通＝早期 return より前に更新。
    elSchedule.innerHTML = scheduleHTML(view);
    // 日程カルーセルを該当グループの最初の試合まで横スクロール（rect 差分＝ページ縦には影響しない）。
    // レイアウト確定後に測るため rAF 経由（jsdom では no-op＝テストに影響なし）。
    const car = elSchedule.querySelector<HTMLElement>(".sched-carousel");
    const curCard = elSchedule.querySelector<HTMLElement>(".sched-card[data-current]");
    if (car && curCard) {
      requestAnimationFrame(() => {
        car.scrollLeft += curCard.getBoundingClientRect().left - car.getBoundingClientRect().left - 16;
      });
    }
    elRankings.innerHTML = rankingsHTML(view);
    elKnockout.innerHTML = knockoutHTML(view);

    if (isOverview) {
      elOverview.innerHTML = overviewHTML(view);
      return; // detail 専用フィールドには触れない
    }

    // ---- detail（1グループ）。main.ts が detail のとき必ず渡す。 ----
    elCaption.textContent = `グループ ${view.group}`;
    elStandings.innerHTML = standingsHTML(view.standings!);
    elStatus.innerHTML = statusHTML(view.status!);
    elTimeline.innerHTML = timelineHTML(view);
  }

  return { render };
}
