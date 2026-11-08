-- SkillQuest 004: a "hint" for every question, written by the AI to nudge the player without
-- giving the answer away (generate-level double-checks it in code). Also teaches import_plan
-- (the demo plan) to copy hints.
-- Apply after 003:  supabase db push --remote

alter table public.questions
  add column hint text check (hint is null or char_length(hint) <= 300);

-- Same as 001's import_plan, plus the hint column.
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
                                 explanation, concept, difficulty, hint)
          values (v_level_id, (q ->> 'idx')::int, q ->> 'kind', q ->> 'prompt',
                  case when jsonb_typeof(q -> 'options') = 'array'
                       then array(select jsonb_array_elements_text(q -> 'options')) end,
                  (q ->> 'correct_index')::int,
                  case when jsonb_typeof(q -> 'answers') = 'array'
                       then array(select jsonb_array_elements_text(q -> 'answers')) end,
                  coalesce(q ->> 'explanation', ''), coalesce(q ->> 'concept', ''),
                  coalesce((q ->> 'difficulty')::int, 1),
                  nullif(left(coalesce(q ->> 'hint', ''), 300), ''));
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


revoke all on function public.import_plan(jsonb, jsonb) from public, anon;
grant execute on function public.import_plan(jsonb, jsonb) to authenticated;
