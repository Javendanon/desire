//! TLS for PostgreSQL connections whose `sslmode` demands it.
//!
//! `tokio-postgres` skips TLS when it is handed `NoTls`, whatever the connection string says:
//! the server negotiates TLS and the driver then fails or, worse, would talk in plaintext. A
//! `sslmode=require` URL therefore needs a real connector. This module supplies one built on
//! rustls and the WebPKI roots (no OpenSSL, so the runtime image stays slim), and refuses to
//! fall back to plaintext when the handshake fails.
//!
//! `prefer` and `disable` keep `NoTls`: plaintext now, exactly as before. `prefer` would have
//! to try TLS and fall back, and a fallback nobody exercised is a fallback that lies.

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use std::{
    future::Future,
    io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio_postgres::{
    Config, Socket,
    config::SslMode,
    tls::{ChannelBinding, MakeTlsConnect, TlsConnect, TlsStream},
};
use tokio_rustls::TlsConnector;
use tokio_rustls::client;

/// How a connection string wants TLS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// `sslmode=disable`, `prefer` or unset: the plaintext path that existed before.
    Plain,
    /// `sslmode=require`: a verified TLS handshake and no plaintext fallback.
    Verify,
}

pub fn mode(config: &Config) -> Mode {
    match config.get_ssl_mode() {
        SslMode::Require => Mode::Verify,
        SslMode::Disable | SslMode::Prefer => Mode::Plain,
        // The enum is non-exhaustive; an unknown mode fails closed instead of downgrading.
        _ => Mode::Verify,
    }
}

/// A connector that verifies the server certificate and its hostname against the WebPKI roots.
pub fn connector() -> Result<Connector, String> {
    let roots = RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Connector {
        inner: TlsConnector::from(Arc::new(config)),
    })
}

pub struct Connector {
    inner: TlsConnector,
}

impl MakeTlsConnect<Socket> for Connector {
    type Stream = Stream;
    type TlsConnect = Connect;
    type Error = io::Error;

    fn make_tls_connect(&mut self, domain: &str) -> Result<Connect, io::Error> {
        let name = ServerName::try_from(domain.to_owned())
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        Ok(Connect {
            inner: self.inner.clone(),
            name,
        })
    }
}

pub struct Connect {
    inner: TlsConnector,
    name: ServerName<'static>,
}

impl TlsConnect<Socket> for Connect {
    type Stream = Stream;
    type Error = io::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Stream, io::Error>> + Send>>;

    fn connect(self, socket: Socket) -> Self::Future {
        Box::pin(async move {
            let stream = self
                .inner
                .connect(self.name, socket)
                .await
                .map_err(io::Error::other)?;
            Ok(Stream(stream))
        })
    }
}

pub struct Stream(client::TlsStream<Socket>);

impl AsyncRead for Stream {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().0).poll_read(context, buffer)
    }
}

impl AsyncWrite for Stream {
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().0).poll_write(context, buffer)
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().0).poll_flush(context)
    }

    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().0).poll_shutdown(context)
    }
}

impl TlsStream for Stream {
    fn channel_binding(&self) -> ChannelBinding {
        ChannelBinding::none()
    }
}

#[cfg(test)]
mod tests;
