-- SkillQuest schema: tables, row level security, complete_level() and import_plan().
-- Paste into the Supabase SQL editor (or run `supabase db push`). Safe to read top to bottom.
--
-- Who writes what:
--   * Edge Functions (service role) insert plans, skills, stages, levels, questions, resources.
--   * The app (signed-in anonymous user) can only READ its own rows, INSERT attempts,
--     and call complete_level() / import_plan(). It can't edit levels or scores directly.

-- ---------------------------------------------------------------- tables

create table public.plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_title       text not null,
  company         text,
  match_pct       int  not null default 0,
  start_match_pct int  not null default 0,
  xp              int  not null default 0,
  created_at      timestamptz not null default now()
);

create table public.skills (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans (id) on delete cascade,
  name       text not null,
  weight     int  not null check (weight between 1 and 3),
  required   bool not null default true,
  have_level int  not null check (have_level between 0 and 3),
  need_level int  not null check (need_level between 1 and 3),
  is_gap     bool not null
);

create table public.stages (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references public.plans (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  idx      int  not null,
  title    text not null,
  summary  text not null default ''
);

create table public.levels (
  id         uuid primary key default gen_random_uuid(),
  stage_id   uuid not null references public.stages (id) on delete cascade,
  idx        int  not null,
  type       text not null check (type in ('normal', 'challenge', 'boss')),
  title      text not null,
  objective  text not null default '',
  concepts   text[] not null default '{}',
  status     text not null default 'locked' check (status in ('locked', 'unlocked', 'completed')),
  best_score int,
  generated  bool not null default false
);

create table public.questions (
  id            uuid primary key default gen_random_uuid(),
  level_id      uuid not null references public.levels (id) on delete cascade,
  idx           int  not null,
  kind          text not null check (kind in ('mcq', 'blank')),
  prompt        text not null,
  options       text[],  -- mcq: 4 options
  correct_index int,     -- mcq: index into options
  answers       text[],  -- blank: accepted answers
  explanation   text not null default '',
  concept       text not null default '',
  difficulty    int  not null default 1
);

create table public.resources (
  id       uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.levels (id) on delete cascade,
  title    text not null,
  url      text not null,
  snippet  text not null default ''
);

create table public.attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  correct     bool not null,
  created_at  timestamptz not null default now()
);

create index on public.plans (user_id);
create index on public.skills (plan_id);
create index on public.stages (plan_id);
create index on public.levels (stage_id);
create index on public.questions (level_id);
create index on public.resources (level_id);
create index on public.attempts (user_id, question_id);

-- ---------------------------------------------------------------- row level security
-- A row is visible when it belongs to a plan owned by the signed-in user.

alter table public.plans     enable row level security;
alter table public.skills    enable row level security;
alter table public.stages    enable row level security;
alter table public.levels    enable row level security;
alter table public.questions enable row level security;
alter table public.resources enable row level security;
alter table public.attempts  enable row level security;

create policy "own plans" on public.plans
  for select using (user_id = auth.uid());

create policy "own skills" on public.skills
  for select using (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()));

create policy "own stages" on public.stages
  for select using (exists (select 1 from public.plans p where p.id = plan_id and p.user_id = auth.uid()));

create policy "own levels" on public.levels
  for select using (exists (
    select 1 from public.stages s join public.plans p on p.id = s.plan_id
    where s.id = stage_id and p.user_id = auth.uid()));

create policy "own questions" on public.questions
  for select using (exists (
    select 1 from public.levels l join public.stages s on s.id = l.stage_id join public.plans p on p.id = s.plan_id
    where l.id = level_id and p.user_id = auth.uid()));

create policy "own resources" on public.resources
  for select using (exists (
    select 1 from public.levels l join public.stages s on s.id = l.stage_id join public.plans p on p.id = s.plan_id
    where l.id = level_id and p.user_id = auth.uid()));

create policy "read own attempts" on public.attempts
  for select using (user_id = auth.uid());

create policy "write own attempts" on public.attempts
  for insert with check (
    user_id = auth.uid() and exists (
      select 1 from public.questions q join public.levels l on l.id = q.level_id
      join public.stages s on s.id = l.stage_id join public.plans p on p.id = s.plan_id
      where q.id = question_id and p.user_id = auth.uid()));

-- ---------------------------------------------------------------- match %
-- Match % = weight of skills you have (non-gap skills + gap skills whose boss is beaten)
--           ÷ total weight × 100.

