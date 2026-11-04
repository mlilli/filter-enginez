/**
 * `calendarDay` — `YYYY-MM-DD` calendar-day strings: validation and day arithmetic, with no `Date`
 * and no time zone.
 *
 * @remarks
 * A calendar day written `YYYY-MM-DD` (a four-digit year, a zero-padded month and day) sorts as a
 * string in date order, so a range of days is two string comparisons. These helpers check that shape
 * against the proleptic Gregorian calendar (leap years included) and step through days by converting
 * to a count of days since 1970-01-01 and back (Howard Hinnant's `days_from_civil` /
 * `civil_from_days`), so no result depends on the runtime's time zone. Arithmetic stays within the
 * years the shape can write, 0000 to 9999: a step past either end stops at it.
 *
 * @packageDocumentation
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** The first and last days the `YYYY-MM-DD` shape can write. */
const FIRST_DAY = '0000-01-01';
const LAST_DAY = '9999-12-31';

/**
 * Whether `year` is a Gregorian leap year.
 *
 * @param year - The year (proleptic Gregorian; year 0 is a leap year)
 * @returns `true` for a leap year
 */
function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * How many days a month has.
 *
 * @param year - The year, for February
 * @param month - The month, 1–12
 * @returns 28 to 31
 */
function daysInMonth(year: number, month: number): number {
	if (month === 2) {
		return isLeapYear(year) ? 29 : 28;
	}

	return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Whether `value` is a `YYYY-MM-DD` string naming a real calendar day.
 *
 * @param value - Anything
 * @returns `true` when `value` is a string of that shape whose month is 01–12 and whose day exists in
 *   that month (February 29 only in a leap year)
 */
export function isCalendarDay(value: unknown): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	const match = DAY_PATTERN.exec(value);

	if (match === null) {
		return false;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);

	if (month < 1 || month > 12 || day < 1) {
		return false;
	}

	return day <= daysInMonth(year, month);
}

/**
 * Days from 1970-01-01 to a valid calendar day (negative before it).
 *
 * @param day - A string {@link isCalendarDay} accepts
 * @returns The signed day count
 */
function daysFromCivil(day: string): number {
	const month = Number(day.slice(5, 7));
	// The year runs March to February, so a leap day is the last day of its year.
	const year = Number(day.slice(0, 4)) - (month <= 2 ? 1 : 0);
	const era = Math.floor(year / 400);
	const yearOfEra = year - era * 400;
	const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + Number(day.slice(8, 10)) - 1;
	const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

	return era * 146_097 + dayOfEra - 719_468;
}

/**
 * The calendar day a count of days from 1970-01-01 names.
 *
 * @param days - A signed day count within the years 0000–9999
 * @returns The day as `YYYY-MM-DD`
 */
function civilFromDays(days: number): string {
	const shifted = days + 719_468;
	const era = Math.floor(shifted / 146_097);
	const dayOfEra = shifted - era * 146_097;
	const yearOfEra = Math.floor(
		(dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
	);
	const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
	const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
	const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
	const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
	const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);

	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The day counts of the first and last writable days, so a step can stop at them. */
const FIRST_DAY_COUNT = daysFromCivil(FIRST_DAY);
const LAST_DAY_COUNT = daysFromCivil(LAST_DAY);

/**
 * The calendar day `count` days after `day` (before it, for a negative `count`).
 *
 * @param day - A string {@link isCalendarDay} accepts
 * @param count - Whole days to step; negative steps back
 * @returns The day as `YYYY-MM-DD`, stopping at 0000-01-01 or 9999-12-31 rather than leaving the
 *   years the shape can write
 */
export function addCalendarDays(day: string, count: number): string {
	return civilFromDays(Math.min(LAST_DAY_COUNT, Math.max(FIRST_DAY_COUNT, daysFromCivil(day) + count)));
}
