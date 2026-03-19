# 《TouchPlot》

WebView上で任意のWebページを表示しながら、ユーザーのタッチストロークをリアルタイムで記録するiOSプロトタイプ。ページ本来のスクロール・タップ操作を妨げることなく、並行してタッチデータを収集する。記録したセッションはアプリ内でSVGに変換・保存し、初期画面のカルーセルで自動再生される。

---

## 必要な環境

| ツール | バージョン |
|--------|-----------|
| Node.js | 20 以上 |
| Expo CLI | `npx expo`（バンドル済み） |
| Xcode | 16 以上 |
| iPhone（実機） | iOS 18 以上 |

---

## セットアップ

```bash
cd TouchTrackingApp
npm install
```

### 実機ビルド・起動

```bash
npx expo run:ios --device
```

Xcodeが起動し、Apple IDで署名してiPhoneにインストールされる。

---

## アプリの使い方

### 初期画面（カルーセル）

起動直後は **Tracking the Interface** のタイトルカードが表示される。グラフを保存すると、10秒ごとに自動スクロールするカルーセルに追加される。

カルーセルの並び順（1セッションあたり4ページ）：

```
[タイトルカード] → [コード] → [可視化グラフ] → [情報パネル] → [タイトルカード] → ...
```

手動スワイプも可能。カルーセル表示中に上部URLバーからURLを入力して **Go** をタップすると記録モードに切り替わる。URLバーが空のまま **Go** をタップするとカルーセルに戻る。

### 記録フロー

1. アドレスバーにURLを入力して **Go** をタップ。
2. **● REC** をタップして記録開始。ボタンが赤くなる。
3. ページを普通に操作する（スクロール・タップ・スワイプ・画面端スワイプによる戻る/進む）。
4. **■ STOP** をタップして記録停止。
5. カウンターに `<ストローク数>s / <ポイント数>p` が表示される。
6. **GRAPH** をタップしてレイアウトを選択し、プレビューを表示。同時にグラフがデバイスに保存され、カルーセルに追加される。
7. プレビュー画面で **Share SVG** をタップして外部共有。

> - 新しいURLに移動すると、セッションは自動的にクリアされる。
> - STOP後はストロークデータがキャッシュされる。設定を変えて **GRAPH** を再タップすると、再録画なしで再生成できる。次の **REC** 開始時またはクリア時にキャッシュが消える。

### 設定（⚙ アイコン）

画面右下の ⚙ をタップすると設定シートが開く。

| 項目 | 説明 |
|------|------|
| タイトル | 日本語タイトル。SVGの情報パネルとカルーセルタイトルカードに反映 |
| 英語タイトル | 英語タイトル（任意）。同様にSVGに反映 |
| ユーザー名 | USER行に記録される |
| カラー設定 | 開始点・終了点・軌跡ラインの色をそれぞれ選択 |
| 保存済みグラフ | 保存されたグラフの一覧と削除 |
| クリア | 現在のセッションを破棄 |

#### カラー設定

開始点（lavender）・終了点（pink）・軌跡ライン（gray）の3色を個別に変更できる。選択した色はコードドキュメントのカラーコメントにも反映される。

---

## SVG生成（アプリ内）

`src/generateSVG.ts` がすべてのSVG生成を担う。5種類の出力がある。

| 関数 | サイズ | 用途 | 背景 |
|------|--------|------|------|
| `generateVizSVG` | A4縦（595×842） | 可視化のみ / プロッター用 | 白 |
| `generateInfoSVG` | A4縦 | 情報パネルのみ / プロッター用 | 白 |
| `generateAnnotatedSVG` | A3横（1191×842） | 可視化＋情報パネル＋コード / プロッター用 | 白 |
| `generateDisplayInfoSVG` | A4縦 | 情報パネル / カルーセル表示用（大フォント） | 白 |
| `generateDisplayCodeSVG` | A4縦 | コード / カルーセル表示用（大フォント） | 黒（#111） |

**GRAPH ボタンのレイアウト選択肢：**

