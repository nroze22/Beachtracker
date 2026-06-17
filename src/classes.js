// Friendly labels, emojis and colours for everything the detector can see.
// YOLOv8 / COCO-SSD know all 80 COCO classes; we surface them with beach-themed
// names and group them by category colour. Seals/otters aren't in COCO (logged
// by hand or via a custom model), but are included so those labels render.

// category colour, then [label, emoji] per raw COCO class.
const CATEGORIES = {
  wildlife: {
    color: '#43aa8b',
    items: {
      bird: ['Seagull', '🐦'],
      cat: ['Cat', '🐈'],
      dog: ['Dog', '🐕'],
      horse: ['Horse', '🐎'],
      sheep: ['Sheep', '🐑'],
      cow: ['Cow', '🐄'],
      elephant: ['Elephant', '🐘'],
      bear: ['Bear', '🐻'],
      zebra: ['Zebra', '🦓'],
      giraffe: ['Giraffe', '🦒']
    }
  },
  marine: {
    color: '#2ec4b6',
    items: {
      seal: ['Seal', '🦭'],
      'sea lion': ['Sea lion', '🦭'],
      otter: ['Otter', '🦦']
    }
  },
  air: {
    color: '#f72585',
    items: { airplane: ['Plane', '✈️'], kite: ['Kite', '🪁'] }
  },
  vehicles: {
    color: '#4cc9f0',
    items: {
      boat: ['Ship / boat', '🚢'],
      bicycle: ['Bicycle', '🚲'],
      car: ['Car', '🚗'],
      motorcycle: ['Motorcycle', '🏍️'],
      bus: ['Bus', '🚌'],
      train: ['Train', '🚆'],
      truck: ['Truck', '🚚']
    }
  },
  street: {
    color: '#ffd166',
    items: {
      'traffic light': ['Traffic light', '🚦'],
      'fire hydrant': ['Fire hydrant', '🧯'],
      'stop sign': ['Stop sign', '🛑'],
      'parking meter': ['Parking meter', '🅿️'],
      bench: ['Bench', '🪑']
    }
  },
  people: { color: '#b5179e', items: { person: ['Person', '🧍'] } },
  sport: {
    color: '#06d6a0',
    items: {
      frisbee: ['Frisbee', '🥏'],
      skis: ['Skis', '🎿'],
      snowboard: ['Snowboard', '🏂'],
      'sports ball': ['Ball', '⚽'],
      'baseball bat': ['Bat', '🏏'],
      'baseball glove': ['Glove', '🧤'],
      skateboard: ['Skateboard', '🛹'],
      surfboard: ['Surfboard', '🏄'],
      'tennis racket': ['Racket', '🎾']
    }
  },
  gear: {
    color: '#bdb2ff',
    items: {
      backpack: ['Backpack', '🎒'],
      umbrella: ['Umbrella', '⛱️'],
      handbag: ['Handbag', '👜'],
      tie: ['Tie', '👔'],
      suitcase: ['Suitcase', '🧳']
    }
  },
  food: {
    color: '#ff9f1c',
    items: {
      bottle: ['Bottle', '🍾'],
      'wine glass': ['Wine glass', '🍷'],
      cup: ['Cup', '☕'],
      fork: ['Fork', '🍴'],
      knife: ['Knife', '🔪'],
      spoon: ['Spoon', '🥄'],
      bowl: ['Bowl', '🥣'],
      banana: ['Banana', '🍌'],
      apple: ['Apple', '🍎'],
      sandwich: ['Sandwich', '🥪'],
      orange: ['Orange', '🍊'],
      broccoli: ['Broccoli', '🥦'],
      carrot: ['Carrot', '🥕'],
      'hot dog': ['Hot dog', '🌭'],
      pizza: ['Pizza', '🍕'],
      donut: ['Donut', '🍩'],
      cake: ['Cake', '🍰']
    }
  },
  furniture: {
    color: '#9b8cff',
    items: {
      chair: ['Chair', '🪑'],
      couch: ['Couch', '🛋️'],
      'potted plant': ['Plant', '🪴'],
      bed: ['Bed', '🛏️'],
      'dining table': ['Table', '🍽️'],
      toilet: ['Toilet', '🚽']
    }
  },
  tech: {
    color: '#90a4ae',
    items: {
      tv: ['TV', '📺'],
      laptop: ['Laptop', '💻'],
      mouse: ['Mouse', '🖱️'],
      remote: ['Remote', '🎛️'],
      keyboard: ['Keyboard', '⌨️'],
      'cell phone': ['Phone', '📱'],
      microwave: ['Microwave', '📦'],
      oven: ['Oven', '🍳'],
      toaster: ['Toaster', '🍞'],
      sink: ['Sink', '🚰'],
      refrigerator: ['Fridge', '🧊']
    }
  },
  misc: {
    color: '#cbd5e1',
    items: {
      book: ['Book', '📚'],
      clock: ['Clock', '🕐'],
      vase: ['Vase', '🏺'],
      scissors: ['Scissors', '✂️'],
      'teddy bear': ['Teddy bear', '🧸'],
      'hair drier': ['Hair drier', '💨'],
      toothbrush: ['Toothbrush', '🪥']
    }
  }
};

// Build the flat CLASS_MAP from the categories.
export const CLASS_MAP = {};
for (const { color, items } of Object.values(CATEGORIES)) {
  for (const [cls, [label, emoji]] of Object.entries(items)) {
    CLASS_MAP[cls] = {
      label,
      emoji,
      color,
      kind: cls === 'sea lion' ? 'seal' : cls
    };
  }
}

// Everything is tracked; Scene filters below trim it down per situation.
export const TRACKED_CLASSES = new Set(Object.keys(CLASS_MAP));

// --- Vessel subtypes, derived from AIS ship-type codes ------------------
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

// Scene presets filter which raw classes are kept, to cut irrelevant noise.
export const SCENES = {
  all: { label: 'All', emoji: '🌎', classes: null },
  water: {
    label: 'Water',
    emoji: '🌊',
    classes: ['boat', 'bird', 'seal', 'sea lion', 'otter', 'surfboard', 'person']
  },
  sky: { label: 'Sky', emoji: '🛩️', classes: ['airplane', 'bird', 'kite'] },
  beach: {
    label: 'Beach',
    emoji: '🏖️',
    classes: ['person', 'dog', 'surfboard', 'umbrella', 'kite', 'bird', 'frisbee', 'sports ball', 'bicycle']
  },
  animals: {
    label: 'Animals',
    emoji: '🐾',
    classes: ['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'seal', 'sea lion', 'otter']
  },
  street: {
    label: 'Street',
    emoji: '🚗',
    classes: ['person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'train', 'traffic light', 'dog']
  }
};

export function sceneAllows(rawClass, scene) {
  const s = SCENES[scene] || SCENES.all;
  return !s.classes || s.classes.includes(rawClass);
}
