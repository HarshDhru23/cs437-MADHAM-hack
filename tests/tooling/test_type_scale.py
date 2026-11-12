"""CP-50: the type scale. Nothing a student has to read is set below 13 px, body text is 16 px with room between the lines,
and page and section titles keep their sizes. It reads the stylesheets themselves, because a browser test cannot tell a 12 px label
from a 13 px one at a glance and jsdom does not load CSS."""
import re
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
SHEETS = sorted(SRC.rglob("*.css"))
# font-size: 0.8rem, or the shorthand font: 500 0.8rem/1.2 var(--font-m)
SIZE = re.compile(r"font(?:-size)?:\s*(?:\d+\s+)?([\d.]+)(rem|px)\b")


def px(value, unit):
    return float(value) * (16 if unit == "rem" else 1)


def rule(css, selector):
    start = css.index(selector)
    return css[start:css.index("}", start)]


class TypeScaleTests(unittest.TestCase):
    def test_cp50_the_stylesheets_are_found(self):
        names = {p.name for p in SHEETS}
        self.assertTrue({"global.css", "tokens.css", "plan.css", "scenarios.css", "record.css"} <= names, names)

    def test_cp50_no_text_is_set_below_13_pixels(self):
        small = []
        for sheet in SHEETS:
            for number, line in enumerate(sheet.read_text(encoding="utf-8").splitlines(), 1):
                m = SIZE.search(line)
                if m and px(*m.groups()) < 13:
                    small.append(f"{sheet.relative_to(SRC)}:{number} {line.strip()}")
        self.assertEqual(small, [])

    def test_cp50_a_relative_size_below_one_em_keeps_the_13_pixel_floor(self):
        """A size in em or per cent shrinks inside small text (0.92em of a 13 px label is 12 px), so it must say max(..., 0.8125rem)."""
        loose = []
        for sheet in SHEETS:
            for number, line in enumerate(sheet.read_text(encoding="utf-8").splitlines(), 1):
                m = re.search(r"font-size:\s*([\d.]+)(em|%)", line)
                if m and (float(m.group(1)) < 1 if m.group(2) == "em" else float(m.group(1)) < 100):
                    loose.append(f"{sheet.relative_to(SRC)}:{number} {line.strip()}")
        self.assertEqual(loose, [])

    def test_cp50_body_text_is_16_pixels_with_at_least_1_6_between_lines(self):
        tokens = (SRC / "styles" / "tokens.css").read_text(encoding="utf-8")
        self.assertRegex(tokens, r"--font-size:\s*1rem\b")
        self.assertGreaterEqual(float(re.search(r"--line-height:\s*([\d.]+)", tokens).group(1)), 1.6)

    def test_cp50_page_titles_are_32_pixels_and_section_titles_17_or_more(self):
        css = (SRC / "styles" / "global.css").read_text(encoding="utf-8")
        h1 = SIZE.search(rule(css, "\nh1 {"))
        h2 = SIZE.search(rule(css, "\nh2 {"))
        self.assertGreaterEqual(px(*h1.groups()), 32)
        self.assertGreaterEqual(px(*h2.groups()), 17)

    def test_cp50_table_text_is_16_pixels(self):
        css = (SRC / "styles" / "global.css").read_text(encoding="utf-8")
        self.assertGreaterEqual(px(*SIZE.search(rule(css, "\ntable.data {")).groups()), 16)

    def test_cp50_move_is_quiet_until_wanted_but_never_hidden_from_touch_or_keyboard(self):
        css = (SRC / "features" / "plan" / "plan.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"\.pb-move\s*\{[^}]*opacity:\s*0")
        self.assertRegex(css, r"tr:focus-within \.pb-move")
        self.assertRegex(css, r"@media \(hover: none\)\s*\{\s*\.pb-move\s*\{\s*opacity:\s*1")

    def test_cp50_the_checker_sees_a_small_size(self):
        """Honesty check: the pattern does catch both spellings of a too-small size."""
        self.assertLess(px(*SIZE.search("  font-size: 0.8rem;").groups()), 13)
        self.assertLess(px(*SIZE.search("  font: 500 0.72rem/1.2 var(--font-m);").groups()), 13)
        self.assertLess(px(*SIZE.search("  font-size: 12px;").groups()), 13)


if __name__ == "__main__":
    unittest.main()
