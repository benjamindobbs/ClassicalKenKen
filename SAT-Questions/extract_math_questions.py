"""
extract_math_questions.py — Extract SAT Math questions from College Board PDF exports
using PyMuPDF (OCR rendering) + Tesseract.

The math PDF has no embedded text layer — all content is rendered as vector paths.
Each page is rasterized at 200 DPI, then Tesseract OCR recovers the text.

Usage:
    pip install pymupdf pytesseract
    # Also install Tesseract binary: https://github.com/UB-Mannheim/tesseract/wiki
    python extract_math_questions.py <input.pdf> [output.json]

Output:
    <output.json>          — extracted questions
    math_flagged.txt       — questions with images/charts (page number + ID)
    math_spr.txt           — Student Produced Response (free-response) questions skipped
"""

import sys
import re
import json
import os
import difflib
import fitz           # PyMuPDF
import pytesseract
from PIL import Image
import io


# ── Canonical domain / skill lists ────────────────────────────────────────────

VALID_DOMAINS = [
    'Algebra',
    'Advanced Math',
    'Problem-Solving and Data Analysis',
    'Geometry and Trigonometry',
]

VALID_SKILLS = {
    'Algebra': [
        'Linear equations in one variable',
        'Linear functions',
        'Linear equations in two variables',
        'Systems of two linear equations in two variables',
        'Linear inequalities in one or two variables',
    ],
    'Advanced Math': [
        'Nonlinear functions',
        'Nonlinear equations in one variable and system of equations in two variables',
        'Equivalent expressions',
    ],
    'Problem-Solving and Data Analysis': [
        'Ratios, rates, proportional relationships, and units',
        'Percentages',
        'One-variable data: Distributions and measures of center and spread',
        'Two-variable data: Models and scatterplots',
        'Probability and conditional probability',
        'Inference from sample statistics and margin of error',
        'Evaluating statistical claims: Observational studies and experiments',
    ],
    'Geometry and Trigonometry': [
        'Area and volume',
        'Lines, angles, and triangles',
        'Right triangles and trigonometry',
        'Circles',
    ],
}

def canonicalize_domain(raw):
    if not raw:
        return ''
    matches = difflib.get_close_matches(raw.strip(), VALID_DOMAINS, n=1, cutoff=0.4)
    return matches[0] if matches else raw.strip()

def canonicalize_skill(raw, domain):
    if not raw or domain not in VALID_SKILLS:
        return raw.strip() if raw else ''
    candidates = VALID_SKILLS[domain]
    matches = difflib.get_close_matches(raw.strip(), candidates, n=1, cutoff=0.35)
    return matches[0] if matches else raw.strip()


# ── Constants ─────────────────────────────────────────────────────────────────

VISUAL_KEYWORDS = re.compile(
    r'\b(graph|chart|figure|table|diagram|image|plot|bar|pie|scatter|histogram)\b',
    re.IGNORECASE
)

CHOICE_RE = re.compile(r'^([ABCD])[.\s]\s*(.+)', re.DOTALL)

# OCR sometimes mis-reads colons, pipes, or adds spaces in known keywords
ID_RE       = re.compile(r'Question\s+ID\s*[:\|]\s*(\S+)', re.IGNORECASE)
ANSWER_RE   = re.compile(r'Correct\s+Answer\s*[:\|]\s*([ABCD])', re.IGNORECASE)
SPR_ANSWER  = re.compile(r'Correct\s+Answer\s*[:\|]\s*([0-9][^\n]*)', re.IGNORECASE)

# Regex to detect embedded choice markers within a choice's accumulated text.
# Matches " B " / " C. " / " d. " but not "f(2)" or mid-word occurrences.
EMBEDDED_CHOICE_RE = re.compile(
    r'(?<!\w)\s+([ABCD])[.\s]\s+',
    re.IGNORECASE
)

# Metadata noise lines that sometimes bleed into the Question section
META_HEADER_RE = re.compile(
    r'\b(Assessment|Test\b|Domain|Skill|Difficulty)\b',
    re.IGNORECASE
)
META_VALUE_RE = re.compile(
    r'^\s*(SAT|Mathematics|Math)\s+(Algebra|Advanced|Problem|Geometry)',
    re.IGNORECASE
)


# ── PDF rendering ─────────────────────────────────────────────────────────────

def render_page_to_image(page, dpi=200):
    """Render a PyMuPDF page to a PIL Image at the given DPI."""
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    return img


def page_has_embedded_images(page):
    """Return True if the PDF page contains embedded raster images."""
    return len(page.get_images(full=False)) > 0


# ── Text cleaning ─────────────────────────────────────────────────────────────

