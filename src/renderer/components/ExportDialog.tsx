import * as Dialog from '@radix-ui/react-dialog'
import { useMemo, useState } from 'react'
import { encode, type BlueprintEnvelope } from '@core/codec'
import { richTextToPlain } from '@core/richtext'
import type { EnvelopeNode } from '@core/model'
import type { OpenDocument } from '../store/documents'

/** Export (docs/spec/05-editing.md § Export): the whole document, or the active item only. */
export function ExportDialog({
  doc,
  node,
  open,
  onOpenChange
}: {
  doc: OpenDocument
  node: EnvelopeNode | undefined
  open: boolean
  onOpenChange(open: boolean): void
}): React.JSX.Element {
  const canExportActive = node !== undefined && node.path.length > 0
  const [scope, setScope] = useState<'document' | 'active'>('document')
  const [status, setStatus] = useState<string | null>(null)
  const effectiveScope = canExportActive ? scope : 'document'

  const text = useMemo(() => {
    if (!open) return ''
    if (effectiveScope === 'active' && node) {
      return encode({ [node.kind]: node.payload } as BlueprintEnvelope)
    }
    return encode(doc.envelope)
  }, [open, effectiveScope, node, doc.envelope])

  const label =
    effectiveScope === 'active' && node && typeof node.payload['label'] === 'string'
      ? node.payload['label']
      : doc.title

  const copy = async (): Promise<void> => {
    await window.api.clipboard.writeText(text)
    setStatus('Copied to the clipboard.')
  }

  const save = async (): Promise<void> => {
    const saved = await window.api.files.saveBlueprint(text, richTextToPlain(label))
    if (saved) setStatus('Saved.')
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setStatus(null)
        onOpenChange(o)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 flex w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border border-edge bg-panel p-4 shadow-2xl"
          data-testid="export-dialog"
        >
          <Dialog.Title className="m-0 text-[15px] font-semibold">
            Export blueprint string
          </Dialog.Title>
          <Dialog.Description className="m-0 text-ink-muted">
            Paste this string into Factorio with “Import string”.
          </Dialog.Description>
          {canExportActive && (
            <div className="flex gap-4" role="radiogroup">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scope === 'document'}
                  onChange={() => setScope('document')}
                />
                Whole book
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scope === 'active'}
                  onChange={() => setScope('active')}
                />
                Selected item only
              </label>
            </div>
          )}
          <textarea
            readOnly
            value={text}
            data-testid="export-text"
            onFocus={(e) => e.currentTarget.select()}
            className="h-40 resize-none rounded border border-edge bg-panel-2 p-2 font-mono text-[11px] break-all outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            {status && <span className="mr-auto text-ok">{status}</span>}
            <span className="text-[11px] text-ink-muted">
              {text.length.toLocaleString()} characters
            </span>
            <button className="btn" onClick={() => void save()}>
              Save as file…
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void copy()}
              data-testid="export-copy"
            >
              Copy
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
