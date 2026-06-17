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
  /** キックオフ日時（ISO 現地＝カタール時間 "2022-11-23T16:00"）。タイムラインの絶対時刻並べ替え用 */
  kickoff?: string;
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

/** 生 JSON のルート（= worldcup2022.json） */
export interface Tournament {
  meta: Meta;
  teams: Team[];
  groups: GroupDef[];
  matches: Match[];
}

/** 検証後にインデックス化した実行時表現 */
export interface CompiledTournament {
  meta: Meta;
  teamsById: Map<string, Team>;
  groups: GroupId[];
  teamsByGroup: Map<GroupId, Team[]>;
  matchesByGroup: Map<GroupId, Match[]>;
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
