import { useMemo } from 'react'
import { parseRichText } from '@core/richtext'
import { Icon } from './Icon'

/**
 * Renders Factorio rich text as React text nodes (never as HTML).
 * Icons come from the game data, or show as name chips without it.
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
          <Icon
            key={i}
            kind={node.kind === 'img' ? undefined : node.kind}
            name={node.name}
            quality={node.quality}
            size={16}
          />
        )
      )}
    </span>
  )
}
