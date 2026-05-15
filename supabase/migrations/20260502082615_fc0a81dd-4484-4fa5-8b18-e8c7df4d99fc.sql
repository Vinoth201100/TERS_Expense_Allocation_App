CREATE OR REPLACE FUNCTION public.ea_set_decision(
  _line_id uuid,
  _status ea_daily_status,
  _comment text DEFAULT NULL::text,
  _rejected_reason text DEFAULT NULL::text,
  _exception_hold_comment text DEFAULT NULL::text,
  _followup_1 date DEFAULT NULL::date,
  _followup_2 date DEFAULT NULL::date,
  _followup_3 date DEFAULT NULL::date,
  _final_decision text DEFAULT NULL::text,
  _escalated_comment text DEFAULT NULL::text,
  _escalated_date date DEFAULT NULL::date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.ea_lines WHERE id = _line_id AND assigned_ea = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE public.ea_lines SET
    status = _status,
    decision_comment = COALESCE(_comment, decision_comment),
    rejected_reason = CASE WHEN _status = 'rejected' THEN COALESCE(_rejected_reason, rejected_reason) ELSE rejected_reason END,
    exception_hold_comment = CASE WHEN _status = 'exception' THEN COALESCE(_exception_hold_comment, exception_hold_comment) ELSE exception_hold_comment END,
    followup_1_date = CASE WHEN _status = 'exception' THEN COALESCE(_followup_1, followup_1_date) ELSE followup_1_date END,
    followup_2_date = CASE WHEN _status = 'exception' THEN COALESCE(_followup_2, followup_2_date) ELSE followup_2_date END,
    followup_3_date = CASE WHEN _status = 'exception' THEN COALESCE(_followup_3, followup_3_date) ELSE followup_3_date END,
    final_decision = CASE WHEN _status = 'exception' THEN COALESCE(_final_decision, final_decision) ELSE final_decision END,
    escalated_comment = CASE WHEN _status = 'escalated' THEN COALESCE(_escalated_comment, escalated_comment) ELSE escalated_comment END,
    escalated_date = CASE WHEN _status = 'escalated' THEN COALESCE(_escalated_date, escalated_date) ELSE escalated_date END,
    is_resubmitted = false,
    decided_at = now(),
    updated_at = now()
  WHERE id = _line_id;
END;
$function$;