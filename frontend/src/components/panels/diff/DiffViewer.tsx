import { useState, useEffect, useMemo, memo, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import { MonacoDiffViewer } from './MonacoDiffViewer';
import { FileText, ChevronRight, ChevronDown } from 'lucide-react';
import type { DiffViewerProps } from '../../../types/diff';
import type { FileDiff } from '../../../types/diff';
import { useTheme } from '../../../contexts/ThemeContext';
import { useConfigStore } from '../../../stores/configStore';

// 软上限：单个文件差异超过该大小时不渲染，单位：字节（按字符串长度近似）
const DEFAULT_MAX_FILE_DIFF_BYTES = 5 * 1024 * 1024; // 5MB

// Parse unified diff format to extract individual file diffs
const parseUnifiedDiff = (diff: string, maxBytes: number): FileDiff[] => {
  const files: FileDiff[] = [];
  
  if (!diff || diff.trim().length === 0) {
    console.log('parseUnifiedDiff: Empty diff input');
    return files;
  }
  
  console.log('parseUnifiedDiff: Parsing diff of length:', diff.length);
  
  const fileMatches = diff.match(/diff --git[\s\S]*?(?=diff --git|$)/g);
  
  if (!fileMatches) {
    console.warn('parseUnifiedDiff: No file matches found in diff');
    return files;
  }
  
  console.log('parseUnifiedDiff: Found', fileMatches.length, 'file(s) in diff');
  
  for (const fileContent of fileMatches) {
    // Try multiple patterns to extract file names
    let fileNameMatch = fileContent.match(/diff --git a\/(.*?) b\/(.*?)(?:\n|$)/);
    
    // If the first pattern fails, try without the newline
    if (!fileNameMatch) {
      fileNameMatch = fileContent.match(/diff --git a\/(.*?) b\/(.*)/);
    }
    
    if (!fileNameMatch) {
      console.warn('Could not parse file names from diff:', fileContent.substring(0, 100));
      continue;
    }
    
    const oldFileName = fileNameMatch[1] || '';
    const newFileName = fileNameMatch[2] || '';
    
    const isBinary = fileContent.includes('Binary files') || fileContent.includes('GIT binary patch');
    const approxSize = fileContent.length;
    const tooLarge = approxSize > maxBytes;
    
    let type: 'added' | 'deleted' | 'modified' | 'renamed' = 'modified';
    if (fileContent.includes('new file mode')) {
      type = 'added';
    } else if (fileContent.includes('deleted file mode')) {
      type = 'deleted';
    } else if (fileContent.includes('rename from') && fileContent.includes('rename to')) {
      type = 'renamed';
    }
    
    if (isBinary) {
      files.push({
        path: newFileName || '',
        oldPath: oldFileName || '',
        oldValue: '',
        newValue: '',
        type,
        isBinary: true,
        additions: 0,
        deletions: 0,
        tooLarge: false,
        approxSize,
      });
      continue;
    }

    const lines = fileContent.split('\n');
    const diffStartIndex = lines.findIndex(line => line.startsWith('@@'));
    
    if (diffStartIndex === -1) {
      files.push({
        path: newFileName || '',
        oldPath: oldFileName || '',
        oldValue: '',
        newValue: '',
        type,
        isBinary: false,
        additions: 0,
        deletions: 0,
        tooLarge: false,
        approxSize,
      });
      continue;
    }

    const oldLines: string[] = [];
    const newLines: string[] = [];
    let additions = 0;
    let deletions = 0;

    if (tooLarge) {
      // 体积过大：仅统计增删行，避免构建大字符串，降低内存占用
      for (let i = diffStartIndex; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('@@')) {
          continue;
        } else if (line.startsWith('-')) {
          deletions++;
        } else if (line.startsWith('+')) {
          additions++;
        } else {
          // 其他行（空格、\\等）不计入
        }
      }
      const fileDiff: FileDiff = {
        path: newFileName || '',
        oldPath: oldFileName || '',
        oldValue: '',
        newValue: '',
        type,
        isBinary: false,
        additions,
        deletions,
        tooLarge: true,
        approxSize,
      };
      if (!fileDiff.path) {
        console.error('parseUnifiedDiff: File path is empty for diff:', fileContent.substring(0, 100));
      }
      files.push(fileDiff);
      continue;
    }

    for (let i = diffStartIndex; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        continue;
      } else if (line.startsWith('-')) {
        oldLines.push(line.substring(1));
        deletions++;
      } else if (line.startsWith('+')) {
        newLines.push(line.substring(1));
        additions++;
      } else if (line.startsWith(' ')) {
        oldLines.push(line.substring(1));
        newLines.push(line.substring(1));
      } else if (line.startsWith('\\')) {
        continue;
      } else if (line === '') {
        oldLines.push('');
        newLines.push('');
      }
    }

    const fileDiff: FileDiff = {
      path: newFileName || '',
      oldPath: oldFileName || '',
      oldValue: type === 'added' ? '' : oldLines.join('\n'),
      newValue: type === 'deleted' ? '' : newLines.join('\n'),
      type,
      isBinary: false,
      additions,
      deletions,
      tooLarge: false,
      approxSize,
    };
    
    if (!fileDiff.path) {
      console.error('parseUnifiedDiff: File path is empty for diff:', fileContent.substring(0, 100));
    }
    
    files.push(fileDiff);
  }
  
  console.log('parseUnifiedDiff: Parsed', files.length, 'files');
  return files;
};

