-- ============================================================
-- Tabelas do painel de Conteúdo (Agenda + Templates)
-- Rode este bloco no SQL Editor do Supabase, na pasta "SQL".
-- A tabela `products` já deve existir (ver README).
-- ============================================================

-- Caption templates: frases pré-definidas por horário/categoria
create table if not exists public.caption_templates (
  id bigint generated always as identity primary key,
  time_slot text not null,
  category text not null,
  hook_type text not null,
  template_text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.caption_templates enable row level security;
create policy "anon read caption_templates"
  on public.caption_templates for select using (true);

-- Agenda diária: 7 horários por dia, um produto + legenda por slot
create table if not exists public.daily_posts (
  id bigint generated always as identity primary key,
  post_date date not null,
  time_slot text not null,
  product_id bigint references public.products (id) on delete set null,
  caption text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (post_date, time_slot)
);

alter table public.daily_posts enable row level security;
create policy "anon read daily_posts"
  on public.daily_posts for select using (true);

-- Configurações do auto-publish (key-value)
create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
create policy "anon read settings"
  on public.settings for select using (true);

-- Log de execuções do auto-publish: alimenta o dashboard de status
-- (o que foi enviado, quando e com qual resultado).
create table if not exists public.auto_publish_log (
  id bigint generated always as identity primary key,
  run_date date not null,
  slot_hour int,
  type text not null,
  status text not null,
  detail text,
  published_count int not null default 0,
  saved_count int not null default 0,
  skipped_count int not null default 0,
  error_count int not null default 0,
  shopee_item_ids bigint[] default '{}',
  created_at timestamptz not null default now()
);

create index if not exists auto_publish_log_run_date_idx
  on public.auto_publish_log (run_date, created_at desc);

alter table public.auto_publish_log enable row level security;
create policy "anon read auto_publish_log"
  on public.auto_publish_log for select using (true);
