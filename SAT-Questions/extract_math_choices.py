"""
extract_math_choices.py — Crop the answer choices of multiple-choice math SAT
questions out of the PDF as images, packed into one sprite per question.

The math PDFs have no text layer (every glyph is a vector path), and Tesseract
cannot reliably read math notation, so OCR'd choice text is often wrong or
missing. Instead of reading the choices, this script only uses OCR to *locate*
the layout landmarks, then crops the rendered choices directly:

  1. OCR the left margin of the page to find the 'Answer' heading and the
     'Correct Answer: X' line (the choices sit between them). If there is no
     'Correct Answer' line, the choices continue onto the following page(s).
  2. The 'A.'/'B.'/'C.'/'D.' markers are the only ink in a narrow column at the
     left margin, so they are found as blobs rather than by OCR.
  3. The answer area is split into vertical blocks of ink. Each marker claims
     the block it sits in; blocks without a marker (e.g. the numerator of a
     fraction, or a graph whose marker sits at its bottom edge) join the
     neighbouring block with the smaller gap. Blocks holding two markers are
     split at the largest blank run between them.
  4. Each choice is cropped (marker excluded), and the four crops are stacked
     into a single greyscale 16-colour PNG sprite.

The JSON file is updated in-place with, for every question that succeeded:

    "choiceSprite": {
        "src":  "math-images/choices/<ID>.png",
        "size": [W, H],              # sprite size in px
        "A": [y, w, h], ...          # slice offset/size in px (x is always 0)
    }

Slices are rendered at SPRITE_DPI; the front end scales them by the same
factor as the question image (which is a full 612pt-wide page crop).

Usage:
    python extract_math_choices.py                # all three banks
    python extract_math_choices.py --bank sat     # sat | psat | psat89
    python extract_math_choices.py --bank sat --ids 3d1070c9,995bc06f --debug out/
    python extract_math_choices.py --missing      # retry only questions without a sprite
"""

import sys
import os
import re
import io
import json
import argparse
import difflib
from multiprocessing import Pool

import numpy as np
import fitz  # PyMuPDF
import pytesseract
from PIL import Image


BANKS = {
    'sat':    ('.SAT-Question-Bank/SAT-Math-All-Q.pdf',     'SAT-Math-Questions.json'),
    'psat':   ('.SAT-Question-Bank/PSAT-Math-All-Q.pdf',    'PSAT-Math-Questions.json'),
    'psat89': ('.SAT-Question-Bank/PSAT-8-9-Math-All-Q.pdf', 'PSAT89-Math-Questions.json'),
}
OUT_SUBDIR = 'math-images/choices'

DETECT_DPI = 200            # resolution used for layout analysis
SPRITE_DPI = 150            # resolution of the saved crops (matches visual question images)
Z = DETECT_DPI / 72.0
INK = 160                   # grey level below which a pixel counts as ink
MARKER_COL_PT = 7           # width of the left-margin column holding 'A.' etc.
BLOCK_MERGE_PT = 3          # blank rows shorter than this don't separate blocks
PAGE_BREAK_GAP = 10_000     # pseudo-gap between regions on different pages
PAD_PX = 3                  # padding around each crop, in DETECT_DPI px


# ── Rendering / OCR helpers ─────────────────────────────────────────────────

def render_gray(page, dpi=DETECT_DPI):
    pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), colorspace=fitz.csGRAY)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)


def ocr_lines(gray):
    """OCR an image and return [(text, left, top, height)] per text line."""
    d = pytesseract.image_to_data(Image.fromarray(gray), output_type=pytesseract.Output.DICT)
    lines = {}
    for i, word in enumerate(d['text']):
        if not word.strip():
            continue
        key = (d['block_num'][i], d['par_num'][i], d['line_num'][i])
        ln = lines.setdefault(key, {'words': [], 'left': d['left'][i], 'top': d['top'][i],
                                    'bottom': d['top'][i] + d['height'][i]})
        ln['words'].append(word.strip())
        ln['left'] = min(ln['left'], d['left'][i])
        ln['top'] = min(ln['top'], d['top'][i])
        ln['bottom'] = max(ln['bottom'], d['top'][i] + d['height'][i])
    out = [(' '.join(l['words']), l['left'], l['top'], l['bottom']) for l in lines.values()]
    return sorted(out, key=lambda l: l[2])


def normalize_id(s):
    return s.lower().replace('o', '0').replace('l', '1').replace('i', '1')


def runs(mask, merge=0):
    """[start, end) runs of True in a 1-D mask; blank gaps of <= merge are bridged."""
    idx = np.flatnonzero(mask)
    if not len(idx):
        return []
    out = []
    s = p = idx[0]
    for i in idx[1:]:
        if i - p - 1 > merge:
            out.append((int(s), int(p) + 1))
            s = i
        p = i
    out.append((int(s), int(p) + 1))
    return out


