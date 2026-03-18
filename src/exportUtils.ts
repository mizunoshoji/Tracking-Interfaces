import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Stroke, Session, Viewport, DeviceInfo } from "./types";

// ---------------------------------------------------------------------------
// JSON export
// ---------------------------------------------------------------------------

export async function exportJSON(
  strokes: Stroke[],
  url: string,
  viewport: Viewport | null,
  device: DeviceInfo | null,
  titleEn: string = '',
): Promise<void> {
  const session: Session = {
    exportedAt: new Date().toISOString(),
    url,
    viewport,
    device,
    titleEn,
    strokes,
  };

  const filename = `touch_${Date.now()}.json`;
  const fileUri = (FileSystem.cacheDirectory ?? "file://tmp/") + filename;

  await FileSystem.writeAsStringAsync(
    fileUri,
    JSON.stringify(session, null, 2),
    {
      encoding: FileSystem.EncodingType.UTF8,
    },
  );

  await Sharing.shareAsync(fileUri, {
    mimeType: "application/json",
    dialogTitle: "Export Touch Data (JSON)",
    UTI: "public.json",
  });
}

// ---------------------------------------------------------------------------
// SVG export
// ---------------------------------------------------------------------------
// Each stroke becomes a <path d="M ... L ..."> — fill="none", stroke="black".
// viewBox is built from the bounding box of all points (+ padding),
// so the file can be sent directly to a pen plotter.
// ---------------------------------------------------------------------------

export async function exportSVG(strokes: Stroke[]): Promise<void> {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const stroke of strokes) {
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const padding = 10;
  const ox = minX - padding;
  const oy = minY - padding;
  const svgW = (maxX - minX + padding * 2).toFixed(2);
  const svgH = (maxY - minY + padding * 2).toFixed(2);

  const polylines = strokes
    .filter((s) => s.points.length >= 2)
    .map((stroke) => {
      const [first, ...rest] = stroke.points;
      const move = `M ${(first.x - ox).toFixed(2)},${(first.y - oy).toFixed(2)}`;
      const lines = rest
        .map((p) => `L ${(p.x - ox).toFixed(2)},${(p.y - oy).toFixed(2)}`)
        .join(" ");
      return `  <path d="${move} ${lines}" fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("\n");

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">`,
    polylines,
    "</svg>",
  ].join("\n");

  const filename = `touch_${Date.now()}.svg`;
  const fileUri = (FileSystem.cacheDirectory ?? "file://tmp/") + filename;

  await FileSystem.writeAsStringAsync(fileUri, svg, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  await Sharing.shareAsync(fileUri, {
    mimeType: "image/svg+xml",
    dialogTitle: "Export Touch Data (SVG)",
    UTI: "public.svg-image",
  });
}
