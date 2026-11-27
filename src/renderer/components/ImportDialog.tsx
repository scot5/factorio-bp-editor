import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { useDocuments } from '../store/documents'

export function ImportDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
}): React.JSX.Element {
  const importString = useDocuments((s) => s.importString)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    const result = importString(text)
    if (result.ok) {
      setText('')
      setError(null)
      onOpenChange(false)
    } else {
      setError(result.message)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 flex w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border border-edge bg-panel p-4 shadow-2xl"
          data-testid="import-dialog"
        >
          <Dialog.Title className="m-0 text-[15px] font-semibold">
            Import blueprint string
          </Dialog.Title>
          <Dialog.Description className="m-0 text-ink-muted">
            Paste a blueprint, book, deconstruction or upgrade planner string. Strings from Factorio
            1.1 are upgraded automatically.
          </Dialog.Description>
          <textarea
            autoFocus
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
            }}
            data-testid="import-text"
            className="h-48 resize-none rounded border border-edge bg-panel-2 p-2 font-mono text-[11px] break-all outline-none focus:border-accent"
            placeholder="0eNq…"
          />
          {error && (
            <p role="alert" className="m-0 text-danger" data-testid="import-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={!text.trim()}
              data-testid="import-submit"
            >
              Import
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
