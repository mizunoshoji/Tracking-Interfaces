/**
 * In-app SVG generator.
 *
 * generateVizSVG           — A4 portrait, visualization only          (share / plotter)
 * generateInfoSVG          — A4 portrait, info panel only             (share / plotter)
 * generateAnnotatedSVG     — A3 landscape, viz + info + code          (share / plotter)
 * generateDisplayInfoSVG   — A4 portrait, session data, large fonts   (carousel display)
 * generateDisplayCodeSVG   — A4 portrait, code, black bg, large fonts (carousel display)
 */

import { Stroke, Viewport, DeviceInfo } from './types';

// ---------------------------------------------------------------------------
// Default colors
// ---------------------------------------------------------------------------
export const DEFAULT_COLORS = {
  start: '#9b59b6', // lavender
  end:   '#e91e63', // pink
  line:  '#aaaaaa', // gray
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hatchLines(cx: number, cy: number, r: number, step: number): string[] {
  const angle = Math.PI / 4;
  const cosA  = Math.cos(angle);
  const sinA  = Math.sin(angle);
  const ds: string[] = [];
  for (let t = -r; t <= r; t += step) {
    const lx = cx - sinA * t;
    const ly = cy + cosA * t;
    const dx = lx - cx, dy = ly - cy;
    const b  = cosA * dx + sinA * dy;
    const disc = b * b - (dx * dx + dy * dy - r * r);
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      ds.push(
        `M ${(lx + cosA * (-b - sq)).toFixed(2)},${(ly + sinA * (-b - sq)).toFixed(2)}` +
        ` L ${(lx + cosA * (-b + sq)).toFixed(2)},${(ly + sinA * (-b + sq)).toFixed(2)}`
      );
    }
  }
  return ds;
}

function wrapLines(text: string, maxW: number, fontSize: number, maxLines = 2): string[] {
  const charW = fontSize * 0.55;
  const result: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0 && result.length < maxLines) {
    if (remaining.length * charW <= maxW) {
      result.push(remaining);
      break;
    }
    const isLast = result.length === maxLines - 1;
    // Find break point: prefer last space within budget, fall back to char limit
    const budget = Math.floor(maxW / charW);
    const spaceIdx = remaining.lastIndexOf(' ', budget);
    let breakAt = spaceIdx > 0 ? spaceIdx : budget;
    if (isLast) {
      // Truncate with ellipsis
      let line = remaining.slice(0, breakAt).trimEnd();
      while (line.length > 0 && (line + '...').length * charW > maxW)
        line = line.slice(0, -1).trimEnd();
      result.push(line + '...');
      break;
    }
    result.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Shared: render strokes (trajectory + start/end circles)
// ---------------------------------------------------------------------------
interface Colors { start: string; end: string; line: string }

function renderStrokes(
  strokes: Stroke[],
  scale: number,
  OX: number,
  OY: number,
  colors: Colors,
  CIRCLE_R = 4.0,
  HATCH_STEP = 1.6,
): string[] {
  const els: string[] = [];
  for (const stroke of strokes) {
    const pts = stroke.points;
    if (!pts.length) continue;

    if (pts.length >= 2) {
      const d = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * scale + OX).toFixed(2)},${(p.y * scale + OY).toFixed(2)}`)
        .join(' ');
      els.push(`<path d="${d}" fill="none" stroke="${colors.line}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    }

    for (const [pt, color] of [[pts[0], colors.start], [pts[pts.length - 1], colors.end]] as const) {
      const cx = (pt as typeof pts[0]).x * scale + OX;
      const cy = (pt as typeof pts[0]).y * scale + OY;
      const ts = (pt as typeof pts[0]).timestamp;
      els.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${CIRCLE_R}" fill="none" stroke="${color}" stroke-width="0.9"/>`);
      for (const hd of hatchLines(cx, cy, CIRCLE_R, HATCH_STEP))
        els.push(`<path d="${hd}" fill="none" stroke="${color}" stroke-width="0.6"/>`);
      els.push(`<text x="${(cx + CIRCLE_R + 1.5).toFixed(2)}" y="${(cy + 1.5).toFixed(2)}" font-family="monospace" font-size="3.5" fill="${color}">${ts}</text>`);
    }
  }
  return els;
}

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------
export interface SVGSession {
  strokes:    Stroke[];
  viewport:   Viewport | null;
  device:     DeviceInfo | null;
  url:        string;
  titleJa?:   string;
  titleEn?:   string;
  user?:      string;
  exportedAt: string;
  colors?:    Colors;
}

