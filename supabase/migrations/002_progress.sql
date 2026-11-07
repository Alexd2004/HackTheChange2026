-- SkillQuest 002: per-user progress (profiles, XP, streak), resource-open analytics,

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text check (display_name is null or char_length(display_name) <= 60),
  current_plan_id  uuid references public.plans (id) on delete set null,
  total_xp         int  not null default 0,
  streak           int  not null default 0,
  last_active_date date,
  created_at       timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select using (id = (select auth.uid()));



-- Users may point current_plan_id only at their own plans.
create policy "update own profile" on public.profiles
  for update using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (current_plan_id is null
         or exists (select 1 from public.plans p where p.id = current_plan_id and p.user_id = (select auth.uid()))));

-- Column-level: only these two columns are writable by the app. Revoke ALL first:
-- Supabase's default privileges grant everything (incl. TRUNCATE, which ignores RLS) on new tables.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, current_plan_id) on public.profiles to authenticated;

-- Every new auth user (guest or email) gets a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users that already exist, with the XP they already earned.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;
update public.profiles pr
   set total_xp = coalesce((select sum(p.xp) from public.plans p where p.user_id = pr.id), 0);

-- ---------------------------------------------------------------- attempts: richer rows

alter table public.attempts
  add column run_id  uuid,                                                -- one id per play of a level
  add column time_ms int  check (time_ms is null or time_ms between 0 and 3600000),
  add column answer  text check (answer is null or char_length(answer) <= 300);

create index on public.attempts (question_id);
create index on public.attempts (run_id);

-- ---------------------------------------------------------------- resource_opens

create table public.resource_opens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  level_id    uuid not null references public.levels (id) on delete cascade,
  question_id uuid references public.questions (id) on delete set null,
  run_id      uuid,
  opened_at   timestamptz not null default now(),
  duration_ms int check (duration_ms is null or duration_ms between 0 and 86400000)
);

create index on public.resource_opens (user_id);
create index on public.resource_opens (run_id);
create index on public.resource_opens (resource_id);

alter table public.resource_opens enable row level security;

create policy "read own resource opens" on public.resource_opens
  for select using (user_id = (select auth.uid()));

-- Insert only for a resource of a level in a plan you own, and the level must match.
-- Columns of the new row are written as resource_opens.<col>: inside the subqueries an
-- unqualified level_id would bind to resources.level_id / questions.level_id instead.
create policy "write own resource opens" on public.resource_opens
  for insert with check (
    resource_opens.user_id = (select auth.uid()) and exists (
      select 1 from public.resources r
      join public.levels l on l.id = r.level_id
      join public.stages s on s.id = l.stage_id
      join public.plans p on p.id = s.plan_id
      where r.id = resource_opens.resource_id
        and r.level_id = resource_opens.level_id
        and p.user_id = (select auth.uid()))
    and (resource_opens.question_id is null or exists (
      select 1 from public.questions q
      where q.id = resource_opens.question_id and q.level_id = resource_opens.level_id)));

-- Don't rely on hosted defaults: the app (authenticated role) reads its own rows through RLS,
-- and may only insert attempts and resource_opens.

grant usage on schema public to authenticated;
grant select on public.plans, public.skills, public.stages, public.levels,
                public.questions, public.resources, public.attempts, public.resource_opens
  to authenticated;
grant insert on public.attempts, public.resource_opens to authenticated;
revoke insert, update, delete on public.plans, public.skills, public.stages, public.levels,
                                public.questions, public.resources from anon, authenticated;
revoke all on public.resource_opens from anon, authenticated;
grant select, insert on public.resource_opens to authenticated;
revoke update, delete, truncate on public.attempts from anon, authenticated;
revoke all on public.attempts from anon;


--  complete_level v2
-- Same signature as 001. Changes:
--   * XP: full amount on the FIRST completion; a later better score earns only the improvement
--     (xp x points gained / 100), so stepping 60, 61, 62... can't farm. The level row is locked
--     (FOR UPDATE) so parallel calls can't all count as "first completion".
--   * Updates profiles.total_xp and the daily streak (UTC days).
--   * Returns xp_awarded, total_xp and streak as well.

create or replace function public.complete_level(level_id uuid, score int, xp_earned int default 0)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level   levels%rowtype;
  v_stage   stages%rowtype;
  v_plan    plans%rowtype;
  v_profile profiles%rowtype;
  v_next_id uuid;
  v_score   int := least(greatest(coalesce(score, 0), 0), 100);
  v_award   int := 0;
  v_today   date := (now() at time zone 'utc')::date;
