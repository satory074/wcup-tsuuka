// ページごとの見出し・要約・<title>・meta description（純関数。DOM には触らない）。
// ビルド時の事前描画（<head> と本文の h1）と、ブラウザでのグループ切替（h1・document.title の更新）が
// 同じ関数を使う＝表示中の内容と <title>・説明文が食い違わない。
// 文言はすべてデータから計算した事実だけ（順位・決勝トーナメントの結果・最多得点）。評価や煽り文句は入れない。
import type { CompiledTournament, GroupId, KnockoutBracket, KoRound, Standings } from "../engine/types";
import type { ScorerEntry } from "../engine/scorers";
import type { Cup, Scope } from "./url";
import { DEFAULT_CUP } from "./url";

export const SITE_NAME = "WCUP 通過タイムライン";

/** 開催地の呼び名（見出し・説明文用）。 */
const CUP_PLACE: Record<Cup, string> = {
  "2018": "ロシア大会",
  "2022": "カタール大会",
  "2026": "北中米大会",
};
/** 「2022 カタール大会」 */
export const cupName = (cup: Cup): string => `${cup} ${CUP_PLACE[cup]}`;

export interface PageInfo {
  /** <title> */
  title: string;
  /** meta description */
  description: string;
  /** ページの h1（画面に出す） */
  heading: string;
  /** 見出し直下の要約 1〜2 文（画面に出す） */
  summary: string;
}

export interface PageInput {
  ct: CompiledTournament;
  cup: Cup;
  scope: Scope;
  group: GroupId;
  standingsByGroup: Map<GroupId, Standings>;
  knockout?: KnockoutBracket;
  scorers?: ScorerEntry[];
}

const KO_EXIT: Record<KoRound, string> = {
  R32: "ラウンド32で敗退",
  R16: "ラウンド16で敗退",
  QF: "準々決勝で敗退",
  SF: "準決勝で敗退",
  "3P": "大会4位",
  F: "準優勝",
};

/** 決勝トーナメントでの最終成績（優勝／準優勝／大会3位／大会4位／◯◯で敗退）。まだ決着していなければ null。 */
function koOutcome(ko: KnockoutBracket | undefined, teamId: string): string | null {
  if (!ko) return null;
  let exit: KoRound | null = null;
  for (const m of ko.matches) {
    const side = m.side1.teamId === teamId ? 1 : m.side2.teamId === teamId ? 2 : 0;
    if (side === 0) continue;
    if (!m.result) return null; // 未消化の試合が残る＝成績未確定
    const won = m.result.winnerSide === side;
    if (m.round === "F") return won ? "優勝" : "準優勝";
    if (m.round === "3P") return won ? "大会3位" : "大会4位";
    if (!won) exit = m.round;
  }
  // 準決勝で負けても 3位決定戦があればそちらで決まる（上の 3P 分岐）。ここに来るのは R32〜QF の敗退か、3決データ無し。
  return exit ? KO_EXIT[exit] : null;
}

/** 決勝トーナメント最初のラウンドに名前が入っているチーム＝進出が確定したチーム。 */
function koEntrants(ko: KnockoutBracket | undefined): Set<string> {
  const out = new Set<string>();
  if (!ko || ko.rounds.length === 0) return out;
  const first = ko.rounds[0];
  for (const m of ko.matches) {
    if (m.round !== first) continue;
    if (m.side1.teamId) out.add(m.side1.teamId);
    if (m.side2.teamId) out.add(m.side2.teamId);
  }
  return out;
}

