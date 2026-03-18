import React, { useRef, useState, useCallback } from 'react';
import {
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import * as Device from 'expo-device';
import { INJECTED_JS } from './src/injectedJS';
import { exportJSON, exportSVG } from './src/exportUtils';
import { Stroke, TouchPoint, Viewport, DeviceInfo } from './src/types';

const deviceInfo: DeviceInfo = {
  model:     Device.modelName,
  os:        Device.osName,
  osVersion: Device.osVersion,
  brand:     Device.brand,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseUrl(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return 'https://' + s;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const webViewRef = useRef<WebView>(null);

  // URL bar
  const [committedUrl, setCommittedUrl] = useState('https://example.com');
  const [inputUrl, setInputUrl] = useState('https://example.com');

  // Recording state — we keep a ref so the onMessage callback always sees
  // the current value without needing to be recreated on every toggle.
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);

  // Viewport size reported by injected JS
  const viewportRef = useRef<Viewport | null>(null);

  // Stroke storage — ref for the hot path, state for re-renders.
  const strokesRef = useRef<Stroke[]>([]);
  const pendingRef = useRef<Map<string, TouchPoint[]>>(new Map());
  const [strokeCount, setStrokeCount] = useState(0);
  const [pointCount, setPointCount] = useState(0);

  // -------------------------------------------------------------------------
  // Touch message handler (hot path)
  // -------------------------------------------------------------------------
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let data: {
      type: string;
      phase?: 'start' | 'move' | 'end';
      x?: number;
      y?: number;
      timestamp?: number;
      strokeId?: string;
      width?: number;
      height?: number;
    };

    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (data.type === 'viewport' && data.width && data.height) {
      viewportRef.current = { width: data.width, height: data.height };
      return;
    }

    if (!recordingRef.current) return;
    if (data.type !== 'touch') return;
    if (data.x == null || data.y == null || data.timestamp == null || !data.phase || !data.strokeId) return;

    const point: TouchPoint = {
      x: data.x,
      y: data.y,
      timestamp: data.timestamp,
      phase: data.phase,
      strokeId: data.strokeId,
    };

    if (data.phase === 'start') {
      pendingRef.current.set(data.strokeId, [point]);
    } else if (data.phase === 'move') {
      pendingRef.current.get(data.strokeId)?.push(point);
    } else {
      // 'end'
      const pts = pendingRef.current.get(data.strokeId);
      if (pts) {
        pts.push(point);
        const stroke: Stroke = { id: data.strokeId, points: pts };
        strokesRef.current = [...strokesRef.current, stroke];
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
    const url = normaliseUrl(inputUrl);
    setCommittedUrl(url);
    clearSession();
  }, [inputUrl, clearSession]);

  const handleExportJSON = useCallback(async () => {
    if (strokesRef.current.length === 0) {
      Alert.alert('No data', 'Record some touches first.');
      return;
    }
    try {
      await exportJSON(strokesRef.current, committedUrl, viewportRef.current, deviceInfo);
    } catch (e) {
      Alert.alert('Export failed', String(e));
    }
  }, [committedUrl]);

  const handleExportSVG = useCallback(async () => {
    if (strokesRef.current.length === 0) {
      Alert.alert('No data', 'Record some touches first.');
      return;
    }
    try {
      await exportSVG(strokesRef.current);
    } catch (e) {
      Alert.alert('Export failed', String(e));
    }
  }, []);

  // Re-inject on every page load (handles full navigations; SPA pushState
  // navigations that don't trigger onLoadEnd are not handled in this prototype).
  const handleLoadEnd = useCallback(() => {
    webViewRef.current?.injectJavaScript(INJECTED_JS);
  }, []);

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
          placeholder="https://example.com"
          placeholderTextColor="#999"
        />
        <TouchableOpacity style={styles.goBtn} onPress={handleGo}>
          <Text style={styles.goBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      {/* WebView */}
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
      />

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.btn, recording ? styles.btnRec : styles.btnIdle]}
          onPress={toggleRecording}
        >
          <Text style={styles.btnText}>{recording ? '■ STOP' : '● REC'}</Text>
        </TouchableOpacity>

        <Text style={styles.stat}>
          {strokeCount}s / {pointCount}p
        </Text>

        <TouchableOpacity style={styles.btn} onPress={handleExportJSON}>
          <Text style={styles.btnText}>JSON</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={handleExportSVG}>
          <Text style={styles.btnText}>SVG</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, styles.btnClear]} onPress={clearSession}>
          <Text style={styles.btnText}>CLR</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TOOLBAR_H = 52;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111',
  },

  // URL bar
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  urlInput: {
    flex: 1,
    height: 36,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 10,
    color: '#fff',
    fontSize: 14,
  },
  goBtn: {
    backgroundColor: '#0a84ff',
    borderRadius: 8,
    paddingHorizontal: 14,
    height: 36,
    justifyContent: 'center',
  },
  goBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },

  // WebView
  webview: {
    flex: 1,
  },

  // Toolbar
  toolbar: {
    height: TOOLBAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    paddingHorizontal: 8,
    gap: 6,
  },
  btn: {
    backgroundColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  btnIdle: {
    backgroundColor: '#333',
  },
  btnRec: {
    backgroundColor: '#c0392b',
  },
  btnClear: {
    backgroundColor: '#555',
  },
  stat: {
    flex: 1,
    color: '#aaa',
    fontSize: 12,
    textAlign: 'center',
  },
});
