import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui/Button';
import { Trash2 } from 'lucide-react';

interface DeleteLastCommitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: 'soft' | 'hard') => Promise<void> | void;
  commitHash?: string;
  commitMessage?: string;
}

// 删除最近一次提交的对话框（使用应用统一样式，含取消，交互清晰）
export const DeleteLastCommitDialog: React.FC<DeleteLastCommitDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  commitHash,
  commitMessage
}) => {
  const [mode, setMode] = useState<'soft' | 'hard'>('soft');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shortHash = (commitHash || '').substring(0, 7);

  useEffect(() => {
    if (isOpen) {
      setMode('soft');
      setIsDeleting(false);
      setError(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    try {
      setIsDeleting(true);
      setError(null);
      await onConfirm(mode);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isDeleting ? () => {} : onClose}
      size="md"
      closeOnOverlayClick={!isDeleting}
      closeOnEscape={!isDeleting}
      showCloseButton={!isDeleting}
    >
      <ModalHeader
        icon={<Trash2 className="w-5 h-5" />}
        title="Delete Latest Commit"
        onClose={onClose}
      />
      <ModalBody>
        <div className="space-y-3">
          {(commitHash || commitMessage) && (
            <div className="text-sm text-text-secondary">
              <div className="font-mono text-text-primary">{shortHash}</div>
              {commitMessage && (
                <div className="truncate">{commitMessage}</div>
              )}
            </div>
          )}
          <p className="text-sm text-text-secondary">
            Choose how to delete the most recent commit on this branch:
          </p>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="delete-mode"
                checked={mode === 'soft'}
                onChange={() => setMode('soft')}
                disabled={isDeleting}
              />
              <span>
                Keep changes (git reset --soft HEAD~1)
                <div className="text-text-tertiary text-xs">
                  Remove the commit but keep its changes as uncommitted.
                </div>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="delete-mode"
                checked={mode === 'hard'}
                onChange={() => setMode('hard')}
                disabled={isDeleting}
              />
              <span>
                Discard changes (git reset --hard HEAD~1)
                <div className="text-text-tertiary text-xs">
                  Permanently drop the commit and its changes.
                </div>
              </span>
            </label>
          </div>

          {error && (
            <div className="text-status-error text-sm bg-status-error/10 border border-status-error/30 rounded p-2">
              {error}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} variant="secondary" disabled={isDeleting}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} variant="danger" loading={isDeleting} loadingText="Deleting...">
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default DeleteLastCommitDialog;
