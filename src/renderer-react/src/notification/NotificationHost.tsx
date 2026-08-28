/**
 * 全局浮层通知 —— React 渲染层（自遗留 syncNotification.js 迁移）。
 *
 * 行为与遗留实现一致：
 *   - 浮窗挂载于 body（portal），top=55px / opacity=1 即时显示；
 *   - 3.6s 后滑出（top=-120px / opacity=0，走既有 .notification transition），
 *     再 500ms 卸载；新消息到达时先移除上一条（含未完成的滑出）。
 *   - 鼠标悬浮显示「点击以复制」提示，点击复制消息内容（成功/失败反馈）。
 *   - 挂载时订阅主进程 'notify' 广播，接入同一 showNotification 通道。
 * 样式复用 settings.css 的 .notification / .success / .fail / .overflow 与
 * main.css 的 .copy-tooltip，DOM 结构字节不变。
 */
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import {
  clearNotification,
  getNotification,
  showNotification,
  subscribeNotification,
} from './store';
import type { NotificationItem } from './store';

const SHOW_TOP = '55px';
const HIDE_TOP = '-120px';
const SHOW_MS = 3600; // 自动隐藏延迟
const EXIT_MS = 500; // 滑出动画后卸载
const TIP_MS = 100; // 悬浮/点击提示展示时长（与遗留一致）

interface Tip {
  text: string;
  x: number;
  y: number;
}

export default function NotificationHost(): JSX.Element | null {
  const [item, setItem] = useState<NotificationItem | null>(getNotification());
  const [leaving, setLeaving] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const timersRef = useRef<number[]>([]);

  const pushTimer = (fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
  };
  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  // 订阅通知流：新消息到达 → 立即替换上一条（含正在滑出的）
  useEffect(() => {
    return subscribeNotification((n) => {
      clearTimers();
      setLeaving(false);
      setTip(null);
      setItem(n);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 展示计时：3.6s 后滑出 → 500ms 后卸载
  useEffect(() => {
    if (!item) return;
    pushTimer(() => {
      setLeaving(true);
      pushTimer(() => clearNotification(), EXIT_MS);
    }, SHOW_MS);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  // 主进程 'notify' 广播（e.g. 同步完成推送），接入同一通道
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api || typeof api.on !== 'function') return;
    const onNotify = (_event: unknown, data: { success?: boolean; message?: string }) => {
      if (data && data.message != null) showNotification(!!data.success, String(data.message));
    };
    api.on('notify', onNotify);
    return () => {
      if (api && typeof api.removeListener === 'function') api.removeListener('notify', onNotify);
    };
  }, []);

  if (!item) return null;

  const style: React.CSSProperties = {
    top: leaving ? HIDE_TOP : SHOW_TOP,
    opacity: leaving ? 0 : 1,
  };
  const classes = ['notification', item.success ? 'success' : 'fail'];
  if (item.message.length > 50) classes.push('overflow');

  const showTip = (text: string, e: React.MouseEvent) => {
    setTip({ text, x: e.clientX + 10, y: e.clientY + 10 });
    pushTimer(() => setTip(null), TIP_MS);
  };
  const onCopy = (e: React.MouseEvent) => {
    navigator.clipboard
      .writeText(item.message)
      .then(() => showTip('已复制！', e))
      .catch((err) => {
        console.error('复制失败:', err);
        showTip('复制失败！！', e);
      });
  };

  return (
    <>
      {createPortal(
        <div
          className={classes.join(' ')}
          style={style}
          onMouseEnter={(e) => showTip('点击以复制', e)}
          onClick={onCopy}
        >
          {item.message}
        </div>,
        document.body,
      )}
      {/* 提示小气泡挂 body（.notification 有 overflow:hidden，放内部会被裁剪） */}
      {tip
        ? createPortal(
            <span className="copy-tooltip show" style={{ left: tip.x, top: tip.y }}>
              {tip.text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
