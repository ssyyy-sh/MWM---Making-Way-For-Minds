-- Запустите это целиком в Supabase: ваш проект → SQL Editor → New query → вставить → Run.

create table if not exists public.stories (
  id text primary key,
  title text not null,
  author text not null,
  country text,
  body jsonb not null,
  lang text default 'ru',
  likes integer default 0,
  created_at timestamptz default now()
);

-- Включаем Row Level Security — без явных политик ниже никто ничего делать не сможет,
-- это нормально и безопасно по умолчанию.
alter table public.stories enable row level security;

-- Разрешаем всем читать истории (это и есть общая лента).
create policy "Anyone can read stories"
  on public.stories for select
  using (true);

-- Разрешаем всем публиковать новые истории.
-- Ограничение специально узкое: нельзя редактировать и удалять чужие записи —
-- политик update/delete здесь нет вообще, значит эти действия запрещены всем через обычный ключ.
create policy "Anyone can publish a story"
  on public.stories for insert
  with check (true);