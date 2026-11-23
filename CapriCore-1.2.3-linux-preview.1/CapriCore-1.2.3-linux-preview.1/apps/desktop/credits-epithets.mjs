// SPDX-License-Identifier: GPL-3.0-only
// Public English callsigns are saved identities, shared by the browser and the
// maintainer importer. Never derive a new one from a login or on each rendering.
export const EPITHET_ADJECTIVES = Object.freeze([
  'Neon',
  'Quantum',
  'Cosmic',
  'Stellar',
  'Prismatic',
  'Luminous',
  'Radiant',
  'Solar',
  'Lunar',
  'Astral',
  'Orbital',
  'Galactic',
  'Celestial',
  'Electric',
  'Digital',
  'Chromatic',
  'Iridescent',
  'Holographic',
  'Chromed',
  'Copper',
  'Silver',
  'Golden',
  'Amber',
  'Azure',
  'Cobalt',
  'Emerald',
  'Jade',
  'Violet',
  'Indigo',
  'Cerulean',
  'Crimson',
  'Cyan',
  'Magenta',
  'Opaline',
  'Pearlescent',
  'Platinum',
  'Crystalline',
  'Obsidian',
  'Onyx',
  'Velvet',
  'Silken',
  'Gleaming',
  'Glowing',
  'Shimmering',
  'Sparkling',
  'Brilliant',
  'Vivid',
  'Lucid',
  'Serene',
  'Steady',
  'Agile',
  'Nimble',
  'Curious',
  'Dauntless',
  'Intrepid',
  'Adventurous',
  'Boundless',
  'Infinite',
  'Eternal',
  'Distant',
  'Drifting',
  'Roaming',
  'Soaring',
  'Sailing',
  'Wandering',
  'Wondrous',
  'Dreaming',
  'Awake',
  'Quiet',
  'Gentle',
  'Merry',
  'Joyful',
  'Sunny',
  'Twilight',
  'Midnight',
  'Morning',
  'Dawnlit',
  'Starlit',
  'Moonlit',
  'Sunlit',
]);

export const EPITHET_NOUNS = Object.freeze([
  'Voyager',
  'Explorer',
  'Wanderer',
  'Wayfarer',
  'Trailblazer',
  'Pathfinder',
  'Navigator',
  'Cartographer',
  'Dreamer',
  'Storyteller',
  'Stargazer',
  'Seeker',
  'Nomad',
  'Rover',
  'Traveler',
  'Trekker',
  'Glider',
  'Artisan',
  'Maker',
  'Weaver',
  'Builder',
  'Tinkerer',
  'Gardener',
  'Archivist',
  'Scribe',
  'Chronicler',
  'Muse',
  'Comet',
  'Nova',
  'Aurora',
  'Nebula',
  'Quasar',
  'Pulsar',
  'Photon',
  'Prism',
  'Beacon',
  'Circuit',
  'Signal',
  'Vector',
  'Pixel',
  'Cipher',
  'Echo',
  'Orbit',
  'Horizon',
  'Zenith',
  'Meridian',
  'Solstice',
  'Equinox',
  'Constellation',
  'Galaxy',
  'Cosmos',
  'Meteor',
  'Asteroid',
  'Satellite',
  'Star',
  'Moon',
  'Sunbeam',
  'Starlight',
  'Moonbeam',
  'Sunrise',
  'Daybreak',
  'Skylark',
  'Firefly',
  'Spark',
  'Lantern',
  'Compass',
  'Astrolabe',
  'Telescope',
  'Kite',
  'Sundial',
  'Oasis',
  'Harbor',
  'Vista',
  'Tide',
  'Ripple',
  'Stream',
  'Cascade',
  'Cloud',
  'Breeze',
  'Zephyr',
]);

