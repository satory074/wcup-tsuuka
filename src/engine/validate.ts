// worldcup2022.json の構造検証。zod は使わない（クライアントバンドル肥大を避けるため手書き）。
// smoketest（コミット前）とブラウザの compileTournament（boot 時）の両方で走る。
// 48 試合の実スコア転記ミス・組編成の取り違えを早期に弾くのが主目的。
import type { GroupId, Tournament } from "./types";
import { GROUP_IDS } from "./types";

export type ValidateResult =
  | { ok: true; tournament: Tournament }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** 4チームの総当り（6対戦）の無向ペア集合キー */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function validateTournament(raw: unknown): ValidateResult {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  if (!isRecord(raw)) return { ok: false, errors: ["ルートがオブジェクトではない"] };

  // ---- 形式判定 ----
  // 組数 G（8=2022方式 / 12=2026方式）から期待チーム数・試合数を導出する。
  // teams==4G・matches==6G・各組4チーム6対戦は G に依らず構造から検証できる。
  const groupCount = Array.isArray(raw.groups) ? (raw.groups as unknown[]).length : 0;
  const knownFormat = groupCount === 8 || groupCount === 12;
  const expectedTeams = groupCount * 4;
  const expectedMatches = groupCount * 6;

  // ---- meta ----
  const meta = raw.meta;
  if (!isRecord(meta)) err("meta が無い");
  else {
    for (const k of ["title", "edition", "dataLastUpdated", "source", "disclaimer"]) {
      if (typeof meta[k] !== "string" || !meta[k]) err(`meta.${k} が無い`);
    }
    if (!Number.isInteger(meta.advancePerGroup) || (meta.advancePerGroup as number) < 1)
      err("meta.advancePerGroup が不正");
    if (meta.advanceBestThirds !== undefined
      && (!Number.isInteger(meta.advanceBestThirds) || (meta.advanceBestThirds as number) < 0))
      err("meta.advanceBestThirds が不正（非負整数）");
    const pts = meta.points;
    if (!isRecord(pts)) err("meta.points が無い");
    else for (const k of ["win", "draw", "loss"]) {
      if (!isNonNegInt(pts[k])) err(`meta.points.${k} が不正`);
    }
  }

  // ---- teams ----
  const teamIds = new Set<string>();
  const teamGroup = new Map<string, GroupId>();
  const teams = raw.teams;
  if (!Array.isArray(teams)) err("teams が配列ではない");
  else {
    if (knownFormat && teams.length !== expectedTeams)
      err(`teams は${expectedTeams}チームであるべき（実際: ${teams.length}）`);
    for (const [i, t] of teams.entries()) {
      const at = `teams[${i}]`;
      if (!isRecord(t)) { err(`${at} がオブジェクトではない`); continue; }
      if (typeof t.id !== "string" || !t.id) err(`${at}.id が無い`);
      else if (teamIds.has(t.id)) err(`${at}.id "${t.id}" が重複`);
      else teamIds.add(t.id);
      if (typeof t.name !== "string" || !t.name) err(`${at}.name が無い`);
      if (typeof t.nameEn !== "string" || !t.nameEn) err(`${at}.nameEn が無い`);
      if (typeof t.flag !== "string" || !t.flag) err(`${at}.flag が無い`);
      if (t.fifaRank !== undefined && (!Number.isInteger(t.fifaRank) || (t.fifaRank as number) < 1))
        err(`${at}.fifaRank が不正（1以上の整数）`);
      if (!GROUP_IDS.includes(t.group as never)) err(`${at}.group が不正: ${String(t.group)}`);
      else if (typeof t.id === "string") teamGroup.set(t.id, t.group as GroupId);
    }
  }

  // ---- groups ----
  const seenGroups = new Set<string>();
  const groupTeamIds = new Map<GroupId, string[]>();
  const groups = raw.groups;
  if (!Array.isArray(groups)) err("groups が配列ではない");
  else {
    if (!knownFormat) err(`groups は8組(2022)か12組(2026)であるべき（実際: ${groups.length}）`);
    for (const [i, g] of groups.entries()) {
      const at = `groups[${i}]`;
      if (!isRecord(g)) { err(`${at} がオブジェクトではない`); continue; }
      if (!GROUP_IDS.includes(g.id as never)) { err(`${at}.id が不正: ${String(g.id)}`); continue; }
      const gid = g.id as GroupId;
      if (seenGroups.has(gid)) err(`${at}.id "${gid}" が重複`);
      else seenGroups.add(gid);
      if (!Array.isArray(g.teamIds) || g.teamIds.length !== 4)
        err(`${at}.teamIds は4チームであるべき`);
      else {
        const ids = g.teamIds as unknown[];
        const local = new Set<string>();
        for (const tid of ids) {
          if (typeof tid !== "string" || !teamIds.has(tid)) err(`${at}.teamIds "${String(tid)}" がチームに無い`);
          else if (local.has(tid)) err(`${at}.teamIds "${tid}" が組内で重複`);
          else {
            local.add(tid);
            if (teamGroup.get(tid) !== gid) err(`${at}.teamIds "${tid}" は teams 上では ${teamGroup.get(tid)} 組`);
          }
        }
        groupTeamIds.set(gid, ids.filter((x): x is string => typeof x === "string"));
      }
    }
  }

  // ---- matches ----
  const matchIds = new Set<string>();
  // 組ごとの「対戦ペア集合」と「チーム別出場数」
  const groupPairs = new Map<GroupId, Set<string>>();
  const groupAppearances = new Map<GroupId, Map<string, number>>();
  const matches = raw.matches;
  if (!Array.isArray(matches)) err("matches が配列ではない");
  else {
    if (knownFormat && matches.length !== expectedMatches)
      err(`matches は${expectedMatches}試合であるべき（実際: ${matches.length}）`);
    for (const [i, m] of matches.entries()) {
      const at = isRecord(m) && typeof m.id === "string" ? `matches[${i}](${m.id})` : `matches[${i}]`;
      if (!isRecord(m)) { err(`${at} がオブジェクトではない`); continue; }
      if (typeof m.id !== "string" || !m.id) err(`${at}.id が無い`);
      else if (matchIds.has(m.id)) err(`${at}.id が重複`);
      else matchIds.add(m.id);

      if (!GROUP_IDS.includes(m.group as never)) { err(`${at}.group が不正: ${String(m.group)}`); continue; }
      const gid = m.group as GroupId;

      if (m.matchday !== 1 && m.matchday !== 2 && m.matchday !== 3) err(`${at}.matchday が 1..3 ではない`);
      if (typeof m.kickoff !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(m.kickoff))
        err(`${at}.kickoff が "YYYY-MM-DDThh:mm" ではない`);

      const home = m.home;
      const away = m.away;
      for (const [k, v] of [["home", home], ["away", away]] as const) {
        if (typeof v !== "string" || !teamIds.has(v)) err(`${at}.${k} "${String(v)}" がチームに無い`);
        else if (teamGroup.get(v) !== gid) err(`${at}.${k} "${v}" は ${gid} 組の試合に出られない`);
      }
      if (typeof home === "string" && home === away) err(`${at} home と away が同一`);

      // 対戦ペア・出場数を記録
      if (typeof home === "string" && typeof away === "string" && home !== away
        && teamGroup.get(home) === gid && teamGroup.get(away) === gid) {
        if (!groupPairs.has(gid)) groupPairs.set(gid, new Set());
        const set = groupPairs.get(gid)!;
        const key = pairKey(home, away);
        if (set.has(key)) err(`${at} 同一対戦が重複（${home} vs ${away}）`);
        else set.add(key);
        if (!groupAppearances.has(gid)) groupAppearances.set(gid, new Map());
        const app = groupAppearances.get(gid)!;
        app.set(home, (app.get(home) ?? 0) + 1);
        app.set(away, (app.get(away) ?? 0) + 1);
      }

      // score（任意。あれば非負整数）
      if (m.score !== undefined && m.score !== null) {
        const s = m.score;
        if (!isRecord(s) || !isNonNegInt(s.home) || !isNonNegInt(s.away))
          err(`${at}.score の home/away が不正`);
      }
      // cards（任意）
      if (m.cards !== undefined && m.cards !== null) {
        const c = m.cards;
        if (!isRecord(c)) err(`${at}.cards が不正`);
        else for (const side of ["home", "away"] as const) {
          const cs = (c as Record<string, unknown>)[side];
          if (!isRecord(cs) || !isNonNegInt(cs.y) || !isNonNegInt(cs.r)) err(`${at}.cards.${side} が不正`);
        }
      }

      // goals（任意。あれば本数は score と一致必須）
      if (m.goals !== undefined && m.goals !== null) {
        if (!Array.isArray(m.goals)) err(`${at}.goals が配列ではない`);
        else {
          let gh = 0;
          let ga = 0;
          for (const [gi, g] of m.goals.entries()) {
            if (!isRecord(g)) { err(`${at}.goals[${gi}] が不正`); continue; }
            if (!Number.isInteger(g.minute) || (g.minute as number) < 0 || (g.minute as number) > 120)
              err(`${at}.goals[${gi}].minute が 0..120 の整数ではない`);
            if (g.plus !== undefined && !isNonNegInt(g.plus)) err(`${at}.goals[${gi}].plus が不正`);
            if (g.player !== undefined && (typeof g.player !== "string" || !g.player)) err(`${at}.goals[${gi}].player が空文字`);
            if (g.side !== "home" && g.side !== "away") err(`${at}.goals[${gi}].side が home/away ではない`);
            else if (g.side === "home") gh++;
            else ga++;
          }
          const s = m.score;
          if (isRecord(s) && isNonNegInt(s.home) && isNonNegInt(s.away)) {
            if (gh !== s.home) err(`${at}: home のゴール数 ${gh} が score.home ${s.home} と不一致`);
            if (ga !== s.away) err(`${at}: away のゴール数 ${ga} が score.away ${s.away} と不一致`);
          }
        }
      }
    }
  }

  // ---- 組ごとに 4チームの総当り（6対戦・各チーム3試合）になっているか ----
  // 宇宙（GROUP_IDS）ではなく、宣言された組だけを回す（2022=8組 / 2026=12組 に追従）。
  if (errors.length === 0) {
    for (const gid of groupTeamIds.keys()) {
      const ids = groupTeamIds.get(gid);
      if (!ids || ids.length !== 4) continue;
      const pairs = groupPairs.get(gid) ?? new Set();
      if (pairs.size !== 6) err(`組 ${gid} の対戦数が6ではない（実際: ${pairs.size}）`);
      // 期待される6ペアが揃っているか
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          if (!pairs.has(pairKey(ids[a], ids[b]))) err(`組 ${gid}: ${ids[a]} vs ${ids[b]} の試合が無い`);
        }
      }
      const app = groupAppearances.get(gid) ?? new Map();
      for (const tid of ids) {
        if ((app.get(tid) ?? 0) !== 3) err(`組 ${gid}: ${tid} の試合数が3ではない（実際: ${app.get(tid) ?? 0}）`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, tournament: raw as unknown as Tournament };
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * 旗色パレット（flag-colors.json）の検証。Zod 不使用の手書き（線色は旗色から算出するため）。
 * - ルートがオブジェクト
 * - 各値が「#rrggbb 形式の非空配列」
 * - teamIds の全 id にエントリがある（カバレッジ＝2026 に新チーム追加時の色未登録を CI で弾く）。
 * @returns エラーメッセージ配列（空＝正常）
 */
export function validateFlagColors(raw: unknown, teamIds: string[]): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ["flag-colors のルートがオブジェクトではない"];
  for (const [id, v] of Object.entries(raw)) {
    if (!Array.isArray(v) || v.length === 0) {
      errors.push(`flag-colors["${id}"] が非空配列ではない`);
      continue;
    }
    for (const [i, hex] of v.entries()) {
      if (typeof hex !== "string" || !HEX_RE.test(hex))
        errors.push(`flag-colors["${id}"][${i}] が #rrggbb 形式ではない: ${String(hex)}`);
    }
  }
  for (const id of teamIds) {
    if (!(id in raw)) errors.push(`flag-colors に "${id}" の色が無い（カバレッジ不足）`);
  }
  return errors;
}
