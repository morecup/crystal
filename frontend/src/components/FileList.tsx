import React, { memo, useState } from 'react';
import { FileText, FileCode, FileImage, File, Trash2, RotateCcw } from 'lucide-react';
import { IconButton } from './ui/IconButton';
import { cn } from '../utils/cn';
import { ConfirmDialog } from './ConfirmDialog';

interface FileInfo {
  path: string;
  type: 'added' | 'deleted' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  isBinary?: boolean;
}

interface FileListProps {
  files: FileInfo[];
  onFileClick: (filePath: string, index: number) => void;
  onFileDelete?: (filePath: string) => void;
  onFileRestore?: (filePath: string) => void;
  selectedFile?: string;
}

const getFileIcon = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const iconClass = "w-4 h-4 text-text-tertiary";
  
  if (!ext) return <File className={iconClass} />;
  
  // Code files
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'php', 'rb', 'swift'].includes(ext)) {
    return <FileCode className={iconClass} />;
  }
  
  // Image files
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
    return <FileImage className={iconClass} />;
  }
  
  // Text/doc files
  if (['txt', 'md', 'mdx', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini'].includes(ext)) {
    return <FileText className={iconClass} />;
  }
  
  return <File className={iconClass} />;
};

const getTypeColor = (type: FileInfo['type']) => {
  switch (type) {
    case 'added':
      return 'text-status-success';
    case 'deleted':
      return 'text-status-error';
    case 'modified':
      return 'text-interactive';
    case 'renamed':
      return 'text-interactive';
    default:
      return 'text-text-tertiary';
  }
};

const getTypeLabel = (type: FileInfo['type']) => {
  switch (type) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'modified':
      return 'M';
    case 'renamed':
      return 'R';
    default:
      return '?';
  }
};

export const FileList: React.FC<FileListProps> = memo(({ files, onFileClick, onFileDelete, onFileRestore, selectedFile }) => {
  const [confirmState, setConfirmState] = useState<
    { open: true; type: 'restore' | 'delete'; path: string; message: string }
    | { open: false; type?: undefined; path?: undefined; message?: undefined }
  >({ open: false });
  if (files.length === 0) {
    return (
      <div className="p-4 text-center text-text-tertiary text-sm">
        No files changed
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-border-secondary bg-bg-secondary">
        <h3 className="text-sm font-semibold text-text-secondary">
          Files Changed ({files.length})
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="py-1">
          {files.map((file, index) => (
            <div
              key={`${file.path}-${index}`}
              className={cn(
                'w-full px-4 py-2 hover:bg-bg-hover transition-colors flex items-center justify-between group',
                selectedFile === file.path && 'bg-bg-accent'
              )}
            >
              <button
                onClick={() => onFileClick(file.path, index)}
                className="flex items-center gap-2 min-w-0 flex-1 text-left"
              >
                <span className={`font-mono text-xs font-bold ${getTypeColor(file.type)}`}>
                  {getTypeLabel(file.type)}
                </span>
                {getFileIcon(file.path)}
                <span className="text-sm text-text-primary truncate">
                  {file.path}
                </span>
              </button>
              
              <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                {file.additions > 0 && (
                  <span className="text-xs text-status-success">
                    +{file.additions}
                  </span>
                )}
                {file.deletions > 0 && (
                  <span className="text-xs text-status-error">
                    -{file.deletions}
                  </span>
                )}
                {onFileRestore && (
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      const action = file.type === 'added'
                        ? 'This will delete the new file'
                        : file.type === 'deleted'
                          ? 'This will restore the deleted file from HEAD'
                          : 'This will discard local modifications';
                      setConfirmState({ open: true, type: 'restore', path: file.path, message: `Rollback changes to ${file.path}?\n\n${action}.` });
                    }}
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Rollback file"
                    title="Rollback this file (discard local changes)"
                    icon={<RotateCcw className="w-4 h-4" />}
                  />
                )}
                {onFileDelete && (
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      if (file.type !== 'deleted') {
                        setConfirmState({ open: true, type: 'delete', path: file.path, message: `Are you sure you want to delete ${file.path}?` });
                      }
                    }}
                    disabled={file.type === 'deleted'}
                    variant={file.type === 'deleted' ? 'ghost' : 'danger'}
                    size="sm"
                    className={cn(
                      'opacity-0 group-hover:opacity-100 transition-opacity',
                      file.type === 'deleted' && 'cursor-not-allowed !text-text-disabled'
                    )}
                    aria-label={file.type === 'deleted' ? 'File already deleted' : 'Delete file'}
                    title={file.type === 'deleted' ? 'File already deleted' : 'Delete file'}
                    icon={<Trash2 className="w-4 h-4" />}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmState.open}
        onClose={() => setConfirmState({ open: false })}
        onConfirm={() => {
          if (!confirmState.open) return;
          if (confirmState.type === 'restore' && onFileRestore && confirmState.path) {
            onFileRestore(confirmState.path);
          } else if (confirmState.type === 'delete' && onFileDelete && confirmState.path) {
            onFileDelete(confirmState.path);
          }
          setConfirmState({ open: false });
        }}
        title={confirmState.type === 'delete' ? 'Delete File' : 'Rollback File'}
        message={confirmState.message || ''}
        confirmText={confirmState.type === 'delete' ? 'Delete' : 'Rollback'}
        cancelText="Cancel"
        confirmButtonClass={confirmState.type === 'delete' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-yellow-600 hover:bg-yellow-700 text-white'}
      />
    </div>
  );
});

FileList.displayName = 'FileList';