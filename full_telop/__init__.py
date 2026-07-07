"""Full telop (full-screen caption) generation system.

Pipeline: audio/video -> speech recognition -> telop-formatted cards -> SRT.
"""

__all__ = ["audio", "transcriber", "telop", "srt", "cli"]
