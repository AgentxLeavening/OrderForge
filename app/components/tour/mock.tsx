import type { ReactNode } from 'react'
import type { TourState } from './HelpTour'

// Look-alikes of the real form controls, sized down to fit the tour stage. They
// carry `data-target` so the scripted pointer can find them. Keeping the same
// colours and labels as the real screens is the point: what the visitor sees
// animate is what they'll see when they try it.

export const str = (s: TourState, key: string) => String(s[key] ?? '')
export const on = (s: TourState, key: string) => Boolean(s[key])

export function Label({ children, optional }: { children: ReactNode; optional?: boolean }) {
  return (
    <span className="mb-1 block text-[11px] text-gray-400">
      {children}
      {optional && <span className="text-gray-600"> (optional)</span>}
    </span>
  )
}

export function Box({
  target, focused, ring, className = '', children,
}: { target?: string; focused?: boolean; ring?: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      data-target={target}
      className={`flex min-h-[30px] items-center rounded border bg-gray-800 px-2.5 py-1.5 text-xs text-white transition ${
        focused ? 'border-indigo-500' : 'border-gray-700'
      } ${ring ? 'ring-2 ring-indigo-400/70' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

/** A text field: shows what's been typed, or a grey placeholder, plus a caret while focused. */
export function Field({
  label, optional, target, value, placeholder, focused, ring, suffix,
}: {
  label: ReactNode; optional?: boolean; target: string; value: string; placeholder?: string
  focused?: boolean; ring?: boolean; suffix?: string
}) {
  return (
    <div>
      <Label optional={optional}>{label}</Label>
      <Box target={target} focused={focused} ring={ring}>
        {value ? <span>{value}</span> : <span className="text-gray-500">{placeholder}</span>}
        {focused && <span className="tour-caret" />}
        {suffix && <span className="ml-auto pl-2 text-[10px] text-gray-500">{suffix}</span>}
      </Box>
    </div>
  )
}

/** A dropdown that shows its current value. */
export function Select({
  label, target, value, placeholder, ring, focused,
}: { label?: ReactNode; target: string; value: string; placeholder?: string; ring?: boolean; focused?: boolean }) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <Box target={target} ring={ring} focused={focused}>
        {value ? <span className="truncate">{value}</span> : <span className="truncate text-gray-500">{placeholder}</span>}
        <svg viewBox="0 0 20 20" className="ml-auto h-3 w-3 shrink-0 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m5 8 5 5 5-5" />
        </svg>
      </Box>
    </div>
  )
}

export function Button({
  target, primary, children,
}: { target?: string; primary?: boolean; children: ReactNode }) {
  return (
    <div
      data-target={target}
      className={`inline-flex items-center rounded px-3 py-1.5 text-xs font-medium text-white ${
        primary ? 'bg-indigo-600' : 'bg-gray-800'
      }`}
    >
      {children}
    </div>
  )
}

/** The page title row every screen starts with. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h4 className="text-base font-bold text-white">{title}</h4>
      {children}
    </div>
  )
}

/** A short highlighted note that appears on the mock to point something out. */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="tour-fade mt-2.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-200">
      {children}
    </div>
  )
}
