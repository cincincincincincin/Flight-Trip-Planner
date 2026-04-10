import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import 'dayjs/locale/pl';
import 'dayjs/locale/en-gb';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(localizedFormat);
dayjs.extend(customParseFormat);

// Domyślnie ustawiamy polski, ale aplikacja będzie dynamicznie zmieniać locale 
// w zależności od ustawień użytkownika (handled in useTravelDate or App).
dayjs.locale('pl');

export default dayjs;
