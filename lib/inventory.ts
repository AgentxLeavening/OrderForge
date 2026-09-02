// Shared inventory taxonomy: item categories and units of measure.
// Materials (filament, resin) are tracked by weight/volume; finished goods and
// components are counted as discrete units ("each").

export type InventoryCategory = {
  value: string
  label: string
  defaultUnit: string
}

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  { value: 'material', label: 'Material (by weight/volume)', defaultUnit: 'g' },
  { value: 'finished', label: 'Finished good', defaultUnit: 'each' },
  { value: 'component', label: 'Component / part', defaultUnit: 'each' },
  { value: 'packaging', label: 'Packaging', defaultUnit: 'each' },
]

export const INVENTORY_UNITS: { value: string; label: string }[] = [
  { value: 'each', label: 'each' },
  { value: 'g', label: 'grams (g)' },
  { value: 'kg', label: 'kilograms (kg)' },
  { value: 'ml', label: 'milliliters (ml)' },
  { value: 'l', label: 'liters (l)' },
]

export const categoryLabel = (value: string | null | undefined) =>
  INVENTORY_CATEGORIES.find(c => c.value === value)?.label ?? (value || 'Component / part')

export const defaultUnitForCategory = (value: string | null | undefined) =>
  INVENTORY_CATEGORIES.find(c => c.value === value)?.defaultUnit ?? 'each'

// Short unit for inline display next to a quantity, e.g. "1000 g", "12 each".
export const unitShort = (value: string | null | undefined) => value || 'each'
