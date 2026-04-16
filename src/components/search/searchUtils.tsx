import React from 'react';

export const highlightText = (
  text: string,
  query: string,
  searchMode: 'prefix' | 'contains',
): React.ReactNode => {
  if (!query || !text) return text;

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  if (searchMode === 'prefix') {
    if (textLower.startsWith(queryLower)) {
      return (
        <>
          <b>{text.substring(0, query.length)}</b>
          {text.substring(query.length)}
        </>
      );
    }
  } else if (searchMode === 'contains') {
    const index = textLower.indexOf(queryLower);
    if (index !== -1) {
      return (
        <>
          {text.substring(0, index)}
          <b>{text.substring(index, index + query.length)}</b>
          {text.substring(index + query.length)}
        </>
      );
    }
  }

  return text;
};

export const getSingleAirportLabel = (cityName: string, airportName: string, reverseOrder: boolean = false): string => {
  const cName = cityName.trim();
  const aName = airportName.trim();

  const normalize = (str: string) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cNorm = normalize(cName);
  const aNorm = normalize(aName);

  if (aNorm === cNorm) {
    return aName;
  }

  // Jeśli nazwa lotniska zawiera nazwę miasta, używamy tylko nazwy lotniska.
  if (aNorm.includes(cNorm)) {
    return aName;
  }
  
  // W przeciwnym razie łączymy obie nazwy
  if (reverseOrder) {
    return `${aName} – ${cName}`;
  }
  return `${cName} – ${aName}`;
};
