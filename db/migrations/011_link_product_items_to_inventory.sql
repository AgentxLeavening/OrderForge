-- Let a template's bill-of-materials line reference an actual inventory item,
-- so it inherits that item's unit + cost and order deduction can match it
-- directly (instead of by name/SKU). Nullable: BOM lines may be custom/unlinked.

ALTER TABLE IF EXISTS product_items
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS product_items_inventory_item_id_idx ON product_items(inventory_item_id);
