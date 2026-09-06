-- Route-scoped pricing. Legacy rows remain immutable and readable, but their
-- nullable route scope intentionally cannot authorize a paid route.
BEGIN;
ALTER TABLE avatar_studio.avatar_provider_pricing_evidence ADD COLUMN IF NOT EXISTS operation text;
ALTER TABLE avatar_studio.avatar_provider_pricing_evidence ADD COLUMN IF NOT EXISTS billing_unit text;
ALTER TABLE avatar_studio.avatar_provider_pricing_evidence ADD COLUMN IF NOT EXISTS credit_to_operation_rule jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='avatar_provider_pricing_operation_valid') THEN
    ALTER TABLE avatar_studio.avatar_provider_pricing_evidence ADD CONSTRAINT avatar_provider_pricing_operation_valid CHECK (operation IS NULL OR operation IN ('AVATAR_RENDER','AVATAR_PROVISION'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='avatar_provider_pricing_billing_unit_valid') THEN
    ALTER TABLE avatar_studio.avatar_provider_pricing_evidence ADD CONSTRAINT avatar_provider_pricing_billing_unit_valid CHECK (billing_unit IS NULL OR billing_unit IN ('PER_EXECUTION','PER_SECOND','PER_MINUTE','PER_CREDIT','FIXED_OPERATION','SUBSCRIPTION_DEPENDENT','UNKNOWN'));
  END IF;
END $$;
COMMIT;
