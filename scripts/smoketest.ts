// エンジン＋データのスモークテスト。実行: npx tsx scripts/smoketest.ts
// セクション: 1) データ検証 2) 2022実順位の再現 3) タイブレーク単体
//             （P3 以降で 4) マトリックス 5) status 6) URL を追加）
import worldcupJson from "../src/data/worldcup2022.json";
import worldcup2026Json from "../src/data/worldcup2026.json";
import { validateTournament } from "../src/engine/validate";
import { compileTournament } from "../src/engine/compile";
import { computeStandings } from "../src/engine/standings";
import { computeBestThirds } from "../src/engine/thirds";
import { groupStatus } from "../src/engine/status";
import { analyzeGroup } from "../src/engine/scenario/qualify";
import { buildLiveTimeline, buildStageTimeline, clockOf, kickoffMinutes, scoreAtClock } from "../src/engine/timeline";
import type { Goal } from "../src/engine/types";
import type { CompiledTournament, GroupId, Match, Meta, Standings, StandingRow, Team } from "../src/engine/types";

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

// 合成 CompiledTournament 用ヘルパー（section 4・5 共有）
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

// ---- 4) 通過条件シナリオ（qualify.ts） ----
{
  // 4a) decided（2022 全消化）: 隣接順位を分けた決め手（タイブレーク）を解説
  const qE = analyzeGroup(CT, "E");
  assert(qE.phase === "decided", "4: 2022 組E は decided");
  assert(qE.teams.length === 4, "4: 4チーム");
  assert(qE.boundaries.length === 2, "4: 境界は 1↔2 と 2↔3 の2件");
  const eB12 = qE.boundaries.find((b) => b.rankHigher === 1)!;
  assert(eB12.higher === "jpn" && eB12.lower === "esp" && eB12.reason === "points", "4: E 1↔2 は勝点で jpn>esp");
  const eB23 = qE.boundaries.find((b) => b.rankHigher === 2)!;
  assert(eB23.higher === "esp" && eB23.lower === "ger" && eB23.reason === "gd" && eB23.cutoff, "4: E 2↔3(通過境界)は総得失点差で esp>ger");

  // H: 2↔3 = kor>uru は総得点（4-2）
  const qH = analyzeGroup(CT, "H");
  const hB23 = qH.boundaries.find((b) => b.rankHigher === 2)!;
  assert(hB23.higher === "kor" && hB23.lower === "uru" && hB23.reason === "gf", "4: H 2↔3 は総得点で kor>uru");
  assert(hB23.detail.includes("4-2"), `4: H 決め手 detail に 4-2（実際: ${hB23.detail}）`);

  // decided は alive 無し・条件空（反実仮想を出さない）
  assert(qE.teams.every((t) => t.status !== "alive" && t.conditions.length === 0), "4: decided は alive 無し・条件空");

  // 決定性
  assert(JSON.stringify(analyzeGroup(CT, "E")) === JSON.stringify(analyzeGroup(CT, "E")), "4: 同入力なら同一（決定的）");

  // 4b) final-round（合成: 4試合消化・最終節2試合未消化）
  // 既消化: A>B 1-0, C>D 1-0, A>C 1-0, B>D 1-0 → A=6, B=3, C=3, D=0
  // 未消化: A-D, B-C（同時刻の最終節）
  const frCt = synthCt(
    ["A", "B", "C", "D"],
    [
      mk("A", "B", 1, 0),
      mk("C", "D", 1, 0),
      mk("A", "C", 1, 0),
      mk("B", "D", 1, 0),
      mkU("A", "D"),
      mkU("B", "C"),
    ],
  );
  const qFR = analyzeGroup(frCt, "A");
  assert(qFR.phase === "final-round", "4b: 最終節のみ未消化は final-round");
  assert(qFR.remaining.length === 2, "4b: 未消化2試合");
  const fr = new Map(qFR.teams.map((t) => [t.teamId, t]));
  assert(fr.get("A")!.status === "advanced", "4b: A は突破確定");
  assert(fr.get("D")!.status === "eliminated", "4b: D は敗退");
  const tB = fr.get("B")!;
  assert(tB.status === "alive", "4b: B は可能性あり");
  const condB = (r: "win" | "draw" | "loss") => tB.conditions.find((c) => c.result === r)?.verdict;
  assert(condB("win") === "advance", "4b: B は C に勝てば突破");
  assert(condB("loss") === "out", "4b: B は C に敗れると敗退");
  assert(condB("draw") === "depends", "4b: B は引き分けなら他会場しだい");
  // 前向きタイブレーク予告: 勝点で並びうるのは上位争いの B・C（引分で4並び）。D は最大3で除外。
  assert(!!qFR.tiebreakWatch && qFR.tiebreakWatch.includes("B") && qFR.tiebreakWatch.includes("C"), "4b: tiebreakWatch に B・C");
  assert(!qFR.tiebreakWatch!.includes("D"), "4b: tiebreakWatch に D は含まない");

  // 4c) early（合成: 2試合消化・4試合未消化）→ 条件は出さず次戦のみ
  const earlyCt = synthCt(
    ["A", "B", "C", "D"],
    [mk("A", "B", 1, 0), mk("C", "D", 1, 0), mkU("A", "C"), mkU("B", "D"), mkU("A", "D"), mkU("B", "C")],
  );
  const qEarly = analyzeGroup(earlyCt, "A");
  assert(qEarly.phase === "early", "4c: 未消化が多い（列挙不能）は early");
  assert(qEarly.teams.every((t) => t.conditions.length === 0), "4c: early は条件を出さない");
  assert(qEarly.teams.some((t) => t.nextOpponent), "4c: early は次戦相手を出す");
  assert(qEarly.tiebreakWatch === undefined, "4c: early は tiebreakWatch を出さない");

  console.log("[qualify] 通過条件シナリオ OK（decided 決め手/final-round 条件/early/決定性）");
}

