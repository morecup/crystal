/**
 * Utilities to build a clean environment object for child processes.
 *
 * On Windows, environment variable names are case-insensitive. Passing both
 * 'Path' and 'PATH' (or any case-variant duplicates) can cause issues in shells
 * like PowerShell when enumerating Env:, leading to errors like:
 * "已添加了具有相同键的项" (An item with the same key has already been added).
 *
 * These helpers merge process.env with overrides and ensure no duplicate keys
 * differing only by case. We also canonicalize PATH to 'Path' on Windows.
 */

type EnvInput = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Merge env sources and return a sanitized object suitable for spawn/pty.
 * - Deduplicate keys case-insensitively on Windows
 * - Canonicalize PATH => 'Path' on Windows
 * - Ensure values are strings (filter out undefined)
 */
export function buildSpawnEnv(
  ...sources: EnvInput[]
): { [key: string]: string } {
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    const out: { [key: string]: string } = {};
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) {
        if (typeof v === 'string') out[k] = v;
      }
    }
    return out;
  }

  // Windows: dedupe case-insensitively and normalize key casing
  const lowerMap = new Map<string, string>();

  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) {
      if (typeof v !== 'string') continue;
      lowerMap.set(k.toLowerCase(), v);
    }
  }

  const outWin: { [key: string]: string } = {};
  for (const [lowerKey, value] of lowerMap.entries()) {
    if (lowerKey === 'path') {
      // Use canonical 'Path' key on Windows
      outWin['Path'] = value;
    } else {
      // Upper-case the rest to avoid mixed-case dupes like ComSpec/COMSPEC
      outWin[lowerKey.toUpperCase()] = value;
    }
  }

  return outWin;
}
