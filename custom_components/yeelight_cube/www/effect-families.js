/**
 * The families the effect and clock style galleries filter by (const.py
 * EFFECT_FAMILIES): what an effect looks like. The lamp's catalog gives each
 * effect its family; the offline catalogue and the clock styles have them from
 * EFFECT_FAMILY_NAMES below.
 */

export const EFFECT_FAMILIES = [
  { value: "all", label: "All", icon: "mdi:view-grid-outline", title: "All effects" },
  { value: "waves", label: "Waves", icon: "mdi:waves", title: "Waves: flowing colors and bands" },
  { value: "glow", label: "Glow", icon: "mdi:fire", title: "Glow: fire, clouds and soft light" },
  { value: "sparkles", label: "Sparkles", icon: "mdi:creation", title: "Sparkles: stars and particles" },
  { value: "motion", label: "Motion", icon: "mdi:motion-play-outline", title: "Motion: moving dots, trails and blocks" },
  { value: "music", label: "Music", icon: "mdi:music-note", title: "Music: reacts to sound" },
  { value: "still", label: "Still", icon: "mdi:image-outline", title: "Still: pictures and fixed colors" },
];

// Every effect the cards list, for the offline catalogue and the clock styles.
export const EFFECT_FAMILY_NAMES = {
  waves: [
    "Two-colour alternation", "Breathing", "Ribbon", "Moving palette",
    "Rotating colour bands", "Triangular palette pulses", "Sine wave",
    "Sunrise and sunset", "Scrolling bands", "Palette cross-fade", "Rainbow",
    "Waves", "Violet interference", "Night-amber waves", "Night-sky waves",
    "Neon sine bands", "Daydream",
  ],
  glow: [
    "Aurora", "Heat fire", "Rising wisps", "Fire", "Rainbow noise", "Flower Sea",
    "Navy-white noise", "Magic", "Wonderland", "Kaleidoscope", "Palette",
    "Halloween glow", "Moonlit clouds",
  ],
  sparkles: [
    "Starry Sky", "Particle path", "Fireworks", "Palette sparks", "Flicker sweep",
    "Particle glows", "Centre bursts", "Violet twinkles", "Snowfall",
  ],
  motion: [
    "Dual scan", "Palette trails", "Drop and bounce", "Stacking blocks",
    "Mirrored comets", "Aqua-lime trails", "Waterfall", "Tide (slot 35)",
    "Bouncing Ball", "Sine plotter", "Hacking", "Meteor", "Tide",
    "Building Blocks", "Dot with fading trail", "Rainbow fill-in (one-shot)",
    "Rainbow wipe-out (one-shot)", "White fill-in (one-shot)",
    "White wipe-out (one-shot)",
  ],
  music: [
    "Music level glow", "Music bars from both ends", "Music bars from the centre",
    "Music bass-mid-treble colour", "Music bar from one end", "Music Spectrum",
    "Music Gather", "Music Breathing", "Music Blossom", "Music noise equalizer",
    "Music Note", "Music Impact",
  ],
  still: ["Spectrum", "Solid red", "Palette stripes", "Stored GIF", "Random scatter"],
};

// Each family's emoji: its icon where only text can show (a dropdown's
// options, text buttons).
const FAMILY_EMOJI = {
  waves: "🌊",
  glow: "🔥",
  sparkles: "✨",
  motion: "▶️",
  music: "🎵",
  still: "🖼️",
};

const FAMILY_BADGES = new Map(
  EFFECT_FAMILIES.filter((family) => family.value !== "all").map((family) => [
    family.value,
    Object.freeze({ icon: family.icon, title: family.title, emoji: FAMILY_EMOJI[family.value] }),
  ]),
);

/** The small icon an effect shows its family by (a flame for Glow, a
 * sparkle, a music note...): { icon, title, emoji }, the filter's own, the
 * title ("Glow: fire, clouds and soft light") its tooltip, the emoji for
 * text-only places; null for none. */
export const familyBadge = (family) => FAMILY_BADGES.get(family) ?? null;

const FAMILY_OF_NAME = new Map(
  Object.entries(EFFECT_FAMILY_NAMES).flatMap(([family, names]) =>
    names.map((name) => [name, family]),
  ),
);

