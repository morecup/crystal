export interface ExecutionDiff {
  id: number;
  session_id: string;
  prompt_marker_id?: number;
  prompt_text?: string;
  execution_sequence: number;
  git_diff?: string;
  files_changed?: string[];
  stats_additions: number;
  stats_deletions: number;
  stats_files_changed: number;
  before_commit_hash?: string;
  after_commit_hash?: string;
  commit_message?: string;
  timestamp: string;
  author?: string;
  comparison_branch?: string;
  history_source?: 'remote' | 'local' | 'branch';
  history_limit_reached?: boolean;
}

export interface GitDiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface GitDiffResult {
  diff: string;
  stats: GitDiffStats;
  changedFiles: string[];
  beforeHash?: string;
  afterHash?: string;
}

export interface FileDiff {
  path: string;
  oldPath: string;
  oldValue: string;
  newValue: string;
  type: 'added' | 'deleted' | 'modified' | 'renamed';
  isBinary: boolean;
  additions: number;
  deletions: number;
  // 是否因体积过大而跳过渲染（软上限）
  tooLarge?: boolean;
  // 近似大小（以字符数计），用于提示信息
  approxSize?: number;
}

export interface DiffViewerProps {
  diff: string;
  className?: string;
  sessionId?: string;
  onFileSave?: (filePath: string) => void;
  mainBranch?: string;
  beforeCommitHash?: string;  // 对比基线的 commit hash
  afterCommitHash?: string;   // 当前 commit hash
}

export interface ExecutionListProps {
  sessionId: string;
  executions: ExecutionDiff[];
  selectedExecutions: number[];
  onSelectionChange: (selectedIds: number[]) => void;
  onCommit?: () => void;
  onRevert?: (commitHash: string) => void;
  onRestore?: () => void;
  onDropLastCommit?: () => void; // 删除最近一次提交（保留变更）
  historyLimitReached?: boolean;
  historyLimit?: number;
}

export interface CombinedDiffViewProps {
  sessionId: string;
  selectedExecutions: number[];
  isGitOperationRunning?: boolean;
  isMainRepo?: boolean;
  isVisible?: boolean;
}
