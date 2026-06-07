"""
classify_domains.py — Assign Domain and Skill to questions that are missing them,
using keyword matching against question text and rationale.

Usage:
    python SAT-Questions/classify_domains.py <path/to/questions.json>

Overwrites the file in place and prints a summary.
"""

import sys
import json
import re

json_path = sys.argv[1] if len(sys.argv) > 1 else 'SAT-Questions/SAT-Math-Missing-Domains-extracted.json'

# ---------------------------------------------------------------------------
# Keyword sets per domain — checked against question + rationale text combined
# More specific patterns first to reduce false positives
# ---------------------------------------------------------------------------

GEOMETRY_PATTERNS = [
    r'\bangle\b', r'\btriangle\b', r'\bcircle\b', r'\bradius\b', r'\bdiameter\b',
    r'\bcircumference\b', r'\barc\b', r'\bchord\b', r'\bsine\b', r'\bcosine\b',
    r'\btangent\b', r'\bsin\b', r'\bcos\b', r'\btan\b', r'\btrigonometr',
    r'\bperimeter\b', r'\bhypotenuse\b', r'\bpolygon\b', r'\brectangle\b',
    r'\bsquare\b', r'\barea\b', r'\bvolume\b', r'\bsphere\b', r'\bcylinder\b',
    r'\bcone\b', r'\bpyramid\b', r'\bdegree[s]?\b', r'\bright angle\b',
    r'\bisosceles\b', r'\bequilateral\b', r'\bparallel\b', r'\bperpendicular\b',
    r'\bcoordinate[s]?\b.*\bdistance\b', r'\bmidpoint\b',
]

PSDA_PATTERNS = [
    r'\bprobability\b', r'\bpercent', r'\bproportion\b', r'\bratio\b',
    r'\brate\b', r'\bsurvey\b', r'\bsample\b', r'\bpopulation\b',
    r'\bmean\b', r'\bmedian\b', r'\bmode\b', r'\brange\b',
    r'\bdistribution\b', r'\bscatter', r'\bcorrelation\b',
    r'\bmargin of error\b', r'\bstatistic', r'\bdata\b',
    r'\bunit[s]?\b', r'\bconversion\b', r'\binterquartile\b',
    r'\bstandard deviation\b', r'\bfrequency\b', r'\bhistogram\b',
    r'\bbar (?:graph|chart)\b', r'\bpie chart\b', r'\btable\b.*\bdata\b',
    r'\brandomly selected\b', r'\bsimulation\b', r'\bexperiment\b',
    r'\bobservational study\b', r'\bconfidence interval\b',
    r'\bestimate\b.*\bpopulation\b', r'\bsales\b.*\bprice\b',
]

ADVANCED_MATH_PATTERNS = [
    r'\bquadratic\b', r'\bpolynomial\b', r'\bnonlinear\b',
    r'\bexponential\b', r'\bequivalent expression\b',
    r'\brational expression\b', r'\bradical\b', r'\bsquare root\b',
    r'\bparabola\b', r'\bvertex\b', r'\bfactored form\b',
    r'\bcomplete the square\b', r'\bdiscriminant\b',
    r'\bcomplex number\b', r'\bimaginary\b',
    r'f\s*\(\s*x\s*\)', r'g\s*\(\s*x\s*\)',
    r'\bcomposite function\b', r'\binverse function\b',
    r'\basymptote\b',
]

ALGEBRA_PATTERNS = [
    r'\blinear equation\b', r'\blinear function\b', r'\blinear inequalit',
    r'\bslope\b', r'\by-intercept\b', r'\bx-intercept\b',
    r'\bsystem of (?:linear )?equation', r'\bsystem of two',
    r'\binequality\b', r'\bsolve for\b', r'\bvalue of [xy]\b',
    r'\bwhat is the value\b', r'\bsolution to the (?:given )?system\b',
]

