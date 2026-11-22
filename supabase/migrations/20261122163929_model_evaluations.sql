create table public.model_evaluations (
    model_version text primary key check (length(model_version) between 1 and 128),
    report jsonb not null check (
        jsonb_typeof(report) = 'object'
        and report ? 'model_version'
        and report ->> 'model_version' is not null
        and report ->> 'model_version' = model_version
    )
);

alter table public.model_evaluations enable row level security;
revoke all on public.model_evaluations from public, anon, authenticated;
grant select on public.model_evaluations to authenticated;

create policy workspace_members_read_active_model_evaluation
    on public.model_evaluations for select to authenticated
    using (exists (
        select 1 from public.demo_members where user_id = (select auth.uid())
    ) and exists (
        select 1 from public.assessment_releases as release
        where release.model_version = model_evaluations.model_version and release.active
    ));
