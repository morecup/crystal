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

  const [maxFileMB, setMaxFileMB] = useState<number>(currentMaxFileMB);
  const [maxParallel, setMaxParallel] = useState<number>(currentMaxParallel);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMaxFileMB(currentMaxFileMB);
    setMaxParallel(currentMaxParallel);
  }, [isOpen, currentMaxFileMB, currentMaxParallel]);

  const handleSave = async () => {
    const mb = Math.max(1, Math.floor(maxFileMB || DEFAULT_MAX_FILE_MB));
    const parallel = Math.max(1, Math.floor(maxParallel || DEFAULT_MAX_PARALLEL));
    setSaving(true);
    try {
      await updateConfig({
        diffSettings: {
          maxFileBytes: mb * 1024 * 1024,
          maxParallelReads: parallel,
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

