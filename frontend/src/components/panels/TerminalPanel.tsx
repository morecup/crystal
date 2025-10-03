import React, { useRef, useEffect, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useSession } from '../../contexts/SessionContext';
import { TerminalPanelProps } from '../../types/panelComponents';
import { renderLog, devLog } from '../../utils/console';
import '@xterm/xterm/css/xterm.css';

// Type for terminal state restoration
interface TerminalRestoreState {
  scrollbackBuffer: string | string[];
  cursorX?: number;
  cursorY?: number;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = React.memo(({ panel, isActive }) => {
  renderLog('[TerminalPanel] Component rendering, panel:', panel.id, 'isActive:', isActive);
  
  // All hooks must be called at the top level, before any conditional returns
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isActiveRef = useRef(isActive);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'copy' | 'paste' | 'commit' | 'error' } | null>(null);
  const [committing, setCommitting] = useState(false);
  
  // Get session data from context using the safe hook
  const sessionContext = useSession();
  const sessionId = sessionContext?.sessionId;
  const workingDirectory = sessionContext?.workingDirectory;
  
  if (sessionContext) {
    devLog.debug('[TerminalPanel] Session context:', sessionContext);
  } else {
    devLog.error('[TerminalPanel] No session context available');
  }

  // Keep latest active flag for non-react callbacks
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Initialize terminal only once when component first mounts
  // Keep it alive even when switching sessions
  useEffect(() => {
    devLog.debug('[TerminalPanel] Initialization useEffect running, terminalRef:', terminalRef.current);

    if (!terminalRef.current) {
      devLog.debug('[TerminalPanel] Missing terminal ref, skipping initialization');
      return;
    }

    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let disposed = false;

    const initializeTerminal = async () => {
      try {
        devLog.debug('[TerminalPanel] Starting initialization for panel:', panel.id);

        // Check if already initialized on backend
        const initialized = await window.electronAPI.invoke('panels:checkInitialized', panel.id);
        console.log('[TerminalPanel] Panel already initialized?', initialized);

        // Store terminal state for THIS panel only (not in global variable)
        let terminalStateForThisPanel: TerminalRestoreState | null = null;

        if (!initialized) {
          // Initialize backend PTY process
          console.log('[TerminalPanel] Initializing backend PTY process...');
          // Use workingDirectory and sessionId if available, but don't require them
          await window.electronAPI.invoke('panels:initialize', panel.id, {
            cwd: workingDirectory || process.cwd(),
            sessionId: sessionId || panel.sessionId
          });
          console.log('[TerminalPanel] Backend PTY process initialized');
        } else {
          // Terminal is already initialized, get its state to restore scrollback
          console.log('[TerminalPanel] Restoring terminal state from backend...');
          const terminalState = await window.electronAPI.invoke('terminal:getState', panel.id);
          if (terminalState && terminalState.scrollbackBuffer) {
            // We'll restore this to the terminal after it's created
            console.log('[TerminalPanel] Found scrollback buffer with', terminalState.scrollbackBuffer.length, 'lines');
            // Store for restoration after terminal is created - LOCAL to this initialization
            terminalStateForThisPanel = terminalState;
          }
        }

        // FIX: Check if component was unmounted during async operation
        if (disposed) return;

        // Create XTerm instance
        console.log('[TerminalPanel] Creating XTerm instance...');
        terminal = new Terminal({
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4'
          },
          scrollback: 50000
        });
        console.log('[TerminalPanel] XTerm instance created:', !!terminal);
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        console.log('[TerminalPanel] FitAddon loaded');

        // 处理 Ctrl+V 粘贴
        terminal.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
          const isCtrlV = (ev.ctrlKey || ev.metaKey) && (ev.code === 'KeyV' || (ev.key.toLowerCase() === 'v'));
          if (!isCtrlV) return true;

          if (ev.type !== 'keydown') return false;

          ev.preventDefault();
          navigator.clipboard.readText()
              .then(text => {
                if (!text) return;
                terminal?.paste(text);
              })
              .catch(() => {});
          return false;
        });

        // 添加智能右键菜单功能（有选中时复制，无选中时粘贴）
        const handleContextMenu = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          
          // 检查是否有选中的文�?
          const selection = terminal?.getSelection();
          
          if (selection && selection.length > 0) {
            // 有选中文本时，复制到剪贴板
            navigator.clipboard.writeText(selection)
              .then(() => {
                console.log('[TerminalPanel] Text copied to clipboard:', selection.substring(0, 50) + '...');
                // 显示复制成功提示
                setNotification({ message: '已复制到剪贴�?, type: 'copy' });
                setTimeout(() => setNotification(null), 2000);
                // 清除选中状�?
                terminal?.clearSelection();
              })
              .catch(err => {
                console.error('Failed to copy to clipboard:', err);
                setNotification({ message: '复制失败', type: 'copy' });
                setTimeout(() => setNotification(null), 2000);
              });
          } else {
            // 无选中文本时，从剪贴板粘贴
            navigator.clipboard.readText()
              .then(text => {
                if (text && terminal && !disposed) {
                  terminal.paste(text);
                  console.log('[TerminalPanel] Text pasted from clipboard:', text.substring(0, 50) + '...');
                  // 显示粘贴成功提示
                  setNotification({ message: '已粘�?, type: 'paste' });
                  setTimeout(() => setNotification(null), 2000);
                }
              })
              .catch(err => {
                console.error('Failed to read clipboard:', err);
                setNotification({ message: '粘贴失败', type: 'paste' });
                setTimeout(() => setNotification(null), 2000);
              });
          }
        };

        // FIX: Additional check before DOM manipulation
        if (terminalRef.current && !disposed) {
          console.log('[TerminalPanel] Opening terminal in DOM element:', terminalRef.current);
          terminal.open(terminalRef.current);
          console.log('[TerminalPanel] Terminal opened in DOM');

          // Only fit when the panel is visible and has non-zero size
          const el = terminalRef.current;
          const hasSize = el && el.offsetWidth > 0 && el.offsetHeight > 0;
          if (hasSize && isActiveRef.current && fitAddon) {
            // Fit first, then compute and send exact cols/rows
            fitAddon.fit();
            const dimensions = fitAddon.proposeDimensions();
            if (dimensions && dimensions.cols > 0 && dimensions.rows > 0) {
              window.electronAPI.invoke('terminal:resize', panel.id, dimensions.cols, dimensions.rows);
              console.log('[TerminalPanel] FitAddon fitted with', dimensions.cols, 'x', dimensions.rows);
            }
          }
          
          // 添加右键菜单事件监听�?
          terminalRef.current.addEventListener('contextmenu', handleContextMenu);
          
          xtermRef.current = terminal;
          fitAddonRef.current = fitAddon;

          // Restore scrollback if we have saved state FOR THIS PANEL
          if (terminalStateForThisPanel && terminalStateForThisPanel.scrollbackBuffer) {
            // Handle both string and array formats
            let restoredContent: string;
            if (typeof terminalStateForThisPanel.scrollbackBuffer === 'string') {
              restoredContent = terminalStateForThisPanel.scrollbackBuffer;
              console.log('[TerminalPanel] Restoring', restoredContent.length, 'chars of scrollback');
            } else if (Array.isArray(terminalStateForThisPanel.scrollbackBuffer)) {
              restoredContent = terminalStateForThisPanel.scrollbackBuffer.join('\n');
              console.log('[TerminalPanel] Restoring', terminalStateForThisPanel.scrollbackBuffer.length, 'lines of scrollback');
            } else {
              restoredContent = '';
            }

            if (restoredContent) {
              terminal.write(restoredContent);
            }
          }

          setIsInitialized(true);
          console.log('[TerminalPanel] Terminal initialization complete, isInitialized set to true');
          // Set up IPC communication for terminal I/O
          const outputHandler = (data: { panelId?: string; sessionId?: string; output?: string } | unknown) => {
            // ��������弶�ն�������� panelId��
            if (data && typeof data === 'object' && 'panelId' in data && (data as any).panelId && 'output' in data) {
              const typedData = data as { panelId: string; output: string };
              if (typedData.panelId === panel.id && terminal && !disposed) {
                terminal.write(typedData.output);
              }
            }
            // ���ԻỰ���ն����
          };

          // Set up IPC communication for terminal I/O

          const unsubscribeOutput = window.electronAPI.events.onTerminalOutput(outputHandler);
          console.log('[TerminalPanel] Subscribed to terminal output events for panel:', panel.id);

          // Handle terminal input
          const inputDisposable = terminal.onData((data) => {
            window.electronAPI.invoke('terminal:input', panel.id, data);
          });

          // Handle resize
          const resizeObserver = new ResizeObserver(() => {
            if (!fitAddon || disposed) return;
            const el2 = terminalRef.current;
            if (!el2) return;
            // Skip when not active or not visible (display: none) or zero size
            if (!isActiveRef.current || el2.offsetWidth === 0 || el2.offsetHeight === 0) return;
            // Fit first, then compute and send exact cols/rows
            fitAddon.fit();
            const dimensions = fitAddon.proposeDimensions();
            if (dimensions && dimensions.cols > 0 && dimensions.rows > 0) {
              window.electronAPI.invoke('terminal:resize', panel.id, dimensions.cols, dimensions.rows);
            }
          });
          
          resizeObserver.observe(terminalRef.current);

          // FIX: Return comprehensive cleanup function
          return () => {
            disposed = true;
            resizeObserver.disconnect();
            unsubscribeOutput();
            inputDisposable.dispose();
            // 移除右键菜单事件监听�?
            if (terminalRef.current) {
              terminalRef.current.removeEventListener('contextmenu', handleContextMenu);
            }
          };
        }
      } catch (error) {
        console.error('Failed to initialize terminal:', error);
        setInitError(error instanceof Error ? error.message : 'Unknown error');
      }
    };

    const cleanupPromise = initializeTerminal();

    // Only dispose when component is actually unmounting (panel deleted)
    // Not when just switching tabs
    return () => {
      disposed = true;
      
      // Clean up async initialization
      cleanupPromise.then(cleanupFn => cleanupFn?.());
      
      // Dispose XTerm instance only on final unmount
      if (xtermRef.current) {
        try {
          console.log('[TerminalPanel] Disposing terminal for panel:', panel.id);
          xtermRef.current.dispose();
        } catch (e) {
          console.warn('Error disposing terminal:', e);
        }
        xtermRef.current = null;
      }
      
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.dispose();
        } catch (e) {
          console.warn('Error disposing fit addon:', e);
        }
        fitAddonRef.current = null;
      }
      
      setIsInitialized(false);
    };
  }, [panel.id]); // Only depend on panel.id to prevent re-initialization on session switch

  // Handle visibility changes (resize when becoming visible)
  useEffect(() => {
    if (isActive && fitAddonRef.current && xtermRef.current && terminalRef.current) {
      console.log('[TerminalPanel] Panel became active, fitting terminal');
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        const el = terminalRef.current!;
        if (!fitAddonRef.current || el.offsetWidth === 0 || el.offsetHeight === 0) return;
        // Fit first, then compute and send exact cols/rows
        fitAddonRef.current.fit();
        const dimensions = fitAddonRef.current.proposeDimensions();
        if (dimensions && dimensions.cols > 0 && dimensions.rows > 0) {
          window.electronAPI.invoke('terminal:resize', panel.id, dimensions.cols, dimensions.rows);
        }
      }, 80);
    }
  }, [isActive, panel.id]);

  // Handle missing session context (show after all hooks have been called)
  if (!sessionContext) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Session context not available
      </div>
    );
  }

  if (initError) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Terminal initialization failed: {initError}
      </div>
    );
  }

  // Always render the terminal div to keep XTerm instance alive
  return (
    <div className="h-full w-full relative">
      {/* Smart Commit Button */}
      <div className="absolute top-2 right-2 z-50 flex items-center gap-2 opacity-0 hover:opacity-100 transition-opacity duration-200 group pointer-events-none">
        <button
          className={`pointer-events-auto px-2 py-1 text-xs rounded bg-interactive text-white hover:bg-interactive-hover ${committing ? 'opacity-70 cursor-wait' : ''}`}
          title="Smart Commit (遵循 Commit Mode)"
          disabled={!sessionId || !workingDirectory || committing}
          onClick={async () => {
            if (!sessionId) return;
            setCommitting(true);
            try {
              const res = await window.electronAPI.sessions.smartCommit(sessionId, {} as any);
              if (res.success) {
                setNotification({ message: '提交成功', type: 'commit' });
              } else {
                setNotification({ message: res.error || '提交失败', type: 'error' });
              }
            } catch (e: any) {
              setNotification({ message: e?.message || '提交失败', type: 'error' });
            } finally {
              setTimeout(() => setNotification(null), 2500);
              setCommitting(false);
            }
          }}
        >
          {committing ? '提交中�? : 'Smart Commit'}
        </button>
      </div>

      <div ref={terminalRef} className="h-full w-full" />
      {!isInitialized && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
          <div className="text-gray-400">Initializing terminal...</div>
        </div>
      )}
      {notification && (
        <div className="absolute top-10 right-2 px-3 py-1 rounded-md text-sm font-medium animate-fade-in-out"
             style={{
               backgroundColor: notification.type === 'copy' ? 'rgba(34, 197, 94, 0.9)'
                 : notification.type === 'commit' ? 'rgba(16, 185, 129, 0.9)'
                 : notification.type === 'error' ? 'rgba(239, 68, 68, 0.9)'
                 : 'rgba(59, 130, 246, 0.9)',
               color: 'white',
               zIndex: 1000
             }}>
          {notification.message}
        </div>
      )}
    </div>
  );
});

TerminalPanel.displayName = 'TerminalPanel';

export default TerminalPanel;
