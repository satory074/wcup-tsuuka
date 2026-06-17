# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

ワールドカップ グループステージの **通過タイムライン** 可視化サイト（Astro 5 + TypeScript + Tailwind v4 + GitHub Pages 静的サイト、`base: /wcup-tsuuka`）。主役は**タイムライン＝順位バンプチャート（横1表）**（縦＝順位1〜4・列＝時間が右へ流れる・各セルにその順位の国旗が入り上下に動く・列ヘッダに得点選手）。2モード = 全試合の分刻みライブ（第1〜3節）／大会全体の試合単位。副機能として**通過条件（シナリオ）パネル**（グループの状態に適応：決着済みは「決め手＝タイブレーク解説」、最終節は各チームの「勝/分/敗で何が必要か」、序盤は次戦のみ）を折りたたみで残置。

**2大会を切替表示**（ヘッダの大会タブ＝`?cup=2022|2026`、既定は 2022）:
- **2022方式**（32カ国・8組 A–H・各組上位2通過）= 2022年カタール大会の全48試合・実スコア＋全48試合のゴール分刻み（得点選手名つき）。
- **2026方式**（48カ国・12組 A–L・各組上位2 ＋ **全12組の3位の上位8** が R32 へ）= 2026年北中米大会。**大会進行中につき消化済み試合のみ実スコア**（残りは未消化）。`engine/thirds.ts` の `computeBestThirds` が3位の横断ランキングを算出し、順位表の下に**「3位チーム比較」パネル**（上位8緑・進行中は暫定/抽選）を出す。

エンジンは形式非依存（組数 8/12 は構造から導出）。大会切替は `?cup=` を書いて全再読込（リスナー重複回避・state リセット）。

```bash
npm install
npm run dev        # http://localhost:4321/wcup-tsuuka/
npm run build      # dist/（型チェック込み）
npm run typecheck  # astro check
npm run test       # tsx scripts/smoketest.ts && tsx scripts/domtest.ts
```

## アーキテクチャの鉄則（厳守）

- **`src/engine/` は純TS**: DOM・Date・フレームワークに触れない。型は `engine/types.ts` に集約。
- **DOM に触れるのは `src/app/`（`render.ts` / `main.ts`）と `src/pages/` のみ**。`render.ts` が唯一の描画層で、イベントはルートの click を `data-action` 委譲で捌く（kisei/moshirasu パターン）。
- **データ検証は手書き `engine/validate.ts`（Zod 不使用）**。順位・シナリオ（通過条件）をクライアントで計算するためエンジンをバンドルする → Zod は載せない。検証は smoketest と boot の両方で走る。**形式非依存**: 組数 G は 8 か 12、`teams==4G`・`matches==6G`・各組4チーム6対戦を構造から検証（32/8/48 をハードコードしない）。ラウンドロビン検査は宣言済みの組だけを回す（`GROUP_IDS`＝A–L の宇宙は直接ループしない）。
- `GroupId`/`GROUP_IDS` は A–L（12組）。`compile.ts` は宣言された組（`t.groups`）から `ct.groups` を導出するので 2022→A–H / 2026→A–L に自動追従（タブ・既定組もこれに従う）。
- 内部リンクは `src/lib/url.ts` の `siteLink()`（`import.meta.env.BASE_URL`）。`src/app/url.ts` が表示状態⇔クエリ（`cup`/`group`/`view` のみ。旧 `pivot`/`assume` は廃止）。
- `astro.config.mjs` の Tailwind v4 プラグインは型不一致回避で `any` キャスト。`color-scheme: only light` でライト固定。

## データ

大会ごとに JSON が単一の真実。`src/app/main.ts` が両方を import し `?cup` で選ぶ（`DATA: Record<Cup, unknown>`、既定 2022）。
- `src/data/worldcup2022.json`（`meta` / `teams[32]` / `groups[8]` / `matches[48]`、`advancePerGroup:2`）。**全48試合に goals 投入済み**（0-0 は `[]`）。
- `src/data/worldcup2026.json`（`teams[48]` / `groups[12]` / `matches[72]`、`advancePerGroup:2` ＋ **`advanceBestThirds:8`**）。組分け・日程は2025/12の本抽選ベース。**消化済み試合のみ score**（残りは score 省略＝未消化）、goals は得点者・分が判明した組のみ投入（C/G/H/I/J）。大会進行に応じて手動追記する運用（出典は Wikipedia 各組ページ）。

