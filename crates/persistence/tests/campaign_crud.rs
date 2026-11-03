//! Typed application repositories work without HTTP extractors, payloads or errors.
mod support;

use desire_core::contracts::{
    campaign::{Campaign, Character, Membership},
    common::{MemberRole, RulesEdition},
};
use desire_persistence::{
    Audience, CampaignRead, CampaignRepository, CatalogRepository, CharacterRepository, FetchPage,
    MembershipRepository, RecordTarget, migrations,
};
use postgres::Client;
use support::id;

struct Fixture {
    db: Client,
    first: Campaign,
    second: Campaign,
}

impl Fixture {
    fn new() -> Self {
        let mut db = support::database();
        migrations::apply(&mut db).unwrap();
        CatalogRepository::seed(&mut db, &support::catalog()).unwrap();
        let first = campaign(10);
        let second = campaign(11);
        CampaignRepository::create(&mut db, &first).unwrap();
        CampaignRepository::create(&mut db, &second).unwrap();
        Self { db, first, second }
    }

    fn character(&mut self, index: u64, controlled: bool) {
        let character = Character {
            id: id(index),
            campaign_id: self.first.id.clone(),
            controller_id: controlled.then(|| self.first.owner_id.clone()),
            name: format!("Character {index}"),
            rules_edition: RulesEdition::Dnd2014,
            revision: 1,
        };
        CharacterRepository::create(&mut self.db, &character).unwrap();
    }
}

fn campaign(index: u64) -> Campaign {
    Campaign {
        id: id(index),
        owner_id: id(index + 100),
        city_id: Some(id(3)),
        name: format!("Campaign {index}"),
        rules_edition: RulesEdition::Dnd2014,
        revision: 1,
    }
}

fn characters() -> Fixture {
    let mut fixture = Fixture::new();
    fixture.character(21, false);
    fixture.character(22, true);
    fixture
}

#[test]
fn typed_character_reads_preserve_page_windows() {
    let mut f = characters();
    let scope = CampaignRead {
        campaign_id: &f.first.id,
        audience: Audience::All,
    };
    let rows = CharacterRepository::list(
        &mut f.db,
        scope,
        FetchPage {
            limit: 1,
            offset: 1,
        },
    )
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, id(22));
}

#[test]
fn player_character_reads_filter_hidden_rows() {
    let mut f = characters();
    let scope = CampaignRead {
        campaign_id: &f.first.id,
        audience: Audience::Players,
    };
    let rows = CharacterRepository::list(
        &mut f.db,
        scope,
        FetchPage {
            limit: 20,
            offset: 0,
        },
    )
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, id(22));
}

#[test]
fn player_character_lookup_hides_dm_records() {
    let mut f = characters();
    let hidden = RecordTarget {
        campaign_id: &f.first.id,
        id: &id(21),
    };
    assert!(
        CharacterRepository::get(&mut f.db, hidden, Audience::Players)
            .unwrap()
            .is_none()
    );
}

#[test]
fn character_ids_do_not_cross_the_campaign_boundary() {
    let mut f = characters();
    let wrong_campaign = RecordTarget {
        campaign_id: &f.second.id,
        id: &id(22),
    };
    assert!(
        CharacterRepository::get(&mut f.db, wrong_campaign, Audience::All)
            .unwrap()
            .is_none()
    );
}

#[test]
fn membership_storage_returns_domain_roles_without_http_policy() {
    let mut f = Fixture::new();
    let membership = Membership {
        campaign_id: f.first.id.clone(),
        user_id: id(300),
        role: MemberRole::Player,
    };
    MembershipRepository::add(&mut f.db, &membership).unwrap();
    let target = RecordTarget {
        campaign_id: &f.first.id,
        id: &membership.user_id,
    };
    assert_eq!(
        MembershipRepository::role(&mut f.db, target).unwrap(),
        Some(MemberRole::Player)
    );
    assert!(MembershipRepository::remove(&mut f.db, target).unwrap());
    assert_eq!(MembershipRepository::role(&mut f.db, target).unwrap(), None);
}

#[test]
fn membership_removal_preserves_the_owner_constraint_and_sqlstate() {
    let mut f = Fixture::new();
    let owner = RecordTarget {
        campaign_id: &f.first.id,
        id: &f.first.owner_id,
    };
    let error = MembershipRepository::remove(&mut f.db, owner).unwrap_err();
    assert_eq!(error.sqlstate.as_deref(), Some("23503"));
    assert_eq!(
        MembershipRepository::role(&mut f.db, owner).unwrap(),
        Some(MemberRole::Dm)
    );
}

#[test]
fn campaign_membership_queries_return_only_the_members_campaigns() {
    let mut f = Fixture::new();
    let rows = CampaignRepository::list_for_user(
        &mut f.db,
        &f.first.owner_id,
        FetchPage {
            limit: 20,
            offset: 0,
        },
    )
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0], f.first);
}
