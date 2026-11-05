/** Real SVG flags: no emoji/system-font dependency, no external image host. */
import {Globe2} from 'lucide-react';
import {COUNTRY_CODES, countryName} from '../lib/countries';
export default function CountryFlag({code, className = ''}: {code?: string | null; className?: string}) {
  const country=(code || '').toUpperCase();
  return COUNTRY_CODES.has(country)
    ? <img src={`/flags/${country.toLowerCase()}.svg`} width="24" height="18" alt={`${countryName(country)} flag`} title={countryName(country)} loading="lazy" className={`country-flag ${className}`} />
    : <Globe2 role="img" aria-label="Country not set" className={`country-flag country-flag-unset ${className}`} />;
}