export function pageInfo(p: PageInput): PageInfo {
  const { ct, cup, scope, group } = p;
  const name = (id: string) => ct.teamsById.get(id)!.name;
  const cupFull = cupName(cup);
  const place = CUP_PLACE[cup];
  const groupCount = ct.groups.length;
  const teamCount = ct.teamsById.size;
  const matchCount = ct.groups.reduce((n, g) => n + (ct.matchesByGroup.get(g)?.length ?? 0), 0);

  if (scope === "detail") {
    const st = p.standingsByGroup.get(group)!;
    const matches = ct.matchesByGroup.get(group) ?? [];
    const played = matches.filter((m) => m.score != null);
    const goals = played.reduce((n, m) => n + m.score!.home + m.score!.away, 0);
    const done = played.length === matches.length;
    const order = st.rows.map((r) => `${r.rank}位 ${name(r.teamId)}`).join("、");
    const teams = st.rows.map((r) => name(r.teamId)).join("・");

    let summary = done
      ? `最終順位は ${order}（全${matches.length}試合・${goals}得点）。`
      : `暫定順位は ${order}（${played.length}/${matches.length}試合消化）。`;
    const entrants = koEntrants(p.knockout);
    const adv = st.rows.filter((r) => entrants.has(r.teamId));
    if (adv.length > 0) {
      const list = adv
        .map((r) => {
          const o = koOutcome(p.knockout, r.teamId);
          return o ? `${name(r.teamId)}（${o}）` : name(r.teamId);
        })
        .join("・");
      summary += `決勝トーナメント進出: ${list}。`;
    }
    const top = st.rows.filter((r) => r.rank <= ct.meta.advancePerGroup).map((r) => `${r.rank}位 ${name(r.teamId)}`).join("・");
    return {
      title: `${cup} W杯 グループ${group}の順位推移（${teams}）｜${SITE_NAME}`,
      description:
        `FIFAワールドカップ ${cupFull} グループ${group}（${teams}）の全${matches.length}試合を、得点のたびに変わる順位の推移と得点者つきの試合経過で振り返る。` +
        (done ? `最終順位は${top}。` : `${played.length}/${matches.length}試合消化時点の暫定順位。`),
      heading: `${cupFull} グループ${group}`,
      summary,
    };
  }

  // ---- 一覧（大会全体） ----
  let summary = `全${groupCount}グループ・${matchCount}試合の最終順位と、得点ごとの順位推移・決勝トーナメントの結果。`;
  const fin = p.knockout?.matches.find((m) => m.round === "F");
  if (fin?.result && fin.side1.teamId && fin.side2.teamId) {
    const r = fin.result;
    const [w, l] = r.winnerSide === 1 ? [fin.side1.teamId, fin.side2.teamId] : [fin.side2.teamId, fin.side1.teamId];
    const [ws, ls] = r.winnerSide === 1 ? [r.side1Score, r.side2Score] : [r.side2Score, r.side1Score];
    const so = r.shootout ? `（PK ${r.winnerSide === 1 ? `${r.shootout.side1}-${r.shootout.side2}` : `${r.shootout.side2}-${r.shootout.side1}`}）` : "";
    summary += `決勝は${name(w)}が${ws}-${ls}${so}で${name(l)}を下して優勝。`;
  }
  const leaders = (p.scorers ?? []).filter((s) => s.rank === 1);
  if (leaders.length > 0) {
    summary += `最多得点は${leaders.map((s) => `${s.player}（${name(s.teamId)}）`).join("・")}の${leaders[0].goals}点。`;
  }
  const isTop = cup === DEFAULT_CUP;
  return {
    title: isTop
      ? `${SITE_NAME}｜${cup} W杯 ${place} 全${groupCount}グループの順位推移`
      : `${cup} W杯 ${place} 全${groupCount}グループの順位推移｜${SITE_NAME}`,
    description: isTop
      ? `ワールドカップのグループステージで、得点の瞬間ごとに順位と通過国がどう入れ替わったかを時系列で可視化。${cupFull}（${teamCount}カ国・${groupCount}組）の全グループと決勝トーナメントのほか、2018 ロシア大会・2022 カタール大会も収録。`
      : `FIFAワールドカップ ${cupFull}（${teamCount}カ国・${groupCount}組）の全${groupCount}グループの最終順位、グループステージ${matchCount}試合の得点ごとの順位推移、決勝トーナメントの組み合わせと結果。`,
    heading: `${cupFull} 全${groupCount}グループ`,
    summary,
  };
}
