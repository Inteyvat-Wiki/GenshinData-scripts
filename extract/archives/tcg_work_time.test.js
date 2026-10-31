const { test } = require('node:test');
const assert = require('node:assert/strict');
const { work_time_text } = require('./tcg_work_time');
test('source work-time slots format hours and fractional hours, preserving other tokens', () => {
    assert.equal(work_time_text('Time {0}-{1} {NICKNAME}', { startTime: 6, endTime: 19 }), 'Time 06:00-19:00 {NICKNAME}');
    assert.equal(work_time_text('{0}-{1}', { startTime: 6.5, endTime: 24 }), '06:30-24:00');
    assert.equal(work_time_text('Original', { startTime: 6, endTime: 19 }), 'Original');
    assert.equal(work_time_text('{0}', undefined), '{0}');
    assert.throws(() => work_time_text('{0}-{1}', { startTime: -1, endTime: 19 }), /Invalid/);
    assert.throws(() => work_time_text('{0}', { startTime: 6, endTime: 19 }), /end time slot/);
});
