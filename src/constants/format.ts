export const FORMAT_LOCALES = {
  GB: 'en-GB',
  CA: 'en-CA',
  SE: 'sv-SE',
  US: 'en-US'
};

export const FORMAT_OPTIONS = {
  TIME_24H: { hour: '2-digit', minute: '2-digit' } as Intl.DateTimeFormatOptions,
  DATE_SHORT: { day: '2-digit', month: 'short' } as Intl.DateTimeFormatOptions,
  DATE_LONG: { day: 'numeric', month: 'long' } as Intl.DateTimeFormatOptions,
  DATE_LONG_YEAR: { day: 'numeric', month: 'long', year: 'numeric' } as Intl.DateTimeFormatOptions,
};
