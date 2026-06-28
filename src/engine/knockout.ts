// 決勝トーナメント（ノックアウト）ブラケット。純TS・DOM/Date/乱数なし・決定的。
//
// テンプレート（誰の枠が誰と当たるか）はフォーマット由来の固定データ:
//   - 12組（2026方式）= Round of 32（M73-104）。出典: Wikipedia "2026 FIFA World Cup knockout stage"。
//   - 8組（2018/2022方式）= Round of 16。標準32カ国ブラケットのツリー。
// スロット→チームは standings / best-thirds から解決する（捏造しない）。確定していない枠は
// teamId を付けず undecided=true でスロットラベルのまま返す。
//   - winner/runnerup: 対象組が全消化済みで当該順位が単独確定のときのみ実チーム。
//   - third: 「勝者 vs 3位」枠は対象グループ集合のラベルのまま（FIFA 495通り組合せ表は未実装＝割当しない）。
//   - winnerOf/loserOf: KO戦の結果が当データに無いため常に未確定（"M75 勝者" 等のラベル）。
import type {
  CompiledTournament,
  GroupId,
  KnockoutBracket,
  KnockoutResult,
  KoMatch,
  KoResolvedMatch,
  KoRound,
  KoSide,
  KoSlot,
  Standings,
} from "./types";

// ---- スロット構築ヘルパ ----
const W = (group: GroupId): KoSlot => ({ kind: "winner", group });
const R = (group: GroupId): KoSlot => ({ kind: "runnerup", group });
const T = (groups: GroupId[]): KoSlot => ({ kind: "third", groups });
const WO = (matchId: string): KoSlot => ({ kind: "winnerOf", matchId });
const LO = (matchId: string): KoSlot => ({ kind: "loserOf", matchId });

const mk = (id: string, round: KoRound, slot1: KoSlot, slot2: KoSlot, no?: string): KoMatch => ({
  id,
  round,
  no,
  slot1,
  slot2,
});

/** 2026 方式: Round of 32（M73-88）→ R16(89-96) → QF(97-100) → SF(101-102) → 3決(103) → 決勝(104）。 */
export const R32_2026: KoMatch[] = [
  mk("73", "R32", R("A"), R("B"), "73"),
  mk("74", "R32", W("E"), T(["A", "B", "C", "D", "F"]), "74"),
  mk("75", "R32", W("F"), R("C"), "75"),
  mk("76", "R32", W("C"), R("F"), "76"),
  mk("77", "R32", W("I"), T(["C", "D", "F", "G", "H"]), "77"),
  mk("78", "R32", R("E"), R("I"), "78"),
  mk("79", "R32", W("A"), T(["C", "E", "F", "H", "I"]), "79"),
  mk("80", "R32", W("L"), T(["E", "H", "I", "J", "K"]), "80"),
  mk("81", "R32", W("D"), T(["B", "E", "F", "I", "J"]), "81"),
  mk("82", "R32", W("G"), T(["A", "E", "H", "I", "J"]), "82"),
  mk("83", "R32", R("K"), R("L"), "83"),
  mk("84", "R32", W("H"), R("J"), "84"),
  mk("85", "R32", W("B"), T(["E", "F", "G", "I", "J"]), "85"),
  mk("86", "R32", W("J"), R("H"), "86"),
  mk("87", "R32", W("K"), T(["D", "E", "I", "J", "L"]), "87"),
  mk("88", "R32", R("D"), R("G"), "88"),
  // Round of 16
  mk("89", "R16", WO("74"), WO("77"), "89"),
  mk("90", "R16", WO("73"), WO("75"), "90"),
  mk("91", "R16", WO("76"), WO("78"), "91"),
  mk("92", "R16", WO("79"), WO("80"), "92"),
  mk("93", "R16", WO("83"), WO("84"), "93"),
  mk("94", "R16", WO("81"), WO("82"), "94"),
  mk("95", "R16", WO("86"), WO("88"), "95"),
  mk("96", "R16", WO("85"), WO("87"), "96"),
  // Quarter-finals
  mk("97", "QF", WO("89"), WO("90"), "97"),
  mk("98", "QF", WO("93"), WO("94"), "98"),
  mk("99", "QF", WO("91"), WO("92"), "99"),
  mk("100", "QF", WO("95"), WO("96"), "100"),
  // Semi-finals
  mk("101", "SF", WO("97"), WO("98"), "101"),
  mk("102", "SF", WO("99"), WO("100"), "102"),
  // 3位決定戦 / 決勝
  mk("103", "3P", LO("101"), LO("102"), "103"),
  mk("104", "F", WO("101"), WO("102"), "104"),
];