// ---- 5) 通過ステータス（status.ts） ----
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

// ---- 8) 2026 データ検証 + 実データ best-thirds（thirds.ts） ----
{
  const v = validateTournament(worldcup2026Json);
  if (!v.ok) {
    console.error("❌ worldcup2026.json が不正:");
    for (const e of v.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  assert(v.tournament.teams.length === 48, "2026: 48チーム");
  assert(v.tournament.groups.length === 12, "2026: 12組");
  assert(v.tournament.matches.length === 72, "2026: 72試合");

  const ct26 = compileTournament(worldcup2026Json);
  assert(ct26.groups.length === 12, "2026: compile 12組");
  for (const gid of ct26.groups) {
    assert(ct26.teamsByGroup.get(gid)!.length === 4, `2026: 組${gid} 4チーム`);
    assert(ct26.matchesByGroup.get(gid)!.length === 6, `2026: 組${gid} 6試合`);
  }
  console.log("[data] worldcup2026.json OK（チーム48 / 組12 / 試合72）");

  // 進行中の部分タイムライン: 消化済み試合に goals があれば組ごとに live 生成（消化分の全ゴール数＝スナップ数）
  const liveI = buildLiveTimeline(ct26, "I");
  assert(liveI !== null, "2026: 組I は goals があり live 生成");
  const iGoals = ct26.matchesByGroup.get("I")!.reduce((n, m) => n + (m.goals?.length ?? 0), 0);
  assert(liveI!.length === iGoals, `2026: 組I live は消化分の全ゴール数(${iGoals})`);
  assert(sortedAdv(liveI![liveI!.length - 1].advancing) === "fra,nor", "2026: 組I 第1節後の暫定通過は fra,nor");
  // 組A（第1〜2節消化・goals 投入済み）も live 生成。消化分の全ゴール数とスナップ数が一致。
  const liveA = buildLiveTimeline(ct26, "A");
  assert(liveA !== null, "2026: 組A も goals があり live 生成");
  const aGoals = ct26.matchesByGroup.get("A")!.reduce((n, m) => n + (m.goals?.length ?? 0), 0);
  assert(liveA!.length === aGoals, `2026: 組A live は消化分の全ゴール数(${aGoals})`);
  // 組K（第1節のみ消化・goals 投入済み）も live 生成。
  const liveK = buildLiveTimeline(ct26, "K");
  assert(liveK !== null, "2026: 組K も第1節消化＋goals で live 生成");
  const kGoals = ct26.matchesByGroup.get("K")!.reduce((n, m) => n + (m.goals?.length ?? 0), 0);
  assert(liveK!.length === kGoals, `2026: 組K live は消化分の全ゴール数(${kGoals})`);
  assert(buildStageTimeline(ct26, "A").length === 6, "2026: 組A の試合単位は6スナップ");

  // 実データ best-thirds: グループステージ進行中＝全エントリ contention・undecided
  const sbg = new Map<GroupId, Standings>();
  for (const gid of ct26.groups) {
    const ms = ct26.matchesByGroup.get(gid)!;
    const tids = ct26.teamsByGroup.get(gid)!.map((t) => t.id);
    sbg.set(gid, computeStandings(gid, ms, tids, ct26.meta));
  }
  const bt = computeBestThirds(ct26, sbg);
  assert(bt.slots === 8, "2026: best-thirds slots=8");
  assert(bt.entries.length >= 1 && bt.entries.length <= 12, "2026: 3位エントリは1..12組");
  assert(bt.entries.every((e) => !e.groupComplete && e.state === "contention"), "2026: 進行中は全エントリ contention");
  assert(bt.undecided, "2026: 進行中は未確定");
  assert(JSON.stringify(computeBestThirds(ct26, sbg)) === JSON.stringify(computeBestThirds(ct26, sbg)), "2026: best-thirds 決定的");

  // 2022（advanceBestThirds 未指定）は空を返す（no-regression 契約）
  const sbg22 = new Map<GroupId, Standings>();
  for (const gid of CT.groups) sbg22.set(gid, standingsFor(gid));
  const bt22 = computeBestThirds(CT, sbg22);
  assert(bt22.slots === 0 && bt22.entries.length === 0 && !bt22.undecided, "2022: best-thirds は空（slots=0）");
  console.log("[thirds] 2026 実データ best-thirds OK（進行中=全組暫定）＋ 2022 空");
}

// ---- 9) ベスト3位の単体（合成12組フィクスチャ） ----
const GROUPS12 = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as GroupId[];
function mkThirdStandings(group: GroupId, third: { points: number; gd: number; gf: number }, complete = true): Standings {
  const pl = complete ? 3 : 1;
  const row = (teamId: string, points: number, gd: number, gf: number, rank: number, advances: boolean): StandingRow => ({
    teamId, played: pl, won: 0, drawn: 0, lost: 0, gf, ga: gf - gd, gd, points, rank, advances,
  });
  // 1位・2位・4位はダミー。best-thirds は rank=3 行のみ読む（rank フィールド基準）。
  return {
    group,
    rows: [
      row(`${group}1`, 9, 9, 9, 1, true),
      row(`${group}2`, 6, 6, 6, 2, true),
      row(`${group}3`, third.points, third.gd, third.gf, 3, false),
      row(`${group}4`, 0, -9, 0, 4, false),
    ],
    undecided: false,
  };
}
function mkCt12(slots: number): CompiledTournament {
  return {
    meta: { ...meta(), advanceBestThirds: slots },
    teamsById: new Map(),
    groups: [...GROUPS12],
    teamsByGroup: new Map(),
    matchesByGroup: new Map(GROUPS12.map((g) => [g, [] as Match[]])),
  };
}
{
  // 9a) 明確な境界: 3位が勝点降順 → rank 1..12、上位8通過・9位以降落選・undecided 無し
  {
    const ct = mkCt12(8);
    const sbg = new Map<GroupId, Standings>();
    GROUPS12.forEach((g, i) => sbg.set(g, mkThirdStandings(g, { points: 12 - i, gd: 0, gf: 0 })));
    const bt = computeBestThirds(ct, sbg);
    assert(bt.entries.length === 12, "9a: 12エントリ");
    assert(bt.entries.every((e, i) => e.rank === i + 1), "9a: rank 1..12 単調");
    assert(bt.entries.slice(0, 8).every((e) => e.advances), "9a: 上位8は通過");
    assert(bt.entries.slice(8).every((e) => !e.advances), "9a: 9位以降は非通過");
    assert(!bt.undecided, "9a: 全確定で undecided 無し");
  }
  // 9b) 8位9位タイ（完全同値）: 共有rank・両者非通過・undecided。確定通過は7
  {
    const ct = mkCt12(8);
    const sbg = new Map<GroupId, Standings>();
    const pts = [12, 11, 10, 9, 8, 7, 6, 5, 5, 4, 3, 2];
    GROUPS12.forEach((g, i) => sbg.set(g, mkThirdStandings(g, { points: pts[i], gd: 0, gf: 0 })));
    const bt = computeBestThirds(ct, sbg);
    const tied = bt.entries.filter((e) => e.points === 5);
    assert(tied.length === 2, "9b: 同値2エントリ");
    assert(tied[0].rank === tied[1].rank, "9b: 共有rank（抽選）");
    assert(tied.every((e) => !e.advances), "9b: 枠線跨ぎは両者非通過（誰が入るか未確定）");
    assert(bt.undecided, "9b: 跨ぎで undecided");
    assert(bt.entries.filter((e) => e.advances).length === 7, "9b: 確定通過は7組");
  }
  // 9c) 組未完: 数値が明確でも未完組は contention・undecided（順序を捏造しない）
  {
    const ct = mkCt12(8);
    const sbg = new Map<GroupId, Standings>();
    GROUPS12.forEach((g, i) => sbg.set(g, mkThirdStandings(g, { points: 12 - i, gd: 0, gf: 0 }, g !== "A")));
    const bt = computeBestThirds(ct, sbg);
    const a = bt.entries.find((e) => e.group === "A")!;
    assert(a.state === "contention" && a.undecided && !a.groupComplete, "9c: 未完組は contention");
    assert(bt.undecided, "9c: 未完が混ざれば全体 undecided");
    assert(bt.entries.filter((e) => e.group !== "A").every((e) => e.state === "confirmed"), "9c: 他の完了組は confirmed");
  }
  console.log("[thirds] best-thirds 単体 OK（境界/同値跨ぎ/組未完）");
}

console.log("✅ smoketest（P1-P5 + 2026/thirds）通過");
