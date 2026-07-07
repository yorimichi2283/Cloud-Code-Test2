"""SRT subtitle file rendering."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from .telop import TelopCard


def format_timestamp(seconds: float) -> str:
    """Format seconds as an SRT timestamp: HH:MM:SS,mmm."""
    seconds = max(seconds, 0.0)
    total_ms = round(seconds * 1000)
    hours, rem_ms = divmod(total_ms, 3_600_000)
    minutes, rem_ms = divmod(rem_ms, 60_000)
    secs, ms = divmod(rem_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def to_srt(cards: Iterable[TelopCard]) -> str:
    blocks = []
    for index, card in enumerate(cards, start=1):
        start_ts = format_timestamp(card.start)
        end_ts = format_timestamp(card.end)
        blocks.append(f"{index}\n{start_ts} --> {end_ts}\n{card.text}\n")
    return "\n".join(blocks) + ("\n" if blocks else "")


def write_srt(cards: Iterable[TelopCard], path: Path) -> None:
    Path(path).write_text(to_srt(cards), encoding="utf-8")
