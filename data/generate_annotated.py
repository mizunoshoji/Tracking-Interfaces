#!/usr/bin/env python3
"""
Generate annotated SVG from touch JSON.
A3 landscape: left = visualization, right = context info.
Layout defined in layout.json.
"""
import sys, json, math, re
from pathlib import Path
from datetime import datetime, timezone

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from recompose_stroke import parse_lff, glyph_for_char, advance_for_char

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
LAYOUT        = BASE / 'layout.json'
FONT_PRIMARY  = BASE / 'fonts' / 'azomix.lff'
FONT_FALLBACK = BASE / 'fonts' / 'unicode.lff'
FONT_CODE     = BASE / 'fonts' / 'kst32b.lff'

CIRCLE_R     = 4.0
HATCH_STEP   = 1.6
STROKE_START = '#9b59b6'  # lavender — touch start point
STROKE_END   = '#e91e63'  # pink     — touch end point
OPERATOR     = 'mizuno shoji'

# ---------------------------------------------------------------------------
# Font
# ---------------------------------------------------------------------------
primary  = parse_lff(FONT_PRIMARY)
fallback = parse_lff(FONT_FALLBACK)
code_font = parse_lff(FONT_CODE)

def text_paths(text: str, x0: float, y0: float, size: float) -> list:
    scale = size / 10.0
    x, ds = x0, []
    for ch in text:
        g   = glyph_for_char(ch, primary, fallback)
        adv = advance_for_char(ch, primary, fallback)
        if g:
            for stroke in g.strokes:
                pts = [(x + gx * scale, y0 - gy * scale) for gx, gy in stroke]
                if len(pts) >= 2:
                    ds.append('M ' + ' L '.join(f'{px:.3f},{py:.3f}' for px, py in pts))
        x += adv * scale
    return ds

def text_width(text: str, size: float) -> float:
    scale = size / 10.0
    return sum(advance_for_char(ch, primary, fallback) * scale for ch in text)

def code_text_paths(text: str, x0: float, y0: float, size: float) -> list:
    scale = size / 10.0
    x, ds = x0, []
    for ch in text:
        g   = glyph_for_char(ch, code_font, fallback)
        adv = advance_for_char(ch, code_font, fallback)
        if g:
            for stroke in g.strokes:
                pts = [(x + gx * scale, y0 - gy * scale) for gx, gy in stroke]
                if len(pts) >= 2:
                    ds.append('M ' + ' L '.join(f'{px:.3f},{py:.3f}' for px, py in pts))
        x += adv * scale
    return ds

def code_text_width(text: str, size: float) -> float:
    scale = size / 10.0
    return sum(advance_for_char(ch, code_font, fallback) * scale for ch in text)

# ---------------------------------------------------------------------------
# Hatch
# ---------------------------------------------------------------------------
def hatch_lines_in_circle(cx, cy, r, step, angle_deg=45):
    angle = math.radians(angle_deg)
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    perp_cos, perp_sin = -sin_a, cos_a
    ds, t = [], -r
    while t <= r:
        lx, ly = cx + perp_cos * t, cy + perp_sin * t
        dx, dy = lx - cx, ly - cy
        b    = cos_a * dx + sin_a * dy
        disc = b * b - (dx * dx + dy * dy - r * r)
        if disc >= 0:
            sq = math.sqrt(disc)
            s1, s2 = -b - sq, -b + sq
            ds.append(f'M {lx+cos_a*s1:.3f},{ly+sin_a*s1:.3f} L {lx+cos_a*s2:.3f},{ly+sin_a*s2:.3f}')
        t += step
    return ds

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def parse_title_from_stem(stem: str) -> str:
    m = re.match(r'^touch_\d+_(.*)', stem)
    return m.group(1) if m else stem

