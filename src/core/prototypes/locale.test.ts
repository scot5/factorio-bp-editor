import { describe, expect, it } from 'vitest'
import { localise, parseLocaleCfg } from './locale'

describe('parseLocaleCfg', () => {
  it('reads sections into section.key, with later files winning', () => {
    const locale = parseLocaleCfg(
      '; comment\r\n[entity-name]\r\nfoundry=Foundry\r\n\r\n[item-name]\nrail=Rail\nempty=\n'
    )
    parseLocaleCfg('[entity-name]\nfoundry=Big foundry\n', locale)
    expect(locale).toEqual({
      'entity-name.foundry': 'Big foundry',
      'item-name.rail': 'Rail',
      'item-name.empty': ''
    })
  })
  it('keeps "=" inside values', () => {
    expect(parseLocaleCfg('[a]\nb=x=y\n')).toEqual({ 'a.b': 'x=y' })
  })
})

describe('localise', () => {
  const locale = {
    'item-name.iron-plate': 'Iron plate',
    'fluid-name.water': 'Water',
    'recipe-name.fill-barrel': 'Fill __1__ barrel',
    'item-name.parameter-x': 'Parameter __1__',
    'entity-name.pole': 'Pole for __ITEM__iron-plate__',
    'recipe-name.loop': '__ENTITY__loop__'
  }
  it('resolves keys with parameters', () => {
    expect(localise(['item-name.iron-plate'], locale)).toBe('Iron plate')
    expect(localise(['recipe-name.fill-barrel', ['fluid-name.water']], locale)).toBe(
      'Fill Water barrel'
    )
    expect(localise(['item-name.parameter-x', '0'], locale)).toBe('Parameter 0')
  })
  it('concatenates "" lists and expands references', () => {
    expect(localise(['', ['item-name.iron-plate'], ' and ', ['fluid-name.water']], locale)).toBe(
      'Iron plate and Water'
    )
    expect(localise(['entity-name.pole'], locale)).toBe('Pole for Iron plate')
  })
  it('returns undefined for missing keys and stops on loops', () => {
    expect(localise(['item-name.nope'], locale)).toBeUndefined()
    expect(localise(42n, locale)).toBeUndefined()
    expect(() =>
      localise(['recipe-name.loop'], { ...locale, 'entity-name.loop': '__RECIPE__loop__' })
    ).not.toThrow()
  })
})
