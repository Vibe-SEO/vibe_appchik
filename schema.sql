-- SETUP: Supabase -> SQL Editor -> выполнить файл целиком.
-- Auth -> Providers: Email = ON. Telegram: Auth -> Providers -> Custom OAuth/OIDC, identifier `custom:telegram`.
-- Демо-Premium без оплаты (только для теста):  alter database postgres set app.demo_premium = 'on';
-- Боевой Premium: платёжный webhook (Edge Function, service_role) вызывает  select grant_premium('<uuid>', 30);
-- Очистка: select cron.schedule('prune', '0 4 * * *', 'select public.prune()');  (расширение pg_cron)

create extension if not exists pgcrypto;

/* ---------------- ТАБЛИЦЫ ---------------- */
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text unique not null,
  name text not null default 'Гость' check (char_length(name) between 1 and 24),
  color text not null default 'p' check (color in ('p','k','o','b','g')),
  avatar text check (avatar is null or char_length(avatar) < 120000),
  bio text not null default '' check (char_length(bio) <= 140),
  premium_until timestamptz,
  watch_seconds bigint not null default 0,
  longest_seconds bigint not null default 0,
  biggest_room int not null default 0,
  settings jsonb not null default '{}' check (octet_length(settings::text) < 8000),
  created_at timestamptz not null default now()
);

create table public.friend_links (
  a uuid not null references public.profiles on delete cascade,
  b uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a <> b)
);

create table public.blocks (
  user_id uuid not null references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  primary key (user_id, blocked_id)
);

create table public.recents (
  user_id uuid not null references public.profiles on delete cascade,
  other_id uuid not null references public.profiles on delete cascade,
  room_title text not null default '',
  at timestamptz not null default now(),
  primary key (user_id, other_id)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  title text not null check (char_length(title) between 1 and 40),
  owner uuid not null references public.profiles on delete cascade,
  privacy smallint not null default 1 check (privacy in (0,1,2)), -- 0 друзья, 1 все, 2 по ссылке
  host_only boolean not null default false,
  poster smallint not null default 0,
  media jsonb check (media is null or (media->>'type') in ('yt','rt','vk','nf')),
  state jsonb not null default '{"playing":false,"t":0,"ts":0}',
  created_at timestamptz not null default now()
);

create table public.messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  edited boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_room_idx on public.messages (room_id, id desc);
create index friend_links_b_idx on public.friend_links (b);

/* ---------------- ФУНКЦИИ ---------------- */
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; h text; n text;
begin
  n := left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''),
                     nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                     nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Гость'), 24);
  base := left(lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-zA-Z0-9]', '', 'g')), 16);
  if base = '' then base := 'user'; end if;
  loop
    h := base || floor(random() * 9000 + 1000)::int;
    exit when not exists (select 1 from profiles where handle = h);
  end loop;
  insert into profiles (id, handle, name) values (new.id, h, n);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.are_friends(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friend_links where status = 'accepted' and ((a = x and b = y) or (a = y and b = x)))
$$;

create function public.is_premium(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select premium_until > now() from profiles where id = u), false)
$$;

create function public.server_time() returns timestamptz
language sql stable as $$ select now() $$;

create function public.get_room_by_code(p_code text) returns setof public.rooms
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  return query select * from rooms where code = lower(p_code) limit 1;
end $$;

