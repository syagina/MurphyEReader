import { useMemo } from 'react';
import { parseCitations } from '../lib/citations';
import { parseMarkdown } from '../lib/markdown';
import type { MarkdownBlock, MarkdownInline } from '../lib/markdown';
import { useReaderStore } from '../stores/reader';

export interface MarkdownViewProps {
  text: string;
  className?: string;
}

/**
 * Renders inline text, turning `[p.N]` into buttons that jump the reader.
 * Citations inside inline code stay literal because code nodes never reach
 * this component.
 */
function MarkdownText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {parseCitations(text).map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <button
            key={index}
            type="button"
            className="citation-link"
            title={`跳到第 ${segment.pageNo} 页`}
            onClick={() => useReaderStore.getState().jumpToPage(segment.pageNo)}
          >
            [p.{segment.pageNo}]
          </button>
        ),
      )}
    </>
  );
}

function renderInline(nodes: MarkdownInline[]): React.ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <MarkdownText key={index} text={node.text} />;
      case 'bold':
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case 'code':
        return (
          <code className="markdown-inline-code" key={index}>
            {node.text}
          </code>
        );
      case 'break':
        return <br key={index} />;
    }
  });
}

function renderBlock(block: MarkdownBlock, key: number): React.ReactNode {
  switch (block.type) {
    case 'paragraph':
      return <p key={key}>{renderInline(block.children)}</p>;
    case 'heading': {
      const Heading = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Heading className="markdown-heading" key={key}>
          {renderInline(block.children)}
        </Heading>
      );
    }
    case 'codeBlock':
      return (
        <pre className="markdown-code" key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List className="markdown-list" key={key}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </List>
      );
    }
  }
}

/**
 * Renders the shared Markdown AST as React nodes. Raw HTML stays literal text
 * because the parser never produces markup nodes; nothing is injected with
 * `dangerouslySetInnerHTML`.
 */
export function MarkdownView({ text, className }: MarkdownViewProps): React.JSX.Element {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={className === undefined ? 'markdown-view' : `markdown-view ${className}`}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}
