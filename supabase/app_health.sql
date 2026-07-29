create table if not exists public.app_health (
  id integer primary key,
  status text not null check (status = 'ok')
);

insert into public.app_health (id, status)
values (1, 'ok')
on conflict (id) do update set status = excluded.status;

alter table public.app_health enable row level security;

drop policy if exists "public can read app health" on public.app_health;

create policy "public can read app health"
on public.app_health
for select
to anon, authenticated
using (true);
