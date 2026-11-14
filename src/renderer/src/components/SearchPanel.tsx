import type { SearchResult } from '@shared/types';
import { useSearchStore } from '../stores/search';

export interface SearchPanelProps {
  onSelect(result: SearchResult): void;
}

const KIND_LABELS: Record<SearchResult['kind'], string> = {
  page: '页码',
  message: '对话',
  note: '笔记',
};

function resultKey(result: SearchResult, index: number): string {
  const target = result.pageNo ?? result.conversationId ?? result.noteId ?? index;
  return `${result.kind}-${result.paperId}-${target}-${index}`;
}

/**
 * Dropdown under the global search input. Renders only while the query is
 * non-empty; selecting a result is delegated to the App, which owns opening
 * papers and switching the AI panel.
 */
export function SearchPanel({ onSelect }: SearchPanelProps): React.JSX.Element | null {
  const query = useSearchStore((state) => state.query);
  const results = useSearchStore((state) => state.results);
  const searching = useSearchStore((state) => state.searching);
  const error = useSearchStore((state) => state.error);
  const hasSearched = useSearchStore((state) => state.hasSearched);
  const dismissError = useSearchStore((state) => state.dismissError);

  if (query.trim() === '') {
    return null;
  }

  return (
    <div className="search-panel" aria-label="全局搜索结果">
      {error !== null && (
        <div className="search-error" role="alert">
          <span className="search-error-text">{error}</span>
          <button
            type="button"
            className="search-dismiss"
            aria-label="关闭搜索错误"
            onClick={dismissError}
          >
            关闭
          </button>
        </div>
      )}

      {searching && <p className="search-status">正在搜索…</p>}

      {!searching && hasSearched && results.length === 0 && error === null && (
        <p className="search-status">没有匹配结果</p>
      )}

      {results.length > 0 && (
        <ul className="search-results">
          {results.map((result, index) => (
            <li key={resultKey(result, index)}>
              <button
                type="button"
                className="search-result"
                onClick={() => onSelect(result)}
              >
                <span className={`search-kind search-kind-${result.kind}`}>
                  {KIND_LABELS[result.kind]}
                </span>
                <span className="search-result-body">
                  <span className="search-result-title">{result.paperTitle}</span>
                  <span className="search-result-snippet">{result.snippet}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
