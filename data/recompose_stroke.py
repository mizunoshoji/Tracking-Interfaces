#!/usr/bin/env python3
import argparse
import math
import re
import xml.etree.ElementTree as ET

try:
    import cv2
except ImportError:
    cv2 = None

try:
    import numpy as np
except ImportError:
    np = None

SVG_NS = "http://www.w3.org/2000/svg"


class Glyph:
    def __init__(self, codepoint, strokes):
        self.codepoint = codepoint
        self.strokes = strokes  # list[list[(x,y)]]
        if not strokes:
            self.minx = self.maxx = self.miny = self.maxy = 0.0
        else:
            xs = [p[0] for s in strokes for p in s]
            ys = [p[1] for s in strokes for p in s]
            self.minx, self.maxx = min(xs), max(xs)
            self.miny, self.maxy = min(ys), max(ys)


class LffFont:
    def __init__(self):
        self.letter_spacing = 1.0
        self.word_spacing = 6.75
        self.line_spacing_factor = 1.0
        self.glyphs = {}

    def glyph_advance(self, ch):
        if ch == " ":
            return self.word_spacing
        g = self.glyphs.get(ch)
        if g is None:
            return self.word_spacing
        return max(1.0, g.maxx) + self.letter_spacing



def parse_lff(path):
    font = LffFont()
    cur_cp = None
    cur_strokes = []

    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue

            if line.startswith("#"):
                m = re.match(r"#\s*LetterSpacing:\s*([0-9.\-]+)", line)
                if m:
                    font.letter_spacing = float(m.group(1))
                m = re.match(r"#\s*WordSpacing:\s*([0-9.\-]+)", line)
                if m:
                    font.word_spacing = float(m.group(1))
                m = re.match(r"#\s*LineSpacingFactor:\s*([0-9.\-]+)", line)
                if m:
                    font.line_spacing_factor = float(m.group(1))
                continue

            gm = re.match(r"\[([0-9A-Fa-f]+)\]", line)
            if gm:
                if cur_cp is not None:
                    font.glyphs[chr(cur_cp)] = Glyph(cur_cp, cur_strokes)
                cur_cp = int(gm.group(1), 16)
                cur_strokes = []
                continue

            if ";" in line and "," in line:
                pts = []
                ok = True
                for part in line.split(";"):
                    part = part.strip()
                    if not part:
                        continue
                    xy = part.split(",")
                    if len(xy) != 2:
                        ok = False
                        break
                    try:
                        x = float(xy[0])
                        y = float(xy[1])
                    except ValueError:
                        ok = False
                        break
                    pts.append((x, y))
                if ok and len(pts) >= 2:
                    cur_strokes.append(pts)

    if cur_cp is not None:
        font.glyphs[chr(cur_cp)] = Glyph(cur_cp, cur_strokes)

    return font


def parse_viewbox(svg_path):
    root = ET.parse(svg_path).getroot()
    vb = root.get("viewBox")
    if vb:
        vals = [float(x) for x in vb.replace(",", " ").split()]
        if len(vals) == 4:
            return vals
    w = float(root.get("width", "266"))
    h = float(root.get("height", "197"))
    return [0.0, 0.0, w, h]


def glyph_for_char(ch, primary, fallback):
    g = primary.glyphs.get(ch)
    if g is not None:
        return g
    return fallback.glyphs.get(ch)


def advance_for_char(ch, primary, fallback):
    if ch == " ":
        return primary.word_spacing
    g = glyph_for_char(ch, primary, fallback)
    if g is None:
        return primary.word_spacing
    return max(1.0, g.maxx) + primary.letter_spacing


def wrap_text(paragraphs, max_width, font_scale, primary, fallback):
    lines = []
    for para in paragraphs:
        if not para.strip():
            lines.append("")
            continue
        cur = ""
        cur_w = 0.0
        for ch in para:
            adv = advance_for_char(ch, primary, fallback) * font_scale
            if cur and cur_w + adv > max_width:
                lines.append(cur)
                cur = ch
                cur_w = adv
            else:
                cur += ch
                cur_w += adv
        if cur:
            lines.append(cur)
    return lines


