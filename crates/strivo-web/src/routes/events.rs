//! SSE relay of daemon events to the browser (webui phase 2).
//!
//! `GET /events` opens a persistent connection on the IPC socket via
//! [`IpcClient::events`] and emits one Server-Sent Event per
//! `DaemonEvent`. HTMX `hx-sse="connect:/events"` subscribers see
//! every channel-went-live, recording-progress, schedule-fired, etc.
//! as it happens.
//!
//! The body is a single `event: <variant>\ndata: <json>\n\n` per
//! daemon event. Clients filter by event name using `hx-sse` selectors
//! or fall back to a plain `data:` listener.

use std::convert::Infallible;
use std::time::Duration;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::get;
use axum::Router;
use futures::stream::{Stream, StreamExt};

use crate::server::AppState;

async fn events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut event_stream = state.ipc.events();
    let stream = async_stream::stream! {
        while let Some(item) = event_stream.next().await {
            match item {
                Ok(de) => {
                    // Emit UNNAMED SSE frames (default "message" type). The
                    // SPA dispatches on the externally-tagged JSON body
                    // ({"ChannelVods":{…}}) via EventSource.onmessage, which
                    // only fires for unnamed events — a named `event:` field
                    // would make onmessage never fire and silently drop every
                    // real-time update. (The legacy htmx hx-sse selectors that
                    // needed event names are retired.)
                    match serde_json::to_string(&de) {
                        Ok(body) => {
                            yield Ok(Event::default().data(body));
                        }
                        Err(e) => {
                            tracing::warn!("event JSON encode failed: {e}");
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("daemon event stream error: {e}");
                    yield Ok(Event::default().data(
                        serde_json::json!({ "Error": e.to_string() }).to_string(),
                    ));
                    break;
                }
            }
        }
    };
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

pub fn router() -> Router<AppState> {
    Router::new().route("/events", get(events))
}
