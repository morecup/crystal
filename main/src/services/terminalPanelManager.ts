import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { ToolPanel, TerminalPanelState, PanelEventType } from '../../../shared/types/panels';
import { panelManager } from './panelManager';
import { mainWindow } from '../index';
import * as os from 'os';
import * as path from 'path';
import { existsSync } from 'fs';
import { getShellPath } from '../utils/shellPath';
import { buildSpawnEnv } from '../utils/envUtils';
import { ShellDetector } from '../utils/shellDetector';
import { execFileSync } from 'child_process';
import { execSync as execSyncCE } from '../utils/commandExecutor';
import { databaseService } from './database';

interface TerminalProcess {
  pty: pty.IPty;
  panelId: string;
  sessionId: string;
  scrollbackBuffer: string;
  commandHistory: string[];
  currentCommand: string;
  lastActivity: Date;
}

export class TerminalPanelManager {
  private terminals = new Map<string, TerminalProcess>();
  private readonly MAX_SCROLLBACK_LINES = 10000;
  
  private sanitizeName(input: string): string {
    // 仅保留字母/数字/下划线/点/减号，其它替换为减号，并去除首尾多余减号
    const s = input.replace(/[^\w.-]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    return s;
  }
  
  private toWslPath(winPath: string): string {
    const m = winPath.match(/^([A-Za-z]):\\(.*)$/);
    if (m) {
      const drive = m[1].toLowerCase();
      const rest = m[2].replace(/\\/g, '/');
      return `/mnt/${drive}/${rest}`;
    }
    return winPath.replace(/\\/g, '/');
  }
  
  private bashSingleQuote(s: string): string {
    // 将任意字符串安全包裹为 bash 单引号序列
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
  
  async initializeTerminal(panel: ToolPanel, cwd: string): Promise<void> {
    if (this.terminals.has(panel.id)) {
      return;
    }
    
    
    // 根据面板类型选择默认/WSL shell
    const useWsl = panel.type === 'wsl' || panel.type === 'tmux';
    const shellInfo = useWsl ? ShellDetector.getWSLShell() : ShellDetector.getDefaultShell();
    console.log(`[TerminalPanelManager] Using shell ${shellInfo.path} (${shellInfo.name}) for panel type ${panel.type}`);

    const isLinux = process.platform === 'linux';
    const enhancedPath = isLinux ? (process.env.PATH || '') : getShellPath();
    
    // Create PTY process with enhanced environment
    const env = buildSpawnEnv(process.env, {
      PATH: enhancedPath,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
      WORKTREE_PATH: cwd,
      CRYSTAL_SESSION_ID: panel.sessionId,
      CRYSTAL_PANEL_ID: panel.id,
      CRYSTAL_PANEL_TITLE: panel.title
    });

    // Windows 平台：优先使用 ConPTY；若缺少二进制(conpty.node)或显式禁用，则回退 winpty
    let hasConptyBinary = false;
    if (process.platform === 'win32') {
      try {
        const nodePtyPkg = require.resolve('@homebridge/node-pty-prebuilt-multiarch/package.json');
        const nodePtyRoot = path.dirname(nodePtyPkg);
        const conptyPath = path.join(nodePtyRoot, 'build', 'Release', 'conpty.node');
        hasConptyBinary = existsSync(conptyPath);
      } catch {}
    }
    const preferConpty = process.platform === 'win32' && (process.env.CRYSTAL_USE_CONPTY !== '0') && hasConptyBinary;

    // 针对 tmux 面板：在 Windows 下通过 wsl.exe 直接执行 tmux 命令（不依赖脚本）
    let spawnArgs: string[] | undefined = shellInfo.args || [];
    if (panel.type === 'tmux' && process.platform === 'win32' && shellInfo.name === 'wsl') {
      // 不在初始化时做任何清理，改为在会话归档/删除时精准清理
      // 优先使用“项目创建时的名称”，而不是目录名
      let projectName = path.basename(cwd);
      try {
        const sessionRow = databaseService.getSession(panel.sessionId as string);
        if (sessionRow?.project_id) {
          const projectRow = databaseService.getProject(sessionRow.project_id);
          if (projectRow?.name) projectName = projectRow.name;
        }
      } catch {}
      const project = this.sanitizeName(projectName);
      const branch = this.sanitizeName((require('./gitPlumbingCommands') as typeof import('./gitPlumbingCommands')).getCurrentBranch(cwd) || 'detached');
      const base = this.sanitizeName(panel.title);
      const sessionName = `${project}_${branch}_${base}`;
      const wslRepo = this.toWslPath(cwd);
      const qName = this.bashSingleQuote(sessionName);
      const qRepo = this.bashSingleQuote(wslRepo);
      // 仅为当前会话启用 tmux 鼠标模式并配置鼠标拖动选择后自动复制
      // - set-option (without -g): 仅影响当前会话,不修改全局配置
      // - mouse on: 启用鼠标支持
      // - 鼠标拖动进入 copy-mode 并选择文本
      // - 释放鼠标时自动复制到系统剪贴板(使用 xargs 防止空内容清空剪贴板)
      const bashCmd = `tmux new-session -As ${qName} -c ${qRepo} \\; \\
        set-option mouse on \\; \\
        bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "xargs -0 -I {} clip.exe <<<{}" \\; \\
        bind-key -T copy-mode MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "xargs -0 -I {} clip.exe <<<{}"`;
      spawnArgs = ['-e', 'bash', '-lc', bashCmd];
      console.log('[TerminalPanelManager] Spawning WSL tmux session with session-specific mouse copy support');
    }

    const ptyProcess = pty.spawn(shellInfo.path, spawnArgs || [], {
      name: 'xterm-color',
      useConpty: preferConpty,
      cols: 80,
      rows: 30,
      cwd: cwd,
      env
    });
    
    // Create terminal process object
    const terminalProcess: TerminalProcess = {
      pty: ptyProcess,
      panelId: panel.id,
      sessionId: panel.sessionId,
      scrollbackBuffer: '',
      commandHistory: [],
      currentCommand: '',
      lastActivity: new Date()
    };
    
    // Store in map
    this.terminals.set(panel.id, terminalProcess);
    
    // Set up event handlers
    this.setupTerminalHandlers(terminalProcess);
    
    // Update panel state
    const state = panel.state;
    state.customState = {
      ...state.customState,
      isInitialized: true,
      cwd: cwd,
      shellType: shellInfo.name || path.basename(shellInfo.path),
      dimensions: { cols: 80, rows: 30 },
      // 对于 tmux 面板，记录当前 tmux 会话名称，便于后台改名
      tmuxSessionId: (panel.type === 'tmux' && process.platform === 'win32' && shellInfo.name === 'wsl')
        ? (() => {
            const projectName = this.sanitizeName(path.basename(cwd));
            try {
              const sessionRow = require('./database').databaseService.getSession(panel.sessionId as string);
              if (sessionRow?.project_id) {
                const projectRow = require('./database').databaseService.getProject(sessionRow.project_id);
                if (projectRow?.name) {
                  // 若项目名可用，则替换为项目名（非目录名）
                  const branch = this.sanitizeName((require('./gitPlumbingCommands') as typeof import('./gitPlumbingCommands')).getCurrentBranch(cwd) || 'detached');
                  const base = this.sanitizeName(panel.title);
                  return `${this.sanitizeName(projectRow.name)}_${branch}_${base}`;
                }
              }
            } catch {}
            const branch = this.sanitizeName((require('./gitPlumbingCommands') as typeof import('./gitPlumbingCommands')).getCurrentBranch(cwd) || 'detached');
            const base = this.sanitizeName(panel.title);
            return `${projectName}_${branch}_${base}`;
          })()
        : (state.customState as any)?.tmuxSessionId
    } as TerminalPanelState;
    
    await panelManager.updatePanel(panel.id, { state });
    
  }
  
  private setupTerminalHandlers(terminal: TerminalProcess): void {
    // Handle terminal output
    terminal.pty.onData((data: string) => {
      // Update last activity
      terminal.lastActivity = new Date();
      
      // Add to scrollback buffer
      this.addToScrollback(terminal, data);
      
      // Detect commands (simple heuristic - look for carriage returns)
      if (data.includes('\r') || data.includes('\n')) {
        if (terminal.currentCommand.trim()) {
          terminal.commandHistory.push(terminal.currentCommand);
          
          // Emit command executed event
          panelManager.emitPanelEvent(
            terminal.panelId,
            'terminal:command_executed',
            {
              command: terminal.currentCommand,
              timestamp: new Date().toISOString()
            }
          );
          
          // Check for file operation commands
          if (this.isFileOperationCommand(terminal.currentCommand)) {
            panelManager.emitPanelEvent(
              terminal.panelId,
              'files:changed',
              {
                command: terminal.currentCommand,
                timestamp: new Date().toISOString()
              }
            );
          }
          
          terminal.currentCommand = '';
        }
      } else {
        // Accumulate command input
        terminal.currentCommand += data;
      }
      
      // Send output to frontend
      if (mainWindow) {
        mainWindow.webContents.send('terminal:output', {
          sessionId: terminal.sessionId,
          panelId: terminal.panelId,
          output: data
        });
      }
    });
    
    // Handle terminal exit
    terminal.pty.onExit((exitCode: { exitCode: number; signal?: number }) => {
      // Emit exit event
      panelManager.emitPanelEvent(
        terminal.panelId,
        'terminal:exit',
        {
          exitCode: exitCode.exitCode,
          signal: exitCode.signal,
          timestamp: new Date().toISOString()
        }
      );
      
      // Clean up
      this.terminals.delete(terminal.panelId);
      
      // Notify frontend
      if (mainWindow) {
        mainWindow.webContents.send('terminal:exited', {
          sessionId: terminal.sessionId,
          panelId: terminal.panelId,
          exitCode: exitCode.exitCode
        });
      }
    });
  }
  
  private addToScrollback(terminal: TerminalProcess, data: string): void {
    // Add raw data to scrollback buffer
    terminal.scrollbackBuffer += data;
    
    // Trim buffer if it exceeds max size (keep last ~500KB of data)
    const maxBufferSize = 500000; // 500KB
    if (terminal.scrollbackBuffer.length > maxBufferSize) {
      // Keep the most recent data
      terminal.scrollbackBuffer = terminal.scrollbackBuffer.slice(-maxBufferSize);
    }
  }

  /**
   * 后台重命名指定 tmux 面板所对应的 tmux 会话，不通过向终端写入命令。
   * @param panelId 面板 ID
   * @param newBase 新的“基底名”（面板标题）
   * @param oldBase 旧的“基底名”（传入可避免从状态推断）
   */
  async renameTmuxSession(panelId: string, newBase: string, oldBase?: string): Promise<void> {
    const panel = panelManager.getPanel(panelId);
    if (!panel) return;
    if (panel.type !== 'tmux') return;
    if (process.platform !== 'win32') return; // 仅在 Windows+WSL 场景使用

    const shellInfo = ShellDetector.getWSLShell();
    if (shellInfo.name !== 'wsl') return;

    // 获取 cwd 与项目信息
    const cwd: string = ((panel.state?.customState as any)?.cwd) || process.cwd();
    let projectName = path.basename(cwd);
    try {
      const sessionRow = require('./database').databaseService.getSession(panel.sessionId as string);
      if (sessionRow?.project_id) {
        const projectRow = require('./database').databaseService.getProject(sessionRow.project_id);
        if (projectRow?.name) projectName = projectRow.name;
      }
    } catch {}

    // 计算分支与新旧会话名
    const branch = this.sanitizeName((require('./gitPlumbingCommands') as typeof import('./gitPlumbingCommands')).getCurrentBranch(cwd) || 'detached');
    const projSan = this.sanitizeName(projectName);
    const newName = `${projSan}_${branch}_${this.sanitizeName(newBase)}`;

    let oldName = (panel.state?.customState as any)?.tmuxSessionId as string | undefined;
    if (!oldName) {
      const oldBaseFinal = oldBase || panel.title || 'tmux';
      oldName = `${projSan}_${branch}_${this.sanitizeName(oldBaseFinal)}`;
    }

    // 后台执行 rename-session
    const qOld = this.bashSingleQuote(oldName);
    const qNew = this.bashSingleQuote(newName);
    const bashCmd = `tmux rename-session -t ${qOld} ${qNew}`;
    try {
      execFileSync('wsl.exe', ['-e', 'bash', '-lc', bashCmd], { encoding: 'utf-8' as any });
      // 成功后更新面板状态中的 tmux 会话名
      const state = panel.state;
      state.customState = { ...(state.customState || {}), tmuxSessionId: newName } as TerminalPanelState;
      await panelManager.updatePanel(panelId, { state });
    } catch (e) {
      console.warn('[TerminalPanelManager] Failed to rename tmux session in background:', e);
    }
  }

  /**
   * 清理当前项目前缀下（project_）的失效 tmux 会话：
   * - 分支不存在；或
   * - 被标记为完成（.tmux/implemented/<branch>、git config crystal.tmux.doneBranches、或环境变量 CRYSTAL_TMUX_DONE_PATTERN 匹配）
   */
  async cleanupTmuxSessionsForProject(projectDir: string): Promise<void> {
    if (process.platform !== 'win32') return; // 当前仅支持在 Windows+WSL 场景清理
    // 使用数据库中的项目名（若存在），否则回退目录名
    let projectName = path.basename(projectDir);
    try {
      const projectRow = databaseService.getProjectByPath(projectDir);
      if (projectRow?.name) projectName = projectRow.name;
    } catch {}
    const project = this.sanitizeName(projectName);
    const listArgs = ['-e', 'bash', '-lc', "tmux list-sessions -F '#S' 2>/dev/null || true"];
    let out = '';
    try {
      out = execFileSync('wsl.exe', listArgs, { encoding: 'utf8' });
    } catch {
      return;
    }
    const sessions = out.split('\n').map(s => s.trim()).filter(Boolean);
    if (sessions.length === 0) return;

    // 准备“完成”分支规则
    const implementedDir = path.join(projectDir, '.tmux', 'implemented');
    let doneListRaw = '';
    try { doneListRaw = String(execSyncCE('git config --get crystal.tmux.doneBranches', { cwd: projectDir, silent: true }) || ''); } catch {}
    const doneBranches = new Set(doneListRaw.split(/\s|\n|\r/).map(s => s.trim()).filter(Boolean));
    const donePatternEnv = process.env.CRYSTAL_TMUX_DONE_PATTERN;
    const donePattern = donePatternEnv ? new RegExp(donePatternEnv) : null;

    const altProject = this.sanitizeName(path.basename(projectDir));
    for (const s of sessions) {
      const matchesCurrent = s.startsWith(project + '_');
      const matchesLegacy = altProject !== project && s.startsWith(altProject + '_');
      if (!matchesCurrent && !matchesLegacy) continue;
      const rest = s.substring(project.length + 1);
      const branch = rest.split('_')[0];
      if (!branch) continue;

      let branchExists = true;
      try {
        execSyncCE(`git show-ref --verify --quiet "refs/heads/${branch}"`, { cwd: projectDir, silent: true });
        branchExists = true;
      } catch {
        branchExists = false;
      }

      let isDone = false;
      try { isDone = require('fs').existsSync(path.join(implementedDir, branch)); } catch {}
      if (!isDone && doneBranches.has(branch)) isDone = true;
      if (!isDone && donePattern && donePattern.test(branch)) isDone = true;

      if (!branchExists || isDone) {
        try { execFileSync('wsl.exe', ['-e', 'bash', '-lc', `tmux kill-session -t ${this.bashSingleQuote(s)} 2>/dev/null || true`]); } catch {}
      }
    }
  }
  
  private isFileOperationCommand(command: string): boolean {
    const fileOperations = [
      'touch', 'rm', 'mv', 'cp', 'mkdir', 'rmdir',
      'cat >', 'echo >', 'echo >>', 'vim', 'vi', 'nano', 'emacs',
      'git add', 'git rm', 'git mv'
    ];
    
    const trimmedCommand = command.trim().toLowerCase();
    return fileOperations.some(op => trimmedCommand.startsWith(op));
  }
  
  isTerminalInitialized(panelId: string): boolean {
    return this.terminals.has(panelId);
  }
  
  writeToTerminal(panelId: string, data: string): void {
    const terminal = this.terminals.get(panelId);
    if (!terminal) {
      console.warn(`[TerminalPanelManager] Terminal ${panelId} not found`);
      return;
    }
    
    terminal.pty.write(data);
    terminal.lastActivity = new Date();
  }
  
  resizeTerminal(panelId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(panelId);
    if (!terminal) {
      console.warn(`[TerminalPanelManager] Terminal ${panelId} not found for resize`);
      return;
    }
    
    terminal.pty.resize(cols, rows);
    
    // Update panel state with new dimensions
    const panel = panelManager.getPanel(panelId);
    if (panel) {
      const state = panel.state;
      state.customState = {
        ...state.customState,
        dimensions: { cols, rows }
      } as TerminalPanelState;
      panelManager.updatePanel(panelId, { state });
    }
  }
  
  async saveTerminalState(panelId: string): Promise<void> {
    const terminal = this.terminals.get(panelId);
    if (!terminal) {
      console.warn(`[TerminalPanelManager] Terminal ${panelId} not found for state save`);
      return;
    }
    
    const panel = panelManager.getPanel(panelId);
    if (!panel) return;
    
    // Get current working directory (if possible)
    let cwd = (panel.state.customState && 'cwd' in panel.state.customState) ? panel.state.customState.cwd : undefined;
    cwd = cwd || process.cwd();
    try {
      // Try to get CWD from process (platform-specific)
      if (process.platform !== 'win32') {
        const pid = terminal.pty.pid;
        if (pid) {
          // This is a simplified approach - in production you might use platform-specific methods
          cwd = await this.getProcessCwd(pid);
        }
      }
    } catch (error) {
      console.warn(`[TerminalPanelManager] Could not get CWD for terminal ${panelId}:`, error);
    }
    
    // Save state to panel
    const state = panel.state;
    state.customState = {
      ...state.customState,
      isInitialized: true,
      cwd: cwd,
      scrollbackBuffer: terminal.scrollbackBuffer,
      commandHistory: terminal.commandHistory.slice(-100), // Keep last 100 commands
      lastActivityTime: terminal.lastActivity.toISOString(),
      lastActiveCommand: terminal.currentCommand
    } as TerminalPanelState;
    
    await panelManager.updatePanel(panelId, { state });
    
  }
  
  private async getProcessCwd(pid: number): Promise<string> {
    // This is platform-specific and simplified
    // In production, you'd use more robust methods
    if (process.platform === 'darwin' || process.platform === 'linux') {
      try {
        const fs = require('fs').promises;
        const cwdLink = `/proc/${pid}/cwd`;
        return await fs.readlink(cwdLink);
      } catch {
        return process.cwd();
      }
    }
    return process.cwd();
  }
  
  async restoreTerminalState(panel: ToolPanel, state: TerminalPanelState): Promise<void> {
    if (!state.scrollbackBuffer || state.scrollbackBuffer.length === 0) {
      return;
    }
    
    // Initialize terminal first
    await this.initializeTerminal(panel, state.cwd || process.cwd());
    
    const terminal = this.terminals.get(panel.id);
    if (!terminal) return;
    
    // Restore scrollback buffer (handle both string and array formats)
    if (typeof state.scrollbackBuffer === 'string') {
      terminal.scrollbackBuffer = state.scrollbackBuffer;
    } else if (Array.isArray(state.scrollbackBuffer)) {
      // Convert legacy array format to string
      terminal.scrollbackBuffer = state.scrollbackBuffer.join('\n');
    } else {
      terminal.scrollbackBuffer = '';
    }
    terminal.commandHistory = state.commandHistory || [];
    
    // Send restoration indicator to terminal
    const restorationMsg = `\r\n[Session Restored from ${state.lastActivityTime || 'previous session'}]\r\n`;
    terminal.pty.write(restorationMsg);
    
    // Send scrollback to frontend
    if (mainWindow && state.scrollbackBuffer) {
      mainWindow.webContents.send('terminal:output', {
        sessionId: panel.sessionId,
        panelId: panel.id,
        output: state.scrollbackBuffer + restorationMsg
      });
    }
  }
  
  getTerminalState(panelId: string): TerminalPanelState | null {
    const terminal = this.terminals.get(panelId);
    if (!terminal) return null;
    
    return {
      isInitialized: true,
      cwd: process.cwd(), // Simplified - would need platform-specific implementation
      shellType: process.env.SHELL || 'bash',
      scrollbackBuffer: terminal.scrollbackBuffer,
      commandHistory: terminal.commandHistory,
      lastActivityTime: terminal.lastActivity.toISOString(),
      lastActiveCommand: terminal.currentCommand
    };
  }
  
  destroyTerminal(panelId: string): void {
    const terminal = this.terminals.get(panelId);
    if (!terminal) {
      return;
    }
    
    // Save state before destroying
    this.saveTerminalState(panelId);
    
    // Kill the PTY process
    try {
      terminal.pty.kill();
    } catch (error) {
      console.error(`[TerminalPanelManager] Error killing terminal ${panelId}:`, error);
    }
    
    // Remove from map
    this.terminals.delete(panelId);
  }
  
  destroyAllTerminals(): void {
    for (const [panelId, terminal] of this.terminals) {
      try {
        terminal.pty.kill();
      } catch (error) {
        console.error(`[TerminalPanelManager] Error killing terminal ${panelId}:`, error);
      }
    }
    
    this.terminals.clear();
  }
  
  getActiveTerminals(): string[] {
    return Array.from(this.terminals.keys());
  }
}

// Export singleton instance
export const terminalPanelManager = new TerminalPanelManager();
