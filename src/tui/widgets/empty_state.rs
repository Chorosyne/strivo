//! Centered empty-state card with a glyph, headline, body tip, and an optional
//! `[key] action` chip. Used by panes that need to teach the user what to do
//! when there's nothing to show — sidebar with no channels, recording list
//! with no recordings, search with no matches, plugin pane pre-activation.
//!
//! The card centers itself vertically and horizontally inside the given
//! `area`, picking the inner rect from the caller's `Block`. The caller is
//! responsible for drawing the surrounding border/title.

use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::tui::theme::Theme;

/// One discoverability hint: which key to press to do the suggested action.
pub struct KeyHint {
    pub key: &'static str,
    pub action: &'static str,
}

pub struct EmptyState<'a> {
    pub glyph: &'a str,
    pub title: &'a str,
    pub tip: &'a str,
    pub hints: &'a [KeyHint],
}

pub fn render(frame: &mut Frame, area: Rect, state: &EmptyState<'_>) {
    if area.height < 5 || area.width < 16 {
        // Pane is too small for a card — render just the title as a single
        // muted line so we don't show a half-cut glyph.
        let p = Paragraph::new(state.title)
            .alignment(Alignment::Center)
            .style(Style::new().fg(Theme::muted()));
        frame.render_widget(p, area);
        return;
    }

    // Compute lines we want to show, then vertically center.
    let mut lines: Vec<Line> = vec![Line::from(Span::styled(
        state.glyph.to_string(),
        Style::new()
            .fg(Theme::primary())
            .add_modifier(Modifier::BOLD),
    ))];
    lines.push(Line::raw(""));
    lines.push(Line::from(Span::styled(
        state.title.to_string(),
        Style::new().fg(Theme::fg()).add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(Span::styled(
        state.tip.to_string(),
        Style::new().fg(Theme::muted()),
    )));

    if !state.hints.is_empty() {
        lines.push(Line::raw(""));
        let mut spans: Vec<Span<'_>> = Vec::new();
        for (i, hint) in state.hints.iter().enumerate() {
            if i > 0 {
                spans.push(Span::raw("  "));
            }
            spans.push(Span::styled(format!("[{}]", hint.key), Theme::key_hint()));
            spans.push(Span::raw(" "));
            spans.push(Span::styled(
                hint.action.to_string(),
                Style::new().fg(Theme::fg()),
            ));
        }
        lines.push(Line::from(spans));
    }

    let card_height = lines.len() as u16;
    let [_, center, _] = Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(card_height),
        Constraint::Fill(1),
    ])
    .areas(area);

    let p = Paragraph::new(lines).alignment(Alignment::Center);
    frame.render_widget(p, center);
}
