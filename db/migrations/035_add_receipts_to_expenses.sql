-- Receipt photos on expenses: snap the receipt at the market, attach it to the
-- expense, and stop keeping a shoebox. The first use of Supabase Storage in
-- this app.
alter table expenses
  add column if not exists receipt_path text;

-- Private bucket — a receipt carries a name, an address and sometimes a card's
-- last four. Files are read through short-lived signed URLs, never a public
-- link that would work forever for anyone who ever saw it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false,
  10485760, -- 10 MB: a phone photo is 2-5 MB, a scanned PDF less
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

-- Every object lives under <user_id>/..., and these policies only ever let a
-- user touch their own folder. `storage.foldername(name)` splits the path, so
-- the first segment is the owning user — a path the client can propose but not
-- fake, because the policy compares it with auth.uid().
drop policy if exists "Users read own receipts" on storage.objects;
create policy "Users read own receipts" on storage.objects
  for select using (
    bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users upload own receipts" on storage.objects;
create policy "Users upload own receipts" on storage.objects
  for insert with check (
    bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users delete own receipts" on storage.objects;
create policy "Users delete own receipts" on storage.objects
  for delete using (
    bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]
  );
