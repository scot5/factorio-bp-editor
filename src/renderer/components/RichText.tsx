import { useMemo } from 'react'
import { parseRichText } from '@core/richtext'

/**
 * Renders Factorio rich text as React text nodes (never as HTML).
 * Icons are shown as name chips until real icons arrive in M3.
 */
export function RichText({
  text,
  className
}: {
  text: string
  className?: string
}): React.JSX.Element {
  const nodes = useMemo(() => parseRichText(text), [text])
  return (
    <span className={className}>
      {nodes.map((node, i) =>
        node.type === 'text' ? (
          <span key={i} style={{ color: node.color, fontWeight: node.bold ? 600 : undefined }}>
            {node.text}
          </span>
        ) : (
          <span
            key={i}
            className="icon-chip"
            style={{ color: node.color }}
            title={`${node.kind}: ${node.name}${node.quality ? ` (${node.quality})` : ''}`}
          >
            {node.name}
          </span>
        )
      )}
    </span>
  )
}