def build_context_lines(data: dict) -> list:
    strokes    = data.get('strokes', [])
    all_pts    = [p for s in strokes for p in s.get('points', [])]
    timestamps = [p['timestamp'] for p in all_pts]

    exported_at = data.get('exportedAt', '')
    try:
        dt = datetime.fromisoformat(exported_at.replace('Z', '+00:00'))
        exported_str = dt.strftime('%Y-%m-%d  %H:%M:%S UTC')
    except Exception:
        exported_str = exported_at

    vp     = data.get('viewport')
    vp_str = f"{vp['width']} x {vp['height']} pt" if vp else 'N/A'
    session_ms = (max(timestamps) - min(timestamps)) if len(timestamps) >= 2 else 0
    rec_start    = (datetime.fromtimestamp(min(timestamps)/1000, tz=timezone.utc).strftime('%H:%M:%S.')
                    + f'{min(timestamps)%1000:03d}') if timestamps else 'N/A'
    rec_end      = (datetime.fromtimestamp(max(timestamps)/1000, tz=timezone.utc).strftime('%H:%M:%S.')
                    + f'{max(timestamps)%1000:03d}') if timestamps else 'N/A'
    rec_start_num = str(min(timestamps)) if timestamps else 'N/A'
    rec_end_num   = str(max(timestamps)) if timestamps else 'N/A'
    total_pts  = len(all_pts)
    avg_pts    = total_pts / len(strokes) if strokes else 0
    single_pt  = sum(1 for s in strokes if len(s.get('points', [])) < 2)
    multi_pt   = len(strokes) - single_pt
    dv         = data.get('device') or {}

    return [
        ('--- SESSION ---',  ''),
        ('rec start unix ms', rec_start_num),
        ('rec end unix ms',   rec_end_num),
        ('duration',         f'{session_ms/1000:.1f} sec'),
        ('',                 ''),
        ('--- CONTENT ---',  ''),
        ('url',              data.get('url', 'N/A')),
        ('',                 ''),
        ('--- DEVICE ---',   ''),
        ('viewport',         vp_str),
        ('brand',            dv.get('brand',     'N/A') or 'N/A'),
        ('model',            dv.get('model',     'N/A') or 'N/A'),
        ('os',               dv.get('os',        'N/A') or 'N/A'),
        ('os version',       dv.get('osVersion', 'N/A') or 'N/A'),
        ('',                 ''),
        ('--- STROKES ---',  ''),
        ('total strokes',    str(len(strokes))),
        ('total points',     str(total_pts)),
        ('',                 ''),
        ('--- USER ---',     ''),
        ('name',             OPERATOR),
    ]

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------
if len(sys.argv) < 2:
    candidates = sorted(BASE.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    candidates = [c for c in candidates if 'layout' not in c.name]
    if not candidates:
        print('usage: generate_annotated.py <input.json>')
        sys.exit(1)
    INPUT_JSON = candidates[0]
else:
    INPUT_JSON = Path(sys.argv[1])

OUTPUT_SVG = INPUT_JSON.with_name(INPUT_JSON.stem + '_annotated.svg')

with open(LAYOUT) as f:
    layout = json.load(f)
with open(INPUT_JSON) as f:
    data = json.load(f)

strokes = data['strokes']
vp      = data.get('viewport')
VP_W    = vp['width']  if vp else 375
VP_H    = vp['height'] if vp else 523

doc = layout['document']
lp  = layout['left_panel']
rp  = layout['right_panel']
div = layout['divider']
DOC_W, DOC_H = doc['width'], doc['height']

# scale viewport to fill left panel with padding
avail_w = lp['width']  - lp['padding'] * 2
avail_h = lp['height'] - lp['padding'] * 2
scale   = min(avail_w / VP_W, avail_h / VP_H)
frame_w = VP_W * scale
frame_h = VP_H * scale
OX      = lp['x'] + (lp['width']  - frame_w) / 2
OY      = lp['y'] + (lp['height'] - frame_h) / 2

print(f'viewport: {VP_W}x{VP_H}  scale: {scale:.3f}  frame: {frame_w:.1f}x{frame_h:.1f}  offset: ({OX:.1f},{OY:.1f})')

# ---------------------------------------------------------------------------
# Build SVG
# ---------------------------------------------------------------------------
lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    f'<svg xmlns="http://www.w3.org/2000/svg"',
    f'     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"',
    f'     viewBox="0 0 {DOC_W} {DOC_H}" width="{DOC_W}pt" height="{DOC_H}pt">',
]

# -- layout layer
lines += [
    '  <g inkscape:label="layout" inkscape:groupmode="layer" id="layer_layout">',
    f'    <rect x="{OX:.3f}" y="{OY:.3f}" width="{frame_w:.3f}" height="{frame_h:.3f}" fill="none" stroke="#000" stroke-width="0.5"/>',
    f'    <line x1="{div["x"]}" y1="0" x2="{div["x"]}" y2="{DOC_H}" stroke="#000" stroke-width="{div["stroke_width"]}"/>',
    '  </g>',
]