create or replace function public.compute_match_pct(p_plan_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(round(100.0 * sum(sk.weight) filter (
           where not sk.is_gap
              or exists (
                select 1 from stages st join levels lv on lv.stage_id = st.id
                where st.skill_id = sk.id and lv.type = 'boss' and lv.status = 'completed'))
         / nullif(sum(sk.weight), 0))::int, 0)
  from skills sk
  where sk.plan_id = p_plan_id;
$$;

-- ---------------------------------------------------------------- complete_level
-- Called by the app when a level is passed (score is 0-100, must be >= 60).
-- Marks it completed, keeps the best score, adds XP, unlocks the next level
-- (or the first level of the next stage after a boss) and recomputes match %.

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
  v_next_id uuid;
begin
  select * into v_level from levels where id = complete_level.level_id;
  if not found then raise exception 'Level not found'; end if;
  select * into v_stage from stages where id = v_level.stage_id;
  select * into v_plan from plans where id = v_stage.plan_id;
  if v_plan.user_id is distinct from auth.uid() then raise exception 'Not your level'; end if;
  if v_level.status = 'locked' then raise exception 'Level is locked'; end if;
  if score < 60 then raise exception 'Score % is below the 60%% pass mark', score; end if;

  update levels
     set status = 'completed',
         best_score = greatest(coalesce(best_score, 0), least(score, 100))
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
         xp = xp + greatest(0, least(coalesce(xp_earned, 0), 500))
   where id = v_plan.id
   returning * into v_plan;

  return json_build_object('match_pct', v_plan.match_pct, 'xp', v_plan.xp, 'next_level_id', v_next_id);
end;
$$;

-- ---------------------------------------------------------------- import_plan
-- Copies a plan bundle (same JSON shape as src/mock/plan.json + src/mock/level.json)
-- into the signed-in user's account with fresh ids. Used by the app's
-- "Try the demo plan" button as the backup for the live demo (no AI needed).

create or replace function public.import_plan(bundle jsonb, level_content jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_plan_id uuid;
  v_ids     jsonb := '{}'::jsonb;  -- old id -> new id
  r         jsonb;
  lv        jsonb;
  q         jsonb;
  v_new      uuid;
  v_level_id uuid;
  v_content  jsonb;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;

  insert into plans (user_id, job_title, company, match_pct, start_match_pct)
  values (v_uid, bundle #>> '{plan,job_title}', bundle #>> '{plan,company}',
          (bundle #>> '{plan,start_match_pct}')::int, (bundle #>> '{plan,start_match_pct}')::int)
  returning id into v_plan_id;

  for r in select * from jsonb_array_elements(bundle -> 'skills') loop
    insert into skills (plan_id, name, weight, required, have_level, need_level, is_gap)
    values (v_plan_id, r ->> 'name', (r ->> 'weight')::int, (r ->> 'required')::bool,
            (r ->> 'have_level')::int, (r ->> 'need_level')::int, (r ->> 'is_gap')::bool)
    returning id into v_new;
    v_ids := v_ids || jsonb_build_object(r ->> 'id', v_new);
  end loop;

  for r in select * from jsonb_array_elements(bundle -> 'stages') loop
    insert into stages (plan_id, skill_id, idx, title, summary)
    values (v_plan_id, (v_ids ->> (r ->> 'skill_id'))::uuid, (r ->> 'idx')::int, r ->> 'title', r ->> 'summary')
    returning id into v_new;

    for lv in select * from jsonb_array_elements(r -> 'levels') loop
      v_content := level_content -> (lv ->> 'id');
      insert into levels (stage_id, idx, type, title, objective, concepts, status, generated)
      values (v_new, (lv ->> 'idx')::int, lv ->> 'type', lv ->> 'title', lv ->> 'objective',
              array(select jsonb_array_elements_text(lv -> 'concepts')),
              case when (r ->> 'idx')::int = 0 and (lv ->> 'idx')::int = 0 then 'unlocked' else 'locked' end,
              coalesce(jsonb_array_length(v_content -> 'questions'), 0) > 0)
      returning id into v_level_id;

      if v_content is not null then
        for q in select * from jsonb_array_elements(coalesce(v_content -> 'questions', '[]')) loop
          insert into questions (level_id, idx, kind, prompt, options, correct_index, answers,
                                 explanation, concept, difficulty)
          values (v_level_id, (q ->> 'idx')::int, q ->> 'kind', q ->> 'prompt',
                  case when jsonb_typeof(q -> 'options') = 'array'
                       then array(select jsonb_array_elements_text(q -> 'options')) end,
                  (q ->> 'correct_index')::int,
                  case when jsonb_typeof(q -> 'answers') = 'array'
                       then array(select jsonb_array_elements_text(q -> 'answers')) end,
                  coalesce(q ->> 'explanation', ''), coalesce(q ->> 'concept', ''),
                  coalesce((q ->> 'difficulty')::int, 1));
        end loop;
        for q in select * from jsonb_array_elements(coalesce(v_content -> 'resources', '[]')) loop
          insert into resources (level_id, title, url, snippet)
          values (v_level_id, q ->> 'title', q ->> 'url', coalesce(q ->> 'snippet', ''));
        end loop;
      end if;
    end loop;
  end loop;

  update plans set match_pct = compute_match_pct(v_plan_id) where id = v_plan_id;

  return v_plan_id;
end;
$$;

-- Permissions: only signed-in users may call the RPCs.
revoke all on function public.complete_level(uuid, int, int) from public, anon;
revoke all on function public.import_plan(jsonb, jsonb) from public, anon;
grant execute on function public.complete_level(uuid, int, int) to authenticated;
grant execute on function public.import_plan(jsonb, jsonb) to authenticated;
