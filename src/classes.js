// Maps raw model class names to the friendly, beach-themed labels we show,
// plus which detector targets we actually care about counting.
//
// COCO-SSD (the default offline model) knows 80 classes. The ones that matter
// on a Puget Sound shoreline are bird / boat / airplane. Seals and otters are
// NOT in COCO — there is no free in-browser model for them — so those are
// logged by hand (the 🦭 / 🦦 buttons) or via a custom model you plug in.

export const CLASS_MAP = {
  bird: { label: 'Seagull / bird', emoji: '🐦', color: '#ffd166', kind: 'bird' },
  boat: { label: 'Ship / boat', emoji: '🚢', color: '#4cc9f0', kind: 'boat' },
  airplane: { label: 'Plane', emoji: '✈️', color: '#f72585', kind: 'airplane' },
  // Bonus shoreline regulars that COCO can spot:
  person: { label: 'Person', emoji: '🧍', color: '#b5179e', kind: 'person' },
  dog: { label: 'Dog', emoji: '🐕', color: '#90be6d', kind: 'dog' },
  // Hooks for a custom marine-mammal model (class names you'd export it with):
  seal: { label: 'Seal', emoji: '🦭', color: '#43aa8b', kind: 'seal' },
  'sea lion': { label: 'Sea lion', emoji: '🦭', color: '#43aa8b', kind: 'seal' },
  otter: { label: 'Otter', emoji: '🦦', color: '#577590', kind: 'otter' }
};

// Classes we surface by default. Anything not here is ignored to cut noise.
export const TRACKED_CLASSES = new Set(Object.keys(CLASS_MAP));

export function describe(rawClass) {
  return (
    CLASS_MAP[rawClass] || {
      label: rawClass,
      emoji: '•',
      color: '#cccccc',
      kind: rawClass
    }
  );
}

// Manual-tag definitions for the on-screen buttons.
export const MANUAL_TAGS = {
  seal: { label: 'Seal', emoji: '🦭', kind: 'seal' },
  otter: { label: 'Otter', emoji: '🦦', kind: 'otter' }
};
