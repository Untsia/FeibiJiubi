/**
 * 主题视觉 —— 纯工具函数（自遗留 background.js 迁移）。
 *
 * 与底色 / 遮罩 / 布尔解析相关的纯计算，不触碰 DOM，便于单元测试。
 * 命令式应用层见 ./background.ts。
 */

/** 按主题模式 + 色温获取底色 RGB 字符串（用于背景遮罩与纯色底色） */
export function getBaseRGB(isLight: boolean, colorTemp: string): string {
  if (colorTemp === 'cool') {
    return isLight ? '244, 246, 250' : '16, 18, 24'; // 冷白浅 #F4F6FA / 冷白深 #101218
  }
  return isLight ? '250, 250, 250' : '23, 23, 24'; // 暖白浅 #FAFAFA / 暖白深 #171718
}

/** 背景亮度 → 遮罩不透明度：0 最暗(遮罩最强) → 100 最亮(遮罩最弱)；未设置默认 0.5 */
export function brightnessToOpacity(v: unknown): number {
  const n = parseFloat(String(v));
  if (isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, 1 - n / 100));
}

/** 布尔类设置解析（'true'/'1'/布尔 true 均视为 true） */
export function parseBool(v: unknown): boolean {
  return v === true || v === 'true' || v === '1';
}

/**
 * 主题切换瞬间临时关闭全局过渡：否则半透明面板（账号下拉框、状态提示框、隐藏卡池
 * 按钮等）在 background 插值中间态会「闪白」。下一帧背景稳定后再移除，
 * 避免 class 残留影响日常 hover 动画。
 */
export function suspendTransitions(): void {
  document.body.classList.add('theme-switching');
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.remove('theme-switching');
      });
    });
  } else {
    setTimeout(() => {
      document.body.classList.remove('theme-switching');
    }, 30);
  }
}
