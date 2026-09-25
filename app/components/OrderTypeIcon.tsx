const EMOJI: Record<string, string> = {
  commission: '🎨',
  card_lot: '🃏',
  wholesale: '📦',
  other: '📋',
}

/**
 * The small marker shown beside an order's title. 3D prints use the printer
 * illustration (public/icons/3d-printer.svg); the rest are still emoji. It
 * sizes itself to the surrounding text, so the caller sets the size with a
 * text-* class exactly as it did for the emoji.
 */
export default function OrderTypeIcon({ type, className = '' }: { type: string; className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`} aria-hidden="true">
      {type === 'print_job' ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small decorative image; next/image adds nothing
        <img src="/icons/3d-printer.svg" alt="" className="h-[1.15em] w-auto" />
      ) : (
        EMOJI[type] || EMOJI.other
      )}
    </span>
  )
}
