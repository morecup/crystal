import React, { Component, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useErrorStore } from '../stores/errorStore';
import { useConfigStore } from '../stores/configStore';

interface MonacoErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface MonacoErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

export class MonacoErrorBoundary extends Component<MonacoErrorBoundaryProps, MonacoErrorBoundaryState> {
  constructor(props: MonacoErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<MonacoErrorBoundaryState> {
    // Check if this is the Monaco editor error we're trying to handle
    if (error.message?.includes('getFullModelRange') || 
        error.message?.includes('TextModel') ||
        error.message?.includes('disposed') ||
        error.message?.includes('DiffEditorWidget')) {
      console.warn('Monaco editor error caught, will recover:', error.message);
      return { hasError: true, error };
    }
    // Re-throw other errors
    throw error;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('Monaco editor error details:', { error, errorInfo });
    this.setState(prev => ({ errorCount: prev.errorCount + 1 }));

    // 弹窗提示（通过全局错误存储），而不是附着在页面上
    try {
      const { config } = useConfigStore.getState();
      // 默认忽略：仅当显式配置为 false 时才展示弹窗
      if (config?.ignoreMonacoInitErrors === false) {
        const { showError } = useErrorStore.getState();
        showError({
          title: '无法加载代码编辑器',
          error: 'Monaco 初始化失败',
          details: `${error.message}${error.stack ? '\n\n' + error.stack : ''}`,
        });
      }
    } catch {
      // 忽略弹窗流程错误
    }
    
    // Auto-recover after a short delay
    setTimeout(() => {
      this.resetError();
    }, 100);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      // Show a brief loading state while auto-recovering
      // 页面内仅显示轻量占位，真正的错误信息以弹窗展示
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="flex items-center gap-2 text-text-tertiary">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>正在恢复编辑器…</span>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
