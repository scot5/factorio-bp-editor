import { useEffect, useState } from 'react'
import type { AppInfo } from '@core/ipc'

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.api.app.getInfo().then(setInfo)
  }, [])

  return (
    <main className="placeholder">
      <h1>Factorio Blueprint Editor</h1>
      <p>Hello. The viewer arrives in milestone M2.</p>
      {info && (
        <p className="versions" data-testid="versions">
          v{info.appVersion} · Electron {info.electronVersion} · Chrome {info.chromeVersion} · Node{' '}
          {info.nodeVersion}
        </p>
      )}
    </main>
  )
}
