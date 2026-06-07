"""
patch_merged_choices.py — Fix merged answer choices in SAT-Math-Questions.json
without re-running the full OCR extraction.

OCR frequently collapses multi-column answer layouts onto one line, e.g.:
    B: "60 c. 700"   →   B: "60",  C: "700"
    B: "h=8s+15 c.h=15s+8 d.h=8s"  →  B/C/D split out

Run after extract_math_questions.py:
    python SAT-Questions/patch_merged_choices.py [path/to/SAT-Math-Questions.json]
"""

import sys
import re
import json

json_path = sys.argv[1] if len(sys.argv) > 1 else 'SAT-Questions/SAT-Math-Questions.json'

# ── Same split logic as extract_math_questions.py ────────────────────────────

def _split_merged_choices(text):
    """Split 'text c. more text d. final' → {'C': 'more text', 'D': 'final'}"""
    # No (?<!\w) lookbehind — it fires on digits (e.g. "60 c. 700" fails because
    # '0' is \w).  \s* after period handles both " c. text" and " c.text".
    parts = re.split(r'\s+([ABCDabcd])\.\s*', text)
    if len(parts) <= 1:
        parts = re.split(r'\s+([ABCD])\s{2,}', text)
        if len(parts) <= 1:
            return {}
    result = {}
    i = 1
    while i < len(parts) - 1:
        v = parts[i + 1].strip()
        if v:
            result[parts[i].upper()] = v
        i += 2
    return result


def try_fix_choices(q):
    """
    Attempt to redistribute merged choice text across A/B/C/D.
    Returns True if any change was made.
    """
    changed = False
    for letter in list('ABCD'):
        text = q.get(letter, '')
        if not text:
            continue
        splits = _split_merged_choices(text)
        if not splits:
            continue
        # The part before the first split belongs to 'letter'
        first = re.split(r'\s+[ABCDabcd]\.\s*|\s+[ABCD]\s{2,}',
                         text, maxsplit=1)[0].strip()
        if first:
            q[letter] = first
        else:
            q[letter] = ''
        for k, v in splits.items():
            if not q.get(k):   # only fill empty slots
                q[k] = v
                changed = True
        changed = True
    return changed


# ── Main ─────────────────────────────────────────────────────────────────────

with open(json_path, encoding='utf-8') as f:
    questions = json.load(f)

fixed = 0
still_incomplete = 0

for q in questions:
    was_incomplete = any(not (q.get(l) or '').strip() for l in 'ABCD')
    if not was_incomplete:
        # Also re-check for hidden merges in non-empty choices
        try_fix_choices(q)
        continue

    changed = try_fix_choices(q)

    now_incomplete = any(not (q.get(l) or '').strip() for l in 'ABCD')

    if changed and not now_incomplete:
        # Remove incomplete-choices flag if it was the only issue
        existing = q.get('_flag', '')
        flags = [f.strip() for f in existing.split(',') if f.strip() and f.strip() != 'incomplete-choices']
        if flags:
            q['_flag'] = ','.join(flags)
        elif '_flag' in q and q['_flag'] == 'incomplete-choices':
            del q['_flag']
        fixed += 1
    elif now_incomplete:
        still_incomplete += 1

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

print(f"Fixed:            {fixed}")
print(f"Still incomplete: {still_incomplete}  (these need manual review)")
print(f"Updated:          {json_path}")
