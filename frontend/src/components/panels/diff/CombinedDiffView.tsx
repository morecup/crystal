import React, { useState, useEffect, memo, useCallback, useRef, useMemo } from 'react';
import DiffViewer, { DiffViewerHandle } from './DiffViewer';
import ExecutionList from '../../ExecutionList';
import { CommitDialog } from '../../CommitDialog';
import { FileList } from '../../FileList';
import { API } from '../../../utils/api';
import type { CombinedDiffViewProps } from '../../../types/diff';
import type { ExecutionDiff, GitDiffResult } from '../../../types/diff';
import { Maximize2, Minimize2, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import DiffSettings from './DiffSettings';
import DeleteLastCommitDialog from '../../DeleteLastCommitDialog';
import { parseFilesFromDiff, validateParsedFiles } from '../../../utils/diffParser';

const HISTORY_LIMIT = 50;

const CombinedDiffView: React.FC<CombinedDiffViewProps> = memo(({ 
  sessionId, 
  selectedExecutions: initialSelected,
  isGitOperationRunning = false,
  isMainRepo = false,
  isVisible = true
}) => {
  const [executions, setExecutions] = useState<ExecutionDiff[]>([]);
  const [selectedExecutions, setSelectedExecutions] = useState<number[]>(initialSelected);
  const [lastSessionId, setLastSessionId] = useState<string>(sessionId);
  const [combinedDiff, setCombinedDiff] = useState<GitDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [mainBranch, setMainBranch] = useState<string>('main');
  const [historySource, setHistorySource] = useState<'remote' | 'local' | 'branch'>(isMainRepo ? 'remote' : 'branch');
  const [lastVisibleState, setLastVisibleState] = useState<boolean>(isVisible);
  const [forceRefresh, setForceRefresh] = useState<number>(0);
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [showDiffSettings, setShowDiffSettings] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(33); // percentage
  const [fileListHeight, setFileListHeight] = useState(33); // percentage
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [isDraggingFileList, setIsDraggingFileList] = useState(false);

  // 计算未提交变更的文件数量（来自 Git 实时状态,而非本地编辑计数）
  const uncommittedFileCount = useMemo(() => {
    const uncommitted = executions.find(e => e.id === 0);
    return uncommitted?.stats_files_changed ?? 0;
  }, [executions]);
  
  const diffViewerRef = useRef<DiffViewerHandle>(null);

  // Load git commands to get main branch
  useEffect(() => {
    const loadGitCommands = async () => {
      try {
        const response = await API.sessions.getGitCommands(sessionId);
        if (response.success && response.data) {
          const baseBranch = response.data.originBranch || response.data.mainBranch || 'main';
          setMainBranch(baseBranch);
          if (isMainRepo) {
            setHistorySource(response.data.originBranch ? 'remote' : 'local');
          }
        }
      } catch (err) {
        console.error('Failed to load git commands:', err);
      }
    };
    
    loadGitCommands();
  }, [sessionId, isMainRepo]);

  // Reset selection when session changes
  useEffect(() => {
    if (sessionId !== lastSessionId) {
      setSelectedExecutions([]);
      setLastSessionId(sessionId);
      setCombinedDiff(null);
      setExecutions([]);
      setSelectedFile(undefined);
      setHistorySource(isMainRepo ? 'remote' : 'branch');
    }
  }, [sessionId, lastSessionId, isMainRepo]);

  // Detect when tab becomes visible and force refresh
  useEffect(() => {
    if (isVisible && !lastVisibleState) {
      // Tab just became visible - force refresh to get latest git state
      console.log('Diff panel became visible, forcing refresh of git data...');
      setForceRefresh(prev => prev + 1); // Increment to trigger reload
      setCombinedDiff(null); // Clear diff data
      setSelectedExecutions([]); // Clear selection to force re-selection
    }
    setLastVisibleState(isVisible);
  }, [isVisible, lastVisibleState]);

  // Load executions for the session
  useEffect(() => {
    // Load executions when component mounts, sessionId changes, or becomes visible
    // This ensures we always have the latest git state when viewing the diff tab
    
    if (!isVisible) {
      // Don't load if not visible
      return;
    }
    
    // Add a small delay to debounce rapid updates
    const timeoutId = setTimeout(() => {
      const loadExecutions = async () => {
        try {
          setLoading(true);
          const response = await API.sessions.getExecutions(sessionId);

          if (!response.success) {
            throw new Error(response.error || 'Failed to load executions');
          }
          const data: ExecutionDiff[] = response.data || [];
          setError(null);
          setExecutions(data);

          if (data.length > 0) {
            const metadata = data.find(exec => exec.comparison_branch || exec.history_source) || data[0];
            if (metadata?.comparison_branch) {
              setMainBranch(metadata.comparison_branch);
            }
            if (metadata?.history_source) {
              setHistorySource(metadata.history_source);
            } else {
              setHistorySource(isMainRepo ? 'remote' : 'branch');
            }
          } else {
            setHistorySource(prev => {
              if (isMainRepo) {
                return prev;
              }
              return 'branch';
            });
          }
          
          // If no initial selection and session just changed, select all executions by default
          if (selectedExecutions.length === 0 && data.length > 0) {
            // 默认选中“第一个提交”（列表中的第一个非未提交项，通常为最新提交），而不是全部
            const firstCommit = data.find((exec: ExecutionDiff) => exec.id !== 0);
            if (firstCommit) {
              setSelectedExecutions([firstCommit.id]);
            } else {
              // 仅存在未提交变更时，选中未提交（id=0）
              const hasUncommitted = data.some((exec: ExecutionDiff) => exec.id === 0);
              if (hasUncommitted) setSelectedExecutions([0]);
            }
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load executions');
        } finally {
          setLoading(false);
        }
      };

      loadExecutions();
    }, 100); // Reduced to 100ms for more responsive loading

    return () => clearTimeout(timeoutId);
  }, [sessionId, isMainRepo, isVisible, forceRefresh]);

  // Load combined diff when selection changes
  useEffect(() => {
    // Only load if visible
    if (!isVisible) {
      return;
    }
    
    // Add debouncing to prevent rapid API calls
    const timeoutId = setTimeout(() => {
      const loadCombinedDiff = async () => {
        if (selectedExecutions.length === 0) {
          setCombinedDiff(null);
          return;
        }

        try {
          setLoading(true);
          setError(null);
          
          console.log('CombinedDiffView loadCombinedDiff called:', {
            sessionId,
            selectedExecutions,
            executionsLength: executions.length
          });
          
          let response;
          if (selectedExecutions.length === 1) {
            // 单个选择：未提交使用 combinedDiff；已提交使用 getExecutionDiff 直接按提交展示
            if (selectedExecutions[0] === 0) {
              console.log('Requesting uncommitted changes for session:', sessionId, 'with executionIds:', [0]);
              response = await API.sessions.getCombinedDiff(sessionId, [0]);
            } else {
              console.log('Requesting single commit via getExecutionDiff:', selectedExecutions[0]);
              const r = await API.sessions.getExecutionDiff(sessionId, String(selectedExecutions[0]));
              response = r;
            }
          } else {
            // Multiple selections - always pass executionIds to get correct range
            console.log('Requesting range of diffs:', selectedExecutions);
            response = await API.sessions.getCombinedDiff(sessionId, selectedExecutions);
          }
          
          if (!response.success) {
            throw new Error(response.error || 'Failed to load combined diff');
          }
          
          const data = response.data;
          console.log('Received diff data:', {
            hasDiff: !!data?.diff,
            diffLength: data?.diff?.length,
            stats: data?.stats,
            isUncommitted: selectedExecutions.length === 1 && selectedExecutions[0] === 0
          });
          setCombinedDiff(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load combined diff');
          setCombinedDiff(null);
        } finally {
          setLoading(false);
        }
      };

      loadCombinedDiff();
    }, 100); // Reduced to 100ms for more responsive loading

    return () => clearTimeout(timeoutId);
  }, [selectedExecutions, sessionId, executions.length, isVisible]);

  const handleSelectionChange = (newSelection: number[]) => {
    setSelectedExecutions(newSelection);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleManualRefresh = () => {
    console.log('Manual refresh triggered');
    setForceRefresh(prev => prev + 1);
    setCombinedDiff(null);
    setSelectedExecutions([]);
  };

  const handleFileSave = useCallback((filePath: string) => {
    // 参数用于满足回调签名，避免未使用告警
    void filePath;
    
    // 保存后不立即刷新 diff，避免界面闪动；面板手动刷新或切换时再更新
    // 如需更新统计，仅刷新 executions（不会重建 Diff 视图）
    (async () => {
      try {
        const response = await API.sessions.getExecutions(sessionId);
        if (response.success) setExecutions(response.data);
      } catch (err) {
        console.error('Failed to refresh executions:', err);
      }
    })();
  }, [sessionId, selectedExecutions]);

  const handleCommit = useCallback(async (message: string) => {
    console.log('Committing with message:', message);
    
    const result = await window.electronAPI.invoke('git:commit', {
      sessionId,
      message
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to commit changes');
    }
    
    // 提交成功后，由于我们基于 Git 状态实时统计，无需维护本地 modifiedFiles 集
    
    // Reload executions to reflect the new commit
    const response = await API.sessions.getExecutions(sessionId);
    if (response.success) {
      setExecutions(response.data);
    }
  }, [sessionId]);

  // 当打开提交弹窗时，刷新一次 executions，确保文件数是最新的 Git 状态
  useEffect(() => {
    if (!showCommitDialog) return;
    const refresh = async () => {
      try {
        const res = await API.sessions.getExecutions(sessionId);
        if (res.success && Array.isArray(res.data)) {
          setExecutions(res.data);
        }
      } catch {
        // 忽略刷新失败，沿用现有数据
      }
    };
    refresh();
  }, [showCommitDialog, sessionId]);

  const handleRevert = useCallback(async (commitHash: string) => {
    if (!window.confirm(`Are you sure you want to revert commit ${commitHash.substring(0, 7)}? This will create a new commit that undoes the changes.`)) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke('git:revert', {
        sessionId,
        commitHash
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to revert commit');
      }
      
      // Reload executions to reflect the new revert commit
      const response = await API.sessions.getExecutions(sessionId);
      if (response.success) {
        setExecutions(response.data);
        // Clear selection to show the new revert commit
        setSelectedExecutions([]);
      }
    } catch (err) {
      console.error('Error reverting commit:', err);
      alert(`Failed to revert commit: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [sessionId]);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [latestCommitInfo, setLatestCommitInfo] = useState<{ hash?: string; message?: string }>({});

  const handleDropLastCommit = useCallback(() => {
    const latest = executions.find(e => e.id !== 0);
    setLatestCommitInfo({ hash: latest?.after_commit_hash, message: latest?.commit_message });
    setShowDeleteDialog(true);
  }, [executions]);

  const confirmDropLastCommit = useCallback(async (mode: 'soft' | 'hard') => {
    const result = await window.electronAPI.invoke('sessions:drop-last-commit', { sessionId, mode });
    if (!result?.success) throw new Error(result?.error || 'Failed to delete last commit');
    const res = await API.sessions.getExecutions(sessionId);
    if (res.success) {
      setExecutions(res.data);
      setSelectedExecutions([]);
    }
    if (selectedExecutions.includes(0)) {
      const diffResponse = await API.sessions.getCombinedDiff(sessionId, [0]);
      if (diffResponse.success) setCombinedDiff(diffResponse.data);
    } else {
      setCombinedDiff(null);
    }
  }, [sessionId, selectedExecutions]);

  // Resizing handlers
  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
  }, []);

  const handleFileListMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingFileList(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSidebar) {
        const container = document.querySelector('.combined-diff-view');
        if (container) {
          const rect = container.getBoundingClientRect();
          const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
          setSidebarWidth(Math.min(Math.max(newWidth, 20), 60)); // 20%-60%
        }
      }
      if (isDraggingFileList) {
        const sidebar = document.querySelector('.commits-sidebar');
        if (sidebar) {
          const rect = sidebar.getBoundingClientRect();
          const newHeight = ((e.clientY - rect.top) / rect.height) * 100;
          setFileListHeight(Math.min(Math.max(newHeight, 20), 60)); // 20%-60%
        }
      }
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      setIsDraggingFileList(false);
    };

    if (isDraggingSidebar || isDraggingFileList) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isDraggingSidebar ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingSidebar, isDraggingFileList]);

  // Clear selected file when diff changes
  useEffect(() => {
    setSelectedFile(undefined);
  }, [combinedDiff]);

  const limitReached = useMemo(
    () => executions.some(exec => exec.history_limit_reached),
    [executions]
  );

  // Parse files from the diff
  const filesFromDiff = useMemo(() => {
    if (!combinedDiff) return [] as Array<{
      path: string;
      type: 'added' | 'deleted' | 'modified' | 'renamed';
      additions: number;
      deletions: number;
      isBinary?: boolean;
    }>;

    const files: Array<{
      path: string;
      type: 'added' | 'deleted' | 'modified' | 'renamed';
      additions: number;
      deletions: number;
      isBinary?: boolean;
    }> = [];

    // 优先使用健壮的 diff 解析器（兼容 CRLF、带引号路径等场景）
    if (combinedDiff.diff && combinedDiff.diff.trim().length > 0) {
      try {
        const parsed = validateParsedFiles(parseFilesFromDiff(combinedDiff.diff));
        for (const f of parsed) {
          files.push({
            path: f.path,
            type: f.type,
            additions: f.additions,
            deletions: f.deletions,
            isBinary: f.isBinary,
          });
        }
      } catch (e) {
        console.warn('Robust diff parse failed, will fallback to simple parser:', e);
        // Fallback: 保留简单解析逻辑（极端情况下）
        const fileMatches = combinedDiff.diff.match(/diff --git[\s\S]*?(?=diff --git|$)/g);
        if (fileMatches) {
          for (const fileContent of fileMatches) {
            const fileNameMatch = fileContent.match(/diff --git a\/(.*?) b\/(.*?)(?:\n|$)/);
            if (!fileNameMatch) continue;
            const oldFileName = fileNameMatch[1] || '';
            const newFileName = fileNameMatch[2] || '';
            const isBinary = fileContent.includes('Binary files') || fileContent.includes('GIT binary patch');
            let type: 'added' | 'deleted' | 'modified' | 'renamed' = 'modified';
            if (fileContent.includes('new file mode')) type = 'added';
            else if (fileContent.includes('deleted file mode')) type = 'deleted';
            else if (fileContent.includes('rename from') && fileContent.includes('rename to')) type = 'renamed';
            const additions = (fileContent.match(/^\+[^+]/gm) || []).length;
            const deletions = (fileContent.match(/^-[^-]/gm) || []).length;
            files.push({ path: newFileName || oldFileName, type, additions, deletions, isBinary });
          }
        }
      }
    }

    // 如果解析不到，但后端提供了 changedFiles，则使用 changedFiles 作为后备展示
    if (files.length === 0 && Array.isArray(combinedDiff.changedFiles) && combinedDiff.changedFiles.length > 0) {
      return combinedDiff.changedFiles.map((p) => ({
        path: p,
        type: 'modified' as const,
        additions: 0,
        deletions: 0,
        isBinary: false,
      }));
    }

    return files;
  }, [combinedDiff]);

  const handleFileClick = useCallback((filePath: string, index: number) => {
    setSelectedFile(filePath);
    diffViewerRef.current?.scrollToFile(index);
  }, []);

  const handleFileDelete = useCallback(async (filePath: string) => {
    try {
      const result = await window.electronAPI.invoke('file:delete', {
        sessionId,
        filePath
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete file');
      }
      
      // 文件删除后，依赖 Git 状态刷新，无需维护本地 modifiedFiles 集
      
      // Reload executions to reflect the deletion
      const response = await API.sessions.getExecutions(sessionId);
      if (response.success) {
        setExecutions(response.data);
      }
      
      // Reload the diff to get the current state
      if (selectedExecutions.length > 0) {
        let diffResponse;
        if (selectedExecutions.length === 1 && selectedExecutions[0] === 0) {
          // Uncommitted changes
          diffResponse = await API.sessions.getCombinedDiff(sessionId, [0]);
        } else if (selectedExecutions.length === executions.length) {
          // All diffs
          diffResponse = await API.sessions.getCombinedDiff(sessionId);
        } else {
          // Selected range
          diffResponse = await API.sessions.getCombinedDiff(sessionId, selectedExecutions);
        }
        
        if (diffResponse.success) {
          setCombinedDiff(diffResponse.data);
        }
      }
    } catch (err) {
      console.error('Error deleting file:', err);
      alert(`Failed to delete file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [sessionId, selectedExecutions, executions.length]);

  const handleRestore = useCallback(async () => {
    if (!window.confirm('Are you sure you want to restore all uncommitted changes? This will discard all your local modifications.')) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke('git:restore', {
        sessionId
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to restore changes');
      }
      
      // 还原完成后，依赖 Git 状态刷新，无需维护本地 modifiedFiles 集
      
      // Reload executions and diff
      const response = await API.sessions.getExecutions(sessionId);
      if (response.success) {
        setExecutions(response.data);
      }
      
      // Reload the uncommitted changes diff if selected
      if (selectedExecutions.includes(0)) {
        const diffResponse = await API.sessions.getCombinedDiff(sessionId, [0]);
        if (diffResponse.success) {
          setCombinedDiff(diffResponse.data);
        }
      }

      // 通知 Editor panel 文件已被restore，需要重新加载
      window.dispatchEvent(new CustomEvent('git-restore-completed', {
        detail: { sessionId }
      }));
    } catch (err) {
      console.error('Error restoring changes:', err);
      alert(`Failed to restore changes: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [sessionId, selectedExecutions]);

  if (loading && executions.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-text-secondary">Loading executions...</div>
      </div>
    );
  }

  if (error && executions.length === 0) {
    return (
      <div className="p-4 text-status-error bg-status-error/10 border border-status-error/30 rounded">
        <h3 className="font-medium mb-2">Error</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className={`combined-diff-view flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-bg-primary' : 'h-full'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border-primary bg-surface-secondary">
        <div className="flex flex-col">
          <h2 className="text-xl font-semibold text-text-primary">File Changes</h2>
          {isMainRepo && (
            <span
              className={`text-xs mt-1 ${historySource === 'local' ? 'text-status-warning' : 'text-text-tertiary'}`}
            >
              {historySource === 'remote'
                ? `Comparing to ${mainBranch}`
                : 'Origin remote not found; showing latest local commits'}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-4">
          {isGitOperationRunning && (
            <div className="flex items-center space-x-2 text-sm text-interactive">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Git operation in progress...</span>
            </div>
          )}
          {combinedDiff && (
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-status-success">+{combinedDiff.stats.additions}</span>
              <span className="text-status-error">-{combinedDiff.stats.deletions}</span>
              <span className="text-text-tertiary">{combinedDiff.stats.filesChanged} {combinedDiff.stats.filesChanged === 1 ? 'file' : 'files'}</span>
            </div>
          )}
          <button
            onClick={handleManualRefresh}
            className="p-2 rounded hover:bg-surface-hover transition-colors"
            title="Refresh git data"
            disabled={loading}
          >
            <RefreshCw className={`w-5 h-5 text-text-secondary ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowDiffSettings(true)}
            className="p-2 rounded hover:bg-surface-hover transition-colors"
            title="Diff settings"
          >
            <SettingsIcon className="w-5 h-5 text-text-secondary" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded hover:bg-surface-hover transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-5 h-5 text-text-secondary" />
            ) : (
              <Maximize2 className="w-5 h-5 text-text-secondary" />
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Commits selection sidebar */}
        {!isFullscreen && (
          <>
            <div
              className="commits-sidebar border-r border-border-primary bg-surface-secondary overflow-hidden flex flex-col"
              style={{ width: `${sidebarWidth}%` }}
            >
              {/* File list - show only when we have a diff */}
              {filesFromDiff.length > 0 && (
                <>
                  <div
                    className="border-b border-border-primary overflow-y-auto"
                    style={{ height: `${fileListHeight}%` }}
                  >
                    <FileList
                      files={filesFromDiff}
                      onFileClick={handleFileClick}
                      onFileDelete={handleFileDelete}
                      selectedFile={selectedFile}
                    />
                  </div>

                  {/* Horizontal resize handle */}
                  <div
                    className="h-1 bg-border-primary hover:bg-interactive cursor-row-resize transition-colors relative group"
                    onMouseDown={handleFileListMouseDown}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-8 h-0.5 bg-text-tertiary group-hover:bg-interactive rounded-full transition-colors" />
                    </div>
                  </div>
                </>
              )}

              {/* Execution list */}
              <div className={filesFromDiff.length > 0 ? "flex-1 overflow-hidden" : "h-full"}>
                <ExecutionList
                  sessionId={sessionId}
                  executions={executions}
                  selectedExecutions={selectedExecutions}
                  onSelectionChange={handleSelectionChange}
                  onCommit={() => setShowCommitDialog(true)}
                  onRevert={handleRevert}
                  onRestore={handleRestore}
                  onDropLastCommit={handleDropLastCommit}
                  historyLimitReached={limitReached}
                  historyLimit={HISTORY_LIMIT}
                />
              </div>
            </div>

            {/* Vertical resize handle */}
            <div
              className="w-1 bg-border-primary hover:bg-interactive cursor-col-resize transition-colors relative group"
              onMouseDown={handleSidebarMouseDown}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-0.5 bg-text-tertiary group-hover:bg-interactive rounded-full transition-colors" />
              </div>
            </div>
          </>
        )}

        {/* Diff preview */}
        <div className={`${isFullscreen ? 'w-full' : 'flex-1'} overflow-hidden bg-bg-primary min-w-0 flex flex-col`}>
          {isGitOperationRunning ? (
            <div className="flex flex-col items-center justify-center h-full p-8">
              <svg className="animate-spin h-12 w-12 text-interactive mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <div className="text-text-secondary text-center">
                <p className="font-medium">Git operation in progress</p>
                <p className="text-sm text-text-tertiary mt-1">Please wait while the operation completes...</p>
              </div>
            </div>
          ) : loading && combinedDiff === null ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-text-secondary">Loading diff...</div>
            </div>
          ) : error ? (
            <div className="p-4 text-status-error bg-status-error/10 border border-status-error/30 rounded m-4">
              <h3 className="font-medium mb-2">Error loading diff</h3>
              <p>{error}</p>
            </div>
          ) : combinedDiff ? (
            <DiffViewer
              ref={diffViewerRef}
              diff={combinedDiff.diff}
              sessionId={sessionId}
              className="h-full"
              onFileSave={handleFileSave}
              mainBranch={mainBranch}
              beforeCommitHash={combinedDiff.beforeHash}
              afterCommitHash={combinedDiff.afterHash}
            />
          ) : executions.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-secondary">
              <div className="text-center space-y-2">
                <p>
                  {isMainRepo
                    ? historySource === 'remote'
                      ? `No commits ahead of ${mainBranch}`
                      : 'Origin remote not found; showing recent local commits'
                    : 'No commits found for this session'}
                </p>
                {isMainRepo && historySource === 'remote' && (
                  <p className="text-sm text-text-tertiary">
                    Create new commits to see them here.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-text-secondary">
              Select commits to view changes
            </div>
          )}
        </div>
      </div>

      <DeleteLastCommitDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={confirmDropLastCommit}
        commitHash={latestCommitInfo.hash}
        commitMessage={latestCommitInfo.message}
      />

      {/* Commit Dialog */}
      <CommitDialog
        isOpen={showCommitDialog}
        onClose={() => setShowCommitDialog(false)}
        onCommit={handleCommit}
        // 使用 Git 实际未提交变更文件数量，避免一直显示为 0
        fileCount={uncommittedFileCount}
      />

      {/* Diff Settings */}
      <DiffSettings isOpen={showDiffSettings} onClose={() => setShowDiffSettings(false)} />
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function to prevent re-renders
  return (
    prevProps.sessionId === nextProps.sessionId &&
    prevProps.isGitOperationRunning === nextProps.isGitOperationRunning &&
    prevProps.isMainRepo === nextProps.isMainRepo &&
    prevProps.isVisible === nextProps.isVisible &&
    // Deep comparison of selectedExecutions array
    prevProps.selectedExecutions.length === nextProps.selectedExecutions.length &&
    prevProps.selectedExecutions.every((val, idx) => val === nextProps.selectedExecutions[idx])
  );
});

CombinedDiffView.displayName = 'CombinedDiffView';

export default CombinedDiffView;
