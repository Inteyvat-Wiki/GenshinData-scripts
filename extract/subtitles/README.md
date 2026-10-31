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
