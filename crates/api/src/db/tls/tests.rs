use super::*;

fn config(url: &str) -> Config {
    url.parse().unwrap()
}

#[test]
fn only_a_require_url_asks_for_a_verified_handshake() {
    let base = "postgres://user:secret@db.internal:5432/desire";
    assert_eq!(
        mode(&config(&format!("{base}?sslmode=require"))),
        Mode::Verify
    );
    assert_eq!(
        mode(&config(&format!("{base}?sslmode=prefer"))),
        Mode::Plain
    );
    assert_eq!(
        mode(&config(&format!("{base}?sslmode=disable"))),
        Mode::Plain
    );
    assert_eq!(mode(&config(base)), Mode::Plain);
}

#[test]
fn a_require_url_is_never_opened_with_the_plaintext_driver() {
    let plaintext = config("postgres://user:secret@db.internal:5432/desire");
    assert_eq!(mode(&plaintext), Mode::Plain);

    let encrypted = config("postgres://user:secret@db.internal:5432/desire?sslmode=require");
    assert_eq!(mode(&encrypted), Mode::Verify);
    let mut connector = connector().unwrap();
    let connect = connector.make_tls_connect("db.internal").unwrap();
    assert_eq!(connect.name, ServerName::try_from("db.internal").unwrap());
}

#[test]
fn a_hostname_that_cannot_be_verified_is_rejected_before_connecting() {
    let mut connector = connector().unwrap();
    let error = match connector.make_tls_connect("db.internal:5432") {
        Ok(_) => panic!("a host with a port is not a certificate name"),
        Err(error) => error,
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
}
