# Attribution and licensing notes

## Upstream code

- Original project: [theBowja/GenshinData-scripts](https://github.com/theBowja/GenshinData-scripts).
- Original author: theBowja. This derivative is independently maintained by Inteyvat-Wiki; individual authorship is recorded in Git history.
- The upstream `package.json` declares `ISC`; the current derivative package points to the mixed scope in [LICENSE](LICENSE). The original declaration is preserved in the [provenance record](docs/license-provenance.md). As of 2026-10-31, no original standalone upstream license file or copyright notice has been located. The supplied ISC reference text does not close that gap. No replacement upstream copyright notice has been invented.
- This is not an official upstream release and does not promise upstream compatibility. Attribution does not imply endorsement.

## Adapted audio extractor

The upstream README identifies `voice/audio.js` as a partial JavaScript translation of Razmoth/Audio's extractor. The project is currently [RazTools/Audio](https://github.com/RazTools/Audio). Pre-port revision `56da8d491fadf713a9c95d5936c764e6f0a52129` supplies corresponding package and entry parsers and a MIT license with `Copyright (c) 2023 Razmoth`; the license is copied verbatim to [LICENSES/MIT-Razmoth-Audio.txt](LICENSES/MIT-Razmoth-Audio.txt). The exact revision originally consulted is not recorded; see [the comparison and evidence](docs/license-provenance.md). This is an adaptation, not an unchanged copy or code wholly authored by Inteyvat-Wiki.

## External tools and dependencies

AnimeStudio, AssetStudioCLI and separately installed libraries retain their own licenses. Resource tools reference an external AnimeStudio installation; its root MIT notice is retained in [LICENSES/MIT-AnimeStudio.txt](LICENSES/MIT-AnimeStudio.txt). This does not establish the license of every external DLL or redistribute those binaries. Before distributing binaries, bundles or copied source, inspect and include the applicable third-party notices. npm dependencies retain their own licenses; a lockfile is not a substitute for their license texts.

## Game content and external data

Genshin Impact / 原神 is a game by miHoYo / HoYoverse. Game text, images, audio, Lua, other assets, names and trademarks remain subject to their respective rights holders' rights. Extraction, caching or conversion does not transfer ownership or grant permission to redistribute that content. The software license declaration does not independently relicense game content in generated datasets or caches. External datasets and community-authored material retain their own applicable terms.

This is an unofficial community project, not affiliated with or endorsed by the game rights holders.

## Maintenance

Tracked `stats/data`, `stats/dist` and `voice/*.txt` include generated game-related values, bundles and resource paths; do not presume that the package-level declaration independently licenses their game content. Standalone stats distributions also need an appropriate code notice once the upstream license scope has been confirmed. Current build dependencies include caniuse-lite under CC-BY-4.0; review its attribution requirements if that database is redistributed, rather than assuming all build inputs are MIT code. Existing public source distribution needs the same provenance review as any future npm release.

Retain upstream notices and Git authorship. Record new copied or adapted components with their source, revision, affected paths and license; include the actual license text where required. Do not replace another author's copyright notice with the current maintainer's name.
