create table public.demo_members (
    user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.assessment_releases (
    model_version text primary key check (length(model_version) between 1 and 128),
    active boolean not null default false,
    created_at timestamptz not null default now()
);

create unique index assessment_single_active_release
    on public.assessment_releases (active) where active;

create table public.assessment_rate_windows (
    user_id uuid primary key references auth.users(id) on delete cascade,
    window_start timestamptz not null,
    request_count int not null
);

alter table public.demo_members enable row level security;
alter table public.assessment_releases enable row level security;
alter table public.assessment_rate_windows enable row level security;

revoke all on public.demo_members, public.assessment_releases,
    public.assessment_rate_windows from public, anon, authenticated;
grant select on public.demo_members, public.assessment_releases to authenticated;

create policy demo_member_reads_own_membership on public.demo_members
    for select to authenticated using (user_id = (select auth.uid()));

create policy demo_member_reads_active_release on public.assessment_releases
    for select to authenticated using (
        active and exists (
            select 1 from public.demo_members where user_id = (select auth.uid())
        )
    );

create function public.take_assessment_request() returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    minute_start timestamptz := date_trunc('minute', now());
    used int;
begin
    if caller is null or not exists (
        select 1 from public.demo_members where user_id = caller
    ) then
        return false;
    end if;

    insert into public.assessment_rate_windows as rate (user_id, window_start, request_count)
    values (caller, minute_start, 1)
    on conflict (user_id) do update
    set window_start = greatest(rate.window_start, excluded.window_start),
        request_count = case when rate.window_start < excluded.window_start
            then 1 else least(rate.request_count + 1, 31) end
    returning request_count into used;

    return used <= 30;
end;
$$;

revoke all on function public.take_assessment_request() from public, anon, authenticated;
grant execute on function public.take_assessment_request() to authenticated;
