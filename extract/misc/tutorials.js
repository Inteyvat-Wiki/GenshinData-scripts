// Snapshot exceptions: no CHS/EN prose or title and no current image resources.
// Keep the source records/edges, but do not advertise empty pages as usable tutorials.
const unavailable = new Map([
    [1171, [117101, 117102]], [1172, [117201, 117202, 1172003]],
    [1183, [118301]], [1344, [134401]], [1345, [134501]], [1346, [134601]], [2623, [262301]],
]);
module.exports = function tutorialMetadata(input) {
    const pushes = input.excel('PushTipsConfigData');
    const byPush = new Map(pushes.map(row => [row.pushTipsId, row]));
    const activityPushes = input.excel('NewActivityPushTipsConfigData');
    const byActivityPush = new Map(activityPushes.map(row => [row.pushTipsId, row]));
    const activities = new Set(activityPushes.map(row => row.tutorialId).filter(Boolean));
    for (const row of input.excel('NewActivityPreviewConfigData')) {
        const push = byPush.get(row.pushTipsID);
        if (push?.tutorialId) activities.add(push.tutorialId);
    }
    // Known gameplay tables: these fields reference push IDs, not tutorial IDs.
    const activityFields = {
        SlimeCannonExcelConfigData: ['pushtipsId'], SlimeCannonLevelExcelConfigData: ['pushtipsId'],
        SlimeCannonPushtipsExcelConfigData: ['pushtipsId'], ActivityBirdPinBallLevelExcelConfigData: ['pushTipsId'],
        ActivityBirdPinballOverallExcelConfigData: ['pushTipsId'], MonsterChessPushTipsExcelConfigData: ['pushTipsId'],
        MonsterChessV2PushTipsExcelConfigData: ['pushTipsId'], ActivityCookGameOverallExcelConfigData: ['pushTipsId'],
        ActivityHideAndSeekBasicConfigData: ['pushTipsID'], ActivityHideAndSeekV4BasicConfigData: ['pushTipsID'],
        ActivityWatergunLevelExcelConfigData: ['pushTipsId'], FungusBaseExcelConfigData: ['captureTutorialId', 'educationTutorialId', 'plotDungeonTutorialId', 'attackDungeonTutorialId', 'defendDungeonTutorialId', 'fungusBackupTutorialId'],
        FungusCultivateExcelConfigData: ['tutorialId'], ActivityVintageHuntingExcelConfigData: ['tutorialId', 'overallTutorialId'],
        ActivityVintageMarketStageExcelConfigData: ['tutorialID', 'overallTutorialID'],
        WinterCampExcelConfigData: ['battleTutorialId', 'exploreTutorialId', 'raceTutorialId', 'snowmanTutorialId'],
    };
    for (const [table, fields] of Object.entries(activityFields)) for (const row of input.excel(table)) for (const field of fields) {
        if (!row[field]) continue;
        const push = byPush.get(row[field]) || byActivityPush.get(row[field]);
        if (!push) throw new Error(`Missing activity tutorial push: ${table}.${field}:${row[field]}`);
        if (push.tutorialId) activities.add(push.tutorialId);
    }
    const categories = new Map();
    for (const row of input.excel('PushTipsCodexExcelConfigData')) {
        if (row.isDisuse) continue;
        const push = byPush.get(row.pushTipId);
        if (!push?.tutorialId || !push.codexType || ['CODEX_UNRECORDED', 'CODEX_ARANARA'].includes(push.codexType)) continue;
        if (categories.has(push.tutorialId) && categories.get(push.tutorialId) !== push.codexType) throw new Error(`Conflicting tutorial categories: ${push.tutorialId}`);
        categories.set(push.tutorialId, push.codexType);
    }
    return { activityPushes, category: id => categories.get(id) || (activities.has(id) ? 'TUTORIAL_ACTIVITY' : 'TUTORIAL_OTHER'),
        unavailable: row => {
            if (!unavailable.has(row.id)) return false;
            if (JSON.stringify(row.detailIdList) !== JSON.stringify(unavailable.get(row.id))) throw new Error(`Recheck unavailable tutorial: ${row.id}`);
            return true;
        },
    };
};