def largest_gap_mid(rowmask, a, b):
    """Midpoint of the longest blank run of rows in [a, b)."""
    best_len, best_mid, cur = -1, (a + b) // 2, None
    for y in range(a, b):
        if rowmask[y]:
            cur = None
            continue
        cur = y if cur is None else cur
        if y - cur + 1 > best_len:
            best_len, best_mid = y - cur + 1, (cur + y + 1) // 2
    return best_mid


# ── Layout analysis ─────────────────────────────────────────────────────────

class Fail(Exception):
    pass


def find_markers(ink, y0, y1, lm):
    """Return [(y_top, y_bot, dot_end_x)] for the A-D markers in rows [y0, y1)."""
    col = ink[y0:y1, lm:lm + int(MARKER_COL_PT * Z)]
    bands = [(a + y0, b + y0) for a, b in runs(col.any(axis=1), merge=2)]
    max_h = 10 * Z  # a capital letter is ~6.5pt tall; anything taller isn't a marker
    bands = [b for b in bands if 3 * Z <= b[1] - b[0] <= max_h]
    markers = []
    for a, b in bands:
        cols = runs(ink[a:b, lm:].any(axis=0), merge=0)
        if len(cols) < 2:
            continue
        markers.append((a, b, lm + cols[1][1]))   # letter, then dot: content starts after the dot
    return markers


def classify_markers(gray, markers, lm):
    """OCR each candidate marker blob; keep those that read as A-D."""
    out = []
    for a, b, dot in markers:
        blob = gray[max(a - 4, 0):b + 4, max(lm - 4, 0):dot + 4]
        blob = np.pad(blob, 20, constant_values=255)
        txt = pytesseract.image_to_string(Image.fromarray(blob),
                                          config='--psm 8 -c tessedit_char_whitelist=ABCD.').strip()
        if txt[:1] in 'ABCD' and txt:
            out.append((txt[0], (a, b, dot)))
    return out


