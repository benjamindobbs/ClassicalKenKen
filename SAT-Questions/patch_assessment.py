"""
patch_assessment.py — Retroactively add Assessment field to existing question JSONs.

Usage:
    python SAT-Questions/patch_assessment.py [path/to/file.json] [--assessment SAT]

Defaults: SAT-Math-Questions.json, assessment='SAT'
"""

import sys
import json
import argparse

parser = argparse.ArgumentParser(description='Add Assessment field to question JSON.')
parser.add_argument('json_path', nargs='?', default='SAT-Questions/SAT-Math-Questions.json')
parser.add_argument('--assessment', default='SAT',
                    choices=['SAT', 'PSAT/NMSQT and PSAT 10', 'PSAT 8/9'],
                    help='Assessment type to assign to questions missing the field')
args = parser.parse_args()

with open(args.json_path, encoding='utf-8') as f:
    questions = json.load(f)

patched = 0
for q in questions:
    if not q.get('Assessment'):
        q['Assessment'] = args.assessment
        patched += 1

with open(args.json_path, 'w', encoding='utf-8') as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

print(f"Added Assessment='{args.assessment}' to {patched} question(s).")
print(f"Updated: {args.json_path}")
