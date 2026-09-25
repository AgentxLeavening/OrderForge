'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

// A tour is a set of slides. Each slide is a small mock of the real screen plus
// a script (`steps`) that drives a pretend mouse pointer around it: moving to a
// button, clicking, typing into a field. The scene is just a function of the
// current state, so the script only has to change state and say where to point.

export type TourState = Record<string, string | number | boolean>

export type Step =
  | { do: 'move'; to: string }
  | { do: 'click'; set?: TourState }
  | { do: 'type'; key: string; text: string }
  | { do: 'set'; state: TourState }
  | { do: 'wait'; ms: number }

export const move = (to: string): Step => ({ do: 'move', to })
export const click = (set?: TourState): Step => ({ do: 'click', set })
export const type = (key: string, text: string): Step => ({ do: 'type', key, text })
export const set = (state: TourState): Step => ({ do: 'set', state })
export const wait = (ms: number): Step => ({ do: 'wait', ms })

export type Slide = {
  title: string
  caption: ReactNode
  /** What the mock looks like before the script runs. Each slide starts where
      the last one ended, so the story carries across slides. */
  initial: TourState
  steps: Step[]
  scene: (s: TourState) => ReactNode
  /** Something the pointer is holding, drawn attached to it so it travels with
      the pointer — a card or a section being dragged. Return null when the
      pointer is empty-handed. */
  carried?: (s: TourState) => ReactNode
}

export type Tour = { title: string; slides: Slide[] }

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Where a slide ends up once its script has run — shown as-is, with no motion,
// for people who've asked their system for reduced motion.
function finalState(slide: Slide): TourState {
  let s = { ...slide.initial }
  for (const step of slide.steps) {
    if (step.do === 'set') s = { ...s, ...step.state }
    else if (step.do === 'click' && step.set) s = { ...s, ...step.set }
    else if (step.do === 'type') s = { ...s, [step.key]: step.text }
  }
  return s
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

function Stage({ slide }: { slide: Slide }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [reduced] = useState(prefersReducedMotion)
  const [state, setState] = useState<TourState>(() => (reduced ? finalState(slide) : slide.initial))
  const [cursor, setCursor] = useState({ x: 24, y: 24, visible: false, pressed: false })
  const [ripple, setRipple] = useState(0)

  useEffect(() => {
    if (reduced) return
    let cancelled = false

    // Aim the pointer's tip at the middle-left of a target, so it lands on the
    // text of a field rather than the empty end of a long box.
    const point = (name: string) => {
      const stage = stageRef.current
      const el = stage?.querySelector(`[data-target="${name}"]`)
      if (!stage || !el) return null
      const a = el.getBoundingClientRect()
      const b = stage.getBoundingClientRect()
      return { x: a.left - b.left + Math.min(a.width / 2, 70), y: a.top - b.top + a.height / 2 }
    }

    const run = async () => {
      await sleep(600)
      while (!cancelled) {
        for (const step of slide.steps) {
          if (cancelled) return
          if (step.do === 'move') {
            await nextFrame()
            const p = point(step.to)
            if (p) setCursor(c => ({ ...c, ...p, visible: true }))
            await sleep(850)
          } else if (step.do === 'click') {
            setCursor(c => ({ ...c, pressed: true }))
            setRipple(r => r + 1)
            await sleep(150)
            setCursor(c => ({ ...c, pressed: false }))
            if (step.set) setState(s => ({ ...s, ...step.set }))
            await sleep(400)
          } else if (step.do === 'type') {
            for (let i = 1; i <= step.text.length; i++) {
              if (cancelled) return
              setState(s => ({ ...s, [step.key]: step.text.slice(0, i) }))
              await sleep(60)
            }
            await sleep(350)
          } else if (step.do === 'set') {
            setState(s => ({ ...s, ...step.state }))
            await sleep(300)
          } else {
            await sleep(step.ms)
          }
        }
        // Rest on the finished result, then play it again from the top.
        await sleep(3200)
        if (cancelled) return
        setCursor(c => ({ ...c, visible: false }))
        setState(slide.initial)
        await sleep(900)
      }
    }
    run()
    return () => { cancelled = true }
  }, [slide, reduced])

  return (
    <div ref={stageRef} className="relative h-[27rem] overflow-hidden rounded-xl border border-gray-800 bg-gray-950 p-4 text-left select-none">
      {slide.scene(state)}

      {!reduced && (
        <div
          className="pointer-events-none absolute left-0 top-0 z-20"
          style={{
            transform: `translate(${cursor.x}px, ${cursor.y}px)`,
            transition: 'transform 800ms cubic-bezier(0.45, 0.05, 0.2, 1), opacity 200ms',
            opacity: cursor.visible ? 1 : 0,
          }}
          aria-hidden="true"
        >
          {ripple > 0 && <span key={ripple} className="tour-ripple" />}
          <svg
            width="22" height="22" viewBox="0 0 24 24"
            style={{ transform: cursor.pressed ? 'scale(0.82)' : 'scale(1)', transformOrigin: '3px 2px', transition: 'transform 120ms' }}
          >
            <path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          {slide.carried?.(state)}
        </div>
      )}
    </div>
  )
}

export default function HelpTour({ tour, onClose }: { tour: Tour; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  // Bumping this remounts the stage, which is what "Replay" means.
  const [replay, setReplay] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const last = tour.slides.length - 1
  const slide = tour.slides[index]

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, last))
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, last])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 sm:p-6"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={tour.title}
        className="w-full max-w-2xl max-h-[94vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50 focus:outline-none"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div>
            <h2 className="text-white font-semibold text-sm">{tour.title}</h2>
            <p className="text-gray-500 text-xs">Step {index + 1} of {tour.slides.length}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="p-2 -mr-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="w-4 h-4" aria-hidden="true">
              <line x1="5" y1="5" x2="15" y2="15" />
              <line x1="15" y1="5" x2="5" y2="15" />
            </svg>
          </button>
        </div>

        <div className="p-4 sm:p-5">
          <Stage key={`${index}-${replay}`} slide={slide} />

          <div key={index} className="tour-fade mt-4 min-h-[5.5rem]" aria-live="polite">
            <h3 className="text-white font-semibold">{slide.title}</h3>
            <p className="text-gray-400 text-sm leading-relaxed mt-1">{slide.caption}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-800">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Steps">
            {tour.slides.map((s, i) => (
              <button
                key={s.title}
                role="tab"
                aria-selected={i === index}
                aria-label={`Step ${i + 1}: ${s.title}`}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${i === index ? 'w-6 bg-indigo-500' : 'w-2 bg-gray-700 hover:bg-gray-500'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReplay(r => r + 1)}
              className="text-xs text-gray-400 hover:text-white px-2 py-1.5 transition"
            >
              ↻ Replay
            </button>
            <button
              onClick={() => setIndex(i => Math.max(i - 1, 0))}
              disabled={index === 0}
              className="text-sm text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-1.5 transition disabled:opacity-30 disabled:hover:border-gray-700 disabled:hover:text-gray-300"
            >
              Back
            </button>
            {index < last ? (
              <button
                onClick={() => setIndex(i => i + 1)}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg px-4 py-1.5 transition"
              >
                Next
              </button>
            ) : (
              <button
                onClick={onClose}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg px-4 py-1.5 transition"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A "? Help" button that matches the page headers it sits in. */
export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 rounded px-3 py-2 transition"
    >
      <span className="w-4 h-4 rounded-full border border-current text-[10px] leading-none flex items-center justify-center" aria-hidden="true">?</span>
      Help
    </button>
  )
}
