// 表示状態 ⇔ URL（パス）の相互変換（純関数。DOM・location は触らない）。
//   2026 一覧 = /            （トップ＝最新大会。/2026/ はトップへ転送するだけの noindex ページ）
//   2018 / 2022 一覧 = /2018/ ・ /2022/
//   グループ詳細 = /{cup}/{組の小文字}/   例: /2022/e/
// パスは base（"/wcup-tsuuka/"）からの相対で返す。base は呼び出し側が付ける
// （この関数群は import.meta.env を読まない＝domtest の tsx からもそのまま呼べる）。
// 旧 ?cup=&group=&scope= の共有URLは legacyQueryPath で新しいパスに置き換える。
import type { GroupId } from "../engine/types";
import { GROUP_IDS } from "../engine/types";

export type Cup = "2018" | "2022" | "2026";
/** 表示範囲（overview=全グループ一覧 / detail=1グループ詳細）。 */
export type Scope = "overview" | "detail";

export const CUP_IDS: readonly Cup[] = ["2018", "2022", "2026"];
/** トップ（/）に出す大会＝最新大会。 */
export const DEFAULT_CUP: Cup = "2026";

export function isCup(s: string | undefined | null): s is Cup {
  return s === "2018" || s === "2022" || s === "2026";
}

/** 表示状態 → base からの相対パス（"" / "2022/" / "2022/e/"）。ディレクトリは必ず末尾 "/"。 */
export function pagePath(cup: Cup, scope: Scope, group?: GroupId): string {
  if (scope === "detail" && group) return `${cup}/${group.toLowerCase()}/`;
  return cup === DEFAULT_CUP ? "" : `${cup}/`;
}

const LEGACY_KEYS = ["cup", "group", "scope", "view", "pivot", "assume"];

/**
 * 旧クエリ形式（?cup=2022&group=E&scope=detail）の共有URLなら、置き換え先のパス（base からの相対）を返す。
 * 旧パラメータが無ければ null（utm_* などだけのときは何もしない）。
 * 旧仕様どおり scope=detail のときだけグループ詳細（group 省略・その大会に無い組は先頭の組）、それ以外は大会の一覧。
 * cup が無ければ今いるページの大会（トップなら 2026）。旧 view/pivot/assume は読まずに捨てる。
 */
export function legacyQueryPath(search: string, pageCup: Cup, groupsOf: (cup: Cup) => readonly GroupId[]): string | null {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!LEGACY_KEYS.some((k) => p.has(k))) return null;
  const c = p.get("cup");
  const cup: Cup = isCup(c) ? c : pageCup;
  if (p.get("scope") !== "detail") return pagePath(cup, "overview");
  const groups = groupsOf(cup);
  const g = p.get("group");
  const group = g && (GROUP_IDS as readonly string[]).includes(g) && groups.includes(g as GroupId) ? (g as GroupId) : groups[0];
  return pagePath(cup, "detail", group);
}
