import type { ReactNode } from 'react'
import OrderTypeIcon from '@/app/components/OrderTypeIcon'
import type { Tour, TourState } from './HelpTour'
import { click, move, set, type, wait } from './HelpTour'
import { Button, Callout, Box, on, str } from './mock'

// The dashboard walkthrough. Two mocks: the whole page (for rearranging its
// sections) and the order board (for everything about moving orders). All sample
// orders and figures are made up.

/* ------------------------------ section view ------------------------------ */

const SECTION_TITLES: Record<string, string> = { stats: 'Stats', kanban: 'Orders', analytics: 'Analytics' }

function Grip() {
  return (
    <div className="flex flex-col gap-0.5 opacity-60" aria-hidden="true">
      {[0, 1, 2].map(r => (
        <div key={r} className="flex gap-0.5">
          <div className="h-1 w-1 rounded-full bg-gray-400" />
          <div className="h-1 w-1 rounded-full bg-gray-400" />
        </div>
      ))}
    </div>
  )
}

function Tile({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-2.5 py-2">
      <p className="text-[9px] text-gray-400">{label}</p>
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
    </div>
  )
}

function SectionBody({ id }: { id: string }) {
  if (id === 'stats') {
    return (
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Active Orders" value="6" />
        <Tile label="Orders in View" value="9" />
        <Tile label="Clients in View" value="4" />
      </div>
    )
  }
  if (id === 'analytics') {
    return (
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Est. Revenue" value="$1,240" />
        <Tile label="Est. Profit" value="$610" tone="text-green-400" />
        <Tile label="Avg. Margin" value="49%" />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-4 gap-2">
      {['Inquiry', 'Quoted', 'In Progress', 'Shipped'].map(c => (
        <div key={c} className="rounded-lg border border-gray-800 bg-gray-900 p-1.5">
          <p className="mb-1 text-[9px] font-semibold text-white">{c}</p>
          <div className="h-3 rounded bg-gray-800" />
          <div className="mt-1 h-3 rounded bg-gray-800/60" />
        </div>
      ))}
    </div>
  )
}

function SectionsScene(s: TourState) {
  const order = str(s, 'order').split(',')
  const lifted = str(s, 'lift')
  const hl = str(s, 'hl')
  return (
    <div className="space-y-2.5">
      {order.map(id => (
        <div
          key={id}
          data-target={`sect-${id}`}
          className={`rounded-xl transition ${lifted === id ? 'opacity-30' : ''} ${hl === id ? 'ring-2 ring-indigo-400/70' : ''}`}
        >
          <div data-target={`grip-${id}`} className="mb-1.5 flex w-fit items-center gap-1.5">
            <Grip />
            <span className="text-[9px] uppercase tracking-widest text-gray-500">{SECTION_TITLES[id]}</span>
          </div>
          <SectionBody id={id} />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------- board view ------------------------------- */

type MockCard = { id: string; title: string; num: string; kind: string; client?: string; channel?: string }

const CARDS: MockCard[] = [
  { id: 'mug', title: 'Handmade mug set', num: 'ORD-104271', kind: 'other', client: 'Jordan P.', channel: 'Etsy' },
  { id: 'cards', title: 'Card lot, 50 cards', num: 'ORD-558210', kind: 'card_lot', client: 'Sam R.', channel: 'eBay' },
  { id: 'key', title: 'Custom keychain', num: 'ORD-311904', kind: 'print_job', client: 'Alex T.', channel: 'Direct' },
  { id: 'gift', title: '3D Printed Gift', num: 'ORD-208853', kind: 'print_job', client: 'Casey L.', channel: 'Craft fair' },
]

const COLS: [string, string][] = [
  ['inquiry', 'Inquiry'],
  ['quoted', 'Quoted'],
  ['in_progress', 'In Progress'],
  ['shipped', 'Shipped'],
]

function Chevron({ target, open }: { target?: string; open?: boolean }) {
  return (
    <svg data-target={target} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 shrink-0 text-gray-500 ${open ? 'rotate-180' : ''}`} aria-hidden="true">
      <polyline points="5,8 10,13 15,8" />
    </svg>
  )
}

function MiniCard({ card, dim, flash, expanded, ghost }: { card: MockCard; dim?: boolean; flash?: boolean; expanded?: boolean; ghost?: boolean }) {
  return (
    <div
      data-target={ghost ? undefined : `card-${card.id}`}
      className={`rounded-lg border bg-gray-800 px-2 py-1.5 transition ${
        dim ? 'border-dashed border-gray-700 opacity-30' : flash ? 'border-indigo-500 ring-2 ring-indigo-400/60' : 'border-gray-700'
      } ${ghost ? 'border-indigo-500 shadow-lg shadow-indigo-500/30' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <OrderTypeIcon type={card.kind} className="text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium leading-snug text-white">{card.title}</p>
          <p className="font-mono text-[9px] leading-tight text-gray-500">{card.num}</p>
        </div>
        <Chevron target={ghost ? undefined : `chev-${card.id}`} open={expanded} />
      </div>
      {expanded && (
        <div className="tour-fade mt-1.5 flex flex-wrap gap-1">
          <span className="rounded-full bg-gray-900 px-1.5 py-0.5 text-[9px] text-gray-300">{card.client}</span>
          <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] text-indigo-300">{card.channel}</span>
        </div>
      )}
    </div>
  )
}

function BoardScene(s: TourState) {
  const shown = str(s, 'cards').split(',').filter(Boolean)
  const q = str(s, 'q').trim().toLowerCase()
  const carrying = str(s, 'carryId')
  const flash = str(s, 'flash')
  const doneCount = 3 + CARDS.filter(c => str(s, `pos_${c.id}`) === 'complete' && shown.includes(c.id)).length

  return (
    <div>
      {on(s, 'top') && (
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-white">Hey, Alex 👋</h4>
            <p className="text-[10px] text-gray-400">Here is what is going on with your orders.</p>
          </div>
          <Button target="newOrder" primary>+ New Order</Button>
        </div>
      )}

      {on(s, 'search') && (
        <div className="mb-2.5">
          <Box target="search" focused={str(s, 'focus') === 'search'}>
            {q ? <span>{str(s, 'q')}</span> : <span className="text-gray-500">Search orders or client names...</span>}
            {str(s, 'focus') === 'search' && <span className="tour-caret" />}
          </Box>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {COLS.map(([key, label]) => {
          const inCol = CARDS.filter(c => shown.includes(c.id) && str(s, `pos_${c.id}`) === key && (!q || c.title.toLowerCase().includes(q) || (c.client || '').toLowerCase().includes(q)))
          return (
            <div key={key} data-target={`col-${key}`} className={`min-h-[7.5rem] rounded-xl border bg-gray-900 p-2 transition ${str(s, 'hlCol') === key ? 'border-indigo-500/70' : 'border-gray-800'}`}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="truncate text-[10px] font-semibold text-white">{label}</span>
                <span className="rounded-full bg-gray-800 px-1.5 text-[9px] font-bold text-gray-400">{inCol.length}</span>
              </div>
              <div className="space-y-1.5">
                {inCol.map(c => (
                  <MiniCard key={c.id} card={c} dim={carrying === c.id} flash={flash === c.id} expanded={str(s, 'expanded') === c.id} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {on(s, 'archive') && (
        <div className="mt-2 space-y-1.5">
          <div data-target="arch-complete" className={`flex items-center justify-between rounded-xl border bg-gray-900 px-3 py-1.5 transition ${flash === 'complete' ? 'border-indigo-500 ring-2 ring-indigo-400/60' : 'border-gray-800'}`}>
            <span className="text-[10px] font-semibold text-white">Complete <span className="ml-1 rounded-full bg-gray-800 px-1.5 text-[9px] text-gray-400">{doneCount}</span></span>
            <Chevron />
          </div>
          <div data-target="arch-cancelled" className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-3 py-1.5">
            <span className="text-[10px] font-semibold text-white">Cancelled <span className="ml-1 rounded-full bg-gray-800 px-1.5 text-[9px] text-gray-400">1</span></span>
            <Chevron />
          </div>
        </div>
      )}

      {str(s, 'note') === 'sync' && <Callout>Synced from Etsy: this order moved to Shipped on its own.</Callout>}
      {str(s, 'note') === 'new' && <Callout>New orders start in <strong>Inquiry</strong>.</Callout>}
      {str(s, 'note') === 'cancel' && <Callout>Dropping on <strong>Cancelled</strong> asks you to confirm first, and puts the materials back in inventory.</Callout>}
    </div>
  )
}

/* -------------------------- what the pointer holds -------------------------- */

const carried = (s: TourState): ReactNode => {
  const what = str(s, 'carry')
  if (what === 'card') {
    const card = CARDS.find(c => c.id === str(s, 'carryId'))
    return card ? (
      <div className="pointer-events-none absolute left-3 top-3 w-40 rotate-2">
        <MiniCard card={card} ghost />
      </div>
    ) : null
  }
  if (what === 'section') {
    return (
      <div className="pointer-events-none absolute left-3 top-3 flex w-32 items-center gap-1.5 rounded-lg border border-indigo-500 bg-gray-900 px-2 py-1.5 shadow-lg shadow-indigo-500/30">
        <Grip />
        <span className="text-[9px] uppercase tracking-widest text-gray-300">{SECTION_TITLES[str(s, 'lift')]}</span>
      </div>
    )
  }
  return null
}

/* --------------------------------- the tour --------------------------------- */

const board: TourState = {
  top: false, search: false, archive: false, cards: 'mug,cards,key,gift', q: '', focus: '', flash: '', note: '',
  expanded: '', carry: '', carryId: '', hlCol: '',
  pos_mug: 'in_progress', pos_cards: 'shipped', pos_key: 'none', pos_gift: 'quoted',
}

export const dashboardTour: Tour = {
  title: 'How to use the dashboard',
  slides: [
    {
      title: 'Your dashboard at a glance',
      caption: <>The dashboard has three sections: <strong className="text-gray-200">Stats</strong> (how much is on your plate), <strong className="text-gray-200">Orders</strong> (the board, where every order lives) and <strong className="text-gray-200">Analytics</strong> (estimated revenue, profit and margin).</>,
      initial: { order: 'stats,kanban,analytics', lift: '', hl: '', carry: '' },
      steps: [wait(500), set({ hl: 'stats' }), wait(1300), set({ hl: 'kanban' }), wait(1300), set({ hl: 'analytics' }), wait(1300), set({ hl: '' })],
      scene: SectionsScene,
    },
    {
      title: 'Arrange the sections your way',
      caption: <>Grab the dots next to a section&apos;s name and drag it up or down. Want your profit above the board? Drag <strong className="text-gray-200">Analytics</strong> up. Your order is saved to your account, so it&apos;s the same next time you sign in.</>,
      initial: { order: 'stats,kanban,analytics', lift: '', hl: '', carry: '' },
      steps: [
        move('grip-analytics'), set({ lift: 'analytics', carry: 'section' }),
        move('grip-kanban'), set({ order: 'stats,analytics,kanban', lift: '', carry: '' }), wait(1600),
      ],
      scene: SectionsScene,
      carried,
    },
    {
      title: 'Orders from your shops move themselves',
      caption: <>Connected shops (Etsy, eBay and Shopify) bring their orders in and keep them up to date as they ship and are delivered, so there&apos;s nothing to drag. Connect them in <strong className="text-gray-200">Settings</strong>.</>,
      initial: { ...board, cards: 'mug,cards', pos_mug: 'in_progress', pos_cards: 'shipped' },
      steps: [wait(1400), set({ pos_mug: 'shipped', flash: 'mug', note: 'sync' }), wait(1800)],
      scene: BoardScene,
      carried,
    },
    {
      title: 'Add an order you took yourself',
      caption: <>A commission, a craft-fair sale, a message from a friend: anything that didn&apos;t come from a connected shop. Click <strong className="text-gray-200">+ New Order</strong>, fill in the details, and it appears on the board in Inquiry.</>,
      initial: { ...board, top: true, cards: 'mug,cards,key', pos_mug: 'shipped', pos_cards: 'shipped', pos_key: 'none' },
      steps: [
        wait(400), move('newOrder'), click(), set({ pos_key: 'inquiry', flash: 'key', note: 'new' }), wait(1800),
      ],
      scene: BoardScene,
      carried,
    },
    {
      title: 'Move it along by dragging',
      caption: <>These orders are yours to move. As the job progresses, press on the card and drag it to the next column: Inquiry, then Quoted, then In Progress.</>,
      initial: { ...board, cards: 'key,gift,mug', pos_key: 'inquiry', pos_gift: 'quoted', pos_mug: 'in_progress' },
      steps: [
        move('card-key'), set({ carry: 'card', carryId: 'key', hlCol: 'quoted' }),
        move('col-quoted'), set({ carry: '', carryId: '', pos_key: 'quoted', flash: 'key', hlCol: '' }), wait(500),
        move('card-key'), set({ carry: 'card', carryId: 'key', hlCol: 'in_progress', flash: '' }),
        move('col-in_progress'), set({ carry: '', carryId: '', pos_key: 'in_progress', flash: 'key', hlCol: '' }), wait(1500),
      ],
      scene: BoardScene,
      carried,
    },
    {
      title: 'Finish it, or cancel it',
      caption: <>When it ships, drag it to Shipped. When it&apos;s done, drag it down onto <strong className="text-gray-200">Complete</strong>. That bar and <strong className="text-gray-200">Cancelled</strong> sit under the board and take a drop even while they&apos;re folded shut.</>,
      initial: { ...board, archive: true, cards: 'key,cards', pos_key: 'shipped', pos_cards: 'shipped' },
      steps: [
        move('card-key'), set({ carry: 'card', carryId: 'key' }),
        move('arch-complete'), set({ carry: '', carryId: '', pos_key: 'complete', flash: 'complete' }), wait(600),
        set({ note: 'cancel', flash: '' }), wait(2000),
      ],
      scene: BoardScene,
      carried,
    },
    {
      title: 'Peek inside, search, and filter',
      caption: <>Click a card to open the full order. The arrow on its right shows the client and sales channel without leaving the board. The search box, client menu and status filter above the board narrow down what you see.</>,
      initial: { ...board, search: true, cards: 'mug,cards,key,gift', pos_mug: 'in_progress', pos_cards: 'shipped', pos_key: 'inquiry', pos_gift: 'quoted' },
      steps: [
        move('chev-key'), click({ expanded: 'key' }), wait(1400),
        set({ expanded: '' }), move('search'), click({ focus: 'search' }), type('q', 'key'), wait(1600),
      ],
      scene: BoardScene,
      carried,
    },
  ],
}
