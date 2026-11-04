const { isDeepStrictEqual } = require('node:util');

// Calibrate against known source records, not the spelling of a version's keys.
// Several witnesses can distinguish fields whose values coincide in one record.
function resolveField(label, witnesses) {
    if (!Array.isArray(witnesses) || !witnesses.length)
        throw new Error(`Cannot resolve field ${label}: missing witnesses`);
    let candidates;
    for (const [index, witness] of witnesses.entries()) {
        const row = witness?.row;
        const hasValue = witness && Object.hasOwn(witness, 'value');
        const hasMatch = witness && Object.hasOwn(witness, 'match');
        if (!row || typeof row !== 'object' || Array.isArray(row) || hasValue === hasMatch ||
            (hasValue && witness.value === undefined) || (hasMatch && typeof witness.match !== 'function'))
            throw new Error(`Cannot resolve field ${label}: invalid witness ${index + 1}`);
        const matches = Object.keys(row).filter(key => hasMatch
            ? witness.match(row[key], key)
            : isDeepStrictEqual(row[key], witness.value));
        if (!matches.length)
            throw new Error(`Cannot resolve field ${label}: missing match in witness ${index + 1}`);
        candidates = candidates ? candidates.filter(key => matches.includes(key)) : matches;
    }
    if (candidates.length !== 1)
        throw new Error(`Cannot resolve field ${label}: ${candidates.length ? 'ambiguous' : 'inconsistent'} witnesses (${candidates.join(', ')})`);
    return candidates[0];
}

function resolveRow(rows, label, predicate) {
    if (!Array.isArray(rows) || typeof predicate !== 'function')
        throw new Error(`Cannot resolve row ${label}: invalid witnesses`);
    const matches = rows.filter(predicate);
    if (matches.length !== 1)
        throw new Error(`Cannot resolve row ${label}: ${matches.length ? 'ambiguous' : 'missing'} witness (${matches.length} matches)`);
    return matches[0];
}

module.exports = { resolveField, resolveRow };
