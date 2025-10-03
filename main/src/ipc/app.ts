import { IpcMain, shell } from 'electron';
import * as path from 'path';
import type { AppServices } from './types';

export function registerAppHandlers(ipcMain: IpcMain, services: AppServices): void {
  const { app } = services;

  // Basic app info handlers
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });

  ipcMain.handle('is-packaged', () => {
    return app.isPackaged;
  });

  // System utilities
  ipcMain.handle('openExternal', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('Failed to open external URL:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to open URL' };
    }
  });

  // Welcome tracking handler (for compatibility)
  ipcMain.handle('track-welcome-dismissed', () => {
    // This handler exists for compatibility with other parts of the codebase
    // Our Discord popup logic handles this differently
    console.log('[App] Welcome dismissed (tracked for compatibility)');
    return { success: true };
  });

  // App opens tracking
  ipcMain.handle('app:record-open', (_event, welcomeHidden: boolean, discordShown: boolean = false) => {
    try {
      services.databaseService.recordAppOpen(welcomeHidden, discordShown);
      return { success: true };
    } catch (error) {
      console.error('Failed to record app open:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to record app open' };
    }
  });

  ipcMain.handle('app:get-last-open', () => {
    try {
      const lastOpen = services.databaseService.getLastAppOpen();
      return { success: true, data: lastOpen };
    } catch (error) {
      console.error('Failed to get last app open:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get last app open' };
    }
  });

  ipcMain.handle('app:update-discord-shown', () => {
    try {
      services.databaseService.updateLastAppOpenDiscordShown();
      return { success: true };
    } catch (error) {
      console.error('Failed to update discord shown:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update discord shown' };
    }
  });

  // User preferences handlers
  ipcMain.handle('preferences:get', (_event, key: string) => {
    try {
      const value = services.databaseService.getUserPreference(key);
      return { success: true, data: value };
    } catch (error) {
      console.error('Failed to get preference:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get preference' };
    }
  });

  ipcMain.handle('preferences:set', (_event, key: string, value: string) => {
    try {
      services.databaseService.setUserPreference(key, value);
      return { success: true };
    } catch (error) {
      console.error('Failed to set preference:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to set preference' };
    }
  });

  ipcMain.handle('preferences:get-all', () => {
    try {
      const preferences = services.databaseService.getUserPreferences();
      return { success: true, data: preferences };
    } catch (error) {
      console.error('Failed to get all preferences:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get all preferences' };
    }
  });

  // 提供 Monaco 本地资源路径（开发环境：Vite /@fs）
  ipcMain.handle('env:get-monaco-vs-path', () => {
    try {
      const monacoPkg = require.resolve('monaco-editor/package.json');
      const monacoDir = path.dirname(monacoPkg);
      const vsDir = path.join(monacoDir, 'min', 'vs');
      const normalized = vsDir.replace(/\\/g, '/');
      return { success: true, path: `@fs/${normalized}` };
    } catch (error) {
      console.error('Failed to resolve monaco-editor vs path:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to resolve monaco path' };
    }
  });
}
