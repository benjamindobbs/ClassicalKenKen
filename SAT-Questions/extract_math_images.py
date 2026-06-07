"""
extract_math_images.py — Extract images from flagged math SAT question pages.

Run this AFTER extract_math_questions.py has produced:
  - SAT-Math-Questions.json
  - math_flagged.txt

For each flagged question:
  1. If the PDF page contains an embedded raster image: save the largest one.
  2. Otherwise (pure vector chart/graph): use OCR word bounding boxes to locate
     the 'Answer' section heading, then crop from near the top of the page down
     to just above that heading — capturing the question text and any chart.
     Falls back to the top 55% of the page if detection fails.

The JSON file is updated in-place to add "image": "math-images/<ID>.png" on each
question that got an image extracted.

Usage:
    python extract_math_images.py [--pdf SAT-Math-SAT.pdf]
                                  [--json SAT-Math-Questions.json]
                                  [--flagged math_flagged.txt]
                                  [--out math-images]
"""

import sys
import os
import re
import json
import argparse
import io
import fitz  # PyMuPDF
import pytesseract
from PIL import Image


def parse_flagged(flagged_path):
    """Parse math_flagged.txt into list of {id, page} dicts."""
    records = []
    current = {}
    with open(flagged_path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip()
            m_id   = re.match(r'^ID:\s*(\S+)', line)
            m_page = re.match(r'^Page:\s*(\d+)', line)
            if m_id:
                current['id'] = m_id.group(1)
            elif m_page:
                current['page'] = int(m_page.group(1))
                if 'id' in current:
                    records.append(dict(current))
                current = {}
    return records


def extract_largest_embedded_image(page, out_path):
    """
    Extract the largest raster image embedded on the page and save it.
    Returns True on success.
    """
    images = page.get_images(full=True)
    if not images:
        return False

    doc = page.parent
    best = None
    best_size = 0

    for img_info in images:
        xref = img_info[0]
        try:
            base_image = doc.extract_image(xref)
            size = len(base_image["image"])
            if size > best_size:
                best_size = size
                best = base_image
        except Exception:
            continue

    if best is None:
        return False

    ext = best.get("ext", "png")
    img_bytes = best["image"]

    # Always save as PNG for consistency
    if ext.lower() != "png":
        try:
            img = Image.open(io.BytesIO(img_bytes))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            img_bytes = buf.getvalue()
        except Exception:
            pass  # save original format bytes

    with open(out_path, "wb") as f:
        f.write(img_bytes)
    return True


def smart_crop_question_area(page, out_path, dpi=150):
    """
    Crop from near the top of the page to just above the 'Answer' section heading,
    capturing the question text and any embedded chart/figure.

    Strategy:
      1. Render the page at 150 DPI and run pytesseract.image_to_data() to get
         word-level bounding boxes.
      2. Find the topmost occurrence of the word 'Answer' that sits near the left
         margin (section headings are left-aligned; inline uses of 'answer' appear
         further right in the text body).
      3. Crop from ~12% page height (skipping the ID/metadata header) down to
         8 px above that 'Answer' heading.
      4. Fallback: if 'Answer' is not found, crop the top 10%–55% of the page.
    """
    detect_dpi  = 150
    detect_zoom = detect_dpi / 72.0
    pix_detect  = page.get_pixmap(matrix=fitz.Matrix(detect_zoom, detect_zoom),
                                  colorspace=fitz.csRGB)
    img_detect  = Image.open(io.BytesIO(pix_detect.tobytes("png")))
    img_h = img_detect.height
    img_w = img_detect.width

    data = pytesseract.image_to_data(img_detect, output_type=pytesseract.Output.DICT)

    # Find topmost 'Answer' that sits near the left margin (section heading)
    answer_y_px = None
    for i, word in enumerate(data['text']):
        if word.strip().lower() == 'answer' and int(data['conf'][i]) > 20:
            left = data['left'][i]
            y    = data['top'][i]
            # Section heading: left x < 20% of image width
            if left < img_w * 0.20:
                if answer_y_px is None or y < answer_y_px:
                    answer_y_px = y

    scale = 72.0 / detect_dpi   # pixel → page-point conversion

    # Extra top offset to skip the metadata info table visible at the top of crops
    extra_top_pt = 45 * (72.0 / dpi)   # 45 output-px → page points

    if answer_y_px and answer_y_px > img_h * 0.15:
        # Crop from below the header to 8 px above the Answer heading
        top_pt    = page.rect.y0 + page.rect.height * 0.12 + extra_top_pt
        bottom_pt = page.rect.y0 + min(
            (answer_y_px - 8) * scale,
            page.rect.height * 0.72
        )
        print(
            f"    smart crop: Answer heading at y={answer_y_px}px "
            f"→ [{top_pt:.1f}, {bottom_pt:.1f}] pt",
            file=sys.stderr
        )
    else:
        # Fallback: top 10%–55%
        top_pt    = page.rect.y0 + page.rect.height * 0.10 + extra_top_pt
        bottom_pt = page.rect.y0 + page.rect.height * 0.55
        print(f"    smart crop: fallback top-55% (Answer heading not found)", file=sys.stderr)

    clip = fitz.Rect(page.rect.x0, top_pt, page.rect.x1, bottom_pt)
    zoom = dpi / 72.0
    pix_out = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom),
                               clip=clip, colorspace=fitz.csRGB)
    pix_out.save(out_path)
    return True




