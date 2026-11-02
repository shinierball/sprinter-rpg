/**
 * Achievements tab context: tier tallies, boss stars and crawler skulls.
 */

const TIER_KEYS = ['bronze', 'silver', 'gold', 'platinum', 'legendary', 'celestial', 'quest', 'secret', 'special'];

/** Boss star tiers in display order (the trophy counters on the Achievements tab). */
export const TROPHY_TIERS = Object.freeze([
  { id: 'bronze', label: 'Bronze Star', bossLevel: 'Neighborhood Boss', color: '#cd7f32', class: 'star-bronze' },
  { id: 'silver', label: 'Silver Star', bossLevel: 'Borough Boss', color: '#dcdde1', class: 'star-silver' },
  { id: 'gold', label: 'Gold Star', bossLevel: 'City Boss', color: '#f1c40f', class: 'star-gold' },
  { id: 'platinum', label: 'Platinum Star', bossLevel: 'Province Boss', color: '#00d2d3', class: 'star-platinum' },
  { id: 'legendary', label: 'Legendary Star', bossLevel: 'Country Boss', color: '#e67e22', class: 'star-legendary' },
  { id: 'celestial', label: 'Celestial Star', bossLevel: 'Floor / Dungeon Boss', color: '#9b59b6', class: 'star-celestial' }
]);

/**
 * Requires `prepareItemLists` (for `context.achievements`).
 * @param {object} context
 * @param {Actor} actor
 * @param {{ query?: string, tier?: string }} [filter] the sheet's current achievement filter
 */
export function prepareAchievements(context, actor, filter = {}) {
  const byTier = Object.fromEntries(TIER_KEYS.map(k => [k, 0]));
  let totalFavor = 0;
  let totalXP = 0;
  for (const ach of context.achievements) {
    const tier = (ach.system?.tier || 'bronze').toLowerCase();
    if (byTier[tier] !== undefined) byTier[tier]++;
    else byTier.special++;
    totalFavor += Number(ach.system?.favor) || 0;
    totalXP += Number(ach.system?.xp) || 0;
  }
  context.achievementStats = { total: context.achievements.length, byTier, totalFavor, totalXP };
  context.achievementFilter = { query: filter.query ?? '', tier: filter.tier ?? 'all' };
  context.achievementTierOptions = [['all', 'All Tiers'], ...TIER_KEYS.map(k => [k, k.charAt(0).toUpperCase() + k.slice(1)])]
    .map(([value, label]) => ({ value, label, selected: value === context.achievementFilter.tier }));

  context.trophyBadges = actor.getBadgeSummary();
  const trophies = actor.system?.trophies || {};
  context.trophyTiers = TROPHY_TIERS.map(t => ({ ...t, count: trophies.bosses?.[t.id] || 0 }));
  context.crawlerKillCount = trophies.crawlers?.count || 0;
  context.bossLog = Array.isArray(trophies.bossLog) ? trophies.bossLog : [];
  context.crawlerLog = Array.isArray(trophies.crawlerLog) ? trophies.crawlerLog : [];
}
