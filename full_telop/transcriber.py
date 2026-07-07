"""Speech-to-text wrapper around faster-whisper."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class Segment:
    """A raw speech segment as recognized by the STT engine."""

    start: float
    end: float
    text: str


class Transcriber:
    """Thin wrapper around faster-whisper's WhisperModel.

    faster-whisper is imported lazily so that modules which only need the
    telop/SRT formatting logic (and their tests) don't require the model
    package to be installed.
    """

    def __init__(
        self,
        model_size: str = "medium",
        device: str = "auto",
        compute_type: str = "default",
        language: str | None = "ja",
    ) -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self._model = None

    def _load_model(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:  # pragma: no cover - exercised via CLI only
                raise ImportError(
                    "faster-whisper がインストールされていません。"
                    "`pip install faster-whisper` を実行してください。"
                ) from exc
            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
            )
        return self._model

    def transcribe(self, audio_path: Path) -> Iterator[Segment]:
        model = self._load_model()
        segments, _info = model.transcribe(
            str(audio_path),
            language=self.language,
            vad_filter=True,
        )
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            yield Segment(start=seg.start, end=seg.end, text=text)
