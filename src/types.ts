export type TouchPhase = 'start' | 'move' | 'end';

export interface TouchPoint {
  x: number;
  y: number;
  timestamp: number;
  phase: TouchPhase;
  strokeId: string;
}

export interface Stroke {
  id: string;
  points: TouchPoint[];
}

export interface Viewport {
  width: number;
  height: number;
}

export interface DeviceInfo {
  model: string | null;
  os: string | null;
  osVersion: string | null;
  brand: string | null;
}

export interface Session {
  exportedAt: string;
  url: string;
  viewport: Viewport | null;
  device: DeviceInfo | null;
  titleEn: string;
  strokes: Stroke[];
}
