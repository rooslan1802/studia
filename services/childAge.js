function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toIsoDateTime(date) {
  return new Date(date).toISOString();
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function fullYearsBetween(startValue, endValue = new Date()) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) {
    return 0;
  }

  let years = end.getFullYear() - start.getFullYear();
  const monthDiff = end.getMonth() - start.getMonth();
  const dayDiff = end.getDate() - start.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years -= 1;
  }

  return Math.max(0, years);
}

function isValidCalendarDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// User's requested format: YYMMDD -> dd.mm.yyyy (e.g. 010218 => 18.02.2001)
function parseBirthDateFromIIN(iinRaw) {
  const iin = String(iinRaw || '').replace(/\D/g, '');
  if (iin.length < 6) {
    return null;
  }

  const yy = Number(iin.slice(0, 2));
  const mm = Number(iin.slice(2, 4));
  const dd = Number(iin.slice(4, 6));

  const nowYY = new Date().getFullYear() % 100;
  const year = yy <= nowYY ? 2000 + yy : 1900 + yy;

  if (!isValidCalendarDate(year, mm, dd)) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function calculateAge({ childIIN, childBirthDate, manualAge, manualAgeSetDate }, today = new Date()) {
  const fromIIN = parseBirthDateFromIIN(childIIN);
  if (fromIIN) {
    return {
      birthDate: fromIIN,
      age: fullYearsBetween(fromIIN, today),
      source: 'iin'
    };
  }

  if (childBirthDate) {
    return {
      birthDate: childBirthDate,
      age: fullYearsBetween(childBirthDate, today),
      source: 'birthDate'
    };
  }

  const initialAge = Number(manualAge);
  if (Number.isFinite(initialAge) && initialAge >= 0) {
    const baseDate = manualAgeSetDate || toIsoDate(today);
    return {
      birthDate: null,
      age: initialAge + fullYearsBetween(baseDate, today),
      source: 'manualAge',
      manualAgeSetDate: baseDate
    };
  }

  return {
    birthDate: null,
    age: null,
    source: null
  };
}

module.exports = {
  toIsoDate,
  toIsoDateTime,
  parseBirthDateFromIIN,
  calculateAge,
  fullYearsBetween
};
