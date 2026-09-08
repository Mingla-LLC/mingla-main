import * as migration_20260830_122002_issue_2830_sites_foundation from './20260830_122002_issue_2830_sites_foundation';
import * as migration_20260830_125024_issue_2830_media_retention from './20260830_125024_issue_2830_media_retention';
import * as migration_20260908_152600_issue_2830_enum_values from './20260908_152600_issue_2830_enum_values';
import * as migration_20260908_152637_issue_2830_video_team_menu_blocks from './20260908_152637_issue_2830_video_team_menu_blocks';

export const migrations = [
  {
    up: migration_20260830_122002_issue_2830_sites_foundation.up,
    down: migration_20260830_122002_issue_2830_sites_foundation.down,
    name: '20260830_122002_issue_2830_sites_foundation',
  },
  {
    up: migration_20260830_125024_issue_2830_media_retention.up,
    down: migration_20260830_125024_issue_2830_media_retention.down,
    name: '20260830_125024_issue_2830_media_retention',
  },
  {
    up: migration_20260908_152600_issue_2830_enum_values.up,
    down: migration_20260908_152600_issue_2830_enum_values.down,
    name: '20260908_152600_issue_2830_enum_values',
  },
  {
    up: migration_20260908_152637_issue_2830_video_team_menu_blocks.up,
    down: migration_20260908_152637_issue_2830_video_team_menu_blocks.down,
    name: '20260908_152637_issue_2830_video_team_menu_blocks'
  },
];
