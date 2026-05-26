use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Paragraph, Wrap},
    Frame,
};

use crate::app::{ActivePane, AppState};
use crate::tui::anim::{easing::Ease, pulse_phase, reduce_motion};
use crate::tui::theme::Theme;

/// Derive a LIVE-badge background color pulsing 2 s between the theme's green
/// and a slightly desaturated variant blended toward the fg. Subtle enough to
/// catch the eye without becoming noisy.
fn rec_bg(elapsed_secs: f32) -> ratatui::style::Color {
    use ratatui::style::Color;
    if reduce_motion() {
        return Theme::red();
    }
    let base = match Theme::red() {
        Color::Rgb(r, g, b) => (r as f32, g as f32, b as f32),
        other => return other,
    };
    let p = Ease::InOutSine.apply(pulse_phase(elapsed_secs, 2.0));
    let factor = 0.75 + 0.25 * p;
    Color::Rgb(
        (base.0 * factor).round().clamp(0.0, 255.0) as u8,
        (base.1 * factor).round().clamp(0.0, 255.0) as u8,
        (base.2 * factor).round().clamp(0.0, 255.0) as u8,
    )
}

fn live_bg(elapsed_secs: f32) -> ratatui::style::Color {
    use ratatui::style::Color;
    if reduce_motion() {
        return Theme::green();
    }
    let base = match Theme::green() {
        Color::Rgb(r, g, b) => (r as f32, g as f32, b as f32),
        other => return other,
    };
    let p = Ease::InOutSine.apply(pulse_phase(elapsed_secs, 2.0));
    // Modulate brightness in [0.75, 1.0] so the badge never dims to the point
    // of disappearing against the card.
    let factor = 0.75 + 0.25 * p;
    Color::Rgb(
        (base.0 * factor).round().clamp(0.0, 255.0) as u8,
        (base.1 * factor).round().clamp(0.0, 255.0) as u8,
        (base.2 * factor).round().clamp(0.0, 255.0) as u8,
    )
}

