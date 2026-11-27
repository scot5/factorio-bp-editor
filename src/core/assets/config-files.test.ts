import { describe, expect, it } from 'vitest'
import {
  parseEnabledMods,
  parseIni,
  parseSteamLibraryFolders,
  resolveWriteDataDir
} from './config-files'

const VDF = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"apps"
		{
			"228980"		"542346576"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
		"apps"
		{
			"427520"		"5193874422"
		}
	}
}`

describe('parseSteamLibraryFolders', () => {
  it('reads every library path and unescapes backslashes', () => {
    expect(parseSteamLibraryFolders(VDF)).toEqual([
      'C:\\Program Files (x86)\\Steam',
      'D:\\SteamLibrary'
    ])
  })
  it('returns nothing for unrelated text', () => {
    expect(parseSteamLibraryFolders('{}')).toEqual([])
  })
})

describe('parseIni', () => {
  it('groups keys by section and skips comments', () => {
    expect(
      parseIni(
        'top=1\n; comment\n[path]\nread-data=__PATH__executable__/../../data\n# x\nwrite-data = D:/fw\n'
      )
    ).toEqual({
      '': { top: '1' },
      path: { 'read-data': '__PATH__executable__/../../data', 'write-data': 'D:/fw' }
    })
  })
})

describe('resolveWriteDataDir', () => {
  const ctx = {
    installDir: 'D:/Factorio',
    executableDir: 'D:/Factorio/bin/x64',
    systemWriteData: 'C:/Users/u/AppData/Roaming/Factorio',
    systemReadData: 'D:/Factorio/data'
  }
  // The real config-path.cfg of a Steam install (comments trimmed).
  const steamCfg =
    'config-path=__PATH__system-write-data__/config\nuse-system-read-write-data-directories=true\n'

  it('uses the system directory for Steam installs', () => {
    const reads: string[] = []
    const dir = resolveWriteDataDir(steamCfg, ctx, (configDir) => {
      reads.push(configDir)
      return '[path]\nread-data=__PATH__executable__/../../data\nwrite-data=__PATH__system-write-data__\n'
    })
    expect(reads).toEqual(['C:/Users/u/AppData/Roaming/Factorio/config'])
    expect(dir).toBe('C:/Users/u/AppData/Roaming/Factorio')
  })

  it('follows a custom write-data path in config.ini', () => {
    expect(resolveWriteDataDir(steamCfg, ctx, () => '[path]\nwrite-data=E:/FactorioData\n')).toBe(
      'E:/FactorioData'
    )
  })

  it('keeps data next to the install for zip installs', () => {
    const reads: string[] = []
    const dir = resolveWriteDataDir('use-system-read-write-data-directories=false', ctx, (d) => {
      reads.push(d)
      return null
    })
    expect(reads).toEqual(['D:/Factorio/config'])
    expect(dir).toBe('D:/Factorio')
    expect(resolveWriteDataDir(null, ctx, () => null)).toBe('D:/Factorio')
  })
})

describe('parseEnabledMods', () => {
  it('lists enabled mods in order', () => {
    const json = JSON.stringify({
      mods: [
        { name: 'base', enabled: true },
        { name: 'space-age', enabled: true },
        { name: 'krastorio2', enabled: false }
      ]
    })
    expect(parseEnabledMods(json)).toEqual(['base', 'space-age'])
  })
})
