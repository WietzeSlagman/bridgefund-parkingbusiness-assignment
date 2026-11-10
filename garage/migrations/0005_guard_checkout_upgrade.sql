-- Custom SQL migration file, put your code below! --
-- 0004 identifies an amount-matching request but cannot prove that other
-- unsuperseded quotes are harmless. Do not infer or change their ordering.
-- Stop old application instances before running this migration.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM sessions s
    JOIN checkout_requests r ON r.session_id = s.id
    WHERE s.active AND NOT r.is_current AND NOT r.superseded
      AND r.response IS NULL AND r.quoted_amount IS NOT NULL
      AND (
        EXISTS (SELECT 1 FROM checkout_requests c WHERE c.session_id = s.id AND c.is_current)
        OR EXISTS (
          SELECT 1 FROM checkout_requests other
          WHERE other.session_id = r.session_id AND NOT other.superseded
            AND other.response IS NULL AND other.quoted_amount IS NOT NULL
            AND (other.gate_id, other.request_id) <> (r.gate_id, r.request_id)
        )
        OR r.paid_at_quote IS NULL
        OR r.paid_at_quote >= (SELECT coalesce(sum(p.amount), 0) FROM checkout_payments p WHERE p.session_id = s.id)
      )
  ) THEN
    RAISE EXCEPTION 'Unsafe noncurrent checkout request; operator investigation required';
  END IF;
END $$;
