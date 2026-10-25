-- Leads from the quiz and the offer waitlists: one row per email and list. Private: RLS on, no public policies.
create table if not exists public.nc_leads (
  id bigserial primary key,
  ts timestamptz not null default now(),
  email text not null,
  quiz text not null default 'hate-my-job',
  main_cause text,
  second_cause text,
  scores jsonb,
  consent_tips boolean not null default false,
  cid text,
  source text,
  country text,
  unique (email, quiz)
);
alter table public.nc_leads enable row level security;
