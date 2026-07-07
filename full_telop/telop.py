"""Reformat raw STT segments into telop (full-screen caption) cards.

Whisper-style segments are often several seconds long and contain multiple
sentences. This module splits them at natural Japanese punctuation
boundaries into short, readable chunks, wraps each chunk to a fixed number
of lines/characters, and re-distributes timing proportionally to character
count so each telop card stays on screen roughly as long as it takes to
read.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .transcriber import Segment

# Characters after which it's natural to break a telop into a new card.
BREAK_CHARS = "。！？、,．，\n"

DEFAULT_MAX_CHARS_PER_LINE = 13
DEFAULT_MAX_LINES = 2
DEFAULT_MIN_DURATION = 0.8
DEFAULT_GAP = 0.05


@dataclass(frozen=True)
class TelopCard:
    """A single on-screen caption card, ready to render to SRT."""

    start: float
    end: float
    text: str


def _split_at_breaks(text: str) -> list[str]:
    tokens: list[str] = []
    buf = ""
    for ch in text:
        buf += ch
        if ch in BREAK_CHARS:
            tokens.append(buf)
            buf = ""
    if buf:
        tokens.append(buf)
    return tokens


def chunk_text(text: str, max_chars: int) -> list[str]:
    """Split text into pieces no longer than max_chars, preferring to break
    at punctuation. Falls back to a hard cut if a single token (e.g. a run
    of text with no punctuation) still exceeds max_chars.
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")

    tokens = _split_at_breaks(text)
    chunks: list[str] = []
    current = ""
    for token in tokens:
        candidate = current + token
        if current and len(candidate.strip()) > max_chars:
            chunks.append(current.strip())
            current = token
        else:
            current = candidate
    if current.strip():
        chunks.append(current.strip())

    final: list[str] = []
    for chunk in chunks:
        if len(chunk) <= max_chars:
            final.append(chunk)
        else:
            final.extend(
                chunk[i : i + max_chars] for i in range(0, len(chunk), max_chars)
            )
    return final


def wrap_lines(text: str, max_chars_per_line: int, max_lines: int) -> str:
    """Wrap text into at most max_lines lines of max_chars_per_line chars.

    If the text is too long to fit even at max_lines, the overflow is
    appended to the last line rather than dropped.
    """
    if max_chars_per_line <= 0:
        raise ValueError("max_chars_per_line must be positive")
    if max_lines <= 0:
        raise ValueError("max_lines must be positive")

    lines: list[str] = []
    remaining = text
    while remaining and len(lines) < max_lines:
        lines.append(remaining[:max_chars_per_line])
        remaining = remaining[max_chars_per_line:]
    if remaining:
        lines[-1] += remaining
    return "\n".join(lines)


def build_telop_cards(
    segments: Iterable[Segment],
    max_chars_per_line: int = DEFAULT_MAX_CHARS_PER_LINE,
    max_lines: int = DEFAULT_MAX_LINES,
    min_duration: float = DEFAULT_MIN_DURATION,
    gap: float = DEFAULT_GAP,
) -> list[TelopCard]:
    """Convert raw STT segments into telop cards.

    Each segment's text is chunked to fit max_lines * max_chars_per_line
    characters, wrapped to lines, and given a slice of the segment's
    original [start, end] time range proportional to its character count
    (with a floor of min_duration so short chunks aren't flashed too
    quickly).
    """
    max_chars_per_card = max_chars_per_line * max_lines
    cards: list[TelopCard] = []

    for segment in segments:
        chunks = chunk_text(segment.text, max_chars_per_card)
        if not chunks:
            continue

        total_chars = sum(len(c) for c in chunks) or 1
        duration = max(segment.end - segment.start, 0.01)
        cursor = segment.start

        for chunk in chunks:
            proportion = len(chunk) / total_chars
            chunk_duration = max(duration * proportion, min_duration)
            card_start = cursor
            card_end = card_start + chunk_duration
            wrapped = wrap_lines(chunk, max_chars_per_line, max_lines)
            cards.append(TelopCard(start=card_start, end=card_end, text=wrapped))
            cursor = card_end + gap

    return cards
