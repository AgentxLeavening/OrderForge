-- Allow inventory_transactions to outlive the item they reference so that
-- deletion audit rows survive. Previously inventory_item_id was NOT NULL with
-- ON DELETE CASCADE, which meant a delete either (a) cascaded away the very
-- audit row, or (b) failed the FK when logged after the item was gone.

alter table inventory_transactions
  alter column inventory_item_id drop not null;

alter table inventory_transactions
  drop constraint if exists inventory_transactions_inventory_item_id_fkey;

alter table inventory_transactions
  add constraint inventory_transactions_inventory_item_id_fkey
  foreign key (inventory_item_id) references inventory_items(id) on delete set null;
