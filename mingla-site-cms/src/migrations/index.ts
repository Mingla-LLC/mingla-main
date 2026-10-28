import * as migration_20260830_122002_issue_2830_sites_foundation from './20260830_122002_issue_2830_sites_foundation';
import * as migration_20260830_125024_issue_2830_media_retention from './20260830_125024_issue_2830_media_retention';
import * as migration_20260908_152600_issue_2830_enum_values from './20260908_152600_issue_2830_enum_values';
import * as migration_20260908_152637_issue_2830_video_team_menu_blocks from './20260908_152637_issue_2830_video_team_menu_blocks';
import * as migration_20260909_030000_issue_3149_block_eyebrow from './20260909_030000_issue_3149_block_eyebrow';
import * as migration_20260909_180000_issue_3149_wave3_blocks from './20260909_180000_issue_3149_wave3_blocks';
import * as migration_20260910_090000_issue_3149_reservations_role_enum from './20260910_090000_issue_3149_reservations_role_enum';
import * as migration_20260910_100000_issue_3149_wave4_blocks from './20260910_100000_issue_3149_wave4_blocks';
import * as migration_20261012_012655_issue_2830_cloud_storage_object_key from './20261012_012655_issue_2830_cloud_storage_object_key';
import * as migration_20261025_100000_issue_2829_multi_tenant_defaults from './20261025_100000_issue_2829_multi_tenant_defaults';
import * as migration_20261025_110000_issue_2829_page_tree from './20261025_110000_issue_2829_page_tree';
import * as migration_20261025_120000_issue_2829_design_system_blocks from './20261025_120000_issue_2829_design_system_blocks';
import * as migration_20261025_130000_issue_2829_live_offering_grids from './20261025_130000_issue_2829_live_offering_grids';
import * as migration_20261025_140000_issue_2829_content_collections from './20261025_140000_issue_2829_content_collections';
import * as migration_20261025_150000_issue_2829_video_media from './20261025_150000_issue_2829_video_media';
import * as migration_20261025_160000_issue_2829_voyage_design from './20261025_160000_issue_2829_voyage_design';
import * as migration_20261025_170000_issue_2829_w7b_history_only_and_form_hints from './20261025_170000_issue_2829_w7b_history_only_and_form_hints';
import * as migration_20261025_180000_issue_2829_w9r_content_order from './20261025_180000_issue_2829_w9r_content_order';
import * as migration_20261025_190000_issue_2829_w9b_work_log from './20261025_190000_issue_2829_w9b_work_log';

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
    name: '20260908_152637_issue_2830_video_team_menu_blocks',
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
  {
    up: migration_20261012_012655_issue_2830_cloud_storage_object_key.up,
    down: migration_20261012_012655_issue_2830_cloud_storage_object_key.down,
    name: '20261012_012655_issue_2830_cloud_storage_object_key',
  },
  {
    up: migration_20261025_100000_issue_2829_multi_tenant_defaults.up,
    down: migration_20261025_100000_issue_2829_multi_tenant_defaults.down,
    name: '20261025_100000_issue_2829_multi_tenant_defaults',
  },
  {
    up: migration_20261025_110000_issue_2829_page_tree.up,
    down: migration_20261025_110000_issue_2829_page_tree.down,
    name: '20261025_110000_issue_2829_page_tree',
  },
  {
    up: migration_20261025_120000_issue_2829_design_system_blocks.up,
    down: migration_20261025_120000_issue_2829_design_system_blocks.down,
    name: '20261025_120000_issue_2829_design_system_blocks',
  },
  {
    up: migration_20261025_130000_issue_2829_live_offering_grids.up,
    down: migration_20261025_130000_issue_2829_live_offering_grids.down,
    name: '20261025_130000_issue_2829_live_offering_grids',
  },
  {
    up: migration_20261025_140000_issue_2829_content_collections.up,
    down: migration_20261025_140000_issue_2829_content_collections.down,
    name: '20261025_140000_issue_2829_content_collections',
  },
  {
    up: migration_20261025_150000_issue_2829_video_media.up,
    down: migration_20261025_150000_issue_2829_video_media.down,
    name: '20261025_150000_issue_2829_video_media',
  },
  {
    up: migration_20261025_160000_issue_2829_voyage_design.up,
    down: migration_20261025_160000_issue_2829_voyage_design.down,
    name: '20261025_160000_issue_2829_voyage_design',
  },
  {
    up: migration_20261025_170000_issue_2829_w7b_history_only_and_form_hints.up,
    down: migration_20261025_170000_issue_2829_w7b_history_only_and_form_hints.down,
    name: '20261025_170000_issue_2829_w7b_history_only_and_form_hints',
  },
  {
    up: migration_20261025_180000_issue_2829_w9r_content_order.up,
    down: migration_20261025_180000_issue_2829_w9r_content_order.down,
    name: '20261025_180000_issue_2829_w9r_content_order',
  },
  {
    up: migration_20261025_190000_issue_2829_w9b_work_log.up,
    down: migration_20261025_190000_issue_2829_w9b_work_log.down,
    name: '20261025_190000_issue_2829_w9b_work_log',
  },
];
