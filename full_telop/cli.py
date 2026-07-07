"""Command-line entry point for the full-telop generation pipeline."""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from .audio import extract_audio
from .srt import write_srt
from .telop import (
    DEFAULT_GAP,
    DEFAULT_MAX_LINES,
    DEFAULT_MAX_CHARS_PER_LINE,
    DEFAULT_MIN_DURATION,
    build_telop_cards,
)
from .transcriber import Transcriber


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="full-telop",
        description="動画/音声から音声認識でフルテロ(SRT字幕)を自動生成します。",
    )
    parser.add_argument("input", type=Path, help="入力の動画または音声ファイル")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="出力するSRTファイルのパス (省略時は入力ファイル名.srt)",
    )
    parser.add_argument(
        "--model",
        default="medium",
        help="faster-whisper のモデルサイズ (tiny/base/small/medium/large-v3 等)",
    )
    parser.add_argument(
        "--language",
        default="ja",
        help="音声の言語コード (デフォルト: ja)",
    )
    parser.add_argument(
        "--device",
        default="auto",
        help="推論デバイス: auto/cpu/cuda",
    )
    parser.add_argument(
        "--compute-type",
        default="default",
        help="faster-whisper の compute_type (例: int8, float16)",
    )
    parser.add_argument(
        "--max-chars-per-line",
        type=int,
        default=DEFAULT_MAX_CHARS_PER_LINE,
        help="テロップ1行あたりの最大文字数",
    )
    parser.add_argument(
        "--max-lines",
        type=int,
        default=DEFAULT_MAX_LINES,
        help="テロップカードあたりの最大行数",
    )
    parser.add_argument(
        "--min-duration",
        type=float,
        default=DEFAULT_MIN_DURATION,
        help="1カードを表示する最短秒数",
    )
    parser.add_argument(
        "--gap",
        type=float,
        default=DEFAULT_GAP,
        help="連続するカード間に空ける秒数",
    )
    return parser


def run(args: argparse.Namespace) -> Path:
    input_path: Path = args.input
    if not input_path.exists():
        raise FileNotFoundError(f"入力ファイルが見つかりません: {input_path}")

    output_path: Path = args.output or input_path.with_suffix(".srt")

    with tempfile.TemporaryDirectory(prefix="full_telop_") as tmp_dir:
        audio_path = extract_audio(input_path, Path(tmp_dir))

        transcriber = Transcriber(
            model_size=args.model,
            device=args.device,
            compute_type=args.compute_type,
            language=args.language,
        )
        segments = transcriber.transcribe(audio_path)
        cards = build_telop_cards(
            segments,
            max_chars_per_line=args.max_chars_per_line,
            max_lines=args.max_lines,
            min_duration=args.min_duration,
            gap=args.gap,
        )
        write_srt(cards, output_path)

    return output_path


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        output_path = run(args)
    except Exception as exc:  # noqa: BLE001 - surfaced as a CLI error message
        print(f"エラー: {exc}", file=sys.stderr)
        return 1
    print(f"SRTを書き出しました: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
