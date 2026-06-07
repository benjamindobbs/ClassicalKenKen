"""
patch_math_flags.py — Add 'incomplete-choices' flag to existing SAT-Math-Questions.json
without re-running the full OCR extraction.

Usage:
    python SAT-Questions/patch_math_flags.py [path/to/SAT-Math-Questions.json]
"""

import sys
import json

json_path = sys.argv[1] if len(sys.argv) > 1 else 'SAT-Questions/SAT-Math-Questions.json'

with open(json_path, encoding='utf-8') as f:
    questions = json.load(f)

patched = 0
for q in questions:
    incomplete = any(not (q.get(l) or '').strip() for l in 'ABCD')
    if not incomplete:
        continue

    existing = q.get('_flag', '')
    flags = [f for f in existing.split(',') if f.strip()] if existing else []
    if 'incomplete-choices' not in flags:
        flags.append('incomplete-choices')
        q['_flag'] = ','.join(flags)
        patched += 1

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

print(f"Patched {patched} question(s) with 'incomplete-choices' flag → {json_path}")
