const { exportData } = require('./extract/global');
exportData('tasksubtitles', require('./extract/extractTaskSubtitles'), false, false, ['CHS', 'EN']);
