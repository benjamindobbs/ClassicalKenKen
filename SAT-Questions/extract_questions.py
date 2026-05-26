"""
extract_questions.py — Extract SAT/PSAT questions from College Board PDF exports.

Usage:
    pip install pdfplumber
    python extract_questions.py <input.pdf> [output.json]

If output.json is omitted, prints to stdout.

Expected PDF structure per question block:
    Question ID: <id>
    Assessment: ...
    Test: ...           (appears in metadata table)
    Domain: ...
    Skill: ...
    Difficulty: Easy / Medium / Hard
    Question
    <question text>
    Answer
    A  <choice A>
    B  <choice B>
    C  <choice C>
    D  <choice D>
    Correct Answer: <letter>
    Rationale
    <rationale text>
"""

import sys
import re
import json
import pdfplumber


VISUAL_KEYWORDS = re.compile(
    r'\b(graph|chart|figure|table|diagram|image|plot|bar|pie|scatter|histogram)\b',
    re.IGNORECASE
)

CHOICE_RE = re.compile(r'^([ABCD])[.\s]\s*(.+)', re.DOTALL)


def extract_text(pdf_path: str) -> str:
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=3, y_tolerance=3)
            if text:
                pages.append(text)
    return "\n".join(pages)


def split_blocks(full_text: str) -> list[str]:
    """Split the full PDF text into per-question blocks on 'Question ID:' markers."""
    parts = re.split(r'(?=Question ID\s*:)', full_text, flags=re.IGNORECASE)
    return [p.strip() for p in parts if re.match(r'Question ID\s*:', p.strip(), re.IGNORECASE)]


def parse_metadata(block: str) -> dict:
    """Parse the 2-row metadata table (header row then values row)."""
    lines = [l.strip() for l in block.splitlines() if l.strip()]

    # Find the header row: a line containing both "Assessment" and "Difficulty"
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

    # Difficulty is the last column: always Easy / Medium / Hard
    diff_m = re.search(r'\b(Easy|Medium|Hard)\b', values, re.IGNORECASE)
    if diff_m:
        meta['Difficulty'] = diff_m.group(1).capitalize()
        before_diff = values[:diff_m.start()].strip()
    else:
        before_diff = values

    # Test: "Reading and Writing" or "Math(ematics)"
    test_m = re.search(r'\b(Reading and Writing|Mathematics|Math)\b', before_diff, re.IGNORECASE)
    if test_m:
        meta['Test'] = test_m.group(1)

    # Domain: known SAT/PSAT domain names
    domain_m = re.search(
        r'\b(Information and Ideas|Craft and Structure|Expression of Ideas'
        r'|Standard English Conventions|Algebra|Advanced Math'
        r'|Problem.Solving and Data Analysis|Geometry and Trigonometry)\b',
        before_diff, re.IGNORECASE
    )
    if domain_m:
        meta['Domain'] = domain_m.group(1)

    # Skill: text that follows the domain and precedes Difficulty
    if domain_m:
        skill_text = before_diff[domain_m.end():].strip()
        if skill_text:
            meta['Skill'] = skill_text

    # Assessment: text before Test
    if test_m:
        meta['Assessment'] = before_diff[:test_m.start()].strip()

    return meta


def parse_choices(choices_text: str) -> dict:
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
            current_letter = m.group(1)
            current_lines = [m.group(2).strip()]
        elif current_letter:
            current_lines.append(line)

    if current_letter:
        choices[current_letter] = " ".join(current_lines).strip()

    return choices


def parse_block(block: str) -> dict | None:
    """Parse a single question block into a structured dict. Returns None on failure."""
    # --- Question ID ---
    id_match = re.match(r'Question ID\s*:\s*(\S+)', block, re.IGNORECASE)
    if not id_match:
        return None
    qid = id_match.group(1).strip()

    meta = parse_metadata(block)

    # --- Locate section markers (case-insensitive) ---
    q_match = re.search(r'\bQuestion\b\s*\n', block, re.IGNORECASE)
    a_match = re.search(r'\bAnswer\b\s*\n', block, re.IGNORECASE)
    ca_match = re.search(r'Correct Answer\s*:\s*([ABCD])', block, re.IGNORECASE)
    rat_match = re.search(r'\bRationale\b\s*\n', block, re.IGNORECASE)

    question_text = ""
    choices = {}
    answer = ""
    rationale = ""

    if q_match and a_match and q_match.end() < a_match.start():
        question_text = block[q_match.end():a_match.start()].strip()

    if a_match:
        choices_end = ca_match.start() if ca_match else (rat_match.start() if rat_match else len(block))
        choices_raw = block[a_match.end():choices_end]
        choices = parse_choices(choices_raw)

    if ca_match:
        answer = ca_match.group(1).upper()

    if rat_match:
        rationale = block[rat_match.end():].strip()

    has_visual = bool(VISUAL_KEYWORDS.search(question_text))

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
        "Test": meta.get("Test", ""),
        "Domain": meta.get("Domain", ""),
        "Skill": meta.get("Skill", ""),
    }

    if has_visual:
        record["_flag"] = "may contain chart/graph — verify manually"

    return record


def main():
    if len(sys.argv) < 2:
        print("Usage: python extract_questions.py <input.pdf> [output.json]", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"Extracting text from {pdf_path} ...", file=sys.stderr)
    full_text = extract_text(pdf_path)

    blocks = split_blocks(full_text)
    print(f"Found {len(blocks)} question block(s).", file=sys.stderr)

    questions = []
    skipped = 0
    flagged = 0

    for i, block in enumerate(blocks):
        record = parse_block(block)
        if record is None:
            print(f"  [SKIP] Block {i+1} could not be parsed", file=sys.stderr)
            skipped += 1
            continue
        if "_flag" in record:
            flagged += 1
            print(f"  [FLAG] {record['ID']} — {record['_flag']}", file=sys.stderr)
        questions.append(record)

    print(f"Parsed: {len(questions)}  Skipped: {skipped}  Flagged: {flagged}", file=sys.stderr)

    result = json.dumps(questions, indent=2, ensure_ascii=False)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"Written to {output_path}", file=sys.stderr)

        flagged_records = [q for q in questions if "_flag" in q]
        if flagged_records:
            flags_path = re.sub(r'\.json$', '_flagged.txt', output_path, flags=re.IGNORECASE)
            if flags_path == output_path:
                flags_path = output_path + "_flagged.txt"
            with open(flags_path, "w", encoding="utf-8") as f:
                f.write(f"Flagged questions ({len(flagged_records)}) — screenshot these manually\n")
                f.write("=" * 60 + "\n\n")
                for i, q in enumerate(flagged_records, 1):
                    preview = q['Question'][:120].replace('\n', ' ')
                    if len(q['Question']) > 120:
                        preview += "..."
                    f.write(f"{i}. ID: {q['ID']}\n")
                    f.write(f"   Skill: {q.get('Skill', '')}  |  Difficulty: {q.get('Difficulty', '')}\n")
                    f.write(f"   Q: {preview}\n\n")
            print(f"Flagged list written to {flags_path}", file=sys.stderr)
    else:
        print(result)


if __name__ == "__main__":
    main()