// ---------------------------------------------------------------------------
// Shared info panel constants
// ---------------------------------------------------------------------------
const FS = 9, LH = 14, SG = 22;

// ---------------------------------------------------------------------------
// Shared info panel renderer
// ---------------------------------------------------------------------------
function renderInfoPanel(
  session: SVGSession,
  tx0: number,
  maxW: number,
  startY: number,
): string[] {
  const { strokes, viewport, device, url, titleJa, titleEn, user, colors } = session;
  const c = { ...DEFAULT_COLORS, ...colors };

  const VP_W = viewport?.width  ?? 375;
  const VP_H = viewport?.height ?? 547;

  const allPts   = strokes.flatMap(s => s.points);
  const tsList   = allPts.map(p => p.timestamp);
  const minTs    = tsList.length ? Math.min(...tsList) : 0;
  const maxTs    = tsList.length ? Math.max(...tsList) : 0;
  const duration = ((maxTs - minTs) / 1000).toFixed(1);

  const out: string[] = [];
  let ty = startY;

  const txt = (x: number, y: number, str: string, size: number, color = '#000', weight = 'normal', family = 'sans-serif') =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${family}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(str)}</text>`;

  // ---- Title block ----
  const titleFsJa = FS * 1.3;
  const titleFsEn = FS * 1.1;

  if (titleJa) {
    for (const ln of wrapLines(titleJa, maxW, titleFsJa)) {
      out.push(txt(tx0, ty, ln, titleFsJa, '#000', 'bold'));
      ty += LH * 1.5;
    }
  }
  if (titleEn) {
    for (const ln of wrapLines(titleEn, maxW, titleFsEn)) {
      out.push(txt(tx0, ty, ln, titleFsEn, '#000', 'normal'));
      ty += LH * 1.4;
    }
  }
  if (!titleJa && !titleEn) {
    for (const ln of wrapLines(url, maxW, titleFsEn)) {
      out.push(txt(tx0, ty, ln, titleFsEn, '#000', 'normal'));
      ty += LH * 1.4;
    }
  }
  ty += LH * 0.3;

  out.push(`<line x1="${tx0}" y1="${ty.toFixed(1)}" x2="${(tx0 + maxW).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#000" stroke-width="0.3"/>`);
  ty += SG * 0.8;

  const section = (header: string) => {
    ty += SG * 0.3;
    out.push(txt(tx0 + 2, ty, header, FS * 1.1, '#000', 'bold'));
    ty += LH * 1.4;
    out.push(`<line x1="${tx0}" y1="${(ty - LH * 0.25).toFixed(1)}" x2="${(tx0 + header.length * FS * 0.66).toFixed(1)}" y2="${(ty - LH * 0.25).toFixed(1)}" stroke="#000" stroke-width="0.3"/>`);
    ty += SG * 0.4;
  };

  const colW = maxW * 0.42;
  const row = (label: string, value: string) => {
    out.push(txt(tx0, ty, label, FS, '#888'));
    out.push(txt(tx0 + colW, ty, value, FS, '#000'));
    ty += LH;
  };

  section('SESSION');
  row('rec start unix ms', String(minTs));
  row('rec end unix ms',   String(maxTs));
  row('duration',          `${duration} sec`);
  ty += LH * 0.5;

  section('CONTENT');
  row('url', url.length > 45 ? url.slice(0, 45) + '…' : url);
  ty += LH * 0.5;

  section('DEVICE');
  row('viewport',   `${VP_W} x ${VP_H} pt`);
  row('brand',      device?.brand     ?? 'N/A');
  row('model',      device?.model     ?? 'N/A');
  row('os',         device?.os        ?? 'N/A');
  row('os version', device?.osVersion ?? 'N/A');
  ty += LH * 0.5;

  section('STROKES');
  row('total strokes', String(strokes.length));
  row('total points',  String(allPts.length));
  ty += LH * 0.5;

  section('USER');
  row('name', user || '');
  ty += LH * 0.5;

  // ---- Code section ----
  section('TOUCH TRACKING CODE');
  out.push(txt(tx0, ty, 'src/injectedJS.ts', FS * 0.85, '#999', 'normal', 'monospace'));
  ty += LH * 1.3;

  const codeFS = FS * 0.9;
  const codeLH = LH * 1.05;

  const codeLines: [string, string | null][] = [
    ["  var phases = {",                                 null],
    ["    touchstart:  'start',",                        c.start],
    ["    touchmove:   'move',",                         c.line],
    ["    touchend:    'end',",                          c.end],
    ["    touchcancel: 'end',",                          c.end],
    ["  };",                                             null],
    ["  Object.keys(phases).forEach(function (type) {",  null],
    ["    document.addEventListener(type, function (e) {", null],
    ["      var t = e.changedTouches[0];",               null],
    ["      send({",                                     null],
    ["        type: 'touch',  phase: phases[type],",     null],
    ["        x: t.clientX,  y: t.clientY,",             null],
    ["        timestamp: Date.now(),",                   null],
    ["      });",                                        null],
    ["    }, { passive: true, capture: true });",        null],
    ["  });",                                            null],
  ];

  for (const [code, commentColor] of codeLines) {
    const stripped = code.trimStart();
    const indent   = code.length - stripped.length;
    const ix       = tx0 + indent * codeFS * 0.58;

    if (commentColor) {
      out.push(`<text x="${ix.toFixed(1)}" y="${ty.toFixed(1)}" font-family="monospace" font-size="${codeFS}" fill="#444">${esc(stripped + `  // ${commentColor}`)}</text>`);
    } else {
      out.push(`<text x="${ix.toFixed(1)}" y="${ty.toFixed(1)}" font-family="monospace" font-size="${codeFS}" fill="#444">${esc(stripped)}</text>`);
    }
    ty += codeLH;
  }

  return out;
}

// ---------------------------------------------------------------------------
// 1. A4 portrait — visualization only
// ---------------------------------------------------------------------------
export function generateVizSVG(session: SVGSession): string {
  const { strokes, viewport, colors } = session;
  const c = { ...DEFAULT_COLORS, ...colors };

  const DOC_W = 595, DOC_H = 842, PAD = 30;
  const VP_W  = viewport?.width  ?? 375;
  const VP_H  = viewport?.height ?? 547;

  const scale  = Math.min((DOC_W - PAD * 2) / VP_W, (DOC_H - PAD * 2) / VP_H);
  const frameW = VP_W * scale;
  const frameH = VP_H * scale;
  const OX     = (DOC_W - frameW) / 2;
  const OY     = (DOC_H - frameH) / 2;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DOC_W} ${DOC_H}">`,
    `<rect width="${DOC_W}" height="${DOC_H}" fill="#fff"/>`,
    `<rect x="${OX.toFixed(2)}" y="${OY.toFixed(2)}" width="${frameW.toFixed(2)}" height="${frameH.toFixed(2)}" fill="none" stroke="#000" stroke-width="0.5"/>`,
    ...renderStrokes(strokes, scale, OX, OY, c),
    '</svg>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 2. A4 portrait — info panel only