team id は小文字 FIFA トリコード（表示用は大文字化）。`matches[].score` 省略/null = 未消化。`cards` は任意（無ければフェアプレーは未適用）。`matches[].kickoff`（必須）= ISO 現地時間 `"2022-11-23T16:00"`。タイムラインの絶対時刻並べ替え＆日時帯表示用（validate が形式強制）。`matches[].goals`（任意）= `{minute, plus?, side, player?}` の配列で**分刻みタイムライン**用。あれば**本数==score を validate が強制**（転記ミス検出）。`player` は得点選手（日本=漢字・他=カタカナ・OG は "名前(OG)"、PK は "名前(PK)"）。`meta.advanceBestThirds`（任意・省略時0）= 2026の「3位上位N通過」を駆動。`compileTournament()` が `validateTournament()` を通して `CompiledTournament`（Map 索引）にする。

## ベスト3位（`engine/thirds.ts`）= 2026方式

`computeBestThirds(ct, standingsByGroup)` が各組3位（`rankGroups` で rank=3 クラスタ抽出）を横断ランキング。FIFA 順 = 勝点 → 総得失点差 → 総得点 → フェアプレー（`fairPlayPoints` を3試合合算、無ければタイ） → **抽選（teamId 昇順で決定的）**。head-to-head は不適用（3位同士は未対戦）。上位 `advanceBestThirds` 圏に**ブロック全体が収まるときだけ** `advances`、枠線を跨ぐ抽選は両者 false。**捏造しない**: 組内3位がタイ or 組が未完なら `state:"contention"`＋`undecided` で表面化（描画は「暫定/抽選」バッジ）。per-group の `advances`（上位2のみ）には混ぜず横断オーバーレイとして別管理（シナリオ・status・2022 の不変性を保つ）。`render.ts` の `#best-thirds` パネルは `advanceBestThirds>0` のときだけ中身を出す（2022 は空＝DOM 不変）。

## タイムライン（`engine/timeline.ts`）

`computeStandings` を再利用し「その時点のスコアを入れた `Match[]`」を作って呼ぶだけ（engine は DOM/Date 非依存を維持）。`buildStageTimeline`=試合単位（全組可）、`buildLiveTimeline`=**全試合分刻み**（**消化済み試合**に goals 配列と kickoff が要る。1試合も消化が無い／消化分に goals が無ければ null→UI は stage にフォールバック）。**大会進行中（一部未消化）でも可**: 未消化試合は score 無し＝`kickoffMinutes(m)<=絶対時刻` 判定で常に未消化側に落ちるので順位に寄与しない（2022 は全消化のため出力不変）。全6試合の全ゴールを **絶対時刻 `kickoffMinutes(kickoff)+minute+plus` 昇順**に統合し（被る試合＝同一キックオフは分で並列、被らない試合は時系列で前後に）、各イベント時点で「`kickoffMinutes(m)<=絶対時刻`=running スコア / `>`=未消化」の `Match[]` で `computeStandings`（0-0進行中は現在引分扱い）。`kickoffMinutes` は Date 不使用の純整数（同年前提・順序保証）。キックオフ列は無し（先頭がゴール）。各スナップショットは `movements`（rank 変動 ▲▼）・`advancing`（上位 advancePerGroup）・`event`(matchday・scorer 等)。決定的。**描画（`render.ts`）は順位バンプチャート（横1表）**: スナップ配列を「列」、**行＝順位(位置 1〜4)**、各セル＝`standings.rows[pos]` のチーム国旗（位置ベースで上下＝▲▼）。live ヘッダは『第n節の帯』＋『日時帯（同一 kickoff の連続列を colspan、現地 `M/D HH:MM`）』＋『時刻行』＋『2レーン（試合①/②＝節ごとに (kickoff,matchId) 昇順の slotA/B）』。stage は1行ヘッダ。先頭の順位列・レーンラベル・節帯先頭は `position:sticky`。上位 advancePerGroup 行は緑。`?view=live|stage` で URL 同期。

## 順位決定ロジック（`engine/standings.ts`）= 正しさの核

FIFA 2022 順:
1. 総勝点 → 2. **総**得失点差 → 3. **総**得点
→ ここで並んだチーム**同士の対戦のみ**で: 4. 勝点 → 5. 得失点差 → 6. 得点
→ 7. フェアプレー（カード少。データ無ければ未適用） → 8. 抽選