create function public.set_room_state(p_room uuid, p_state jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into r from rooms where id = p_room;
  if not found then raise exception 'room_not_found'; end if;
  if r.host_only and r.owner <> auth.uid() then raise exception 'host_only'; end if;
  if jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 512 then raise exception 'bad_state'; end if;
  update rooms set state = p_state where id = p_room;
end $$;

create function public.add_watch(p_seconds int, p_room_size int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_seconds < 0 or p_seconds > 86400 then return; end if;
  update profiles set
    watch_seconds = watch_seconds + p_seconds,
    longest_seconds = greatest(longest_seconds, p_seconds),
    biggest_room = greatest(biggest_room, least(coalesce(p_room_size, 0), 100000))
  where id = auth.uid();
end $$;

create function public.grant_premium(p_user uuid, p_days int) returns void
language sql security definer set search_path = public as $$
  update profiles
     set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => p_days)
   where id = p_user
$$;
revoke all on function public.grant_premium(uuid, int) from public, anon, authenticated;
grant execute on function public.grant_premium(uuid, int) to service_role;

create function public.buy_premium() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if coalesce(current_setting('app.demo_premium', true), 'off') <> 'on' then raise exception 'payment_required'; end if;
  perform grant_premium(auth.uid(), 30);
end $$;

create function public.messages_before_update() returns trigger
language plpgsql as $$
begin
  new.edited := true;
  return new;
end $$;
create trigger messages_edit before update on public.messages
  for each row execute function public.messages_before_update();

create function public.prune() returns void
language sql security definer set search_path = public as $$
  delete from rooms where created_at < now() - interval '2 days'
    and not exists (select 1 from messages m where m.room_id = rooms.id and m.created_at > now() - interval '2 days');
  delete from messages where created_at < now() - interval '30 days';
$$;
revoke all on function public.prune() from public, anon, authenticated;

/* ---------------- RLS ---------------- */
alter table public.profiles enable row level security;
alter table public.friend_links enable row level security;
alter table public.blocks enable row level security;
alter table public.recents enable row level security;
alter table public.rooms enable row level security;
alter table public.messages enable row level security;

revoke all on public.profiles, public.friend_links, public.blocks, public.recents, public.rooms, public.messages from anon, authenticated;

-- profiles: читают все авторизованные, правит только владелец, premium_until недоступен клиенту
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_upd on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select on public.profiles to authenticated;
grant update (name, color, avatar, bio, settings) on public.profiles to authenticated;

-- rooms
create policy rooms_read on public.rooms for select to authenticated
  using (privacy = 1 or owner = auth.uid() or (privacy = 0 and public.are_friends(owner, auth.uid())));
create policy rooms_ins on public.rooms for insert to authenticated with check (owner = auth.uid());
create policy rooms_upd on public.rooms for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy rooms_del on public.rooms for delete to authenticated using (owner = auth.uid());
grant select, delete on public.rooms to authenticated;
grant insert (title, owner, privacy, host_only, poster, media) on public.rooms to authenticated;
grant update (title, media, state) on public.rooms to authenticated;

-- messages
create policy msg_read on public.messages for select to authenticated using (true);
create policy msg_ins on public.messages for insert to authenticated with check (user_id = auth.uid());
create policy msg_upd on public.messages for update to authenticated
  using (user_id = auth.uid() and public.is_premium(auth.uid()))
  with check (user_id = auth.uid() and public.is_premium(auth.uid()));
grant select on public.messages to authenticated;
grant insert (room_id, body) on public.messages to authenticated;
grant update (body) on public.messages to authenticated;

-- friend_links
create policy fl_read on public.friend_links for select to authenticated using (a = auth.uid() or b = auth.uid());
create policy fl_ins on public.friend_links for insert to authenticated
  with check (a = auth.uid() and status = 'pending'
              and not exists (select 1 from public.blocks x where x.user_id = b and x.blocked_id = a));
create policy fl_upd on public.friend_links for update to authenticated
  using (b = auth.uid()) with check (b = auth.uid() and status = 'accepted');
create policy fl_del on public.friend_links for delete to authenticated using (a = auth.uid() or b = auth.uid());
grant select, delete on public.friend_links to authenticated;
grant insert (a, b) on public.friend_links to authenticated;
grant update (status) on public.friend_links to authenticated;

-- blocks / recents
create policy blocks_all on public.blocks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.blocks to authenticated;
create policy recents_all on public.recents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.recents to authenticated;

/* ---------------- REALTIME ---------------- */
alter publication supabase_realtime add table public.rooms, public.messages, public.friend_links;
