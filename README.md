# TouchTrackingApp

WebView上で任意のWebページを表示しながら、ユーザーのタッチストロークをリアルタイムで記録するiOSプロトタイプ。ページ本来のスクロール・タップ操作を妨げることなく、並行してタッチデータを収集する。記録したセッションはJSONで書き出し、Pythonスクリプトでプロッター向けSVGに変換できる。

---

## 必要な環境

| ツール | バージョン |
|--------|-----------|
| Node.js | 20 以上 |
| Expo CLI | `npx expo`（バンドル済み） |
| Xcode | 16 以上 |
| iPhone（実機） | iOS 18 以上 |
| Python | 3.9 以上（SVG生成用） |

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

1. アドレスバーにURLを入力して **Go** をタップ。
2. **● REC** をタップして記録開始。ボタンが赤くなる。
3. ページを普通に操作する（スクロール・タップ・スワイプ）。
4. **■ STOP** をタップして記録停止。
5. カウンターに `<ストローク数>s / <ポイント数>p` が表示される。
6. **JSON** をタップしてセッションデータを書き出し・共有。
7. **CLR** でセッションを破棄して最初からやり直し。

> 新しいURLに移動すると、セッションは自動的にクリアされる。

---

## タッチトラッキングの仕組み

ページ読み込み後、`src/injectedJS.ts` のJavaScriptをWebViewに注入する。
`document` に対して `touchstart` / `touchmove` / `touchend` / `touchcancel` の **passiveキャプチャリスナー** を登録する。passiveのためページ側のスクロール・タップハンドラはブロックされない。

