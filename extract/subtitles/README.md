# Task narration and speech-bubble extraction

`lua.js` statically inspects the game's bytecode; it never runs game Lua. The
verified callback/API rules, task attachment recovery and source text resolution
live in this directory, not in the Wiki generator.

Configure `Lua_folder` in the extraction repository's `config.json`, set
`GENSHIN_LUA_PATH`, or place bytecode in the default `.cache/lua` directory.
Inputs remain ignored. Do not commit bytecode. `GenshinData_folder` selects the
matching Excel/Bin/TextMap revision. Missing or empty Lua input fails the explicit
export command; the ordinary main export preserves existing subtitle output when
the Lua directory is absent and prints a warning.

Resource acquisition is separate: `@inteyvat-wiki/resource-tools` provides
`extractLuaResources` / `resource-tools extract-lua` for exact block/Offset/Type/
PathID plans. It preserves bytes, requires the Lua signature, groups reads by
source block and emits numbered files plus provenance. Game script identity,
bytecode interpretation and subtitle attachment remain in this repository.
The resource package's `docs/pipeline.md` covers the full flow.

Real positive samples, non-Lua rejection and wrong-Offset rejection have been
verified. Do not point the production provider at a sample output directory:
first verify complete input coverage and run subtitle regressions against the
existing dataset. The new resource API has not replaced production Lua input.

```text
npm run export:subtitles
npm run test:subtitles
cd ../genshin-db
npm run makeIndex -- --folders tasksubtitles --languages ChineseSimplified English
```

The `tasksubtitles` dataset is keyed by the original main quest ID. Its `step`
fields and the step segment of event keys retain original subquest IDs. Conditions,
delay uncertainty, callback provenance, text-source paths, bubble attachment NPC,
the distinct source dialog speaker, lifecycle actions and alternate-path identity
are preserved. Unresolved/missing/conflicting input remains diagnosed rather than
being guessed. Each record participates in normal TextMap version tracking.

Consumers query `genshindb.tasksubtitles(...)` and map source step IDs into their
own page ordering. Key and `after` references must be remapped together. This
keeps the source data independent of Wiki-local step indices.
