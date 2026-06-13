// 生 JSON → CompiledTournament（Map 群とグループ↔試合の索引）。
// validateTournament を内部で呼び、失敗時は結合エラーで throw する（boot で catch して表示）。
import type { CompiledTournament, GroupId, Match, Team } from "./types";
import { GROUP_IDS } from "./types";
import { validateTournament } from "./validate";

export function compileTournament(raw: unknown): CompiledTournament {
  const v = validateTournament(raw);
  if (!v.ok) {
    throw new Error(`worldcup2022.json が不正:\n- ${v.errors.join("\n- ")}`);
  }
  const t = v.tournament;

  const teamsById = new Map<string, Team>();
  for (const team of t.teams) teamsById.set(team.id, team);

  const teamsByGroup = new Map<GroupId, Team[]>();
  for (const g of t.groups) {
    teamsByGroup.set(
      g.id,
      g.teamIds.map((id) => teamsById.get(id)!),
    );
  }

  const matchesByGroup = new Map<GroupId, Match[]>();
  for (const gid of GROUP_IDS) matchesByGroup.set(gid, []);
  // matchday → id 順で安定整列（描画・既定ピボット選択を決定的にする）
  const sorted = [...t.matches].sort(
    (a, b) => a.matchday - b.matchday || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const m of sorted) matchesByGroup.get(m.group)!.push(m);

  const groups = GROUP_IDS.filter((g) => teamsByGroup.has(g));

  return {
    meta: t.meta,
    teamsById,
    groups,
    teamsByGroup,
    matchesByGroup,
  };
}
