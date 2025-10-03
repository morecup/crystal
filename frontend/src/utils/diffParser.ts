/**
 * 统一的diff解析工具 - 修复Windows平台文件预览显示问题
 */

export interface ParsedFile {
  path: string;
  oldPath: string;
  type: 'added' | 'deleted' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  isBinary?: boolean;
}

/**
 * 规范化文件路径 - 处理Windows平台特定的路径问题
 */
function normalizeFilePath(filePath: string): string {
  if (!filePath) return '';

  // 移除引号（git可能会用引号包围包含特殊字符的文件名）
  let normalized = filePath.replace(/^["']|["']$/g, '');

  // 处理转义字符（git会转义某些特殊字符）
  normalized = normalized.replace(/\\(.)/g, '$1');

  // 统一使用正斜杠作为路径分隔符（即使在Windows上）
  normalized = normalized.replace(/\\/g, '/');

  return normalized;
}

/**
 * 改进的文件名解析函数 - 支持更多edge cases
 */
export function parseFileNameFromDiff(diffContent: string): { oldPath: string; newPath: string } | null {
  // 尝试多种正则表达式模式来匹配文件名
  const patterns = [
    // 标准模式：diff --git a/path b/path
    /^diff --git a\/(.+?) b\/(.+?)$/m,
    // 带引号的模式：diff --git "a/path with spaces" "b/path with spaces"
    /^diff --git "a\/(.+?)" "b\/(.+?)"$/m,
    // 混合模式：一个有引号，一个没有
    /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/m,
    // 处理没有前缀的情况
    /^diff --git (.+?) (.+?)$/m,
  ];

  for (const pattern of patterns) {
    const match = diffContent.match(pattern);
    if (match) {
      return {
        oldPath: normalizeFilePath(match[1]),
        newPath: normalizeFilePath(match[2])
      };
    }
  }

  // 如果都匹配不到，尝试更宽松的匹配
  const fallbackMatch = diffContent.match(/^diff --git\s+(?:"?a\/)?(.+?)(?:"?)\s+(?:"?b\/)?(.+?)(?:"?)$/m);
  if (fallbackMatch) {
    return {
      oldPath: normalizeFilePath(fallbackMatch[1]),
      newPath: normalizeFilePath(fallbackMatch[2])
    };
  }

  return null;
}

/**
 * 解析diff内容，提取文件信息
 */
export function parseFilesFromDiff(diffContent: string): ParsedFile[] {
  if (!diffContent || diffContent.trim().length === 0) {
    console.log('parseFilesFromDiff: Empty diff input');
    return [];
  }

  console.log('parseFilesFromDiff: Parsing diff of length:', diffContent.length);

  const files: ParsedFile[] = [];

  // 分割为单个文件的diff块
  const fileMatches = diffContent.match(/diff --git[\s\S]*?(?=diff --git|$)/g);

  if (!fileMatches) {
    console.warn('parseFilesFromDiff: No file matches found in diff');
    return files;
  }

  console.log('parseFilesFromDiff: Found', fileMatches.length, 'file(s) in diff');

  for (const fileContent of fileMatches) {
    const parsedPaths = parseFileNameFromDiff(fileContent);

    if (!parsedPaths) {
      console.warn('Could not parse file names from diff block:', fileContent.substring(0, 100));
      continue;
    }

    const { oldPath, newPath } = parsedPaths;

    // 检测文件是否为二进制
    const isBinary = fileContent.includes('Binary files') ||
                     fileContent.includes('GIT binary patch') ||
                     fileContent.includes('differ\n'); // "Binary files a/file and b/file differ"

    // 确定文件操作类型
    let type: 'added' | 'deleted' | 'modified' | 'renamed' = 'modified';
    if (fileContent.includes('new file mode')) {
      type = 'added';
    } else if (fileContent.includes('deleted file mode')) {
      type = 'deleted';
    } else if (fileContent.includes('rename from') && fileContent.includes('rename to')) {
      type = 'renamed';
    }

    // 统计添加和删除的行数（仅针对非二进制文件）
    let additions = 0;
    let deletions = 0;

    if (!isBinary) {
      // 匹配添加的行（以+开头，但不是+++）
      const additionMatches = fileContent.match(/^\+[^+]/gm);
      additions = additionMatches ? additionMatches.length : 0;

      // 匹配删除的行（以-开头，但不是---）
      const deletionMatches = fileContent.match(/^-[^-]/gm);
      deletions = deletionMatches ? deletionMatches.length : 0;
    }

    // 使用新路径作为主路径，如果新路径为空则使用旧路径
    const finalPath = newPath || oldPath;

    if (!finalPath) {
      console.error('parseFilesFromDiff: Both old and new paths are empty for diff:', fileContent.substring(0, 100));
      continue;
    }

    const parsedFile: ParsedFile = {
      path: finalPath,
      oldPath: oldPath,
      type,
      additions,
      deletions,
      isBinary
    };

    files.push(parsedFile);
  }

  console.log('parseFilesFromDiff: Successfully parsed', files.length, 'files');

  return files;
}

/**
 * 验证解析结果的实用函数
 */
export function validateParsedFiles(files: ParsedFile[]): ParsedFile[] {
  return files.filter(file => {
    if (!file.path || file.path.trim().length === 0) {
      console.warn('Filtered out file with empty path:', file);
      return false;
    }
    return true;
  });
}