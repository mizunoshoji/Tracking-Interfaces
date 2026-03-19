import * as FileSystem from 'expo-file-system';

export interface SavedGraph {
  id:              string;
  timestamp:       number;
  vizPath:         string;
  displayInfoPath: string;
  displayCodePath: string;
  title:           string;
  url:             string;
}

const DIR      = (FileSystem.documentDirectory ?? '') + 'saved_graphs/';
const MANIFEST = DIR + 'manifest.json';

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export async function loadManifest(): Promise<SavedGraph[]> {
  try {
    await ensureDir();
    const info = await FileSystem.getInfoAsync(MANIFEST);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(MANIFEST));
  } catch {
    return [];
  }
}

async function saveManifest(graphs: SavedGraph[]) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(MANIFEST, JSON.stringify(graphs));
}

export async function persistGraph(
  id:             string,
  vizSvg:         string,
  displayInfoSvg: string,
  displayCodeSvg: string,
  title:          string,
  url:            string,
): Promise<SavedGraph> {
  await ensureDir();
  const vizPath         = DIR + id + '_viz.svg';
  const displayInfoPath = DIR + id + '_info.svg';
  const displayCodePath = DIR + id + '_code.svg';
  await FileSystem.writeAsStringAsync(vizPath,         vizSvg);
  await FileSystem.writeAsStringAsync(displayInfoPath, displayInfoSvg);
  await FileSystem.writeAsStringAsync(displayCodePath, displayCodeSvg);
  const entry: SavedGraph = { id, timestamp: Date.now(), vizPath, displayInfoPath, displayCodePath, title, url };
  const existing = await loadManifest();
  await saveManifest([...existing, entry]);
  return entry;
}

export async function removeGraph(id: string): Promise<SavedGraph[]> {
  const graphs = await loadManifest();
  const entry  = graphs.find(g => g.id === id);
  if (entry) {
    await FileSystem.deleteAsync(entry.vizPath,         { idempotent: true });
    await FileSystem.deleteAsync(entry.displayInfoPath, { idempotent: true });
    await FileSystem.deleteAsync(entry.displayCodePath, { idempotent: true });
  }
  const updated = graphs.filter(g => g.id !== id);
  await saveManifest(updated);
  return updated;
}

export async function readSvgFile(path: string): Promise<string> {
  return FileSystem.readAsStringAsync(path);
}