export const effectFamilyOfName = (name) => FAMILY_OF_NAME.get(name);

/** Whether a gallery item shows under a family filter value. */
export const matchesEffectFamily = (item, value) =>
  !value || value === "all" || item?.family === value;

/** The filter's choices: All, then the families these items have. */
export const effectFamilyChoices = (items) => {
  const present = new Set(items.map((item) => item.family));
  return EFFECT_FAMILIES.filter(
    (choice) => choice.value === "all" || present.has(choice.value),
  );
};

function savedFamily(storageKey, fallback = "all") {
  try {
    return localStorage.getItem(storageKey) || fallback;
  } catch {
    return fallback;
  }
}

function saveFamily(storageKey, value) {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Not remembered in this browser.
  }
}

/**
 * A card's family filter over its items (each with a `family`). The pick is
 * kept in this browser, per kind of card (storageKey).
 */
export class FamilyFilter {
  constructor(host, label, storageKey) {
    this.host = host;
    this.label = label;
    this.storageKey = storageKey;
  }

  /** The family shown: the one picked, "all" while the filter cannot be seen
   * (the card's options) or the items have none of it. */
  value(items) {
    const { show_family_filter, show_gallery } = this.host.config;
    if (show_family_filter === false || show_gallery === false) return "all";
    const value = (this._picked ??= savedFamily(this.storageKey));
    return items.some((item) => item.family === value) ? value : "all";
  }

  /** The gallery's filter (collection-gallery.js): the same object while
   * nothing changes, so an update never re-renders the gallery. */
  gallery(items) {
    const choices = effectFamilyChoices(items);
    const value = this.value(items);
    const hidden = this.host.config.show_family_filter === false || choices.length < 3;
    const key = choices.map((choice) => choice.value).join();
    const cached = this._gallery;
    if (cached?.value !== value || cached?.hidden !== hidden || cached?.key !== key)
      this._gallery = {
        label: this.label,
        key,
        value,
        hidden,
        choices,
        match: matchesEffectFamily,
        onChange: (choice) => {
          this._picked = choice;
          saveFamily(this.storageKey, choice);
          this.host.requestUpdate();
          this.host._controls?.notify();
        },
      };
    return this._gallery;
  }
}

// The orders a gallery can be sorted in on the card (card-config.js
// sortGalleryItems).
export const GALLERY_SORTS = [
  { value: "manual", label: "Default", icon: "mdi:sort", title: "Default order" },
  { value: "name", label: "A → Z", icon: "mdi:sort-alphabetical-ascending", title: "A → Z" },
  { value: "family", label: "Family", icon: "mdi:shape-outline", title: "By family" },
];
const SORT_VALUES = new Set(GALLERY_SORTS.map((sort) => sort.value));

/**
 * A card's sort toggle beside its family filter. The pick is kept in this
 * browser, per kind of card (storageKey); until one is made, the card's
 * gallery_sort (its editor's Order).
 */
export class GallerySort {
  constructor(host, storageKey) {
    this.host = host;
    this.storageKey = storageKey;
  }

  /** The order shown: the one picked, or the card's while the toggle cannot
   * be seen (show_sort: false). */
  value() {
    const configured = this.host.config.gallery_sort === "name" ? "name" : "manual";
    if (this.host.config.show_sort === false) return configured;
    const value = (this._picked ??= savedFamily(this.storageKey, ""));
    return SORT_VALUES.has(value) ? value : configured;
  }

  /** The gallery's sort (collection-gallery.js), the same object while it
   * does not change. */
  gallery() {
    const value = this.value();
    const hidden = this.host.config.show_sort === false;
    const cached = this._gallery;
    if (cached?.value !== value || cached?.hidden !== hidden)
      this._gallery = {
        label: "Sort",
        value,
        hidden,
        choices: GALLERY_SORTS,
        onChange: (choice) => {
          this._picked = choice;
          saveFamily(this.storageKey, choice);
          this.host.requestUpdate();
          this.host._controls?.notify();
        },
      };
    return this._gallery;
  }
}
