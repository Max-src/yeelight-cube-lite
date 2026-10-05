/**
 * The shared card frame (card-shell.js). The header follows Home Assistant's
 * card header theme variables, with the lamp status on the right; "Show card
 * background" off keeps the frame without its surface. Part of
 * cardLayoutStyles, which every card includes in its static styles.
 */
const cardShellStyles = `
  ha-card.yc-card-plain {
    background: transparent;
    border: none;
    box-shadow: none;
  }
  .yc-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px 0;
  }
  .yc-card-title {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--ha-card-header-color, var(--primary-text-color));
    font-family: var(--ha-card-header-font-family, inherit);
    font-size: var(--ha-card-header-font-size, 24px);
    letter-spacing: -0.012em;
    line-height: 48px;
  }
  .yc-card-title[role="button"] {
    cursor: pointer;
  }
  .yc-card-status {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 12px;
    color: var(--secondary-text-color, #666);
  }
  /* Every card's content: one padding, so cards line up in a dashboard
     and with the header. */
  .yc-card-body {
    padding: 16px;
    min-width: 0;
  }
  .yc-card-notice {
    color: var(--secondary-text-color, #888);
  }
  .yc-card-notice-detail {
    margin-top: 4px;
    font-size: 0.85em;
  }
  .yc-card-muted {
    color: var(--secondary-text-color, #888);
  }
`;

export const cardSpacing = Object.freeze({
  section: "var(--yc-section-gap, 16px)",
  control: "var(--yc-control-gap, 8px)",
});

export const cardLayoutStyles = `
  .yc-stack, :host(.yc-stack) {
    display: flex;
    flex-direction: column;
    gap: ${cardSpacing.section};
    min-width: 0;
  }
  .yc-stack.yc-controls, :host(.yc-controls) {
    gap: ${cardSpacing.control};
  }
  .yc-row {
    display: flex;
    flex-wrap: wrap;
    gap: ${cardSpacing.control};
    min-width: 0;
  }
  .yc-stack > *, .yc-row > *, :host(.yc-stack) > * {
    margin-block: 0;
    min-width: 0;
  }
  .yc-stack > [hidden], .yc-row > [hidden], :host([hidden]) {
    display: none !important;
  }
  ${cardShellStyles}
`;
