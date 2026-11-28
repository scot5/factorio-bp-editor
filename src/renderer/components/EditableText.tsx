import clsx from 'clsx'
import { useState } from 'react'
import { RichText } from './RichText'

interface Props {
  value: string
  /** Called with the new text when the user commits (Enter, or leaving the field). */
  onCommit(text: string): void
  multiline?: boolean
  placeholder?: string
  testId: string
}

/**
 * Text shown as rich text; click (or Enter on it) to edit the raw text.
 * Enter commits (Ctrl+Enter when multiline), Escape cancels, blur commits.
 * Rich text is rendered by the parser, never as HTML (02 § Rich text).
 */
export function EditableText({
  value,
  onCommit,
  multiline = false,
  placeholder = '–',
  testId
}: Readonly<Props>): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <button
        type="button"
        className={clsx(
          'w-full cursor-text rounded px-1 -mx-1 text-left hover:bg-white/5',
          multiline && 'whitespace-pre-wrap'
        )}
        title="Click to edit"
        onClick={() => setDraft(value)}
        data-testid={testId}
      >
        {value ? <RichText text={value} /> : <span className="text-ink-muted">{placeholder}</span>}
      </button>
    )
  }

  const commit = (): void => {
    if (draft !== value) onCommit(draft)
    setDraft(null)
  }
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
    } else if (event.key === 'Enter' && (!multiline || event.ctrlKey)) {
      event.preventDefault()
      commit()
    }
  }
  const common = {
    autoFocus: true,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: commit,
    onKeyDown,
    'data-testid': `${testId}-input`,
    className:
      'w-full rounded border border-accent/70 bg-panel-2 px-1 py-0.5 text-[12px] text-ink outline-none'
  }
  return multiline ? <textarea rows={4} {...common} /> : <input type="text" {...common} />
}