def clean_question_text(text):
    """
    Strip lines that look like the metadata table header or value rows
    that sometimes bleed into the Question section due to OCR layout drift.
    """
    lines = text.splitlines()
    clean = []
    for line in lines:
        if META_HEADER_RE.search(line):
            continue
        if META_VALUE_RE.match(line):
            continue
        clean.append(line)
    return '\n'.join(clean).strip()


# ── Text parsing ─────────────────────────────────────────────────────────────

def split_blocks(full_text):
    """Split OCR'd text into per-question blocks on 'Question ID:' markers."""
    parts = re.split(r'(?=Question\s+ID\s*[:\|])', full_text, flags=re.IGNORECASE)
    return [p.strip() for p in parts if re.match(r'Question\s+ID\s*[:\|]', p.strip(), re.IGNORECASE)]


def parse_metadata(block):
    """Parse the metadata table row (Assessment | Test | Domain | Skill | Difficulty)."""
    lines = [l.strip() for l in block.splitlines() if l.strip()]

    header_idx = None
    for i, line in enumerate(lines):
        if re.search(r'\bAssessment\b', line, re.IGNORECASE) and \
           re.search(r'\bDifficulty\b', line, re.IGNORECASE):
            header_idx = i
            break

    if header_idx is None or header_idx + 1 >= len(lines):
        return {}

    values = lines[header_idx + 1]
    meta = {}

    diff_m = re.search(r'\b(Easy|Medium|Hard)\b', values, re.IGNORECASE)
    if diff_m:
        meta['Difficulty'] = diff_m.group(1).capitalize()
        before_diff = values[:diff_m.start()].strip()
    else:
        before_diff = values

    test_m = re.search(r'\b(Mathematics|Math)\b', before_diff, re.IGNORECASE)
    if test_m:
        meta['Test'] = 'Mathematics'

    domain_m = re.search(
        r'\b(Algebra|Advanced\s+Math(?:ematics)?'
        r'|Problem.Solving\s+and\s+Data\s+Analysis'
        r'|Geometry\s+and\s+Trigonometry)\b',
        before_diff, re.IGNORECASE
    )
    if domain_m:
        raw = domain_m.group(1)
        raw = re.sub(r'Advanced\s+Mathematics', 'Advanced Math', raw, flags=re.IGNORECASE)
        meta['Domain'] = canonicalize_domain(raw.strip())

    if domain_m:
        skill_text = before_diff[domain_m.end():].strip()
        if skill_text:
            meta['Skill'] = canonicalize_skill(skill_text, meta.get('Domain', ''))

    if test_m:
        meta['Assessment'] = before_diff[:test_m.start()].strip()

    return meta


def _split_merged_choices(text):
    """
    Given a choice's accumulated text, look for embedded choice letters and
    return a dict of {letter: text} for any embedded choices found.
    E.g. "60 c. 700" → {'C': '700'}
    OCR frequently renders embedded choice markers as lowercase (c., d.) so
    the regex must be case-insensitive.
    Returns empty dict if no embedded choices detected.
    """
    # Primary: split on  <space> + letter + period  (e.g. " c. ", " c.h", " D. ")
    # No (?<!\w) lookbehind — it fires on digits too (e.g. "60 c. 700" fails
    # because '0' is a word char).  We rely on the leading \s+ as the boundary.
    # \s* after the period handles both " c. text" and " c.text".
    parts = re.split(r'\s+([ABCDabcd])\.\s*', text)
    if len(parts) <= 1:
        # Fallback: uppercase letter followed by two-or-more spaces (no period)
        parts = re.split(r'\s+([ABCD])\s{2,}', text)
        if len(parts) <= 1:
            return {}

    result = {}
    i = 1
    while i < len(parts) - 1:
        letter = parts[i].upper()
        value  = parts[i + 1].strip()
        result[letter] = value
        i += 2
    return result


def parse_choices(choices_text):
    """Parse 'A  text\nB  text\n...' into {A: ..., B: ..., C: ..., D: ...}."""
    choices = {}
    current_letter = None
    current_lines = []

    for line in choices_text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = CHOICE_RE.match(line)
        if m:
            if current_letter:
                choices[current_letter] = " ".join(current_lines).strip()
            current_letter = m.group(1).upper()
            current_lines = [m.group(2).strip()]
        elif current_letter:
            current_lines.append(line)

    if current_letter:
        choices[current_letter] = " ".join(current_lines).strip()

    # Post-process: if any choice has embedded choice letters, split them out
    merged = False
    for letter in list(choices.keys()):
        text = choices[letter]
        splits = _split_merged_choices(text)
        if splits:
            # The first part (before the first split) belongs to current letter
            first_part = re.split(
                r'\s+[ABCDabcd]\.\s*|\s+[ABCD]\s{2,}',
                text, maxsplit=1
            )[0].strip()
            if first_part:
                choices[letter] = first_part
            else:
                del choices[letter]
            for k, v in splits.items():
                if k not in choices:  # don't overwrite already-parsed choices
                    choices[k] = v
            merged = True

    return choices, merged


