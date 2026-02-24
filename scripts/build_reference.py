#!/usr/bin/env python3
"""Parse build123d epub and generate reference files for LLM context injection.

Usage:
    python scripts/build_reference.py

Input:  build123d-readthedocs-io-en-latest.epub (project root)
Output: backend/data/build123d_api_reference.md
        backend/data/build123d_examples.md
"""

import html.parser
import re
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
EPUB_PATH = PROJECT_ROOT / "build123d-readthedocs-io-en-latest.epub"
DATA_DIR = PROJECT_ROOT / "backend" / "data"

# Files for API reference (classes, methods, parameters)
API_REFERENCE_FILES = [
    "direct_api_reference.xhtml",
    "builder_api_reference.xhtml",
    "objects.xhtml",
    "objects/text.xhtml",
    "operations.xhtml",
    "selectors.xhtml",
    "topology_selection.xhtml",
    "topology_selection/filter_examples.xhtml",
    "topology_selection/group_examples.xhtml",
    "topology_selection/sort_examples.xhtml",
    "key_concepts.xhtml",
    "key_concepts_algebra.xhtml",
    "key_concepts_builder.xhtml",
    "joints.xhtml",
    "assemblies.xhtml",
    "import_export.xhtml",
    "tips.xhtml",
    "debugging_logging.xhtml",
    "algebra_definition.xhtml",
    "algebra_performance.xhtml",
    "location_arithmetic.xhtml",
    "moving_objects.xhtml",
]

# Files for code examples (tutorials, samples, builder guides)
EXAMPLES_FILES = [
    "examples_1.xhtml",
    "introductory_examples.xhtml",
    "build_line.xhtml",
    "build_part.xhtml",
    "build_sketch.xhtml",
    "cheat_sheet.xhtml",
    "tutorial_design.xhtml",
    "tutorial_joints.xhtml",
    "tutorial_lego.xhtml",
    "tutorial_selectors.xhtml",
    "tutorial_spitfire_wing_gordon.xhtml",
    "tutorial_surface_heart_token.xhtml",
    "tutorial_surface_modeling.xhtml",
    "introduction.xhtml",
    "tttt.xhtml",
]

# Excluded files (not in either list)
# installation.xhtml, genindex.xhtml, nav.xhtml, py-modindex.xhtml,
# OpenSCAD.xhtml, advantages.xhtml, index.xhtml, advanced.xhtml,
# center.xhtml, external.xhtml, tutorials.xhtml, builders.xhtml


class HTMLToMarkdown(html.parser.HTMLParser):
    """HTML to Markdown converter for Sphinx/ReadTheDocs epub output.

    Handles Pygments-highlighted code blocks where code is in
    <div class="highlight-python"><div class="highlight"><pre><span>...</span></pre></div></div>
    (no <code> wrapper — just <pre> with <span> children).
    """

    def __init__(self):
        super().__init__()
        self.output: list[str] = []
        self._tag_stack: list[str] = []
        self._in_pre = False
        self._pending_lang = ""  # language detected from highlight-xxx div

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._tag_stack.append(tag)
        attr_dict = dict(attrs)
        classes = (attr_dict.get("class") or "").split()

        if tag == "div":
            # Detect language from Sphinx highlight wrapper: <div class="highlight-python ...">
            for c in classes:
                if c.startswith("highlight-") and c != "highlight":
                    self._pending_lang = c.split("-", 1)[1]
                    break
        elif tag == "pre":
            self._in_pre = True
            lang = self._pending_lang or "python"
            self.output.append(f"\n```{lang}\n")
        elif tag == "code":
            if not self._in_pre:
                self.output.append("`")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self.output.append(f"\n{'#' * level} ")
        elif tag == "li":
            self.output.append("\n- ")
        elif tag == "p":
            self.output.append("\n\n")
        elif tag == "br":
            self.output.append("\n")
        elif tag == "dt":
            self.output.append("\n\n**")
        elif tag == "dd":
            self.output.append("\n  ")
        elif tag in ("strong", "b"):
            self.output.append("**")
        elif tag in ("em", "i"):
            self.output.append("*")

    def handle_endtag(self, tag: str) -> None:
        if self._tag_stack and self._tag_stack[-1] == tag:
            self._tag_stack.pop()

        if tag == "pre":
            self._in_pre = False
            self._pending_lang = ""
            self.output.append("\n```\n")
        elif tag == "code":
            if not self._in_pre:
                self.output.append("`")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.output.append("\n")
        elif tag == "dt":
            self.output.append("**")
        elif tag in ("strong", "b"):
            self.output.append("**")
        elif tag in ("em", "i"):
            self.output.append("*")

    def handle_data(self, data: str) -> None:
        if self._in_pre:
            self.output.append(data)
        else:
            # Collapse whitespace for non-code text
            text = re.sub(r"\s+", " ", data)
            self.output.append(text)

    def get_markdown(self) -> str:
        result = "".join(self.output)
        # Clean up excessive newlines
        result = re.sub(r"\n{3,}", "\n\n", result)
        return result.strip()


def extract_file(z: zipfile.ZipFile, filename: str) -> str | None:
    """Extract and convert a single xhtml file to markdown."""
    # Try exact match first, then search for suffix match
    for name in z.namelist():
        if name == filename or name.endswith("/" + filename):
            content = z.read(name).decode("utf-8", errors="ignore")
            parser = HTMLToMarkdown()
            parser.feed(content)
            return parser.get_markdown()
    return None


def build_reference_files() -> tuple[str, str]:
    """Build the two reference files from the epub."""
    with zipfile.ZipFile(EPUB_PATH, "r") as z:
        # Build API reference
        api_sections: list[str] = []
        for fname in API_REFERENCE_FILES:
            md = extract_file(z, fname)
            if md:
                section_name = fname.replace(".xhtml", "").replace("/", " - ")
                api_sections.append(f"<!-- source: {section_name} -->\n\n{md}")

        # Build examples
        examples_sections: list[str] = []
        for fname in EXAMPLES_FILES:
            md = extract_file(z, fname)
            if md:
                section_name = fname.replace(".xhtml", "").replace("/", " - ")
                examples_sections.append(f"<!-- source: {section_name} -->\n\n{md}")

    api_reference = "\n\n---\n\n".join(api_sections)
    examples = "\n\n---\n\n".join(examples_sections)
    return api_reference, examples


def main() -> None:
    if not EPUB_PATH.exists():
        print(f"ERROR: epub not found at {EPUB_PATH}")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Parsing epub...")
    api_reference, examples = build_reference_files()

    api_path = DATA_DIR / "build123d_api_reference.md"
    api_path.write_text(api_reference)
    api_chars = len(api_reference)
    print(f"  API reference: {api_chars:,} chars (~{api_chars // 4:,} tokens) → {api_path}")

    examples_path = DATA_DIR / "build123d_examples.md"
    examples_path.write_text(examples)
    ex_chars = len(examples)
    print(f"  Code examples: {ex_chars:,} chars (~{ex_chars // 4:,} tokens) → {examples_path}")

    total = api_chars + ex_chars
    print(f"  Total: {total:,} chars (~{total // 4:,} tokens)")
    print("Done!")


if __name__ == "__main__":
    main()
