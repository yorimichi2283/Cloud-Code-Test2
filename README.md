# full-telop

動画/音声から音声認識で「フルテロ」(全文字起こし字幕) を自動生成し、Premiere Pro に取り込める SRT ファイルを出力するツールです。

## 仕組み

1. `ffmpeg` で入力ファイルから音声を抽出 (16kHz mono WAV)
2. [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (ローカル実行、APIキー不要) で日本語音声認識
3. 認識結果のセグメントを句読点で自然に分割し、指定した行数・文字数に収まるようテロップカード化
4. 各カードの表示時間を文字数に応じて元セグメントの時間内に配分
5. SRT 形式で書き出し

## セットアップ

```bash
pip install -r requirements.txt
```

`ffmpeg` がインストールされている必要があります (`ffmpeg -version` で確認)。

## 使い方

```bash
python -m full_telop.cli input.mp4 -o output.srt
```

主なオプション:

- `--model`: faster-whisper のモデルサイズ (`tiny`/`base`/`small`/`medium`/`large-v3`)。精度重視なら `large-v3`、速度重視なら `small` など。
- `--language`: 音声の言語コード (デフォルト `ja`)
- `--device`: `auto`/`cpu`/`cuda`
- `--max-chars-per-line`: テロップ1行あたりの最大文字数 (デフォルト 13)
- `--max-lines`: テロップカードあたりの最大行数 (デフォルト 2)
- `--min-duration`: 1カードの最短表示秒数 (デフォルト 0.8)
- `--gap`: 連続するカード間の秒数 (デフォルト 0.05)

## Premiere Pro への取り込み

生成した `.srt` は Premiere Pro に直接ドラッグ&ドロップするか、`ファイル > 読み込み` で読み込むとキャプショントラックとして配置できます。取り込み後は「グラフィック」パネルのキャプション用テンプレートを適用してフルテロのスタイル(色・縁取り・背景など)を調整してください。

## テスト

```bash
python -m unittest discover -s tests
```

(`faster-whisper`/`ffmpeg` を使わないロジック部分 (`telop.py`, `srt.py`) のみを対象にしたユニットテストです。実際の音声認識を伴うエンドツーエンドの動作確認には音声/動画ファイルと `ffmpeg`、モデルのダウンロードが必要です。)