# -- stroke layers: 3 sub-layers per stroke, globally sequential numbering
layer_num = 1
for idx, stroke in enumerate(strokes):
    pts = stroke['points']
    if not pts:
        continue
    n = idx + 1  # stroke number for label

    # trajectory
    if len(pts) >= 2:
        lines.append(f'  <g inkscape:label="{layer_num}_s{n:03d}_trajectory" inkscape:groupmode="layer" id="layer_n{layer_num}">')
        d = ' '.join(('M' if i == 0 else 'L') + f' {p["x"]*scale+OX:.2f},{p["y"]*scale+OY:.2f}' for i, p in enumerate(pts))
        lines.append(f'    <path d="{d}" fill="none" stroke="#aaa" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>')
        lines.append('  </g>')
        layer_num += 1

    # start point
    p = pts[0]
    cx, cy = p['x'] * scale + OX, p['y'] * scale + OY
    ts = str(p['timestamp'])
    lines.append(f'  <g inkscape:label="{layer_num}_s{n:03d}_start" inkscape:groupmode="layer" id="layer_n{layer_num}">')
    lines.append(f'    <circle cx="{cx:.3f}" cy="{cy:.3f}" r="{CIRCLE_R}" fill="none" stroke="{STROKE_START}" stroke-width="0.9"/>')
    for hd in hatch_lines_in_circle(cx, cy, CIRCLE_R, HATCH_STEP):
        lines.append(f'    <path d="{hd}" fill="none" stroke="{STROKE_START}" stroke-width="0.6"/>')
    for td in text_paths(ts, cx + CIRCLE_R + 1.5, cy + rp['font_size'] * 0.35, rp['font_size']):
        lines.append(f'    <path d="{td}" fill="none" stroke="{STROKE_START}" stroke-width="0.6"/>')
    lines.append('  </g>')
    layer_num += 1

    # end point
    p = pts[-1]
    cx, cy = p['x'] * scale + OX, p['y'] * scale + OY
    ts = str(p['timestamp'])
    lines.append(f'  <g inkscape:label="{layer_num}_s{n:03d}_end" inkscape:groupmode="layer" id="layer_n{layer_num}">')
    lines.append(f'    <circle cx="{cx:.3f}" cy="{cy:.3f}" r="{CIRCLE_R}" fill="none" stroke="{STROKE_END}" stroke-width="0.9"/>')
    for hd in hatch_lines_in_circle(cx, cy, CIRCLE_R, HATCH_STEP):
        lines.append(f'    <path d="{hd}" fill="none" stroke="{STROKE_END}" stroke-width="0.6"/>')
    for td in text_paths(ts, cx + CIRCLE_R + 1.5, cy + rp['font_size'] * 0.35, rp['font_size']):
        lines.append(f'    <path d="{td}" fill="none" stroke="{STROKE_END}" stroke-width="0.6"/>')
    lines.append('  </g>')
    layer_num += 1

print(f'total layers: {layer_num - 1}')

# -- info panel layer
lines.append('  <g inkscape:label="info" inkscape:groupmode="layer" id="layer_info">')

fs    = rp['font_size']
lh    = rp['line_height']
sg    = rp['section_gap']
tx0   = rp['x'] + rp['padding_x']
ty    = OY                          # top aligned with viewport frame
max_w = rp['width'] - rp['padding_x'] * 2

title_jp = parse_title_from_stem(INPUT_JSON.stem)
title_en = data.get('titleEn', '')

# title JP (wrapped)
title_fs  = fs * 1.6
title_line = ''
for ch in title_jp:
    if text_width(title_line + ch, title_fs) > max_w:
        for td in text_paths(title_line, tx0, ty, title_fs):
            lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.6"/>')
        ty += title_fs * 1.5
        title_line = ch
    else:
        title_line += ch
if title_line:
    for td in text_paths(title_line, tx0, ty, title_fs):
        lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.6"/>')
    ty += title_fs * 1.5
ty += title_fs * 0.3

# title EN
if title_en:
    en_fs = fs * 1.1
    words, cur_line = title_en.split(' '), ''
    for word in words:
        test = (cur_line + ' ' + word).strip()
        if text_width(test, en_fs) > max_w:
            for td in text_paths(cur_line, tx0, ty, en_fs):
                lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.5"/>')
            ty += lh * 1.4
            cur_line = word
        else:
            cur_line = test
    if cur_line:
        for td in text_paths(cur_line, tx0, ty, en_fs):
            lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.5"/>')
        ty += lh * 1.4
    ty += lh * 0.2

