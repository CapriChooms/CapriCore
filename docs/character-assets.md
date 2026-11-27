# Character assets

Capri uses reviewed artwork registered by the runtime manifests. The sprite
catalog lists the selectable expressions and timed clips. Desktop poses, music
poses and the startup intro have separate manifests.

| Artwork                                    | Runtime reference                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Sprites, expressions and clips             | [Sprite catalog](../assets/capri/sprites/v1/runtime-sprite-set.json)        |
| Seated, sleeping and window-edge poses     | [Desktop pose catalog](../assets/capri/sprites/poses-v2/runtime-poses.json) |
| Music poses and notes                      | [Music artwork](../assets/default/capri-music-v1/runtime-music.json)        |
| Startup sequence                           | [Intro manifest](../assets/capri/intro-v1/runtime-intro.json)               |
| Registered frames for window-edge gestures | [Gesture sheets and geometry](../assets/default/hanging-cels/geometry.json) |
| Fallback avatar                            | [Fallback catalog](../assets/default/sprite-set.json)                       |

Capri 1.3.0 adds separate face and gesture atlases and an **Avatar gallery** in
Settings for previewing poses, expressions and animations. The face plates
animate eyes, eyelids and the speech mouth over the current pose. Some authored
poses use their own face artwork. [Pose face atlas](https://github.com/CapriChooms/CapriCore/blob/v1.3.0/assets/default/capri-face-poses.json)
· [Gesture face atlas](https://github.com/CapriChooms/CapriCore/blob/v1.3.0/assets/default/capri-face-gestures.json)
· [Animation and registration guide](ANIMATION-V2.md)

The artwork is required in source and Setup packages for every voice,
recognition and model selection. Release validation and the installer check the
required catalog and its referenced files. If required artwork is missing or
damaged, Capri shows a repair warning and keeps text chat available with its
fallback avatar. On Windows, run Setup again and select the existing
installation folder to restore the bundled artwork and preserve history, memory
and settings. Diagnostic reports can include the catalog and missing-file
details in `avatar.json`. [Installation wizard](installation-wizard.md)
· [Diagnostic reports](diagnostic-reports.md)

Community artwork includes the transparent WebP wave and registered pull-up,
chip catch, wrist scanner, keytar and window interaction sequences. Capri can
wave on waking or when asked. Window-edge performances use their matching
detached poses. Performances near a search field depend on the screen-observation
grant for the field's location. [Screen observation](screen-observation.md)

## Asset terms

Capri is an unofficial fan character representation associated with Cyberpunk.
The GPL-3.0 license applies to the application's original code. Third-party
character designs, supplied artwork, trademarks and source media have separate
rights, including the supplied app icon. Anyone redistributing or commercializing
character or voice assets must establish the necessary permissions separately
and preserve accurate provenance. [Licensing](licensing.md)
· [Third-party notices](../THIRD_PARTY_NOTICES.md)
