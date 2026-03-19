#!/usr/bin/env python3
"""
Generate A0 portrait SVG — visualization only (no info panel).
Stroke data scaled to fill A0 with padding.
"""
import sys, json, math
from pathlib import Path

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from recompose_stroke import parse_lff, glyph_for_char, advance_for_char

FONT_PRIMARY  = BASE / 'fonts' / 'azomix.lff'
FONT_FALLBACK = BASE / 'fonts' / 'unicode.lff'

CIRCLE_R     = 10.0        # larger circles for A0
HATCH_STEP   = 3.2         # scaled hatch (~1.6 * A0_scale/A3_scale ratio)
STROKE_START = '#9b59b6'   # lavender — touch start point
STROKE_END   = '#e91e63'   # pink     — touch end point

primary  = parse_lff(FONT_PRIMARY)
fallback = parse_lff(FONT_FALLBACK)

def text_paths(text, x0, y0, size):
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
# Input
# ---------------------------------------------------------------------------
if len(sys.argv) < 2:
    candidates = sorted(BASE.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    candidates = [c for c in candidates if 'layout' not in c.name]
    if not candidates:
        print('usage: generate_a0_viz.py <input.json>')
        sys.exit(1)
    INPUT_JSON = candidates[0]
else:
    INPUT_JSON = Path(sys.argv[1])

OUTPUT_SVG = INPUT_JSON.with_name(INPUT_JSON.stem + '_a0_viz.svg')

with open(INPUT_JSON) as f:
    data = json.load(f)

strokes = data['strokes']
vp      = data.get('viewport')
VP_W    = vp['width']  if vp else 375
VP_H    = vp['height'] if vp else 547

# A0 portrait
DOC_W, DOC_H = 2384, 3370
PAD = 120
scale   = min((DOC_W - PAD*2) / VP_W, (DOC_H - PAD*2) / VP_H)
frame_w = VP_W * scale
frame_h = VP_H * scale
OX      = (DOC_W - frame_w) / 2
OY      = (DOC_H - frame_h) / 2

TS_FS = 14.0  # timestamp font size (pt)

print(f'A0 portrait  scale: {scale:.3f}  frame: {frame_w:.1f}x{frame_h:.1f}  offset: ({OX:.1f},{OY:.1f})')

# ---------------------------------------------------------------------------
# Build SVG
# ---------------------------------------------------------------------------
lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    f'<svg xmlns="http://www.w3.org/2000/svg"',
    f'     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"',
    f'     viewBox="0 0 {DOC_W} {DOC_H}" width="{DOC_W}pt" height="{DOC_H}pt">',
]

# layout frame
lines += [
    '  <g inkscape:label="layout" inkscape:groupmode="layer" id="layer_layout">',
    f'    <rect x="{OX:.3f}" y="{OY:.3f}" width="{frame_w:.3f}" height="{frame_h:.3f}" fill="none" stroke="#000" stroke-width="1"/>',
    '  </g>',
]

# stroke layers — sequential numbering
layer_num = 1
for idx, stroke in enumerate(strokes):
    pts = stroke['points']
    if not pts:
        continue
    n = idx + 1

    # trajectory
    if len(pts) >= 2:
        lines.append(f'  <g inkscape:label="{layer_num}_s{n:03d}_trajectory" inkscape:groupmode="layer" id="layer_n{layer_num}">')
        d = ' '.join(('M' if i == 0 else 'L') + f' {p["x"]*scale+OX:.2f},{p["y"]*scale+OY:.2f}' for i, p in enumerate(pts))
        lines.append(f'    <path d="{d}" fill="none" stroke="#aaa" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>')
        lines.append('  </g>')
        layer_num += 1

    # start point
    p = pts[0]
    cx, cy = p['x'] * scale + OX, p['y'] * scale + OY
    ts = str(p['timestamp'])
    lines.append(f'  <g inkscape:label="{layer_num}_s{n:03d}_start" inkscape:groupmode="layer" id="layer_n{layer_num}">')
    lines.append(f'    <circle cx="{cx:.3f}" cy="{cy:.3f}" r="{CIRCLE_R}" fill="none" stroke="{STROKE_START}" stroke-width="1.8"/>')
    for hd in hatch_lines_in_circle(cx, cy, CIRCLE_R, HATCH_STEP):
        lines.append(f'    <path d="{hd}" fill="none" stroke="{STROKE_START}" stroke-width="1.2"/>')
    for td in text_paths(ts, cx + CIRCLE_R + 3, cy + TS_FS * 0.35, TS_FS):
        lines.append(f'    <path d="{td}" fill="none" stroke="{STROKE_START}" stroke-width="1.2"/>')
    lines.append('  </g>')
    layer_num += 1

    # end point
    p = pts[-1]
    cx, cy = p['x'] * scale + OX, p['y'] * scale + OY
    ts = str(p['timestamp'])
    lines.append(f'  <g inkscape:label="{layer_num}_s{n:03d}_end" inkscape:groupmode="layer" id="layer_n{layer_num}">')
    lines.append(f'    <circle cx="{cx:.3f}" cy="{cy:.3f}" r="{CIRCLE_R}" fill="none" stroke="{STROKE_END}" stroke-width="1.8"/>')
    for hd in hatch_lines_in_circle(cx, cy, CIRCLE_R, HATCH_STEP):
        lines.append(f'    <path d="{hd}" fill="none" stroke="{STROKE_END}" stroke-width="1.2"/>')
    for td in text_paths(ts, cx + CIRCLE_R + 3, cy + TS_FS * 0.35, TS_FS):
        lines.append(f'    <path d="{td}" fill="none" stroke="{STROKE_END}" stroke-width="1.2"/>')
    lines.append('  </g>')
    layer_num += 1

lines.append('</svg>')
OUTPUT_SVG.write_text('\n'.join(lines), encoding='utf-8')
print(f'done → {OUTPUT_SVG}  ({len(strokes)} strokes, {layer_num-1} layers)')
