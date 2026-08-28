/**
 * 设置页 React 化 —— 由 App.tsx 在 page==='settings' 时挂载到 <main id="content">。
 *
 * DOM 结构与旧的 public/views/settings.html 完全一致（类名/ID 不变，保证 CSS 生效）。
 * 原 public/scripts/settings.js 的命令式绑定（主题/色温/玻璃/亮度/取色面板/路径设置/更新检查）
 * 全部转为 React 状态与事件处理；视觉侧（背景图、遮罩、主题 class）由 theme/background.ts
 * 的 applyThemeVisual / applyAppBackground / applyGlassMode / setBackgroundOverlay 提供。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  applyAppBackground,
  applyGlassMode,
  applyThemeVisual,
  getAppearance,
  setBackgroundOverlay,
} from './theme/background';
import { showNotification } from './notification/store';

/* ===================== 颜色工具（由原 settings.js 移植） ===================== */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = String(hex || '').replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return {
    r: parseInt(v.slice(0, 2), 16) || 0,
    g: parseInt(v.slice(2, 4), 16) || 0,
    b: parseInt(v.slice(4, 6), 16) || 0,
  };
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360;
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
function hslToHex(h: number, s: number, l: number): string {
  const rgb = hslToRgb(h, s / 100, l / 100);
  const toHex = (n: number) => {
    const x = Math.round(n).toString(16);
    return x.length === 1 ? '0' + x : x;
  };
  return '#' + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
}
function hexToHslObj(hex: string): { h: number; s: number; l: number } {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return { h: Math.round(hsl[0]), s: Math.round(hsl[1] * 100), l: Math.round(hsl[2] * 100) };
}

/** 将主色衍生为一套完整主题变量并应用到 :root（全局生效，深浅兼容） */
function applyAccentColor(hex: string): void {
  if (!hex) hex = '#7c83ff';
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const h = hsl[0], s = hsl[1], l = hsl[2];
  const hover = hslToRgb(h, s, Math.max(l - 0.12, 0.18));
  const accent2 = hslToRgb((h + 28) % 360, Math.min(s + 0.06, 1), Math.min(l + 0.1, 0.72));
  const rgbStr = (c: { r: number; g: number; b: number }) => c.r + ', ' + c.g + ', ' + c.b;
  const soft = 'rgba(' + rgbStr(rgb) + ', 0.16)';
  const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  const contrast = lum > 165 ? '#1a1a1a' : '#ffffff';
  const root = document.documentElement.style;
  root.setProperty('--accent', hex);
  root.setProperty('--accent-hover', 'rgb(' + rgbStr(hover) + ')');
  root.setProperty('--accent-2', 'rgb(' + rgbStr(accent2) + ')');
  root.setProperty('--accent-soft', soft);
  root.setProperty('--accent-glow', 'rgba(' + rgbStr(rgb) + ', 0.35)');
  root.setProperty('--accent-contrast', contrast);
  root.setProperty('--gradient-primary', hex);
  root.setProperty('--gradient-soft', soft);
  root.setProperty('--glow-a', 'rgba(' + rgbStr(rgb) + ', 0.20)');
  root.setProperty('--glow-b', 'rgba(' + rgbStr(rgb) + ', 0.16)');
  root.setProperty('--glow-c', 'rgba(' + rgbStr(rgb) + ', 0.12)');
}

/* ===================== 常量 ===================== */

const PRESET_SWATCHES = [
  { color: '#7c83ff', title: '默认紫罗兰' },
  { color: '#5b8cff', title: '星空蓝' },
  { color: '#33c9c9', title: '青碧' },
  { color: '#3ecf8e', title: '翠绿' },
  { color: '#ff7eb6', title: '樱粉' },
  { color: '#ff9f45', title: '暖橙' },
];
const PICKER_PRESETS = ['#7c83ff', '#6d5df6', '#3ecf8e', '#33c9c9', '#ff7eb6', '#b18cff'];
const NO_BG_TEXT = '没有设置背景图片';
const GITHUB_URL = 'https://github.com/Untsia/FeibiJiubi';
const GITHUB_RELEASES_URL = 'https://github.com/Untsia/FeibiJiubi/releases/latest';

function api(): any {
  return (window as any).electronAPI;
}
function appearance(): any {
  return getAppearance();
}
function brightnessToNum(raw: unknown): number {
  const n = parseFloat(String(raw));
  return isNaN(n) ? 50 : n;
}
function isHiddenBg(v: unknown): boolean {
  return v === true || v === 'true' || v === '1';
}

