"""
extract_english.py — Rebuild the English (Reading and Writing) question banks
from the College Board PDF exports, with the question and answer choices cropped
out of the PDF as images.

Unlike the math PDFs, the English PDFs have a real text layer, so nothing here
needs OCR: every landmark comes from exact text positions.

  1. Every page that starts with 'Question ID: <id>' begins a question, which
     runs until the next such page.
  2. The metadata table (Assessment / Test / Domain / Skill / Difficulty) is
     read by column position. Cell values wrap onto a second line (e.g.
     'Standard English' / 'Conventions'), which is what broke the old
     line-based extract_questions.py and left Standard English Conventions
     questions with no Domain or Skill.
  3. Headings ('Question', 'Answer', 'Correct Answer: X', 'Rationale') are
     set in a different font from body text; the 'A.'-'D.' markers are body
     lines at the left margin between 'Answer' and 'Correct Answer'.
  4. The question area and each choice are rendered and trimmed to their ink.
     The four choices are stacked into one sprite per question, in the same
     format as the math sprites.

Each bank's JSON is rewritten from scratch. Every question gets the text
fields (used as alt text and as a fallback when an image is missing):

    ID, Question, A, B, C, D, Answer, Rationale, Difficulty, Test, Domain,
    Skill, Assessment, _page

and, when cropping succeeded:

    "image":        "english-images/<ID>.png",
    "imageSize":    [W, H],                  # px at IMAGE_DPI
    "choiceSprite": {"src": "english-images/choices/<ID>.png",
                     "size": [W, H], "A": [y, w, h], ...}

Rationale paragraphs are separated by a blank line ('\\n\\n'); lines within a
paragraph are joined with spaces.

Usage:
    python extract_english.py                     # all three banks
    python extract_english.py --bank sat          # sat | psat | psat89
    python extract_english.py --bank sat --ids f1bfbed3,de55ec71 --debug out/
    python extract_english.py --text-only         # rebuild JSON text/metadata, keep existing images
"""

import sys
import os
import re
import json
import argparse
from collections import Counter
from multiprocessing import Pool

# Workers only do elementwise array work; a full BLAS thread pool per worker
# just exhausts memory.
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')

import numpy as np
import pymupdf
from PIL import Image


BANKS = {
    'sat':    ('SAT-English-Questions.pdf',      'SAT-English-Questions.json'),
    'psat':   ('PSAT-10-English-Questions.pdf',  'PSAT-English-Questions.json'),
    'psat89': ('PSAT-8-9-English-Questions.pdf', 'PSAT89-English-Questions.json'),
}
PDF_DIRS = ['.', '.SAT-Question-Bank']
OUT_DIR = 'english-images'
CHOICE_DIR = 'english-images/choices'

IMAGE_DPI = 150
Z = IMAGE_DPI / 72.0
INK = 200               # grey level below which a pixel counts as ink when trimming
PAD_PT = 2              # padding kept around trimmed crops
RIGHT_EDGE_PT = 600     # text never runs past this x
TEXT_FLAGS = pymupdf.TEXT_INHIBIT_SPACES | pymupdf.TEXT_PRESERVE_LIGATURES | pymupdf.TEXT_PRESERVE_WHITESPACE
META_COLS = ['Assessment', 'Test', 'Domain', 'Skill', 'Difficulty']
SKILL_FIXES = {'Cross-text Connections': 'Cross-Text Connections'}


class Fail(Exception):
    pass


# ── Page scanning ───────────────────────────────────────────────────────────

def question_id(page):
    ws = page.get_text('words')
    if len(ws) > 2 and ws[0][4] == 'Question' and ws[1][4] == 'ID:' and ws[0][1] < 60:
        return ws[2][4]
    return None


def page_lines(doc, pi):
    """[(pi, rect, font, text)] for every text line on the page, top to bottom."""
    out = []
    for b in doc[pi].get_text('dict', flags=TEXT_FLAGS)['blocks']:
        if b['type'] != 0:
            continue
        for ln in b['lines']:
            text = ''.join(s['text'] for s in ln['spans'])
            if text.strip():
                out.append((pi, pymupdf.Rect(ln['bbox']), ln['spans'][0]['font'], text))
    return sorted(out, key=lambda l: (l[1].y0, l[1].x0))


