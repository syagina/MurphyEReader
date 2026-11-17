import type { OutlineNode } from '@shared/types';

interface OutlinePanelProps {
  outline: OutlineNode[];
  onJump(pageNo: number): void;
  onClose(): void;
}

interface OutlineItemsProps {
  nodes: OutlineNode[];
  depth: number;
  onJump(pageNo: number): void;
}

function OutlineItems({ nodes, depth, onJump }: OutlineItemsProps): React.JSX.Element {
  return (
    <ul className={depth === 0 ? 'outline-list' : 'outline-children'}>
      {nodes.map((node, index) => {
        const pageNo = node.pageNo;
        return (
          <li className="outline-item" key={`${depth}-${index}-${node.title}`}>
            {pageNo === null ? (
              <span
                className="outline-label"
                style={{ paddingLeft: depth * 12 + 8 }}
                title={node.title}
              >
                {node.title}
              </span>
            ) : (
              <button
                type="button"
                className="outline-button"
                style={{ paddingLeft: depth * 12 + 8 }}
                title={`跳转到第 ${pageNo} 页`}
                onClick={() => onJump(pageNo)}
              >
                {node.title}
              </button>
            )}
            {node.children.length > 0 && (
              <OutlineItems nodes={node.children} depth={depth + 1} onJump={onJump} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Recursive table of contents for the opened paper. */
export function OutlinePanel({
  outline,
  onJump,
  onClose,
}: OutlinePanelProps): React.JSX.Element {
  return (
    <nav className="outline-panel" aria-label="大纲">
      <div className="outline-header">
        <span>大纲</span>
        <button
          type="button"
          className="outline-close"
          aria-label="收起大纲"
          title="收起大纲"
          onClick={onClose}
        >
          收起
        </button>
      </div>
      {outline.length === 0 ? (
        <p className="outline-empty">本文无大纲</p>
      ) : (
        <OutlineItems nodes={outline} depth={0} onJump={onJump} />
      )}
    </nav>
  );
}
