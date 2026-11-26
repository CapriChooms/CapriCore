// SPDX-License-Identifier: GPL-3.0-only
export const CREDITS_TEAM = Object.freeze([
  Object.freeze({ name: 'Overyx', role: 'Main developer', github: 'https://github.com/Overyx' }),
  Object.freeze({ name: 'Hastur-Dev', role: 'Developer', github: 'https://github.com/hastur-dev' }),
  Object.freeze({ name: 'v1rch', role: 'Discord developer' }),
  Object.freeze({ name: 'Leberrr', role: 'Discord moderator' }),
  Object.freeze({
    name: 'Frkn97',
    role: 'Linux port developer',
    github: 'https://github.com/Frkn97',
  }),
  Object.freeze({
    name: 'lattelix',
    role: 'macOS port developer',
    github: 'https://github.com/lattelix',
  }),
]);

export function creditProfile(id) {
  return CREDITS_TEAM.find(({ name }) => id === 'credits:' + name)?.github;
}
