import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { Settings as SettingsIcon } from 'lucide-react';
import { useConfigStore } from '../../../stores/configStore';

interface DiffSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_MAX_FILE_MB = 5;
const DEFAULT_MAX_PARALLEL = 3;
const DEFAULT_CONTEXT_LINES = 3;

const DiffSettings: React.FC<DiffSettingsProps> = ({ isOpen, onClose }) => {
  const { config, updateConfig } = useConfigStore();
  const currentMaxFileMB = useMemo(() => {
    const bytes = config?.diffSettings?.maxFileBytes;
    if (typeof bytes === 'number' && bytes > 0) return Math.round(bytes / (1024 * 1024));
    return DEFAULT_MAX_FILE_MB;
  }, [config]);
  const currentMaxParallel = useMemo(() => {
    const n = config?.diffSettings?.maxParallelReads;
    if (typeof n === 'number' && n > 0) return n;
    return DEFAULT_MAX_PARALLEL;
  }, [config]);
  const currentContextLines = useMemo(() => {
    const n = config?.diffSettings?.contextLines;
    if (typeof n === 'number' && n >= 0) return n;
    return DEFAULT_CONTEXT_LINES;
  }, [config]);

  const [maxFileMB, setMaxFileMB] = useState<number>(currentMaxFileMB);
  const [maxParallel, setMaxParallel] = useState<number>(currentMaxParallel);
  const [contextLines, setContextLines] = useState<number>(currentContextLines);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMaxFileMB(currentMaxFileMB);
    setMaxParallel(currentMaxParallel);
    setContextLines(currentContextLines);
  }, [isOpen, currentMaxFileMB, currentMaxParallel, currentContextLines]);

  const handleSave = async () => {
    const mb = Math.max(1, Math.floor(maxFileMB || DEFAULT_MAX_FILE_MB));
    const parallel = Math.max(1, Math.floor(maxParallel || DEFAULT_MAX_PARALLEL));
    const context = Math.max(0, Math.floor(contextLines ?? DEFAULT_CONTEXT_LINES));
    setSaving(true);
    try {
      await updateConfig({
        diffSettings: {
          maxFileBytes: mb * 1024 * 1024,
          maxParallelReads: parallel,
          contextLines: context,
        },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setMaxFileMB(DEFAULT_MAX_FILE_MB);
    setMaxParallel(DEFAULT_MAX_PARALLEL);
    setContextLines(DEFAULT_CONTEXT_LINES);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader icon={<SettingsIcon className="w-5 h-5" />} title="Diff 设置" onClose={onClose} />
      <ModalBody>
        <div className="space-y-4">
          <div>
            <Input
              type="number"
              min={1}
              step={1}
              label="单文件差异渲染软上限 (MB)"
              value={maxFileMB}
              onChange={(e) => setMaxFileMB(Number(e.target.value))}
              helperText="超过该大小的文件将不渲染具体差异，以避免 OOM"
              fullWidth
            />
          </div>
          <div>
            <Input
              type="number"
              min={1}
              step={1}
              label="文件内容读取并发上限"
              value={maxParallel}
              onChange={(e) => setMaxParallel(Number(e.target.value))}
              helperText="建议 2-4，过高可能导致瞬时内存峰值冲高"
              fullWidth
            />
          </div>
          <div>
            <Input
              type="number"
              min={0}
              step={1}
              label="Git Diff 上下文行数"
              value={contextLines}
              onChange={(e) => setContextLines(Number(e.target.value))}
              helperText="控制 git diff 显示的差异上下文行数（默认为 3，0 表示仅显示变更行）"
              fullWidth
            />
          </div>
          <div className="text-xs text-text-tertiary">
            提示：设置保存到全局配置，立即生效于 Diff 面板。
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={handleReset} disabled={saving}>
          恢复默认
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button variant="primary" onClick={handleSave} loading={saving} loadingText="保存中...">
          保存
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default DiffSettings;

