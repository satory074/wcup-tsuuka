// 表示状態 ⇔ クエリ文字列の相互変換（純関数。DOM・location は触らない）。
// 共有URL: ?group=E&pivot=E-5&assume=E-1:1-0,E-2:0-0
import type { GroupId, ResultOverride } from "../engine/types";
import { GROUP_IDS } from "../engine/types";

export type ViewMode = "live" | "stage";
export type Cup = "2022" | "2026";

export interface QueryState {
  /** 大会（2022=カタール / 2026=北中米）。未指定なら既定大会。 */
  cup?: Cup;
  group?: GroupId;
  /** タイムライン表示モード */
  view?: ViewMode;
  /** ピボット試合id（"E-5"） */
  pivot?: string;
  /** 他の未消化試合の仮定スコア */
  assume?: ResultOverride[];
}

// 組レターは A–L（2026の I〜L まで許容）。
const MATCH_ID_RE = /^[A-L]-\d{1,2}$/;
const ASSUME_RE = /^([A-L]-\d{1,2}):(\d{1,2})-(\d{1,2})$/;

export function encodeQuery(s: QueryState): string {
  const p = new URLSearchParams();
  if (s.cup) p.set("cup", s.cup);
  if (s.group) p.set("group", s.group);
  if (s.view) p.set("view", s.view);
  if (s.pivot && MATCH_ID_RE.test(s.pivot)) p.set("pivot", s.pivot);
  const pairs = (s.assume ?? [])
    .filter((o) => MATCH_ID_RE.test(o.matchId))
    .map((o) => `${o.matchId}:${o.score.home}-${o.score.away}`)
    .sort();
  if (pairs.length > 0) p.set("assume", pairs.join(","));
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
  const pivot = p.get("pivot");
  if (pivot && MATCH_ID_RE.test(pivot)) out.pivot = pivot;
  const assume = p.get("assume");
  if (assume) {
    const parsed: ResultOverride[] = [];
    for (const token of assume.split(",")) {
      const m = ASSUME_RE.exec(token);
      if (m) parsed.push({ matchId: m[1], score: { home: Number(m[2]), away: Number(m[3]) } });
    }
    if (parsed.length > 0) out.assume = parsed;
  }
  return out;
}
