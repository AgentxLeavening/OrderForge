import type { TourState, Tour } from './HelpTour'
import { click, move, set, type, wait } from './HelpTour'
import { Button, Callout, Field, PageHeader, Select, on, str } from './mock'

// The worked example: a spool of Generic PLA Filament bought for $15 that
// holds 1000 g, so it costs $0.015 per gram.

const CATEGORY = 'Material (weight, volume or length)'
const UNIT = 'grams (g)'

function Scene(s: TourState) {
  const focus = str(s, 'focus')
  return (
    <div>
      <PageHeader title="Inventory">
        <Button target="newItem" primary>+ New Item</Button>
      </PageHeader>

      {on(s, 'formOpen') && (
        <div className="tour-fade rounded-xl border border-gray-800 bg-gray-900 p-3">
          <div className="mb-2 text-xs font-semibold text-white">New item</div>
          <div className="space-y-2.5">
            <Field label="Name" target="name" value={str(s, 'name')} placeholder="e.g. Black PLA filament" focused={focus === 'name'} />

            <div className="grid grid-cols-2 gap-3">
              <Select label="Category" target="category" value={CATEGORY} ring={str(s, 'hl') === 'catunit'} />
              <Select label="Unit of measure" target="unit" value={UNIT} ring={str(s, 'hl') === 'catunit'} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Quantity on hand (g)" target="qty" value={str(s, 'qty')} placeholder="0" focused={focus === 'qty'} />
              <Field label="Total paid ($)" optional target="total" value={str(s, 'total')} placeholder="e.g. 15.00" focused={focus === 'total'} />
              <Field label="Cost per g ($)" target="cost" value={str(s, 'cost')} placeholder="0" focused={focus === 'cost'} ring={str(s, 'hl') === 'cost'} />
            </div>

            <Field label="Reorder threshold (g)" optional target="threshold" value={str(s, 'threshold')} placeholder="Leave blank for no alert" focused={focus === 'threshold'} />
          </div>

          {on(s, 'math') && <Callout>We divide for you: $15 ÷ 1000 g = <strong>$0.015</strong> per gram</Callout>}
          {on(s, 'manual') && <Callout>Already know the per-gram price? Type it and skip the total.</Callout>}

          <div className="mt-3 flex gap-2">
            <Button target="save" primary>Save</Button>
            <Button>Cancel</Button>
          </div>
        </div>
      )}

      {on(s, 'saved') && (
        <div className="tour-fade rounded-xl border border-gray-800 bg-gray-900 p-2">
          <div className="mb-1.5 grid grid-cols-12 gap-2 px-2 text-[10px] uppercase tracking-wide text-gray-500">
            <div className="col-span-4">Name</div>
            <div className="col-span-3">Category</div>
            <div className="col-span-2 text-center">On hand</div>
            <div className="col-span-2 text-right">Cost</div>
            <div className="col-span-1" />
          </div>
          <div className="grid grid-cols-12 items-center gap-2 rounded-lg bg-gray-800 px-2 py-2.5 text-xs">
            <div className="col-span-4 text-white">Generic PLA Filament</div>
            <div className="col-span-3"><span className="rounded-full bg-gray-700 px-2 py-0.5 text-[10px] text-gray-300">Material</span></div>
            <div className="col-span-2 text-center text-white">1000 <span className="text-[10px] text-gray-500">g</span></div>
            <div className="col-span-2 text-right text-gray-400">$0.015</div>
            <div className="col-span-1 text-right text-gray-400">Edit</div>
          </div>
        </div>
      )}

      {!on(s, 'formOpen') && !on(s, 'saved') && (
        <div className="rounded-xl border border-dashed border-gray-800 px-4 py-10 text-center text-xs text-gray-600">
          Nothing here yet
        </div>
      )}
    </div>
  )
}

const base: TourState = { formOpen: true, name: '', qty: '', total: '', cost: '', threshold: '', focus: '', hl: '', math: false, manual: false, saved: false }

export const inventoryTour: Tour = {
  title: 'How to use Inventory',
  slides: [
    {
      title: 'Add your first item',
      caption: <>Open <strong className="text-gray-200">Inventory</strong> and click <strong className="text-gray-200">+ New Item</strong>. We&apos;ll add a spool of filament: Generic PLA Filament, $15 for 1000 grams.</>,
      initial: { ...base, formOpen: false },
      steps: [wait(500), move('newItem'), click({ formOpen: true }), wait(900)],
      scene: Scene,
    },
    {
      title: 'Give it a name',
      caption: 'Use a name you’ll recognize later, when you’re picking materials for a product.',
      initial: { ...base },
      steps: [move('name'), click({ focus: 'name' }), type('name', 'Generic PLA Filament'), wait(500)],
      scene: Scene,
    },
    {
      title: 'Category and unit',
      caption: <>Filament is a <strong className="text-gray-200">Material</strong>, which is measured rather than counted, so the unit is grams. (Things sold by length, like leather or ribbon, use inches, feet, yards or meters. Finished goods and parts are counted <em>each</em>.) These two are already right for filament, so leave them.</>,
      initial: { ...base, name: 'Generic PLA Filament' },
      steps: [move('category'), set({ hl: 'catunit' }), move('unit'), wait(1500)],
      scene: Scene,
    },
    {
      title: 'How much you have, and what you paid',
      caption: <>Quantity on hand is what&apos;s on the spool: <strong className="text-gray-200">1000 g</strong>. Then enter the total you paid, <strong className="text-gray-200">$15</strong>, and OrderForge divides it for you. Cost per gram fills in as $0.015, with no maths needed.</>,
      initial: { ...base, name: 'Generic PLA Filament', hl: '' },
      steps: [
        move('qty'), click({ focus: 'qty' }), type('qty', '1000'),
        move('total'), click({ focus: 'total' }), type('total', '15'),
        set({ focus: '', cost: '0.015', math: true, hl: 'cost' }), wait(1400),
      ],
      scene: Scene,
    },
    {
      title: 'Or type the cost per gram yourself',
      caption: <>If you already know the per-gram price, skip the total and type it straight into <strong className="text-gray-200">Cost per g</strong>. Whatever you type there replaces any total you entered, so the two never disagree.</>,
      initial: { ...base, name: 'Generic PLA Filament', qty: '1000' },
      steps: [
        move('cost'), click({ focus: 'cost' }), type('cost', '0.015'),
        set({ focus: '', manual: true }), wait(1400),
      ],
      scene: Scene,
    },
    {
      title: 'Optional low-stock alert, then save',
      caption: <>Type <strong className="text-gray-200">200</strong> and the dashboard warns you when the spool is down to 200 g. Click <strong className="text-gray-200">Save</strong> and it&apos;s in your list, ready to use in a product.</>,
      initial: { ...base, name: 'Generic PLA Filament', qty: '1000', total: '15', cost: '0.015', math: true },
      steps: [
        move('threshold'), click({ focus: 'threshold' }), type('threshold', '200'),
        set({ focus: '' }), move('save'), click({ formOpen: false, saved: true, math: false }), wait(1500),
      ],
      scene: Scene,
    },
  ],
}
