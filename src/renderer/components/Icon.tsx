import clsx from 'clsx'
import { useState } from 'react'
import { useAssets } from '../store/assets'

/**
 * A game icon (from the user's Factorio install via factorio-asset://), or a
 * name chip when game data is not loaded or the icon does not exist.
 */
export function Icon({
  kind,
  name,
  quality,
  size = 16,
  className,
  fallback = 'chip'
}: {
  kind?: string | undefined
  name: string
  quality?: string | undefined
  size?: number
  className?: string
  fallback?: 'chip' | 'none'
}): React.JSX.Element | null {
  const url = useAssets((s) => s.icon(kind, name))
  const qualityUrl = useAssets((s) =>
    quality && quality !== 'normal' ? s.icon('quality', quality) : null
  )
  const [failed, setFailed] = useState(false)
  const title = `${kind ?? 'item'}: ${name}${quality ? ` (${quality})` : ''}`

  if (!url || failed) {
    return fallback === 'chip' ? (
      <span className={clsx('icon-chip', className)} title={title}>
        {name}
      </span>
    ) : null
  }
  return (
    <span
      className={clsx('relative inline-block shrink-0 align-[-3px]', className)}
      style={{ width: size, height: size }}
      title={title}
    >
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailed(true)}
      />
      {qualityUrl && (
        <img
          src={qualityUrl}
          alt={quality}
          className="absolute bottom-0 left-0"
          width={Math.round(size * 0.45)}
          height={Math.round(size * 0.45)}
          draggable={false}
        />
      )}
    </span>
  )
}
