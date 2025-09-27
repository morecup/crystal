import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolPanel, ToolPanelState, ToolPanelMetadata } from '../../../../shared/types/panels';

// Mocks
let lastSpawn: { file: string; args: string[]; options: any } | null = null;

vi.mock('@homebridge/node-pty-prebuilt-multiarch', () => {
  return {
    spawn: (file: string, args: string[] = [], options: any) => {
      lastSpawn = { file, args, options };
      return {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
        pid: 12345
      } as any;
    }
  };
});

vi.mock('../../utils/shellPath', () => ({
  getShellPath: () => 'C:/mock/bin'
}));

vi.mock('../../utils/shellDetector', () => ({
  ShellDetector: {
    getWSLShell: () => ({ path: 'C\\\\Windows\\\\System32\\\\wsl.exe', name: 'wsl' }),
    getDefaultShell: () => ({ path: 'powershell.exe', name: 'powershell', args: ['-NoExit'] })
  }
}));

vi.mock('../../index', () => ({
  mainWindow: null
}));

vi.mock('../panelManager', () => ({
  panelManager: {
    updatePanel: vi.fn(async () => {}),
    emitPanelEvent: vi.fn(async () => {})
  }
}));

// Import after mocks
import { TerminalPanelManager } from '../terminalPanelManager';

describe('TerminalPanelManager (WSL)', () => {
  beforeEach(() => {
    lastSpawn = null;
  });

  it('should spawn wsl.exe when panel type is wsl on Windows', async () => {
    // Skip on non-Windows
    if (process.platform !== 'win32') {
      expect(true).toBe(true);
      return;
    }

    const manager = new TerminalPanelManager();
    const panel: ToolPanel = {
      id: 'panel-wsl-1',
      sessionId: 'sess-1',
      type: 'wsl',
      title: 'WSL 1',
      state: { isActive: true, hasBeenViewed: false } as ToolPanelState,
      metadata: { createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), position: 0 } as ToolPanelMetadata
    };

    await manager.initializeTerminal(panel, process.cwd());

    expect(lastSpawn).not.toBeNull();
    expect(lastSpawn!.file.toLowerCase()).toContain('wsl');
  });
});