def parse_block(block):
    """
    Parse a single question block. Returns:
      - dict on success
      - None if block cannot be parsed
      - 'SPR' string if this is a Student Produced Response question
    """
    id_match = ID_RE.match(block)
    if not id_match:
        return None
    qid = id_match.group(1).strip()

    # Detect SPR (free-response) questions — numeric correct answer, no ABCD
    spr_match = SPR_ANSWER.search(block)
    ca_match  = ANSWER_RE.search(block)
    if spr_match and not ca_match:
        return 'SPR'

    meta = parse_metadata(block)

    # If metadata parse didn't yield a domain, try scanning the full block
    if not meta.get('Domain'):
        domain_scan = re.search(
            r'\b(Algebra|Advanced\s+Math(?:ematics)?'
            r'|Problem.Solving\s+and\s+Data\s+Analysis'
            r'|Geometry\s+and\s+Trigonometry)\b',
            block, re.IGNORECASE
        )
        if domain_scan:
            raw = re.sub(r'Advanced\s+Mathematics', 'Advanced Math',
                         domain_scan.group(1), flags=re.IGNORECASE)
            meta['Domain'] = canonicalize_domain(raw.strip())

    q_match   = re.search(r'\bQuestion\b\s*\n', block, re.IGNORECASE)
    a_match   = re.search(r'\bAnswer\b\s*\n', block, re.IGNORECASE)
    rat_match = re.search(r'\bRationale\b\s*\n', block, re.IGNORECASE)

    question_text = ""
    choices = {}
    answer = ""
    rationale = ""
    merged_choices = False

    if q_match and a_match and q_match.end() < a_match.start():
        raw_q = block[q_match.end():a_match.start()].strip()
        question_text = clean_question_text(raw_q)

    if a_match:
        choices_end = ca_match.start() if ca_match else (rat_match.start() if rat_match else len(block))
        choices_raw = block[a_match.end():choices_end]
        choices, merged_choices = parse_choices(choices_raw)

    if ca_match:
        answer = ca_match.group(1).upper()

    if rat_match:
        rationale = block[rat_match.end():].strip()

    has_visual = bool(VISUAL_KEYWORDS.search(question_text))

    # Canonicalize skill now that domain is final
    if meta.get('Skill') and meta.get('Domain'):
        meta['Skill'] = canonicalize_skill(meta['Skill'], meta['Domain'])

    record = {
        "ID": qid,
        "Question": question_text,
        "A": choices.get("A", ""),
        "B": choices.get("B", ""),
        "C": choices.get("C", ""),
        "D": choices.get("D", ""),
        "Answer": answer,
        "Rationale": rationale,
        "Difficulty": meta.get("Difficulty", ""),
        "Test": meta.get("Test", "Mathematics"),
        "Assessment": meta.get("Assessment", ""),
        "Domain": meta.get("Domain", ""),
        "Skill": meta.get("Skill", ""),
    }

    incomplete = any(not choices.get(l, "").strip() for l in "ABCD")

    flags = []
    if not question_text:
        flags.append("image-only-question")
    if has_visual:
        flags.append("visual-keyword")
    if merged_choices:
        flags.append("merged-choices")
    if incomplete:
        flags.append("incomplete-choices")
    if not meta.get('Domain'):
        flags.append("missing-metadata")

    if flags:
        record["_flag"] = ",".join(flags)

    return record


# ── Domain index mapping ───────────────────────────────────────────────────────

DOMAIN_TO_IDX = {
    'Algebra':                             0,
    'Advanced Math':                       1,
    'Problem-Solving and Data Analysis':   2,
    'Problem.Solving and Data Analysis':   2,
    'Geometry and Trigonometry':           3,
}

