const LEVELS = {
  KARYAWAN: 1, LEAD: 2, MANAGER: 3, SENIOR_MANAGER: 4,
  HR: 5, DEPUTI: 6, DIREKTUR: 7, PRESDIR: 8,
};

const LEVEL_NAMES = {
  1: 'Karyawan', 2: 'Lead', 3: 'Manager', 4: 'Senior Manager',
  5: 'HR', 6: 'Deputi', 7: 'Direktur', 8: 'Presdir',
};

const MIN_MANAGER = 3;
const MIN_HR = 5;

module.exports = { LEVELS, LEVEL_NAMES, MIN_MANAGER, MIN_HR };
