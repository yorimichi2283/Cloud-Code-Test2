import unittest

from full_telop.srt import format_timestamp, to_srt
from full_telop.telop import TelopCard


class FormatTimestampTests(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(format_timestamp(0), "00:00:00,000")

    def test_rounds_milliseconds(self):
        self.assertEqual(format_timestamp(1.2345), "00:00:01,234")

    def test_hours_minutes_seconds(self):
        self.assertEqual(format_timestamp(3725.5), "01:02:05,500")

    def test_negative_clamped_to_zero(self):
        self.assertEqual(format_timestamp(-5), "00:00:00,000")


class ToSrtTests(unittest.TestCase):
    def test_empty_cards_produce_empty_string(self):
        self.assertEqual(to_srt([]), "")

    def test_single_card_format(self):
        cards = [TelopCard(start=1.0, end=2.5, text="こんにちは")]
        expected = "1\n00:00:01,000 --> 00:00:02,500\nこんにちは\n\n"
        self.assertEqual(to_srt(cards), expected)

    def test_multiple_cards_are_numbered_sequentially(self):
        cards = [
            TelopCard(start=0.0, end=1.0, text="一つ目"),
            TelopCard(start=1.0, end=2.0, text="二つ目"),
        ]
        result = to_srt(cards)
        self.assertIn("1\n00:00:00,000", result)
        self.assertIn("2\n00:00:01,000", result)

    def test_multiline_card_preserved(self):
        cards = [TelopCard(start=0.0, end=1.0, text="一行目\n二行目")]
        result = to_srt(cards)
        self.assertIn("一行目\n二行目", result)


if __name__ == "__main__":
    unittest.main()