def domain_idx(domain_str):
    for k, v in DOMAIN_TO_IDX.items():
        if k.lower() in domain_str.lower():
            return v
    return -1


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    import argparse as _argparse
    parser = _argparse.ArgumentParser(description='Extract math SAT questions from a PDF via OCR.')
    parser.add_argument('pdf_path', help='Source PDF file')
    parser.add_argument('output_path', nargs='?', default=None, help='Output JSON file')
    parser.add_argument('--assessment', default=None,
                        choices=['SAT', 'PSAT/NMSQT and PSAT 10', 'PSAT 8/9'],
                        help='Override the Assessment field (use when PDF metadata is missing/wrong)')
    args = parser.parse_args()

    pdf_path        = args.pdf_path
    output_path     = args.output_path
    assessment_override = args.assessment
    out_dir         = os.path.dirname(output_path) if output_path else '.'

    print(f"Opening {pdf_path} ...", file=sys.stderr)
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"Pages: {total_pages}", file=sys.stderr)

    all_text_parts = []   # (page_num, ocr_text, has_embedded_image)
    for i, page in enumerate(doc):
        if (i + 1) % 50 == 0:
            print(f"  OCR progress: {i+1}/{total_pages} pages...", file=sys.stderr)
        img      = render_page_to_image(page, dpi=200)
        text     = pytesseract.image_to_string(img, config='--psm 3')
        has_img  = page_has_embedded_images(page)
        all_text_parts.append((i + 1, text, has_img))

    print("OCR complete. Parsing blocks...", file=sys.stderr)

    full_text = "\n".join(t for _, t, _ in all_text_parts)
    blocks    = split_blocks(full_text)
    print(f"Found {len(blocks)} question block(s).", file=sys.stderr)

    # Build page-boundary index for approximate page lookup
    page_boundaries = []
    pos = 0
    for page_num, text, _ in all_text_parts:
        page_boundaries.append((pos, pos + len(text), page_num))
        pos += len(text) + 1

    def find_page_for_pos(char_pos):
        for start, end, pnum in page_boundaries:
            if start <= char_pos < end:
                return pnum
        return -1

    questions  = []
    skipped    = 0
    flagged    = 0
    spr_count  = 0
    spr_records = []

    search_start = 0
    for i, block in enumerate(blocks):
        result = parse_block(block)

        if result is None:
            print(f"  [SKIP] Block {i+1} could not be parsed", file=sys.stderr)
            skipped += 1
            continue

        if result == 'SPR':
            id_m = ID_RE.match(block)
            spr_id = id_m.group(1) if id_m else f"block_{i+1}"
            spr_records.append(spr_id)
            spr_count += 1
            continue

        # Apply assessment override if provided
        if assessment_override:
            result['Assessment'] = assessment_override

        # Find approximate page number
        block_pos = full_text.find(block[:80], search_start)
        if block_pos >= 0:
            search_start = block_pos
        page_num = find_page_for_pos(block_pos) if block_pos >= 0 else -1

        # Flag if the page had an embedded image (and not already flagged)
        page_has_img = any(has_img for pn, _, has_img in all_text_parts if pn == page_num)
        if page_has_img:
            existing = result.get("_flag", "")
            if "embedded-image" not in existing:
                result["_flag"] = (existing + ",embedded-image").lstrip(",")

        # Always store page number so extract_math_images.py --all can find any question
        result["_page"] = page_num

        if "_flag" in result:
            flagged += 1
            print(f"  [FLAG] {result['ID']} (p{page_num}) — {result['_flag']}", file=sys.stderr)

        questions.append(result)

    print(
        f"Parsed: {len(questions)}  Skipped: {skipped}  "
        f"Flagged: {flagged}  SPR: {spr_count}",
        file=sys.stderr
    )

    result_json = json.dumps(questions, indent=2, ensure_ascii=False)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(result_json)
        print(f"Written to {output_path}", file=sys.stderr)

        # Write flagged list (used by extract_math_images.py)
        # Only include questions that need images (visual/embedded/image-only, not just metadata issues)
        IMAGE_FLAGS = {'visual-keyword', 'embedded-image', 'image-only-question'}
        flagged_records = [
            q for q in questions
            if "_flag" in q and any(f in IMAGE_FLAGS for f in q["_flag"].split(","))
        ]
        if flagged_records:
            flags_path = os.path.join(out_dir, "math_flagged.txt")
            with open(flags_path, "w", encoding="utf-8") as f:
                f.write(f"Flagged questions ({len(flagged_records)}) — images needed\n")
                f.write("=" * 60 + "\n\n")
                for q in flagged_records:
                    preview = q['Question'][:120].replace('\n', ' ')
                    if len(q['Question']) > 120:
                        preview += "..."
                    f.write(f"ID: {q['ID']}\n")
                    f.write(f"Page: {q.get('_page', '?')}\n")
                    f.write(f"Flag: {q['_flag']}\n")
                    f.write(f"Q: {preview}\n\n")
            print(f"Flagged list written to {flags_path}", file=sys.stderr)

        # Write SPR list
        if spr_records:
            spr_path = os.path.join(out_dir, "math_spr.txt")
            with open(spr_path, "w", encoding="utf-8") as f:
                f.write(f"Student Produced Response questions skipped ({len(spr_records)})\n")
                f.write("=" * 60 + "\n")
                for qid in spr_records:
                    f.write(f"{qid}\n")
            print(f"SPR list written to {spr_path}", file=sys.stderr)
    else:
        print(result_json)


if __name__ == "__main__":
    main()
