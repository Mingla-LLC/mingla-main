import * as migration_20260830_122002_issue_2830_sites_foundation from './20260830_122002_issue_2830_sites_foundation';
import * as migration_20260830_125024_issue_2830_media_retention from './20260830_125024_issue_2830_media_retention';

export const migrations = [
  {
    up: migration_20260830_122002_issue_2830_sites_foundation.up,
    down: migration_20260830_122002_issue_2830_sites_foundation.down,
    name: '20260830_122002_issue_2830_sites_foundation',
  },
  {
    up: migration_20260830_125024_issue_2830_media_retention.up,
    down: migration_20260830_125024_issue_2830_media_retention.down,
    name: '20260830_125024_issue_2830_media_retention'
  },
];
