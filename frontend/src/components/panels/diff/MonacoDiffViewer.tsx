import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { loader } from '@monaco-editor/react';
import { AlertCircle, FileText, Check, Loader2, Eye, Code } from 'lucide-react';
import type { FileDiff } from '../../../types/diff';
import { debounce, type DebouncedFunction } from '../../../utils/debounce';
// MonacoErrorBoundary not needed with manual editor management
import { MarkdownPreview } from '../../MarkdownPreview';
import type * as monaco from 'monaco-editor';
import { useErrorStore } from '../../../stores/errorStore';
import { useConfigStore } from '../../../stores/configStore';

interface IDisposable {
  dispose(): void;
}

interface MonacoDiffViewerProps {
  file: FileDiff;
  sessionId: string;
  isDarkMode: boolean;
  viewType: 'split' | 'inline';
  onSave?: () => void;
  isReadOnly?: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'pending';

export const MonacoDiffViewer: React.FC<MonacoDiffViewerProps> = ({
  file,
  sessionId,
  isDarkMode,
  viewType,
  onSave,
  isReadOnly = false
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const [isMonacoConfigured, setIsMonacoConfigured] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState<string>(file.newValue || '');
  const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isProgrammaticUpdateRef = useRef<boolean>(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [canMountEditor, setCanMountEditor] = useState(false);
  const [isFullContentLoaded, setIsFullContentLoaded] = useState(false);
  const [editorHeight, setEditorHeight] = useState<number>(400); // Default height
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedSaveRef = useRef<DebouncedFunction<(content: string) => Promise<void>> | null>(null);
  const [viewMode, setViewMode] = useState<'diff' | 'preview' | 'split'>('diff');
  const [previewHeight, setPreviewHeight] = useState<number>(600); // Default preview height
  const previewRef = useRef<HTMLDivElement>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [configuredVsPath, setConfiguredVsPath] = useState<string | null>(null);
  // No dynamic React key for manual editor instance
  const isDisposingRef = useRef<boolean>(false);
  // Track editor focus to properly route undo/redo keystrokes
  const isEditorFocusedRef = useRef<boolean>(false);
  
  // Check if this is a markdown file
  const isMarkdownFile = useMemo(() => {
    const ext = file.path.split('.').pop()?.toLowerCase();
    return ext === 'md' || ext === 'markdown';
  }, [file.path]);

  // Debug logging
  console.log('MonacoDiffViewer - isDarkMode:', isDarkMode);
  console.log('MonacoDiffViewer - theme:', isDarkMode ? 'vs-dark' : 'vs');

  // Delay mounting editor to ensure stability (only after Monaco configured)
  useEffect(() => {
    if (!isMonacoConfigured) return;
    const timer = setTimeout(() => {
      setCanMountEditor(true);
    }, 100);
    return () => clearTimeout(timer);
  }, [isMonacoConfigured]);

  // 配置 Monaco loader 的 vs 路径（开发：/@fs；生产：打包资源）
  useEffect(() => {
    let disposed = false;
    const configure = async () => {
      try {
        const isPackaged = !!(await (window as any).electronAPI?.isPackaged?.());
        if (isPackaged) {
          const vsPath = new URL('monaco/vs/', window.location.href).toString();
          loader.config({ paths: { vs: vsPath } });
          setConfiguredVsPath(vsPath);
          console.log('Monaco loader configured for production:', vsPath);
        } else if ((window as any).electronAPI?.invoke) {
          const res = await (window as any).electronAPI.invoke('env:get-monaco-vs-path');
          if (res?.success && res.path) {
            const vsPath = `${window.location.origin}/${res.path}`;
            loader.config({ paths: { vs: vsPath } });
            setConfiguredVsPath(vsPath);
            console.log('Monaco loader configured to local dev path:', vsPath);
          } else {
            console.warn('Failed to get local monaco vs path, fallback to CDN');
          }
        }
      } catch (e) {
        console.warn('Monaco loader configuration error:', e);
      } finally {
        if (!disposed) setIsMonacoConfigured(true);
      }
    };
    configure();
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!initError) return;
    const { config } = useConfigStore.getState();
    // 默认忽略：配置未加载或为 true 时不弹窗
    if (config?.ignoreMonacoInitErrors !== false) {
      setInitError(null);
      return;
    }
    const { showError } = useErrorStore.getState();
    const details = configuredVsPath
      ? `${initError}\n\nResource path: ${configuredVsPath}`
      : initError;
    showError({
      title: 'Editor Error',
      error: 'Monaco initialization failed',
      details,
    });
    // �����ش���״̬�������ظ���Ⱦҳ�渲�ǲ�
    setInitError(null);
  }, [initError, configuredVsPath]);

  // 捕获初始化异常并提示（仅资源加载相关）
  useEffect(() => {
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const msg = (e.reason && (e.reason.message || String(e.reason))) || 'Unknown error';
      if (msg.includes('loader.js')) {
        setInitError(`Monaco 初始化失败：${msg}`);
      }
    };
    const onError = (e: ErrorEvent) => {
      const src = `${e.filename || ''}`;
      const message = e.message || '';
      if (src.includes('/vs/') || message.includes('loader.js')) {
        setInitError(`Monaco 初始化失败：${message || 'Unknown error'}`);
      }
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  // 超时保护
  useEffect(() => {
    if (!isMonacoConfigured || !canMountEditor || isEditorReady) return;
    const t = window.setTimeout(() => {
      if (!isEditorReady) setInitError('Monaco 初始化超时，可能被网络或策略阻止。');
    }, 5000);
    return () => window.clearTimeout(t);
  }, [isMonacoConfigured, canMountEditor, isEditorReady]);


  // Track when full content is loaded
  useEffect(() => {
    // Check if we have full content by looking for the originalDiffNewValue marker
    const hasFullContent = 'originalDiffNewValue' in file && file.originalDiffNewValue !== undefined && file.newValue !== file.originalDiffNewValue;
    setIsFullContentLoaded(hasFullContent);
    console.log('Full content loaded status:', hasFullContent, 'for file:', file.path);
  }, [file]);

  // Initialize Monaco DiffEditor (manual control for robust disposal)
  useEffect(() => {
    if (!canMountEditor || isEditorReady || !containerRef.current) return;
    let disposed = false;
    const init = async () => {
      try {
        const m = await loader.init();
        if (disposed || !containerRef.current) return;
        monacoRef.current = m;

        const editor = m.editor.createDiffEditor(containerRef.current, {
          readOnly: isReadOnly,
          renderSideBySide: viewType === 'split',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { bottom: 100 },
          automaticLayout: true,
          fontSize: 13,
          lineNumbers: 'on',
          renderWhitespace: 'selection',
        });
        m.editor.setTheme(isDarkMode ? 'vs-dark' : 'vs');
        editorRef.current = editor;

        // Create and set models
        const lang = getLanguage(file.path);
        const originalModel = m.editor.createModel(file.oldValue || '', lang);
        const modifiedModel = m.editor.createModel(currentContent, lang);
        originalModelRef.current = originalModel;
        modifiedModelRef.current = modifiedModel;
        editor.setModel({ original: originalModel, modified: modifiedModel });

        // Change events and save shortcut
        const disposables: IDisposable[] = [];
        const modifiedEditor = editor.getModifiedEditor();
        // Track focus state for shortcut routing
        try {
          modifiedEditor.onDidFocusEditorText?.(() => { isEditorFocusedRef.current = true; });
          modifiedEditor.onDidBlurEditorText?.(() => { isEditorFocusedRef.current = false; });
        } catch {}
        if (!isReadOnly) {
          const d = modifiedEditor.onDidChangeModelContent(() => {
            if (isDisposingRef.current || !modifiedEditor.getModel()) return;
            try {
              const newContent = modifiedEditor.getValue();
              // Only update React state when needed (avoid re-render jitter)
              if (isMarkdownFile && viewMode !== 'diff') {
                setCurrentContent(newContent);
              }
              setTimeout(() => { calculateEditorHeight(); }, 50);
              if (isProgrammaticUpdateRef.current) return;
              if (newContent !== file.newValue) {
                setSaveStatus('pending');
                setSaveError(null);
                if (isFullContentLoaded || !('originalDiffNewValue' in file)) {
                  debouncedSave(newContent);
                }
              }
            } catch {}
          });
          disposables.push({ dispose: () => d.dispose() });

          const cmd = modifiedEditor.addCommand(
            m.KeyMod.CtrlCmd | m.KeyCode.KeyS,
            () => {
              if (isDisposingRef.current || !modifiedEditor.getModel()) return;
              try {
                const content = modifiedEditor.getValue();
                debouncedSave.cancel?.();
                void performSave(content);
              } catch {}
            }
          );
          if (cmd) {
            disposables.push({ dispose: () => { /* monaco doesn't expose removeCommand */ } });
          }
        }
        (editor as unknown as { __disposables?: IDisposable[] }).__disposables = disposables;

        // Initial height
        setTimeout(() => { calculateEditorHeight(); }, 100);
        setIsEditorReady(true);
      } catch (e) {
        console.error('Failed to init Monaco DiffEditor:', e);
      }
    };
    init();
    return () => { disposed = true; };
  }, [canMountEditor, isEditorReady, isReadOnly, viewType, isDarkMode]);

  // Update content/language/theme/options when props change
  useEffect(() => {
    const m = monacoRef.current;
    const editor = editorRef.current;
    if (!m || !editor) return;
    // Update theme and options
    m.editor.setTheme(isDarkMode ? 'vs-dark' : 'vs');
    editor.updateOptions({
      readOnly: isReadOnly,
      renderSideBySide: viewType === 'split',
      scrollBeyondLastLine: false,
      padding: { bottom: 100 }
    });

    // Programmatic update of model contents with minimal disruption
    isProgrammaticUpdateRef.current = true;
    const lang = getLanguage(file.path);
    const orig = originalModelRef.current;
    const mod = modifiedModelRef.current;
    if (orig && orig.getLanguageId() !== lang) m.editor.setModelLanguage(orig, lang);
    if (mod && mod.getLanguageId() !== lang) m.editor.setModelLanguage(mod, lang);

    // Only set values when they actually differ to avoid resetting undo stack and scroll
    const currentOrig = orig?.getValue() ?? '';
    const desiredOrig = file.oldValue || '';
    if (orig && currentOrig !== desiredOrig) {
      orig.setValue(desiredOrig);
    }

    const currentMod = mod?.getValue() ?? '';
    const desiredMod = file.newValue || '';
    if (mod && currentMod !== desiredMod) {
      // Preserve view state to avoid visible scroll jumps
      const modifiedEditor = editor.getModifiedEditor();
      let viewState: monaco.editor.ICodeEditorViewState | null = null;
      try { viewState = modifiedEditor.saveViewState?.() || null; } catch { viewState = null; }
      mod.setValue(desiredMod);
      try { if (viewState) modifiedEditor.restoreViewState?.(viewState); } catch {}
    }

    // Keep current content for markdown preview only
    if (isMarkdownFile && viewMode !== 'diff') {
      setCurrentContent(file.newValue || '');
    }

    setTimeout(() => {
      isProgrammaticUpdateRef.current = false;
      if (!isDisposingRef.current) {
        calculateEditorHeight();
        try { editor.layout(); } catch {}
      }
    }, 100);
  }, [file.path, file.oldValue, file.newValue, isDarkMode, isReadOnly, viewType, isMarkdownFile, viewMode]);

  // Get file extension for language detection
  const getLanguage = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'r': 'r',
      'sql': 'sql',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'ps1': 'powershell',
      'yaml': 'yaml',
      'yml': 'yaml',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'md': 'markdown',
      'markdown': 'markdown',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
      'toml': 'toml',
      'ini': 'ini',
      'conf': 'ini',
      'env': 'ini',
    };
    return languageMap[ext || ''] || 'plaintext';
  };

  const performSave = useCallback(async (content: string) => {
    console.log('Saving file:', { file, sessionId, path: file.path, isFullContentLoaded });

    if (!file.path) {
      setSaveError('File path is missing');
      setSaveStatus('error');
      console.error('File path is undefined:', file);
      return;
    }

    // If we expect full content but don't have it yet, prevent save
    if (!isReadOnly && 'originalDiffNewValue' in file && !isFullContentLoaded) {
      setSaveError('Cannot save: Waiting for full file content to load. Please try again.');
      setSaveStatus('error');
      console.error('Prevented saving before full content is loaded');
      return;
    }

    // Safety check: if we have originalDiffNewValue, it means we tried to load full content
    // but might have failed. Check if the content we're about to save looks like just a diff hunk
    if ('originalDiffNewValue' in file && file.originalDiffNewValue !== undefined) {
      // If newValue is different from originalDiffNewValue, we successfully loaded full content
      const hasFullContent = file.newValue !== file.originalDiffNewValue;
      
      if (!hasFullContent) {
        // We're still using the diff hunk content, not the full file
        // This is dangerous - we should not save partial content
        setSaveError('Cannot save: Only partial file content is loaded. Please refresh the diff view.');
        setSaveStatus('error');
        console.error('Prevented saving partial content. Current content matches original diff hunk, not full file.');
        return;
      }
    }

    // Additional safety check: Look for diff markers that indicate partial content
    const diffMarkers = ['@@', '+++', '---', 'diff --git'];
    const contentLines = content.split('\n');
    const firstFewLines = contentLines.slice(0, 5).join('\n');
    
    // Check if content looks like a diff rather than actual file content
    if (diffMarkers.some(marker => firstFewLines.includes(marker))) {
      setSaveError('Cannot save: Content appears to be a diff, not the full file. Please refresh the diff view.');
      setSaveStatus('error');
      console.error('Prevented saving diff content as file content. Content starts with:', firstFewLines);
      return;
    }

    // Additional check: If file is supposed to be non-empty but content is suspiciously short
    if (file.type === 'modified' && content.length < 50 && file.oldValue && file.oldValue.length > content.length * 2) {
      setSaveError('Cannot save: Content appears incomplete. Please refresh the diff view.');
      setSaveStatus('error');
      console.error('Prevented saving potentially incomplete content. New length:', content.length, 'Old length:', file.oldValue?.length);
      return;
    }

    setSaveStatus('saving');
    setSaveError(null);

    // Final safety check: ensure we're saving to the correct file
    const currentFilePath = file.path;
    
    try {
      console.log('Invoking file:write with:', {
        sessionId,
        filePath: currentFilePath,
        contentLength: content.length,
        contentPreview: content.substring(0, 100)
      });
      
      const result = await window.electronAPI.invoke('file:write', {
        sessionId,
        filePath: currentFilePath,
        content
      });

      if (result.success) {
        setSaveStatus('saved');
        // Update the file's newValue to match saved content
        file.newValue = content;
        onSave?.();
        
        // Clear the saved status after 2 seconds
        if (savedTimeoutRef.current) {
          clearTimeout(savedTimeoutRef.current);
        }
        savedTimeoutRef.current = setTimeout(() => {
          setSaveStatus('idle');
        }, 2000);
      } else {
        setSaveError(result.error || 'Failed to save file');
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Error saving file:', error);
      setSaveError('Failed to save file');
      setSaveStatus('error');
    }
  }, [sessionId, file, onSave, isReadOnly, isFullContentLoaded]);

  // Create debounced save function
  const debouncedSave = useMemo(
    () => debounce(performSave, 1000),
    [performSave]
  );
  
  // Store debouncedSave in ref for cleanup
  useEffect(() => {
    debouncedSaveRef.current = debouncedSave;
  }, [debouncedSave]);

  // Calculate height based on content
  const calculateEditorHeight = useCallback(() => {
    // 固定高度，启用 Monaco 内部滚动条（鼠标滚轮在编辑器内生效）
    setEditorHeight(600);
  }, []);

  // Themes can be defined via monacoRef when needed

  // handled by manual init effect

  // Refresh content when file changes
  useEffect(() => {
    // Set flag to prevent auto-save during programmatic update
    isProgrammaticUpdateRef.current = true;

    setCurrentContent(file.newValue || '');
    setSaveStatus('idle');
    setSaveError(null);

    // 不直接操作 Monaco 值，交由 @monaco-editor/react 通过 props 同步

    // Reset flag after a small delay to ensure the change event has fired
    const timeoutId = setTimeout(() => {
      isProgrammaticUpdateRef.current = false;
      // Recalculate height after content update
      if (!isDisposingRef.current) {
        calculateEditorHeight();
      }
    }, 100);

    // Cleanup timeout on effect cleanup
    return () => clearTimeout(timeoutId);
  }, [file.path, file.newValue, isEditorReady, calculateEditorHeight]);

  // Handle readOnly prop changes dynamically
  useEffect(() => {
    if (editorRef.current && isEditorReady && !isDisposingRef.current) {
      try {
        const modifiedEditor = editorRef.current.getModifiedEditor();
        if (modifiedEditor) {
          modifiedEditor.updateOptions({ readOnly: isReadOnly });
        }
      } catch (error) {
        console.debug('Error updating editor readOnly option:', error);
      }
    }
  }, [isReadOnly, isEditorReady]);

  // Update theme when isDarkMode changes
  // useEffect(() => {
  //   if (editorRef.current && isEditorReady) {
  //     // The monaco instance from @monaco-editor/react is available via the loader
  //     import('monaco-editor').then((monacoModule) => {
  //       monacoModule.editor.setTheme(isDarkMode ? 'crystal-dark' : 'crystal-light');
  //     });
  //   }
  // }, [isDarkMode, isEditorReady]);

  // Calculate preview height when content or view mode changes
  useEffect(() => {
    if (!isMarkdownFile || viewMode === 'diff') return;

    const calculatePreviewHeight = () => {
      if (previewRef.current) {
        // Get the actual height of the preview content
        const contentHeight = previewRef.current.scrollHeight;
        // Add some padding
        const calculatedHeight = Math.max(600, contentHeight + 50);
        setPreviewHeight(calculatedHeight);
      }
    };

    // Calculate height after a delay to ensure content is rendered
    const timer = setTimeout(calculatePreviewHeight, 300);

    // Also recalculate when window resizes
    const handleResize = debounce(calculatePreviewHeight, 250);
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [currentContent, viewMode, isMarkdownFile]);

  // Also flush pending saves when switching sessions
  useEffect(() => {
    const handleSessionSwitch = () => {
      if (debouncedSaveRef.current?.flush) {
        debouncedSaveRef.current.flush(); // Save before switching sessions
      }
    };
    
    window.addEventListener('session-switched', handleSessionSwitch);
    return () => {
      window.removeEventListener('session-switched', handleSessionSwitch);
    };
  }, []); // Empty deps - only create once

  // Ensure undo/redo shortcuts are handled by Monaco when the editor is focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isEditorFocusedRef.current) return;
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
      const isRedo = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z');
      if (isUndo || isRedo) {
        e.preventDefault();
        e.stopPropagation();
        try {
          const editor = editorRef.current?.getModifiedEditor();
          if (editor) {
            editor.trigger('keyboard', isUndo ? 'undo' : 'redo', {});
          }
        } catch {}
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true } as unknown as EventListenerOptions);
  }, []);
  
  // Cleanup on unmount or when key props change
  useEffect(() => {
    return () => {
      // Set disposing flag to prevent any operations during cleanup
      isDisposingRef.current = true;

      // 在卸载前主动关闭可能打开的 Monaco 右键菜单，避免上下文服务在释放时仍被访问
      try {
        const menuEl = document.querySelector('.monaco-menu-container');
        if (menuEl) {
          const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
          window.dispatchEvent(esc);
        }
      } catch { /* ignore */ }

      // Flush any pending saves before unmount
      if (debouncedSaveRef.current?.flush) {
        try {
          debouncedSaveRef.current.flush();
        } catch (error) {
          console.debug('Error flushing debounced save:', error);
        }
      }

      // Clear timeout
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
        savedTimeoutRef.current = null;
      }

      // Proper manual disposal order to avoid Monaco race conditions
      // 1) Detach models from editor
      const editor = editorRef.current;
      if (editor) {
        try {
          (editor as any).setModel(null);
        } catch { /* ignore */ }
      }

      // 2) Dispose models
      try { originalModelRef.current?.dispose(); } catch { /* ignore */ }
      try { modifiedModelRef.current?.dispose(); } catch { /* ignore */ }
      originalModelRef.current = null;
      modifiedModelRef.current = null;

      // 3) Dispose editor last
      if (editor) {
        const e = editor as monaco.editor.IStandaloneDiffEditor & { __disposables?: IDisposable[] };
        if (e.__disposables) {
          e.__disposables.forEach((d: IDisposable) => { try { d.dispose(); } catch { /* ignore */ } });
          e.__disposables = [];
        }
        try { e.dispose(); } catch { /* ignore */ }
      }
      editorRef.current = null;

      // Reset state
      setIsEditorReady(false);
      setCanMountEditor(false);

      // Small delay before resetting disposing flag to ensure cleanup completes
      setTimeout(() => {
        isDisposingRef.current = false;
      }, 50);
    };
  }, []); // Empty deps - only cleanup on unmount

