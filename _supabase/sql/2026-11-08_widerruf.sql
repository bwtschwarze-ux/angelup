-- Elektronische Widerrufsfunktion (§ 356a BGB) - Tabelle fuer die Edge Function "widerruf".
-- Einmal im Supabase SQL-Editor ausfuehren.
create table if not exists public.widerruf (
  id             bigint generated always as identity primary key,
  vorgang        text not null unique,
  name           text not null,
  email          text not null,
  vertrag        text not null,
  referenz       text,
  bestellt_am    date,
  bemerkung      text,
  eingang        timestamptz not null default now(),
  mail_gesendet  boolean,
  erledigt       boolean not null default false
);

create index if not exists widerruf_email_eingang on public.widerruf (email, eingang);

-- Nur die Edge Function (Service-Role) schreibt und liest. Kein Zugriff fuer anon/authenticated.
alter table public.widerruf enable row level security;
revoke all on public.widerruf from anon, authenticated;