| 選択肢 | 関数 | 主な用途 |
|--------|------|--------|
| 可視化のみ（A4縦） | `generateVizSVG` | 可視化単体の共有・プロット |
| 情報のみ（A4縦） | `generateInfoSVG` | 情報パネル単体の共有・プロット |
| 可視化 + 情報（A3横） | `generateAnnotatedSVG` | 一枚に収めた総合シート |

プレビュー表示に加えて `generateVizSVG` / `generateDisplayInfoSVG` / `generateDisplayCodeSVG` の3ファイルをデバイスに自動保存する。

### ビジュアルスタイル

| 要素 | デフォルト色 | 変更可 |
|------|-------------|--------|
| 軌跡ライン | `#aaaaaa` | ✓ |
| 開始点の円・ハッチ | `#9b59b6`（ラベンダー） | ✓ |
| 終了点の円・ハッチ | `#e91e63`（ピンク） | ✓ |

円内部のハッチ：45°、間隔1.6 pt。

### 情報パネルのセクション構成

```
[タイトル（日本語）]
[英語タイトル]
─────────────────
SESSION
  rec start unix ms   / rec end unix ms / duration
CONTENT
  url
DEVICE
  viewport / brand / model / os / os version
STROKES
  total strokes / total points
USER
  name
```

タイトルは最大2行まで折り返し、2行目末尾が収まらない場合は `...` で截切る。日本語（スペースなし）・英語どちらも文字数ベースで折り返す。

---

## 永続化

セッションデータはアプリキルをまたいで保持される。

| 対象 | 保存先 |
|------|--------|
| グラフSVGファイル | `expo-file-system` documentDirectory / `saved_graphs/` |
| マニフェスト（グラフ一覧） | `saved_graphs/manifest.json` |

1セッションにつき3ファイル保存される：

```
<id>_viz.svg          — 可視化グラフ（プロッター品質）
<id>_info.svg         — 情報パネル（カルーセル表示用、大フォント）
<id>_code.svg         — コード（カルーセル表示用、黒背景）
```

---

## タッチトラッキングの仕組み

ページ読み込み後、`src/injectedJS.ts` のJavaScriptをWebViewに注入する。
`document` に対して `touchstart` / `touchmove` / `touchend` / `touchcancel` の **passiveキャプチャリスナー** を登録する。passiveのためページ側のスクロール・タップハンドラはブロックされない。

```js
var phases = {
  touchstart:  'start',
  touchmove:   'move',
  touchend:    'end',
  touchcancel: 'end',
};
Object.keys(phases).forEach(function (type) {
  document.addEventListener(type, function (e) {
    var t = e.changedTouches[0];
    send({ type: 'touch', phase: phases[type],
           x: t.clientX,  y: t.clientY,
           timestamp: Date.now(), strokeId: currentStrokeId });
  }, { passive: true, capture: true });
});
```

**passive**：`preventDefault()` を呼ばないことをブラウザに宣言し、スクロールのブロックを防ぐ。
**capture**：DOMツリーの最上位でイベントをキャプチャし、ページ側のハンドラがイベントを止めていても確実に受け取る。

**座標系：** CSS `clientX` / `clientY`（ビューポート基準の論理ピクセル）。iPhone SE 2nd gen ではURLバー・ツールバー表示時のビューポートは 375 × 547 pt。スクロールオフセットは含まない。

**ストロークの順序：** `strokes` 配列は完全に時系列順。インデックス0が最初に完了したジェスチャー。

**ページ内ナビゲーション（戻る/進む）：** WebView は iOS ネイティブのエッジスワイプに対応している（`allowsBackForwardNavigationGestures`）。画面左端から右スワイプで戻る、右端から左スワイプで進む。

**既知の制限：** `history.pushState` によるSPAナビゲーション（フルリロードなし）は検知できない。トラッキングが反応しなくなった場合はページを手動でリロードする。

---

## JSONフォーマット

Share SVGで書き出す前の内部データ構造。

