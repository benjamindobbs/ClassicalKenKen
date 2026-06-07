"""
patch_ocr_choices.py — Fix common OCR character errors in answer choices.

Applies conservative, high-confidence substitutions only:
  1. O → 0  when O appears in a clearly numeric position
  2. l → 1  when lowercase-l appears adjacent to digits
  3. Variable name harmonization — if the rationale consistently uses f(x)
     but a choice has f(z), replace the wrong variable letter

Run from the repo root:
    python SAT-Questions/patch_ocr_choices.py [path/to/SAT-Math-Questions.json]

Prints a diff-style report of every change made.
"""

import sys
import re
import json
from collections import defaultdict

json_path = sys.argv[1] if len(sys.argv) > 1 else 'SAT-Questions/SAT-Math-Questions.json'

# ---------------------------------------------------------------------------
# Common OCR character confusions and what they are typically confused with.
# Each entry: (wrong, correct, description)
# Applied in order — earlier rules can affect later ones, so order matters.
# ---------------------------------------------------------------------------

def fix_numeric_chars(text):
    """
    Fix O/0 and l/1 confusion in numeric contexts.
    Rules are applied only when surrounding characters make the intent unambiguous.
    """
    if not text:
        return text

    # ── O → 0 ──────────────────────────────────────────────────────────────
    # digit O digit      e.g. "3O5"  → "305"
    text = re.sub(r'(?<=[0-9])O(?=[0-9])', '0', text)
    # O.digit            e.g. "O.5"  → "0.5"
    text = re.sub(r'\bO\.(?=[0-9])', '0.', text)
    # digit O end-of-token  e.g. "1O" → "10"
    text = re.sub(r'(?<=[0-9])O\b', '0', text)
    # start-of-token O digit  e.g. "O1" → "01"  (but NOT "Or", "Of", etc.)
    text = re.sub(r'\bO(?=[0-9])', '0', text)
    # standalone O between math operators / parens  e.g. "(O)" or "+ O +"
    text = re.sub(r'(?<=[\(\+\-\*\/=\s])O(?=[\)\+\-\*\/=\s])', '0', text)

    # ── l → 1 ──────────────────────────────────────────────────────────────
    # digit l digit      e.g. "3l5"  → "315"
    text = re.sub(r'(?<=[0-9])l(?=[0-9])', '1', text)
    # l.digit            e.g. "l.5"  → "1.5"
    text = re.sub(r'\bl\.(?=[0-9])', '1.', text)
    # digit l end-of-token  e.g. "1l" → "11"  (risky — skip; too many false positives)
    # start-of-token l digit  e.g. "l5" → "15"
    text = re.sub(r'\bl(?=[0-9])', '1', text)

    return text


# ---------------------------------------------------------------------------
# Variable name harmonization
# ---------------------------------------------------------------------------

# OCR confusions for single-letter math variables.
# Key = what OCR produces (wrong), Value = list of likely intended letters.
VARIABLE_CONFUSIONS = {
    'z': ['x'],        # x is far more common as a function argument
    'ri': ['n'],       # n rendered as ri in some fonts
    'rn': ['m'],       # m split into rn
    'ii': ['n'],       # n rendered as ii
}

# Pattern to extract the argument variable from function notation like f(x), g(t), h(n)
FUNC_VAR_RE = re.compile(r'\b[a-zA-Z]\(([a-zA-Z]{1,2})\)')


def extract_func_variables(text):
    """Return the set of variable letters used as function arguments in text."""
    return set(FUNC_VAR_RE.findall(text or ''))


def harmonize_variables(choice_text, reference_vars):
    """
    Replace OCR-wrong variables in choice_text with the correct ones inferred
    from reference_vars (the set of known-good variables from the rationale).

    Only applies when the wrong variable appears in function-call notation
    (e.g. f(z)) and a known correct variable for that function exists.
    """
    if not choice_text or not reference_vars:
        return choice_text

    result = choice_text
    choice_vars = extract_func_variables(choice_text)

    for wrong, candidates in VARIABLE_CONFUSIONS.items():
        if wrong not in choice_vars:
            continue
        for correct in candidates:
            if correct in reference_vars:
                # Replace only inside function-call parens to avoid clobbering
                # standalone uses of the letter that might be intentional.
                result = re.sub(
                    r'(\b[a-zA-Z]\()' + re.escape(wrong) + r'(\))',
                    lambda m: m.group(1) + correct + m.group(2),
                    result
                )
                break  # only apply the first matching candidate per wrong letter

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

with open(json_path, encoding='utf-8') as f:
    questions = json.load(f)

total_changes = 0
changed_questions = 0

for q in questions:
    rationale_vars = extract_func_variables(q.get('Rationale', ''))
    # Also mine the question text itself for known-good variables
    question_vars  = extract_func_variables(q.get('Question', ''))
    reference_vars = rationale_vars | question_vars

    q_changed = False
    for letter in 'ABCD':
        original = q.get(letter, '')
        if not original:
            continue

        fixed = fix_numeric_chars(original)
        fixed = harmonize_variables(fixed, reference_vars)

        if fixed != original:
            print(f"  {q['ID']} [{letter}]  {original!r}  ->  {fixed!r}")
            q[letter] = fixed
            total_changes += 1
            q_changed = True

    if q_changed:
        changed_questions += 1

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

print(f"\nChanged {total_changes} choice(s) across {changed_questions} question(s).")
print(f"Updated: {json_path}")