# divider
lines.append(f'    <line x1="{tx0:.3f}" y1="{ty:.3f}" x2="{tx0+max_w:.3f}" y2="{ty:.3f}" stroke="#000" stroke-width="0.3"/>')
ty += sg * 0.8

# context rows
for label, value in build_context_lines(data):
    if label == '' and value == '':
        ty += lh * 0.5
        continue

    if label.startswith('---'):
        ty += sg * 0.3
        header = label.replace('-', '').strip()
        hx = tx0 + 2.0          # header text slightly indented from left edge
        for td in text_paths(header, hx, ty, fs * 1.1):
            lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.6"/>')
        ty += lh * 1.3
        uw = text_width(header, fs * 1.1)
        lines.append(f'    <line x1="{hx:.3f}" y1="{ty-lh*0.25:.3f}" x2="{hx+uw:.3f}" y2="{ty-lh*0.25:.3f}" stroke="#000" stroke-width="0.3"/>')
        ty += sg * 0.6          # more space between underline and first data item
        continue

    col_w = max_w * 0.38
    val_x = tx0 + col_w
    for td in text_paths(label, tx0, ty, fs):
        lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.4"/>')

    if value:
        val_max_w = max_w - col_w
        words, cur_line, first = value.split(' '), '', True
        for word in words:
            test = (cur_line + ' ' + word).strip()
            if text_width(test, fs) <= val_max_w:
                cur_line = test
            else:
                if cur_line:
                    for td in text_paths(cur_line, val_x, ty, fs):
                        lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.4"/>')
                    if not first:
                        ty += lh
                    first = False
                cur_line = word
        if cur_line:
            for td in text_paths(cur_line, val_x, ty, fs):
                lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.4"/>')

    ty += lh

# ---------------------------------------------------------------------------
# Code section
# ---------------------------------------------------------------------------
SRC_ROOT = Path('/Users/mizunoshoji/develop/TouchTrackingApp')

def extract_lines(filepath: Path, start: int, end: int) -> list:
    raw = filepath.read_text(encoding='utf-8').splitlines()
    return raw[start-1:end]

code_sections = [
    {
        'filename': 'src/injectedJS.ts',
        'display_lines': [
            "  var phases = {",
            "    touchstart:  'start',  // lavender",
            "    touchmove:   'move',",
            "    touchend:    'end',    // pink",
            "    touchcancel: 'end',    // pink",
            "  };",
            "  Object.keys(phases).forEach(function (type) {",
            "    document.addEventListener(type, function (e) {",
            "      var t = e.changedTouches[0];",
            "      send({",
            "        type: 'touch',",
            "        phase: phases[type],",
            "        x: t.clientX,  y: t.clientY,",
            "        timestamp: Date.now(),",
            "        strokeId: currentStrokeId,",
            "      });",
            "    }, { passive: true, capture: true });",
            "  });",
        ],
    },
]

code_fs  = fs
code_lh  = code_fs * 1.55

ty += sg * 1.2

# section heading
heading = 'TOUCH TRACKING CODE'
for td in text_paths(heading, tx0, ty, fs * 1.1):
    lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.6"/>')
ty += lh * 1.3
uw = text_width(heading, fs * 1.1)
lines.append(f'    <line x1="{tx0:.3f}" y1="{ty-lh*0.35:.3f}" x2="{tx0+uw:.3f}" y2="{ty-lh*0.35:.3f}" stroke="#000" stroke-width="0.3"/>')
ty += sg * 0.4

for sec in code_sections:
    # filename label
    for td in code_text_paths(sec['filename'], tx0, ty, fs * 0.8):
        lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.45"/>')
    ty += lh * 1.1

    code_lines = sec.get('display_lines') or extract_lines(sec['filepath'], sec['start'], sec['end'])
    for raw_line in code_lines:
        # preserve indent by counting leading spaces (render as offset)
        stripped = raw_line.rstrip()
        if not stripped:
            ty += code_lh * 0.5
            continue
        indent   = len(stripped) - len(stripped.lstrip())
        indent_x = tx0 + indent * code_fs * 0.52
        text     = stripped.lstrip()
        for td in code_text_paths(text, indent_x, ty, code_fs):
            lines.append(f'    <path d="{td}" fill="none" stroke="#000" stroke-width="0.3"/>')
        ty += code_lh

    ty += sg * 0.6

lines.append('  </g>')
lines.append('</svg>')

OUTPUT_SVG.write_text('\n'.join(lines), encoding='utf-8')
print(f'done → {OUTPUT_SVG}  ({len(strokes)} strokes)')
