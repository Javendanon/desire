//! Membership storage. Authorization and HTTP policy belong to the application.
use crate::{
    Error,
    error::Context,
    reads::{self, FetchPage, ListRead, RecordTarget},
};
use desire_core::contracts::{
    campaign::Membership,
    common::{Id, MemberRole},
};
use postgres::Client;

pub struct MembershipRepository;

impl MembershipRepository {
    pub fn role(
        client: &mut Client,
        target: RecordTarget<'_>,
    ) -> Result<Option<MemberRole>, Error> {
        client
            .query_opt(
                "SELECT to_jsonb(m.role) FROM campaign.memberships m \
             WHERE campaign_id = $1::text::uuid AND user_id = $2::text::uuid",
                &[&target.campaign_id, &target.id],
            )
            .context("read campaign membership role")?
            .map(crate::records::decode)
            .transpose()
    }

    pub fn list(
        client: &mut Client,
        campaign: &str,
        page: FetchPage,
    ) -> Result<Vec<Membership>, Error> {
        reads::list(
            client,
            ListRead {
                sql: "SELECT to_jsonb(m) FROM campaign.memberships m \
                  WHERE m.campaign_id = $1::text::uuid ORDER BY m.user_id LIMIT $2 OFFSET $3",
                campaign_id: campaign,
                page,
            },
        )
    }

    pub fn add(client: &mut Client, membership: &Membership) -> Result<(), Error> {
        crate::records::insert(client, "campaign.memberships", membership)
    }

    pub fn remove(client: &mut Client, target: RecordTarget<'_>) -> Result<bool, Error> {
        client
            .execute(
                "DELETE FROM campaign.memberships \
             WHERE campaign_id = $1::text::uuid AND user_id = $2::text::uuid",
                &[&target.campaign_id, &target.id],
            )
            .context("remove campaign membership")
            .map(|affected| affected != 0)
    }

    pub fn owner_id(client: &mut Client, campaign: &str) -> Result<Option<Id>, Error> {
        client
            .query_opt(
                "SELECT owner_id::text FROM campaign.campaigns WHERE id = $1::text::uuid",
                &[&campaign],
            )
            .context("read campaign owner")
            .map(|row| row.map(|row| row.get(0)))
    }
}
