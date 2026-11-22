// 大会データ（JSON）の入口。ブラウザの boot・ビルド時の事前描画・サイトマップが同じものを読む。
import worldcup2018 from "../data/worldcup2018.json";
import worldcup2022 from "../data/worldcup2022.json";
import worldcup2026 from "../data/worldcup2026.json";
import type { GroupId } from "../engine/types";
import { CUP_IDS, DEFAULT_CUP, pagePath, type Cup, type Scope } from "./url";

export const DATA: Record<Cup, unknown> = { "2018": worldcup2018, "2022": worldcup2022, "2026": worldcup2026 };

const GROUPS: Record<Cup, readonly GroupId[]> = {
  "2018": worldcup2018.groups.map((g) => g.id as GroupId),
  "2022": worldcup2022.groups.map((g) => g.id as GroupId),
  "2026": worldcup2026.groups.map((g) => g.id as GroupId),
};

/** その大会で宣言されている組（2018/2022=A–H、2026=A–L）。データの宣言順。 */
export function groupsOf(cup: Cup): readonly GroupId[] {
  return GROUPS[cup];
}

export interface SitePage {
  cup: Cup;
  scope: Scope;
  group?: GroupId;
  /** base からの相対パス（"" / "2022/" / "2022/e/"） */
  path: string;
}

/** 検索に出すページの一覧（= サイトマップ・事前描画するページ）。トップ（2026 一覧）・2018/2022 一覧・各大会の全グループ。 */
export function sitePages(): SitePage[] {
  const out: SitePage[] = [];
  for (const cup of [DEFAULT_CUP, ...CUP_IDS.filter((c) => c !== DEFAULT_CUP)]) {
    out.push({ cup, scope: "overview", path: pagePath(cup, "overview") });
    for (const group of groupsOf(cup)) out.push({ cup, scope: "detail", group, path: pagePath(cup, "detail", group) });
  }
  return out;
}
