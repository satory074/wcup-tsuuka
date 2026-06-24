// 表示状態 ⇔ クエリ文字列の相互変換（純関数。DOM・location は触らない）。
// 共有URL: ?cup=2026&group=E&scope=overview
import type { GroupId } from "../engine/types";
import { GROUP_IDS } from "../engine/types";

export type Cup = "2018" | "2022" | "2026";
/** 表示範囲（overview=全グループ一覧 / detail=1グループ詳細）。既定は detail。 */
export type Scope = "overview" | "detail";

export interface QueryState {
  /** 大会（2018=ロシア / 2022=カタール / 2026=北中米）。未指定なら既定大会。 */
  cup?: Cup;
  group?: GroupId;
  /** 表示範囲。既定 detail は URL に出さない（既存の共有URLを温存）。 */
  scope?: Scope;
}

export function encodeQuery(s: QueryState): string {
  const p = new URLSearchParams();
  if (s.cup) p.set("cup", s.cup);
  if (s.group) p.set("group", s.group);
  // 既定 detail はクエリに出さない（detail の共有URL・テストの比較を不変に保つ）。
  if (s.scope === "overview") p.set("scope", "overview");
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export function decodeQuery(search: string): QueryState {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: QueryState = {};
  const cup = p.get("cup");
  if (cup === "2018" || cup === "2022" || cup === "2026") out.cup = cup;
  const group = p.get("group");
  if (group && (GROUP_IDS as readonly string[]).includes(group)) out.group = group as GroupId;
  // 旧 ?view=live|stage は廃止（単一タイムラインに統合）。付いていても無視＝旧URLは壊れない。
  const scope = p.get("scope");
  if (scope === "overview") out.scope = "overview";
  return out;
}
