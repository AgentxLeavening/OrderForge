-- Recurring expenses: subscriptions, a storage unit, an annual domain or
-- insurance renewal, a quarterly market pitch.
--
-- `recurrence` marks the TEMPLATE and how often it comes round; each period's
-- actual spend is still its own row, created only when the seller confirms it
-- on the expenses page, so the books never contain money they didn't put there
-- (their call: silent auto-adding would keep billing a cancelled subscription).
-- `recurring_source_id` points a generated row back at its template, which is
-- what makes "has this period been recorded yet?" answerable exactly, rather
-- than guessed from matching amounts and vendors.
alter table expenses
  add column if not exists recurrence text
    check (recurrence is null or recurrence in ('monthly', 'quarterly', 'yearly')),
  add column if not exists recurring_source_id uuid references expenses(id) on delete set null;

create index if not exists expenses_recurring_source_idx on expenses(recurring_source_id);
create index if not exists expenses_recurrence_idx on expenses(user_id) where recurrence is not null;
