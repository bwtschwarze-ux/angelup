-- Kurs-Codes: ein Code pro Kurs(termin), mit dem sich Teilnehmer selbst freischalten
-- Stand 15.09.2026. Idempotent, kann mehrfach ausgeführt werden.

create table if not exists public.videokurs_kurscode (
  code          text primary key,
  kurs_slug     text not null,
  bezeichnung   text,
  max_nutzungen integer not null default 20 check (max_nutzungen between 1 and 1000),
  genutzt       integer not null default 0,
  gueltig_bis   date,
  aktiv         boolean not null default true,
  angelegt_am   timestamptz not null default now()
);
alter table public.videokurs_kurscode enable row level security;

create table if not exists public.videokurs_kurscode_einloesung (
  id            bigint generated always as identity primary key,
  code          text not null references public.videokurs_kurscode(code) on delete cascade,
  email         text not null,
  name          text,
  eingeloest_am timestamptz not null default now(),
  unique (code, email)
);
alter table public.videokurs_kurscode_einloesung enable row level security;
-- bewusst keine Policies: Zugriff nur über die Funktionen unten

create or replace function public._videokurs_ist_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profile p where p.id = auth.uid() and p.rolle in ('ausbilder', 'admin'));
$$;
revoke all on function public._videokurs_ist_admin() from public, anon, authenticated;

create or replace function public._videokurs_zufall(n integer)
returns text language sql volatile set search_path = public as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, n);
$$;
revoke all on function public._videokurs_zufall(integer) from public, anon, authenticated;

-- Öffentlich: Kurs-Code einlösen
create or replace function public.videokurs_code_einloesen(p_code text, p_email text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k       public.videokurs_kurscode%rowtype;
  v_mail  text := lower(trim(coalesce(p_email, '')));
  v_code  text;
  v_titel text;
  i       integer;
begin
  if length(v_mail) > 120 or v_mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]{2,}$' then
    return jsonb_build_object('ok', false, 'fehler', 'email');
  end if;
  select * into k from public.videokurs_kurscode where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or not k.aktiv then
    return jsonb_build_object('ok', false, 'fehler', 'code');
  end if;
  if k.gueltig_bis is not null and k.gueltig_bis < current_date then
    return jsonb_build_object('ok', false, 'fehler', 'abgelaufen');
  end if;
  select titel into v_titel from public.videokurs where slug = k.kurs_slug;
  -- Wer den Kurs schon hat, bekommt keinen Code angezeigt (sonst könnte man fremde Codes abgreifen)
  if exists (select 1 from public.videokurs_zugang z where z.email = v_mail and z.kurs_slug = k.kurs_slug) then
    return jsonb_build_object('ok', false, 'fehler', 'schon', 'kurs', k.kurs_slug, 'titel', v_titel);
  end if;
  if k.genutzt >= k.max_nutzungen then
    return jsonb_build_object('ok', false, 'fehler', 'voll');
  end if;
  for i in 1..20 loop
    v_code := public._videokurs_zufall(4) || '-' || public._videokurs_zufall(4);
    exit when not exists (select 1 from public.videokurs_zugang z where z.code = v_code);
  end loop;
  insert into public.videokurs_zugang (kurs_slug, email, code, unbegrenzt) values (k.kurs_slug, v_mail, v_code, true);
  update public.videokurs_kurscode set genutzt = genutzt + 1 where code = k.code;
  insert into public.videokurs_kurscode_einloesung (code, email, name)
    values (k.code, v_mail, nullif(left(trim(coalesce(p_name, '')), 80), ''))
    on conflict (code, email) do nothing;
  return jsonb_build_object('ok', true, 'kurs', k.kurs_slug, 'titel', v_titel, 'code', v_code);
end $$;
revoke all on function public.videokurs_code_einloesen(text, text, text) from public;
grant execute on function public.videokurs_code_einloesen(text, text, text) to anon, authenticated;

-- Studio: Kurs-Code anlegen
create or replace function public.videokurs_kurscode_anlegen(p_kurs text, p_max integer default 20, p_gueltig_bis date default null, p_bezeichnung text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code    text;
  v_praefix text;
  i         integer;
begin
  if not public._videokurs_ist_admin() then
    return jsonb_build_object('ok', false, 'fehler', 'kein_zugriff');
  end if;
  if not exists (select 1 from public.videokurs where slug = p_kurs) then
    return jsonb_build_object('ok', false, 'fehler', 'kurs');
  end if;
  v_praefix := left(upper(regexp_replace(split_part(p_kurs, '-', 1), '[^a-zA-Z0-9]', '', 'g')), 10);
  if v_praefix = '' then v_praefix := 'KURS'; end if;
  for i in 1..20 loop
    v_code := v_praefix || '-' || public._videokurs_zufall(6);
    exit when not exists (select 1 from public.videokurs_kurscode c where c.code = v_code);
  end loop;
  insert into public.videokurs_kurscode (code, kurs_slug, bezeichnung, max_nutzungen, gueltig_bis)
    values (v_code, p_kurs, nullif(left(trim(coalesce(p_bezeichnung, '')), 120), ''),
            greatest(1, least(coalesce(p_max, 20), 1000)), p_gueltig_bis);
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;
revoke all on function public.videokurs_kurscode_anlegen(text, integer, date, text) from public, anon;
grant execute on function public.videokurs_kurscode_anlegen(text, integer, date, text) to authenticated;

-- Studio: alle Kurs-Codes mit Einlösungen
create or replace function public.videokurs_kurscode_liste()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public._videokurs_ist_admin() then
    return jsonb_build_object('ok', false, 'fehler', 'kein_zugriff');
  end if;
  return jsonb_build_object('ok', true, 'codes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', c.code, 'kurs_slug', c.kurs_slug, 'titel', v.titel, 'bezeichnung', c.bezeichnung,
      'max_nutzungen', c.max_nutzungen, 'genutzt', c.genutzt, 'gueltig_bis', c.gueltig_bis,
      'aktiv', c.aktiv, 'angelegt_am', c.angelegt_am,
      'einloesungen', coalesce((
        select jsonb_agg(jsonb_build_object('email', e.email, 'name', e.name, 'am', e.eingeloest_am) order by e.eingeloest_am desc)
        from public.videokurs_kurscode_einloesung e where e.code = c.code), '[]'::jsonb)
    ) order by c.angelegt_am desc)
    from public.videokurs_kurscode c left join public.videokurs v on v.slug = c.kurs_slug), '[]'::jsonb));
end $$;
revoke all on function public.videokurs_kurscode_liste() from public, anon;
grant execute on function public.videokurs_kurscode_liste() to authenticated;

-- Studio: Kurs-Code sperren oder wieder freigeben
create or replace function public.videokurs_kurscode_setzen(p_code text, p_aktiv boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._videokurs_ist_admin() then
    return jsonb_build_object('ok', false, 'fehler', 'kein_zugriff');
  end if;
  update public.videokurs_kurscode set aktiv = p_aktiv where code = p_code;
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.videokurs_kurscode_setzen(text, boolean) from public, anon;
grant execute on function public.videokurs_kurscode_setzen(text, boolean) to authenticated;

notify pgrst, 'reload schema';
