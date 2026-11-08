-- SkillQuest 007:
--   * generate-level can never save two sets of questions for one level: a claim on the level
--     (levels.generating_at, like stages.building_at in 005), unique (level_id, idx) on questions,
--     and one SECURITY DEFINER function that saves questions + resources + generated=true atomically.
--   * create-plan idempotency: plans.request_id, unique per user.
--   * complete_level: a boss win unlocks only the NEXT stage's first level (006 unlocked the first
--     level of any later stage that already had levels).
-- Safe to run more than once. Apply after 006:  supabase db push --remote

-- ---------------------------------------------------------------- level claims

-- When generate-level claimed the level. A claim older than 90 s is treated as abandoned.
alter table public.levels add column if not exists generating_at timestamptz;

-- Clean up levels that already got two sets of questions (the race this migration fixes), so the
-- unique index can be built. Per (level_id, idx) keep the copy players answered most (then the
-- lowest id); attempts on the dropped copies go with them (on delete cascade).
delete from public.questions q
 using (
   select id,
          row_number() over (
            partition by level_id, idx
            order by (select count(*) from public.attempts a where a.question_id = qq.id) desc, id
          ) as rn
     from public.questions qq
 ) d
 where q.id = d.id and d.rn > 1;

create unique index if not exists questions_level_id_idx_key on public.questions (level_id, idx);

-- Same for resources: one row per link per level.
delete from public.resources r
 using (
   select id,
          row_number() over (
            partition by level_id, url
            order by (select count(*) from public.resource_opens o where o.resource_id = rr.id) desc, id
          ) as rn
     from public.resources rr
 ) d
 where r.id = d.id and d.rn > 1;

create unique index if not exists resources_level_id_url_key on public.resources (level_id, url);

-- Saves a level's questions and resources and marks it generated, all in one transaction.
-- The level row is locked first: if another request already saved it, nothing is written and
-- false is returned. Called by generate-level with the service role only.
--   p_questions: [{ kind, prompt, options, correct_index, answers, explanation, concept, difficulty, hint }]
--                (array order = idx)
--   p_resources: [{ title, url, snippet }]
create or replace function public.save_level_content(p_level_id uuid, p_questions jsonb, p_resources jsonb default '[]'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_generated bool;
begin
  select generated into v_generated from levels where id = p_level_id for update;
  if not found then raise exception 'Level not found'; end if;
  if v_generated then return false; end if; -- someone else finished first
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'No questions to save';
  end if;

  -- Not generated yet, so nothing here has been played: clear any leftovers before writing.
  delete from questions where level_id = p_level_id;
  delete from resources where level_id = p_level_id;

  insert into questions (level_id, idx, kind, prompt, options, correct_index, answers,
                         explanation, concept, difficulty, hint)
  select p_level_id, (q.ord - 1)::int, q.v ->> 'kind', q.v ->> 'prompt',
         case when jsonb_typeof(q.v -> 'options') = 'array'
              then array(select jsonb_array_elements_text(q.v -> 'options')) end,
         (q.v ->> 'correct_index')::int,
         case when jsonb_typeof(q.v -> 'answers') = 'array'
              then array(select jsonb_array_elements_text(q.v -> 'answers')) end,
         coalesce(q.v ->> 'explanation', ''), coalesce(q.v ->> 'concept', ''),
         coalesce((q.v ->> 'difficulty')::int, 1),
         nullif(left(coalesce(q.v ->> 'hint', ''), 300), '')
    from jsonb_array_elements(p_questions) with ordinality as q(v, ord);

  if jsonb_typeof(p_resources) = 'array' then
    insert into resources (level_id, title, url, snippet)
    select p_level_id, r ->> 'title', r ->> 'url', coalesce(r ->> 'snippet', '')
      from jsonb_array_elements(p_resources) as r
     where coalesce(r ->> 'title', '') <> '' and coalesce(r ->> 'url', '') <> ''
    on conflict (level_id, url) do nothing;
  end if;

  update levels set generated = true, generating_at = null where id = p_level_id;
  return true;
end;
$$;

-- Service role only (the Edge Function). Not callable from the app.
revoke all on function public.save_level_content(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_level_content(uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------- create-plan idempotency

-- The app sends one random id per "build my map" tap; a retried request returns the same plan.
alter table public.plans add column if not exists request_id uuid;
-- NULLs are distinct, so plans created without a request_id are unaffected.
create unique index if not exists plans_user_id_request_id_key on public.plans (user_id, request_id);

-- ---------------------------------------------------------------- complete_level
-- Same as 006, except that after the last level of a stage (the boss) it only unlocks the first
-- level of the NEXT stage (st.idx = v_stage.idx + 1). If that stage is still being designed, it has
-- no levels yet and build-stage unlocks its first level when it finishes.
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
     where st.plan_id = v_plan.id and st.idx = v_stage.idx + 1
     order by st.idx, lv.idx limit 1;
  end if;
  if v_next_id is not null then
    update levels set status = 'unlocked' where id = v_next_id and status = 'locked';
  end if;

  -- Beating a stage's boss earns that stage's skill: it leaves "To learn" (migration 006).
  if v_level.type = 'boss' then
    update skills set earned_at = coalesce(earned_at, now()) where id = v_stage.skill_id;
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
