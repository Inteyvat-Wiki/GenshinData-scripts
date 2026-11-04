require('./global.js');
const { createReadableReader } = require('./readable');

const xlocalization = getExcel('LocalizationExcelConfigData');
const getReadableData = createReadableReader(getExcel('DocumentExcelConfigData'), xlocalization, getReadable);

module.exports = { getReadableData };
