import { createPortal } from 'react-dom';
import React, { useState, memo, useRef, useEffect } from 'react';
import { GitCommit, RotateCcw, RefreshCw, Trash2 } from 'lucide-react';
import type { ExecutionListProps, ExecutionDiff } from '../types/diff';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
// 中文相对时间格式化
function formatRelativeTimeZH(dateStr: string): string {
  try {
    const ts = new Date(dateStr).getTime();
    const now = Date.now();
    const diff = Math.max(0, Math.floor((now - ts) / 1000));
    if (diff < 60) return `${diff} 秒前`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} 个月前`;
    const years = Math.floor(months / 12);
    return `${years} 年前`;
  } catch {
    return '';
  }
}

// 中文绝对时间：YYYY年M月D日 HH:mm
function formatAbsoluteTimeZH(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}年${m}月${day}日 ${hh}:${mm}`;
  } catch {
    return dateStr;
  }
}

const ExecutionList: React.FC<ExecutionListProps> = memo(({
  executions,
  selectedExecutions,
  onSelectionChange,
  onCommit,
  onRevert,
  onRestore,
  onDropLastCommit,
  historyLimitReached = false,
  historyLimit
}) => {
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [hoverData, setHoverData] = useState<ExecutionDiff | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; height: number; right: number } | null>(null);
  const [containerRight, setContainerRight] = useState<number>(0);
  const listRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  // 监听窗口与列表滚动，更新容器右边界，确保悬浮卡片固定在“列表的右边”且不被遮挡
  useEffect(() => {
    const update = () => {
      const rect = listRef.current?.getBoundingClientRect();
      setContainerRight(rect ? rect.right : window.innerWidth);
    };
    update();
    window.addEventListener('resize', update);
    const el = listRef.current;
    el?.addEventListener('scroll', update, { passive: true } as AddEventListenerOptions);
    return () => {
      window.removeEventListener('resize', update);
      el?.removeEventListener('scroll', update);
    };
  }, []);
  // 悬浮卡片关闭的节流与防抖
  const cancelClose = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    hideTimerRef.current = window.setTimeout(() => {
      setHoverData(null);
      setAnchor(null);
      }, 180);
  };
  const limitDisplay = historyLimit ?? 50;

  const handleCommitClick = (executionId: number, event: React.MouseEvent) => {
    if (event.shiftKey && rangeStart !== null) {
      // Range selection with shift-click
      const start = Math.min(rangeStart, executionId);
      const end = Math.max(rangeStart, executionId);
      onSelectionChange([start, end]);
    } else {
      // Single selection
      setRangeStart(executionId);
      onSelectionChange([executionId]);
    }
  };

  const handleSelectAll = () => {
    if (executions.length > 0) {
      // Select from first to last commit (excluding uncommitted if present)
      const firstId = executions[executions.length - 1].id;
      const lastId = executions.find(e => e.id !== 0)?.id || firstId;
      onSelectionChange([firstId, lastId]);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const truncateMessage = (message: string, maxLength: number = 50) => {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  };

  const getStatsDisplay = (exec: { stats_additions: number; stats_deletions: number; stats_files_changed: number }) => {
    const { stats_additions, stats_deletions, stats_files_changed } = exec;
    if (stats_files_changed === 0) {
      return <span className="text-text-tertiary text-sm">No changes</span>;
    }
    
    return (
      <div className="text-sm space-x-3">
        <span className="text-status-success">+{stats_additions}</span>
        <span className="text-status-error">-{stats_deletions}</span>
        <span className="text-text-tertiary">{stats_files_changed} {stats_files_changed === 1 ? 'file' : 'files'}</span>
      </div>
    );
  };

  const isInRange = (executionId: number): boolean => {
    if (selectedExecutions.length === 0) return false;
    if (selectedExecutions.length === 1) return selectedExecutions[0] === executionId;
    if (selectedExecutions.length === 2) {
      const [start, end] = selectedExecutions;
      return executionId >= Math.min(start, end) && executionId <= Math.max(start, end);
    }
    return false;
  };

  if (executions.length === 0) {
    return (
      <div className="p-4 text-text-tertiary text-center">
        No commits found for this session
      </div>
    );
  }

  return (
    <div className="execution-list h-full flex flex-col">
      {/* Header */}
      <Card variant="bordered" className="rounded-b-none border-b-0">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-text-primary">
            Commits ({executions.filter(e => e.id !== 0).length})
          </h3>
          <Button
            onClick={handleSelectAll}
            size="sm"
            variant="ghost"
          >
            Select All Commits
          </Button>
        </div>
      </Card>

      {/* Instructions */}
      <div className="px-4 py-2 bg-bg-secondary text-xs text-text-tertiary border-b border-border-secondary">
        Click to select a single commit, Shift+Click to select a range
      </div>

      {/* Execution list */}
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
        {executions.map((execution) => {
          const isSelected = isInRange(execution.id);
          const isUncommitted = execution.id === 0;
          const latestNonUncommittedId = executions.find(e => e.id !== 0)?.id;
          const isLatestCommitted = !isUncommitted && execution.id === latestNonUncommittedId;
          
          return (
            <div
              key={execution.id}
              className={`
                relative flex items-center p-4 border-b border-border-secondary cursor-pointer hover:bg-bg-hover transition-colors select-none
                ${isSelected ? 'bg-bg-accent border-l-4 border-l-interactive' : ''}
                ${isUncommitted ? 'bg-status-warning/20' : ''}
              `}
              onClick={(e) => handleCommitClick(execution.id, e)}
            >
              <div className="mr-3 w-4 h-4 flex items-center justify-center">
                {isSelected && (
                  <div className="w-3 h-3 bg-interactive rounded-full" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-text-primary">
                      {isUncommitted ? (
                        <span className="text-status-warning">Uncommitted changes</span>
                      ) : (
                        <span
                          onMouseEnter={(e) => {
                            cancelClose();
                            setHoverData(execution);
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setAnchor({ top: r.top, height: r.height, right: r.right });
                            const rect = listRef.current?.getBoundingClientRect();
                            setContainerRight(rect ? rect.right : window.innerWidth);
                          }}
                          onMouseLeave={scheduleClose}
                          className="hover:underline"
                        >
                          {truncateMessage(execution.commit_message || execution.prompt_text || `Commit ${execution.execution_sequence}`)}
                        </span>
                      )}
                    </div>
                    {isUncommitted && (
                      <div className="flex items-center gap-2">
                        {onCommit && execution.stats_files_changed > 0 && (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              onCommit();
                            }}
                            size="sm"
                            variant="primary"
                            className="!bg-status-success hover:!bg-status-success-hover !text-white text-xs"
                          >
                            <GitCommit className="w-3 h-3" />
                            Commit
                          </Button>
                        )}
                        {onRestore && execution.stats_files_changed > 0 && (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRestore();
                            }}
                            size="sm"
                            variant="secondary"
                            className="!bg-status-warning hover:!bg-status-warning-hover !text-white text-xs"
                            title="Restore all uncommitted changes to their last committed state"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Restore
                          </Button>
                        )}
                      </div>
                    )}
                    {/* 删除按钮移动到右侧操作区，避免标题区域拥挤 */}
                  </div>
                  <div className="text-xs text-text-tertiary">
                    {formatTimestamp(execution.timestamp)}
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    {getStatsDisplay(execution)}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {execution.after_commit_hash && execution.after_commit_hash !== 'UNCOMMITTED' && (
                      <>
                        <div className="text-xs text-text-tertiary font-mono">
                          {execution.after_commit_hash.substring(0, 7)}
                        </div>
                        {onRevert && !isUncommitted && (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRevert(execution.after_commit_hash!);
                            }}
                            size="sm"
                            variant="danger"
                            className="text-xs"
                            title="Revert this commit"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Revert
                          </Button>
                        )}
                        {onDropLastCommit && isLatestCommitted && (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDropLastCommit();
                            }}
                            size="sm"
                            variant="danger"
                            className="text-xs"
                            title="Delete the most recent commit"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {historyLimitReached && (
          <div
            className="flex items-center p-4 border-b border-border-secondary bg-bg-secondary text-text-tertiary text-xs"
          >
            Showing the most recent {limitDisplay} commits. Older commits are hidden.
          </div>
        )}
      </div>

      {hoverData && anchor && (
        createPortal(
          <div
            style={{ position: "fixed", top: anchor.top + anchor.height / 2, left: containerRight, transform: "translateY(-50%)", zIndex: 2147483647 }}
            onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
          >
            <div className="bg-bg-tertiary border border-border-primary rounded-lg shadow-2xl px-4 py-3 max-w-[560px]">
              <div className="text-sm text-text-primary">
                <span className="font-medium">{(hoverData as any).author || "未知作者"}</span>
                <span className="mx-1">,</span>
                <span>
                  {formatRelativeTimeZH(hoverData.timestamp)}
                  {` (${formatAbsoluteTimeZH(hoverData.timestamp)})`}
                </span>
              </div>
              {hoverData.after_commit_hash && hoverData.after_commit_hash !== 'UNCOMMITTED' && (
                <div className="mt-1 text-xs text-text-tertiary font-mono">
                  提交ID: {hoverData.after_commit_hash}
                </div>
              )}
              <div className="mt-2 text-sm text-text-secondary whitespace-pre-wrap break-words">
                {hoverData.commit_message || hoverData.prompt_text || `Commit ${hoverData.execution_sequence}`}
              </div>
              <div className="mt-2 text-xs">
                <span className="text-text-tertiary">已更改 {hoverData.stats_files_changed} 个文件, </span>
                <span className="text-status-success">{hoverData.stats_additions} 个插入(+)</span>
                <span className="mx-1 text-text-tertiary">,</span>
                <span className="text-status-error">{hoverData.stats_deletions} 个删除(-)</span>
              </div>
            </div>
          </div>,
          document.body
        )
      )}
      {/* Selection summary */}
      {selectedExecutions.length > 0 && (
        <div className="p-4 bg-bg-accent border-t border-interactive">
          <div className="text-sm text-text-accent">
            {selectedExecutions.length === 1 ? (
              `1 commit selected`
            ) : selectedExecutions.length === 2 ? (
              `Range selected: ${Math.abs(selectedExecutions[1] - selectedExecutions[0]) + 1} commits`
            ) : (
              `${selectedExecutions.length} commits selected`
            )}
          </div>
        </div>
      )}
    </div>
  );
});

ExecutionList.displayName = 'ExecutionList';

export default ExecutionList;
