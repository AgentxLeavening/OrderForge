import { describe, it, expect } from 'vitest'
import { compareToEstimate, effectiveHourlyRate, formatDuration, isRunning, totalMinutes } from '../lib/time'

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0)
const minutesAgo = (n: number) => new Date(NOW - n * 60000).toISOString()

describe('totalMinutes', () => {
  it('sums recorded sessions', () => {
    expect(totalMinutes([
      { minutes: 90, started_at: null, ended_at: null },
      { minutes: '30.5', started_at: null, ended_at: null },
    ], NOW)).toBe(120.5)
  })

  it('counts a running timer up to now', () => {
    expect(totalMinutes([
      { minutes: 60, started_at: null, ended_at: null },
      { minutes: null, started_at: minutesAgo(45), ended_at: null },
    ], NOW)).toBe(105)
  })

  it('never counts a running timer as negative if the clock disagrees', () => {
    expect(totalMinutes([{ minutes: null, started_at: new Date(NOW + 60000).toISOString(), ended_at: null }], NOW)).toBe(0)
  })
})

describe('isRunning', () => {
  it('is true only for a started, unfinished entry with no minutes', () => {
    expect(isRunning({ minutes: null, started_at: minutesAgo(5), ended_at: null })).toBe(true)
    expect(isRunning({ minutes: 30, started_at: minutesAgo(40), ended_at: minutesAgo(10) })).toBe(false)
    expect(isRunning({ minutes: 30, started_at: null, ended_at: null })).toBe(false)
  })
})

describe('formatDuration', () => {
  it('reads as hours and minutes', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(165)).toBe('2h 45m')
    expect(formatDuration(120)).toBe('2h 0m')
    expect(formatDuration(-5)).toBe('0m')
  })
})

describe('compareToEstimate', () => {
  it('reports hours over and percentage of the estimate', () => {
    expect(compareToEstimate(270, 3)).toEqual({ actualHours: 4.5, estimatedHours: 3, overBy: 1.5, percentOfEstimate: 150 })
    expect(compareToEstimate(90, 3)).toEqual({ actualHours: 1.5, estimatedHours: 3, overBy: -1.5, percentOfEstimate: 50 })
  })

  it('handles a missing or useless estimate without dividing by zero', () => {
    expect(compareToEstimate(120, null)).toEqual({ actualHours: 2, estimatedHours: null, overBy: null, percentOfEstimate: null })
    expect(compareToEstimate(120, 0).percentOfEstimate).toBeNull()
  })
})

describe('effectiveHourlyRate', () => {
  const base = { revenue: 200, material: 20, shipping: 10, feeAmt: 12 }

  it('divides what is left after costs by the hours actually worked', () => {
    // 200 − 20 − 10 − 12 = 158, over 4 hours
    expect(effectiveHourlyRate({ ...base, actualHours: 4 })).toBe(39.5)
  })

  it('deliberately ignores estimated labour cost, which would double-count the work', () => {
    // Same inputs regardless of what labor_cost says on the order.
    expect(effectiveHourlyRate({ ...base, actualHours: 8 })).toBe(19.75)
  })

  it('is null with no hours logged', () => {
    expect(effectiveHourlyRate({ ...base, actualHours: 0 })).toBeNull()
  })
})
