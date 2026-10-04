# 説テロップ工房

「水曜日のダウンタウン」風のテロップ（文字のスタイルと出し方のアニメーション）を、HTML / CSS / JavaScript で再現したものです。

- `index.html` をブラウザで開くと、文字を打ってその場で再生できるプレビュー画面が出ます。
- `render/render.js` で、背景が透明な動画（ProRes 4444 の .mov）に書き出せます。Premiere Pro では映像の上のトラックに置くだけで重なります（→「[Premiere Pro で使う](#premiere-pro-で使う)」）。

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
index.html                   プレビュー画面（テキスト入力、種類・出し方・書体・背景の切り替え）
telop/telop.css              テロップのスタイルとアニメーション
telop/telop.js               テロップを組み立てる小さなライブラリ（依存なし）
render/render.js             透過動画に書き出すスクリプト
render/frame.html            書き出し用のページ（render.js が使う）
render/telops.example.json   まとめて書き出すときの例
```

## Premiere Pro で使う

テロップを 1 フレームずつ止めて撮り、背景が透明な動画にします。グリーンバックで撮ってクロマキーで抜くのと違い、縁や影のぼかしまできれいに透けます。

### 最初の準備（一度だけ）

1. [Node.js](https://nodejs.org/ja)（18 以上）をインストール
2. このフォルダでターミナル（Windows は PowerShell）を開いて、次を実行

```sh
npm install
npx playwright install chromium
```

動画の変換に使う ffmpeg は `npm install` で一緒に入ります。

### 書き出す

```sh
npm run render -- --text "大人になってから\n食べる駄菓子\nだいたい美味しい説" --preset setsu --anim strobe --drift
```

`out/` フォルダに `.mov` ができます。改行は `\n` と書きます。

コマンドを手で書く必要はありません。プレビュー画面で見た目を決めると、下の「Premiere Pro 用に書き出す」欄に、その設定のコマンドが出ます。コピーして貼り付けるだけです。

何本もまとめて作るときは、JSON に並べて渡します（書き方は `render/telops.example.json`）。

```sh
npm run render -- render/telops.example.json
```

### Premiere Pro に読み込む

1. `out/` の `.mov` をプロジェクトパネルに読み込む
2. 映像より上のトラック（V2 など）に置く。背景は最初から透けています
3. タイムライン上で、出したいタイミングに合わせて置く。画面のどこに出るかはテロップの種類で決まっているので、位置を合わせる必要はありません（ずらしたいときは「エフェクトコントロール」の位置で動かせます）

### オプション

| オプション | 既定 | 内容 |
| --- | --- | --- |
| `--duration` | `4` | 長さ（秒）。最後の消える動きを含む |
| `--no-out` | なし | 消える動きを付けず、最後まで出しっぱなしにする。Premiere 側で長さを自由に変えたいときは、これで書き出して最後のフレームを「フレーム保持」で伸ばす |
| `--fps` | `29.97` | シーケンスに合わせる（`23.976` / `24` / `25` / `29.97` / `30` / `59.94` / `60`） |
| `--width` | `1920` | 横幅。高さは 16:9 で決まる（4K なら `3840`） |
| `--format` | `prores` | `prores`：ProRes 4444（透過付き .mov）<br>`qtrle`：QuickTime アニメーション（透過付き .mov。容量は大きいが古い環境でも読める）<br>`png`：連番 PNG。Premiere では最初の 1 枚を選び「画像シーケンス」にチェックして読み込む |
| `--outdir` | `out` | 書き出し先フォルダ |
| `--name` | テキストから作る | ファイル名 |

テロップの中身は `--text` `--preset` `--anim` `--dir` `--font` `--drift` で、意味はブラウザ版と同じです（下の「オプション」の表）。

ProRes 4444 は 1080p で 1 秒あたり最大 15MB ほどになります。動きの少ないテロップほど小さくなります。

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

## その他

プレビュー画面の「自分の画像・動画を敷く」で手元の映像を背景にすると、書き出す前に仕上がりを確認できます。

点滅や大きな動きを控える設定（`prefers-reduced-motion`）の環境では、すべての出し方がフェードに置き換わります。
