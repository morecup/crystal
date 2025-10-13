import { EventEmitter } from 'events';
import { watch, FSWatcher, existsSync } from 'fs';
import { join, relative, isAbsolute } from 'path';
import { execSync, ExtendedExecSyncOptions } from '../utils/commandExecutor';
import type { Logger } from '../utils/logger';

interface WatchedSession {
  sessionId: string;
  worktreePath: string;
  watcher?: FSWatcher;
  lastModified: number;
  pendingRefresh: boolean;
}

/**
 * Smart file watcher that detects when git status actually needs refreshing
 * 
 * Key optimizations:
 * 1. Uses native fs.watch for efficient file monitoring
 * 2. Filters out events that don't affect git status
 * 3. Batches rapid file changes
 * 4. Uses git update-index to quickly check if index is dirty
 */
export class GitFileWatcher extends EventEmitter {
  private watchedSessions: Map<string, WatchedSession> = new Map();
  private refreshDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private readonly DEBOUNCE_MS = 1500; // 1.5 second debounce for file changes
  private readonly BASE_BACKOFF_MS = 1000;
  private readonly MAX_BACKOFF_MS = 30000;
  private readonly IGNORE_PATTERNS = [
    '.git/',
    'node_modules/',
    '.DS_Store',
    'thumbs.db',
    '*.swp',
    '*.swo',
    '*~',
    '.#*',
    '#*#'
  ];

  constructor(private logger?: Logger) {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Start watching a session's worktree for changes
   */
  startWatching(sessionId: string, worktreePath: string): void {
    // Stop existing watcher if any
    this.stopWatching(sessionId);

    this.logger?.info(`[GitFileWatcher] Starting watch for session ${sessionId} at ${worktreePath}`);

    try {
      // Create a watcher for the worktree directory
      const watcher = watch(worktreePath, { recursive: true }, (eventType, filename) => {
        if (filename) {
          this.handleFileChange(sessionId, filename, eventType);
        }
      });

      this.watchedSessions.set(sessionId, {
        sessionId,
        worktreePath,
        watcher,
        lastModified: Date.now(),
        pendingRefresh: false
      });
    } catch (error) {
      this.logger?.error(`[GitFileWatcher] Failed to start watching session ${sessionId}:`, error as Error);
    }
  }

  /**
   * Stop watching a session's worktree
   */
  stopWatching(sessionId: string): void {
    const session = this.watchedSessions.get(sessionId);
    if (session) {
      session.watcher?.close();
      this.watchedSessions.delete(sessionId);
      
      // Clear any pending refresh timer
      const timer = this.refreshDebounceTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.refreshDebounceTimers.delete(sessionId);
      }
      
      this.logger?.info(`[GitFileWatcher] Stopped watching session ${sessionId}`);
    }
  }

  /**
   * Stop all watchers
   */
  stopAll(): void {
    for (const sessionId of this.watchedSessions.keys()) {
      this.stopWatching(sessionId);
    }
  }

  /**
   * Handle a file change event
   */
  private handleFileChange(sessionId: string, filename: string, eventType: string): void {
    // Ignore changes to files that don't affect git status
    if (this.shouldIgnoreFile(filename)) {
      return;
    }

    const session = this.watchedSessions.get(sessionId);
    if (!session) return;

    // Update last modified time
    session.lastModified = Date.now();
    session.pendingRefresh = true;

    // Debounce the refresh to batch rapid changes
    this.scheduleRefreshCheck(sessionId);
  }