export const EPITHET_CAPACITY = EPITHET_ADJECTIVES.length * EPITHET_NOUNS.length;
const adjectiveIndexes = new Map(EPITHET_ADJECTIVES.map((word, index) => [word, index]));
const nounIndexes = new Map(EPITHET_NOUNS.map((word, index) => [word, index]));
const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** Curated acknowledgements are display names, independent of GitHub logins. */
export function normalizeCreditNames(value = []) {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error('Invalid Hall of Fame acknowledgements.');
  const seen = new Set();
  return value.map((name) => {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80 ||
      /[\x00-\x1f\x7f]/u.test(name) ||
      seen.has(name.trim().toLowerCase())
    )
      throw new Error('Invalid Hall of Fame display name.');
    name = name.trim();
    seen.add(name.toLowerCase());
    return name;
  });
}

export function validateEpithet(value) {
  if (typeof value !== 'string') return false;
  const words = value.split(' ');
  return words.length === 2 && adjectiveIndexes.has(words[0]) && nounIndexes.has(words[1]);
}

function secureRandomIndex(maximum) {
  if (typeof globalThis.crypto?.getRandomValues !== 'function')
    throw new Error('Secure randomness is required to assign a new Hall of Fame callsign.');
  // Rejection sampling avoids modulo bias. The fixed bound also handles an
  // unavailable or broken random source without an unbounded retry loop.
  const range = 0x1_0000_0000;
  const limit = range - (range % maximum);
  const sample = new Uint32Array(1);
  for (let attempt = 0; attempt < 64; attempt++) {
    globalThis.crypto.getRandomValues(sample);
    if (sample[0] < limit) return sample[0] % maximum;
  }
  throw new Error('Secure randomness could not assign a Hall of Fame callsign.');
}

export function assignEpithets(
  names,
  previous = {},
  randomIndex = secureRandomIndex,
  displayNames = [],
) {
  if (!Array.isArray(names)) throw new Error('Expected a list of public usernames.');
  if (typeof randomIndex !== 'function') throw new Error('Invalid callsign random source.');
  const curatedNames = new Set(
    normalizeCreditNames(displayNames).map((name) => name.toLowerCase()),
  );
  const validIdentity = (name) => loginPattern.test(name) || curatedNames.has(name.toLowerCase());
  const identities = new Set();
  for (const name of names) {
    if (typeof name !== 'string' || !validIdentity(name))
      throw new Error('Invalid public username for Hall of Fame callsigns.');
    identities.add(name.toLowerCase());
    if (identities.size > EPITHET_CAPACITY)
      throw new Error('Hall of Fame callsign combinations are exhausted.');
  }
  if (
    previous === null ||
    typeof previous !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(previous)) ||
    Object.getOwnPropertySymbols(previous).length
  )
    throw new Error('Invalid saved Hall of Fame callsign mapping.');

  const assigned = Object.create(null);
  const used = new Set();
  for (const key of Object.getOwnPropertyNames(previous)) {
    const entry = Object.getOwnPropertyDescriptor(previous, key);
    if (
      !validIdentity(key) ||
      key !== key.toLowerCase() ||
      !identities.has(key) ||
      !entry.enumerable ||
      !Object.hasOwn(entry, 'value') ||
      !validateEpithet(entry.value)
    )
      throw new Error('Invalid saved Hall of Fame callsign entry.');
    const [adjective, noun] = entry.value.split(' ');
    const combination =
      adjectiveIndexes.get(adjective) * EPITHET_NOUNS.length + nounIndexes.get(noun);
    if (used.has(combination)) throw new Error('Duplicate saved Hall of Fame callsign.');
    used.add(combination);
    assigned[key] = entry.value;
  }

  // Draw uniformly from unused combinations without retries. Even a random
  // source that always returns zero finishes in one draw per new identity.
  const available = [];
  for (let index = 0; index < EPITHET_CAPACITY; index++) {
    if (!used.has(index)) available.push(index);
  }
  for (const key of identities) {
    if (Object.hasOwn(assigned, key)) continue;
    const selected = randomIndex(available.length);
    if (!Number.isSafeInteger(selected) || selected < 0 || selected >= available.length)
      throw new Error('Invalid callsign random selection.');
    const combination = available[selected];
    available[selected] = available.at(-1);
    available.pop();
    assigned[key] =
      `${EPITHET_ADJECTIVES[Math.floor(combination / EPITHET_NOUNS.length)]} ${EPITHET_NOUNS[combination % EPITHET_NOUNS.length]}`;
  }
  return assigned;
}
