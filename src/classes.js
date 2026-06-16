// Maps raw model class names to the friendly, beach-themed labels we show,
// plus which detector targets we actually care about counting.
//
// COCO-SSD (the default offline model) knows 80 classes. The shoreline-relevant
// ones are bird / boat / airplane plus a few beach regulars (kite, surfboard,
// umbrella, person, dog). Seals and otters are NOT in COCO — there is no free
// in-browser model for them — so those are logged by hand (the 🦭 / 🦦 buttons)
// or via a custom model you plug in.
//
// A bare "boat" gets refined into a fishing boat / ferry / cargo ship / sailboat
// etc. once AIS identifies it (see VESSEL_TYPES below).

export const CLASS_MAP = {
  bird: { label: 'Seagull', emoji: '🐦', color: '#ffd166', kind: 'bird' },
  boat: { label: 'Ship / boat', emoji: '🚢', color: '#4cc9f0', kind: 'boat' },
  airplane: { label: 'Plane', emoji: '✈️', color: '#f72585', kind: 'airplane' },
  // Beach regulars COCO can spot out of the box:
  kite: { label: 'Kite', emoji: '🪁', color: '#ff9f1c', kind: 'kite' },
  surfboard: { label: 'Surfboard', emoji: '🏄', color: '#2ec4b6', kind: 'surfboard' },
  umbrella: { label: 'Beach umbrella', emoji: '⛱️', color: '#e71d36', kind: 'umbrella' },
  person: { label: 'Person', emoji: '🧍', color: '#b5179e', kind: 'person' },
  dog: { label: 'Dog', emoji: '🐕', color: '#90be6d', kind: 'dog' },
  // Hooks for a custom marine-mammal model (class names you'd export it with):
  seal: { label: 'Seal', emoji: '🦭', color: '#43aa8b', kind: 'seal' },
  'sea lion': { label: 'Sea lion', emoji: '🦭', color: '#43aa8b', kind: 'seal' },
  otter: { label: 'Otter', emoji: '🦦', color: '#577590', kind: 'otter' }
};

// Classes we surface by default. Anything not here is ignored to cut noise.
export const TRACKED_CLASSES = new Set(Object.keys(CLASS_MAP));

// --- Vessel subtypes, derived from AIS ship-type codes ------------------
// A detected "boat" is generic. Once AIS tells us the ship type we promote it
// to a specific vessel kind with its own emoji, label and counter.
export const VESSEL_TYPES = {
  fishing: { label: 'Fishing boat', emoji: '🎣', color: '#06d6a0', kind: 'vessel_fishing' },
  sailing: { label: 'Sailboat', emoji: '⛵', color: '#a0c4ff', kind: 'vessel_sailing' },
  pleasure: { label: 'Pleasure craft', emoji: '🛥️', color: '#bdb2ff', kind: 'vessel_pleasure' },
  passenger: { label: 'Ferry', emoji: '⛴️', color: '#4cc9f0', kind: 'vessel_passenger' },
  hsc: { label: 'Fast ferry', emoji: '🚤', color: '#48cae4', kind: 'vessel_passenger' },
  cargo: { label: 'Cargo ship', emoji: '🚢', color: '#90a4ae', kind: 'vessel_cargo' },
  tanker: { label: 'Tanker', emoji: '🛢️', color: '#ffb703', kind: 'vessel_tanker' },
  tug: { label: 'Tug', emoji: '🚜', color: '#f4a261', kind: 'vessel_tug' },
  military: { label: 'Military vessel', emoji: '🪖', color: '#6c757d', kind: 'vessel_military' },
  other: { label: 'Vessel', emoji: '🚢', color: '#4cc9f0', kind: 'boat' }
};

// Map a raw AIS ship-type code (0-99) to one of the buckets above.
export function vesselBucketFromAisType(code) {
  if (code == null) return null;
  if (code === 30) return 'fishing';
  if (code === 36) return 'sailing';
  if (code === 37) return 'pleasure';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 40 && code <= 49) return 'hsc';
  if (code === 52 || code === 31 || code === 32) return 'tug';
  if (code === 35 || code === 55) return 'military';
  return 'other';
}

// Resolve the subtype descriptor for an AIS-matched vessel, or null if unknown.
export function vesselSubtype(aisVessel) {
  if (!aisVessel) return null;
  const bucket = vesselBucketFromAisType(aisVessel.typeCode);
  if (!bucket || bucket === 'other') return null;
  return { bucket, ...VESSEL_TYPES[bucket] };
}

export function describe(rawClass) {
  return (
    CLASS_MAP[rawClass] ||
    Object.values(VESSEL_TYPES).find((v) => v.kind === rawClass) || {
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