# Skill assignment per domain — first matching pattern wins
SKILL_PATTERNS = {
    'Algebra': [
        ('Linear equations in one variable',
         [r'\blinear equation\b.*\bone variable\b', r'\bsolve\b.*\bfor [xy]\b', r'\bvalue of [xy]\b']),
        ('Linear functions',
         [r'\blinear function\b', r'\bslope\b', r'\by-intercept\b', r'\bx-intercept\b']),
        ('Linear equations in two variables',
         [r'\btwo variables\b', r'\bline\b.*\bequation\b', r'\bgraph\b.*\blinear\b']),
        ('Systems of two linear equations in two variables',
         [r'\bsystem\b', r'\btwo equation\b']),
        ('Linear inequalities in one or two variables',
         [r'\binequalit', r'\bgreater than\b', r'\bless than\b']),
    ],
    'Advanced Math': [
        ('Nonlinear functions',
         [r'\bexponential\b', r'\bnonlinear\b', r'f\s*\(\s*x\s*\)', r'\bparabola\b']),
        ('Nonlinear equations in one variable and system of equations in two variables',
         [r'\bquadratic\b', r'\bpolynomial\b.*\bsolve\b', r'\bfactored\b']),
        ('Equivalent expressions',
         [r'\bequivalent\b', r'\bsimplif', r'\bfactored form\b', r'\bexpand\b']),
    ],
    'Problem-Solving and Data Analysis': [
        ('Ratios, rates, proportional relationships, and units',
         [r'\bratio\b', r'\brate\b', r'\bproportion\b', r'\bunit[s]?\b', r'\bconversion\b']),
        ('Percentages',
         [r'\bpercent', r'\b%\b']),
        ('One-variable data: Distributions and measures of center and spread',
         [r'\bmean\b', r'\bmedian\b', r'\bstandard deviation\b', r'\binterquartile\b', r'\bdistribution\b']),
        ('Two-variable data: Models and scatterplots',
         [r'\bscatter', r'\bcorrelation\b', r'\bline of best fit\b', r'\bregression\b']),
        ('Probability and conditional probability',
         [r'\bprobability\b', r'\blikelihood\b', r'\brandom\b']),
        ('Inference from sample statistics and margin of error',
         [r'\bmargin of error\b', r'\bconfidence interval\b', r'\bsample\b.*\bpopulation\b']),
        ('Evaluating statistical claims: Observational studies and experiments',
         [r'\bobservational study\b', r'\bexperiment\b', r'\bcausalit', r'\bsurvey\b']),
    ],
    'Geometry and Trigonometry': [
        ('Area and volume',
         [r'\barea\b', r'\bvolume\b', r'\bsurface area\b']),
        ('Lines, angles, and triangles',
         [r'\bangle\b', r'\btriangle\b', r'\bparallel\b', r'\bperpendicular\b']),
        ('Right triangles and trigonometry',
         [r'\bright triangle\b', r'\bhypotenuse\b', r'\bsin\b', r'\bcos\b', r'\btan\b',
          r'\btrigonometr']),
        ('Circles',
         [r'\bcircle\b', r'\bradius\b', r'\bdiameter\b', r'\bcircumference\b', r'\barc\b']),
    ],
}


def score_domain(text, patterns):
    count = 0
    for p in patterns:
        if re.search(p, text, re.IGNORECASE):
            count += 1
    return count


def classify_question(q):
    combined = ' '.join([
        q.get('Question', ''),
        q.get('Rationale', ''),
        q.get('A', ''), q.get('B', ''), q.get('C', ''), q.get('D', ''),
    ])

    scores = {
        'Geometry and Trigonometry':          score_domain(combined, GEOMETRY_PATTERNS),
        'Problem-Solving and Data Analysis':   score_domain(combined, PSDA_PATTERNS),
        'Advanced Math':                       score_domain(combined, ADVANCED_MATH_PATTERNS),
        'Algebra':                             score_domain(combined, ALGEBRA_PATTERNS),
    }

    best_domain = max(scores, key=scores.get)
    if scores[best_domain] == 0:
        return '', ''

    # Assign best-fit skill
    best_skill = ''
    for skill_name, skill_pats in SKILL_PATTERNS.get(best_domain, []):
        for sp in skill_pats:
            if re.search(sp, combined, re.IGNORECASE):
                best_skill = skill_name
                break
        if best_skill:
            break

    return best_domain, best_skill


# ---------------------------------------------------------------------------

with open(json_path, encoding='utf-8') as f:
    questions = json.load(f)

classified = 0
skipped = 0

for q in questions:
    if q.get('Domain'):
        continue  # already has a domain — leave it alone

    domain, skill = classify_question(q)
    if domain:
        q['Domain'] = domain
        q['Skill'] = skill
        # Remove missing-metadata flag if domain was the only issue and question is otherwise complete
        flags = [f.strip() for f in (q.get('_flag') or '').split(',') if f.strip()]
        if 'missing-metadata' in flags:
            flags.remove('missing-metadata')
        if flags:
            q['_flag'] = ','.join(flags)
        elif '_flag' in q:
            del q['_flag']
        classified += 1
    else:
        skipped += 1

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(questions, f, indent=2, ensure_ascii=False)

from collections import Counter
domain_counts = Counter(q.get('Domain', '') for q in questions if q.get('Domain'))
print(f"Classified: {classified}  |  Still unclassified: {skipped}")
print("Domain breakdown after classification:")
for d, n in domain_counts.most_common():
    print(f"  {n:4d}  {d}")
print(f"Updated: {json_path}")
