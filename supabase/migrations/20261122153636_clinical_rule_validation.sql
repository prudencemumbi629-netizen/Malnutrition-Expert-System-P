alter table public.demo_members
    add column can_validate_clinical_rules boolean not null default false;

create table public.clinical_rule_validations (
    ruleset_version text not null check (length(ruleset_version) between 1 and 64),
    rule_id text not null check (rule_id in (
        'emergency-danger-signs', 'infants-under-six-months',
        'wasting-or-oedema', 'referral-and-care-setting',
        'routine-assessment', 'incomplete-observations'
    )),
    validated_by uuid not null default auth.uid(),
    validated_at timestamptz not null default now(),
    primary key (ruleset_version, rule_id)
);

alter table public.clinical_rule_validations enable row level security;
revoke all on public.clinical_rule_validations from public, anon, authenticated;
grant select (ruleset_version, rule_id, validated_at)
    on public.clinical_rule_validations to authenticated;
grant insert (ruleset_version, rule_id)
    on public.clinical_rule_validations to authenticated;

create policy demo_members_read_clinical_rule_validations
    on public.clinical_rule_validations for select to authenticated
    using (exists (
        select 1 from public.demo_members where user_id = (select auth.uid())
    ));

create policy clinical_rule_admins_insert_validations
    on public.clinical_rule_validations for insert to authenticated
    with check (
        validated_by = (select auth.uid()) and exists (
            select 1 from public.demo_members
            where user_id = (select auth.uid()) and can_validate_clinical_rules
        )
    );
