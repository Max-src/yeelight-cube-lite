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
`;