```jsonc
{
  "exportedAt": "2026-03-18T12:00:00.000Z",
  "url": "https://example.com",
  "titleJa": "セッションの日本語タイトル",
  "titleEn": "Session English Title",
  "user": "mizuno shoji",
  "viewport": { "width": 375, "height": 547 },
  "device": {
    "brand": "Apple",
    "model": "iPhone SE (2nd generation)",
    "os": "iOS",
    "osVersion": "18.x"
  },
  "colors": {
    "start": "#9b59b6",
    "end":   "#e91e63",
    "line":  "#aaaaaa"
  },
  "strokes": [
    {
      "id": "abc123",
      "points": [
        { "x": 120.5, "y": 300.0, "timestamp": 1773647761013, "phase": "start", "strokeId": "abc123" },
        { "x": 125.1, "y": 305.3, "timestamp": 1773647761029, "phase": "move",  "strokeId": "abc123" },
        { "x": 130.0, "y": 310.0, "timestamp": 1773647761045, "phase": "end",   "strokeId": "abc123" }
      ]
    }
  ]
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `exportedAt` | ISO 8601文字列 | ファイル書き出し時刻 |
| `viewport` | `{width, height}` | CSSビューポートサイズ（論理px） |
| `device` | オブジェクト | expo-device経由のハードウェア・OS情報 |
| `titleJa` | 文字列 | 日本語タイトル（任意） |
| `titleEn` | 文字列 | 英語タイトル（任意） |
| `user` | 文字列 | ユーザー名（任意） |
| `colors` | オブジェクト | start / end / line の16進カラー |
| `x`, `y` | number | ビューポート基準のCSS座標 |
| `timestamp` | number | Unix時刻（ミリ秒、`Date.now()`） |
| `phase` | `"start" \| "move" \| "end"` | タッチのライフサイクルフェーズ |
| `strokeId` | 文字列 | 1つの連続したジェスチャーのポイントをグループ化するID |

---

## Pythonスクリプト（外部ツール）

`data/` 以下のスクリプトはアプリとは独立した外部ツール。アプリから書き出したJSONを入力としてプロッター向けSVGを生成する。

### フォントのセットアップ

`.lff` フォントファイルは容量が大きいため git 管理外（`.gitignore`）。clone後に手動でコピーが必要。

```bash
# plot-dm リポジトリのフォントを data/fonts/ にコピー
cp ~/develop/sandbox/plot-dm/centerline/fonts/azomix.lff  data/fonts/
cp ~/develop/sandbox/plot-dm/centerline/fonts/unicode.lff data/fonts/
cp ~/develop/sandbox/plot-dm/centerline/fonts/kst32b.lff  data/fonts/
```

`recompose_stroke.py`（センターラインフォントレンダラー）は `data/` 内に含まれているため別途インストール不要。

### `generate_annotated.py` — A3横向きアノテーションシート

```bash
cd data
python3 generate_annotated.py <input.json>
```

**出力：** `<ファイル名>_annotated.svg`（1191 × 842 pt）

レイヤー構造（ストロークごとに3層、グローバル連番）：

```
1_s001_trajectory   軌跡ライン
2_s001_start        開始点の円＋ハッチ＋タイムスタンプ（ラベンダー）
3_s001_end          終了点の円＋ハッチ＋タイムスタンプ（ピンク）
4_s002_trajectory
...
```

### `generate_a0_viz.py` — A0縦向き可視化

```bash
cd data
python3 generate_a0_viz.py <input.json>
```

**出力：** `<ファイル名>_a0_viz.svg`（2384 × 3370 pt）

---

## ファイル構成

```
TouchTrackingApp/
├── App.tsx                    # ルートコンポーネント：URLバー・カルーセル・WebView・ツールバー・モーダル
├── src/
│   ├── types.ts               # TouchPoint / Stroke / Viewport / DeviceInfo / Session 型定義
│   ├── injectedJS.ts          # WebViewに注入するタッチキャプチャJS
│   ├── exportUtils.ts         # SVG共有シート
│   ├── generateSVG.ts         # アプリ内SVGジェネレーター（5種）
│   └── savedGraphs.ts         # expo-file-systemによるグラフの永続化
├── data/
│   ├── layout.json            # A3パネルのジオメトリ設定
│   ├── generate_annotated.py  # A3横向きアノテーションSVG（外部ツール）
│   ├── generate_a0_viz.py     # A0縦向き可視化SVG（外部ツール）
│   └── *.json / *.svg         # セッションデータ・生成SVG
├── app.json
├── package.json
└── README.md
```
