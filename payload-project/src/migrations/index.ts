import * as migration_20260930_135554_init from './20260930_135554_init';

export const migrations = [
  {
    up: migration_20260930_135554_init.up,
    down: migration_20260930_135554_init.down,
    name: '20260930_135554_init'
  },
];
