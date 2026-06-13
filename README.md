# WCUP 通過シミュレーター（wcup-tsuuka）

ワールドカップ グループステージで、**いつ誰が得点して、その時点で通過国がどう入れ替わったか**を可視化する静的サイト。

ヒーロー機能は **タイムライン** — 「この時間に得点 → この時点ではこの順位」を縦に並べたスナップショット表示。2モード:
- **最終節（分刻み）**: 同時刻開催の2試合のゴールを1本の時間軸に統合し、ライブ順位・暫定通過圏（上位2）が分刻みで入れ替わる様子（例: グループE で 70' にコスタリカが2-1とした瞬間、暫定でスペインを追い落とし通過圏入り→ドイツの逆転で元に戻る）。
- **大会全体（試合単位）**: 第1節→第3節を試合単位で順位推移。

副機能（折りたたみ）として **通過条件マトリックス**（もしものスコア）も残置 — ある試合の両チームの得点を縦横軸にとり、各スコアでの結果（①1位 ②2位 / 敗退）を色分け表示。

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
    timeline.ts              # タイムライン（試合単位＋最終節分刻み・computeStandings 再利用）
    scenario/pivot.ts        # ピボット試合の検出・固定/仮定の振り分け
    scenario/matrix.ts       # 2D マトリックス生成 + 結果グルーピング + 色割当
    format.ts                # ①② などの純フォーマッタ
  app/                       # DOM 層のみ
    main.ts                  # 配線（compile → 計算 → render → URL 同期）
    render.ts                # 唯一の DOM 描画（click/change を data-action 委譲）
    url.ts                   # ?group=E&view=live&pivot=E-5 の相互変換
  lib/url.ts                 # siteLink()（base path 対応）
  pages/index.astro          # シェル + boot()
scripts/
  smoketest.ts               # エンジン assert（実順位再現・タイブレーク・マトリックス・status）
  domtest.ts                 # jsdom で描画・操作・URL 復元を検証
```

## データの更新（運用）

`src/data/worldcup2022.json` を手で編集する。

- `matches[].score` を省略 / `null` にすると「未消化」扱い（順位計算から除外）。実結果が出たら埋める。
- `matches[].goals`（任意）= 得点イベント `{ "minute": 70, "plus": 5(任意), "side": "home"|"away" }` の配列。**最終節（第3節）の分刻みタイムライン**に使う。`side` は得点が入る側（オウンゴールは利益を得た側）。**本数は score と一致必須**（`validate.ts` が検出）。第3節16試合に投入済み。
- 別大会に差し替える場合も同スキーマ（32チーム・8組・48試合）を満たせばそのまま動く。最終節に `goals` を入れればライブタイムラインが有効化される。
- 編集後は必ず `npm run test`（`validate.ts` が転記ミス・本数不一致を検出する）。

## タイムラインの使い方

1. グループ（A〜H）を選ぶ。
2. モードを選ぶ:
   - **最終節（分刻み）**: 第3節の同時刻2試合のゴールを統合し、キックオフ→各ゴールごとに「その時点の順位表」を縦に表示。🟩 が暫定通過圏（上位2）、▲▼ が直前からの順位変動。
   - **大会全体（試合単位）**: 第1→3節を試合完了ごとにスナップショット。
3. `?group=E&view=live` のように URL で共有・復元できる。

### もしものスコア（通過条件マトリックス・折りたたみ）

下部の「もしものスコア」を開くと従来のマトリックスが使える。行＝home 得点 × 列＝away 得点で各スコアの通過結果を色分け。対角（引分）は枠線、`6+` は「6点以上」、抽選は 🎲＋斜線ハッチ。