/** 2018/2022 方式: Round of 16（標準32カ国ブラケットのツリー）。試合番号は大会で割当が異なるため付けない。 */
export const R16_8GROUP: KoMatch[] = [
  // 上半: (1A-2B,1C-2D)→QF→SF1 と (1E-2F,1G-2H)→QF
  mk("r16-1", "R16", W("A"), R("B")),
  mk("r16-2", "R16", W("C"), R("D")),
  mk("r16-3", "R16", W("E"), R("F")),
  mk("r16-4", "R16", W("G"), R("H")),
  // 下半: (1B-2A,1D-2C) と (1F-2E,1H-2G)
  mk("r16-5", "R16", W("B"), R("A")),
  mk("r16-6", "R16", W("D"), R("C")),
  mk("r16-7", "R16", W("F"), R("E")),
  mk("r16-8", "R16", W("H"), R("G")),
  // Quarter-finals
  mk("qf-1", "QF", WO("r16-1"), WO("r16-2")),
  mk("qf-2", "QF", WO("r16-3"), WO("r16-4")),
  mk("qf-3", "QF", WO("r16-5"), WO("r16-6")),
  mk("qf-4", "QF", WO("r16-7"), WO("r16-8")),
  // Semi-finals
  mk("sf-1", "SF", WO("qf-1"), WO("qf-2")),
  mk("sf-2", "SF", WO("qf-3"), WO("qf-4")),
  // 3位決定戦 / 決勝
  mk("3p", "3P", LO("sf-1"), LO("sf-2")),
  mk("f", "F", WO("sf-1"), WO("sf-2")),
];

const ROUND_ORDER: KoRound[] = ["R32", "R16", "QF", "SF", "3P", "F"];

/** 大会フォーマット（組数）からブラケットテンプレートを選ぶ（数のハードコードを避け構造で分岐）。 */
export function bracketTemplate(ct: CompiledTournament): KoMatch[] {
  return ct.groups.length >= 12 ? R32_2026 : R16_8GROUP;
}

/** 組が全消化済みか（各チーム3試合）。 */
function groupComplete(st: Standings): boolean {
  return st.rows.every((r) => r.played === 3);
}

/** 指定 rank（1 or 2）のチームが「全消化済みかつ単独確定」なら teamId、そうでなければ未確定。 */
function resolveRank(
  st: Standings | undefined,
  group: GroupId,
  rank: 1 | 2,
): KoSide {
  const label = `${rank}${group}`; // "1A" / "2B"
  if (!st || !groupComplete(st)) return { label, undecided: true };
  const atRank = st.rows.filter((r) => r.rank === rank);
  if (atRank.length === 1) return { teamId: atRank[0].teamId, label, undecided: false };
  return { label, undecided: true }; // タイ/欠落＝抽選待ち
}

function noOf(matchId: string, template: KoMatch[]): string {
  return template.find((m) => m.id === matchId)?.no ?? "";
}