def read_metadata(page):
    ws = page.get_text('words')
    labels = {w[4]: w for w in ws if w[1] < 75 and w[4] in META_COLS}
    if set(labels) != set(META_COLS):
        raise Fail('metadata table not found')
    qhead = next((w for w in ws if w[4] == 'Question' and w[1] > labels['Test'][3] + 5 and w[0] < 25), None)
    if not qhead:
        raise Fail("no 'Question' heading")
    bounds = [labels[c][0] - 3 for c in META_COLS] + [1e9]
    cells = {c: [] for c in META_COLS}
    for w in sorted(ws, key=lambda w: (round(w[1]), w[0])):
        if labels['Test'][3] < w[1] < qhead[1]:
            for i, c in enumerate(META_COLS):
                if bounds[i] <= w[0] < bounds[i + 1]:
                    cells[c].append(w[4])
    meta = {c: ' '.join(v) for c, v in cells.items()}
    meta['Skill'] = SKILL_FIXES.get(meta['Skill'], meta['Skill'])
    return meta, qhead[3]


# ── Question analysis ───────────────────────────────────────────────────────

def segments(doc, start, end):
    """
    Split the range start=(pi, y) .. end=(pi, y) into per-page (pi, Rect)
    segments spanning the full text width.
    """
    (p0, y0), (p1, y1) = start, end
    out = []
    for pi in range(p0, p1 + 1):
        top = y0 if pi == p0 else 0
        bot = y1 if pi == p1 else doc[pi].rect.height
        if bot - top > 1:
            out.append((pi, pymupdf.Rect(0, top, RIGHT_EDGE_PT, bot)))
    return out


def seg_text(doc, segs, x0=0):
    lines = []
    for pi, r in segs:
        clip = pymupdf.Rect(max(r.x0, x0), r.y0, r.x1, r.y1)
        lines += [l.rstrip() for l in doc[pi].get_text('text', clip=clip, flags=TEXT_FLAGS).split('\n')]
    return '\n'.join(l for l in lines if l.strip())


def paragraphs(lines):
    """Join body lines into paragraphs, breaking where the vertical gap is large."""
    if not lines:
        return ''
    heights = [l[1].height for l in lines]
    step = sorted(b[1].y0 - a[1].y0 for a, b in zip(lines, lines[1:]) if a[0] == b[0]) or [max(heights) * 1.6]
    normal = step[len(step) // 2]
    paras, cur = [], [lines[0][3].strip()]
    for a, b in zip(lines, lines[1:]):
        if a[0] == b[0] and b[1].y0 - a[1].y0 > normal * 1.5:
            paras.append(' '.join(cur))
            cur = []
        cur.append(b[3].strip())
    paras.append(' '.join(cur))
    return '\n\n'.join(p for p in paras if p)


def analyze(doc, first, last):
    """Parse the question spanning pages first..last (0-based, inclusive)."""
    meta, qhead_bottom = read_metadata(doc[first])
    lines = [l for pi in range(first, last + 1) for l in page_lines(doc, pi)]

    qhead = next(l for l in lines if l[0] == first and l[3].strip() == 'Question' and l[1].y0 >= qhead_bottom - 12)
    head_font = qhead[2]
    after_q = lines[lines.index(qhead) + 1:]

    def heading(pred, pool):
        return next((l for l in pool if l[2] == head_font and pred(l[3].strip())), None)

    ans = heading(lambda t: t == 'Answer', after_q)
    if not ans:
        raise Fail("no 'Answer' heading")
    after_a = after_q[after_q.index(ans) + 1:]
    ca = heading(lambda t: t.startswith('Correct Answer'), after_a)
    if not ca:
        raise Fail("no 'Correct Answer' line")
    m = re.search(r'Correct Answer:\s*([ABCD])\b', ca[3])
    if not m:
        raise Fail(f'unreadable answer line {ca[3]!r}')
    correct = m.group(1)
    rat = heading(lambda t: t == 'Rationale', after_a[after_a.index(ca) + 1:])

    # Choice markers: body lines at the left margin starting 'A.' .. 'D.'.
    between = after_a[:after_a.index(ca)]
    markers = []
    for l in between:
        mm = re.match(r'([ABCD])\.', l[3])
        if mm and l[1].x0 < 25 and l[2] != head_font:
            markers.append((mm.group(1), l))
    if [L for L, _ in markers] != list('ABCD'):
        raise Fail(f'choice markers {[L for L, _ in markers]}')

    # Where each choice's content begins horizontally: just past the 'X.' marker.
    content_x = {}
    for L, l in markers:
        chars = [c for b in doc[l[0]].get_text('rawdict', clip=l[1], flags=TEXT_FLAGS)['blocks']
                 for ln in b.get('lines', []) for s in ln['spans'] for c in s['chars']]
        dot = next((c for c in chars if c['c'] == '.'), None)
        content_x[L] = (dot['bbox'][2] if dot else l[1].x0 + 9) + 1

    q_segs = segments(doc, (first, qhead[1].y1 + 1), (ans[0], ans[1].y0 - 1))
    choice_segs = {}
    bounds = [(l[0], l[1].y0 - 1) for _, l in markers] + [(ca[0], ca[1].y0 - 1)]
    for k, (L, _) in enumerate(markers):
        choice_segs[L] = [(pi, pymupdf.Rect(content_x[L], r.y0, r.x1, r.y1))
                          for pi, r in segments(doc, bounds[k], bounds[k + 1])]

    if rat:
        rat_lines = [l for l in after_a[after_a.index(rat) + 1:]]
    else:
        rat_lines = []

    record = {
        'Question': seg_text(doc, q_segs),
        **{L: ' '.join(seg_text(doc, choice_segs[L], content_x[L]).split()) for L in 'ABCD'},
        'Answer': correct,
        'Rationale': paragraphs(rat_lines),
        'Difficulty': meta['Difficulty'],
        'Test': meta['Test'],
        'Domain': meta['Domain'],
        'Skill': meta['Skill'],
        'Assessment': meta['Assessment'],
    }
    return record, q_segs, choice_segs


# ── Image output ────────────────────────────────────────────────────────────

def render(doc, pi, rect):
    pix = doc[pi].get_pixmap(matrix=pymupdf.Matrix(Z, Z), clip=rect, colorspace=pymupdf.csRGB)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)