/* ===================== 自定义取色面板（body 顶层 Portal） ===================== */

function ColorPickerPop({
  open,
  swatchRef,
  onClose,
  onApply,
}: {
  open: boolean;
  swatchRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onApply: (hex: string) => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [h, setH] = useState(248);
  const [s, setS] = useState(89);
  const [l, setL] = useState(66);

  // 打开时以当前 --accent 初始化
  useEffect(() => {
    if (!open) return;
    const cur = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#7c83ff').trim();
    const o = hexToHslObj(cur);
    setH(o.h); setS(o.s); setL(o.l);
  }, [open]);

  // 定位（fixed 相对视口；钉在自定义按钮右侧，放不下翻到左侧，再贴边）
  useLayoutEffect(() => {
    if (!open || !swatchRef.current) return;
    const pop = popRef.current;
    if (!pop) return;
    const r = swatchRef.current.getBoundingClientRect();
    const pw = pop.offsetWidth || 300;
    const ph = pop.offsetHeight || 220;
    let left = r.right + 8;
    if (left + pw > window.innerWidth - 12) left = r.left - pw - 8;
    if (left < 12) left = 12;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - 12 - pw;
    let top = r.top + (r.height - ph) / 2;
    if (top < 12) top = 12;
    if (top + ph > window.innerHeight - 12) top = Math.max(12, window.innerHeight - 12 - ph);
    setPos({ left, top });
  }, [open, swatchRef, h, s, l]);

  // 点击外部 / Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const pop = popRef.current;
      if (pop && !pop.contains(e.target as Node) && e.target !== swatchRef.current) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, swatchRef]);

  if (!open) return null;

  const hex = hslToHex(h, s, l);
  const hex2 = hslToHex((h + 28) % 360, Math.min(s + 6, 100), Math.min(l + 10, 72));
  const setFromHex = (raw: string) => {
    if (!/^#?[0-9a-fA-F]{6}$/.test(raw)) return;
    const o = hexToHslObj(raw[0] === '#' ? raw : '#' + raw);
    setH(o.h); setS(o.s); setL(o.l);
  };

  return createPortal(
    <div
      id="colorPickerPop"
      className="color-picker-pop show"
      ref={popRef}
      style={pos ?? undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cpp-header">自定义主色</div>
      <div className="cpp-preview" id="cppPreview" style={{ background: 'linear-gradient(135deg, ' + hex + ', ' + hex2 + ')' }} />
      <div className="cpp-sliders">
        <div className="cpp-row">
          <span className="cpp-label">色相</span>
          <input
            type="range" id="cppHue" min={0} max={360} value={h}
            style={{ ['--track' as any]: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)' }}
            onChange={(e) => setH(parseInt(e.target.value, 10))}
          />
          <span className="cpp-val" id="cppHueVal">{h}</span>
        </div>
        <div className="cpp-row">
          <span className="cpp-label">饱和</span>
          <input
            type="range" id="cppSat" min={0} max={100} value={s}
            style={{ ['--track' as any]: 'linear-gradient(to right, ' + hslToHex(h, 0, l) + ', ' + hslToHex(h, 100, l) + ')' }}
            onChange={(e) => setS(parseInt(e.target.value, 10))}
          />
          <span className="cpp-val" id="cppSatVal">{s}</span>
        </div>
        <div className="cpp-row">
          <span className="cpp-label">明度</span>
          <input
            type="range" id="cppLight" min={0} max={100} value={l}
            style={{ ['--track' as any]: 'linear-gradient(to right, ' + hslToHex(h, s, 0) + ', ' + hslToHex(h, s, 50) + ', ' + hslToHex(h, s, 100) + ')' }}
            onChange={(e) => setL(parseInt(e.target.value, 10))}
          />
          <span className="cpp-val" id="cppLightVal">{l}</span>
        </div>
      </div>
      <div className="cpp-presets" id="cppPresets">
        {PICKER_PRESETS.map((c) => (
          <button key={c} type="button" className="cpp-preset" style={{ ['--pc' as any]: c }} data-c={c} title={c} onClick={() => setFromHex(c)} />
        ))}
      </div>
      <div className="cpp-hexrow">
        <span className="cpp-hash">#</span>
        <input
          type="text" id="cppHex" maxLength={6} spellCheck={false} value={hex.slice(1)}
          onChange={(e) => setFromHex(e.target.value)}
        />
      </div>
      <div className="cpp-actions">
        <button type="button" className="cpp-btn cpp-cancel" id="cppCancel" onClick={onClose}>取消</button>
        <button type="button" className="cpp-btn cpp-apply" id="cppApply" onClick={() => { onApply(hex); onClose(); }}>应用</button>
      </div>
    </div>,
    document.body,
  );
}

/* ===================== 设置页主组件 ===================== */

export default function SettingsPage() {
  // 初始值一律读 body 当前类（启动时 applyAppBackground 已应用），避免硬编码默认值
  // 导致「默认 → 真实」的跳变闪烁（玻璃开关 / 主题模式 / 色温同源问题）。
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() =>
    document.body.classList.contains('theme-light') ? 'light' : 'dark',
  );
  const [colorTemp, setColorTemp] = useState<'warm' | 'cool'>(() =>
    document.body.classList.contains('theme-cool') ? 'cool' : 'warm',
  );
  const [glassOn, setGlassOn] = useState<boolean>(() => document.body.classList.contains('glass-mode'));
  const [accent, setAccent] = useState('#7c83ff');
  const [brightness, setBrightness] = useState(50);
  const [bgHidden, setBgHidden] = useState(false);
  const [bgDisplay, setBgDisplay] = useState('');
  const [closeAction, setCloseAction] = useState<'exit' | 'tray'>('exit');
  const [dataFilePath, setDataFilePath] = useState('');
  const [gamePath, setGamePath] = useState('');
  const [version, setVersion] = useState('1.7.0');
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateHref, setUpdateHref] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyBtn, setBusyBtn] = useState<{ key: string; label: string } | null>(null);

  const themeModeRef = useRef(themeMode);
  themeModeRef.current = themeMode;
  const lastChosenBg = useRef<string>('');
  const brightnessRaf = useRef<number | null>(null);
  const customSwatchRef = useRef<HTMLButtonElement | null>(null);

  /* ---------- 配色 ---------- */
  const persistAccent = useCallback((hex: string) => {
    if (api() && api().saveBackgroundSettings) api().saveBackgroundSettings('accentColor', hex);
  }, []);
  const pickAccent = useCallback((hex: string, persist = true) => {
    setAccent(hex);
    applyAccentColor(hex);
    if (persist) persistAccent(hex);
  }, [persistAccent]);

  /* ---------- 背景加载（进入页面时 + 恢复默认后复用） ---------- */
  const applyLoadedSettings = useCallback((settings: any) => {
    const a = appearance();
    const savedAccent = settings.accentColor || '#7c83ff';
    const mode: 'light' | 'dark' = settings.themeMode && settings.themeMode === 'light' ? 'light' : 'dark';
    setThemeMode(mode);
    setAccent(savedAccent);
    applyAccentColor(savedAccent);
    setColorTemp((settings.colorTemp === 'cool' ? 'cool' : 'warm') as 'cool' | 'warm');
    // 玻璃开关直接用 DB 的 glassEnabled（'true'/'1'/true 均视为开启），不依赖
    // body 的 glass-mode 类 —— 该类由异步 applyAppBackground 设置，存在时序竞态，
    // 且会被会话内手动状态（glassUserSet）污染，导致开关显示与实际不符/跳变。
    setGlassOn(isHiddenBg(settings.glassEnabled));
    setBrightness(brightnessToNum(a ? a.backgroundBrightness : 50));
    setBgHidden(isHiddenBg(a ? a.backgroundHidden : false));
    if (settings.backgroundImage) {
      lastChosenBg.current = String(settings.backgroundImage);
      setBgDisplay(String(settings.backgroundImage));
    } else {
      setBgDisplay(settings.backgroundImage === null ? NO_BG_TEXT : String(settings.backgroundImage || ''));
    }
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      const settings = await api().invoke('loadBackgroundSettings');
      const a = appearance();
      if (a) {
        a.themeMode = settings.themeMode || 'light';
        a.colorTemp = settings.colorTemp || 'warm';
      }
      applyAppBackground();
      applyLoadedSettings(settings);
    } catch (e) {
      console.error('加载背景设置失败:', e);
    }
  }, [applyLoadedSettings]);

  const refreshNow = useCallback(() => {
    const a = appearance();
    const bgImage = (a && a.backgroundImage) || '';
    applyThemeVisual(themeModeRef.current || 'light', bgImage);
  }, []);

  useEffect(() => {
    reloadSettings();
  }, [reloadSettings]);

  /* ---------- 数据路径 / 游戏目录 / 版本 ---------- */
  useEffect(() => {
    api()
      .invoke('get-dataFile-path')
      .then((result: any) => {
        if (result && result.path) setDataFilePath(result.path);
      })
      .catch(() => {});
    api()
      .invoke('load-settings')
      .then((settings: any) => {
        setCloseAction(settings.closeAction === 'tray' ? 'tray' : 'exit');
        const saved = settings && settings.gameRootDir !== undefined ? settings.gameRootDir : '';
        const normalized = saved && String(saved).trim() && String(saved).trim() !== 'false' ? String(saved).trim() : '';
        setGamePath(normalized);
        // 未设置时自动探测已安装的鸣潮并显示
        if (!normalized && api().detectWutheringWavesPath) {
          api()
            .detectWutheringWavesPath()
            .then((res: any) => {
              const found = res && res.success && res.path ? String(res.path) : '';
              if (found) {
                setGamePath(found);
                if (api().saveBackgroundSettings) api().saveBackgroundSettings('gameRootDir', found);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    if (api() && typeof api().getAppVersion === 'function') {
      api()
        .getAppVersion()
        .then((v: any) => {
          if (v) setVersion(String(v));
        })
        .catch(() => {});
    }
    // 清理 rAF
    return () => {
      if (brightnessRaf.current != null) cancelAnimationFrame(brightnessRaf.current);
    };
  }, []);

  /* ---------- 侧边栏主题切换 → 设置页高亮同步 ---------- */
  useEffect(() => {
    const onThemeChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.mode) {
        const m = detail.mode === 'light' ? 'light' : 'dark';
        setThemeMode(m);
        setAccent((acc) => {
          if (acc) applyAccentColor(acc);
          return acc;
        });
      }
    };
    window.addEventListener('theme-mode-changed', onThemeChanged);
    return () => window.removeEventListener('theme-mode-changed', onThemeChanged);
  }, []);

  /* ---------- 亮度的拖动预览（rAF 合并，沿用旧逻辑） ---------- */
  const applyBrightnessPreview = useCallback((v: number) => {
    const num = isNaN(v) ? 50 : Math.min(100, Math.max(0, v));
    const a = appearance();
    if (a) a.backgroundBrightness = num;
    if (brightnessRaf.current != null) cancelAnimationFrame(brightnessRaf.current);
    brightnessRaf.current = requestAnimationFrame(() => {
      brightnessRaf.current = null;
      if (typeof setBackgroundOverlay === 'function') {
        setBackgroundOverlay(1 - num / 100);
        return;
      }
      const bgImage = (a && a.backgroundImage) || '';
      applyThemeVisual(themeModeRef.current || 'light', bgImage);
    });
  }, []);

  /* ---------- 事件处理器 ---------- */
  const onThemeMode = useCallback(async (mode: 'light' | 'dark') => {
    setThemeMode(mode);
    await api().saveBackgroundSettings('themeMode', mode);
    const bgImage = (appearance() && appearance().backgroundImage) || '';
    applyThemeVisual(mode, bgImage);
    window.dispatchEvent(new CustomEvent('theme-mode-changed', { detail: { mode } }));
  }, []);

  const onColorTemp = useCallback((temp: 'warm' | 'cool') => {
    setColorTemp(temp);
    const a = appearance();
    if (a) a.colorTemp = temp;
    api().saveBackgroundSettings && api().saveBackgroundSettings('colorTemp', temp);
    document.body.classList.toggle('theme-cool', temp === 'cool');
    const bgImage = (a && a.backgroundImage) || '';
    applyThemeVisual(themeModeRef.current || 'light', bgImage);
  }, []);

  const onGlass = useCallback((on: boolean) => {
    setGlassOn(on);
    api().saveBackgroundSettings && api().saveBackgroundSettings('glassEnabled', String(on));
    applyGlassMode(on);
  }, []);

  const toggleBgImage = useCallback(() => {
    const hidden = !bgHidden;
    const a = appearance();
    if (a) a.backgroundHidden = hidden;
    else (window as any).__appearance = { backgroundHidden: hidden };
    setBgHidden(hidden);
    api().saveBackgroundSettings && api().saveBackgroundSettings('backgroundHidden', String(hidden));
    refreshNow();
  }, [bgHidden, refreshNow]);

  const resetBrightness = useCallback(() => {
    const v = 50;
    setBrightness(v);
    applyBrightnessPreview(v);
    api().saveBackgroundSettings && api().saveBackgroundSettings('backgroundBrightness', String(v));
  }, [applyBrightnessPreview]);

  const browseBg = useCallback(async () => {
    const cur = bgDisplay;
    const curPath = cur && cur !== NO_BG_TEXT ? cur : lastChosenBg.current;
    const result = await api().selectBackgroundFile(curPath);
    if (result.canceled === false && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      setBgDisplay(filePath);
      lastChosenBg.current = filePath;
      await api().saveBackgroundSettings('backgroundImage', filePath);
      applyAppBackground();
    }
  }, [bgDisplay]);

  const restoreDefaults = useCallback(async () => {
    try {
      await api().invoke('restoreDefaultBackgroundSettings');
      showNotification(true, '背景设置已恢复为默认配置');
      setBgDisplay(NO_BG_TEXT);
      await reloadSettings();
    } catch (err) {
      console.error('恢复默认设置失败:', err);
      showNotification(false, '恢复默认设置失败');
    }
  }, [reloadSettings]);

  const setBusy = (key: string, busyLabel: string) => setBusyBtn({ key, label: busyLabel });
  const releaseBusy = () => setBusyBtn(null);

  const browseDataFile = useCallback(async () => {
    setBusy('data', '请等待...');
    try {
      const result = await api().invoke('browse-dataFile');
      if (result.success) {
        showNotification(true, '路径相同: ' + result.path);
        setDataFilePath(result.path);
      } else {
        showNotification(false, result.message);
      }
    } catch (error) {
      console.error('切换路径时发生错误:', error);
      showNotification(false, '路径更新失败\n' + error);
    } finally {
      releaseBusy();
    }
  }, []);

  const resetDataFile = useCallback(async () => {
    setBusy('data', '请等待...');
    try {
      const result = await api().invoke('reset-dataFile');
      if (result.success) {
        showNotification(true, '目前已是默认路径');
        setDataFilePath(result.path);
      } else {
        showNotification(false, result.message);
      }
    } catch (error) {
      console.error('恢复路径时发生错误:', error);
      showNotification(false, '重置路径失败\n' + error);
    } finally {
      releaseBusy();
    }
  }, []);

  const browseGamePath = useCallback(async () => {
    try {
      const result = await api().browseGamePath(gamePath);
      if (result && result.success && result.path) {
        setGamePath(result.path);
        await api().invoke('save-setting', 'gameRootDir', result.path);
        showNotification(true, '已保存鸣潮游戏目录');
      } else if (result && result.message) {
        showNotification(false, result.message);
      }
    } catch (error) {
      console.error('选择游戏目录失败:', error);
      showNotification(false, '选择失败\n' + error);
    }
  }, [gamePath]);

  const resetGamePath = useCallback(async () => {
    setGamePath('');
    await api().invoke('save-setting', 'gameRootDir', '');
    showNotification(true, '已清空游戏目录');
  }, []);

  const openExternal = useCallback((url: string) => {
    if (api() && typeof api().openExternal === 'function') api().openExternal(url);
  }, []);

  const checkUpdate = useCallback(async () => {
    setUpdateStatus('正在检查更新…');
    try {
      const res = await api().checkUpdate();
      if (!res || !res.success) {
        setUpdateStatus('检查失败：' + ((res && res.error) || '未知错误'));
        return;
      }
      const has = res.hasUpdate;
      setUpdateStatus(has ? '发现新版本 v' + res.latestVersion + '（当前 v' + res.currentVersion + '）' : '已是最新版本 v' + res.currentVersion);
      setUpdateHref(has && res.releaseUrl ? String(res.releaseUrl) : null);
    } catch (e) {
      setUpdateStatus('检查失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  /* ---------- 渲染 ---------- */
  const accentLower = accent.toLowerCase();
  const presetMatch = PRESET_SWATCHES.some((s) => s.color === accentLower);
  const toggleBtnText = bgHidden ? '显示图片' : '隐藏图片';
  const dataBusy = busyBtn && busyBtn.key === 'data';

  return (
    <div className="settings-page">
      <div className="settings-container">
        <div className="page-head">
          <h1 className="page-title">设置</h1>
        </div>

        {/* 外观 */}
        <section className="setting-card">
          <div className="card-header"><h3>外观</h3></div>
          <div className="card-body">
            <div className="settings-option column">
              <div className="option-info">
                <span className="option-title">主题模式</span>
                <p className="option-desc">在浅色与深色外观之间切换</p>
              </div>
              <div className="option-control full">
                <div className="theme-switch">
                  <button type="button" className={'theme-option' + (themeMode === 'dark' ? ' active' : '')} data-mode="dark" onClick={() => onThemeMode('dark')}>深色</button>
                  <button type="button" className={'theme-option' + (themeMode === 'light' ? ' active' : '')} data-mode="light" onClick={() => onThemeMode('light')}>浅色</button>
                </div>
              </div>
            </div>
            <div className="settings-option column">
              <div className="option-info">
                <span className="option-title">色温模式</span>
                <p className="option-desc">暖白长时间观看易疲劳，冷白更舒缓</p>
              </div>
              <div className="option-control full">
                <div className="theme-switch" id="colorTempSwitch">
                  <button type="button" className={'theme-option' + (colorTemp === 'warm' ? ' active' : '')} data-temp="warm" onClick={() => onColorTemp('warm')}>暖白</button>
                  <button type="button" className={'theme-option' + (colorTemp === 'cool' ? ' active' : '')} data-temp="cool" onClick={() => onColorTemp('cool')}>冷白</button>
                </div>
              </div>
            </div>
            <div className="settings-option column">
              <div className="option-info">
                <span className="option-title">玻璃材质</span>
                <p className="option-desc">开启后界面使用半透明毛玻璃，让整个页面透出背景图片</p>
              </div>
              <div className="option-control full">
                <div className="theme-switch" id="glassSwitch">
                  <button type="button" className={'theme-option' + (!glassOn ? ' active' : '')} data-glass="off" onClick={() => onGlass(false)}>关闭</button>
                  <button type="button" className={'theme-option' + (glassOn ? ' active' : '')} data-glass="on" onClick={() => onGlass(true)}>开启</button>
                </div>
              </div>
            </div>
            <div className="settings-option column">
              <div className="option-info">
                <span className="option-title">主题配色</span>
                <p className="option-desc">自定义应用的主色调，所有页面即时生效</p>
              </div>
              <div className="option-control full">
                <div className="theme-swatches" id="themeSwatches">
                  {PRESET_SWATCHES.map((s) => (
                    <button
                      key={s.color}
                      type="button"
                      className={'swatch' + (accentLower === s.color ? ' active' : '')}
                      data-color={s.color}
                      style={{ ['--sw' as any]: s.color }}
                      title={s.title}
                      onClick={() => pickAccent(s.color)}
                    />
                  ))}
                  <button
                    type="button"
                    className={'swatch swatch-custom' + (!presetMatch ? ' active' : '')}
                    id="customSwatch"
                    title="自定义颜色"
                    ref={customSwatchRef}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPickerOpen((v) => !v);
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="settings-option column">
              <div className="option-info">
                <label className="option-title" htmlFor="background-path">背景图片</label>
                <p className="option-desc">选择一张图片作为应用背景</p>
              </div>
              <div className="option-control full">
                <input type="text" id="background-path" readOnly value={bgDisplay} />
                <button type="button" id="browse-background" onClick={browseBg}>选择图片</button>
                <button type="button" id="restore-defaults" className="secondary" onClick={restoreDefaults}>恢复默认</button>
              </div>
            </div>
            <div className="settings-option column">
              <div className="option-info">
                <span className="option-title">背景亮度</span>
                <p className="option-desc">调节背景图片的明暗，越靠右越亮、越清晰</p>
              </div>
              <div className="option-control full">
                <input
                  type="range" id="background-brightness" min={0} max={100} step={1} value={brightness}
                  onChange={(e) => {
                    const v = brightnessToNum(e.target.value);
                    setBrightness(v);
                    applyBrightnessPreview(v);
                  }}
                  onPointerUp={() => api().saveBackgroundSettings && api().saveBackgroundSettings('backgroundBrightness', String(brightnessToNum(brightness)))}
                  onKeyUp={() => api().saveBackgroundSettings && api().saveBackgroundSettings('backgroundBrightness', String(brightnessToNum(brightness)))}
                />
                <span className="brightness-val" id="background-brightness-val">{brightness}</span>
              </div>
            </div>
            <div className="settings-option column">
              <div className="option-control full">
                <div className="btn-row">
                  <button type="button" id="toggle-background-image" className="secondary" onClick={toggleBgImage}>{toggleBtnText}</button>
                  <button type="button" id="reset-brightness" className="secondary" onClick={resetBrightness}>恢复默认</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 数据 */}
        <section className="setting-card">
          <div className="card-header"><h3>数据</h3></div>
          <div className="card-body">
            <div className="settings-option column">
              <div className="option-info">
                <label className="option-title" htmlFor="game-path">鸣潮游戏目录</label>
                <p className="option-desc">用于不启动启动器也能读取本地账号状态，请点击「选择目录」指定你本机的游戏路径</p>
              </div>
              <div className="option-control full">
                <input type="text" id="game-path" readOnly placeholder="未设置鸣潮游戏目录" value={gamePath} />
                <div className="btn-row">
                  <button type="button" id="browse-game-path" className="secondary" onClick={browseGamePath}>选择目录</button>
                  <button type="button" id="reset-game-path" className="secondary" onClick={resetGamePath}>恢复默认</button>
                </div>
              </div>
            </div>
            <div className="settings-option column">
              <div className="option-info">
                <label className="option-title" htmlFor="dataFile-path">数据文件夹</label>
                <p className="option-desc">更改后会自动重启应用</p>
              </div>
              <div className="option-control full">
                <input type="text" id="dataFile-path" readOnly value={dataFilePath} />
                <div className="btn-row">
                  <button
                    type="button" id="browse-dataFile" className="secondary"
                    disabled={dataBusy != null}
                    onClick={browseDataFile}
                  >
                    {dataBusy ? busyBtn?.label : '更换路径'}
                  </button>
                  <button
                    type="button" id="reset-dataFile" className="secondary"
                    disabled={dataBusy != null}
                    onClick={resetDataFile}
                  >
                    {dataBusy ? busyBtn?.label : '恢复默认'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 系统 */}
        <section className="setting-card">
          <div className="card-header"><h3>系统</h3></div>
          <div className="card-body">
            <div className="settings-option column">
              <div className="option-info">
                <span className="option-title">关闭程序窗口</span>
                <p className="option-desc">关闭窗口时的行为</p>
              </div>
              <div className="option-control full">
                <div className="theme-switch" id="closeActionSwitch">
                  <button type="button" className={'theme-option' + (closeAction === 'exit' ? ' active' : '')} data-action="exit" onClick={() => { setCloseAction('exit'); api().invoke('save-setting', 'closeAction', 'exit').catch((e: any) => console.error('保存关闭行为失败:', e)); }}>退出程序</button>
                  <button type="button" className={'theme-option' + (closeAction === 'tray' ? ' active' : '')} data-action="tray" onClick={() => { setCloseAction('tray'); api().invoke('save-setting', 'closeAction', 'tray').catch((e: any) => console.error('保存关闭行为失败:', e)); }}>系统托盘</button>
                </div>
              </div>
            </div>
            <div className="settings-option column">
              <div className="option-info">
                <span className="option-title">关于菲比啾比</span>
                <p className="option-desc">当前版本 <span id="currentVersion">{version}</span> · 前往 GitHub 查看项目</p>
              </div>
              <div className="option-control full">
                <div className="btn-row">
                  <button type="button" id="check-update" onClick={checkUpdate}>检查更新</button>
                  <button type="button" id="open-github" onClick={() => openExternal(GITHUB_URL)}>GitHub</button>
                  <button type="button" id="update-download" className="update-link hidden">下载更新</button>
                  <button type="button" id="update-install" className="update-link hidden">重启并安装</button>
                  <a
                    id="update-link"
                    className={'update-link' + (updateHref ? '' : ' hidden')}
                    href={updateHref || GITHUB_RELEASES_URL}
                    target="_blank"
                    rel="noopener"
                    onClick={(e) => {
                      e.preventDefault();
                      openExternal(updateHref || GITHUB_RELEASES_URL);
                    }}
                  >
                    前往下载
                  </a>
                </div>
                <p className="option-status" id="updateStatus">{updateStatus}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <ColorPickerPop
        open={pickerOpen}
        swatchRef={customSwatchRef}
        onClose={() => setPickerOpen(false)}
        onApply={(hex) => pickAccent(hex)}
      />
    </div>
  );
}