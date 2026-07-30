-- 완료 화면의 학생용 학습 기록 조회 RPC
-- 학생 브라우저에서 테이블을 직접 조회하지 않고 이 함수만 호출합니다.
-- RLS를 끄지 않으며 service_role key를 사용하지 않습니다.

create or replace function public.get_learning_records(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.learning_sessions as ls where ls.id = p_session_id) then
      jsonb_build_object(
        'diagnosis', coalesce((
          select jsonb_agg(to_jsonb(dr) order by dr.submitted_at)
          from public.diagnosis_responses as dr
          where dr.session_id = p_session_id
        ), '[]'::jsonb),
        'checkpoints', coalesce((
          select jsonb_agg(to_jsonb(ca) order by ca.submitted_at)
          from public.checkpoint_attempts as ca
          where ca.session_id = p_session_id
        ), '[]'::jsonb),
        'explorations', coalesce((
          select jsonb_agg(to_jsonb(er) order by er.feedback_created_at)
          from public.exploration_results as er
          where er.session_id = p_session_id
        ), '[]'::jsonb),
        'finalAttempts', coalesce((
          select jsonb_agg(to_jsonb(fa) order by fa.submitted_at)
          from public.final_challenge_attempts as fa
          where fa.session_id = p_session_id
        ), '[]'::jsonb)
      )
    else null
  end;
$$;

revoke all on function public.get_learning_records(uuid) from public;
grant execute on function public.get_learning_records(uuid) to anon, authenticated;