// ---------------------------------------------------------------------------
export function generateInfoSVG(session: SVGSession): string {
  const DOC_W = 595, DOC_H = 842;
  const PAD_X = 44, PAD_Y = 40;
  const maxW  = DOC_W - PAD_X * 2;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DOC_W} ${DOC_H}">`,
    `<rect width="${DOC_W}" height="${DOC_H}" fill="#fff"/>`,
    ...renderInfoPanel(session, PAD_X, maxW, PAD_Y),
    '</svg>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Display constants (larger fonts for on-screen carousel)
// ---------------------------------------------------------------------------
const FS_D  = 18;   // base font size
const LH_D  = 27;   // line height
const SG_D  = 30;   // section gap

function renderDisplayInfoPanel(
  session: SVGSession,
  tx0: number,
  maxW: number,
  startY: number,
): string[] {
  const { strokes, viewport, device, url, titleJa, titleEn, user } = session;

  const VP_W = viewport?.width  ?? 375;
  const VP_H = viewport?.height ?? 547;

  const allPts   = strokes.flatMap(s => s.points);
  const tsList   = allPts.map(p => p.timestamp);
  const minTs    = tsList.length ? Math.min(...tsList) : 0;
  const maxTs    = tsList.length ? Math.max(...tsList) : 0;
  const duration = ((maxTs - minTs) / 1000).toFixed(1);

  const out: string[] = [];
  let ty = startY;

  const txt = (x: number, y: number, str: string, size: number, color = '#000', weight = 'normal', family = 'sans-serif') =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${family}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(str)}</text>`;

  // ---- Title block ----
  const titleFsJa = FS_D * 1.4;
  const titleFsEn = FS_D * 1.15;

  if (titleJa) {
    for (const ln of wrapLines(titleJa, maxW, titleFsJa)) {
      out.push(txt(tx0, ty, ln, titleFsJa, '#000', 'bold'));
      ty += LH_D * 1.6;
    }
  }
  if (titleEn) {
    for (const ln of wrapLines(titleEn, maxW, titleFsEn)) {
      out.push(txt(tx0, ty, ln, titleFsEn, '#000', 'normal'));
      ty += LH_D * 1.4;
    }
  }
  if (!titleJa && !titleEn) {
    for (const ln of wrapLines(url, maxW, titleFsEn)) {
      out.push(txt(tx0, ty, ln, titleFsEn, '#000', 'normal'));
      ty += LH_D * 1.4;
    }
  }
  ty += LH_D * 0.4;

  out.push(`<line x1="${tx0}" y1="${ty.toFixed(1)}" x2="${(tx0 + maxW).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#000" stroke-width="0.6"/>`);
  ty += SG_D * 0.8;

  const section = (header: string) => {
    ty += SG_D * 0.5;
    out.push(txt(tx0, ty, header, FS_D * 1.1, '#000', 'bold'));
    ty += LH_D * 1.1;
  };

  const colW = maxW * 0.44;
  const row = (label: string, value: string) => {
    out.push(txt(tx0, ty, label, FS_D, '#888'));
    out.push(txt(tx0 + colW, ty, value, FS_D, '#000'));
    ty += LH_D;
  };

  section('SESSION');
  row('rec start unix ms', String(minTs));
  row('rec end unix ms',   String(maxTs));
  row('duration',          `${duration} sec`);
  ty += LH_D * 0.4;

  section('CONTENT');
  row('url', url.length > 38 ? url.slice(0, 38) + '…' : url);
  ty += LH_D * 0.4;

  section('DEVICE');
  row('viewport',   `${VP_W} x ${VP_H} pt`);
  row('brand',      device?.brand     ?? 'N/A');
  row('model',      device?.model     ?? 'N/A');
  row('os',         device?.os        ?? 'N/A');
  row('os version', device?.osVersion ?? 'N/A');
  ty += LH_D * 0.4;

  section('STROKES');
  row('total strokes', String(strokes.length));
  row('total points',  String(allPts.length));
  ty += LH_D * 0.4;

  section('USER');
  row('name', user || '');

  return out;
}

// ---------------------------------------------------------------------------
// 3. A3 landscape — visualization + info panel
// ---------------------------------------------------------------------------
const LP_W = 640, LP_H = 842, LP_PAD = 40;
const RP_X = 641, RP_PAD_X = 44, RP_W = 550;

export function generateAnnotatedSVG(session: SVGSession): string {
  const { strokes, viewport, colors } = session;
  const c = { ...DEFAULT_COLORS, ...colors };

  const DOC_W = 1191, DOC_H = 842;
  const VP_W  = viewport?.width  ?? 375;
  const VP_H  = viewport?.height ?? 547;

  const scale  = Math.min((LP_W - LP_PAD * 2) / VP_W, (LP_H - LP_PAD * 2) / VP_H);
  const frameW = VP_W * scale;
  const frameH = VP_H * scale;
  const OX     = (LP_W - frameW) / 2;
  const OY     = (LP_H - frameH) / 2;

  const tx0  = RP_X + RP_PAD_X;
  const maxW = RP_W - RP_PAD_X * 2;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DOC_W} ${DOC_H}">`,
    `<rect width="${DOC_W}" height="${DOC_H}" fill="#fff"/>`,
    `<line x1="640.5" y1="0" x2="640.5" y2="${DOC_H}" stroke="#ccc" stroke-width="0.5"/>`,
    `<rect x="${OX.toFixed(2)}" y="${OY.toFixed(2)}" width="${frameW.toFixed(2)}" height="${frameH.toFixed(2)}" fill="none" stroke="#000" stroke-width="0.5"/>`,
    ...renderStrokes(strokes, scale, OX, OY, c),
    ...renderInfoPanel(session, tx0, maxW, OY),
    '</svg>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. A4 portrait — session info, large fonts  (carousel display)
