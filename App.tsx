import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import * as Device from 'expo-device';
import { INJECTED_JS } from './src/injectedJS';
import { Stroke, TouchPoint, Viewport, DeviceInfo } from './src/types';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { generateAnnotatedSVG, generateDisplayInfoSVG, generateDisplayCodeSVG, generateInfoSVG, generateVizSVG, SVGSession } from './src/generateSVG';
import { SavedGraph, loadManifest, persistGraph, readSvgFile, removeGraph } from './src/savedGraphs';

const deviceInfo: DeviceInfo = {
  model:     Device.modelName,
  os:        Device.osName,
  osVersion: Device.osVersion,
  brand:     Device.brand,
};

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseUrl(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return 'https://' + s;
}

function svgToHtml(svg: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=10">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f0f0f0; display: flex; justify-content: center; align-items: flex-start; }
    svg { width: 100%; height: auto; display: block; }
  </style>
</head>
<body>${svg}</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
const PALETTE = [
  '#9b59b6', '#e91e63', '#aaaaaa', '#e74c3c',
  '#3498db', '#1abc9c', '#f39c12', '#2ecc71',
  '#ffffff', '#000000',
];

type ColorTarget = 'start' | 'end' | 'line';
type SheetView   = 'settings' | 'palette' | 'savedList';

// In-memory carousel graph (loaded SVG content)
type CarouselGraph = SavedGraph & { vizSvg: string; displayInfoSvg: string; displayCodeSvg: string };

// Carousel item types
type CarouselItem =
  | { type: 'title' }
  | { type: 'code'; graph: CarouselGraph }
  | { type: 'viz';  graph: CarouselGraph }
  | { type: 'info'; graph: CarouselGraph };

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const webViewRef = useRef<WebView>(null);

  // URL bar
  const [committedUrl, setCommittedUrl] = useState('');
  const [inputUrl,     setInputUrl]     = useState('');
  const [isInitial,    setIsInitial]    = useState(true);

  // Recording
  const [recording,    setRecording]    = useState(false);
  const recordingRef = useRef(false);

  // Viewport
  const viewportRef = useRef<Viewport | null>(null);

  // Strokes
  const strokesRef  = useRef<Stroke[]>([]);
  const pendingRef  = useRef<Map<string, TouchPoint[]>>(new Map());
  const [strokeCount, setStrokeCount] = useState(0);
  const [pointCount,  setPointCount]  = useState(0);

  // Session metadata
  const [titleJa,  setTitleJa]  = useState('');
  const [titleEn,  setTitleEn]  = useState('');
  const [userName, setUserName] = useState('');

  // Colors
  const [startColor, setStartColor] = useState('#9b59b6');
  const [endColor,   setEndColor]   = useState('#e91e63');
  const [lineColor,  setLineColor]  = useState('#aaaaaa');

  // Saved graphs
  const [carouselGraphs, setCarouselGraphs] = useState<CarouselGraph[]>([]);

  // Carousel
  const carouselRef = useRef<FlatList>(null);
  const [carouselIdx, setCarouselIdx] = useState(0);

  // Modals
  const [sheetVisible,   setSheetVisible]   = useState(false);
  const [sheetView,      setSheetView]      = useState<SheetView>('settings');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewHtml,    setPreviewHtml]    = useState('');
  const previewSvgRef = useRef('');

  // -------------------------------------------------------------------------
  // Load saved graphs on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    loadManifest().then(async (graphs) => {
      const loaded = await Promise.all(
        graphs.map(async (g) => {
          try {
            const [vizSvg, displayInfoSvg, displayCodeSvg] = await Promise.all([
              readSvgFile(g.vizPath),
              readSvgFile(g.displayInfoPath),
              readSvgFile(g.displayCodePath),
            ]);
            return { ...g, vizSvg, displayInfoSvg, displayCodeSvg };
          } catch {
            return null;
          }
        })
      );
      setCarouselGraphs(loaded.filter(Boolean) as CarouselGraph[]);
    });
  }, []);

  // -------------------------------------------------------------------------
  // Carousel data: [title, code1, viz1, info1, title, code2, viz2, info2, ...]
  // -------------------------------------------------------------------------
  const carouselData: CarouselItem[] = carouselGraphs.length === 0
    ? [{ type: 'title' }]
    : carouselGraphs.flatMap(g => [
        { type: 'title' as const },
        { type: 'code' as const, graph: g },
        { type: 'viz'  as const, graph: g },
        { type: 'info' as const, graph: g },
      ]);

  // -------------------------------------------------------------------------
  // Carousel auto-scroll (10s)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isInitial) return;
    const total = carouselData.length;
    if (total < 2) return;

    const timer = setInterval(() => {
      setCarouselIdx(prev => {
        const next = (prev + 1) % total;
        try { carouselRef.current?.scrollToIndex({ index: next, animated: true }); } catch {}
        return next;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [isInitial, carouselData.length]);

  // -------------------------------------------------------------------------
  // Touch message handler
  // -------------------------------------------------------------------------
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let data: {
      type: string;
      phase?: 'start' | 'move' | 'end';
      x?: number; y?: number; timestamp?: number; strokeId?: string;
      width?: number; height?: number;
    };
    try { data = JSON.parse(event.nativeEvent.data); } catch { return; }

    if (data.type === 'viewport' && data.width && data.height) {
      viewportRef.current = { width: data.width, height: data.height };
      return;
    }
    if (!recordingRef.current) return;
    if (data.type !== 'touch') return;
    if (data.x == null || data.y == null || data.timestamp == null || !data.phase || !data.strokeId) return;

    const point: TouchPoint = {
      x: data.x, y: data.y,
      timestamp: data.timestamp,
      phase: data.phase,
      strokeId: data.strokeId,
    };

    if (data.phase === 'start') {
      pendingRef.current.set(data.strokeId, [point]);
    } else if (data.phase === 'move') {
      pendingRef.current.get(data.strokeId)?.push(point);
    } else {
      const pts = pendingRef.current.get(data.strokeId);
      if (pts) {
        pts.push(point);
        strokesRef.current = [...strokesRef.current, { id: data.strokeId, points: pts }];
        pendingRef.current.delete(data.strokeId);
        setStrokeCount(strokesRef.current.length);
        setPointCount(prev => prev + pts.length);
      }
    }
  }, []);

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------
  const toggleRecording = useCallback(() => {
    const next = !recordingRef.current;
    if (next) {
      // Starting a new recording — clear the previous session cache
      strokesRef.current = [];
      pendingRef.current.clear();
      setStrokeCount(0);
      setPointCount(0);
    }
    recordingRef.current = next;
    setRecording(next);
  }, []);

  const clearSession = useCallback(() => {
    strokesRef.current = [];
    pendingRef.current.clear();
    setStrokeCount(0);
    setPointCount(0);
  }, []);

  const handleGo = useCallback(() => {
    if (!inputUrl.trim()) {
      setIsInitial(true);
      return;
    }
    const url = normaliseUrl(inputUrl);
    setCommittedUrl(url);
    setIsInitial(false);
    clearSession();
  }, [inputUrl, clearSession]);

  const applyColor = useCallback((target: ColorTarget, color: string) => {
    if (target === 'start') setStartColor(color);
    else if (target === 'end') setEndColor(color);
    else setLineColor(color);
  }, []);

  const handleDeleteGraph = useCallback(async (id: string) => {
    try {
      const updated = await removeGraph(id);
      const loaded = await Promise.all(
        updated.map(async (g) => {
          try {
            const [vizSvg, displayInfoSvg, displayCodeSvg] = await Promise.all([
              readSvgFile(g.vizPath),
              readSvgFile(g.displayInfoPath),
              readSvgFile(g.displayCodePath),
            ]);
            return { ...g, vizSvg, displayInfoSvg, displayCodeSvg };
          } catch { return null; }
        })
      );
      setCarouselGraphs(loaded.filter(Boolean) as CarouselGraph[]);
    } catch (e) {
      Alert.alert('削除失敗', String(e));
    }
  }, []);

  // -------------------------------------------------------------------------
  // Graph generation + save
  // -------------------------------------------------------------------------
  const buildSession = useCallback((): SVGSession => ({
    strokes:    strokesRef.current,
    viewport:   viewportRef.current,
    device:     deviceInfo,
    url:        committedUrl,
    exportedAt: new Date().toISOString(),
    titleJa:    titleJa  || undefined,
    titleEn:    titleEn  || undefined,
    user:       userName || undefined,
    colors:     { start: startColor, end: endColor, line: lineColor },
  }), [committedUrl, titleJa, titleEn, userName, startColor, endColor, lineColor]);

  const showGraph = useCallback((generator: (s: SVGSession) => string) => {
    const session  = buildSession();
    const preview  = generator(session);
    previewSvgRef.current = preview;
    setPreviewHtml(svgToHtml(preview));
    setPreviewVisible(true);

    // Save viz + displayInfo + displayCode
    const vizSvg         = generateVizSVG(session);
    const displayInfoSvg = generateDisplayInfoSVG(session);
    const displayCodeSvg = generateDisplayCodeSVG(session);
    const id             = `graph_${Date.now()}`;
    const title          = session.titleJa || session.titleEn || session.url;
    persistGraph(id, vizSvg, displayInfoSvg, displayCodeSvg, title, session.url)
      .then(entry => {
        setCarouselGraphs(prev => [...prev, { ...entry, vizSvg, displayInfoSvg, displayCodeSvg }]);
      })
      .catch(() => {});
  }, [buildSession]);

  const handleShowGraph = useCallback(() => {
    if (strokesRef.current.length === 0) {
      Alert.alert('No data', 'Record some touches first.');
      return;
    }
    Alert.alert(
      'レイアウトを選択',
      undefined,
      [
        { text: '可視化のみ（A4縦）',    onPress: () => showGraph(generateVizSVG) },
        { text: '情報のみ（A4縦）',      onPress: () => showGraph(generateInfoSVG) },
        { text: '可視化 + 情報（A3横）', onPress: () => showGraph(generateAnnotatedSVG) },
        { text: 'キャンセル', style: 'cancel' },
      ]
    );
  }, [showGraph]);

  const handleShareGraph = useCallback(async () => {
    try {
      const filename = `touch_graph_${Date.now()}.svg`;
      const fileUri  = (FileSystem.cacheDirectory ?? 'file://tmp/') + filename;
      await FileSystem.writeAsStringAsync(fileUri, previewSvgRef.current, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/svg+xml',
        dialogTitle: 'Export Graph (SVG)',
        UTI: 'public.svg-image',
      });
    } catch (e) {
      Alert.alert('Share failed', String(e));
    }
  }, []);

  const handleLoadEnd = useCallback(() => {
    if (!isInitial) webViewRef.current?.injectJavaScript(INJECTED_JS);
  }, [isInitial]);

  // -------------------------------------------------------------------------
  // Carousel render
  // -------------------------------------------------------------------------
  const renderCarouselItem = ({ item }: { item: CarouselItem }) => {
    if (item.type === 'title') {
      return (
        <View style={[styles.carouselPage, styles.titleCard]}>
          <Text style={styles.titleCardText}>Tracking the Interface</Text>
        </View>
      );
    }
    const svgContent =
      item.type === 'viz'  ? item.graph.vizSvg :
      item.type === 'code' ? item.graph.displayCodeSvg :
                             item.graph.displayInfoSvg;
    const bgColor = item.type === 'code' ? '#111' : '#f0f0f0';
    const html = svgToHtml(svgContent);
    return (
      <View style={styles.carouselPage}>
        <View pointerEvents="none" style={{ flex: 1 }}>
          <WebView
            source={{ html }}
            style={{ flex: 1, backgroundColor: bgColor }}
            scrollEnabled={false}
            scalesPageToFit
          />
        </View>
      </View>
    );
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.root}>
      {/* URL bar */}
      <View style={styles.urlBar}>
        <TextInput
          style={styles.urlInput}
          value={inputUrl}
          onChangeText={setInputUrl}
          onSubmitEditing={handleGo}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          placeholder="https://"
          placeholderTextColor="#555"
        />
        <TouchableOpacity style={styles.goBtn} onPress={handleGo}>
          <Text style={styles.goBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      {/* Main content */}
      {isInitial ? (
        <FlatList
          ref={carouselRef}
          data={carouselData}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, idx) =>
            item.type === 'title' ? `__title__${idx}` : `${item.type}_${item.graph.id}_${idx}`
          }
          getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
          renderItem={renderCarouselItem}
          onMomentumScrollEnd={(e) => {
            setCarouselIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
          }}
          style={{ flex: 1 }}
        />
      ) : (
        <WebView
          ref={webViewRef}
          style={styles.webview}
          source={{ uri: committedUrl }}
          injectedJavaScript={INJECTED_JS}
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          allowsInlineMediaPlayback
          allowsBackForwardNavigationGestures
        />
      )}

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.btn, recording ? styles.btnRec : styles.btnIdle]}
          onPress={toggleRecording}
        >
          <Text style={styles.btnText}>{recording ? '■ STOP' : '● REC'}</Text>
        </TouchableOpacity>

        <Text style={styles.stat}>{strokeCount}s / {pointCount}p</Text>

        <TouchableOpacity style={[styles.btn, styles.btnGraph]} onPress={handleShowGraph}>
          <Text style={styles.btnText}>GRAPH</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => { setSheetView('settings'); setSheetVisible(true); }}
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Settings / palette / savedList — single modal */}
      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setSheetVisible(false)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            {/* —— Settings view —— */}
            {sheetView === 'settings' && (
              <View style={styles.sheetPanel}>
                <Text style={styles.sheetTitle}>設定</Text>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={styles.sheetScroll}
                >
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>タイトル</Text>
                    <TextInput
                      style={styles.sheetFieldInput}
                      value={titleJa}
                      onChangeText={setTitleJa}
                      placeholder="（任意）"
                      placeholderTextColor="#555"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>英語タイトル</Text>
                    <TextInput
                      style={styles.sheetFieldInput}
                      value={titleEn}
                      onChangeText={setTitleEn}
                      placeholder="（optional）"
                      placeholderTextColor="#555"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>ユーザー名</Text>
                    <TextInput
                      style={styles.sheetFieldInput}
                      value={userName}
                      onChangeText={setUserName}
                      placeholder="（任意）"
                      placeholderTextColor="#555"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.sheetDivider} />

                  <TouchableOpacity style={styles.sheetItem} onPress={() => setSheetView('palette')}>
                    <View style={styles.sheetItemLeft}>
                      <View style={styles.colDotsRow}>
                        <View style={[styles.colDot, { backgroundColor: startColor }]} />
                        <View style={[styles.colDot, { backgroundColor: endColor }]} />
                        <View style={[styles.colDot, { backgroundColor: lineColor }]} />
                      </View>
                      <Text style={styles.sheetItemText}>カラー設定</Text>
                    </View>
                    <Text style={styles.sheetChevron}>›</Text>
                  </TouchableOpacity>

                  <View style={styles.sheetDivider} />

                  <TouchableOpacity style={styles.sheetItem} onPress={() => setSheetView('savedList')}>
                    <Text style={styles.sheetItemText}>保存済みグラフ</Text>
                    <View style={styles.sheetItemRight}>
                      <Text style={styles.sheetBadge}>{carouselGraphs.length}</Text>
                      <Text style={styles.sheetChevron}>›</Text>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.sheetDivider} />

                  <TouchableOpacity
                    style={styles.sheetItem}
                    onPress={() => { clearSession(); setSheetVisible(false); }}
                  >
                    <Text style={[styles.sheetItemText, styles.sheetItemDestructive]}>クリア</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            )}

            {/* —— Palette view —— */}
            {sheetView === 'palette' && (
              <View style={styles.palettePanel}>
                <TouchableOpacity onPress={() => setSheetView('settings')} style={styles.paletteBack}>
                  <Text style={styles.paletteBackText}>‹ 設定</Text>
                </TouchableOpacity>
                <Text style={styles.sheetTitle}>カラー選択</Text>

                {(['start', 'end', 'line'] as ColorTarget[]).map(target => {
                  const label   = target === 'start' ? 'Start point' : target === 'end' ? 'End point' : 'Stroke line';
                  const current = target === 'start' ? startColor : target === 'end' ? endColor : lineColor;
                  return (
                    <View key={target} style={styles.paletteRow}>
                      <Text style={styles.paletteLabel}>{label}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {PALETTE.map(color => (
                          <TouchableOpacity
                            key={color}
                            onPress={() => applyColor(target, color)}
                            style={[styles.swatch, { backgroundColor: color }, current === color && styles.swatchSelected]}
                          />
                        ))}
                      </ScrollView>
                    </View>
                  );
                })}

                <TouchableOpacity style={styles.paletteDone} onPress={() => setSheetVisible(false)}>
                  <Text style={styles.paletteDoneText}>完了</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* —— Saved list view —— */}
            {sheetView === 'savedList' && (
              <View style={styles.savedListPanel}>
                <View style={styles.savedListHeader}>
                  <TouchableOpacity onPress={() => setSheetView('settings')}>
                    <Text style={styles.paletteBackText}>‹ 設定</Text>
                  </TouchableOpacity>
                  <Text style={styles.sheetTitle}>保存済みグラフ</Text>
                </View>

                {carouselGraphs.length === 0 ? (
                  <Text style={styles.savedEmpty}>保存されたグラフはありません</Text>
                ) : (
                  <ScrollView style={styles.savedScroll} keyboardShouldPersistTaps="handled">
                    {carouselGraphs.map((g) => (
                      <View key={g.id} style={styles.savedItem}>
                        <View style={styles.savedItemInfo}>
                          <Text style={styles.savedItemTitle} numberOfLines={1}>{g.title || g.url}</Text>
                          <Text style={styles.savedItemDate}>
                            {new Date(g.timestamp).toLocaleString('ja-JP')}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.savedDeleteBtn}
                          onPress={() =>
                            Alert.alert('削除', `"${g.title || g.url}" を削除しますか？`, [
                              { text: 'キャンセル', style: 'cancel' },
                              { text: '削除', style: 'destructive', onPress: () => handleDeleteGraph(g.id) },
                            ])
                          }
                        >
                          <Text style={styles.savedDeleteText}>削除</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Graph preview modal */}
      <Modal
        visible={previewVisible}
        animationType="slide"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <SafeAreaView style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Graph</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.shareBtn} onPress={handleShareGraph}>
                <Text style={styles.shareBtnText}>Share SVG</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setPreviewVisible(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          <WebView
            source={{ html: previewHtml }}
            style={styles.modalWebView}
            scalesPageToFit
            scrollEnabled
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TOOLBAR_H  = 52;
const SHEET_MAX  = SCREEN_H * 0.65; // cap sheet height so it never covers status bar

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },

  // URL bar
  urlBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e1e1e', paddingHorizontal: 8, paddingVertical: 6, gap: 6,
  },
  urlInput: {
    flex: 1, height: 36, backgroundColor: '#2a2a2a',
    borderRadius: 8, paddingHorizontal: 10, color: '#fff', fontSize: 14,
  },
  goBtn: {
    backgroundColor: '#0a84ff', borderRadius: 8,
    paddingHorizontal: 14, height: 36, justifyContent: 'center',
  },
  goBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  webview: { flex: 1 },

  // Carousel
  carouselPage: { width: SCREEN_W, flex: 1 },
  titleCard:    { backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  titleCardText: {
    color: '#fff', fontSize: 20, fontWeight: '300',
    letterSpacing: 2, textAlign: 'center',
  },

  // Toolbar
  toolbar: {
    height: TOOLBAR_H, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e1e1e', paddingHorizontal: 8, gap: 6,
  },
  btn: {
    backgroundColor: '#333', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  btnText:  { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnIdle:  { backgroundColor: '#333' },
  btnRec:   { backgroundColor: '#c0392b' },
  btnGraph: { backgroundColor: '#1a6b4a' },
  stat: { flex: 1, color: '#aaa', fontSize: 12, textAlign: 'center' },
  settingsBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  settingsIcon: { color: '#888', fontSize: 22 },

  // Sheet overlay
  sheetOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },

  // Settings panel
  sheetPanel: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingTop: 20, paddingBottom: 36, paddingHorizontal: 20,
    maxHeight: SHEET_MAX,
  },
  sheetScroll: { flexGrow: 0 },
  sheetTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  sheetField: { gap: 6, paddingVertical: 6 },
  sheetFieldLabel: { color: '#888', fontSize: 12 },
  sheetFieldInput: {
    backgroundColor: '#2a2a2a', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 15,
  },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 14,
  },
  sheetItemLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetItemRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sheetItemText:  { color: '#fff', fontSize: 16 },
  sheetItemDestructive: { color: '#ff453a' },
  sheetChevron: { color: '#555', fontSize: 22, lineHeight: 24 },
  sheetBadge: {
    backgroundColor: '#444', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    color: '#aaa', fontSize: 12,
  },
  sheetDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#333' },
  colDotsRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  colDot: {
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.25)',
  },

  // Palette panel
  palettePanel: {
    backgroundColor: '#1e1e1e', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 20, paddingBottom: 36, gap: 16,
  },
  paletteBack:     { marginBottom: 4 },
  paletteBackText: { color: '#0a84ff', fontSize: 15 },
  paletteRow:  { gap: 8 },
  paletteLabel: { color: '#aaa', fontSize: 13 },
  swatch: {
    width: 34, height: 34, borderRadius: 17, marginRight: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  swatchSelected: { borderWidth: 3, borderColor: '#fff' },
  paletteDone: {
    backgroundColor: '#0a84ff', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', marginTop: 4,
  },
  paletteDoneText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Saved list panel
  savedListPanel: {
    backgroundColor: '#1e1e1e', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingTop: 20, paddingBottom: 36, maxHeight: SHEET_MAX,
  },
  savedListHeader: { paddingHorizontal: 20, gap: 4, marginBottom: 8 },
  savedEmpty: { color: '#555', fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  savedScroll: { paddingHorizontal: 20 },
  savedItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333',
  },
  savedItemInfo: { flex: 1, gap: 3 },
  savedItemTitle: { color: '#fff', fontSize: 14 },
  savedItemDate:  { color: '#666', fontSize: 11 },
  savedDeleteBtn: {
    backgroundColor: '#3a1a1a', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6, marginLeft: 12,
  },
  savedDeleteText: { color: '#ff453a', fontSize: 13 },

  // Graph preview modal
  modalRoot: { flex: 1, backgroundColor: '#111' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1e1e1e', paddingHorizontal: 16, paddingVertical: 10,
  },
  modalTitle:   { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 8 },
  shareBtn: {
    backgroundColor: '#0a84ff', borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  shareBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  closeBtn: {
    backgroundColor: '#333', borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  closeBtnText:  { color: '#fff', fontSize: 14 },
  modalWebView:  { flex: 1 },
});
