// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';

test(
  'native Spotify search accepts a localized input and requires a matching typed route',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const parent = path.join(root, '.runtime/test-data');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'spotify-search-'));
    const fixture = path.join(folder, 'SearchFixture.cs');
    writeFileSync(
      fixture,
      `
using System;
using Capri.Spotify;
public static class SearchFixture {
  public static void Check() {
    if (SpotifySearch.InputEligible(true,false,false,true,true,false,"O que você quer ouvir?")) throw new Exception("Disabled clone");
    if (!SpotifySearch.InputEligible(true,true,false,true,true,false,"O que você quer ouvir?")) throw new Exception("Brazilian search label");
    if (!SpotifySearch.InputEligible(true,true,false,true,true,true,"ค้นหา")) throw new Exception("Semantic search landmark");
    if (SpotifySearch.InputEligible(true,true,false,true,true,false,"Search your library")) throw new Exception("Unrelated field");
    if (SpotifySearch.InputEligible(true,true,true,true,true,true,"")) throw new Exception("Offscreen field");
    if (SpotifySearch.InputEligible(true,true,false,true,false,true,"")) throw new Exception("Read-only field");
    const string route="https://xpui.app.spotify.com/search/Can%C3%A7%C3%A3o%20%2B/tracks";
    if (!SpotifySearch.FilterMatches(route,"Canção +","track")) throw new Exception("Spotify route or Unicode query");
    if (SpotifySearch.FilterMatches(route,"Canção  ","track") || SpotifySearch.FilterMatches(route,"Canção +","album")) throw new Exception("Mismatched route");
    if (SpotifySearch.FilterMatches("https://example.org/search/rock/tracks","rock","track")) throw new Exception("Foreign route");
    if (SpotifySearch.FilterMatches("https://open.spotify.com/collection/rock/tracks","rock","track")) throw new Exception("Not a search route");
    if (!SpotifySearch.SongResultsName("Todas as músicas para “Canção”","Canção")) throw new Exception("Brazilian song grid");
    if (!SpotifySearch.MusicButton("Tocar Canção de Artista")) throw new Exception("Brazilian playback label");
    string title,artist;
    if (!SpotifySearch.TrackIdentity(SpotifySearch.PlayLabel("Pausar Canção de Artista"),out title,out artist) ||
        title!="Canção" || artist!="Artista") throw new Exception("Brazilian track identity");
    if (!SpotifySearch.TrackIdentity(SpotifySearch.PlayLabel("Поставить на паузу то, что сейчас играет: «Песня» (Группа)"),out title,out artist) ||
        title!="Песня" || artist!="Группа") throw new Exception("Russian track identity");
  }
}
`,
    );
    const runner = path.join(folder, 'run.ps1');
    const literal = (name) => "'" + name.replaceAll("'", "''") + "'";
    writeFileSync(
      runner,
      `$ErrorActionPreference='Stop'\nAdd-Type -Path ${literal(path.join(root, 'integrations/spotify/native/SpotifySearch.cs'))},${literal(fixture)}\n[SearchFixture]::Check()\n`,
    );
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  },
);
