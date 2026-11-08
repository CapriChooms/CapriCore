// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedicatedMusicContext,
  dedicatedMusicRequest,
} from '../apps/desktop/computer-mode-request.mjs';

test('a music topic can block implicit desktop escalation without claiming an execution request', () => {
  for (const text of [
    'Do you like this music?',
    'Тебе нравится громкая музыка?',
    'Reproduce esta canción en Spotify.',
    'Spotifyのこの曲は好き？',
    'Do not play music.',
  ]) {
    assert.equal(dedicatedMusicContext(text), true, text);
    assert.equal(dedicatedMusicRequest(text), false, text);
  }
  for (const text of [
    'Hello Capri.',
    'Use full computer control to play Spotify.',
    'Click the Spotify play button with the mouse.',
    'Play Spotify, then open Notepad and type a note.',
    'Play music and set a timer.',
    'Используй полное управление компьютером и включи музыку.',
  ])
    assert.equal(dedicatedMusicContext(text), false, text);
});

test('only positive playback, volume and current-player queries select the dedicated music path', () => {
  for (const text of [
    'Can you open my Spotify and turn on some music like Example Artist?',
    'Capri, could you please play the next song?',
    'Play music on Spotify.',
    'Pause Spotify.',
    'Resume',
    'Next song.',
    'Search Spotify for ambient music.',
    'Find a playlist in Spotify.',
    'Turn the music down.',
    'Set the volume to 25%.',
    'Make it quieter.',
    'A little louder, please.',
    'Check Spotify volume.',
    'Show the current volume.',
    'What song is playing?',
    "What's playing in Spotify right now?",
    'Открой Spotify и включи музыку Example Artist.',
    'Капри, поставь песню в спотифай.',
    'Можешь включить музыку?',
    'Сделай музыку потише.',
    'Чуть погромче, пожалуйста.',
    'Проверь громкость Spotify.',
    'Что сейчас играет?',
    'Какая песня играет в Spotify?',
  ])
    assert.equal(dedicatedMusicRequest(text), true, text);
});

test('music discussion, titles, prohibitions, unrelated meanings and unknown-language wording are not playback requests', () => {
  for (const text of [
    'Do you like this music?',
    'Do you like to play music?',
    'My favorite song is Next to Me.',
    'Start a conversation about this song.',
    'Find the meaning of this song.',
    'Repeat the song title.',
    'Play is the title of my favorite song.',
    'I prefer quieter songs.',
    'Do not play music.',
    "Don't pause Spotify.",
    'Could you please not turn on music?',
    'Please never play this song.',
    'Say "play music".',
    '"Play music"',
    'Explain the volume of a sphere.',
    'Increase the volume of a sphere.',
    'I track my exercise.',
    'What song is playing in this movie?',
    'Тебе нравится эта музыка?',
    'Тебе нравится громкая музыка?',
    'Какая у тебя любимая песня?',
    'Не включай музыку.',
    '¿Te gusta esta música de Spotify?',
    'Tu aimes cette chanson sur Spotify ?',
    'Gefällt dir dieses Lied auf Spotify?',
    'Spotifyのこの曲は好き？',
    'هل تعجبك هذه الأغنية على Spotify؟',
    'Reproduce esta canción en Spotify.',
  ])
    assert.equal(dedicatedMusicRequest(text), false, text);
});

test('GUI and mixed-app goals retain their general path and explicit computer mode has priority', () => {
  for (const text of [
    'Use full computer control to play music in Spotify.',
    'Click the Spotify play button with the mouse.',
    'Play Spotify, then open Notepad and type a note.',
    'Play music and set a timer.',
    'Используй полное управление компьютером и включи музыку.',
  ])
    assert.equal(dedicatedMusicRequest(text), false, text);
});
