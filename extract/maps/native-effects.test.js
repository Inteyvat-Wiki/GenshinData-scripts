const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutCorners } = require('./native-effects');
const rect = (extra = {}) => ({ type: 'RectTransform', anchorMin: [.5,.5], anchorMax: [.5,.5], pivot: [.5,.5],
    size: [2048,2048], scale: [1,1,1], position: [0,0,0], rotation: [0,0,0,1], ...extra });
test('stretched light covers the native parent mask and preserves its scale/offset', () => {
    const root = rect({ scale: [.75,.75,.75], position: [50,-50,0] });
    const light = rect({ anchorMin:[0,0],anchorMax:[1,1],size:[0,0] });
    assert.deepEqual(layoutCorners(light,[root]), [[-718,-818,0],[818,-818,0],[818,718,0],[-718,718,0]]);
});
test('nested stretched fills resolve dimensions before native rotation', () => {
    const root=rect(), fills=rect({anchorMin:[0,0],anchorMax:[1,1],size:[0,0]});
    const south=rect({anchorMin:[0,0],anchorMax:[1,0],size:[0,1024],pivot:[.5,0],position:[0,-1024,0],rotation:[0,0,1,0]});
    assert.deepEqual(layoutCorners(south,[fills,root]), [[1024,-1024,0],[-1024,-1024,0],[-1024,-2048,0],[1024,-2048,0]]);
    assert.throws(()=>layoutCorners(fills,[]),/parent layout/);
});
