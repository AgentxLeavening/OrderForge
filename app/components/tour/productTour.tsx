import type { TourState, Tour } from './HelpTour'
import { click, move, set, type, wait } from './HelpTour'
import { Box, Button, Callout, Field, PageHeader, Select, on, str } from './mock'

// Continues the inventory example: a "3D Printed Gift" that uses 25 g of the
// Generic PLA Filament item (at $0.015/g, that's about $0.38 of material).

const ITEM = 'Generic PLA Filament (g)'

function Scene(s: TourState) {
  const focus = str(s, 'focus')
  const rows = Number(s.rows) || 0
  const picked = on(s, 'picked')

  return (
    <div>
      <PageHeader title="Product Templates">
        <Button target="newTemplate" primary>+ New Template</Button>
      </PageHeader>

      {on(s, 'editorOpen') && (
        <div className="tour-fade rounded-xl border border-gray-800 bg-gray-900 p-3">
          <div className="mb-2 text-xs font-semibold text-white">New template</div>

          <div className="space-y-2">
            <Field label="Product name" target="name" value={str(s, 'name')} placeholder="e.g. Resin Trinket Tray" focused={focus === 'name'} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Suggested price ($)" optional target="price" value={str(s, 'price')} placeholder="Auto from markup if blank" focused={focus === 'price'} />
              <Field label="Estimated time (hours)" optional target="time" value={str(s, 'time')} placeholder="e.g. 1.5" focused={focus === 'time'} />
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Bill of Materials</span>
              <Button target="addItem" primary>+ Add item</Button>
            </div>

            {rows > 0 && (
              <div className="tour-fade">
                <div className="mb-1 grid grid-cols-12 gap-2 px-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2">Qty</div>
                  <div className="col-span-3">Unit cost ($)</div>
                </div>
                <div className="relative grid grid-cols-12 items-start gap-2">
                  <div className="col-span-6">
                    <Select target="itemSelect" value={picked ? ITEM : ''} placeholder="Select inventory item…" focused={on(s, 'selOpen')} />
                    {on(s, 'selOpen') && (
                      <div className="tour-fade absolute left-0 top-9 z-10 w-1/2 overflow-hidden rounded border border-gray-700 bg-gray-800 shadow-lg shadow-black/40">
                        <div className="px-2.5 py-1.5 text-xs text-gray-500">Select inventory item…</div>
                        <div data-target="optItem" className="bg-indigo-600 px-2.5 py-1.5 text-xs text-white">{ITEM}</div>
                        <div className="px-2.5 py-1.5 text-xs text-gray-300">Custom item…</div>
                      </div>
                    )}
                  </div>
                  <div className="col-span-2">
                    <Box target="qty" focused={focus === 'qty'}>
                      <span>{str(s, 'qty') || '1'}</span>
                      {focus === 'qty' && <span className="tour-caret" />}
                    </Box>
                    {picked && <span className="pl-1 text-[10px] text-gray-500">g</span>}
                  </div>
                  <div className="col-span-3">
                    <Box>{picked ? '0.015' : '0'}</Box>
                  </div>
                </div>
              </div>
            )}
          </div>

          {on(s, 'math') && <Callout>25 g × $0.015 = <strong>$0.38</strong> of material in every gift</Callout>}

          <div className="mt-3 flex gap-2">
            <Button target="save" primary>Save</Button>
            <Button>Cancel</Button>
          </div>
        </div>
      )}

      {on(s, 'saved') && (
        <div className="tour-fade rounded border border-gray-800 bg-gray-900 p-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-white">3D Printed Gift</div>
              <div className="text-[11px] text-gray-400">Material cost: $0.38 • Suggested: $12.00</div>
            </div>
            <div className="flex gap-2">
              <span className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300">Edit</span>
              <span className="rounded bg-red-600 px-2 py-1 text-[11px] text-white">Delete</span>
            </div>
          </div>
          <div className="mt-2.5 text-[11px] text-gray-400">Bill of materials</div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-gray-200">Generic PLA Filament × 25</span>
            <span className="text-gray-400">$0.015</span>
          </div>
        </div>
      )}

      {!on(s, 'editorOpen') && !on(s, 'saved') && (
        <div className="rounded-xl border border-dashed border-gray-800 px-4 py-10 text-center text-xs text-gray-600">
          No templates yet
        </div>
      )}
    </div>
  )
}

const base: TourState = {
  editorOpen: true, name: '', price: '', time: '', focus: '',
  rows: 0, selOpen: false, picked: false, qty: '', math: false, saved: false,
}
const named: TourState = { ...base, name: '3D Printed Gift', price: '12.00', time: '0.5' }

export const productTour: Tour = {
  title: 'How to build a product',
  slides: [
    {
      title: 'Start a template',
      caption: <>A product template remembers what one item is made from, so you don&apos;t rebuild it for every order. Open <strong className="text-gray-200">Products</strong> and click <strong className="text-gray-200">+ New Template</strong>. We&apos;ll make a &ldquo;3D Printed Gift&rdquo; from the filament you added in Inventory.</>,
      initial: { ...base, editorOpen: false },
      steps: [wait(500), move('newTemplate'), click({ editorOpen: true }), wait(900)],
      scene: Scene,
    },
    {
      title: 'Name it and price it',
      caption: <>Call it <strong className="text-gray-200">3D Printed Gift</strong>. Price and time are optional: leave the price blank and OrderForge suggests one from your markup. We&apos;ll say $12.00 and half an hour.</>,
      initial: { ...base },
      steps: [
        move('name'), click({ focus: 'name' }), type('name', '3D Printed Gift'),
        move('price'), click({ focus: 'price' }), type('price', '12.00'),
        move('time'), click({ focus: 'time' }), type('time', '0.5'),
        set({ focus: '' }), wait(600),
      ],
      scene: Scene,
    },
    {
      title: 'Add a material',
      caption: <>Each line in the <strong className="text-gray-200">Bill of Materials</strong> is one thing the product uses up. Click <strong className="text-gray-200">+ Add item</strong> for the first one.</>,
      initial: { ...named },
      steps: [move('addItem'), click({ rows: 1 }), wait(1200)],
      scene: Scene,
    },
    {
      title: 'Pick it from inventory',
      caption: <>Open the dropdown and choose <strong className="text-gray-200">Generic PLA Filament</strong>. Its cost per gram copies in, and the line is linked to your stock so it can be used up automatically.</>,
      initial: { ...named, rows: 1 },
      steps: [
        move('itemSelect'), click({ selOpen: true }), wait(600),
        move('optItem'), click({ selOpen: false, picked: true }), wait(1000),
      ],
      scene: Scene,
    },
    {
      title: 'How much does one gift use?',
      caption: <>Enter the amount in the item&apos;s own unit. A gift takes <strong className="text-gray-200">25 g</strong> of filament, which at $0.015 a gram is about $0.38 of material.</>,
      initial: { ...named, rows: 1, picked: true },
      steps: [
        move('qty'), click({ focus: 'qty', qty: '' }), type('qty', '25'),
        set({ focus: '', math: true }), wait(1400),
      ],
      scene: Scene,
    },
    {
      title: 'Save it',
      caption: <>Click <strong className="text-gray-200">Save</strong>. From now on, an order made from &ldquo;3D Printed Gift&rdquo; takes 25 g off your Generic PLA Filament automatically, and the material cost counts against your profit.</>,
      initial: { ...named, rows: 1, picked: true, qty: '25', math: true },
      steps: [move('save'), click({ editorOpen: false, saved: true, math: false }), wait(1500)],
      scene: Scene,
    },
  ],
}
