// 全エンジンが共有する型。DOM・Date 非依存。
// worldcup2022.json の生スキーマ（Tournament 配下）と、実行時の派生型をここに集約する。

// A–H は 2022方式（8組）、A–L は 2026方式（12組）。GROUP_IDS は「妥当な組レターの宇宙」で、
// 大会ごとの実際の組は compile が宣言（teams/groups）から導出する（GROUP_IDS を直接ループしない）。
export type GroupId =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";
export const GROUP_IDS: readonly GroupId[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
];

export interface Points {
  win: number;
  draw: number;
  loss: number;
}

export interface Meta {
  title: string;
  edition: string;
  /** 各組から決勝トーナメントへ進む数（2022方式は2） */
  advancePerGroup: number;
  /** 全組の3位から追加で通過する数（2022=未指定→0 / 2026=8）。省略時は0。 */
  advanceBestThirds?: number;
  points: Points;
  /** 会場のUTCオフセット（大会ベース・時間）。表示のJST変換用。2018/2022=3(UTC+3)・2026=-4(米東部EDT)。会場が違う試合は matches[].tz / knockoutSchedule[].tz で上書き。省略時は変換なし扱い。 */
  utcOffset?: number;
  dataLastUpdated: string;
  source: string;
  disclaimer: string;
}

export interface Team {
  /** 小文字 FIFA トリコード（例: "ned"）。表示用トリコードは大文字化して使う */
  id: string;
  name: string;
  nameEn: string;
  group: GroupId;
  /** 国旗絵文字 */
  flag: string;
  /** FIFA世界ランキング順位（任意・正の整数）。大会ごとの時点（2022=大会直前 / 2026=最新）。 */
  fifaRank?: number;
}

export interface GroupDef {
  id: GroupId;
  teamIds: string[];
}

export interface Score {
  home: number;
  away: number;
}

export interface Cards {
  /** イエロー枚数 */
  y: number;
  /** レッド枚数 */
  r: number;
}

export type GoalSide = "home" | "away";

export interface Goal {
  /** 試合の経過分（0..120 の整数） */
  minute: number;
  /** アディショナルタイム（"45+2" の +2。任意・非負整数） */
  plus?: number;
  /** 得点した側（オウンゴールは得点が入る側＝利益を得た側を入れる） */
  side: GoalSide;
  /** 得点選手名（任意）。日本選手=漢字、他=カタカナ、オウンゴールは "名前(OG)" */
  player?: string;
}

export interface Match {
  /** "<group>-<n>" 例: "A-1" */
  id: string;
  group: GroupId;
  matchday: 1 | 2 | 3;
  /** キックオフ日時（ISO 現地＝会場ローカル時間 "2022-11-23T16:00"）。タイムラインの絶対時刻並べ替え用 */
  kickoff?: string;
  /** 会場のUTCオフセット（時間）。meta.utcOffset と違う会場のみ指定（2026の非東部会場＝太平洋-7/中部-5/メキシコ-6）。表示のJST変換用で順位計算には無関係。 */
  tz?: number;
  /** チームid（行＝home） */
  home: string;
  /** チームid（列＝away） */
  away: string;
  /** 未消化なら省略 or null */
  score?: Score | null;
  /** フェアプレー算出用。無ければ未適用 */
  cards?: { home: Cards; away: Cards };
  /** 得点イベント（分刻みタイムライン用）。あれば本数は score と一致必須 */
  goals?: Goal[];
}

/** 決勝トーナメント（ノックアウト）の実結果。完了大会（2018/2022）のみ。2026 は未実施＝省略。 */
export interface KnockoutResult {
  /** ラウンド（"R16".."F"）。テンプレートのラウンドと一致。 */
  round: KoRound;
  /** 対戦チーム id（順不同。テンプレートのスロット解決とペアで突き合わせる） */
  home: string;
  away: string;
  /** 90分＋延長の得点（PK戦のキックは含めない）。 */
  score: Score;
  /** 勝ち上がったのは home か away か（PK戦決着も含めここで確定）。 */
  winner: GoalSide;
  /** PK戦の結果（任意。あれば score は引分でも可）。 */
  shootout?: Score;
  /** 得点イベント（得点ランキング集計用）。あれば本数は score と一致必須。 */
  goals?: Goal[];
}

/**
 * 決勝トーナメントの日程（試合ごとのキックオフ）。結果（KnockoutResult）とは別系統で、
 * テンプレート（bracketTemplate）の KoMatch.id をキーに結ぶ。未消化の大会（2026）でも
 * 日程だけ先に持てる＝「日程・結果」やブラケットに日付を出すための任意データ。
 */
