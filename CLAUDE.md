# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

ワールドカップ グループステージの **通過タイムライン** 可視化サイト（Astro 5 + TypeScript + Tailwind v4 + GitHub Pages 静的サイト、`base: /wcup-tsuuka`）。主役は**タイムライン＝横1表**（列＝時間が右へ流れる・行＝チーム・セル＝その時点の順位・列ヘッダに得点選手）。2モード = 最終節の分刻みライブ／大会全体の試合単位。副機能として**通過条件マトリックス**（もしものスコア。home 得点×away 得点の2軸で各スコアの①②/敗退を色分け）を折りたたみで残置。2022方式（32カ国・8組・各組上位2通過）。初期データは2022年カタール大会の全48試合・実スコア＋第3節16試合のゴール分刻み（得点選手名つき）。

```bash
npm install
npm run dev        # http://localhost:4321/wcup-tsuuka/
npm run build      # dist/（型チェック込み）
npm run typecheck  # astro check
npm run test       # tsx scripts/smoketest.ts && tsx scripts/domtest.ts
```

## アーキテクチャの鉄則（厳守）

- **`src/engine/` は純TS**: DOM・Date・フレームワークに触れない。型は `engine/types.ts` に集約。
- **DOM に触れるのは `src/app/`（`render.ts` / `main.ts`）と `src/pages/` のみ**。`render.ts` が唯一の描画層で、イベントはルートの click/change を `data-action` 委譲で捌く（kisei/moshirasu パターン）。
- **データ検証は手書き `engine/validate.ts`（Zod 不使用）**。マトリックスをクライアントで毎回再計算するためエンジンをバンドルする → Zod は載せない。検証は smoketest と boot の両方で走る。
- 内部リンクは `src/lib/url.ts` の `siteLink()`（`import.meta.env.BASE_URL`）。
- `astro.config.mjs` の Tailwind v4 プラグインは型不一致回避で `any` キャスト。`color-scheme: only light` でライト固定。

## データ

`src/data/worldcup2022.json` が単一の真実（`meta` / `teams[32]` / `groups[8]` / `matches[48]`）。team id は小文字 FIFA トリコード（表示用は大文字化）。`matches[].score` 省略/null = 未消化。`cards` は任意（無ければフェアプレーは未適用）。`matches[].goals`（任意）= `{minute, plus?, side, player?}` の配列で**最終節の分刻みタイムライン**用。あれば**本数==score を validate が強制**（転記ミス検出）。`player` は得点選手（日本=漢字・他=カタカナ・OG は "名前(OG)"）。第3節16試合に投入済み。`compileTournament()` が `validateTournament()` を通して `CompiledTournament`（Map 索引）にする。

## タイムライン（`engine/timeline.ts`）

`computeStandings` を再利用し「その時点のスコアを入れた `Match[]`」を作って呼ぶだけ（engine は DOM/Date 非依存を維持）。`buildStageTimeline`=試合単位（全組可）、`buildLiveTimeline`=最終節分刻み（第3節の goals が全試合に揃う組のみ。無ければ null→UI は stage にフォールバック）。**ライブのキックオフは第3節を 0-0（=現在引分扱いで各+1点）として表示**＝放送のライブ表と同じ挙動。各スナップショットは `movements`（直前比の rank 変動 ▲▼）・`advancing`（上位 advancePerGroup の暫定通過圏）・`event.scorer`（得点選手名）を持つ。決定的。**描画（`render.ts`）は横1表**: スナップショット配列を「列」、チームを「行」、セル＝そのスナップショットでのチーム rank、列ヘッダに時間＋得点者。先頭チーム名列は `position:sticky`。`?view=live|stage` で URL 同期。

## 順位決定ロジック（`engine/standings.ts`）= 正しさの核

FIFA 2022 順:
1. 総勝点 → 2. **総**得失点差 → 3. **総**得点
→ ここで並んだチーム**同士の対戦のみ**で: 4. 勝点 → 5. 得失点差 → 6. 得点
→ 7. フェアプレー（カード少。データ無ければ未適用） → 8. 抽選

**落とし穴**:
- step2-3 は**総合**（h2h より先）。よくあるバグ＝h2h GD を総得点より先に適用。→ smoketest が **組H（韓国 vs ウルグアイ：勝点・GD 同で総得点 4 vs 2）** で担保。組E は esp vs ger を総 GD で担保。
- h2h は「現在並んでいる面子だけ」の対戦で計算（`headToHead(cluster, ...)` は cluster を引数で受けキャッシュしない）。並びが変わると面子も変わるため、マトリックスは各セルで順位を**ゼロから再計算**する。
- 6 まで決着しない（カード無し）→ **順位を捏造しない**。同順位を共有し `Standings.undecided=true` + `tiedGroupKey` を立て、UI/セルは「抽選」（🎲・斜線ハッチ）表示。`advances` はブロック全体が通過ラインに収まるときだけ true（1-2位タイ=両者通過、2-3位タイ=どちらが通過か未確定で両者 false）。

## マトリックス（`engine/scenario/matrix.ts`）

`buildMatrix({ct, group, pivotMatchId, assumptions, maxGoals=6})` → 7×7=49セル（row-major、軸 0..6 + `6+` オーバーフロー）。各セルで固定結果（実スコア + 他未消化の仮定）+ ピボット = a:b として `computeStandings` → `deriveOutcome` で「誰がどう通過するか」を抽出（3-4位の抽選など通過に無関係なタイは無視）。同じ `outcomeKey` のセルを同色領域にまとめ凡例を作る。**決定的**（同入力→同出力。smoketest が担保）。対角（a==b）は通常セルだが `is-draw` 枠線（サッカーは引分が有効）。

ピボット運用: 4チーム組の最終節は2試合同時 → 2D は1試合分しか軸に取れない。ピボット以外に未消化試合があれば仮定スコア入力欄を出し、入力に応じて再生成（第2軸は作らない）。初期データは全消化なので仮定欄は出ず、ピボットのスコアを振るだけ。

## テスト

- `scripts/smoketest.ts`: ①データ検証（壊した複製・goals本数!=scoreを弾く） ②2022 全8組の実順位再現 ③タイブレーク単体（総GD/総GF/h2h/3すくみ抽選/1-2位タイ） ④マトリックス（49セル/既知セル手計算/引分有効/決定性） ⑤status ⑦タイムライン（全8組の最終スナップ==最終順位・**組E 70'でコスタリカが暫定通過圏入り→最終は日本/スペイン**・scoreAtClock境界・決定性）。
- `scripts/domtest.ts`: jsdom で boot→描画（タイムライン主役）→モード切替(view=)→グループ切替→ピボット切替→仮定スコア→共有URL(group/view)復元。マトリックスは `<details#matrix-details>` 内。
- エンジン変更後は `npm run typecheck` も（tsx は型を見ない）。

## デプロイ

`.github/workflows/deploy.yml`（push main / workflow_dispatch）= npm ci → **npm test** → npm run build（`GH_USER` env）→ Pages。テストが落ちるとデプロイされない。
