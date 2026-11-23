// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedicatedMusicContext,
  dedicatedMusicRequest,
  namedSpotifyPlay,
} from '../apps/desktop/computer-mode-request.mjs';
import { youtubeMusicRequest } from '../apps/desktop/youtube-music-request.mjs';

test('YouTube Music routes only scoped player requests and respects the selected service', () => {
  const state = {
    youtubeMusic: { enabled: true, preferred: true },
    spotify: { enabled: true, prepared: true },
  };
  for (const [text, command] of [
    ['Open YouTube Music', { action: 'open' }],
    ['Search YouTube Music for C418', { action: 'search', query: 'C418' }],
    ['Play "Fire and Rain" on YouTube Music.', { action: 'play', query: 'Fire and Rain' }],
    ['Open YouTube Music and play Believer', { action: 'play', query: 'Believer' }],
    ['Капри, включи Believer в YouTube Music.', { action: 'play', query: 'Believer' }],
    ['Pause YouTube Music', { action: 'pause' }],
    ['Resume on YT Music', { action: 'resume' }],
    ['Capri play the music via YouTube music.', { action: 'start' }],
    ['Play me some music on YouTube Music', { action: 'start' }],
    ['Can you play something on my YouTube music?', { action: 'start' }],
    ['play c four one eight drayton', { action: 'play', query: 'C418 Dreiton' }],
    ['Play C four one eight Drayton on Youtube Music', { action: 'play', query: 'C418 Dreiton' }],
    ['Play C418 Dreiton', { action: 'play', query: 'C418 Dreiton' }],
    [
      'Play Drayton by another artist on YouTube Music',
      { action: 'play', query: 'Drayton by another artist' },
    ],
    ['Start playing music on YouTube Music', { action: 'start' }],
    ['Включи мне любую музыку через YouTube Music', { action: 'start' }],
    ['Mets de la musique sur YouTube Music', { action: 'start' }],
    ['Pon algo de música en YouTube Music', { action: 'start' }],
    ['Toca alguma música no YouTube Music', { action: 'start' }],
    ['Spiele etwas Musik auf YouTube Music', { action: 'start' }],
    ['Play the song "Music" on YouTube Music', { action: 'play', query: 'Music' }],
    ['Play the next song', { action: 'next' }],
    ['Previous song on YouTube Music', { action: 'previous' }],
    ['Set YouTube Music volume to 35%', { action: 'volume', value: 35 }],
    ['Set the music volume to 100%', { action: 'volume', value: 100 }],
    ['Increse the volume a bit', { action: 'volume', delta: 10 }],
    ['Increase the volume a bit', { action: 'volume', delta: 10 }],
    ['Could you lower the music volume by 15%, please?', { action: 'volume', delta: -15 }],
    ['Увеличь громкость музыки на 20%', { action: 'volume', delta: 20 }],
    ['Поставь громкость музыки на 55%', { action: 'volume', value: 55 }],
    ['What’s playing on YouTube Music right now?', { action: 'status' }],
    ['Play some good music', { action: 'start' }],
  ]) {
    assert.deepEqual(youtubeMusicRequest(text, state)?.command, command, text);
  }
  for (const text of [
    'Play music on YouTube',
    'Pause Spotify',
    'Say "pause YouTube Music"',
    'Play chess',
    'Do not play music on YouTube Music',
    'Play Believer and set a timer on YouTube Music',
    'Use full computer control to open YouTube Music',
    'Can you explain YouTube Music?',
    'Set the music volume to 101%',
    'Increase the music volume by 101%',
    'Set the microphone volume to 100%',
    'Increase the volume on Spotify',
    'Increase the volume on Apple Music',
    'Say "increase the volume a bit"',
    'Do not increase the volume a bit',
    'Increase the volume a bit and set a timer',
  ]) {
    assert.ok(!youtubeMusicRequest(text, state)?.command, text);
  }
  assert.deepEqual(youtubeMusicRequest('Play Bohemian Rhapsody', state), {
    command: null,
    plan: true,
    playQuery: 'Bohemian Rhapsody',
  });
  assert.equal(youtubeMusicRequest('Play chess', state), null);
  assert.equal(youtubeMusicRequest('Play the video from yesterday', state), null);
  assert.equal(youtubeMusicRequest('Play C418 Dreiton and set a timer', state), null);
  state.youtubeMusic.preferred = false;
  assert.equal(youtubeMusicRequest('Play music', state), null);
  assert.equal(youtubeMusicRequest('Play Bohemian Rhapsody', state), null);
  assert.equal(youtubeMusicRequest('play c four one eight drayton', state), null);
  assert.equal(youtubeMusicRequest('Set the music volume to 100%', state), null);
  assert.equal(youtubeMusicRequest('Increse the volume a bit', state), null);
  assert.deepEqual(youtubeMusicRequest('Pause YouTube Music', state).command, { action: 'pause' });
  state.spotify.prepared = false;
  assert.deepEqual(youtubeMusicRequest('Pause', state).command, { action: 'pause' });
});

test('named Spotify playback preserves the owner query, never generated command syntax', () => {
  for (const text of [
    'Play Example Artist - Example Title on Spotify.',
    'Capri, could you please play Example Artist - Example Title?',
    'Капри, включи Example Artist - Example Title в Spotify, пожалуйста.',
    'Поставь в спотифай Example Artist - Example Title',
    'Play the track Example Artist - Example Title',
  ])
    assert.deepEqual(
      namedSpotifyPlay(text),
      { action: 'play', query: 'Example Artist - Example Title' },
      text,
    );
  for (const text of [
    'Do you like Example Artist - Example Title?',
    'Play chess',
    'Play music on Spotify',
    'Do not play Example Artist - Example Title on Spotify',
    'Say "play Example Artist - Example Title on Spotify"',
    'Play Example Artist - Example Title on Spotify and set a timer',
    'Play Example Artist - Example Title on Spotify; pause it',
    'Use full computer control to play Example Artist - Example Title on Spotify',
    'Play Example Artist - Example Title and then click the lyrics button',
    'Play is the title on Spotify',
    '**[spotify_control{action:<|"|>play<|"|>,query:<|"|>Example Artist - Example Title<|"|>}]**',
  ])
    assert.equal(namedSpotifyPlay(text), null, text);
});

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
    'Mets de la musique sur Spotify.',
    'Peux-tu jouer Believer sur Spotify ?',
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
    'Ne joue pas cette chanson sur Spotify.',
    'Mets de la musique et ouvre le navigateur sur Spotify.',
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
