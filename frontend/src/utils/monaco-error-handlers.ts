// 全局 Monaco 错误处理：将典型的 Monaco 初始化/释放异常改为弹窗提示
// 使用全局错误存储弹出 ErrorDialog，而不是在页面内覆盖层显示
import { useErrorStore } from '../stores/errorStore';

let lastShownAt = 0;
const THROTTLE_MS = 2000;

function shouldShowNow(): boolean {
  const now = Date.now();
  if (now - lastShownAt > THROTTLE_MS) {
    lastShownAt = now;
    return true;
  }
  return false;
}

function isMonacoRelated(message: string, source?: string): boolean {
  const msg = (message || '').toLowerCase();
  const src = (source || '').toLowerCase();
  return (
    msg.includes('monaco') ||
    msg.includes('abstractcontextkeyservice has been disposed') ||
    msg.includes('diffeditorwidget') ||
    msg.includes('textmodel') ||
    src.includes('/vs/')
  );
}

export function registerMonacoGlobalErrorHandlers() {
  // 避免重复注册
  if ((window as any).__monacoHandlersRegistered) return;
  (window as any).__monacoHandlersRegistered = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    try {
      const message = e.message || '';
      if (!isMonacoRelated(message, e.filename)) return;
      if (!shouldShowNow()) return;

      // 通过全局错误存储弹出错误弹窗
      const { showError } = useErrorStore.getState();
      showError({
        title: '无法加载代码编辑器',
        error: 'Monaco 初始化失败',
        details: `${message}\n\n来源: ${e.filename || '未知'}${e.lineno ? `:${e.lineno}` : ''}`,
      });

      // 阻止默认处理（在禁用 Vite overlay 后，此处为兜底）
      e.preventDefault?.();
    } catch {
      // 忽略自身处理错误
    }
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    try {
      const reason = (e.reason && (e.reason.message || String(e.reason))) || '';
      if (!isMonacoRelated(reason)) return;
      if (!shouldShowNow()) return;

      const { showError } = useErrorStore.getState();
      showError({
        title: '无法加载代码编辑器',
        error: 'Monaco 初始化失败',
        details: reason,
      });

      e.preventDefault?.();
    } catch {
      // 忽略自身处理错误
    }
  });
}

