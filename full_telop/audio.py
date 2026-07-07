"""Audio extraction helpers backed by ffmpeg."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

WHISPER_SAMPLE_RATE = 16000


class FFmpegNotFoundError(RuntimeError):
    """Raised when ffmpeg is not available on PATH."""


def _require_ffmpeg() -> str:
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path is None:
        raise FFmpegNotFoundError(
            "ffmpeg が見つかりません。https://ffmpeg.org/ からインストールし、"
            "PATH に追加してください。"
        )
    return ffmpeg_path


def extract_audio(input_path: Path, output_dir: Path | None = None) -> Path:
    """Extract a mono 16kHz WAV track from a video/audio file using ffmpeg.

    If the input is already an audio file, it is still re-encoded to the
    sample rate/channel layout faster-whisper expects.
    """
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"入力ファイルが見つかりません: {input_path}")

    ffmpeg_path = _require_ffmpeg()

    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="full_telop_"))
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}.wav"

    cmd = [
        ffmpeg_path,
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(WHISPER_SAMPLE_RATE),
        "-f",
        "wav",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg での音声抽出に失敗しました:\n{result.stderr}"
        )
    return output_path
