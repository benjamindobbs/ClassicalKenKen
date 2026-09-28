// Answer choices cropped from the source PDFs are packed into one sprite per
// question (see SAT-Questions/extract_math_choices.py and extract_english.py):
//
//     { src, size: [W, H], A: [y, w, h], B: [...], C: [...], D: [...] }
//
// choiceSlice() renders one choice as a background-image slice of that sprite.
// cssWidth(w) returns the CSS width for a slice that is w sprite pixels wide,
// so each page can choose its own scale.
function choiceSlice(sprite, letter, cssWidth, label) {
    const [W, H] = sprite.size;
    const [y, w, h] = sprite[letter];
    const el = document.createElement('span');
    el.className = 'choice-img';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label || 'Choice ' + letter);
    el.style.backgroundImage = "url('../SAT-Questions/" + sprite.src + "')";
    el.style.width = 'min(100%, ' + cssWidth(w) + ')';
    el.style.aspectRatio = w + ' / ' + h;
    // Percentages keep the slice aligned however the element ends up scaled.
    el.style.backgroundSize = (W / w * 100) + '% auto';
    el.style.backgroundPosition = '0 ' + (H === h ? 0 : y / (H - h) * 100) + '%';
    return el;
}
