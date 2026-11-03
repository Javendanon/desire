//! Campaign persistence with atomic owner membership and optimistic revisions.
use crate::{Error, ErrorKind, error::Context};
use desire_core::contracts::campaign::Campaign;
use postgres::Client;

pub struct CampaignRepository;

impl CampaignRepository {
    pub fn list_for_user(
        client: &mut Client,
        user: &str,
        page: crate::FetchPage,
    ) -> Result<Vec<Campaign>, Error> {
        let rows = client
            .query(
                "SELECT to_jsonb(c) - 'owner_role' FROM campaign.campaigns c \
             JOIN campaign.memberships m ON m.campaign_id = c.id \
             WHERE m.user_id = $1::text::uuid ORDER BY c.id LIMIT $2 OFFSET $3",
                &[&user, &page.limit, &page.offset],
            )
            .context("list campaigns for member")?;
        crate::records::decode_all(rows)
    }

    pub fn create(client: &mut Client, campaign: &Campaign) -> Result<(), Error> {
        let mut tx = client.transaction().context("begin campaign creation")?;
        let data = serde_json::to_value(campaign).context("encode campaign")?;
        tx.execute(
            concat!(
                "INSERT INTO campaign.campaigns ",
                "(id, owner_id, city_id, name, rules_edition, revision) ",
                "SELECT id, owner_id, city_id, name, rules_edition, revision ",
                "FROM jsonb_populate_record(NULL::campaign.campaigns, $1)"
            ),
            &[&data],
        )
        .context(format!("create campaign {}", campaign.id))?;
        tx.execute(
            concat!(
                "INSERT INTO campaign.memberships (campaign_id, user_id, role) ",
                "VALUES ($1::text::uuid, $2::text::uuid, 'dm')"
            ),
            &[&campaign.id, &campaign.owner_id],
        )
        .context("create owner DM membership")?;
        tx.commit()
            .context(format!("commit campaign {}", campaign.id))
    }

    pub fn get(client: &mut Client, campaign_id: &str) -> Result<Option<Campaign>, Error> {
        let row = client
            .query_opt(
                concat!(
                    "SELECT to_jsonb(c) - 'owner_role' FROM campaign.campaigns c ",
                    "WHERE id = $1::text::uuid"
                ),
                &[&campaign_id],
            )
            .context(format!("read campaign {campaign_id}"))?;
        row.map(|row| serde_json::from_value(row.get(0)).context("decode campaign"))
            .transpose()
    }

    pub fn rename(client: &mut Client, update: &CampaignRename<'_>) -> Result<Campaign, Error> {
        let row = client
            .query_opt(
                concat!(
                    "UPDATE campaign.campaigns c SET name = $3, revision = revision + 1 ",
                    "WHERE id = $1::text::uuid AND revision = $2 ",
                    "RETURNING to_jsonb(c) - 'owner_role'"
                ),
                &[
                    &update.campaign_id,
                    &i64::from(update.expected_revision),
                    &update.name,
                ],
            )
            .context(format!("rename campaign {}", update.campaign_id))?;
        let row = row.ok_or_else(|| {
            Error::new(
                ErrorKind::Conflict,
                format!(
                    "campaign {} is absent or revision changed",
                    update.campaign_id
                ),
            )
        })?;
        crate::records::decode(row)
    }
}

pub struct CampaignRename<'a> {
    pub campaign_id: &'a str,
    pub expected_revision: u32,
    pub name: &'a str,
}
