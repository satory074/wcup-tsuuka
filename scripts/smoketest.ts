// エンジン＋データのスモークテスト。実行: npx tsx scripts/smoketest.ts
// セクション: 1) データ検証 2) 2022実順位の再現 3) タイブレーク単体
//             （P3 以降で 4) マトリックス 5) status 6) URL を追加）
import worldcupJson from "../src/data/worldcup2022.json";
import { validateTournament } from "../src/engine/validate";
import { compileTournament } from "../src/engine/compile";
import { computeStandings } from "../src/engine/standings";
import { groupStatus } from "../src/engine/status";
import { buildMatrix, type ScenarioMatrix } from "../src/engine/scenario/matrix";
import { defaultPivot } from "../src/engine/scenario/pivot";
import { buildLiveTimeline, buildStageTimeline, clockOf, kickoffMinutes, scoreAtClock } from "../src/engine/timeline";
import type { Goal } from "../src/engine/types";
import type { CompiledTournament, GroupId, Match, Meta, Standings, Team } from "../src/engine/types";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
}

// ---- 1) worldcup2022.json の検証 ----
{
  const v = validateTournament(worldcupJson);
  if (!v.ok) {
    console.error("❌ worldcup2022.json が不正:");
    for (const e of v.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  assert(v.tournament.teams.length === 32, "32チーム");
  assert(v.tournament.groups.length === 8, "8組");
  assert(v.tournament.matches.length === 48, "48試合");
  console.log(`[data] worldcup2022.json OK（チーム32 / 組8 / 試合48）`);

  const ct = compileTournament(worldcupJson);
  assert(ct.groups.length === 8, "compile: 8組");
  for (const gid of ct.groups) {
    assert(ct.teamsByGroup.get(gid)!.length === 4, `compile: 組${gid} 4チーム`);
    assert(ct.matchesByGroup.get(gid)!.length === 6, `compile: 組${gid} 6試合`);
  }
  console.log("[data] compile OK");

  const clone = () => structuredClone(worldcupJson) as Record<string, unknown>;
  const b1 = clone();
  (b1.matches as { home: string; away: string }[])[0].away = (b1.matches as { home: string }[])[0].home;
  assert(!validateTournament(b1).ok, "home==away を弾く");
  const b2 = clone();
  (b2.matches as unknown[]).splice(0, 1);
  assert(!validateTournament(b2).ok, "対戦欠落（47試合）を弾く");
  const b3 = clone();
  (b3.teams as { group: string }[])[0].group = "Z";
  assert(!validateTournament(b3).ok, "不正グループを弾く");
  const b4 = clone();
  (b4.matches as { score: { home: number } }[])[0].score.home = -1;
  assert(!validateTournament(b4).ok, "負スコアを弾く");
  const b5 = clone();
  const ms = b5.matches as { id: string; home: string; away: string }[];
  const a6 = ms.find((m) => m.id === "A-6")!;
  a6.home = "qat";
  a6.away = "ecu";
  assert(!validateTournament(b5).ok, "対戦の重複/欠落を弾く");

  // 全48試合に goals があり、本数が score と一致
  const allMatches = worldcupJson.matches as { matchday: number; goals?: unknown; kickoff?: string; score: { home: number; away: number } }[];
  for (const m of allMatches) assert(Array.isArray(m.goals), "全試合に goals 配列がある");
  // 全48試合に妥当な kickoff（YYYY-MM-DDThh:mm）
  for (const m of allMatches) assert(typeof m.kickoff === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(m.kickoff), "全試合に kickoff");
  const md3 = allMatches.filter((m) => m.matchday === 3);
  assert(md3.length === 16, `第3節は16試合（実際: ${md3.length}）`);
  // 本数不一致を弾く（E-5 のゴールを1つ削る → home 2→1 で score.home 2 と不一致）
  const bg = clone();
  const e5 = (bg.matches as { id: string; goals: unknown[] }[]).find((m) => m.id === "E-5")!;
  e5.goals = e5.goals.slice(0, 2);
  assert(!validateTournament(bg).ok, "ゴール本数と score の不一致を弾く");
  // 全ゴールに得点選手名がある
  for (const m of allMatches) {
    for (const g of (m.goals as { player?: string }[])) {
      assert(typeof g.player === "string" && g.player.length > 0, "全ゴールに選手名");
    }
  }
  console.log("[data] 不正データ検出 + goals 本数==score + 選手名 OK");
}

// ---- 2) 2022 実順位の再現 ----
const CT = compileTournament(worldcupJson);

function standingsFor(gid: GroupId): Standings {
  const matches = CT.matchesByGroup.get(gid)!;
  const teamIds = CT.teamsByGroup.get(gid)!.map((t) => t.id);
  return computeStandings(gid, matches, teamIds, CT.meta);
}

/** [teamId, points] の並びと通過(上位2)・undecided を検証 */
function expectTable(gid: GroupId, expected: [string, number][]): Standings {
  const st = standingsFor(gid);
  assert(!st.undecided, `組${gid}: 実データは抽選無し`);
  assert(st.rows.length === expected.length, `組${gid}: 4行`);
  expected.forEach(([id, pts], i) => {
    const row = st.rows[i];
    assert(row.teamId === id, `組${gid}: ${i + 1}位は ${id}（実際: ${row.teamId}）`);
    assert(row.points === pts, `組${gid}: ${id} は勝点${pts}（実際: ${row.points}）`);
    assert(row.rank === i + 1, `組${gid}: ${id} の rank=${i + 1}`);
    assert(row.advances === i < 2, `組${gid}: ${id} の通過判定`);
  });
  return st;
}

{
  expectTable("A", [["ned", 7], ["sen", 6], ["ecu", 4], ["qat", 0]]);
  expectTable("B", [["eng", 7], ["usa", 5], ["irn", 3], ["wal", 1]]);
  expectTable("C", [["arg", 6], ["pol", 4], ["mex", 4], ["ksa", 3]]);
  expectTable("D", [["fra", 6], ["aus", 6], ["tun", 4], ["den", 1]]);
  const e = expectTable("E", [["jpn", 6], ["esp", 4], ["ger", 4], ["crc", 3]]);
  expectTable("F", [["mar", 7], ["cro", 5], ["bel", 4], ["can", 0]]);
  expectTable("G", [["bra", 6], ["sui", 6], ["cmr", 4], ["srb", 1]]);
  const h = expectTable("H", [["por", 6], ["kor", 4], ["uru", 4], ["gha", 3]]);

  // E: スペイン2位 vs ドイツ3位 は総得失点差で決まる（GF より先に GD）
  assert(e.rows[1].points === e.rows[2].points, "組E: esp と ger は同勝点");
  assert(e.rows[1].gd > e.rows[2].gd, "組E: esp は ger より総得失点差が上");

  // H: 韓国2位 vs ウルグアイ3位 は総得点で決まる（勝点・GD 同で GF）
  assert(h.rows[1].points === h.rows[2].points, "組H: kor と uru は同勝点");
  assert(h.rows[1].gd === h.rows[2].gd, "組H: kor と uru は同得失点差");
  assert(h.rows[1].gf > h.rows[2].gf, "組H: kor は uru より総得点が上");

  // C: ポーランド2位 vs メキシコ3位 は総得失点差
  const c = standingsFor("C");
  assert(c.rows[1].points === c.rows[2].points && c.rows[1].gd > c.rows[2].gd, "組C: GD で pol > mex");

  console.log("[standings] 2022 全8組の実順位を再現 OK（E=GD, H=GF, C=GD のタイブレーク含む）");
}

// ---- 3) タイブレーク単体（合成フィクスチャ） ----
function meta(): Meta {
  return {
    title: "t",
    edition: "e",
    advancePerGroup: 2,
    points: { win: 3, draw: 1, loss: 0 },
    dataLastUpdated: "2026-06-13",
    source: "x",
    disclaimer: "d",
  };
}
let mid = 0;
function mk(home: string, away: string, hs: number, as: number): Match {
  mid++;
  return { id: `m-${mid}`, group: "A", matchday: 1, home, away, score: { home: hs, away: as } };
}
function synth(matches: Match[], teamIds: string[]): Standings {
  return computeStandings("A", matches, teamIds, meta());
}

{
  // 3a) 総得失点差で決まる（B gd+3 > C gd+1、両者同勝点5）
  const a = synth(
    [mk("A", "B", 1, 1), mk("A", "C", 1, 1), mk("A", "D", 1, 1), mk("B", "C", 0, 0), mk("B", "D", 3, 0), mk("C", "D", 1, 0)],
    ["A", "B", "C", "D"],
  );
  assert(a.rows[0].teamId === "B" && a.rows[1].teamId === "C", "3a: 総GD で B > C");
  assert(a.rows[0].points === a.rows[1].points && a.rows[0].gd > a.rows[1].gd, "3a: 同勝点・GD差で決着");

  // 3b) 総得点で決まる（勝点・GD 同、B gf6 > C gf4）
  const b = synth(
    [mk("B", "D", 3, 1), mk("A", "B", 2, 2), mk("B", "C", 1, 1), mk("C", "D", 2, 0), mk("A", "C", 1, 1), mk("A", "D", 0, 0)],
    ["A", "B", "C", "D"],
  );
  assert(b.rows[0].teamId === "B" && b.rows[1].teamId === "C", "3b: 総GF で B > C");
  assert(b.rows[0].points === b.rows[1].points && b.rows[0].gd === b.rows[1].gd && b.rows[0].gf > b.rows[1].gf, "3b: 勝点・GD同で GF が決着");

  // 3c) 直接対決(h2h)で決まる（A と B は総合 pts6/gd+2/gf3 で同値、h2h は A 勝ち）
  const c = synth(
    [mk("A", "B", 1, 0), mk("A", "C", 0, 1), mk("A", "D", 2, 0), mk("B", "C", 2, 0), mk("B", "D", 1, 0), mk("C", "D", 0, 1)],
    ["A", "B", "C", "D"],
  );
  assert(!c.undecided, "3c: h2h で決着し抽選にならない");
  assert(c.rows[0].teamId === "A" && c.rows[1].teamId === "B", "3c: 総合同値・h2h で A > B");
  assert(c.rows[0].points === c.rows[1].points && c.rows[0].gd === c.rows[1].gd && c.rows[0].gf === c.rows[1].gf, "3c: A と B は総合完全同値");

  // 3d) 解決不能（3すくみ・同スコア）→ 抽選。順序を捏造しない（3チーム同rank）
  const d = synth(
    [mk("A", "B", 1, 0), mk("B", "C", 1, 0), mk("C", "A", 1, 0), mk("A", "D", 1, 0), mk("B", "D", 1, 0), mk("C", "D", 1, 0)],
    ["A", "B", "C", "D"],
  );
  assert(d.undecided, "3d: 解決不能なら undecided");
  const top3 = d.rows.filter((r) => r.rank === 1);
  assert(top3.length === 3, "3d: 上位3チームが同rank（順序を作らない）");
  assert(top3.every((r) => r.advances === false), "3d: 2枠に3チーム同rank → 誰が通過か未確定（advances=false）");
  assert(top3.every((r) => r.tiedGroupKey === top3[0].tiedGroupKey), "3d: 同じ抽選クラスタキー");
  assert(d.rows[3].teamId === "D" && d.rows[3].rank === 4, "3d: D は4位");

  // 3e) 1-2位タイ（両者通過・順序のみ抽選）→ 両者 advances=true, undecided=true
  const e = synth(
    [mk("A", "C", 2, 0), mk("A", "D", 2, 0), mk("A", "B", 1, 1), mk("B", "C", 2, 0), mk("B", "D", 2, 0), mk("C", "D", 0, 0)],
    ["A", "B", "C", "D"],
  );
  assert(e.undecided, "3e: 1-2位タイは undecided（順序は抽選）");
  const top2 = e.rows.filter((r) => r.rank === 1);
  assert(top2.length === 2 && top2.every((r) => r.advances === true), "3e: 1-2位タイは両者通過確定");

  console.log("[standings] タイブレーク単体 OK（総GD/総GF/h2h/3すくみ抽選/1-2位タイ）");
}

// ---- 4) シナリオ・マトリックス ----
function cellAt(m: ScenarioMatrix, a: number, b: number) {
  return m.cells.find((c) => c.a === a && c.b === b)!;
}
{
  // 組E、ピボット = 日本(home) vs スペイン(away)。他5試合は実結果（全消化）
  const matchesE = CT.matchesByGroup.get("E")!;
  const pivotId = "E-5"; // jpn vs esp
  const m = buildMatrix({ ct: CT, group: "E", pivotMatchId: pivotId, assumptions: [] });

  assert(m.cells.length === 49, "4: 7x7=49セル");
  assert(m.teamA === "jpn" && m.teamB === "esp", "4: 軸は home=jpn × away=esp");
  assert(m.cells.every((c) => c.outcome.label.length > 0), "4: 全セルにラベル");
  const sum = m.legend.reduce((acc, l) => acc + l.count, 0);
  assert(sum === 49, `4: 凡例のセル数合計=49（実際: ${sum}）`);
  assert(m.legend.length >= 2, "4: 結果領域は2つ以上");

  // 既定ピボットが最終節の最小id（E-5）
  assert(defaultPivot(matchesE) === "E-5", "4: defaultPivot=E-5");

  // 既知セルの手計算一致
  // 実際の結果 日本 2-1 スペイン → ①日本 ②スペイン
  const real = cellAt(m, 2, 1);
  assert(real.outcome.first === "jpn" && real.outcome.second === "esp", "4: (2,1) は ①jpn ②esp");
  // 日本 0-5 スペイン → ①スペイン ②ドイツ（日本敗退）
  const blowout = cellAt(m, 0, 5);
  assert(blowout.outcome.first === "esp" && blowout.outcome.second === "ger", "4: (0,5) は ①esp ②ger");
  assert(blowout.outcome.eliminated.includes("jpn"), "4: (0,5) は日本敗退");

  // 引き分け対角（a==b）が意味を持つ: 隣接セルと結果が変わる箇所がある
  const drawCells = m.cells.filter((c) => c.isDraw);
  assert(drawCells.length === 7, "4: 対角（引分）セルは7");
  let drawMatters = false;
  for (let a = 1; a <= m.maxGoals; a++) {
    if (cellAt(m, a, a).outcome.outcomeKey !== cellAt(m, a, a - 1).outcome.outcomeKey) drawMatters = true;
  }
  assert(drawMatters, "4: 引き分けが隣の勝ち結果と異なる（引分が有効）");

  // オーバーフローバケット 6+ が存在
  assert(!!cellAt(m, 6, 6), "4: (6,6) オーバーフローセルが存在");

  // 決定性
  const once = JSON.stringify(buildMatrix({ ct: CT, group: "E", pivotMatchId: pivotId, assumptions: [] }));
  const twice = JSON.stringify(buildMatrix({ ct: CT, group: "E", pivotMatchId: pivotId, assumptions: [] }));
  assert(once === twice, "4: 同入力なら同一マトリックス（決定的）");

  console.log("[matrix] シナリオ・マトリックス OK（49セル/既知セル/引分有効/決定性）");
}

// ---- 5) 通過ステータス（status.ts） ----
function mkU(home: string, away: string): Match {
  mid++;
  return { id: `m-${mid}`, group: "A", matchday: 3, home, away };
}
function team(id: string): Team {
  return { id, name: id, nameEn: id, group: "A", flag: "" };
}
function synthCt(teamIds: string[], matches: Match[]): CompiledTournament {
  return {
    meta: meta(),
    teamsById: new Map(teamIds.map((id) => [id, team(id)])),
    groups: ["A"],
    teamsByGroup: new Map([["A", teamIds.map(team)]]),
    matchesByGroup: new Map([["A", matches]]),
  };
}

{
  // 5a) シードデータ（全消化）: alive は無く、clinched == advances、上位2が advanced
  for (const gid of CT.groups) {
    const st = standingsFor(gid);
    const status = groupStatus(CT, gid);
    assert(status.every((s) => s.status !== "alive"), `組${gid}: 全消化なので alive 無し`);
    for (const s of status) {
      const row = st.rows.find((r) => r.teamId === s.teamId)!;
      assert(s.clinchedTop2 === row.advances, `組${gid}: ${s.teamId} clinched==advances`);
      assert(s.status === (row.advances ? "advanced" : "eliminated"), `組${gid}: ${s.teamId} の status`);
    }
  }
  console.log("[status] シードデータ（全消化）OK");

  // 5b) 部分シーズン: MD3 未消化（A vs D, B vs C）。A=確定 / D=敗退 / B,C=可能性あり
  const ct = synthCt(
    ["A", "B", "C", "D"],
    [
      mk("A", "B", 3, 0),
      mk("C", "D", 3, 0),
      mk("A", "C", 3, 0),
      mk("B", "D", 3, 0),
      mkU("A", "D"),
      mkU("B", "C"),
    ],
  );
  const status = groupStatus(ct, "A");
  const by = new Map(status.map((s) => [s.teamId, s]));
  assert(by.get("A")!.status === "advanced" && by.get("A")!.clinchedTop2, "5b: A は突破確定");
  assert(by.get("D")!.status === "eliminated" && !by.get("D")!.canFinishTop2, "5b: D は敗退");
  assert(by.get("B")!.status === "alive" && by.get("B")!.canFinishTop2 && !by.get("B")!.clinchedTop2, "5b: B は可能性あり");
  assert(by.get("C")!.status === "alive", "5b: C は可能性あり");
  console.log("[status] 部分シーズンの確定/敗退/可能性あり OK");
}

// ---- 7) タイムライン（timeline.ts） ----
function sortedAdv(a: string[]): string {
  return [...a].sort().join(",");
}
{
  // scoreAtClock 単体
  const g: Goal[] = [
    { minute: 11, side: "away" },
    { minute: 48, side: "home" },
    { minute: 51, side: "home" },
  ];
  assert(JSON.stringify(scoreAtClock(g, 0)) === JSON.stringify({ home: 0, away: 0 }), "7: 0分は0-0");
  assert(JSON.stringify(scoreAtClock(g, clockOf({ minute: 11, side: "away" }))) === JSON.stringify({ home: 0, away: 1 }), "7: 11分で0-1");
  assert(JSON.stringify(scoreAtClock(g, 4800)) === JSON.stringify({ home: 1, away: 1 }), "7: 48分で1-1");
  assert(JSON.stringify(scoreAtClock(g, 9000)) === JSON.stringify({ home: 2, away: 1 }), "7: 90分で2-1");
  // アディショナルタイム境界
  assert(clockOf({ minute: 90, plus: 5, side: "home" }) === 9005, "7: clockOf 90+5 = 9005");
  const g2: Goal[] = [{ minute: 90, plus: 5, side: "home" }];
  assert(scoreAtClock(g2, 9004).home === 0 && scoreAtClock(g2, 9005).home === 1, "7: 90+5 の境界");

  // 大会全体タイムライン（試合単位）: 6スナップ・最終は最終順位
  const stageE = buildStageTimeline(CT, "E");
  assert(stageE.length === 6, `7: 組E 試合単位は6スナップ（実際: ${stageE.length}）`);
  const stageLast = stageE[stageE.length - 1].standings;
  assert(stageLast.rows.map((r) => r.teamId).join(",") === "jpn,esp,ger,crc", "7: 試合単位の最終=最終順位");
  assert(stageE.every((s) => s.standings.rows.length === 4), "7: 各スナップ4チーム");
  assert(stageE.every((s) => Object.keys(s.movements).length === 4), "7: movements が全チーム分");

  // 全8組で試合単位タイムラインが作れ、最終スナップが最終順位と一致
  for (const gid of CT.groups) {
    const stage = buildStageTimeline(CT, gid);
    const fin = standingsFor(gid);
    assert(
      stage[stage.length - 1].standings.rows.map((r) => r.teamId).join(",") === fin.rows.map((r) => r.teamId).join(","),
      `7: 組${gid} 試合単位の最終=最終順位`,
    );
  }

  // 最終節 分刻みタイムライン（組E）
  const liveE = buildLiveTimeline(CT, "E");
  assert(liveE !== null, "7: 組E はライブタイムラインを生成");
  // 全試合（第1〜3節）のゴール数ぶんのスナップ（キックオフ列は無し）
  const eGoals = CT.matchesByGroup.get("E")!.reduce((n, m) => n + (m.goals?.length ?? 0), 0);
  assert(liveE!.length === eGoals, `7: 組E ライブは全ゴール数(${eGoals})スナップ（実際: ${liveE!.length}）`);
  assert(liveE![0].kind === "goal", "7: 先頭はゴール（キックオフ列なし）");
  assert(liveE!.some((s) => s.event?.matchday === 1) && liveE!.some((s) => s.event?.matchday === 3), "7: 第1節〜第3節を含む");

  // kickoffMinutes 単体（順序）: 23日16:00 < 23日19:00 < 27日13:00
  assert(kickoffMinutes("2022-11-23T16:00") < kickoffMinutes("2022-11-23T19:00"), "7: 同日 時刻順");
  assert(kickoffMinutes("2022-11-23T19:00") < kickoffMinutes("2022-11-27T13:00"), "7: 別日 日付順");

  // 被らない第1節は時系列: E-1(16:00) の全ゴールが E-2(19:00) より前
  const idxOf = (mid: string) => liveE!.map((s, i) => ({ s, i })).filter((x) => x.s.event?.matchId === mid).map((x) => x.i);
  const e1 = idxOf("E-1");
  const e2 = idxOf("E-2");
  assert(Math.max(...e1) < Math.min(...e2), "7: 第1節は時系列（E-1 全ゴールが E-2 より前）");
  // 被る第3節は並列（分で交互）: E-5 と E-6 の index 範囲が重なる
  const e5 = idxOf("E-5");
  const e6 = idxOf("E-6");
  assert(Math.max(...e5) > Math.min(...e6) && Math.max(...e6) > Math.min(...e5), "7: 第3節は並列（E-5/E-6 が交互）");
  // 得点者がスナップショットに載る（48' E-5 堂安）
  const e48 = liveE!.find((s) => s.event?.matchId === "E-5" && s.clockLabel === "48'");
  assert(e48?.event?.scorer === "堂安", `7: 48' の得点者が堂安（実際: ${e48?.event?.scorer}）`);

  // 既知の中間状態: コスタリカが70'に2-1とした時点で、暫定通過圏が [crc, jpn]（スペイン圏外）
  const at70 = liveE!.find((s) => s.event?.matchId === "E-6" && s.event.homeScore === 2 && s.event.awayScore === 1);
  assert(!!at70, "7: 70' コスタリカ2-1 のスナップが存在");
  assert(sortedAdv(at70!.advancing) === "crc,jpn", `7: 70'時点の暫定通過は日本とコスタリカ（実際: ${at70!.advancing}）`);
  assert(!at70!.advancing.includes("esp"), "7: 70'時点でスペインは暫定圏外");

  // 最終: ドイツの逆転で 暫定通過は [esp, jpn] に戻り、最終順位と一致
  const liveLast = liveE![liveE!.length - 1];
  assert(sortedAdv(liveLast.advancing) === "esp,jpn", "7: 最終はスペインと日本が通過");
  assert(liveLast.standings.rows.map((r) => r.teamId).join(",") === "jpn,esp,ger,crc", "7: ライブ最終=最終順位");

  // 全8組でライブタイムラインが生成でき、最終スナップが最終順位と一致
  for (const gid of CT.groups) {
    const live = buildLiveTimeline(CT, gid);
    assert(live !== null, `7: 組${gid} ライブ生成`);
    const fin = standingsFor(gid);
    assert(
      live![live!.length - 1].standings.rows.map((r) => r.teamId).join(",") === fin.rows.map((r) => r.teamId).join(","),
      `7: 組${gid} ライブ最終=最終順位`,
    );
  }

  // 決定性
  assert(JSON.stringify(buildLiveTimeline(CT, "E")) === JSON.stringify(buildLiveTimeline(CT, "E")), "7: ライブは決定的");
  console.log("[timeline] 試合単位＋分刻み OK（全8組 最終一致・組E 70'の暫定逆転・決定性）");
}

console.log("✅ smoketest（P1-P5）通過");