def layout_text(text, vb, primary, fallback, margin=8.0, title="HALTING THE SYSTEM"):
    vx, vy, vw, vh = vb
    content_w = vw - margin * 2
    content_h = vh - margin * 2

    paragraphs = [p.strip() for p in text.split("\n")]
    chosen = None
    body_size = 4.2
    while body_size > 2.1:
        title_size = body_size * 1.9 if title else 0.0
        body_scale = body_size / 10.0
        if title:
            title_scale = title_size / 10.0
            title_adv = sum(advance_for_char(ch, primary, fallback) * title_scale for ch in title)
            if title_adv > content_w:
                continue

        lines = wrap_text(paragraphs, content_w, body_scale, primary, fallback)
        line_h = body_size * 1.45
        total_h = len(lines) * line_h
        if title:
            total_h += title_size + body_size * 0.9
        if total_h <= content_h:
            chosen = (title, lines, body_size, title_size)
            break
        body_size = round(body_size - 0.1, 10)

    if chosen is None:
        body_size = 2.0
        title_size = 3.8 if title else 0.0
        lines = wrap_text(paragraphs, content_w, body_size / 10.0, primary, fallback)
        chosen = (title, lines, body_size, title_size)

    return chosen


def render_lines_to_paths(lines, x0, y0, size, primary, fallback):
    scale = size / 10.0
    paths = []
    y_base = y0

    for line in lines:
        x_cursor = x0
        for ch in line:
            g = glyph_for_char(ch, primary, fallback)
            adv = advance_for_char(ch, primary, fallback)
            if g is not None:
                for stroke in g.strokes:
                    pts = []
                    for gx, gy in stroke:
                        x = x_cursor + gx * scale
                        y = y_base - gy * scale
                        pts.append((x, y))
                    if len(pts) >= 2:
                        paths.append(pts)
            x_cursor += adv * scale
        y_base += size * 1.45

    return paths


def simplify_polyline(pts, eps=1e-4):
    if len(pts) <= 2:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        x0, y0 = out[-1]
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        v1x, v1y = x1 - x0, y1 - y0
        v2x, v2y = x2 - x1, y2 - y1
        cross = abs(v1x * v2y - v1y * v2x)
        if cross <= eps and (abs(v1x) + abs(v1y) > eps) and (abs(v2x) + abs(v2y) > eps):
            continue
        out.append((x1, y1))
    out.append(pts[-1])
    clean = [out[0]]
    for p in out[1:]:
        if abs(p[0] - clean[-1][0]) > eps or abs(p[1] - clean[-1][1]) > eps:
            clean.append(p)
    return clean


