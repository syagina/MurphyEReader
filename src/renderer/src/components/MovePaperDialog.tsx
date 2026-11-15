import { useEffect, useState } from 'react';
import type { Folder, Paper } from '@shared/types';
import { errorMessage } from '../lib/errors';

export interface MovePaperDialogProps {
  paper: Paper;
  folders: Folder[];
  onMove(folderId: number | null): Promise<void>;
  onClose(): void;
}

/**
 * Radio modal for moving one paper: 未分类 plus every folder. Selecting an
 * option performs the move immediately, then closes on success.
 */
export function MovePaperDialog({
  paper,
  folders,
  onMove,
  onClose,
}: MovePaperDialogProps): React.JSX.Element {
  const [selected, setSelected] = useState<number | null>(paper.folderId);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSelect = (folderId: number | null): void => {
    if (moving) {
      return;
    }
    setSelected(folderId);
    setMoving(true);
    setError(null);
    void onMove(folderId).then(
      () => {
        onClose();
      },
      (moveError: unknown) => {
        setError(errorMessage(moveError));
        setSelected(paper.folderId);
        setMoving(false);
      },
    );
  };

  return (
    <div
      className="library-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !moving) {
          onClose();
        }
      }}
    >
      <div
        className="library-edit-dialog library-move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-move-title"
      >
        <h2 className="library-edit-title" id="library-move-title">
          移动到文件夹
        </h2>
        <p className="library-move-paper" title={paper.title}>
          {paper.title}
        </p>
        <div className="library-move-options" role="radiogroup" aria-label="选择文件夹">
          <label
            className={selected === null ? 'library-move-option selected' : 'library-move-option'}
          >
            <input
              type="radio"
              name={`paper-folder-${paper.id}`}
              checked={selected === null}
              disabled={moving}
              onChange={() => handleSelect(null)}
            />
            <span>未分类</span>
          </label>
          {folders.map((folder) => (
            <label
              key={folder.id}
              className={
                selected === folder.id ? 'library-move-option selected' : 'library-move-option'
              }
            >
              <input
                type="radio"
                name={`paper-folder-${paper.id}`}
                checked={selected === folder.id}
                disabled={moving}
                onChange={() => handleSelect(folder.id)}
              />
              <span>{folder.name}</span>
            </label>
          ))}
        </div>
        {error !== null && (
          <p className="library-folder-error" role="alert">
            {error}
          </p>
        )}
        <div className="library-edit-actions">
          <button type="button" className="secondary-button" disabled={moving} onClick={onClose}>
            {moving ? '正在移动…' : '关闭'}
          </button>
        </div>
      </div>
    </div>
  );
}