  /**
   * Check if a file should be ignored
   */
  private shouldIgnoreFile(filename: string): boolean {
    // Check against ignore patterns
    for (const pattern of this.IGNORE_PATTERNS) {
      if (pattern.endsWith('/')) {
        // Directory pattern
        if (filename.startsWith(pattern) || filename.includes('/' + pattern)) {
          return true;
        }
      } else if (pattern.startsWith('*.')) {
        // Extension pattern
        const ext = pattern.slice(1);
        if (filename.endsWith(ext)) {
          return true;
        }
      } else if (pattern.startsWith('.#') || pattern.startsWith('#')) {
        // Editor temp file patterns
        const basename = filename.split('/').pop() || '';
        if (basename.startsWith('.#') || (basename.startsWith('#') && basename.endsWith('#'))) {
          return true;
        }
      } else if (pattern.endsWith('~')) {
        // Backup file pattern
        if (filename.endsWith('~')) {
          return true;
        }
      } else {
        // Exact match
        if (filename === pattern || filename.endsWith('/' + pattern)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Schedule a refresh check for a session
   */
  private scheduleRefreshCheck(sessionId: string): void {
    this.scheduleRefreshCheckWithDelay(sessionId, this.DEBOUNCE_MS);
  }

  private scheduleRefreshCheckWithDelay(sessionId: string, delayMs: number): void {
    const existingTimer = this.refreshDebounceTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.refreshDebounceTimers.delete(sessionId);
      this.performRefreshCheck(sessionId);
    }, delayMs);
    this.refreshDebounceTimers.set(sessionId, timer);
  }

  private getBackoffDelay(sessionId: string): number {
    const count = (this.errorCounts.get(sessionId) ?? 0) + 1;
    this.errorCounts.set(sessionId, count);
    const delay = Math.min(this.BASE_BACKOFF_MS * Math.pow(2, count - 1), this.MAX_BACKOFF_MS);
    return delay;
  }

  private resetBackoff(sessionId: string): void {
    this.errorCounts.delete(sessionId);
  }

  /**
   * Perform the actual refresh check using git plumbing commands
   */
  private performRefreshCheck(sessionId: string): void {
    const session = this.watchedSessions.get(sessionId);
    if (!session || !session.pendingRefresh) {
      return;
    }

    session.pendingRefresh = false;

    try {
      const needsRefresh = this.checkIfRefreshNeeded(session.worktreePath);
      if (needsRefresh === undefined) {
        const delay = this.getBackoffDelay(sessionId);
        this.logger?.warn(`[GitFileWatcher] Refresh check skipped due to transient git state; retrying in ${delay}ms`);
        session.pendingRefresh = true;
        this.scheduleRefreshCheckWithDelay(sessionId, delay);
        return;
      }
      this.resetBackoff(sessionId);
      
      if (needsRefresh) {
        this.logger?.info(`[GitFileWatcher] Session ${sessionId} needs refresh`);
        this.emit('needs-refresh', sessionId);
      } else {
        this.logger?.info(`[GitFileWatcher] Session ${sessionId} no refresh needed`);
      }
    } catch (error) {
      const delay = this.getBackoffDelay(sessionId);
      this.logger?.warn(`[GitFileWatcher] Transient error during refresh check for session ${sessionId}; retrying in ${delay}ms`, error as Error);
      session.pendingRefresh = true;
      this.scheduleRefreshCheckWithDelay(sessionId, delay);
    }
  }

  /**
   * Quick check if git status needs refreshing
   * Returns true if there are changes, false if working tree is clean
   */
  private checkIfRefreshNeeded(worktreePath: string): boolean | undefined {
    try {
      // Verify we are inside a git worktree
      try {
        const inside = execSync('git rev-parse --is-inside-work-tree', { cwd: worktreePath, encoding: 'utf8', silent: true })
          .toString()
          .trim();
        if (inside !== 'true') {
          return undefined;
        }
      } catch {
        return undefined;
      }

      // Check for index.lock to avoid interfering with ongoing git ops
      try {
        const gitDirRaw = execSync('git rev-parse --git-dir', { cwd: worktreePath, encoding: 'utf8', silent: true })
          .toString()
          .trim();
        const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : join(worktreePath, gitDirRaw);
        const lockPath = join(gitDir, 'index.lock');
        if (existsSync(lockPath)) {
          return undefined;
        }
      } catch {
        // If we can't resolve git dir, skip and retry later
        return undefined;
      }

      // Refresh the index quickly
      try {
        execSync('git update-index --refresh --ignore-submodules', { cwd: worktreePath, encoding: 'utf8', silent: true });
      } catch {
        // Treat failures here as transient; retry later
        return undefined;
      }

      // Check for unstaged changes (modified files)
      try {
        execSync('git diff-files --quiet --ignore-submodules', { cwd: worktreePath, encoding: 'utf8', silent: true });
      } catch {
        // Non-zero exit means there are unstaged changes
        return true;
      }

      // Check for staged changes
      try {
        execSync('git diff-index --cached --quiet HEAD --ignore-submodules', { cwd: worktreePath, encoding: 'utf8', silent: true });
      } catch {
        // Non-zero exit means there are staged changes
        return true;
      }
      
      // Check for untracked files
      const untrackedOutput = execSync('git ls-files --others --exclude-standard', { cwd: worktreePath })
        .toString()
        .trim();
      
      if (untrackedOutput) {
        return true;
      }
      
      // Working tree is clean
      return false;
    } catch (error) {
      // Treat unexpected errors as transient
      this.logger?.warn('[GitFileWatcher] Transient error in checkIfRefreshNeeded; will retry', error as Error);
      return undefined;
    }
  }

  /**
   * Get statistics about watched sessions
   */
  getStats(): { totalWatched: number; sessionsNeedingRefresh: number } {
    let sessionsNeedingRefresh = 0;
    for (const session of this.watchedSessions.values()) {
      if (session.pendingRefresh) {
        sessionsNeedingRefresh++;
      }
    }
    
    return {
      totalWatched: this.watchedSessions.size,
      sessionsNeedingRefresh
    };
  }
}