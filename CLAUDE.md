# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

ワールドカップ グループステージの **通過タイムライン** 可視化サイト（Astro 5 + TypeScript + Tailwind v4 + GitHub Pages 静的サイト、`base: /wcup-tsuuka`）。主役は**タイムライン＝順位バンプチャート（SVG 折れ線）**（縦軸＝順位1〜4・横軸＝イベント時系列・チームごとに1本の色付き折れ線で順位推移を描く。全節が1画面に収まり横スクロール不要、右端に最終順位の国旗+略号、点＝得点で動いた瞬間でツールチップに得点者）。**タイムラインは単一**（全試合の分刻みゴール）＝表示モード切替は廃止。各節（matchday）が完全消化されると、その節の終了時点に**節末スナップ（◇＝中空リングの頂点）**を1つ差し込み、**対戦した両チームそれぞれのレーン上にその節の試合スコアをチャート上に直接描く**（`.tl-round-score`・1スコアは両参加チームのレーンに2回出る＝各レーンに「自分が戦った試合結果」が乗り、対戦していない第3チームのレーンと重ならない・トリコードは各チームの線色で色分け）。後半(>45')の得点点は `is-2nd`＝濃い縁取り(◉)で前半(●)と区別。チャート下には**得点タイムライン（節カラム・常設 `<section.tl-log>`＝第1/2/3節を横並び）**＝各列が 見出し→各ゴール（時刻・⚽得点者・スコア）→「第n節 結果」（両試合スコア）。全幅を使い高さを圧縮（順位表が繰り上がる）。2026進行中は消化済みの節数ぶんの列。FIFA世界ランキングは**順位表に併記**（`(FIFA ◯位)`・専用パネルは無し）。detail は**3領域グリッド**（レイアウトレビュー反映）＝**全幅の主役チャート（`#detail-timeline`）を先頭**に置き（fold 上）、その下の2カラム＝本文（`#detail-main`）＋**右サイドバーに得点ランキング（大会全体・sticky・`#detail-side`）**。本文の並びは**順位表→ステータス→（3位比較）→日程・結果→シナリオ**で、**日程カルーセルは主役の下＝順位表の後ろへ降格**（NN/g「primary を先頭・水平スクロールは secondary」）。sticky サイドバーは背の高い本文と並ぶので隙間が出ない。**日程・結果（`#schedule`＝全試合の横並びカルーセル `.sched-carousel`）**は全グループの全試合（2022:48／2026:72）を**キックオフ時系列**で1枚=1試合のカード（日時＋組バッジ＋home/away の旗・略号・得点／未消化は `–`）に並べ横スクロール、**該当グループを強調**（`.is-current`）し初期表示でそこへ自動横スクロール。副機能として **通過条件（シナリオ）パネル**（グループの状態に適応：決着済みは「決め手＝タイブレーク解説」、最終節は各チームの「勝/分/敗で何が必要か」＋タイブレーク予告、序盤＝複数節残りは**非表示**＝シナリオがある時だけ出す）。

**決勝トーナメント ブラケット（`#knockout`）は scope 非依存＝一覧・詳細の両方で全幅常時表示**（`#overview`/`#detail-view` の兄弟）。詳細は `## 決勝トーナメント ブラケット` を参照。

**表示範囲（scope）= 2つ**（ヘッダ下「一覧／詳細」トグル＝`?scope=overview`、既定は **detail**＝上記の1グループ詳細＝タイムライン主役）:
- **detail**（既定）= 3領域グリッド。**全幅の主役チャート `#detail-timeline`（先頭）** → 2カラム＝本文（`#detail-main`＝1グループの順位表〔FIFA順位併記・`max-width:660`〕＋通過ステータス＋〔3位比較〕＋**日程・結果カルーセル**＋シナリオ）＋右サイドバー（`#detail-side`＝得点ランキング・大会全体・sticky）。日程カルーセルは順位表の後ろへ降格（主役を fold 上に）。`?group=` の共有URLを温存。狭幅（980px）で縦積み（チャート→本文→サイドバー）。
- **overview**（一覧）= 全グループのコンパクト順位表カードをレスポンシブグリッド表示（NBC/ESPN 型）。各カード＝組文字＋**進行フェーズバッジ**（確定/最終節/進行中）＋4行ミニ表（順位・国旗・略号・得失点差・勝点。上位2緑＋カットオフ点線・🎲抽選・未消化は「– –」）。2026 はグリッド下に全幅でベスト3位表（既存 `bestThirdsHTML` 再利用）。カードクリック（`data-action="drill-group"`）でそのグループの **detail** へドリルイン。一覧は `Standings` の純投影のみで、列挙コストのある `analyzeGroup`/`groupStatus`/timeline は detail のときだけ計算する（フェーズバッジは消化試合数からの安価な `derivePhase` で導出）。

**3大会を切替表示**（ヘッダの大会タブ＝`?cup=2018|2022|2026`、既定は 2022）:
- **2018方式**（32カ国・8組 A–H・各組上位2通過）= 2018年ロシア大会の全48試合・実スコア＋全48試合のゴール分刻み（得点選手名つき）。**キックオフは全試合モスクワ時間(MSK)に正規化**（露は5時間帯にまたがるため、単一タイムラインの絶対時刻順を保つ）。**組Hはフェアプレー通過の実データケース**: 日本とセネガルが勝点4・総得失点差0・総得点4・直接対決2-2で完全同値→警告数（日本4枚 < セネガル6枚）で日本が2位通過。これを表現するため組Hの全6試合に `cards` を投入し、`standings.ts` が**基準g フェアプレーを抽選の前に適用**する（順位決定ロジック節参照）。形式は2022と同一なので新データファイル1つ＋薄い配線（`Cup`型／`DATA`／`CUPS`）で追加。
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
- **DOM に触れるのは `src/app/`（`render.ts` / `main.ts`）と `src/pages/` のみ**。`render.ts` が唯一の描画層で、イベントはルートの click を `data-action` 委譲で捌く（kisei/moshirasu パターン）。ホバー連動ハイライトも `pointerover`/`pointerleave` 委譲＝`data-team` を持つ要素（チャートの線/点/右端ラベル・凡例・順位表行）をまたいで `.is-hl`/`.is-hovering` を同期。
- **データ検証は手書き `engine/validate.ts`（Zod 不使用）**。順位・シナリオ（通過条件）をクライアントで計算するためエンジンをバンドルする → Zod は載せない。検証は smoketest と boot の両方で走る。**形式非依存**: 組数 G は 8 か 12、`teams==4G`・`matches==6G`・各組4チーム6対戦を構造から検証（32/8/48 をハードコードしない）。ラウンドロビン検査は宣言済みの組だけを回す（`GROUP_IDS`＝A–L の宇宙は直接ループしない）。
- `GroupId`/`GROUP_IDS` は A–L（12組）。`compile.ts` は宣言された組（`t.groups`）から `ct.groups` を導出するので 2022→A–H / 2026→A–L に自動追従（タブ・既定組もこれに従う）。
- 内部リンクは `src/lib/url.ts` の `siteLink()`（`import.meta.env.BASE_URL`）。**`<head>` の手書きアセットリンク（favicon・OG画像）も必ず `siteLink()` 経由**＝`${import.meta.env.BASE_URL}foo` の直結は `trailingSlash:"ignore"` で BASE_URL に末尾スラッシュが無く `/wcup-tsuukafoo`（404）になる（実バグだった。Astro 生成のCSS/JSリンクは自前で正しく付くが手書きは付かない）。`src/app/url.ts` が表示状態⇔クエリ（`cup`/`group`/`scope`。既定 `scope=detail` は URL に出さない＝既存の共有URLを温存。旧 `view`/`pivot`/`assume` は廃止＝付いていても decode が無視するので旧URLは壊れない）。
- **OG/サムネ画像**: `public/og.png`（1200×630・順位バンプチャート意匠、ソースは `public/og.svg`）を `<head>` の `og:image`/`twitter:image`（絶対URL＝`new URL(siteLink("og.png"), import.meta.env.SITE)`）で配信。これが基盤サイト basecamp の「作品」一覧サムネにも使われる（basecamp 側が homepage の og:image を自動抽出。`og:image` が無いと汎用 placeholder になる）。`og.svg` を変えたら basecamp の sharp 等で `og.png` を再ラスタライズ。
- `astro.config.mjs` の Tailwind v4 プラグインは型不一致回避で `any` キャスト。配色は全て CSS 変数トークン（`--ts-*`=タイプスケール／`--sp-*`=スペーシング／色トークン）に集約。既定はライトで `color-scheme: light dark`、OS ダーク時は `@media (prefers-color-scheme: dark)` が色トークンだけを暗色に差し替える（ブラウザ強制反転の濁りを避けるため自前ダークを持つ）。

## データ

大会ごとに JSON が単一の真実。`src/app/main.ts` が3つを import し `?cup` で選ぶ（`DATA: Record<Cup, unknown>`、既定 2022）。
- `src/data/worldcup2018.json`（`meta` / `teams[32]` / `groups[8]` / `matches[48]`、`advancePerGroup:2`）。**全48試合に goals 投入済み**（消化済み大会、0-0 は `[]`）。**kickoff は全試合 MSK 正規化**。**組Hの6試合のみ `cards`**（日本＝黄4／セネガル＝黄6＝フェアプレー通過の根拠）。出典は Wikipedia 各組ページ（ja）。
- `src/data/worldcup2022.json`（`meta` / `teams[32]` / `groups[8]` / `matches[48]`、`advancePerGroup:2`）。**全48試合に goals 投入済み**（0-0 は `[]`）。
- `src/data/worldcup2026.json`（`teams[48]` / `groups[12]` / `matches[72]`、`advancePerGroup:2` ＋ **`advanceBestThirds:8`**）。組分け・日程は2025/12の本抽選ベース。**消化済み試合のみ score**（残りは score 省略＝未消化）、goals（得点者・分）は消化済み全試合に投入済み（2026-06-26 時点で全組 第1〜2節＋組A〜Fは第3節も消化＝決着済み、残る組G〜Lは最終節のみ未消化）＝全組でライブ年表が有効。大会進行に応じて手動追記する運用（出典は Wikipedia 各組ページ、直近試合は ESPN 等でクロス検証）。
- `src/data/flag-colors.json`（タイムライン線色用）＝ team id → **国旗の主要色 HEX の順序付き配列**（識別性の高い順・白/黒は後ろ）。全3大会の全 team id（58カ国＝2018追加で rus/per/isl/nga が加わった）を網羅。`engine/validate.ts` の `validateFlagColors(raw, teamIds)` が HEX 形式＋**カバレッジ**（全 id に色がある）を強制＝2026 に新チーム追加時に色未登録なら smoketest→CI で落ちる。出典は flagcolorcodes.com / Wikipedia 各国旗。線色の算出は `src/app/flagColors.ts`（タイムライン節参照）。

team id は小文字 FIFA トリコード（表示用は大文字化）。`matches[].score` 省略/null = 未消化。`cards`（`{home:{y,r}, away:{y,r}}`）は任意で、あると `standings.ts` が**基準g フェアプレー**を抽選の前に適用する（2018 組Hのみ投入・2022/2026 は皆無＝従来どおり）。`matches[].kickoff`（必須）= ISO 現地時間 `"2022-11-23T16:00"`（2018 は MSK 正規化）。タイムラインの絶対時刻並べ替え＆日時帯表示用（validate が形式強制）。`matches[].goals`（任意）= `{minute, plus?, side, player?}` の配列で**分刻みタイムライン**用。あれば**本数==score を validate が強制**（転記ミス検出）。`player` は得点選手（日本=漢字・他=カタカナ・OG は "名前(OG)"＝side は得点が記録された側、PK は "名前(PK)"）。`teams[].fifaRank`（任意・正整数）= 大会ごとの時点の **FIFA世界ランキング**（2018=2018年6月／2022=2022年10月／2026=2026年6月の大会直前順位）。順位表・一覧カードに併記する（validate が正整数を強制）。`meta.advanceBestThirds`（任意・省略時0）= 2026の「3位上位N通過」を駆動。`compileTournament()` が `validateTournament()` を通して `CompiledTournament`（Map 索引）にする。

## FIFAランキング・得点ランキング

- **FIFA順位**（`teams[].fifaRank`）: `render.ts` が順位表の国名横に `(FIFA ◯位)`（`fifaInline`）、一覧ミニカードに小さく `FIFA◯`（`.mini-fifa`）を併記する**のみ**（専用パネルは廃止＝順位表で足りるため）。
- **得点ランキング**（`engine/scorers.ts` の `computeScorers(ct): ScorerEntry[]`）: 全グループ全 `goals` を横断集計（純TS・決定的）。**オウンゴール（`(OG)`）は除外・PK（`(PK)`）は計上**し表示名からマーカーを除く。得点降順 → teamId → player で安定ソート、同得点は順位共有（標準競技順位）。`main.ts` が大会全体で1回算出し RenderView に渡す。`render.ts` の `#top-scorers` パネル（`topScorersHTML`）が上位N＋末尾同点を表示（2026 は進行中＝「暫定」注記）。detail では**右サイドバー `#detail-side`（sticky）**に置く。

## ベスト3位（`engine/thirds.ts`）= 2026方式

`computeBestThirds(ct, standingsByGroup)` が各組3位（`rankGroups` で rank=3 クラスタ抽出）を横断ランキング。FIFA 順 = 勝点 → 総得失点差 → 総得点 → フェアプレー（`fairPlayPoints` を3試合合算、無ければタイ） → **抽選（teamId 昇順で決定的）**。head-to-head は不適用（3位同士は未対戦）。上位 `advanceBestThirds` 圏に**ブロック全体が収まるときだけ** `advances`、枠線を跨ぐ抽選は両者 false。**捏造しない**: 組内3位がタイ or 組が未完なら `state:"contention"`＋`undecided` で表面化（描画は「暫定/抽選」バッジ）。per-group の `advances`（上位2のみ）には混ぜず横断オーバーレイとして別管理（シナリオ・status・2022 の不変性を保つ）。`render.ts` の `#best-thirds` パネルは `advanceBestThirds>0` のときだけ中身を出す（2022 は空＝DOM 不変）。

## 決勝トーナメント ブラケット（`engine/knockout.ts`）

ノックアウトの**組み合わせ**を表示。ブラケット**テンプレートはエンジン定数**（フォーマット由来）で、`bracketTemplate(ct)` が組数で分岐＝12組(2026)→`R32_2026`（R32 M73-104。出典 Wikipedia "2026 FIFA World Cup knockout stage"）／8組(2018/2022)→`R16_8GROUP`（標準32カ国ブラケットのツリー）。**JSONは増やさない**（KO結果は当データに無い＝`validate.ts` 不変・2022 の不変契約維持）。`computeKnockout(ct, standingsByGroup)` が各スロットを解決：`winner`/`runnerup` は対象組が**全消化済み(`played===3`)かつ当該 rank が単独確定**のときのみ実 `teamId`、それ以外は `undecided` でスロットラベル（"1A"/"2B"）。`third`（「勝者vs3位」8枠）は **FIFA 495通り組合せ表を実装せず**集合ラベル（"3位 A/B/C/D/F"）のまま＝割当しない。`winnerOf`/`loserOf`（R16以降）は KO結果が無いので常に未確定（"M75 勝者"）。**不変条件**: `teamId` があれば `undecided=false`／無ければ `true`（捏造しない）。`render.ts` の `knockoutHTML()` が `#knockout`（`#overview`/`#detail-view` の兄弟・**一覧/詳細の両方で常時表示**・早期returnより前に更新）にラウンド列ブラケットを描画。確定枠は旗+略号（`data-team`＝`#knockout` 専用 hover で `.is-hl` 連動）、未確定は破線スロット。2026は `view.bestThirds.entries.filter(advances)` を「暫定通過の3位（8枠）」プールとして併記（どの枠かは未割当と明記）。**将来**: 495表での3位厳密割当・KOスコア入力は out of scope。

## タイムライン（`engine/timeline.ts`）

`computeStandings` を再利用し「その時点のスコアを入れた `Match[]`」を作って呼ぶだけ（engine は DOM/Date 非依存を維持）。**唯一のビルダー `buildTimeline`**＝全試合分刻み（**消化済み試合**に goals 配列と kickoff が要る。返せるスナップが0なら null→UI は空メッセージ）。**大会進行中（一部未消化）でも可**: 未消化試合は score 無し＝`kickoffMinutes(m)<=絶対時刻` 判定で常に未消化側に落ちるので順位に寄与しない（2022 は全消化のため出力不変）。全6試合の全ゴールを **絶対時刻 `kickoffMinutes(kickoff)+minute+plus` 昇順**に統合し（被る試合＝同一キックオフは分で並列、被らない試合は時系列で前後に）、さらに**完全消化した節ごとに節末イベント**（abs = その節の最遅 kickoff + `ROUND_END_OFFSET`=600分＝節内最後のゴールより後・翌日キックオフ +1440分より前）を挿入。各イベント時点で「`kickoffMinutes(m)<=絶対時刻`=running スコア / `>`=未消化」の `Match[]` で `computeStandings`（0-0進行中は現在引分扱い）。`kickoffMinutes` は Date 不使用の純整数（同年前提・順序保証）。各スナップショットは `kind`(`"goal"`/`"roundEnd"`)・`matchday`（節バンド判定用にトップレベル保持）・`movements`・`advancing`・`event`(goal時)・`roundResults`(roundEnd時＝その節の各試合最終スコア)。決定的。**描画（`render.ts` の `timelineHTML`）は順位バンプチャート（SVG 折れ線）**: スナップ配列を x 軸（イベント時系列・等間隔）、`standings.rows` の位置を y 軸（順位1〜4）にし、**チームごとに1本の `<polyline>`**（線色は**各国の国旗の色から算出**＝`src/app/flagColors.ts` の `assignGroupColors`。`src/data/flag-colors.json` の旗色 HEX を基に、識別色＝先頭色を明度クランプ(`LUM_MIN/LUM_MAX`)して主色にし、同グループ内で知覚色差 CIE76 ΔE が `DELTA_MIN` 未満なら旗の第2色→色相/明度ニュッジ→最終フォールバックは Okabe-Ito へ退避して4本を必ず判別可能に分離。決定的＝最終順位順に割当・DOM/Date/乱数なし）。最終的に通過圏外の線/点/ラベルは `.is-out` で淡く＝通過2本に注目を集める。凡例・順位表行・線の hover で対象を `.is-hl`、チャートに `.is-hovering` を付け他を減光（`data-team` 同期）。各列に `<circle.tl-dot>`（得点した国は `is-scorer` で大きめ・後半得点は `is-2nd`＝濃い縁取り・節末列は `is-roundend`＝色付き中空リングのチェックポイント・`<title>` に得点者または節の試合結果）、右端に `<text.tl-endlabel>`（最終順位の位置に国旗+略号）、左に順位ラベル `.tl-poslabel`、上位 advancePerGroup は淡緑バンド `.tl-advband`、節境界は `.tl-md`（第n節ラベル＋ kickoff 由来の日付 `M/D` を `.tl-md-date` で併記。節末列は同 `matchday` なので同じ節バンドの右端に入る）＋破線 `.tl-mdsep`。**x座標は非線形**＝列ごとに1単位進み**節末列の直後にガター(`GUT`)を挿入**（`us[]`/`span` を計算し `xAt` がそこへマップ）。そのガターに**対戦した両チームそれぞれのレーン上の高さで `<text.tl-round-score>`**（`MEX 2-0 RSA` のトリコード表記・不透明チップ `.tl-round-chip`＋細い白ハロー・1スコアは両参加チームのレーンに2回出る＝各レーンに「自分の試合結果」が乗る＝第3チームのレーンと重ならない・トリコードは各チームの線色 `colorOf` で色分け・節末リングに被らないよう +12 右へ・4チームのレーンは rowGap=72 間隔なので縦は重ならない・等幅フォント幅からチップ幅を概算）を描き、**節終了時の各試合スコアをチャート上に直接表示**（`.tl-mdsep` はスコアと被らないよう次バンド寄りに置く）。`viewBox` 固定 + `width:100%` で全節が1画面に収まり、`.tl-chart-wrap{min-width}` 未満の幅でのみ横スクロール。チャート下に色対応の凡例 `.tl-legend`（中央寄せ）＋**得点タイムライン（節カラム `.tlog-cols`>`.tlog-col`・`<section.tl-log>` 常設＝第1/2/3節を横並び・`flex:1 1 300px` で全幅活用・狭幅は `flex-wrap` で縦積み）**＝各列が 節見出し `.tlog-md-head` → ゴール行 `.tlog-goal`（`時刻・⚽得点者・スコア`、左ボーダー色＝得点国の線色）→「第n節 結果」ブロック `.tlog-round`（`roundResults` の両試合スコア）。表示モード切替は廃止＝URL に `view` は無い。エンジンは不変（`Snapshot[]` の位置情報・`event`/`roundResults` をそのまま使う）。

## 順位決定ロジック（`engine/standings.ts`）= 正しさの核

FIFA 2022 順:
1. 総勝点 → 2. **総**得失点差 → 3. **総**得点
→ ここで並んだチーム**同士の対戦のみ**で: 4. 勝点 → 5. 得失点差 → 6. 得点
→ 7. フェアプレー（カード少。`cards` データがある面子のみ） → 8. 抽選

**落とし穴**:
- step2-3 は**総合**（h2h より先）。よくあるバグ＝h2h GD を総得点より先に適用。→ smoketest が **組H（韓国 vs ウルグアイ：勝点・GD 同で総得点 4 vs 2）** で担保。組E は esp vs ger を総 GD で担保。
- h2h は「現在並んでいる面子だけ」の対戦で計算（`headToHead(cluster, ...)` は cluster を引数で受けキャッシュしない）。並びが変わると面子も変わるため、シナリオは未消化試合の全スコア組合せごとに順位を**ゼロから再計算**する。
- **step7 フェアプレー（基準g）**は h2h（6）でも分割できなかったクラスタに、抽選の前に適用する（`resolveCluster` 内 `splitByFairPlay`）。`teamFairPlay` が**消化済み試合すべてに `cards` があるチームのみ**確定値を返し（1試合でも欠落＝undefined＝そのチームは基準g 不適用→抽選へ）、イエロー=1・レッド=4 の少ない順で分割する。**カード皆無の 2022/2026 は全チーム undefined＝従来どおり抽選**（挙動不変）。実例＝**2018 組H**: 日本(黄4) < セネガル(黄6) で日本が2位に確定（`undecided=false`）。`viewAt` がカードを含む試合を spread するためタイムライン途中スナップにもカードが渡るが、a–f が完全同値になるのは最終節後だけなので実害なし。
- 7 まで決着しない（カード無し or カードでも同値）→ **順位を捏造しない**。同順位を共有し `Standings.undecided=true` + `tiedGroupKey` を立て、UI/セルは「抽選」（🎲・斜線ハッチ）表示。`advances` はブロック全体が通過ラインに収まるときだけ true（1-2位タイ=両者通過、2-3位タイ=どちらが通過か未確定で両者 false）。

## 通過条件シナリオ（`engine/scenario/qualify.ts`）

`analyzeGroup(ct, group): GroupQualification`。グループの**状態に適応**して「何が必要か／どう決着したか」を出す（旧マトリックス＝決着済み試合のスコアを格子で振る反実仮想を置換。理由はベストプラクティス調査＝スコア格子は反実仮想＆同時刻2試合を1軸に潰すアンチパターン）。フェーズは未消化試合から導出：

- **`decided`**（全消化）= 隣接順位（1↔2・2↔3）を分けた**決め手**を `decisiveCriterion` で特定し1文に。総合 a–c（勝点→総得失点差→総得点）で差がつけばそれ、同値なら同点クラスタの `headToHead` で h2h（pts→gd→gf）、なお同値で fairplay→lottery。`standings.ts` の **export 済み** `headToHead` 等を再利用し standings 本体は不変。既知ケース＝組H 2↔3=`gf`（総得点4-2）／組E 2↔3=`gd`。**反実仮想は出さない**（ユーザー確定方針）。
- **`final-round`**（最終節だけ未消化＝4チーム組なら同時刻2試合・列挙可能）= 各 alive チームを**自分の試合結果(勝/分/敗)**でバケットし、組内全未消化の**結合スコアを列挙**（`status.ts` と同じ刻み PER_SIDE=6）→ 全通過=`advance`／全敗退=`out`／混在=`depends`（"他会場・得失点しだい"＝同時刻のもう1試合に依存）。勝ちは「k点差以上で必ず通過」に精緻化。`advanced`/`eliminated` は条件を省く。同じ列挙で**前向きタイブレーク予告** `tiebreakWatch`（勝点が等しい連続ランの先頭 rank≤adv＝通過/上位争いに絡むチームを横断 union）を算出し、UI が「○○が勝点で並ぶ可能性。並んだら②総得失点差→③総得点→直接対決の順で決定」を出す（決着前なので *振り返り* ではなく *予告*）。
- **`early`**（複数節残り or 列挙不能）= シナリオが定まらないため**パネルごと非表示**（engine は phase=`early`・next 相手を返すが `render.ts` が `#scenario-details` を `hidden` にする＝順位表・status・タイムラインだけ）。

決定的（同入力→同出力。smoketest が担保）。`render.ts` の `#scenario`（折りたたみ `<details#scenario-details>`）が decided=「決着の分かれ目」リスト／final-round・early=チーム条件カード（✅⚠️❌）を描画。status バッジは `groupStatus` 由来。

## テスト

- `scripts/smoketest.ts`: ①データ検証（壊した複製・goals本数!=scoreを弾く） ②2022 全8組の実順位再現 ③タイブレーク単体（総GD/総GF/h2h/3すくみ抽選/1-2位タイ） ④通過条件シナリオ（decided=組E/H の決め手 reason・final-round=合成最終節で勝→advance/分→depends/敗→out・early=条件出さず次戦・決定性） ⑤status ⑦タイムライン（`buildTimeline`＝全8組の最終スナップ==最終順位・**節末スナップ 3つ/組・各 roundResults 2試合・第3節末=最終順位**・**組E 70'でコスタリカが暫定通過圏入り→最終は日本/スペイン**・scoreAtClock境界・決定性） ⑧2026検証（48/12/72・消化済み全試合に goals→組I/A/K すべて部分タイムライン生成＝消化分ゴール数＋完全消化節の節末数と一致） ⑨best-thirds（合成12組の境界/同値跨ぎ/組未完・2026実データは全組contention・2022は空） ⑩得点ランキング（OG除外・PK計上・マーカー除去・集計総数の独立再計算・複数グループ横断・決定性。2022得点王=エクアドルのバレンシア3点） ⑪fifaRank 検証（正常ロード＋0/非整数を弾く） ⑫旗色由来の線色（`flagColors.ts`＝両大会の全 team id カバレッジ・HEX 形式・未登録/不正HEXを弾く・**全28組で同グループ4色が ΔE≥`DELTA_MIN` 分離**・どの色も `LUM_MAX` 以下＝白地で淡すぎない・色割当の決定性・hex往復/同色ΔE=0 のヘルパ健全性）。⑬2018検証（32/8/48・全試合 goals／実順位再現＝組A/B/F/G ＋ **★組H フェアプレー: 日本2位通過・セネガル3位・`undecided=false`・`analyzeGroup` の2↔3決め手が `fairplay`**＝基準g end-to-end／タイムライン組A=17ゴール+3節末=20スナップ・最終1位 uru／得点王ケイン5点・決定性）。 ⑭決勝トーナメント（`computeKnockout`）＝2026 R32 全32試合・R32=16・6ラウンド・`teamId↔undecided` 整合（捏造しない）・確定組由来は実チーム（M73=2A/2B両確定・M75=組F1位 ned）・未確定組は TBD（M83=2K/2L）・3位枠8つは集合ラベル・R16以降は全未確定・決定性／2018・2022 R16=全16試合・R16=8・全消化で R16 全枠が実チーム・QF以降未確定。
- `scripts/domtest.ts`: jsdom で boot→描画（**並び順＝全幅チャート`#detail-timeline`先頭→本文は順位表が先・日程`#schedule`はその下へ降格・全試合カルーセル `.sched-card` 48(2022)/72(2026)・該当組 `.is-current` 6・2022は `.is-upcoming` 0／2026は ≥1**・タイムライン主役＝順位バンプチャート `svg.tl-chart`：線`.tl-line`×4（**inline stroke は旗由来で4色に分離＝Set サイズ4**）・頂点`.tl-dot`・得点列`.tl-dot.is-scorer`・**節末リング`.tl-dot.is-roundend`**・節ラベル`.tl-md`・右端`.tl-endlabel`・凡例`.tl-legend`。組A=**(15ゴール+3節末)×4=72頂点**・is-roundend 12・**節結果スコア`.tl-round-score`12（3節×4チーム＝両参加チームのレーンに2回）**・最終1位=オランダ・ツールチップ「ガクポ」。節カラムログ`.tl-log .tlog-cols .tlog-col`3＝`.tlog-goal`15・`.tlog-md-head`3・`.tlog-round`3。順位表`.team-fifa`4（**FIFA専用パネルは廃止＝`#fifa-ranking .fifa-item`無し**）・得点ランキングは**右サイドバー`#detail-side #top-scorers`**にバレンシア。表示モードトグルは廃止＝`.view-toggle`無し）→**単一タイムライン＋節末＋節カラムログ(組E)**→グループ切替→共有URL(group)復元→**旧 `?view=` 後方互換（無視され URL から消える）**→**大会切替(`?cup=2026`で**3**タブ＋12組＋3位パネル＋decided(組A 全消化)はシナリオに決着の分かれ目`.scenario-boundaries`・final-round(組K)はチーム条件カード`.scenario-teams`、2022は best-thirds 空・decided は決め手ノート2件)**→**`?cup=2018`(3タブ＋8組＋全48カード全消化＝`.is-upcoming`0＋best-thirds空＋組Hで順位表2行目=`data-team="jpn"`＝フェアプレー確定で`.tie-badge`0)**→**一覧(scope=overview)切替**（2022=`.mini-group` 8枚×4行=32・上位2緑16・`.mini-fifa`32・ベスト3位表なし→カードクリックで detail E にドリルイン／2026=`scope=overview` 復元で12枚＋`.overview-bt .bt-table`＋`.bt-note`）。既定は detail。シナリオは `<details#scenario-details>` 内。**既定 cup は 2022**。**決勝トーナメント `#knockout`**＝2026 detail/overview の両方で `.ko-match` 32（R32 `.ko-round-R32 .ko-match` 16・確定枠 `.ko-side.is-team[data-team]`≥6・3位枠は集合ラベル・`.ko-pool .ko-pool-chip`≥1）／2022 detail/overview で `.ko-match` 16（R16=8・全枠 `.ko-side.is-team` 16・`.ko-pool` 無し）。
- エンジン変更後は `npm run typecheck` も（tsx は型を見ない）。

## デプロイ

`.github/workflows/deploy.yml`（push main / workflow_dispatch）= npm ci → **npm test** → npm run build（`GH_USER` env）→ Pages。テストが落ちるとデプロイされない。