def analyze(doc, page_no, qid):
    """
    Locate the four choices of the question starting on page_no (1-based).
    Returns (choices, correct_letter) where choices maps letter -> list of
    (page_index, fitz.Rect) segments in PDF points, top to bottom.
    """
    page = doc[page_no - 1]
    gray = render_gray(page)
    H, W = gray.shape

    header = ocr_lines(gray[:int(H * 0.08)])
    m = re.search(r'ID\s*[:|]?\s*(\S+)', header[0][0]) if header else None
    # Stored IDs came from OCR too, so allow a character or two of disagreement.
    if not m or difflib.SequenceMatcher(None, normalize_id(m.group(1)), normalize_id(qid)).ratio() < 0.75:
        raise Fail(f'page header ID mismatch ({m.group(1) if m else "none"})')

    # Each region: (page_index, gray, y0, y1, lm)
    regions = []
    lines = ocr_lines(gray[:, :int(W * 0.3)])
    ans = next((l for l in lines if l[0] == 'Answer'), None)
    if not ans:
        # Tesseract's layout analysis sometimes drops the whole answer block
        # (e.g. when it contains stacked fractions). Re-read just the band
        # below the 'Question' heading as a single uniform block.
        q = next((l for l in lines if l[0] == 'Question'), None)
        ca = next((l for l in lines if l[0].startswith('Correct Answer')), None)
        top = q[3] if q else int(H * 0.15)
        band = gray[top:ca[2] if ca else H, :int(W * 0.15)]
        d = pytesseract.image_to_data(Image.fromarray(band), config='--psm 6',
                                      output_type=pytesseract.Output.DICT)
        for i, word in enumerate(d['text']):
            if word.strip() == 'Answer':
                ans = ('Answer', d['left'][i], d['top'][i] + top, d['top'][i] + d['height'][i] + top)
                break
    if not ans:
        raise Fail("no 'Answer' heading")
    lm = ans[1] - 2
    y0 = ans[3] + 2
    correct = None
    pi = page_no - 1
    while True:
        ca = next((l for l in lines if l[0].startswith('Correct Answer') and l[2] > y0), None)
        if ca:
            regions.append((pi, gray, y0, ca[2] - 2, lm))
            cm = re.search(r'Correct Answer\s*[:|]?\s*([ABCD])\b', ca[0])
            correct = cm.group(1) if cm else None
            break
        # choices run past the bottom of this page
        regions.append((pi, gray, y0, gray.shape[0], lm))
        pi += 1
        if pi >= len(doc) or pi > page_no + 1:
            raise Fail("no 'Correct Answer' line within two pages")
        gray = render_gray(doc[pi])
        lines = ocr_lines(gray[:, :int(W * 0.3)])
        if lines and re.match(r'Question\s+ID', lines[0][0]):
            raise Fail("reached next question before 'Correct Answer'")
        y0 = 0

    # Blocks of ink across all regions, with marker assignments.
    blocks = []   # dicts: region, y0, y1, markers[(letter, a, b, dot)]
    all_markers = []
    for ri, (pi, g, ry0, ry1, rlm) in enumerate(regions):
        ink = g < INK
        cand = find_markers(ink, ry0, ry1, rlm)
        all_markers.extend((ri, c) for c in cand)
        rows = ink[ry0:ry1, rlm:W - rlm].any(axis=1)
        for a, b in runs(rows, merge=int(BLOCK_MERGE_PT * Z)):
            blocks.append({'region': ri, 'y0': a + ry0, 'y1': b + ry0, 'markers': []})

    if len(all_markers) == 4:
        letters = list(zip('ABCD', all_markers))
    else:
        # Extra blobs at the margin (e.g. wrapped text or a figure): ask OCR.
        letters = []
        for ri, (pi, g, *_rest) in enumerate(regions):
            cands = [c for r, c in all_markers if r == ri]
            letters += [(L, (ri, c)) for L, c in classify_markers(g, cands, regions[ri][4])]
        if [L for L, _ in letters] != list('ABCD'):
            raise Fail(f'found markers {[L for L, _ in letters]} ({len(all_markers)} blobs)')

    for L, (ri, (a, b, dot)) in letters:
        mid = (a + b) // 2
        blk = next((bk for bk in blocks if bk['region'] == ri and bk['y0'] <= mid < bk['y1']), None)
        if blk is None:
            raise Fail(f'marker {L} not inside any ink block')
        blk['markers'].append((L, a, b, dot))

    # Split blocks that hold several markers at the largest blank run between them.
    split = []
    for bk in blocks:
        ms = sorted(bk['markers'], key=lambda m: m[1])
        if len(ms) <= 1:
            split.append(bk)
            continue
        g = regions[bk['region']][1]
        lm_r = regions[bk['region']][4]
        rowmask = (g < INK)[:, lm_r:W - lm_r].any(axis=1)
        cuts = [bk['y0']]
        for m1, m2 in zip(ms, ms[1:]):
            cuts.append(largest_gap_mid(rowmask, (m1[1] + m1[2]) // 2 + 1, (m2[1] + m2[2]) // 2))
        cuts.append(bk['y1'])
        for k, mk in enumerate(ms):
            split.append({'region': bk['region'], 'y0': cuts[k], 'y1': cuts[k + 1], 'markers': [mk]})
    blocks = split

    # Attach unmarked blocks to the nearer marked neighbour.
    def gap(b1, b2):
        return PAGE_BREAK_GAP if b1['region'] != b2['region'] else b2['y0'] - b1['y1']

    owner = [bk['markers'][0][0] if bk['markers'] else None for bk in blocks]
    for i, bk in enumerate(blocks):
        if owner[i]:
            continue
        prev = next((j for j in range(i - 1, -1, -1) if blocks[j]['markers']), None)
        nxt = next((j for j in range(i + 1, len(blocks)) if blocks[j]['markers']), None)
        if prev is None and nxt is None:
            raise Fail('no marked blocks')
        gp = gap(blocks[i - 1], bk) if prev is not None else float('inf')
        gn = gap(bk, blocks[i + 1]) if nxt is not None else float('inf')
        owner[i] = blocks[prev if gp <= gn else nxt]['markers'][0][0]

    dot_x = {L: dot for L, (_, (_, _, dot)) in letters}
    choices = {}
    for bk, L in zip(blocks, owner):
        pi, g, _, _, rlm = regions[bk['region']]
        x0 = dot_x[L] + 1
        reg = (g < INK)[bk['y0']:bk['y1'], x0:W - rlm]
        ys = np.flatnonzero(reg.any(axis=1))
        xs = np.flatnonzero(reg.any(axis=0))
        if not len(xs):
            continue   # block was only the marker itself
        rect = fitz.Rect((x0 + xs[0] - PAD_PX) / Z, (bk['y0'] + ys[0] - PAD_PX) / Z,
                         (x0 + xs[-1] + 1 + PAD_PX) / Z, (bk['y0'] + ys[-1] + 1 + PAD_PX) / Z)
        choices.setdefault(L, []).append((pi, rect))

    missing = [L for L in 'ABCD' if L not in choices]
    if missing:
        raise Fail(f'no content for choice(s) {missing}')
    return choices, correct


# ── Sprite output ───────────────────────────────────────────────────────────

def crop(doc, pi, rect):
    pix = doc[pi].get_pixmap(matrix=fitz.Matrix(SPRITE_DPI / 72, SPRITE_DPI / 72),
                             clip=rect, colorspace=fitz.csGRAY)
    return Image.frombytes('L', (pix.width, pix.height), pix.samples)


def stack(images):
    w = max(i.width for i in images)
    out = Image.new('L', (w, sum(i.height for i in images)), 255)
    y = 0
    for im in images:
        out.paste(im, (0, y))
        y += im.height
    return out


def build_sprite(doc, choices, out_path):
    slices = [stack([crop(doc, pi, r) for pi, r in choices[L]]) for L in 'ABCD']
    sprite = stack(slices)
    sprite.quantize(16).save(out_path, optimize=True)
    boxes, y = {}, 0
    for L, s in zip('ABCD', slices):
        boxes[L] = [y, s.width, s.height]
        y += s.height
    return sprite.size, boxes


# ── Worker ──────────────────────────────────────────────────────────────────

_doc = None


def _init(pdf_path):
    global _doc
    _doc = fitz.open(pdf_path)


def work(args):
    qid, page_no, out_dir, rel_dir, debug_dir = args
    try:
        choices, correct = analyze(_doc, page_no, qid)
        size, boxes = build_sprite(_doc, choices, os.path.join(out_dir, f'{qid}.png'))
        if debug_dir:
            Image.open(os.path.join(out_dir, f'{qid}.png')).save(os.path.join(debug_dir, f'{qid}.png'))
        multipage = len({pi for segs in choices.values() for pi, _ in segs}) > 1
        return qid, {'src': f'{rel_dir}/{qid}.png', 'size': list(size), **boxes}, correct, multipage, None
    except Fail as e:
        return qid, None, None, False, str(e)
    except Exception as e:  # keep the batch going; report at the end
        return qid, None, None, False, f'{type(e).__name__}: {e}'


def process_bank(name, script_dir, ids, missing_only, debug_dir, jobs):
    pdf_rel, json_rel = BANKS[name]
    pdf_path = os.path.join(script_dir, pdf_rel)
    json_path = os.path.join(script_dir, json_rel)
    out_dir = os.path.join(script_dir, OUT_SUBDIR)
    os.makedirs(out_dir, exist_ok=True)

    with open(json_path, encoding='utf-8') as f:
        questions = json.load(f)
    todo = [q for q in questions
            if q.get('Answer') in ('A', 'B', 'C', 'D') and q.get('_page', -1) > 0
            and (not ids or q['ID'] in ids)
            and not (missing_only and q.get('choiceSprite'))]
    print(f'[{name}] {len(todo)} multiple-choice questions', file=sys.stderr)

    by_id = {q['ID']: q for q in questions}
    tasks = [(q['ID'], q['_page'], out_dir, OUT_SUBDIR, debug_dir) for q in todo]
    ok, failed, answer_mismatch, multipage = 0, [], [], []
    with Pool(jobs, initializer=_init, initargs=(pdf_path,)) as pool:
        for n, (qid, sprite, correct, multi, err) in enumerate(pool.imap_unordered(work, tasks, chunksize=4), 1):
            q = by_id[qid]
            if sprite:
                q['choiceSprite'] = sprite
                ok += 1
                if multi:
                    multipage.append(qid)
                if correct and correct != q['Answer']:
                    answer_mismatch.append((qid, q['Answer'], correct))
            else:
                q.pop('choiceSprite', None)
                failed.append((qid, err))
            if n % 200 == 0:
                print(f'  {n}/{len(tasks)} ...', file=sys.stderr)

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(questions, f, indent=2, ensure_ascii=False)

    print(f'[{name}] sprites: {ok}  failed: {len(failed)}  spanning pages: {len(multipage)}', file=sys.stderr)
    for qid, err in sorted(failed):
        print(f'    FAIL {qid}: {err}', file=sys.stderr)
    for qid, have, seen in answer_mismatch:
        print(f'    ANSWER {qid}: json={have} page={seen}', file=sys.stderr)
    if multipage:
        print(f'    spanning pages (worth a visual check): {" ".join(sorted(multipage))}', file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description='Crop math answer choices into per-question sprites.')
    parser.add_argument('--bank', choices=[*BANKS, 'all'], default='all')
    parser.add_argument('--ids', default='', help='Comma-separated question IDs to (re)process')
    parser.add_argument('--missing', action='store_true',
                        help='Only process questions that do not have a choiceSprite yet')
    parser.add_argument('--debug', default='', help='Also copy each sprite into this directory')
    parser.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 2) - 2))
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    ids = {i.strip() for i in args.ids.split(',') if i.strip()}
    if args.debug:
        os.makedirs(args.debug, exist_ok=True)
    for name in (BANKS if args.bank == 'all' else [args.bank]):
        process_bank(name, script_dir, ids, args.missing, args.debug, args.jobs)


if __name__ == '__main__':
    main()