begin
  select * into v_level from levels where id = complete_level.level_id for update;
  if not found then raise exception 'Level not found'; end if;
  select * into v_stage from stages where id = v_level.stage_id;
  select * into v_plan from plans where id = v_stage.plan_id;
  if v_plan.user_id is distinct from auth.uid() then raise exception 'Not your level'; end if;
  if v_level.status = 'locked' then raise exception 'Level is locked'; end if;
  if v_score < 60 then raise exception 'Score % is below the 60%% pass mark', v_score; end if;

  if v_level.status <> 'completed' then
    v_award := greatest(0, least(coalesce(xp_earned, 0), 500));                 -- first completion
  elsif v_score > coalesce(v_level.best_score, 0) then
    v_award := greatest(0, least(coalesce(xp_earned, 0), 500))
               * (v_score - coalesce(v_level.best_score, 0)) / 100;             -- only the improvement
  end if;

  update levels
     set status = 'completed',
         best_score = greatest(coalesce(best_score, 0), v_score)
   where id = v_level.id;

  -- Next level in this stage, else the first level of the next stage.
  select id into v_next_id from levels
   where stage_id = v_stage.id and idx > v_level.idx
   order by idx limit 1;
  if v_next_id is null then
    select lv.id into v_next_id
      from stages st join levels lv on lv.stage_id = st.id
     where st.plan_id = v_plan.id and st.idx > v_stage.idx
     order by st.idx, lv.idx limit 1;
  end if;
  if v_next_id is not null then
    update levels set status = 'unlocked' where id = v_next_id and status = 'locked';
  end if;

  update plans
     set match_pct = compute_match_pct(v_plan.id),
         xp = xp + v_award
   where id = v_plan.id
   returning * into v_plan;

  -- Profile: total XP + streak (+1 if last active yesterday, same if today, else 1).
  insert into profiles (id) values (v_plan.user_id) on conflict (id) do nothing;
  update profiles
     set total_xp = total_xp + v_award,
         streak = case
                    when last_active_date = v_today then greatest(streak, 1)
                    when last_active_date = v_today - 1 then streak + 1
                    else 1
                  end,
         last_active_date = v_today
   where id = v_plan.user_id
   returning * into v_profile;

  return json_build_object(
    'match_pct', v_plan.match_pct,
    'xp', v_plan.xp,
    'xp_awarded', v_award,
    'total_xp', v_profile.total_xp,
    'streak', v_profile.streak,
    'next_level_id', v_next_id);
end;
$$;

revoke all on function public.complete_level(uuid, int, int) from public, anon;
grant execute on function public.complete_level(uuid, int, int) to authenticated;

--  analytics (team only)
-- Plain views run as their owner and ignore RLS, so they live in a schema the API
-- does not expose and the app roles cannot use. Query them in the SQL editor.

create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

-- One row per play of a level (run).
create view analytics.run_scores as
select a.user_id,
       a.run_id,
       l.id   as level_id,
       l.type as level_type,
       count(*)                                              as answered,
       count(*) filter (where a.correct)                     as correct,
       round(100.0 * count(*) filter (where a.correct) / count(*)) as score_pct,
       min(a.created_at)                                     as started_at,
       exists (select 1 from public.resource_opens ro where ro.run_id = a.run_id) as opened_resource,
       coalesce((select sum(ro.duration_ms) from public.resource_opens ro where ro.run_id = a.run_id), 0) / 1000
                                                             as reading_seconds
  from public.attempts a
  join public.questions q on q.id = a.question_id
  join public.levels l on l.id = q.level_id
 where a.run_id is not null
 group by a.user_id, a.run_id, l.id, l.type;

-- "People who opened resources scored X% vs Y%" — by level type.
create view analytics.resource_lift as
select level_type,
       opened_resource,
       count(*)                as runs,
       round(avg(score_pct))   as avg_score_pct
  from analytics.run_scores
 group by level_type, opened_resource
 order by level_type, opened_resource;

-- Per answer: was a resource opened earlier in the same run?
create view analytics.question_lift as
select exists (select 1 from public.resource_opens ro
                where ro.run_id = a.run_id and ro.opened_at <= a.created_at) as opened_before,
       count(*)                                                as answers,
       round(100.0 * count(*) filter (where a.correct) / count(*)) as pct_correct
  from public.attempts a
 where a.run_id is not null
 group by 1;

-- Which resources get opened, and for how long.
create view analytics.resource_popularity as
select r.id,
       r.title,
       r.url,
       count(ro.id)                                                       as opens,
       round(percentile_cont(0.5) within group (order by ro.duration_ms)::numeric / 1000, 1) as median_seconds
  from public.resources r
  left join public.resource_opens ro on ro.resource_id = r.id
 group by r.id, r.title, r.url
 order by opens desc;
