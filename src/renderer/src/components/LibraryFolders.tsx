import { useEffect, useMemo, useState } from 'react';
import type { Folder } from '@shared/types';
import { countByFolder } from '../lib/library-view';
import type { FolderFilter } from '../lib/library-view';
import { useFoldersStore } from '../stores/folders';
import { useLibraryStore } from '../stores/library';

export interface LibraryFoldersProps {
  selected: FolderFilter;
  onSelect(filter: FolderFilter): void;
  onChanged(): Promise<void> | void;
}

/**
 * Folder facet above the tag list: fixed 全部文献/未分类 rows, one row per
 * folder with hover rename/delete actions, and an inline create input.
 */
export function LibraryFolders({
  selected,
  onSelect,
  onChanged,
}: LibraryFoldersProps): React.JSX.Element {
  const folders = useFoldersStore((state) => state.folders);
  const loading = useFoldersStore((state) => state.loading);
  const error = useFoldersStore((state) => state.error);
  const load = useFoldersStore((state) => state.load);
  const createFolder = useFoldersStore((state) => state.create);
  const renameFolder = useFoldersStore((state) => state.rename);
  const removeFolder = useFoldersStore((state) => state.remove);
  const papers = useLibraryStore((state) => state.papers);
  const counts = useMemo(() => countByFolder(papers), [papers]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const notifyChanged = async (): Promise<void> => {
    try {
      await onChanged();
    } catch {
      // The parent owns its own error banner; the sidebar must never crash.
    }
  };

  const submitCreate = async (): Promise<void> => {
    if (saving) {
      return;
    }
    setSaving(true);
    const folder = await createFolder(newName);
    setSaving(false);
    if (folder === null) {
      return;
    }
    setCreating(false);
    setNewName('');
    await notifyChanged();
  };

  const submitRename = async (id: number): Promise<void> => {
    if (saving) {
      return;
    }
    setSaving(true);
    const folder = await renameFolder(id, renameText);
    setSaving(false);
    if (folder === null) {
      return;
    }
    setRenamingId(null);
    setRenameText('');
    await notifyChanged();
  };

  const handleDelete = async (folder: Folder): Promise<void> => {
    const count = counts.byId[folder.id] ?? 0;
    if (!window.confirm(`文件夹内的 ${count} 篇文献会移到「未分类」，不会删除文件。`)) {
      return;
    }
    if (saving) {
      return;
    }
    setSaving(true);
    const removed = await removeFolder(folder.id);
    setSaving(false);
    if (!removed) {
      return;
    }
    if (renamingId === folder.id) {
      setRenamingId(null);
      setRenameText('');
    }
    if (selected === folder.id) {
      onSelect('all');
    }
    await notifyChanged();
  };

  const createInput = (
    <input
      autoFocus
      className="library-folder-input"
      aria-label="新建文件夹名称"
      placeholder="文件夹名称"
      value={newName}
      onChange={(event) => setNewName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void submitCreate();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setCreating(false);
          setNewName('');
        }
      }}
    />
  );

  return (
    <div className="library-folders">
      <h2 className="library-facet-heading">文件夹</h2>
      {error !== null && (
        <p className="library-folder-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={selected === 'all' ? 'library-tag-filter active' : 'library-tag-filter'}
        onClick={() => onSelect('all')}
      >
        <span>全部文献</span>
        <span className="library-tag-count">{counts.all}</span>
      </button>
      <button
        type="button"
        className={selected === 'none' ? 'library-tag-filter active' : 'library-tag-filter'}
        onClick={() => onSelect('none')}
      >
        <span>未分类</span>
        <span className="library-tag-count">{counts.none}</span>
      </button>
      {folders.map((folder) => (
        <div className="library-folder-row" key={folder.id}>
          {renamingId === folder.id ? (
            <input
              autoFocus
              className="library-folder-input"
              aria-label={`重命名文件夹：${folder.name}`}
              value={renameText}
              onChange={(event) => setRenameText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submitRename(folder.id);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setRenamingId(null);
                  setRenameText('');
                }
              }}
            />
          ) : (
            <>
              <button
                type="button"
                className={
                  selected === folder.id ? 'library-tag-filter active' : 'library-tag-filter'
                }
                onClick={() => onSelect(folder.id)}
              >
                <span className="library-folder-name" title={folder.name}>
                  {folder.name}
                </span>
                <span className="library-tag-count">{counts.byId[folder.id] ?? 0}</span>
              </button>
              <span className="library-folder-actions">
                <button
                  type="button"
                  className="library-folder-action"
                  aria-label={`重命名文件夹：${folder.name}`}
                  onClick={() => {
                    setRenamingId(folder.id);
                    setRenameText(folder.name);
                  }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="library-folder-action danger"
                  aria-label={`删除文件夹：${folder.name}`}
                  onClick={() => void handleDelete(folder)}
                >
                  删除
                </button>
              </span>
            </>
          )}
        </div>
      ))}
      {creating ? (
        createInput
      ) : (
        <button
          type="button"
          className="library-folder-create"
          disabled={loading}
          onClick={() => setCreating(true)}
        >
          + 新建文件夹
        </button>
      )}
    </div>
  );
}