  // Options are set directly in editor.createDiffEditor and updateOptions

  const getSaveStatusIcon = () => {
    switch (saveStatus) {
      case 'saving':
        return <Loader2 className="w-3 h-3 animate-spin" />;
      case 'saved':
        return <Check className="w-3 h-3" />;
      case 'error':
        return <AlertCircle className="w-3 h-3" />;
      default:
        return null;
    }
  };

  const getSaveStatusText = () => {
    switch (saveStatus) {
      case 'saving':
        return 'Saving...';
      case 'saved':
        return 'Saved';
      case 'error':
        return saveError || 'Error';
      case 'pending':
        return 'Auto-save pending...';
      default:
        return '';
    }
  };

  const getSaveStatusColor = () => {
    switch (saveStatus) {
      case 'saving':
      case 'pending':
        return 'text-status-warning';
      case 'saved':
        return 'text-status-success';
      case 'error':
        return 'text-status-error';
      default:
        return 'text-text-tertiary';
    }
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-secondary border-b border-border-primary">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-text-tertiary" />
          <span className="text-sm font-medium text-text-primary">
            {file.path}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Preview Toggle for Markdown Files */}
          {isMarkdownFile && (
            <div className="flex items-center rounded-lg border border-border-primary bg-surface-primary">
              <button
                onClick={() => setViewMode('diff')}
                className={`px-2 py-1 text-xs font-medium rounded-l-lg transition-colors flex items-center gap-1 ${
                  viewMode === 'diff'
                    ? 'bg-interactive text-white'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
                title="Show diff view"
              >
                <Code className="w-3 h-3" />
                Diff
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`px-2 py-1 text-xs font-medium transition-colors flex items-center gap-1 ${
                  viewMode === 'split'
                    ? 'bg-interactive text-white'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
                title="Show split view"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Split
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={`px-2 py-1 text-xs font-medium rounded-r-lg transition-colors flex items-center gap-1 ${
                  viewMode === 'preview'
                    ? 'bg-interactive text-white'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
                title="Show markdown preview"
              >
                <Eye className="w-3 h-3" />
                Preview
              </button>
            </div>
          )}
          
          {/* Save Status or Read-only indicator */}
          {isReadOnly ? (
            <div className="flex items-center gap-1 text-xs text-text-tertiary">
              <AlertCircle className="w-3 h-3" />
              <span>只读 (开启"完整文件"以编辑)</span>
            </div>
          ) : saveStatus !== 'idle' && (
            <div className={`flex items-center gap-1 text-xs ${getSaveStatusColor()}`}>
              {getSaveStatusIcon()}
              <span>{getSaveStatusText()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Editor container (always mounted to avoid disposal race) */}
      <div className="relative" ref={containerRef} style={{ height: `${editorHeight}px`, overflow: 'hidden' }}>
        {(!isEditorReady || !canMountEditor) && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-primary z-10">
            <div className="flex items-center gap-2 text-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Loading editor...</span>
            </div>
          </div>
        )}
      </div>

      {/* Optional Markdown preview (below editor or in split mode rendered below to avoid remount) */}
      {isMarkdownFile && viewMode !== 'diff' && (
        <div ref={previewRef} className="relative overflow-auto" style={{ height: `${previewHeight}px` }}>
          <MarkdownPreview
            content={currentContent}
            className="h-full"
            id={`diff-preview-${sessionId}-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`}
          />
        </div>
      )}
    </div>
  );
};