pub fn render(frame: &mut Frame, area: Rect, app: &mut AppState) {
    let border_style = app.pane_border(&ActivePane::Detail);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(border_style)
        .title(" Channel Detail ")
        .title_style(Theme::title());

    let Some(channel) = app.selected_channel() else {
        let placeholder = Paragraph::new("Select a channel from the sidebar")
            .style(Style::new().fg(Theme::muted()))
            .block(block);
        frame.render_widget(placeholder, area);
        return;
    };

    // Patreon creators have no live state — render a post list the user
    // can pull from at will (task #69) instead of the stream metadata.
    if channel.platform == crate::platform::PlatformKind::Patreon {
        let campaign_id = channel.id.clone();
        let display_name = channel.display_name.clone();
        let inner = block.inner(area);
        let block = block.title(" Patreon — Recent Posts ");
        frame.render_widget(block, area);
        render_patreon_posts(frame, inner, app, &campaign_id, &display_name);
        return;
    }

    let inner = block.inner(area);
    frame.render_widget(block, area);

    // Responsive layout: horizontal if wide enough, else vertical
    let (info_area, thumbnail_area) = if inner.width >= 70 {
        let [info, thumb] =
            Layout::horizontal([Constraint::Fill(1), Constraint::Length(46)]).areas(inner);
        (info, thumb)
    } else {
        let [info, thumb] =
            Layout::vertical([Constraint::Length(7), Constraint::Fill(1)]).areas(inner);
        (info, thumb)
    };

    // Stream info
    let title = channel.stream_title.as_deref().unwrap_or("Not streaming");
    let category = channel.game_or_category.as_deref().unwrap_or("");
    let viewers = channel
        .viewer_count
        .map(|v| format!("{} viewers", format_count(v)))
        .unwrap_or_default();
    let uptime = channel
        .started_at
        .map(|s| format_duration(chrono::Utc::now() - s))
        .unwrap_or_default();

    let status_indicator = if channel.is_live {
        Span::styled(
            " LIVE ",
            Style::new()
                .fg(Theme::bg())
                .bg(live_bg(app.clock.elapsed().as_secs_f32()))
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(" OFFLINE ", Style::new().fg(Theme::fg()).bg(Theme::dim()))
    };

    // Check if currently recording
    let is_recording = app.is_channel_recording(&channel.id);

    let rec_indicator = if is_recording {
        Span::styled(
            " REC ",
            Style::new()
                .fg(Theme::bg())
                .bg(rec_bg(app.clock.elapsed().as_secs_f32()))
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::raw("")
    };

    let auto_indicator = if channel.auto_record {
        Span::styled(" MON ", Style::new().fg(Theme::bg()).bg(Theme::secondary()))
    } else {
        Span::raw("")
    };

    let info_lines = vec![
        Line::from(vec![
            Span::styled(
                &channel.display_name,
                Style::new().fg(Theme::fg()).add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            status_indicator,
            Span::raw(" "),
            rec_indicator,
            Span::raw(" "),
            auto_indicator,
        ]),
        Line::raw(""),
        Line::styled(title, Style::new().fg(Theme::fg())),
        Line::from(vec![
            Span::styled(category, Style::new().fg(Theme::blue())),
            Span::styled(
                if !viewers.is_empty() {
                    format!(" · {viewers}")
                } else {
                    String::new()
                },
                Style::new().fg(Theme::muted()),
            ),
            Span::styled(
                if !uptime.is_empty() {
                    format!(" · {uptime}")
                } else {
                    String::new()
                },
                Style::new().fg(Theme::muted()),
            ),
        ]),
        Line::raw(""),
        Line::styled(
            format!("Platform: {}", channel.platform),
            Style::new().fg(Theme::muted()),
        ),
    ];

    // Split the info column: top = metadata, bottom = recent recordings
    // for this channel. Reflowing the otherwise-blank lower half makes the
    // detail pane feel dense without adding a new pane. Threshold height
    // ensures we don't squeeze the metadata when the terminal is short.
    if info_area.height >= 12 {
        let [meta_area, recent_area] =
            Layout::vertical([Constraint::Length(7), Constraint::Fill(1)]).areas(info_area);

        frame.render_widget(
            Paragraph::new(info_lines).wrap(Wrap { trim: false }),
            meta_area,
        );

        let mut recent_lines: Vec<Line> = Vec::new();
        recent_lines.push(Line::from(Span::styled(
            "Recent recordings",
            Style::new()
                .fg(Theme::secondary())
                .add_modifier(Modifier::BOLD),
        )));
        let mut recs: Vec<&crate::recording::job::RecordingJob> = app
            .recordings
            .values()
            .filter(|r| r.channel_id == channel.id || r.channel_name == channel.display_name)
            .collect();
        recs.sort_by_key(|r| std::cmp::Reverse(r.started_at));
        if recs.is_empty() {
            recent_lines.push(Line::from(Span::styled(
                "  no recordings yet",
                Style::new().fg(Theme::muted()),
            )));
        } else {
            let cap = (recent_area.height.saturating_sub(1)).min(5) as usize;
            for rec in recs.iter().take(cap) {
                let when = rec.started_at.format("%m-%d %H:%M").to_string();
                let dur = rec.format_duration();
                let title = rec
                    .stream_title
                    .as_deref()
                    .unwrap_or("(no title)")
                    .chars()
                    .take(40)
                    .collect::<String>();
                recent_lines.push(Line::from(vec![
                    Span::styled(format!("  {when} "), Style::new().fg(Theme::dim())),
                    Span::styled(format!("{dur:>6}  "), Style::new().fg(Theme::muted())),
                    Span::styled(title, Style::new().fg(Theme::fg())),
                ]));
            }
        }
        frame.render_widget(
            Paragraph::new(recent_lines).wrap(Wrap { trim: false }),
            recent_area,
        );
    } else {
        frame.render_widget(
            Paragraph::new(info_lines).wrap(Wrap { trim: false }),
            info_area,
        );
    }

    // Render thumbnail with rounded border. C6.1 — when the thumbnail
    // protocol was refreshed recently, ramp the border color from primary
    // → dim over 600 ms so the user notices the image updated (the image
    // bitmap itself is opaque via ratatui-image, so we can't alpha-blend
    // the pixels directly).
    let channel_id = channel.id.clone();
    let thumb_border = app
        .thumbnail_changed_at
        .get(&channel_id)
        .map(|at| at.elapsed().as_secs_f32())
        .filter(|secs| *secs < 0.6 && !crate::tui::anim::reduce_motion())
        .map(|secs| {
            let t = (secs / 0.6).clamp(0.0, 1.0);
            let eased = crate::tui::anim::easing::Ease::OutCubic.apply(t);
            Style::new().fg(Theme::blend_for(Theme::primary(), Theme::dim(), eased))
        })
        .unwrap_or_else(Theme::border);
    let thumb_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(thumb_border)
        .title(" Preview ")
        .title_style(Style::new().fg(Theme::muted()));
    let thumb_inner = thumb_block.inner(thumbnail_area);
    frame.render_widget(thumb_block, thumbnail_area);

    if let Some(proto) = app.thumbnail_protocols.get_mut(&channel_id) {
        let image_widget = ratatui_image::StatefulImage::default();
        frame.render_stateful_widget(image_widget, thumb_inner, proto);
    }
}

fn format_count(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

fn format_duration(dur: chrono::TimeDelta) -> String {
    let total_secs = dur.num_seconds();
    if total_secs < 0 {
        return String::new();
    }
    let hours = total_secs / 3600;
    let mins = (total_secs % 3600) / 60;
    if hours > 0 {
        format!("{}h {:02}m", hours, mins)
    } else {
        format!("{}m", mins)
    }
}

/// Render the recent-posts list for a selected Patreon creator. Each row
/// is a video post; the cursor (app.patreon_post_cursor) highlights the
/// one `p`/Enter will pull. Pulled posts that already have a recording
/// on disk are marked. (task #69)
fn render_patreon_posts(
    frame: &mut Frame,
    area: Rect,
    app: &AppState,
    campaign_id: &str,
    display_name: &str,
) {
    use ratatui::widgets::{List, ListItem, ListState};

    let header = Paragraph::new(Line::from(vec![
        Span::styled(
            display_name.to_string(),
            Style::new().fg(Theme::patreon()).add_modifier(Modifier::BOLD),
        ),
        Span::raw("   "),
        Span::styled(
            "[p] pull  [j/k] move  [t] toggle auto-pull",
            Style::new().fg(Theme::muted()),
        ),
    ]));

    let [head_area, list_area] =
        Layout::vertical([Constraint::Length(2), Constraint::Fill(1)]).areas(area);
    frame.render_widget(header, head_area);

    let posts = app.patreon_posts.get(campaign_id);
    let Some(posts) = posts.filter(|p| !p.is_empty()) else {
        let empty = Paragraph::new(
            "No video posts yet.\nThe monitor refreshes this list every poll.",
        )
        .style(Style::new().fg(Theme::muted()))
        .wrap(Wrap { trim: true });
        frame.render_widget(empty, list_area);
        return;
    };

    let cursor = app.patreon_post_cursor.min(posts.len() - 1);
    let items: Vec<ListItem> = posts
        .iter()
        .map(|post| {
            // published_at is RFC3339; show just the date portion.
            let date = post.published_at.get(0..10).unwrap_or("");
            ListItem::new(Line::from(vec![
                Span::styled(format!("{date}  "), Style::new().fg(Theme::dim())),
                Span::styled(post.title.clone(), Style::new().fg(Theme::fg())),
            ]))
        })
        .collect();

    let list = List::new(items)
        .highlight_style(
            Style::new()
                .fg(Theme::bg())
                .bg(Theme::patreon())
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    state.select(Some(cursor));
    frame.render_stateful_widget(list, list_area, &mut state);
}
