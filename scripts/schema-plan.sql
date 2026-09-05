-- ============================================================
-- Plano do dia: lista de ofertas selecionadas de uma vez no
-- começo do dia para os disparos espaçados.
-- Rode este bloco no SQL Editor do Supabase, na pasta "SQL".
-- ============================================================

create table if not exists public.auto_publish_plan (
  run_date date not null,
  idx int not null,
  item jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (run_date, idx)
);

alter table public.auto_publish_plan enable row level security;
create policy "anon read auto_publish_plan"
  on public.auto_publish_plan for select using (true);