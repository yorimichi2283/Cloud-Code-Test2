#!/usr/bin/env python3
"""src/TelopTemplates.src.jsx から配布用の TelopTemplates.jsx を作る。

日本語版 Windows の After Effects は BOM の無い .jsx を Shift_JIS として読むことがあり、
UTF-8 の日本語が化けてスクリプト全体が壊れる。全角文字をすべて \\uXXXX に置き換えて
ASCII だけのファイルにしておけば、どの文字コードで読まれても同じ意味になる。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "TelopTemplates.src.jsx"
OUT = ROOT / "TelopTemplates.jsx"

HEADER = (
    "// TelopTemplates.jsx  (generated from src/TelopTemplates.src.jsx by tools/build.py)\n"
    "// Run in After Effects: File > Scripts > Run Script File...\n"
)


def escape(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if code < 0x80:
            out.append(ch)
        elif code <= 0xFFFF:
            out.append("\\u%04x" % code)
        else:
            # BMP 外 (絵文字など) はサロゲートペアで書く
            code -= 0x10000
            out.append("\\u%04x\\u%04x" % (0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF)))
    return "".join(out)


def build() -> str:
    src = SRC.read_text(encoding="utf-8-sig")
    return HEADER + escape(src)


def main() -> int:
    result = build()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="ascii") if OUT.exists() else ""
        if current != result:
            print("TelopTemplates.jsx is out of date; run tools/build.py", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(result, encoding="ascii", newline="\n")
    print("wrote", OUT.relative_to(ROOT.parent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
