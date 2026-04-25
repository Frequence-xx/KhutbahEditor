import Store from 'electron-store';

export type AppSettings = {
  outputDir?: string;
  audioTargetLufs: number;
  audioTargetTp: number;
  audioTargetLra: number;
  silenceThresholdDb: number;
  silenceMinDuration: number;
  minPart1Duration: number;
  autoPilot: boolean;
  defaultVisibility: 'public' | 'unlisted' | 'private';
  defaultMadeForKids: boolean;
  defaultCategoryId: string;
  defaultTags: string[];
  titleTemplate: string;
  descriptionTemplate: string;
  khatibName: string;
};

export const defaults: AppSettings = {
  audioTargetLufs: -14,
  audioTargetTp: -1,
  audioTargetLra: 11,
  silenceThresholdDb: -35,
  silenceMinDuration: 1.5,
  minPart1Duration: 300,
  autoPilot: true,
  defaultVisibility: 'unlisted',
  defaultMadeForKids: false,
  defaultCategoryId: '27',
  defaultTags: ['khutbah', 'friday', 'sermon', 'jumma', 'alhimmah'],
  titleTemplate: 'Khutbah {date} — Deel {n}{lang_suffix}',
  descriptionTemplate: `Vrijdagkhutbah van Al-Himmah Moskee, {date}.

Deel {n}{lang_suffix}{khatib_line}
{other_part_link}

Bezoek ons: alhimmah.nl`,
  khatibName: '',
};

export const settingsStore = new Store<AppSettings>({ defaults });
