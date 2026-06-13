# WCUP 通過シミュレーター（wcup-tsuuka）

ワールドカップ グループステージで、**決着試合のスコア次第でどの国が・何位で通過するかが変わる**様子を可視化する静的サイト。
ヒーロー機能は **通過条件マトリックス** — ある試合の両チームの得点を縦軸・横軸にとり、各セルにそのスコアでの結果（①1位 ②2位 / 敗退）を色分け表示する。

- 方式: **2022方式**（32カ国・8グループ・各組4チーム総当り・各組上位2が決勝トーナメント進出）
- 初期データ: **2022年カタール大会の全48試合・実スコア**（例: グループE 日本/スペイン/ドイツ/コスタリカ）
- 順位決定: FIFA 2022 タイブレーク（勝点 → 総得失点差 → 総得点 → 当該チーム間の勝点/得失点差/得点 → フェアプレー → 抽選）

公開: https://satory074.github.io/wcup-tsuuka/

## 開発

```bash
npm install
npm run dev        # http://localhost:4321/wcup-tsuuka/
npm run build      # dist/ に静的ファイル生成（型チェック込み）
npm run typecheck  # astro check
npm run test       # smoketest（エンジン）+ domtest（jsdom）
```

## アーキテクチャ

純エンジン（DOM・Date 非依存）と DOM 層をきっぱり分離する（kisei / moshirasu と同じ流儀）。

```
src/
  data/worldcup2022.json     # 単一の真実: meta / teams[32] / groups[8] / matches[48]
  engine/                    # フレームワーク非依存・DOM/Date 非依存の純TS
    types.ts                 # 全型の集約
    validate.ts              # 手書き構造検証（Zod 不使用 = クライアント軽量）
    compile.ts               # raw JSON → CompiledTournament（Map 索引）
    standings.ts             # 順位 + FIFA タイブレーク（正しさの核）
    status.ts                # 通過ステータス（確定/可能性あり/敗退）
    scenario/pivot.ts        # ピボット試合の検出・固定/仮定の振り分け
    scenario/matrix.ts       # 2D マトリックス生成 + 結果グルーピング + 色割当
    format.ts                # ①② などの純フォーマッタ
  app/                       # DOM 層のみ
    main.ts                  # 配線（compile → 計算 → render → URL 同期）
    render.ts                # 唯一の DOM 描画（click/change を data-action 委譲）
    url.ts                   # ?group=E&pivot=E-5&assume=E-1:1-0 の相互変換
  lib/url.ts                 # siteLink()（base path 対応）
  pages/index.astro          # シェル + boot()
scripts/
  smoketest.ts               # エンジン assert（実順位再現・タイブレーク・マトリックス・status）
  domtest.ts                 # jsdom で描画・操作・URL 復元を検証
```

## データの更新（運用）

`src/data/worldcup2022.json` を手で編集する。

- `matches[].score` を省略 / `null` にすると「未消化」扱い（順位計算から除外）。実結果が出たら埋める。
- 未消化試合があると、マトリックスのピボット以外の未消化試合に「仮定スコア」入力欄が出る。
- 別大会に差し替える場合も同スキーマ（32チーム・8組・48試合）を満たせばそのまま動く。
- 編集後は必ず `npm run test`（`validate.ts` が転記ミスを検出する）。

## 通過条件マトリックスの使い方

1. グループ（A〜H）を選ぶ。
2. 「マトリックスの2軸にする試合」（ピボット）を選ぶ。既定は最終節（第3節）の試合。
3. 行＝home チームの得点、列＝away チームの得点。各セル＝そのスコアでの通過結果。
4. 対角（引き分け）セルは枠線付き（サッカーは引分が有効）。最終列・行の `6+` は「6点以上」。
5. 抽選でしか決まらない結果は 🎲 + 斜線ハッチで表示。
