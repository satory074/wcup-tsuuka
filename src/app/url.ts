// 表示状態 ⇔ クエリ文字列の相互変換（純関数。DOM・location は触らない）。
// 共有URL: ?cup=2026&group=E&view=stage
import type { GroupId } from "../engine/types";
import { GROUP_IDS } from "../engine/types";

export type ViewMode = "live" | "stage";
export type Cup = "2022" | "2026";

export interface QueryState {
  /** 大会（2022=カタール / 2026=北中米）。未指定なら既定大会。 */
  cup?: Cup;
  group?: GroupId;
  /** タイムライン表示モード */
  view?: ViewMode;
}

export function encodeQuery(s: QueryState): string {
  const p = new URLSearchParams();
  if (s.cup) p.set("cup", s.cup);
  if (s.group) p.set("group", s.group);
  if (s.view) p.set("view", s.view);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export function decodeQuery(search: string): QueryState {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: QueryState = {};
  const cup = p.get("cup");
  if (cup === "2022" || cup === "2026") out.cup = cup;
  const group = p.get("group");
  if (group && (GROUP_IDS as readonly string[]).includes(group)) out.group = group as GroupId;
  const view = p.get("view");
  if (view === "live" || view === "stage") out.view = view;
  return out;
}
