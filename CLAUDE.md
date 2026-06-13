# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

ワールドカップ グループステージの **通過条件マトリックス** 可視化サイト（Astro 5 + TypeScript + Tailwind v4 + GitHub Pages 静的サイト、`base: /wcup-tsuuka`）。決着試合のスコア（home 得点 × away 得点）を2軸に振り、各セルに通過結果（①1位 ②2位 / 敗退）を色分け表示する。2022方式（32カ国・8組・各組上位2通過）。初期データは2022年カタール大会の全48試合・実スコア。

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

`src/data/worldcup2022.json` が単一の真実（`meta` / `teams[32]` / `groups[8]` / `matches[48]`）。team id は小文字 FIFA トリコード（表示用は大文字化）。`matches[].score` 省略/null = 未消化。`cards` は任意（無ければフェアプレーは未適用）。`compileTournament()` が `validateTournament()` を通して `CompiledTournament`（Map 索引）にする。

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

- `scripts/smoketest.ts`: ①データ検証（壊した複製を弾く） ②2022 全8組の実順位再現 ③タイブレーク単体（総GD/総GF/h2h/3すくみ抽選/1-2位タイ） ④マトリックス（49セル/既知セル手計算/引分有効/決定性） ⑤status。
- `scripts/domtest.ts`: jsdom で boot→描画→グループ切替→ピボット切替→仮定スコア→共有URL復元。
- エンジン変更後は `npm run typecheck` も（tsx は型を見ない）。

## デプロイ

`.github/workflows/deploy.yml`（push main / workflow_dispatch）= npm ci → **npm test** → npm run build（`GH_USER` env）→ Pages。テストが落ちるとデプロイされない。
