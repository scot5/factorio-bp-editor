import clsx from 'clsx'
import { ENTITY_SIZES_GAME_VERSION } from '@core/prototypes'
import { useAssets } from '../store/assets'

/**
 * Game data status in the status bar, with the action that moves it forward.
 * The game is only started when the user clicks "Load game data".
 */
export function GameDataStatus(): React.JSX.Element {
  const status = useAssets((s) => s.status)
  const load = useAssets((s) => s.load)
  const chooseGamePath = useAssets((s) => s.chooseGamePath)
  const version = status.install?.version

  const action = (label: string, onClick: () => void, testId: string): React.JSX.Element => (
    <button
      className="rounded border border-accent/60 px-1.5 leading-4 text-accent hover:bg-accent/10"
      onClick={onClick}
      data-testid={testId}
    >
      {label}
    </button>
  )

  return (
    <span
      className="flex items-center gap-2"
      data-testid="game-data-status"
      data-state={status.state}
    >
      {status.state === 'detecting' && <span>Looking for Factorio…</span>}
      {status.state === 'no-install' && (
        <>
          <span title={`Using built-in sizes (${ENTITY_SIZES_GAME_VERSION}); no icons`}>
            Factorio not found
          </span>
          {action('Locate Factorio…', () => void chooseGamePath(), 'locate-factorio')}
        </>
      )}
      {status.state === 'not-loaded' && (
        <>
          <span title={status.install?.path}>Factorio {version} found</span>
          {action('Load game data', () => void load(), 'load-game-data')}
        </>
      )}
      {status.state === 'loading' && (
        <span className="text-accent" role="status">
          {status.message ?? 'Loading game data…'}
        </span>
      )}
      {status.state === 'ready' && (
        <span
          title={`${status.install?.path}\nMods: ${status.mods?.map((m) => `${m.name} ${m.version}`).join(', ')}`}
        >
          Game data: Factorio {version}
          {status.mods && status.mods.length > 1 && ` + ${status.mods.length - 1} mods`}
        </span>
      )}
      {status.state === 'error' && (
        <>
          <span className={clsx('max-w-96 truncate text-danger')} title={status.message}>
            {status.message}
          </span>
          {action(status.gameRunning ? 'Retry' : 'Try again', () => void load(), 'load-game-data')}
        </>
      )}
    </span>
  )
}
