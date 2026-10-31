const assert = require('node:assert/strict');

function clock(value) {
    assert(Number.isFinite(value) && value >= 0 && value <= 24 && Number.isInteger(value * 60), 'Invalid GCG work time');
    const minutes = value * 60;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function work_time_text(description, row) {
    if (!row || !/\{[01]\}/.test(description)) return description;
    assert.equal((description.match(/\{0\}/g) || []).length, 1, 'Unexpected GCG start time slot');
    assert.equal((description.match(/\{1\}/g) || []).length, 1, 'Unexpected GCG end time slot');
    return description.replace('{0}', clock(row.startTime ?? 0)).replace('{1}', clock(row.endTime ?? 0));
}

module.exports = { work_time_text };