def trim(img, keep_x0=False):
    """Crop an RGB array to its ink (plus padding). None if it has no ink."""
    ink = img.min(axis=2) < INK
    ys, xs = np.flatnonzero(ink.any(axis=1)), np.flatnonzero(ink.any(axis=0))
    if not len(ys):
        return None
    pad = int(PAD_PT * Z)
    x0 = 0 if keep_x0 else max(xs[0] - pad, 0)
    return img[max(ys[0] - pad, 0):ys[-1] + 1 + pad, x0:xs[-1] + 1 + pad]


def stack(arrays, left=None):
    w = max(a.shape[1] for a in arrays)
    out = np.full((sum(a.shape[0] for a in arrays), w, 3), 255, np.uint8)
    y = 0
    for a in arrays:
        out[y:y + a.shape[0], :a.shape[1]] = a
        y += a.shape[0]
    return out


def crop_segments(doc, segs, keep_x0=False):
    parts = [t for t in (trim(render(doc, pi, r), keep_x0) for pi, r in segs) if t is not None]
    if not parts:
        return None
    return stack(parts)


def is_colour(img):
    c = img.astype(np.int16)
    return int((np.abs(c[..., 0] - c[..., 1]) + np.abs(c[..., 1] - c[..., 2])).max()) > 40


