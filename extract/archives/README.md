# Research catalogue extraction

These CommonJS modules own source-table selection, obfuscated-field calibration,
TextMap resolution, source relationships and exact 64-bit resource references for
`serenitea`, `tcg` and `miliastra`. They do not import genshin-db or Wiki code.

Run from the extraction repository:

```text
npm run export:archives
npm run export:archives -- serenitea
npm run test:archives
```

The ordinary `main.js` export also includes these folders. Both paths use the
standard `exportData` writer and version tracking, currently for CHS and EN.
The configured `genshin_output_folder` receives the per-record genshin-db JSON;
`genshin_export_folder` receives aggregate files. Build the database indices next:

```text
cd ../genshin-db
npm run makeIndex -- --folders serenitea tcg miliastra --languages ChineseSimplified English
```

IDs are source-qualified (`companion-9002`, `card-1101`, `suit-265348`), not
translated filenames. `order` preserves the source catalogue order even though
the database index sorts filenames. Missing translations remain empty.

Images contain resource names/kinds only. External relations carry explicit
source IDs; they do not assume that a Wiki page exists. `source_dialogue` retains
the original dialog IDs, menu prompt, perform path and raw condition parameters.
The Wiki converts these using its shared dialogue engine, resolves actual page
links and matches its already-extracted PNGs. No game Lua is executed here.

Raw-source assertions live alongside these modules. Wiki-side checks must query
genshin-db and must not read source tables or this repository's configuration.