// ---------------------------------------------------------------------------
export function generateDisplayInfoSVG(session: SVGSession): string {
  const DOC_W = 595, DOC_H = 842;
  const PAD_X = 48, PAD_Y = 46;
  const maxW  = DOC_W - PAD_X * 2;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DOC_W} ${DOC_H}">`,
    `<rect width="${DOC_W}" height="${DOC_H}" fill="#fff"/>`,
    ...renderDisplayInfoPanel(session, PAD_X, maxW, PAD_Y),
    '</svg>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 5. A4 portrait — touch tracking code, black bg, large fonts (carousel display)
// ---------------------------------------------------------------------------
export function generateDisplayCodeSVG(session: SVGSession): string {
  const DOC_W   = 595, DOC_H = 842;
  const PAD_X   = 20,  PAD_Y = 56;
  const BG      = '#111';
  const { colors } = session;
  const c = { ...DEFAULT_COLORS, ...colors };

  const HEADER_FS = 24;
  const FILE_FS   = 14;
  const CODE_FS   = 19;
  const CODE_LH   = 29;

  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DOC_W} ${DOC_H}">`,
    `<rect width="${DOC_W}" height="${DOC_H}" fill="${BG}"/>`,
  ];

  let ty = PAD_Y;

  // Header
  out.push(`<text x="${PAD_X}" y="${ty}" font-family="sans-serif" font-size="${HEADER_FS}" fill="#fff" font-weight="bold">TOUCH TRACKING CODE</text>`);
  ty += HEADER_FS * 1.4;
  out.push(`<line x1="${PAD_X}" y1="${ty}" x2="${DOC_W - PAD_X}" y2="${ty}" stroke="#444" stroke-width="0.5"/>`);
  ty += 20;

  // Filename
  out.push(`<text x="${PAD_X}" y="${ty}" font-family="monospace" font-size="${FILE_FS}" fill="#666">src/injectedJS.ts</text>`);
  ty += FILE_FS * 2.2;

  // Code lines
  const codeLines: [string, string | null][] = [
    ["  var phases = {",                                  null],
    ["    touchstart:  'start',",                         c.start],
    ["    touchmove:   'move',",                          c.line],
    ["    touchend:    'end',",                           c.end],
    ["    touchcancel: 'end',",                           c.end],
    ["  };",                                              null],
    ["  Object.keys(phases).forEach(function (type) {",   null],
    ["    document.addEventListener(type, function (e) {", null],
    ["      var t = e.changedTouches[0];",                null],
    ["      send({",                                      null],
    ["        type: 'touch',  phase: phases[type],",      null],
    ["        x: t.clientX,  y: t.clientY,",              null],
    ["        timestamp: Date.now(),",                    null],
    ["      });",                                         null],
    ["    }, { passive: true, capture: true });",         null],
    ["  });",                                             null],
  ];

  for (const [code, commentColor] of codeLines) {
    const stripped = code.trimStart();
    const indent   = code.length - stripped.length;
    const ix       = PAD_X + indent * CODE_FS * 0.58;

    if (commentColor) {
      out.push(
        `<text x="${ix.toFixed(1)}" y="${ty.toFixed(1)}" font-family="monospace" font-size="${CODE_FS}">` +
        `<tspan fill="#ccc">${esc(stripped)}</tspan>` +
        `<tspan fill="${commentColor}">  // ${commentColor}</tspan>` +
        `</text>`
      );
    } else {
      out.push(`<text x="${ix.toFixed(1)}" y="${ty.toFixed(1)}" font-family="monospace" font-size="${CODE_FS}" fill="#ccc">${esc(stripped)}</text>`);
    }
    ty += CODE_LH;
  }

  out.push('</svg>');
  return out.join('\n');
}
