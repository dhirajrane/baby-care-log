// Labels and reference tables.
export const FEED = { breast: 'Breast', bottle: 'Expressed milk', formula: 'Formula', solids: 'Solids' };
export const SIDE = { L: 'Left', R: 'Right', both: 'Both sides' };
export const DIAPER = { wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty' };
export const COLORS = ['Yellow', 'Mustard', 'Green', 'Brown', 'Black', 'Other'];
export const TSITE = { rectal: 'Rectal', armpit: 'Armpit', ear: 'Ear', forehead: 'Forehead' };
export const NOTE_TAGS = { happy: 'Happy', calm: 'Calm', fussy: 'Fussy', sleepy: 'Sleepy', unwell: 'Unwell', milestone: 'Milestone' };
export const KL = { feed: 'feed', pump: 'pumping session' };
export const HF = { all: 'All', feed: 'Feeds', diaper: 'Diapers', sleep: 'Sleep', pump: 'Pumping', note: 'Notes' };

// Appointments
export const AK = { midwife: 'Midwife', cb: 'Consultatiebureau', vaccination: 'Vaccination', doctor: 'Doctor', other: 'Other' };
export const AK_TITLE = { midwife: 'Midwife visit', cb: 'Consultatiebureau check-up', vaccination: 'Vaccination', doctor: 'Doctor appointment', other: '' };
export const REMIND_OPTS = [[10080, '1 week before'], [1440, '1 day before'], [180, '3 hours before'], [60, '1 hour before'], [0, 'At the time']];
export const REP_KINDS = ['cb', 'doctor', 'midwife'];

// WHO weight-for-age, months 0–12 (kg): 3rd, 50th, 97th percentile
export const WHO = {
  girl: { p3: [2.4, 3.2, 4.0, 4.6, 5.1, 5.5, 5.8, 6.1, 6.3, 6.6, 6.8, 7.0, 7.1], p50: [3.2, 4.2, 5.1, 5.8, 6.4, 6.9, 7.3, 7.6, 7.9, 8.2, 8.5, 8.7, 8.9], p97: [4.2, 5.4, 6.5, 7.4, 8.1, 8.7, 9.2, 9.6, 10.0, 10.4, 10.7, 11.0, 11.3] },
  boy: { p3: [2.5, 3.4, 4.4, 5.1, 5.6, 6.1, 6.4, 6.7, 7.0, 7.2, 7.5, 7.7, 7.8], p50: [3.3, 4.5, 5.6, 6.4, 7.0, 7.5, 7.9, 8.3, 8.6, 8.9, 9.2, 9.4, 9.6], p97: [4.4, 5.8, 7.1, 8.0, 8.7, 9.3, 9.8, 10.3, 10.7, 11.0, 11.4, 11.7, 12.0] },
};

export const HELP_SRC = {
  voeding: ['Voedingscentrum guidance on bottle feeding (via GGD Gooi en Vechtstreek)', 'https://www.ggdgv.nl/wp-content/uploads/sites/2/2024/04/flesvoeding-2023-1.pdf'],
  who: ['WHO Child Growth Standards', 'https://www.who.int/tools/child-growth-standards'],
  rvp: ['Rijksvaccinatieprogramma vaccination schedule', 'https://rijksvaccinatieprogramma.nl/sites/default/files/2026-02/Vaccination-schedule.pdf'],
  fever: ['Gezondheid en Wetenschap: Koorts bij een kind', 'https://gezondheidenwetenschap.be/richtlijnen/koorts-bij-een-kind'],
};
