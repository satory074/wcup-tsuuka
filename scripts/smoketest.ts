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
import { buildTimeline, clockOf, kickoffMinutes, scoreAtClock } from "../src/engine/timeline";
import { computeScorers } from "../src/engine/scorers";
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
/** その組で「全試合が消化済みの節」の数（＝節末スナップの数）。 */
function playedRounds(ct: CompiledTournament, gid: GroupId): number {
  const byMd = new Map<number, Match[]>();
  for (const m of ct.matchesByGroup.get(gid)!) {
    const a = byMd.get(m.matchday) ?? [];
    a.push(m);
    byMd.set(m.matchday, a);
  }
  let n = 0;
  for (const ms of byMd.values()) {
    if (ms.length > 0 && ms.every((m) => m.score !== undefined && m.score !== null)) n++;
  }
  return n;
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

  // 単一タイムライン（分刻みゴール＋節末スナップ）。完全消化の節ごとに「第n節 終了」が1つ入る。
  const tlE = buildTimeline(CT, "E");
  assert(tlE !== null, "7: 組E はタイムラインを生成");
  const eGoals = CT.matchesByGroup.get("E")!.reduce((n, m) => n + (m.goals?.length ?? 0), 0);
  const eRounds = playedRounds(CT, "E");
  assert(eRounds === 3, "7: 組E は3節すべて消化");
  assert(tlE!.length === eGoals + eRounds, `7: 組E は 全ゴール(${eGoals})＋節末(${eRounds}) スナップ（実際: ${tlE!.length}）`);
  assert(tlE![0].kind === "goal", "7: 先頭はゴール（キックオフ列なし）");
  assert(tlE!.every((s) => s.standings.rows.length === 4), "7: 各スナップ4チーム");
  assert(tlE!.every((s) => Object.keys(s.movements).length === 4), "7: movements が全チーム分");

  // 節末スナップ: kind=roundEnd・roundResults は2試合・第1→2→3節の順・ラベル
  const roundEnds = tlE!.filter((s) => s.kind === "roundEnd");
  assert(roundEnds.length === 3, "7: 節末スナップは3つ");
  assert(roundEnds.every((s) => (s.roundResults?.length ?? 0) === 2), "7: 各節末は2試合の結果");
  assert(roundEnds.map((s) => s.matchday).join(",") === "1,2,3", "7: 節末は第1→2→3節の順");
  assert(roundEnds[2].clockLabel === "第3節 終了", "7: 節末ラベル");
  assert(roundEnds[2].roundResults!.every((r) => typeof r.homeScore === "number" && typeof r.awayScore === "number"), "7: 節末 roundResults にスコア");

  // kickoffMinutes 単体（順序）: 23日16:00 < 23日19:00 < 27日13:00
  assert(kickoffMinutes("2022-11-23T16:00") < kickoffMinutes("2022-11-23T19:00"), "7: 同日 時刻順");
  assert(kickoffMinutes("2022-11-23T19:00") < kickoffMinutes("2022-11-27T13:00"), "7: 別日 日付順");

  // 節（matchday）は第1〜3節を含む
  assert(tlE!.some((s) => s.matchday === 1) && tlE!.some((s) => s.matchday === 3), "7: 第1節〜第3節を含む");

  // 被らない第1節は時系列: E-1(16:00) の全ゴールが E-2(19:00) より前
  const idxOf = (mid: string) => tlE!.map((s, i) => ({ s, i })).filter((x) => x.s.event?.matchId === mid).map((x) => x.i);
  const e1 = idxOf("E-1");
  const e2 = idxOf("E-2");
  assert(Math.max(...e1) < Math.min(...e2), "7: 第1節は時系列（E-1 全ゴールが E-2 より前）");
  // 被る第3節は並列（分で交互）: E-5 と E-6 の index 範囲が重なる
  const e5 = idxOf("E-5");
  const e6 = idxOf("E-6");
  assert(Math.max(...e5) > Math.min(...e6) && Math.max(...e6) > Math.min(...e5), "7: 第3節は並列（E-5/E-6 が交互）");
  // 得点者がスナップショットに載る（48' E-5 堂安）
  const e48 = tlE!.find((s) => s.event?.matchId === "E-5" && s.clockLabel === "48'");
  assert(e48?.event?.scorer === "堂安", `7: 48' の得点者が堂安（実際: ${e48?.event?.scorer}）`);

  // 既知の中間状態: コスタリカが70'に2-1とした時点で、暫定通過圏が [crc, jpn]（スペイン圏外）
  const at70 = tlE!.find((s) => s.event?.matchId === "E-6" && s.event.homeScore === 2 && s.event.awayScore === 1);
  assert(!!at70, "7: 70' コスタリカ2-1 のスナップが存在");
  assert(sortedAdv(at70!.advancing) === "crc,jpn", `7: 70'時点の暫定通過は日本とコスタリカ（実際: ${at70!.advancing}）`);
  assert(!at70!.advancing.includes("esp"), "7: 70'時点でスペインは暫定圏外");

  // 最終: 第3節末が最終順位、暫定通過は [esp, jpn] に戻る
  const tlLast = tlE![tlE!.length - 1];
  assert(tlLast.kind === "roundEnd" && tlLast.matchday === 3, "7: 最後のスナップは第3節 終了");
  assert(sortedAdv(tlLast.advancing) === "esp,jpn", "7: 最終はスペインと日本が通過");
  assert(tlLast.standings.rows.map((r) => r.teamId).join(",") === "jpn,esp,ger,crc", "7: 第3節末=最終順位");

  // 全8組でタイムライン生成でき、最終スナップ（第3節末）が最終順位と一致・節末は3つ
  for (const gid of CT.groups) {
    const tl = buildTimeline(CT, gid);
    assert(tl !== null, `7: 組${gid} タイムライン生成`);
    const fin = standingsFor(gid);
    assert(
      tl![tl!.length - 1].standings.rows.map((r) => r.teamId).join(",") === fin.rows.map((r) => r.teamId).join(","),
      `7: 組${gid} タイムライン最終=最終順位`,
    );
    assert(tl!.filter((s) => s.kind === "roundEnd").length === 3, `7: 組${gid} は節末3つ（全消化）`);
  }

  // 決定性
  assert(JSON.stringify(buildTimeline(CT, "E")) === JSON.stringify(buildTimeline(CT, "E")), "7: タイムラインは決定的");
  console.log("[timeline] 分刻み＋節末 OK（全8組 最終一致・節末スナップ・組E 70'の暫定逆転・決定性）");
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

  // 進行中の部分タイムライン: 消化済み試合の全ゴール＋完全消化した節の節末スナップ
  const liveI = buildTimeline(ct26, "I");
  assert(liveI !== null, "2026: 組I は goals がありタイムライン生成");
  const iGoals = ct26.matchesByGroup.get("I")!.reduce((n, m) => n + (m.goals?.length ?? 0), 0);
  const iRounds = playedRounds(ct26, "I");
  assert(liveI!.length === iGoals + iRounds, `2026: 組I は 全ゴール(${iGoals})＋節末(${iRounds})`);
  assert(sortedAdv(liveI![liveI!.length - 1].advancing) === "fra,nor", "2026: 組I 第2節後の暫定通過は fra,nor");
  assert(liveI![liveI!.length - 1].kind === "roundEnd", "2026: 組I 最後は消化済み節の節末");
  // 組A（第1〜2節消化・goals 投入済み）。
  const liveA = buildTimeline(ct26, "A");
  assert(liveA !== null, "2026: 組A も goals がありタイムライン生成");
  const aGoals = ct26.matchesByGroup.get("A")!.reduce((n, m) => n + (m.goals?.length ?? 0), 0);
  assert(liveA!.length === aGoals + playedRounds(ct26, "A"), `2026: 組A は 全ゴール(${aGoals})＋節末(${playedRounds(ct26, "A")})`);
  // 組K（第1節のみ消化・goals 投入済み）。節末は1つ。
  const liveK = buildTimeline(ct26, "K");
  assert(liveK !== null, "2026: 組K も第1節消化＋goals でタイムライン生成");
  const kGoals = ct26.matchesByGroup.get("K")!.reduce((n, m) => n + (m.goals?.length ?? 0), 0);
  assert(playedRounds(ct26, "K") === 1, "2026: 組K は第1節のみ消化");
  assert(liveK!.length === kGoals + 1, `2026: 組K は 全ゴール(${kGoals})＋節末(1)`);

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

// ---- 10) 得点ランキング（scorers.ts） ----
{
  const scorers = computeScorers(CT);
  assert(scorers.length > 0, "10: 得点者が1人以上");
  // 得点降順 + rank の整合（先頭=1・同点は共有）
  assert(scorers.every((e, i) => i === 0 || scorers[i - 1].goals >= e.goals), "10: 得点降順");
  assert(scorers[0].rank === 1, "10: 先頭 rank=1");
  assert(scorers.every((e, i) => i === 0 || (scorers[i - 1].goals === e.goals ? e.rank === scorers[i - 1].rank : e.rank > scorers[i - 1].rank)), "10: 同点は rank 共有・差があれば飛ぶ");
  // 表示名にマーカーが残らない（PK/OG 除去）
  assert(scorers.every((e) => !/\((?:PK|OG)\)/i.test(e.player)), "10: 表示名に (PK)/(OG) を含まない");
  // 集計の独立再計算: OG を除いた player 付きゴール総数＝Σgoals、PK 総数＝Σpk
  const allGoals = [...CT.matchesByGroup.values()].flatMap((ms) => ms.flatMap((m) => m.goals ?? []));
  const expCounted = allGoals.filter((g) => g.player && !/\(OG\)/i.test(g.player)).length;
  const expPk = allGoals.filter((g) => g.player && !/\(OG\)/i.test(g.player) && /\(PK\)/i.test(g.player)).length;
  assert(scorers.reduce((n, e) => n + e.goals, 0) === expCounted, "10: 集計総数=OG以外のplayer付きゴール数");
  assert(scorers.reduce((n, e) => n + e.pk, 0) === expPk, "10: PK総数一致");
  // 大会全体＝全グループ横断（複数グループの選手が混在）
  assert(new Set(scorers.map((e) => CT.teamsById.get(e.teamId)!.group)).size > 1, "10: 複数グループの得点者を含む");
  // 決定性
  assert(JSON.stringify(computeScorers(CT)) === JSON.stringify(computeScorers(CT)), "10: 決定的");
  const top = scorers[0];
  console.log(`[scorers] 2022 得点王=${CT.teamsById.get(top.teamId)!.name} ${top.player} ${top.goals}点 / 得点者${scorers.length}人・OK`);
}

// ---- 11) FIFA順位フィールド（validate.ts） ----
{
  // 正常データには fifaRank が入っている
  assert(CT.teamsById.get("bra")!.fifaRank === 1, "11: 2022 ブラジルは FIFA 1位");
  assert(CT.teamsById.get("gha")!.fifaRank === 61, "11: 2022 ガーナは FIFA 61位");
  // 不正な fifaRank（0以下・非整数）を弾く
  const bad = JSON.parse(JSON.stringify(worldcupJson)) as { teams: { fifaRank?: number }[] };
  bad.teams[0].fifaRank = 0;
  assert(!validateTournament(bad).ok, "11: fifaRank=0 を弾く");
  const bad2 = JSON.parse(JSON.stringify(worldcupJson)) as { teams: { fifaRank?: number }[] };
  bad2.teams[0].fifaRank = 1.5;
  assert(!validateTournament(bad2).ok, "11: 非整数 fifaRank を弾く");
  console.log("[fifa] fifaRank 検証 OK（正常ロード＋不正値を弾く）");
}

console.log("✅ smoketest（P1-P5 + 2026/thirds + scorers/fifa）通過");