/** 4チーム総当りと同じ無向ペアキー（KO結果データをスロット解決後のチームと突き合わせる）。 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function resolveSlot(
  slot: KoSlot,
  standingsByGroup: Map<GroupId, Standings>,
  template: KoMatch[],
  winnerById: Map<string, string>,
  loserById: Map<string, string>,
  third?: string,
): KoSide {
  switch (slot.kind) {
    case "winner":
      return resolveRank(standingsByGroup.get(slot.group), slot.group, 1);
    case "runnerup":
      return resolveRank(standingsByGroup.get(slot.group), slot.group, 2);
    case "third":
      // 確定済みの3位割当（knockoutSchedule.third）があれば実チームに。無ければ集合ラベルのまま。
      if (third) return { teamId: third, label: `3位 ${slot.groups.join("/")}`, undecided: false };
      return { label: `3位 ${slot.groups.join("/")}`, undecided: true };
    case "winnerOf": {
      const no = noOf(slot.matchId, template);
      const tid = winnerById.get(slot.matchId);
      // KO結果がある（完了大会）なら勝者を実チームに解決。無ければ未確定ラベル。
      if (tid) return { teamId: tid, label: no ? `M${no} 勝者` : "勝者", undecided: false };
      return { label: no ? `M${no} 勝者` : "勝者", undecided: true };
    }
    case "loserOf": {
      const no = noOf(slot.matchId, template);
      const tid = loserById.get(slot.matchId);
      if (tid) return { teamId: tid, label: no ? `M${no} 敗者` : "敗者", undecided: false };
      return { label: no ? `M${no} 敗者` : "敗者", undecided: true };
    }
  }
}

/**
 * standings＋KO結果データから決勝トーナメントのブラケットを解決する。
 * テンプレートを依存順（R32→R16→…）に1パスで処理し、各試合の勝者/敗者を winnerById/loserById に
 * 蓄積して winnerOf/loserOf を解決する。KO結果（ct.knockout）はスロット解決後のチームペアで突き合わせる。
 * KO結果が無い大会（2026）は winnerOf/loserOf が常に未確定＝従来どおり（不変）。
 * best-thirds の暫定通過プールは描画側が view.bestThirds から流用する（ここでは割当しない）。
 */
export function computeKnockout(
  ct: CompiledTournament,
  standingsByGroup: Map<GroupId, Standings>,
): KnockoutBracket {
  const template = bracketTemplate(ct);
  const resultByPair = new Map<string, KnockoutResult>();
  for (const r of ct.knockout) resultByPair.set(pairKey(r.home, r.away), r);

  const winnerById = new Map<string, string>();
  const loserById = new Map<string, string>();

  // template は依存順（前ラウンドが先）なので map の逐次実行で winnerById が間に合う。
  const matches: KoResolvedMatch[] = template.map((m) => {
    const sched = ct.knockoutSchedule?.get(m.id);
    const side1 = resolveSlot(m.slot1, standingsByGroup, template, winnerById, loserById, sched?.third);
    const side2 = resolveSlot(m.slot2, standingsByGroup, template, winnerById, loserById, sched?.third);
    let result: KoResolvedMatch["result"] | undefined;
    if (side1.teamId && side2.teamId) {
      const r = resultByPair.get(pairKey(side1.teamId, side2.teamId));
      if (r) {
        const s1IsHome = side1.teamId === r.home;
        const winnerId = r.winner === "home" ? r.home : r.away;
        const loserId = r.winner === "home" ? r.away : r.home;
        winnerById.set(m.id, winnerId);
        loserById.set(m.id, loserId);
        result = {
          side1Score: s1IsHome ? r.score.home : r.score.away,
          side2Score: s1IsHome ? r.score.away : r.score.home,
          winnerSide: winnerId === side1.teamId ? 1 : 2,
          shootout: r.shootout
            ? {
                side1: s1IsHome ? r.shootout.home : r.shootout.away,
                side2: s1IsHome ? r.shootout.away : r.shootout.home,
              }
            : undefined,
        };
      }
    }
    return { id: m.id, round: m.round, no: m.no, kickoff: sched?.kickoff, side1, side2, result };
  });

  const present = new Set(template.map((m) => m.round));
  const rounds = ROUND_ORDER.filter((r) => present.has(r));
  return { rounds, matches };
}