IMAGE_FLAGS = {'visual-keyword', 'embedded-image', 'image-only-question'}


def main():
    parser = argparse.ArgumentParser(description="Extract images for math SAT questions.")
    parser.add_argument("--pdf",     default="SAT-Math-SAT.pdf",        help="Source PDF")
    parser.add_argument("--json",    default="SAT-Math-Questions.json",  help="Questions JSON file")
    parser.add_argument("--flagged", default="math_flagged.txt",         help="Flagged question list")
    parser.add_argument("--out",     default="math-images",              help="Output image directory")
    parser.add_argument("--all",     action="store_true",
                        help="Generate question-area images for ALL questions, not just flagged ones. "
                             "Flagged questions use the smart (OCR-guided) crop; pure-text questions "
                             "use a fast fixed crop at lower DPI to save space.")
    args = parser.parse_args()

    # Resolve paths relative to this script's directory
    script_dir   = os.path.dirname(os.path.abspath(__file__))
    pdf_path     = os.path.join(script_dir, args.pdf)
    json_path    = os.path.join(script_dir, args.json)
    flagged_path = os.path.join(script_dir, args.flagged)
    out_dir      = os.path.join(script_dir, args.out)

    required = [(pdf_path, "PDF"), (json_path, "JSON")]
    if not args.all:
        required.append((flagged_path, "Flagged list"))
    for path, label in required:
        if not os.path.exists(path):
            print(f"ERROR: {label} not found: {path}", file=sys.stderr)
            sys.exit(1)

    os.makedirs(out_dir, exist_ok=True)

    with open(json_path, encoding="utf-8") as f:
        questions = json.load(f)

    id_to_idx = {q["ID"]: i for i, q in enumerate(questions)}

    # Build the work list
    if args.all:
        # Every question that has a page number recorded
        work = [
            {"id": q["ID"], "page": q.get("_page", -1), "visual": bool(
                q.get("_flag") and any(f.strip() in IMAGE_FLAGS
                                       for f in q["_flag"].split(","))
            )}
            for q in questions
            if q.get("_page", -1) > 0
        ]
        print(
            f"--all mode: processing {len(work)} questions "
            f"({sum(1 for w in work if w['visual'])} visual, "
            f"{sum(1 for w in work if not w['visual'])} text-only)",
            file=sys.stderr
        )
    else:
        if not os.path.exists(flagged_path):
            print(f"ERROR: Flagged list not found: {flagged_path}", file=sys.stderr)
            sys.exit(1)
        flagged_list = parse_flagged(flagged_path)
        work = [{"id": r["id"], "page": r.get("page", -1), "visual": True}
                for r in flagged_list]
        print(f"Flagged questions to process: {len(work)}", file=sys.stderr)

    print(f"Opening {pdf_path} ...", file=sys.stderr)
    doc = fitz.open(pdf_path)

    embedded_count = 0
    smart_count    = 0
    fixed_count    = 0
    skipped        = 0

    for idx, rec in enumerate(work):
        qid      = rec["id"]
        page_num = rec["page"]
        visual   = rec["visual"]

        if page_num < 1 or page_num > len(doc):
            print(f"  [SKIP] {qid}: invalid page {page_num}", file=sys.stderr)
            skipped += 1
            continue

        if (idx + 1) % 100 == 0:
            print(f"  Progress: {idx+1}/{len(work)} ...", file=sys.stderr)

        page     = doc[page_num - 1]  # 0-indexed
        out_path = os.path.join(out_dir, f"{qid}.png")

        if not args.all and visual and extract_largest_embedded_image(page, out_path):
            # Flagged-only mode: use the raw embedded raster for chart questions
            print(f"  [IMG]  {qid} — embedded image saved", file=sys.stderr)
            embedded_count += 1
        elif visual:
            # --all mode or no embedded image: crop the full question area so
            # question text + chart are both included in the image
            smart_crop_question_area(page, out_path, dpi=150)
            print(f"  [CROP] {qid} (p{page_num}) — smart crop saved", file=sys.stderr)
            smart_count += 1
        else:
            # Text-only: same OCR-guided crop at lower output DPI to save space
            smart_crop_question_area(page, out_path, dpi=100)
            fixed_count += 1

        # Update JSON record
        if qid in id_to_idx:
            questions[id_to_idx[qid]]["image"] = f"math-images/{qid}.png"

    doc.close()

    print(
        f"\nDone. Embedded: {embedded_count}  Visual-crop: {smart_count}  "
        f"Text-crop: {fixed_count}  Skipped: {skipped}",
        file=sys.stderr
    )

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(questions, f, indent=2, ensure_ascii=False)
    print(f"Updated {json_path} with image paths.", file=sys.stderr)


if __name__ == "__main__":
    main()