def save(img, path):
    """Plain text quantizes to a few grey levels; figures keep more colours."""
    if is_colour(img):
        Image.fromarray(img).quantize(32, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
    else:
        grey = Image.fromarray(img).convert('L')
        grey.quantize(4 if not has_figure(img) else 16).save(path, optimize=True)


def has_figure(img):
    """Mid-grey fills (table shading, chart areas) need more than 4 levels."""
    g = img.min(axis=2)
    mid = (g > 90) & (g < 235)
    return mid.mean() > 0.03


# ── Worker ──────────────────────────────────────────────────────────────────

_doc = None


def _init(pdf_path):
    global _doc
    _doc = pymupdf.open(pdf_path)


def work(args):
    qid, first, last, script_dir, images, debug_dir = args
    try:
        record, q_segs, choice_segs = analyze(_doc, first, last)
    except Fail as e:
        return qid, None, str(e)
    except Exception as e:  # keep the batch going; report at the end
        return qid, None, f'{type(e).__name__}: {e}'
    record = {'ID': qid, **record, '_page': first + 1}
    if not images:
        return qid, record, None
    try:
        q_img = crop_segments(_doc, q_segs, keep_x0=True)
        slices = [crop_segments(_doc, choice_segs[L]) for L in 'ABCD']
        if q_img is None or any(s is None for s in slices):
            raise Fail('empty crop')
        q_rel = f'{OUT_DIR}/{qid}.png'
        save(q_img, os.path.join(script_dir, q_rel))
        record['image'] = q_rel
        record['imageSize'] = [q_img.shape[1], q_img.shape[0]]

        sprite = stack(slices)
        c_rel = f'{CHOICE_DIR}/{qid}.png'
        save(sprite, os.path.join(script_dir, c_rel))
        boxes, y = {}, 0
        for L, s in zip('ABCD', slices):
            boxes[L] = [y, s.shape[1], s.shape[0]]
            y += s.shape[0]
        record['choiceSprite'] = {'src': c_rel, 'size': [sprite.shape[1], sprite.shape[0]], **boxes}
        if debug_dir:
            Image.fromarray(q_img).save(os.path.join(debug_dir, f'{qid}_q.png'))
            Image.fromarray(sprite).save(os.path.join(debug_dir, f'{qid}_choices.png'))
        return qid, record, None
    except Exception as e:
        return qid, record, f'image: {type(e).__name__}: {e}'


# ── Driver ──────────────────────────────────────────────────────────────────

def find_pdf(script_dir, name):
    for d in PDF_DIRS:
        p = os.path.join(script_dir, d, name)
        if os.path.exists(p):
            return p
    raise SystemExit(f'PDF not found: {name} (looked in {PDF_DIRS})')


def process_bank(name, script_dir, ids, images, debug_dir, jobs):
    pdf_name, json_name = BANKS[name]
    pdf_path = find_pdf(script_dir, pdf_name)
    json_path = os.path.join(script_dir, json_name)
    for d in (OUT_DIR, CHOICE_DIR):
        os.makedirs(os.path.join(script_dir, d), exist_ok=True)

    doc = pymupdf.open(pdf_path)
    starts = [(pi, qid) for pi in range(len(doc)) if (qid := question_id(doc[pi]))]
    dupes = [q for q, n in Counter(q for _, q in starts).items() if n > 1]
    if dupes:
        print(f'[{name}] WARNING duplicate IDs in PDF: {dupes}', file=sys.stderr)
    spans = [(qid, pi, (starts[k + 1][0] if k + 1 < len(starts) else len(doc)) - 1)
             for k, (pi, qid) in enumerate(starts)]
    order = {qid: k for k, (qid, _, _) in enumerate(spans)}

    existing = {}
    if os.path.exists(json_path):
        with open(json_path, encoding='utf-8') as f:
            existing = {q['ID']: q for q in json.load(f)}

    todo = [s for s in spans if not ids or s[0] in ids]
    print(f'[{name}] {len(spans)} questions in PDF, processing {len(todo)}', file=sys.stderr)

    results, failed, img_failed = {}, [], []
    tasks = [(qid, a, b, script_dir, images, debug_dir) for qid, a, b in todo]
    with Pool(jobs, initializer=_init, initargs=(pdf_path,)) as pool:
        for n, (qid, rec, err) in enumerate(pool.imap_unordered(work, tasks, chunksize=4), 1):
            if rec is None:
                failed.append((qid, err))
            else:
                if err:
                    img_failed.append((qid, err))
                elif not images and qid in existing:
                    for k in ('image', 'imageSize', 'choiceSprite'):
                        if k in existing[qid]:
                            rec[k] = existing[qid][k]
                results[qid] = rec
            if n % 200 == 0:
                print(f'  {n}/{len(tasks)} ...', file=sys.stderr)

    if ids:
        # Partial run: merge into the current file instead of replacing it.
        merged = {**existing, **results}
        out = sorted(merged.values(), key=lambda q: order.get(q['ID'], 1e9))
    else:
        out = sorted(results.values(), key=lambda q: order[q['ID']])
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f'[{name}] written: {len(results)}  parse failures: {len(failed)}  image failures: {len(img_failed)}',
          file=sys.stderr)
    for qid, err in sorted(failed):
        print(f'    FAIL {qid}: {err}', file=sys.stderr)
    for qid, err in sorted(img_failed):
        print(f'    IMAGE {qid}: {err}', file=sys.stderr)
    skills = Counter((q['Domain'], q['Skill']) for q in results.values())
    for (d, s), n in sorted(skills.items()):
        print(f'    {n:5}  {d} / {s}', file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description='Rebuild English question banks with cropped images.')
    parser.add_argument('--bank', choices=[*BANKS, 'all'], default='all')
    parser.add_argument('--ids', default='', help='Comma-separated question IDs to (re)process')
    parser.add_argument('--text-only', action='store_true',
                        help='Only rebuild text/metadata; keep image fields from the existing JSON')
    parser.add_argument('--debug', default='', help='Also save full-colour crops into this directory')
    parser.add_argument('--jobs', type=int, default=min(6, max(1, (os.cpu_count() or 2) - 2)))
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    ids = {i.strip() for i in args.ids.split(',') if i.strip()}
    if args.debug:
        os.makedirs(args.debug, exist_ok=True)
    for name in (BANKS if args.bank == 'all' else [args.bank]):
        process_bank(name, script_dir, ids, not args.text_only, args.debug, args.jobs)


if __name__ == '__main__':
    main()
