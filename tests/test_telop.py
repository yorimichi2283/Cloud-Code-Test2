import unittest

from full_telop.telop import (
    TelopCard,
    build_telop_cards,
    chunk_text,
    wrap_lines,
)
from full_telop.transcriber import Segment


class ChunkTextTests(unittest.TestCase):
    def test_splits_on_punctuation_within_limit(self):
        text = "今日は良い天気です。明日は雨が降るでしょう。"
        chunks = chunk_text(text, max_chars=12)
        self.assertEqual(chunks, ["今日は良い天気です。", "明日は雨が降るでしょう。"])

    def test_keeps_short_text_as_single_chunk(self):
        chunks = chunk_text("こんにちは", max_chars=20)
        self.assertEqual(chunks, ["こんにちは"])

    def test_hard_splits_when_no_punctuation(self):
        text = "あ" * 25
        chunks = chunk_text(text, max_chars=10)
        self.assertEqual(chunks, ["あ" * 10, "あ" * 10, "あ" * 5])

    def test_rejects_non_positive_max_chars(self):
        with self.assertRaises(ValueError):
            chunk_text("test", max_chars=0)


class WrapLinesTests(unittest.TestCase):
    def test_wraps_into_multiple_lines(self):
        text = "あいうえおかきくけこ"
        wrapped = wrap_lines(text, max_chars_per_line=5, max_lines=2)
        self.assertEqual(wrapped, "あいうえお\nかきくけこ")

    def test_single_line_when_short(self):
        wrapped = wrap_lines("あいう", max_chars_per_line=5, max_lines=2)
        self.assertEqual(wrapped, "あいう")

    def test_overflow_appended_to_last_line(self):
        text = "あ" * 12
        wrapped = wrap_lines(text, max_chars_per_line=5, max_lines=2)
        lines = wrapped.split("\n")
        self.assertEqual(len(lines), 2)
        self.assertEqual("".join(lines), text)

    def test_rejects_non_positive_args(self):
        with self.assertRaises(ValueError):
            wrap_lines("x", max_chars_per_line=0, max_lines=1)
        with self.assertRaises(ValueError):
            wrap_lines("x", max_chars_per_line=1, max_lines=0)


class BuildTelopCardsTests(unittest.TestCase):
    def test_single_short_segment_becomes_one_card(self):
        segments = [Segment(start=0.0, end=2.0, text="こんにちは")]
        cards = build_telop_cards(segments, max_chars_per_line=10, max_lines=2)
        self.assertEqual(len(cards), 1)
        card = cards[0]
        self.assertEqual(card.text, "こんにちは")
        self.assertAlmostEqual(card.start, 0.0)
        self.assertAlmostEqual(card.end, 2.0)

    def test_long_segment_splits_into_multiple_cards_within_time_range(self):
        text = "今日は良い天気です。明日は雨が降るでしょう。来週は晴れる予定です。"
        segments = [Segment(start=10.0, end=16.0, text=text)]
        cards = build_telop_cards(
            segments, max_chars_per_line=10, max_lines=1, min_duration=0.1, gap=0.0
        )
        self.assertGreater(len(cards), 1)
        self.assertAlmostEqual(cards[0].start, 10.0)
        for a, b in zip(cards, cards[1:]):
            self.assertLessEqual(a.end, b.start + 1e-9)

    def test_min_duration_is_respected(self):
        segments = [Segment(start=0.0, end=0.2, text="あ")]
        cards = build_telop_cards(segments, min_duration=1.0, gap=0.0)
        self.assertEqual(len(cards), 1)
        self.assertGreaterEqual(cards[0].end - cards[0].start, 1.0)

    def test_empty_segments_produce_no_cards(self):
        self.assertEqual(build_telop_cards([]), [])


if __name__ == "__main__":
    unittest.main()
