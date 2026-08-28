/**
 * 全局浮层通知 —— store（自遗留 syncNotification.js 迁移）。
 *
 * 数据流：showNotification(success, message) 发布 → NotificationHost 订阅渲染。
 * 主进程 'notify' 广播在 NotificationHost 挂载时订阅，接入同一通道。
 */

export interface NotificationItem {
  success: boolean;
  message: string;
  id: number;
}

let current: NotificationItem | null = null;
let seq = 0;
const listeners = new Set<(n: NotificationItem | null) => void>();

function emit(): void {
  const snapshot = current;
  listeners.forEach((fn) => fn(snapshot));
}

export function subscribeNotification(fn: (n: NotificationItem | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getNotification(): NotificationItem | null {
  return current;
}

/** 发布新浮层通知（success=true 成功样式 / false 失败样式） */
export function showNotification(success: boolean, message: string): void {
  current = { success: !!success, message: String(message), id: ++seq };
  emit();
}

/** 移除当前浮层（自动消失流程结束时调用） */
export function clearNotification(): void {
  if (current) {
    current = null;
    emit();
  }
}
