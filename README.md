# 説テロップ工房

「水曜日のダウンタウン」風のテロップ（文字のスタイルと出し方のアニメーション）を、HTML / CSS / JavaScript で再現したものです。

`index.html` をブラウザで開くと、文字を打ってその場で再生できるプレビュー画面が出ます。

## 再現しているポイント

| 要素 | 番組での特徴 | このリポジトリでの再現 |
| --- | --- | --- |
| 書体 | 極太の明朝体（ロマン雪 W9、マティス EB など） | Google Fonts の `Zen Old Mincho` 900 / `Shippori Mincho B1` 800 で代用 |
| 縁取り | 白文字に黒い太縁 | 縁を別レイヤーにして、隣の文字にかぶらないように描画 |
| 影 | ぼかした黒い影 | `drop-shadow` |
| 出し方 | ストロボ（点滅しながら出る） | `anim: "strobe"` |
| 説の提示 | 画面中央に数行、行末に「説」 | `preset: "setsu"`（行末の「説」は自動で大きくなる） |

ロマン雪やマティスは有料フォントです。ライセンスをお持ちなら、`--t-font` を書き換えればそのまま使えます（下の「カスタマイズ」を参照）。

## ファイル

```
index.html       プレビュー画面（テキスト入力、種類・出し方・書体・背景の切り替え）
telop/telop.css  テロップのスタイルとアニメーション
telop/telop.js   テロップを組み立てる小さなライブラリ（依存なし）
```

## 使い方

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Shippori+Mincho+B1:wght@800&family=Zen+Old+Mincho:wght@900&display=swap">
<link rel="stylesheet" href="telop/telop.css">
<script src="telop/telop.js"></script>

<div class="telop-stage" id="stage"></div>
<script>
  const el = Telop.show(document.getElementById("stage"), {
    preset: "setsu",
    anim: "strobe",
    drift: true,
    text: "大人になってから\n食べる駄菓子\nだいたい美味しい説",
  });

  // 消すとき
  // Telop.hide(el);
</script>
```

`.telop-stage` は 16:9 の画面です。文字の大きさは画面の幅に合わせて決まるので、どのサイズで表示しても見た目の比率は変わりません。文字が多くてはみ出しそうなときは、タイトルセーフ（画面の 90%）に収まるよう自動で縮みます。

### テキストの書き方

- 改行で行が分かれます
- `*文字*` で囲んだ部分は強調色になります（例: `いや、それは\n*反則*やろ`）

### オプション

| 名前 | 値 | 内容 |
| --- | --- | --- |
| `preset` | `setsu` | 説の提示。画面中央、白文字＋黒縁 |
|  | `result` | 検証結果。特大、赤縁＋白縁、金のグラデーション |
|  | `nazori` | なぞり（VTR 中の発言）。画面下 |
|  | `band` | 座布団付き。水色のベースにオレンジ文字、左上 |
|  | `tsukkomi` | ツッコミ。黄色、少し傾けて右上 |
| `anim` | `strobe` | ストロボ。点滅しながら出る |
|  | `slam` | ドーン。手前から叩きつけて揺れる |
|  | `pop` | ポップ。一文字ずつ弾む |
|  | `type` | タイプ。一文字ずつパッと出る |
|  | `slide` | スライド。画面の外から滑り込み、少し行き過ぎてから止まる |
|  | `slide-chars` | 一文字スライド。一文字ずつ順番に滑り込む |
|  | `cut` | カット。いきなり出る |
| `dir` | `right`（既定）/ `left` / `bottom` / `top` | スライド系の向き（どこから入ってくるか）。消すときは、横は反対側へ抜け、縦は来た方へ戻る |
| `font` | `mincho-black` / `mincho` / `gothic` | 極太明朝 / 太明朝 / 極太ゴシック |
| `drift` | `true` / `false` | 出たあと、ゆっくり寄る（説の提示向け） |
| `replace` | `true`（既定）/ `false` | 画面にある前のテロップを消してから出すか |

## カスタマイズ

色や太さは CSS 変数で変えられます。

```css
.telop--setsu {
  --t-font: "DF RomanYuki W9", "Zen Old Mincho", serif; /* 書体 */
  --t-fill: #fff;        /* 文字の色 */
  --t-accent: #ffe100;   /* *強調* の色 */
  --t-edge1: #000;       /* 内側の縁の色 */
  --t-edge1-w: 0.1em;    /* 内側の縁の太さ */
  --t-edge2: #fff;       /* 外側の縁の色 */
  --t-edge2-w: 0.04em;   /* 外側の縁の太さ（0 で一重縁） */
  --t-size: 6.4cqw;      /* 文字の大きさ（画面幅に対する割合） */
}
```

## 動画編集で使うには

プレビュー画面で背景を「グリーンバック」にして画面収録すれば、Premiere Pro などでクロマキー合成して使えます。「自分の画像・動画を敷く」で手元の映像を背景にして、仕上がりを確認することもできます。

点滅や大きな動きを控える設定（`prefers-reduced-motion`）の環境では、すべての出し方がフェードに置き換わります。
