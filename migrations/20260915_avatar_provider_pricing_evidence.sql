-- Append-only, operator-recorded pricing evidence. It is never a credential or a
-- promise of provider entitlement; unknown remains an explicit operational state.
BEGIN;
CREATE TABLE IF NOT EXISTS avatar_studio.avatar_provider_pricing_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, character_id uuid NOT NULL,
  provider text NOT NULL, provider_engine text, status text NOT NULL, amount_usd numeric, currency text NOT NULL DEFAULT 'USD',
  evidence_source text NOT NULL, evidence_url text, verified_at timestamptz NOT NULL, valid_until timestamptz,
  evidence_fingerprint text NOT NULL, recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,character_id) REFERENCES avatar_studio.characters(workspace_id,id),
  CHECK(provider IN ('HEYGEN','TAVUS','DID')), CHECK(status IN ('KNOWN_CURRENT_PRICE','UNKNOWN_CURRENT_PRICE','ENTITLEMENT_REQUIRED','SUBSCRIPTION_REQUIRED','CONTACT_SALES')),
  CHECK(currency='USD'), CHECK(amount_usd IS NULL OR amount_usd >= 0), UNIQUE(workspace_id,evidence_fingerprint)
);
DROP TRIGGER IF EXISTS avatar_provider_pricing_evidence_immutable_change ON avatar_studio.avatar_provider_pricing_evidence;
CREATE TRIGGER avatar_provider_pricing_evidence_immutable_change BEFORE UPDATE OR DELETE ON avatar_studio.avatar_provider_pricing_evidence FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change();
COMMIT;
