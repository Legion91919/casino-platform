-- Shared fixture for comps tests: a deposit-match campaign (100% up to 50.00, 30x wagering).
SET search_path = comps, public;
INSERT INTO campaign (operator_code, code, kind, currency, match_pct, max_award_minor, wagering_multiplier, award_ttl, valid, jurisdictions, approved_by)
VALUES ('kestrel', 'WELCOME100', 'deposit_match', 'EUR', 100, 5000, 30, interval '30 days',
        tstzrange(now() - interval '1 day', now() + interval '60 days'), '{JUR-A}', 'crm-lead');
SELECT campaign_id AS welcome FROM campaign WHERE code = 'WELCOME100' \gset
INSERT INTO game_contribution VALUES ('kestrel', 'slot', 100), ('kestrel', 'table', 10);
-- 20.00 deposit matched with 20.00 bonus, 30x the bonus = 600.00 to wager
INSERT INTO award (award_id, campaign_id, operator_code, player_id, currency, award_key, awarded_minor, wagering_required_minor, expires_at)
VALUES ('00000000-0000-4000-8000-00000000aa01', :welcome, 'kestrel', '00000000-0000-4000-8000-0000000000a1', 'EUR',
        'deposit:dep-1', 2000, 60000, now() + interval '30 days');
