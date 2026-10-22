-- Run only in the disposable database created by test-postgres.sh.
DO $$
BEGIN
    ASSERT to_regclass('catalog.worlds') IS NOT NULL, 'catalog migration is missing';
    ASSERT to_regclass('campaign.campaigns') IS NOT NULL, 'campaign migration is missing';
    ASSERT to_regclass('private.dm_secrets') IS NOT NULL, 'private notes migration is missing';
    ASSERT to_regclass('campaign.outbox') IS NOT NULL, 'outbox migration is missing';
END;
$$;
