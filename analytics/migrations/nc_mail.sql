-- Email series: unsubscribe token on each lead, plus a queue of scheduled emails. Private: RLS on, no public policies.
alter table public.nc_leads add column if not exists token uuid not null default gen_random_uuid();
alter table public.nc_leads add column if not exists unsubscribed_at timestamptz;
create unique index if not exists nc_leads_token_idx on public.nc_leads (token);

create table if not exists public.nc_mail_queue (
  id bigserial primary key,
  lead_id bigint not null references public.nc_leads(id) on delete cascade,
  step text not null,
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','skipped','failed')),
  note text,
  sent_at timestamptz,
  unique (lead_id, step)
);
create index if not exists nc_mail_queue_due on public.nc_mail_queue (status, send_at);
alter table public.nc_mail_queue enable row level security;
alter table public.nc_mail_queue add column if not exists tries int not null default 0;

-- Sender runs every 5 minutes (needs pg_cron and pg_net).
select cron.schedule('nc-mail-run', '*/5 * * * *', $$select net.http_post(url := 'https://ctezcrglzcjxdkagnoyy.supabase.co/functions/v1/nc-mail', headers := '{"content-type":"application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 20000)$$);