def write_svg(paths, vb, out_svg, merge_to_single_path=True):
    vx, vy, vw, vh = vb
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{vw}" height="{vh}" viewBox="{vx} {vy} {vw} {vh}">',
        '  <g fill="none" stroke="#000000" stroke-width="0.25" stroke-linecap="round" stroke-linejoin="round">',
    ]
    if merge_to_single_path:
        cmds = []
        for pts in paths:
            if len(pts) < 2:
                continue
            cmds.append(f"M {pts[0][0]:.3f} {pts[0][1]:.3f}")
            cmds.extend(f"L {x:.3f} {y:.3f}" for x, y in pts[1:])
        lines.append(f'    <path d="{" ".join(cmds)}" />')
    else:
        for pts in paths:
            if len(pts) < 2:
                continue
            d = [f"M {pts[0][0]:.3f} {pts[0][1]:.3f}"]
            d.extend(f"L {x:.3f} {y:.3f}" for x, y in pts[1:])
            lines.append(f'    <path d="{" ".join(d)}" />')
    lines.append("  </g>")
    lines.append("</svg>")
    with open(out_svg, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def rasterize_paths(paths, vb, w, h):
    if np is None or cv2 is None:
        raise ImportError("rasterize_paths requires numpy and opencv-python")
    vx, vy, vw, vh = vb
    img = np.full((h, w), 255, np.uint8)
    for pts in paths:
        arr = []
        for x, y in pts:
            px = int(round((x - vx) * (w - 1) / vw))
            py = int(round((y - vy) * (h - 1) / vh))
            arr.append((px, py))
        if len(arr) >= 2:
            a = np.array(arr, np.int32).reshape(-1, 1, 2)
            cv2.polylines(img, [a], False, 0, 1, cv2.LINE_AA)
    return img


def render_original_outline(svg_path, vb, w, h):
    if np is None:
        raise ImportError("render_original_outline requires numpy")
    # Reuse the previous conversion's custom raster for preview-only comparison.
    from convert import rasterize_svg_to_binary

    fg = rasterize_svg_to_binary(svg_path, vb, w, h)
    return np.where(fg > 0, 0, 255).astype(np.uint8)


def save_preview(before_img, after_img, out_png):
    if np is None or cv2 is None:
        raise ImportError("save_preview requires numpy and opencv-python")
    left = cv2.cvtColor(before_img, cv2.COLOR_GRAY2BGR)
    right = cv2.cvtColor(after_img, cv2.COLOR_GRAY2BGR)
    cv2.putText(left, "Before (path8 outline)", (16, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (30, 30, 30), 2, cv2.LINE_AA)
    cv2.putText(right, "After (AZOmix stroke text)", (16, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (30, 30, 30), 2, cv2.LINE_AA)
    gap = np.full((left.shape[0], 24, 3), 230, np.uint8)
    canvas = np.hstack([left, gap, right])
    cv2.imwrite(out_png, canvas)


def count_nodes(paths):
    return sum(len(p) for p in paths)


def main():
    ap = argparse.ArgumentParser(description="Recompose Japanese text with AZOmix single-stroke LFF")
    ap.add_argument("--input-svg", default="plot-dm/path8.svg")
    ap.add_argument("--text-file", default="plot-dm/centerline/input_text.txt")
    ap.add_argument("--font", default="plot-dm/centerline/fonts/azomix.lff")
    ap.add_argument("--fallback-font", default="plot-dm/centerline/fonts/unicode.lff")
    ap.add_argument("--output", default="plot-dm/centerline/output.svg")
    ap.add_argument("--preview", default="plot-dm/centerline/preview.png")
    ap.add_argument("--title", default="HALTING THE SYSTEM")
    ap.add_argument("--width", type=int, default=2128)
    ap.add_argument("--height", type=int, default=1578)
    args = ap.parse_args()

    with open(args.text_file, "r", encoding="utf-8") as f:
        text = f.read().strip()

    vb = parse_viewbox(args.input_svg)
    primary = parse_lff(args.font)
    fallback = parse_lff(args.fallback_font)

    title, body_lines, body_size, title_size = layout_text(
        text, vb, primary, fallback, title=args.title
    )

    margin = 8.0
    x0 = vb[0] + margin
    y0 = vb[1] + margin + title_size

    paths = []
    if title:
        paths.extend(render_lines_to_paths([title], x0, y0, title_size, primary, fallback))
        y_body = y0 + body_size * 1.6
    else:
        y_body = y0
    paths.extend(render_lines_to_paths(body_lines, x0, y_body, body_size, primary, fallback))
    paths = [simplify_polyline(p) for p in paths if len(p) >= 2]

    write_svg(paths, vb, args.output)

    before = render_original_outline(args.input_svg, vb, args.width, args.height)
    after = rasterize_paths(paths, vb, args.width, args.height)
    save_preview(before, after, args.preview)

    print("title:", title)
    print("body_lines:", len(body_lines))
    print("body_size:", f"{body_size:.2f}")
    print("title_size:", f"{title_size:.2f}")
    print("path_count:", len(paths))
    print("node_count:", count_nodes(paths))
    print("output:", args.output)
    print("preview:", args.preview)


if __name__ == "__main__":
    main()
