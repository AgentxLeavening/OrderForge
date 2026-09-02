-- Categorize inventory items and track their unit of measure, so materials
-- (filament/resin) can be tracked by weight/volume while finished goods and
-- components are counted as discrete units.
--
--   category: material | finished | component | packaging
--   unit:     each | g | kg | ml | l
--
-- Existing rows default to component/each, which matches how they were counted
-- before this migration.

ALTER TABLE IF EXISTS inventory_items
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'component',
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'each';