```js
var phases = {
  touchstart:  'start',  // ラベンダー
  touchmove:   'move',
  touchend:    'end',    // ピンク
  touchcancel: 'end',    // ピンク
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

**座標系：** CSS `clientX` / `clientY`（ビューポート基準の論理ピクセル）。iPhone SE 2nd gen ではURLバー・ツールバー表示時のビューポートは 375 × 547 pt。スクロールオフセットは含まない。

**ストロークの順序：** JSONの `strokes` 配列は完全に時系列順。インデックス0が最初に完了したジェスチャー。ストロークNの最初のtimestampは必ずストロークN+1より小さい。

**既知の制限：** `history.pushState` によるSPAナビゲーション（フルリロードなし）は検知できない。トラッキングが反応しなくなった場合はページを手動でリロードする。

---

## JSONフォーマット

```jsonc
{
  "exportedAt": "2026-03-18T12:00:00.000Z",
  "url": "https://example.com",
  "titleEn": "セッションの英語タイトル（書き出し後に手動で編集）",
  "viewport": { "width": 375, "height": 547 },
  "device": {
    "brand": "Apple",
    "model": "iPhone SE (2nd generation)",
    "os": "iOS",
    "osVersion": "18.x"
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
| `titleEn` | 文字列 | 任意の英語タイトル（書き出し後に手動編集） |
| `x`, `y` | number | ビューポート基準のCSS座標 |
| `timestamp` | number | Unix時刻（ミリ秒、`Date.now()`） |
| `phase` | `"start" \| "move" \| "end"` | タッチのライフサイクルフェーズ |
| `strokeId` | 文字列 | 1つの連続したジェスチャーのポイントをグループ化するID |

---

## SVG生成

`data/` 以下の2つのPythonスクリプトが、書き出したJSONをプロッター向けSVGに変換する。
センターラインフォントレンダラー（`~/develop/sandbox/plot-dm/centerline/`）が必要。

### 使用フォント

| フォント | ファイル | 用途 |
|---------|---------|------|
| azomix | `azomix.lff` | タイトル・情報パネルのテキスト |
| unicode | `unicode.lff` | グリフが見つからない場合のフォールバック |
| kst32b | `kst32b.lff` | コードセクション（KST32B単線モノスペース） |

すべて単線（センターライン）フォント。塗りつぶしなし、プロッター対応。

---

### `generate_annotated.py` — A3横向きアノテーションシート

```bash
cd data
python3 generate_annotated.py <input.json>
# 引数を省略すると data/ 内の最新のJSONを使用
```

**出力：** `<ファイル名>_annotated.svg`

**ドキュメントサイズ：** A3横向き、1191 × 842 pt

**レイアウト：**

```
┌─────────────────────────┬──────────────────────────┐
│   左パネル（640pt）      │   右パネル（550pt）       │
│   タッチ可視化           │   セッション情報＋コード   │
└─────────────────────────┴──────────────────────────┘
```

**左パネル** — 記録時のビューポートをアスペクト比を保ったままパネルに収める。枠線でビューポートの正確な範囲を表示。

**右パネル** — すべてセンターラインフォントのパスデータで描画（プロッター対応）：
- 日本語タイトル（ファイル名から取得、折り返しあり）
- 英語タイトル（`titleEn` フィールド、折り返しあり）
- 水平区切り線
- **SESSION**：`rec start unix ms`、`rec end unix ms`、`duration`
- **CONTENT**：`url`
- **DEVICE**：`viewport`、`brand`、`model`、`os`、`os version`
- **STROKES**：`total strokes`、`total points`
- **USER**：`name`
- **TOUCH TRACKING CODE**：ソースコードの抽象化された抜粋（kst32bフォント）

**レイヤー構造** — ストロークごとに3層、グローバルな連番：

```
1_s001_trajectory   ストローク1の軌跡ライン
2_s001_start        ストローク1の開始点の円＋タイムスタンプ（ラベンダー）
3_s001_end          ストローク1の終了点の円＋タイムスタンプ（ピンク）
4_s002_trajectory
5_s002_start
6_s002_end
...
```

205ストロークのセッションで合計 **615レイヤー**。

AxiDraw Inkscape拡張のレイヤー番号指定機能で特定の番号のレイヤーだけを印刷できるため、ストローク単位・要素単位での多色印刷が可能。

**ビジュアルスタイル：**

| 要素 | 色 | stroke-width |
|------|----|-------------|
| 軌跡ライン | `#aaa` | 1.2 |
| 開始点の円・ハッチ・ラベル | `#9b59b6` ラベンダー | 0.9 / 0.6 |
| 終了点の円・ハッチ・ラベル | `#e91e63` ピンク | 0.9 / 0.6 |

円内部のハッチ：45°、間隔1.6 pt。

**主な定数**（スクリプト先頭）：

```python
CIRCLE_R     = 4.0
HATCH_STEP   = 1.6
STROKE_START = '#9b59b6'  # ラベンダー — タッチ開始点
STROKE_END   = '#e91e63'  # ピンク     — タッチ終了点
OPERATOR     = 'mizuno shoji'
```

---

### `generate_a0_viz.py` — A0縦向き可視化データのみ

```bash
cd data
python3 generate_a0_viz.py <input.json>
```

**出力：** `<ファイル名>_a0_viz.svg`

**ドキュメントサイズ：** A0縦向き、2384 × 3370 pt

レイヤー構造・連番はA3スクリプトと同じ。情報パネルなし、可視化データのみ。120 ptのパディングでA0いっぱいにスケール（約5.7倍）。

**ビジュアルスタイル：**

| 要素 | stroke-width |
|------|-------------|
| 軌跡ライン | 2.4 |
| 円 | 1.8 |
| ハッチ・ラベル | 1.2 |

---

## ファイル構成

```
TouchTrackingApp/
├── App.tsx                    # ルートコンポーネント：URLバー・WebView・ツールバー
├── src/
│   ├── types.ts               # TouchPoint / Stroke / Viewport / DeviceInfo / Session 型定義
│   ├── injectedJS.ts          # WebViewに注入するタッチキャプチャJS
│   └── exportUtils.ts         # JSONエクスポート・簡易SVGエクスポート・共有シート
├── data/
│   ├── layout.json            # A3パネルのジオメトリ設定（幅・パディング・フォントサイズ）
│   ├── generate_annotated.py  # A3横向きアノテーションSVG生成スクリプト
│   ├── generate_a0_viz.py     # A0縦向き可視化SVG生成スクリプト
│   └── *.json / *_annotated.svg / *_a0_viz.svg  # セッションデータ・生成SVG
├── app.json
├── package.json
└── README.md
```
