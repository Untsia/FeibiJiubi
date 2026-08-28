/**
 * 主题视觉 —— 命令式应用层（自遗留 background.js 迁移）。
 *
 * 职责：读取背景/主题设置并应用到 <body> —— 背景图与遮罩（--bg-overlay CSS 变量）、
 * 主题类双写（html/body 的 theme-light / theme-cool）、玻璃材质类、fbi_theme 缓存。
 * React（SettingsPage / App）直接调用本模块导出的函数，不再依赖 window 全局函数。
 *
 * 首帧防闪屏：由 index.html 内联同步脚本（localStorage fbi_theme → html 主题类）+
 * main.css 的 body 默认底色（var(--bg-base)）保证；本模块在 React 挂载后异步应用
 * 背景图等增强视觉，与遗留 background.js 的时序等价（它本就在脚本加载后异步 IPC）。
 */
import { brightnessToOpacity, getBaseRGB, parseBool, suspendTransitions } from './utils';

/** 背景/主题设置缓存（镜像旧 window.__appearance，供设置页初始化读取） */
export interface AppearanceSettings {
  themeMode?: string;
  colorTemp?: string;
  backgroundImage?: string | null;
  backgroundHidden?: unknown;
  backgroundBrightness?: unknown;
  glassEnabled?: unknown;
  accentColor?: string;
}

let appearanceState: AppearanceSettings | null = null;

export function getAppearance(): AppearanceSettings | null {
  return appearanceState;
}

function setAppearance(s: AppearanceSettings): void {
  appearanceState = s;
  try {
    (window as any).__appearance = s; // 兼容遗留代码对 window.__appearance 的读取
  } catch (_) {
    /* ignore */
  }
}

/** 会话内手动设定的玻璃状态（可为 null = 未手动设过，使用 DB 值） */
let glassUserSet = false;
let glassUserValue = false;
function currentGlass(): boolean {
  return glassUserSet ? glassUserValue : parseBool(appearanceState ? appearanceState.glassEnabled : false);
}

/** 开关玻璃材质：给 body 增删 glass-mode 类（半透明毛玻璃，透出背景图） */
export function applyGlassMode(enabled: boolean): void {
  glassUserSet = true;
  glassUserValue = parseBool(enabled);
  suspendTransitions();
  document.body.classList.toggle('glass-mode', glassUserValue);
}

/** 按设置整体应用视觉：主题类双写 + 背景图/遮罩 + 玻璃 + fbi_theme 缓存 */
function applyVisual(settings: AppearanceSettings): void {
  const themeMode = settings.themeMode || 'light';
  const colorTemp = settings.colorTemp || 'warm';
  const imagePath = settings.backgroundImage || '';
  const isLight = themeMode === 'light';
  const baseRGB = getBaseRGB(isLight, colorTemp);
  const hidden = parseBool(settings.backgroundHidden); // 隐藏背景图开关
  if (imagePath && !hidden) {
    const effOpacity = brightnessToOpacity(settings.backgroundBrightness);
    // 遮罩颜色承载在 CSS 变量上：亮度拖动预览只需改这个变量，
    // 不必每帧重建整串 background + url，从而避免大图重绘卡顿。
    document.documentElement.style.setProperty('--bg-overlay', 'rgba(' + baseRGB + ', ' + effOpacity + ')');
    // 背景图用 local:// 协议（同源），避免 file:// 在 local:// 页面下被 Chromium 拦截不显示
    const api = (window as any).electronAPI;
    const url = api && api.backgroundImageToURL ? api.backgroundImageToURL(imagePath) : '';
    document.body.style.background = 'linear-gradient(var(--bg-overlay), var(--bg-overlay)), url(\'' + url + '\')';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundPosition = 'center';
    document.body.classList.add('has-bg-image');
  } else {
    // 无背景图：直接用内联写死对应底色（优先级最高，保证切换即时生效）
    document.body.style.background = 'rgb(' + baseRGB + ')';
    document.body.classList.remove('has-bg-image');
  }
  // 主题类双写：<html> 供首帧 CSS，<body> 供 body.theme-light .xxx 后代选择器。
  // 同时把主题写入 localStorage 缓存，供下次启动首帧同步脚本恢复，避免闪黑屏。
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.classList.toggle('theme-cool', colorTemp === 'cool');
  document.body.classList.toggle('theme-light', isLight);
  document.body.classList.toggle('theme-cool', colorTemp === 'cool');
  document.body.classList.toggle('glass-mode', currentGlass());
  try {
    localStorage.setItem('fbi_theme', (isLight ? 'light' : 'dark') + (colorTemp === 'cool' ? '-cool' : '-warm'));
  } catch (_) {
    /* 隐私模式忽略 */
  }
}

/** 读取背景设置并整体应用（主题类/背景图/遮罩/玻璃/缓存），供启动与设置页复用 */
export async function applyAppBackground(): Promise<void> {
  const api = (window as any).electronAPI;
  if (!api || typeof api.invoke !== 'function') return;
  try {
    const settings = (await api.invoke('loadBackgroundSettings')) || {};
    setAppearance(settings);
    applyVisual(settings);
  } catch (err) {
    console.error('启动时应用背景失败:', err);
  }
}

/**
 * 同步即时应用主题视觉（class + body 背景），供主题/色温切换前瞬时调用，
 * 避免等待 IPC/DB 造成的切换延迟。mode 强制指定，imagePath 缺省回退当前缓存。
 */
export function applyThemeVisual(mode: string, imagePath?: string): void {
  suspendTransitions();
  const base = appearanceState || {};
  applyVisual({
    ...base,
    themeMode: mode,
    backgroundImage: imagePath != null && imagePath !== '' ? imagePath : base.backgroundImage || '',
  });
}

/** 亮度拖动预览专用：只更新遮罩 CSS 变量（--bg-overlay），仅触发一层 paint，保证拖动顺滑 */
export function setBackgroundOverlay(opacity: number): void {
  const isLight = document.body.classList.contains('theme-light');
  const colorTemp = (appearanceState && appearanceState.colorTemp) || 'warm';
  const baseRGB = getBaseRGB(isLight, colorTemp);
  document.documentElement.style.setProperty('--bg-overlay', 'rgba(' + baseRGB + ', ' + opacity + ')');
}