**落とし穴**:
- step2-3 は**総合**（h2h より先）。よくあるバグ＝h2h GD を総得点より先に適用。→ smoketest が **組H（韓国 vs ウルグアイ：勝点・GD 同で総得点 4 vs 2）** で担保。組E は esp vs ger を総 GD で担保。
- h2h は「現在並んでいる面子だけ」の対戦で計算（`headToHead(cluster, ...)` は cluster を引数で受けキャッシュしない）。並びが変わると面子も変わるため、シナリオは未消化試合の全スコア組合せごとに順位を**ゼロから再計算**する。
- 6 まで決着しない（カード無し）→ **順位を捏造しない**。同順位を共有し `Standings.undecided=true` + `tiedGroupKey` を立て、UI/セルは「抽選」（🎲・斜線ハッチ）表示。`advances` はブロック全体が通過ラインに収まるときだけ true（1-2位タイ=両者通過、2-3位タイ=どちらが通過か未確定で両者 false）。

## 通過条件シナリオ（`engine/scenario/qualify.ts`）

`analyzeGroup(ct, group): GroupQualification`。グループの**状態に適応**して「何が必要か／どう決着したか」を出す（旧マトリックス＝決着済み試合のスコアを格子で振る反実仮想を置換。理由はベストプラクティス調査＝スコア格子は反実仮想＆同時刻2試合を1軸に潰すアンチパターン）。フェーズは未消化試合から導出：

- **`decided`**（全消化）= 隣接順位（1↔2・2↔3）を分けた**決め手**を `decisiveCriterion` で特定し1文に。総合 a–c（勝点→総得失点差→総得点）で差がつけばそれ、同値なら同点クラスタの `headToHead` で h2h（pts→gd→gf）、なお同値で fairplay→lottery。`standings.ts` の **export 済み** `headToHead` 等を再利用し standings 本体は不変。既知ケース＝組H 2↔3=`gf`（総得点4-2）／組E 2↔3=`gd`。**反実仮想は出さない**（ユーザー確定方針）。
- **`final-round`**（最終節だけ未消化＝4チーム組なら同時刻2試合・列挙可能）= 各 alive チームを**自分の試合結果(勝/分/敗)**でバケットし、組内全未消化の**結合スコアを列挙**（`status.ts` と同じ刻み PER_SIDE=6）→ 全通過=`advance`／全敗退=`out`／混在=`depends`（"他会場・得失点しだい"＝同時刻のもう1試合に依存）。勝ちは「k点差以上で必ず通過」に精緻化。`advanced`/`eliminated` は条件を省く。同じ列挙で**前向きタイブレーク予告** `tiebreakWatch`（勝点が等しい連続ランの先頭 rank≤adv＝通過/上位争いに絡むチームを横断 union）を算出し、UI が「○○が勝点で並ぶ可能性。並んだら②総得失点差→③総得点→直接対決の順で決定」を出す（決着前なので *振り返り* ではなく *予告*）。
- **`early`**（複数節残り or 列挙不能）= 条件を捏造せず status・現勝点・**次戦相手**のみ。

決定的（同入力→同出力。smoketest が担保）。`render.ts` の `#scenario`（折りたたみ `<details#scenario-details>`）が decided=「決着の分かれ目」リスト／final-round・early=チーム条件カード（✅⚠️❌）を描画。status バッジは `groupStatus` 由来。

## テスト

- `scripts/smoketest.ts`: ①データ検証（壊した複製・goals本数!=scoreを弾く） ②2022 全8組の実順位再現 ③タイブレーク単体（総GD/総GF/h2h/3すくみ抽選/1-2位タイ） ④通過条件シナリオ（decided=組E/H の決め手 reason・final-round=合成最終節で勝→advance/分→depends/敗→out・early=条件出さず次戦・決定性） ⑤status ⑦タイムライン（全8組の最終スナップ==最終順位・**組E 70'でコスタリカが暫定通過圏入り→最終は日本/スペイン**・scoreAtClock境界・決定性） ⑧2026検証（48/12/72・組Iの部分ライブ・組A/Kはstage） ⑨best-thirds（合成12組の境界/同値跨ぎ/組未完・2026実データは全組contention・2022は空）。
- `scripts/domtest.ts`: jsdom で boot→描画（タイムライン主役）→モード切替(view=)→グループ切替→共有URL(group/view)復元→**大会切替(`?cup=2026`で12タブ＋3位パネル＋早期シナリオのチーム条件カード4、2022は best-thirds 空・decided は決め手ノート2件)**。シナリオは `<details#scenario-details>` 内。**既定 cup は 2022**（既存 URL・既存 domtest を温存）。
- エンジン変更後は `npm run typecheck` も（tsx は型を見ない）。

## デプロイ

`.github/workflows/deploy.yml`（push main / workflow_dispatch）= npm ci → **npm test** → npm run build（`GH_USER` env）→ Pages。テストが落ちるとデプロイされない。