export interface DiffViewerHandle {
  scrollToFile: (index: number) => void;
}

const DiffViewer = memo(forwardRef<DiffViewerHandle, DiffViewerProps>(({ diff, sessionId, className = '', onFileSave, mainBranch = 'main', beforeCommitHash, afterCommitHash }, ref) => {
  const { theme } = useTheme();
  const { config } = useConfigStore();
  const [viewType, setViewType] = useState<'split' | 'inline'>('split');
  const [showFullContent, setShowFullContent] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [filesWithFullContent, setFilesWithFullContent] = useState<FileDiff[]>([]);
  const [loadingFullContent, setLoadingFullContent] = useState(false);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedViewType = localStorage.getItem('diffViewType');
    if (savedViewType === 'split' || savedViewType === 'inline') {
      setViewType(savedViewType);
    }

    const savedShowFullContent = localStorage.getItem('diffShowFullContent');
    if (savedShowFullContent === 'true' || savedShowFullContent === 'false') {
      setShowFullContent(savedShowFullContent === 'true');
    }
  }, []);

  const handleViewTypeChange = (type: 'split' | 'inline') => {
    setViewType(type);
    localStorage.setItem('diffViewType', type);
  };

  const handleShowFullContentChange = (show: boolean) => {
    setShowFullContent(show);
    localStorage.setItem('diffShowFullContent', String(show));
  };

  const maxBytes = useMemo(() => {
    const fromConfig = config?.diffSettings?.maxFileBytes;
    if (typeof fromConfig === 'number' && fromConfig > 0) return fromConfig;
    // 兼容旧覆盖方式
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem('diff.maxFileBytes') : null;
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return DEFAULT_MAX_FILE_DIFF_BYTES;
  }, [config]);

  const parallelLimit = useMemo(() => {
    const n = config?.diffSettings?.maxParallelReads;
    if (typeof n === 'number' && n > 0) return n;
    return 3;
  }, [config]);

  const files = useMemo(() => {
    try {
      return parseUnifiedDiff(diff || '', maxBytes);
    } catch (error) {
      console.error('Error parsing diff:', error);
      return [];
    }
  }, [diff, maxBytes]);

  // 简单的并发控制器，限制批量任务并发度
  async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    let active = 0;
    return new Promise((resolve, reject) => {
      const launchNext = () => {
        if (next >= items.length && active === 0) {
          resolve(results);
          return;
        }
        while (active < limit && next < items.length) {
          const current = next++;
          active++;
          Promise.resolve(mapper(items[current], current))
            .then((res) => {
              results[current] = res;
              active--;
              launchNext();
            })
            .catch((err) => {
              reject(err);
            });
        }
      };
      launchNext();
    });
  }

  // Load full file contents when in edit mode
  useEffect(() => {
    const loadFullFileContents = async () => {
      // 只有在开启"显示完整文件"时才加载完整内容
      if (!showFullContent || !sessionId || files.length === 0) {
        setFilesWithFullContent(files);
        return;
      }

      setLoadingFullContent(true);
      setLoadErrors({}); // Clear previous errors
      console.log('Loading full file contents for complete file view...');

      try {
        const errors: Record<string, string> = {};
        const updatedFiles = await mapWithConcurrency(
          files,
          parallelLimit,
          async (file) => {
            // Skip binary files, deleted files, or files that already seem to have full content
            if (file.isBinary || file.type === 'deleted' || !file.path) {
              return file;
            }

            // 过大文件：不尝试加载完整内容，保持只读并跳过渲染（由渲染逻辑处理）
            if ((file as FileDiff).tooLarge) {
              return file;
            }

            try {
              // Load the full current file content
              const result = await window.electronAPI.invoke('file:read', {
                sessionId,
                filePath: file.path
              });

              if (result.success && result.content !== undefined) {
                console.log(`Loaded full content for ${file.path}: ${result.content.length} characters`);

                // For added files, oldValue should remain empty
                if (file.type === 'added') {
                  return {
                    ...file,
                    newValue: result.content,
                    originalDiffNewValue: file.newValue
                  };
                }

                // 确定对比基线和当前版本:
                // - 如果有 beforeCommitHash 和 afterCommitHash,使用这两个 commit 进行对比 (查看历史 commit)
                // - 否则使用 HEAD 与工作目录对比 (查看未提交变更)
                const baseRevision = beforeCommitHash || 'HEAD';
                const currentRevision = afterCommitHash; // 如果是 undefined,使用工作目录

                try {
                  // 加载基线版本
                  const baseResult = await window.electronAPI.invoke('file:readAtRevision', {
                    sessionId,
                    filePath: file.path,
                    revision: baseRevision
                  });

                  if (!baseResult.success || baseResult.content === undefined) {
                    console.warn(`Failed to load ${baseRevision} content for ${file.path}, file may not exist in ${baseRevision}`);
                    return {
                      ...file,
                      oldValue: '',  // File doesn't exist in base revision
                      newValue: result.content,       // Current working directory content
                      originalDiffNewValue: file.newValue,
                      originalDiffOldValue: file.oldValue
                    };
                  }

                  console.log(`Loaded ${baseRevision} content for ${file.path}: ${baseResult.content.length} characters`);

                  // 加载当前版本
                  let currentContent: string;
                  if (currentRevision) {
                    // 从指定 commit 读取
                    const currentResult = await window.electronAPI.invoke('file:readAtRevision', {
                      sessionId,
                      filePath: file.path,
                      revision: currentRevision
                    });

                    if (currentResult.success && currentResult.content !== undefined) {
                      currentContent = currentResult.content;
                      console.log(`Loaded ${currentRevision} content for ${file.path}: ${currentContent.length} characters`);
                    } else {
                      console.warn(`Failed to load ${currentRevision} content for ${file.path}`);
                      currentContent = result.content; // Fallback to working directory
                    }
                  } else {
                    // 使用工作目录内容
                    currentContent = result.content;
                  }

                  return {
                    ...file,
                    oldValue: baseResult.content,  // File content at base revision
                    newValue: currentContent,       // File content at current revision or working directory
                    originalDiffNewValue: file.newValue,
                    originalDiffOldValue: file.oldValue
                  };
                } catch (error) {
                  console.error(`Error loading file content for ${file.path}:`, error);
                  // Fallback
                  return {
                    ...file,
                    oldValue: '',
                    newValue: result.content,
                    originalDiffNewValue: file.newValue,
                    originalDiffOldValue: file.oldValue
                  };
                }
              } else {
                console.warn(`Failed to load full content for ${file.path}:`, result.error);
                // Check if file was deleted (ENOENT error)
                if (result.error && result.error.includes('ENOENT')) {
                  // File was deleted, mark it as deleted type
                  return {
                    ...file,
                    type: 'deleted' as const,
                    oldValue: file.oldValue || '',
                    newValue: ''
                  };
                }
                errors[file.path] = result.error || 'Failed to load file content';
                return file;
              }
            } catch (error) {
              console.error(`Error loading file ${file.path}:`, error);
              errors[file.path] = error instanceof Error ? error.message : 'Failed to load file content';
              return file;
            }
          }
        );

        setFilesWithFullContent(updatedFiles);
        setLoadErrors(errors);
      } catch (error) {
        console.error('Error loading full file contents:', error);
        setFilesWithFullContent(files);
      } finally {
        setLoadingFullContent(false);
      }
    };

    loadFullFileContents();
  }, [files, showFullContent, sessionId, mainBranch, parallelLimit, beforeCommitHash, afterCommitHash]);

  useEffect(() => {
    // Expand all files by default
    if (files.length > 0) {
      setExpandedFiles(new Set(files.map((f, i) => `${f.path}-${i}`)));
    }
  }, [files]);

  const toggleFile = (fileKey: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileKey)) {
        newSet.delete(fileKey);
      } else {
        newSet.add(fileKey);
      }
      return newSet;
    });
  };

  const handleFileSave = useCallback((filePath: string) => {
    if (onFileSave) {
      onFileSave(filePath);
    }
  }, [onFileSave]);

  // Expose scroll function to parent
  useImperativeHandle(ref, () => ({
    scrollToFile: (index: number) => {
      const fileElement = document.getElementById(`file-${index}`);
      if (fileElement && scrollContainerRef.current) {
        // First expand the file if it's collapsed
        const fileKey = `${files[index]?.path}-${index}`;
        if (fileKey && !expandedFiles.has(fileKey)) {
          setExpandedFiles(prev => new Set([...prev, fileKey]));
        }
        
        // Then scroll to it with a small delay to allow expansion animation
        setTimeout(() => {
          fileElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 3);
      }
    }
  }), [files, expandedFiles]);

  if (!diff || diff.trim() === '' || files.length === 0) {
    return (
      <div className={`p-4 text-text-secondary text-center ${className}`}>
        No changes to display
      </div>
    );
  }

  const isDarkMode = theme === 'dark';

  // Show loading state while fetching full content
  if (loadingFullContent && showFullContent) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-text-secondary">加载完整文件内容中...</div>
      </div>
    );
  }

  // Use files with full content when available
  const filesToRender = filesWithFullContent.length > 0 ? filesWithFullContent : files;

  return (
    <div className={`diff-viewer ${className}`} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-2 flex-shrink-0 bg-surface-secondary border-b border-border-primary">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-text-secondary">
              {filesToRender.length} {filesToRender.length === 1 ? 'file' : 'files'} changed
            </span>
          </div>

          <div className="flex items-center space-x-4">
            {/* Show Full Content Toggle */}
            <div className="inline-flex rounded-lg border border-border-primary bg-surface-primary">
              <button
                onClick={() => handleShowFullContentChange(false)}
                className={`px-3 py-1 text-sm font-medium rounded-l-lg transition-colors ${
                  !showFullContent
                    ? 'bg-interactive text-white'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
                title="仅显示差异片段"
              >
                仅差异
              </button>
              <button
                onClick={() => handleShowFullContentChange(true)}
                className={`px-3 py-1 text-sm font-medium rounded-r-lg transition-colors ${
                  showFullContent
                    ? 'bg-interactive text-white'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
                title="显示完整文件内容(带差异高亮)"
              >
                完整文件
              </button>
            </div>

            {/* Split/Unified Toggle */}
            <div className="inline-flex rounded-lg border border-border-primary bg-surface-primary">
              <button
                onClick={() => handleViewTypeChange('inline')}
                className={`px-3 py-1 text-sm font-medium rounded-l-lg transition-colors ${
                  viewType === 'inline'
                    ? 'bg-interactive text-white'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
              >
                Unified
              </button>
              <button
                onClick={() => handleViewTypeChange('split')}
                className={`px-3 py-1 text-sm font-medium rounded-r-lg transition-colors ${
                  viewType === 'split'
                    ? 'bg-interactive text-white'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
              >
                Split
              </button>
            </div>
          </div>
        </div>
        
        {/* File List */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto">
          {filesToRender.map((file, index) => {
            // Skip files with invalid paths
            if (!file.path) {
              console.error('File with undefined path found:', file);
          return null;
        }

        const fileKey = `${file.path}-${index}`;
        const isExpanded = expandedFiles.has(fileKey);
        const isModified = false; // Modification tracking moved to parent component
            
            if (file.isBinary || (!file.oldValue && !file.newValue && file.type !== 'added' && file.type !== 'deleted')) {
              return (
                <div key={fileKey} className="border-b border-border-primary">
                  <div className="px-4 py-3 bg-surface-secondary">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-text-primary flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {file.path}
                      </span>
                      <span className="text-xs text-text-tertiary">
                        {file.isBinary ? 'Binary file' : file.type}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }
            
            return (
              <div 
                key={fileKey} 
                id={`file-${index}`}
                data-file-path={file.path}
                className="border-b border-border-primary"
              >
                {/* File header */}
                <div 
                  className="px-4 py-3 bg-surface-secondary hover:bg-surface-hover cursor-pointer transition-colors"
                  onClick={() => toggleFile(fileKey)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-primary flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <FileText className="w-4 h-4" />
                      {file.path}
                      {isModified && (
                        <span className="text-xs bg-status-warning text-white px-2 py-0.5 rounded">Modified</span>
                      )}
                      {file.type === 'deleted' && (
                        <span className="text-xs bg-status-error text-white px-2 py-0.5 rounded">Deleted</span>
                      )}
                    </span>
                    <span className="text-xs text-text-tertiary flex items-center gap-2">
                      {file.additions > 0 && <span className="text-status-success">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="text-status-error">-{file.deletions}</span>}
                    </span>
                  </div>
                </div>

                {/* Diff content */}
                {isExpanded && (
                  <div className="border-t border-border-primary">
                    {file.type === 'deleted' ? (
                      <div className="p-4 bg-surface-secondary text-text-secondary">
                        <p className="text-sm">This file has been deleted from the filesystem.</p>
                      </div>
                    ) : file.tooLarge ? (
                      <div className="p-4 bg-surface-secondary text-text-secondary">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 5a7 7 0 00-7 7v0a7 7 0 0014 0v0a7 7 0 00-7-7z" />
                          </svg>
                          <div>
                            <p className="text-sm font-medium text-text-primary">当前文件过大，已禁用渲染（避免 OOM）</p>
                            <p className="text-xs text-text-tertiary mt-1">
                              估算大小：{((file.approxSize || 0) / (1024 * 1024)).toFixed(2)} MB（上限 { (maxBytes / (1024 * 1024)).toFixed(0) } MB）。
                            </p>
                            <ul className="list-disc list-inside mt-2 text-xs text-text-secondary space-y-1">
                              <li>已保留该文件的增删行统计，供概要查看</li>
                              <li>如需查看内容，建议用外部编辑器打开文件</li>
                              <li>可在 Diff 设置面板调整阈值与并发</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {loadErrors[file.path] && showFullContent ? (
                          <div className="p-4 bg-status-error/10 border-b border-status-error/30">
                            <div className="flex items-center gap-2 text-status-error">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="font-medium">Failed to load full file content</span>
                            </div>
                            <p className="mt-1 text-sm text-status-error/80">
                              {loadErrors[file.path]}
                            </p>
                            <p className="mt-2 text-sm text-status-error/80">
                              ⚠️ Auto-save is disabled for this file to prevent data loss. Only the diff is shown below.
                            </p>
                          </div>
                        ) : null}
                        <MonacoDiffViewer
                          key={`${file.path}-${index}-${showFullContent ? 'full' : 'diff'}`}
                          file={file}
                          sessionId={sessionId || ''}
                          isDarkMode={isDarkMode}
                          viewType={viewType}
                          onSave={() => handleFileSave(file.path)}
                          isReadOnly={!showFullContent || !!loadErrors[file.path]}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </div>
  );
}));

DiffViewer.displayName = 'DiffViewer';

export default DiffViewer;
