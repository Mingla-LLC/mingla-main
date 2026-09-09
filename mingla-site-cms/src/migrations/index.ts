import * as migration_20260830_122002_issue_2830_sites_foundation from './20260830_122002_issue_2830_sites_foundation';
import * as migration_20260830_125024_issue_2830_media_retention from './20260830_125024_issue_2830_media_retention';
import * as migration_20260908_152600_issue_2830_enum_values from './20260908_152600_issue_2830_enum_values';
import * as migration_20260908_152637_issue_2830_video_team_menu_blocks from './20260908_152637_issue_2830_video_team_menu_blocks';

import * as migration_20260909_030000_issue_3149_block_eyebrow from './20260909_030000_issue_3149_block_eyebrow';
import * as migration_20260909_180000_issue_3149_wave3_blocks from './20260909_180000_issue_3149_wave3_blocks';
import * as migration_20260910_090000_issue_3149_reservations_role_enum from './20260910_090000_issue_3149_reservations_role_enum';
import * as migration_20260910_100000_issue_3149_wave4_blocks from './20260910_100000_issue_3149_wave4_blocks';
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
  {
    up: migration_20260909_030000_issue_3149_block_eyebrow.up,
    down: migration_20260909_030000_issue_3149_block_eyebrow.down,
    name: '20260909_030000_issue_3149_block_eyebrow',
  },
  {
    up: migration_20260909_180000_issue_3149_wave3_blocks.up,
    down: migration_20260909_180000_issue_3149_wave3_blocks.down,
    name: '20260909_180000_issue_3149_wave3_blocks',
  },
  /*
   * #3149 wave 4 — ORDER MATTERS BETWEEN THESE TWO. The enum values are added
   * on their own and committed first; Postgres refuses to use a new enum value
   * in the transaction that added it.
   */
  {
    up: migration_20260910_090000_issue_3149_reservations_role_enum.up,
    down: migration_20260910_090000_issue_3149_reservations_role_enum.down,
    name: '20260910_090000_issue_3149_reservations_role_enum',
  },
  {
    up: migration_20260910_100000_issue_3149_wave4_blocks.up,
    down: migration_20260910_100000_issue_3149_wave4_blocks.down,
    name: '20260910_100000_issue_3149_wave4_blocks',
  },
];
