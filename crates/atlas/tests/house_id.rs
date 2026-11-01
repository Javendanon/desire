//! A house id packs its block and its lot: block × 4096 + lot, in 32 bits. Ids that do not fit
//! are refused, never wrapped into another house's id.

use desire_atlas::houses::house_id;

#[test]
fn an_id_packs_block_and_lot() {
    assert_eq!(house_id(0, 0), Ok(0));
    assert_eq!(house_id(3, 2), Ok(3 * 4096 + 2));
    assert_eq!(house_id((1 << 20) - 1, 4095), Ok(u32::MAX));
}

#[test]
fn a_lot_past_the_block_share_is_refused() {
    assert!(house_id(1, 4096).unwrap_err().contains("lot"));
}

#[test]
fn a_block_past_the_id_space_is_refused_instead_of_wrapping() {
    assert!(house_id(1 << 20, 0).unwrap_err().contains("block"));
}