export interface KnockoutScheduleEntry {
  /** テンプレ KoMatch.id（2026="73".."104" / 2018・2022="r16-1".."f"）。 */
  id: string;
  /** キックオフ日時（ISO 現地＝会場ローカル。2018 は MSK 正規化）。 */
  kickoff: string;
  /** 会場のUTCオフセット（時間）。meta.utcOffset と違う会場のみ指定。表示のJST変換用。 */
  tz?: number;
  /** 2026 R32 の「3位枠（slot=third）」に入る実チーム teamId（確定済みの割当・8件のみ）。 */
  third?: string;
}

/** 生 JSON のルート（= worldcup2022.json） */
export interface Tournament {
  meta: Meta;
  teams: Team[];
  groups: GroupDef[];
  matches: Match[];
  /** 決勝トーナメントの実結果（任意。完了大会のみ）。 */
  knockout?: KnockoutResult[];
  /** 決勝トーナメントの日程（任意。試合ごとの kickoff＋2026 の3位割当）。 */
  knockoutSchedule?: KnockoutScheduleEntry[];
}

/** 検証後にインデックス化した実行時表現 */
export interface CompiledTournament {
  meta: Meta;
  teamsById: Map<string, Team>;
  groups: GroupId[];
  teamsByGroup: Map<GroupId, Team[]>;
  matchesByGroup: Map<GroupId, Match[]>;
  /** 決勝トーナメントの実結果（無ければ空配列）。 */
  knockout: KnockoutResult[];
  /** 決勝トーナメントの日程（テンプレ KoMatch.id キー。無ければ空 Map）。 */
  knockoutSchedule: Map<string, KnockoutScheduleEntry>;
}

/** 仮定スコア・マトリックスのピボットなどで「この試合はこのスコア」を上書きする */
export interface ResultOverride {
  matchId: string;
  score: Score;
}

/** 1チームの順位表 1 行 */
export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  /** 1..4（タイブレーク後の最終順位。未決着クラスタは同順位を共有） */
  rank: number;
  /** rank <= advancePerGroup */
  advances: boolean;
  /** 抽選でしか決まらない並びのとき、その同順位クラスタを識別するキー */
  tiedGroupKey?: string;
}

export interface Standings {
  group: GroupId;
  /** rank 昇順 */
  rows: StandingRow[];
  /** 抽選（drawing of lots）でしか決着しない並びが残ったか */
  undecided: boolean;
}

// ---- 決勝トーナメント（ノックアウト）ブラケット ----
// テンプレート（スロット定義）はエンジン定数。チームは standings/best-thirds から解決する（捏造しない）。

export type KoRound = "R32" | "R16" | "QF" | "SF" | "3P" | "F";

/** ブラケットの片側スロット（チーム未解決の定義） */
export type KoSlot =
  | { kind: "winner"; group: GroupId } // 組1位
  | { kind: "runnerup"; group: GroupId } // 組2位
  | { kind: "third"; groups: GroupId[] } // 対象組の最良3位（割当はしない＝集合のまま）
  | { kind: "winnerOf"; matchId: string } // 前ラウンドの勝者
  | { kind: "loserOf"; matchId: string }; // 前ラウンドの敗者（3決用）

/** ブラケットのテンプレート1試合 */
export interface KoMatch {
  id: string;
  round: KoRound;
  /** 公式の試合番号（2026 のみ "73".."104"。R16テンプレは未設定）。表示用。 */
  no?: string;
  slot1: KoSlot;
  slot2: KoSlot;
}

/** 解決後の片側（teamId が無ければ未確定でラベル表示） */
export interface KoSide {
  teamId?: string;
  /** スロットラベル（"1A" / "2B" / "3位 C/D/F/G/H" / "M75 勝者"）。teamId が無いとき表示。 */
  label: string;
  undecided: boolean;
}

export interface KoResolvedMatch {
  id: string;
  round: KoRound;
  no?: string;
  /** キックオフ日時（knockoutSchedule 由来。無ければ未定）。 */
  kickoff?: string;
  /** 会場のUTCオフセット（時間・knockoutSchedule 由来）。表示のJST変換用。 */
  tz?: number;
  side1: KoSide;
  side2: KoSide;
  /** 実結果（両スロットが実チームに解決でき、KO結果データがある場合のみ）。 */
  result?: {
    side1Score: number;
    side2Score: number;
    /** 勝ち上がった側（1=side1 / 2=side2）。 */
    winnerSide: 1 | 2;
    /** PK戦（あれば）side1/side2 視点の本数。 */
    shootout?: { side1: number; side2: number };
  };
}

export interface KnockoutBracket {
  /** テンプレートに存在するラウンドを表示順で */
  rounds: KoRound[];
  matches: KoResolvedMatch[];
}
