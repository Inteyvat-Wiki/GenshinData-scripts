const fs = require('node:fs');
const path = require('node:path');
const { cachePaths, compareVersions } = require('./textmap');

const frames = [];
const dependencies = new WeakMap();
let versions, versionsFile;
let reducerDepth = 0;

function validHash(hash) {
    return (typeof hash === 'number' || typeof hash === 'string') &&
        /^\d+$/.test(String(hash)) && Number.isSafeInteger(Number(hash)) && Number(hash) > 0;
}

function attach(value, hashes) {
    if (!value || typeof value !== 'object' || !hashes.size) return;
    let set = dependencies.get(value);
    if (!set) dependencies.set(value, set = new Set());
    for (const hash of hashes) if (validHash(hash)) set.add(String(hash));
}

function observe(hash, value) {
    if (frames.length && typeof value === 'string' && validHash(hash)) {
        frames.at(-1).hashes.add(String(hash));
    }
}

function languageProxy(language) {
    return new Proxy(language, { get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        observe(key, value);
        return value;
    } });
}

function record(callback, accumulator) {
    const frame = { hashes: new Set(), touched: new Set() };
    frames.push(frame);
    const proxy = accumulator && typeof accumulator === 'object' ? new Proxy(accumulator, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (value && typeof value === 'object') frame.touched.add(value);
            return value;
        },
        set(target, key, value) {
            // Commit dependencies at each output insertion, isolating multiple
            // traveler variants produced by one reducer callback.
            if (value && typeof value === 'object') {
                attach(value, frame.hashes);
                frame.hashes.clear();
            }
            return Reflect.set(target, key, value);
        },
    }) : accumulator;
    try {
        const result = callback(proxy);
        if (result && typeof result === 'object' && result !== proxy && result !== accumulator) {
            attach(result, frame.hashes);
            frame.hashes.clear();
        }
        for (const value of frame.touched) attach(value, frame.hashes);
        if (frame.touched.size) frame.hashes.clear();
        return result === proxy ? accumulator : result;
    } finally {
        frames.pop();
        if (frames.length) for (const hash of frame.hashes) frames.at(-1).hashes.add(hash);
    }
}

function collectHashes(value, result = new Set(), seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return result;
    seen.add(value);
    for (const hash of dependencies.get(value) || []) result.add(hash);
    for (const child of Object.values(value)) collectHashes(child, result, seen);
    return result;
}

function collate(callback, lang) {
    const reduce = Array.prototype.reduce;
    // Scoped to this synchronous extraction; restore the built-in on failure.
    Array.prototype.reduce = function (fn, ...initial) {
        // Nested helper reductions remain inside their containing object's frame.
        if (reducerDepth) return reduce.call(this, fn, ...initial);
        return reduce.call(this, (accum, item, index, array) =>
            record(proxy => {
                reducerDepth++;
                try { return fn(proxy, item, index, array); }
                finally { reducerDepth--; }
            }, accum), ...initial);
    };
    const frame = { hashes: new Set(), touched: new Set() };
    frames.push(frame);
    try {
        const result = callback(lang);
        const values = Object.values(result);
        // Single aggregate folders, e.g. hyperlinks, do not use a reducer.
        if (values.length === 1) attach(values[0], frame.hashes);
        return result;
    } finally {
        frames.pop();
        Array.prototype.reduce = reduce;
    }
}

function objectVersion(value, index) {
    let earliest;
    for (const hash of collectHashes(value)) {
        const version = index[hash];
        if (!version) throw new Error(`TextMap version missing for used hash ${hash}`);
        if (!earliest || compareVersions(version, earliest) < 0) earliest = version;
    }
    // Objects backed only by non-TextMap data have no inferred version.
    return earliest || '';
}

function loadVersions(config) {
    const file = cachePaths(config).index;
    if (!versions || versionsFile !== file) {
        versions = JSON.parse(fs.readFileSync(file, 'utf8'));
        versionsFile = file;
    }
    return versions;
}

function accumulateVersions(target, data, config) {
    const index = loadVersions(config);
    for (const [filename, value] of Object.entries(data)) {
        const version = objectVersion(value, index);
        if (!(filename in target) || (version && (!target[filename] || compareVersions(version, target[filename]) < 0))) target[filename] = version;
    }
}

function writeVersions(folder, values, config, merge = false) {
    for (const root of [config.genshin_output_folder, config.genshin_export_folder]) {
        const directory = path.join(root, 'version');
        fs.mkdirSync(directory, { recursive: true });
        const file = path.join(directory, `${folder}.json`);
        let prior = {};
        if (merge) {
            try { prior = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
            for (const [key, version] of Object.entries(values)) {
                if (prior[key] && (!version || compareVersions(prior[key], version) < 0)) values = { ...values, [key]: prior[key] };
            }
        }
        // Secondary enrichers may export only a subset of a folder.
        const merged = Object.fromEntries(Object.entries({ ...prior, ...values }).sort(([a], [b]) => a.localeCompare(b)));
        fs.writeFileSync(file, JSON.stringify(merged, null, '\t'));
    }
}

module.exports = { attach, observe, languageProxy, record, collectHashes, collate, objectVersion, loadVersions, accumulateVersions, writeVersions };
