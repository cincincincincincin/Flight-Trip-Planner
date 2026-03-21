import { useState, useRef, useEffect } from 'react';
import './DateInput.css';

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  timezone?: string;
  minDate?: string; // YYYY-MM-DD, overrides today as the minimum selectable date
}

const DateInput = ({ value, onChange, timezone, minDate: minDateProp }: DateInputProps) => {
  const [displayValue, setDisplayValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [editMode, setEditMode] = useState<string | null>(null); // 'day' | 'month' | 'year'
  const [editPosition, setEditPosition] = useState(0); // 0-1 for day/month, 0-3 for year
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Helper functions
  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month, 0).getDate();
  };

  const getDateRange = () => {
    const now = new Date();
    let today;

    if (timezone) {
      // Get today's date in airport timezone
      const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
      const [year, month, day] = todayStr.split('-');
      today = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      today.setHours(0, 0, 0, 0);
    } else {
      // Use local timezone
      today = new Date();
      today.setHours(0, 0, 0, 0);
    }

    const minDate = new Date(today); // wcześniejsze daty są niedozwolone
    if (minDateProp) {
      const [py, pm, pd] = minDateProp.split('-');
      const propMin = new Date(parseInt(py), parseInt(pm) - 1, parseInt(pd));
      propMin.setHours(0, 0, 0, 0);
      if (propMin > minDate) minDate.setTime(propMin.getTime());
    }
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 180);
    return { minDate, maxDate, today };
  };

  const getAvailableYears = () => {
    const { today, maxDate } = getDateRange();
    const years = [today.getFullYear()];
    if (maxDate.getFullYear() > today.getFullYear()) {
      years.push(maxDate.getFullYear());
    }
    return years;
  };

  // Sprawdza, czy data (day, month, year) jest >= minDate
  const isDateValid = (day: number, month: number, year: number) => {
    const { minDate, maxDate } = getDateRange();
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date >= minDate && date <= maxDate;
  };

  // Initialize with value or today (in timezone if provided)
  useEffect(() => {
    if (value) {
      const [yearS, monthS, dayS] = value.split('-');
      const [y, m, d] = [parseInt(yearS), parseInt(monthS), parseInt(dayS)];
      setDisplayValue(`${dayS}/${monthS}/${yearS}`);
      setSelectedDate(new Date(y, m - 1, d));
      setCurrentMonth(new Date(y, m - 1, 1));
    } else {
      // If no value but timezone is provided, use timezone's today
      if (timezone) {
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
        const [year, month, day] = todayStr.split('-');
        setDisplayValue(`${day}/${month}/${year}`);
        setSelectedDate(new Date(parseInt(year), parseInt(month) - 1, parseInt(day)));
        setCurrentMonth(new Date(parseInt(year), parseInt(month) - 1, 1));
      } else {
        // Fall back to local time
        const today = new Date();
        const day = String(today.getDate()).padStart(2, '0');
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const year = today.getFullYear();
        setDisplayValue(`${day}/${month}/${year}`);
        setSelectedDate(today);
        setCurrentMonth(today);
      }
    }
  }, [value, timezone]);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setEditMode(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update cursor position based on edit mode
  useEffect(() => {
    if (inputRef.current && editMode) {
      let start, end;
      if (editMode === 'day') {
        start = 0;
        end = 2;
      } else if (editMode === 'month') {
        start = 3;
        end = 5;
      } else if (editMode === 'year') {
        start = 6;
        end = 10;
      }
      inputRef.current.setSelectionRange(start ?? 0, end ?? 0);
    }
  }, [editMode, displayValue]);

  const handleInputClick = (e: React.MouseEvent<HTMLInputElement>) => {
    setIsOpen(true);
    const clickPosition = (e.target as HTMLInputElement).selectionStart ?? 0;
    const availableYears = getAvailableYears();

    // Determine which part was clicked
    let mode;
    if (clickPosition <= 2) {
      mode = 'day';
      setEditPosition(0);
    } else if (clickPosition >= 3 && clickPosition <= 5) {
      mode = 'month';
      setEditPosition(0);
    } else {
      // Clicking on year - only allow if multiple years available
      if (availableYears.length <= 1) {
        return; // Don't enter edit mode for year if only one year available
      }
      mode = 'year';
      setEditPosition(0);
    }

    setEditMode(mode);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Only handle number keys and backspace
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      return;
    }

    if (e.key === 'Tab') {
      return; // Allow tab
    }

    if (e.key === 'Escape') {
      setIsOpen(false);
      setEditMode(null);
      return;
    }

    if (e.key < '0' || e.key > '9') {
      e.preventDefault();
      return;
    }

    e.preventDefault();

    if (!editMode) {
      setEditMode('day');
      setEditPosition(0);
    }

    const digit = parseInt(e.key);
    const parts = displayValue.split('/');
    let day = parseInt(parts[0]);
    let month = parseInt(parts[1]);
    let year = parseInt(parts[2]);

    const { minDate, maxDate } = getDateRange();
    const availableYears = getAvailableYears();

    // Funkcja pomocnicza do aktualizacji wyświetlania i wywołania onChange jeśli data kompletna i ważna
    const updateDisplay = (newDay: number, newMonth: number, newYear: number) => {
      const newDisplay = `${String(newDay).padStart(2, '0')}/${String(newMonth).padStart(2, '0')}/${newYear}`;
      setDisplayValue(newDisplay);
      if (isDateValid(newDay, newMonth, newYear)) {
        const dateStr = `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
        setSelectedDate(new Date(newYear, newMonth - 1, newDay));
        setCurrentMonth(new Date(newYear, newMonth - 1, 1));
        onChange(dateStr);
      }
    };

    if (editMode === 'day') {
      if (editPosition === 0) {
        // First digit of day
        if (digit > 3) {
          // Auto-complete: 0{digit}
          const newDay = parseInt('0' + digit);
          // Sprawdź czy ten dzień jest możliwy w którymś z najbliższych miesięcy?
          // Najpierw znajdź najbliższy miesiąc, który ma tyle dni i daje datę >= minDate
          let found = false;
          for (let offset = 0; offset < 12; offset++) {
            const testDate = new Date(year, month - 1 + offset, newDay);
            testDate.setHours(0, 0, 0, 0);
            if (testDate >= minDate && testDate <= maxDate) {
              const newMonth = month + offset;
              const newYear = year + Math.floor((month - 1 + offset) / 12);
              const adjMonth = ((month - 1 + offset) % 12) + 1;
              updateDisplay(newDay, adjMonth, newYear);
              found = true;
              break;
            }
          }
          if (!found) return; // nie można
          if (availableYears.length > 1) {
            setEditMode('month');
            setEditPosition(0);
          } else {
            setEditMode('month');
            setEditPosition(0);
          }
        } else {
          // Wait for second digit
          day = digit * 10 + (day % 10);
          // Clamp to maximum 31
          if (day > 31) day = 31;
          setEditPosition(1);
          // Nie aktualizujemy jeszcze daty, bo niepełna
        }
      } else {
        // Second digit of day
        const firstDigit = Math.floor(day / 10);
        const newDay = firstDigit * 10 + digit;
        if (newDay > 31) return;
        // Sprawdź czy istnieje miesiąc z takim dniem (i datą >= minDate)
        let found = false;
        for (let offset = 0; offset < 12; offset++) {
          const testDate = new Date(year, month - 1 + offset, newDay);
          testDate.setHours(0, 0, 0, 0);
          if (testDate >= minDate && testDate <= maxDate) {
            const newMonth = month + offset;
            const newYear = year + Math.floor((month - 1 + offset) / 12);
            const adjMonth = ((month - 1 + offset) % 12) + 1;
            updateDisplay(newDay, adjMonth, newYear);
            found = true;
            break;
          }
        }
        if (!found) return;
        if (availableYears.length > 1) {
          setEditMode('month');
          setEditPosition(0);
        } else {
          setEditMode('month');
          setEditPosition(0);
        }
      }
    } else if (editMode === 'month') {
      if (editPosition === 0) {
        // First digit of month
        if (digit > 1) {
          // Auto-complete: 0{digit}
          const newMonth = parseInt('0' + digit);
          // Sprawdź czy dla bieżącego dnia istnieje taki miesiąc w zakresie
          const daysInMonth = getDaysInMonth(newMonth, year);
          if (daysInMonth >= day) {
            const testDate = new Date(year, newMonth - 1, day);
            testDate.setHours(0, 0, 0, 0);
            if (testDate >= minDate && testDate <= maxDate) {
              updateDisplay(day, newMonth, year);
              if (availableYears.length > 1) {
                setEditMode('year');
                setEditPosition(0);
              } else {
                setEditMode(null);
              }
            }
          }
        } else {
          // 0 or 1, wait for second digit
          month = digit * 10 + (month % 10);
          if (month > 12) month = 12;
          setEditPosition(1);
        }
      } else {
        // Second digit of month
        const firstDigit = Math.floor(month / 10);
        const newMonth = firstDigit * 10 + digit;
        if (newMonth > 12 || newMonth === 0) return;
        const daysInMonth = getDaysInMonth(newMonth, year);
        if (daysInMonth < day) return;
        const testDate = new Date(year, newMonth - 1, day);
        testDate.setHours(0, 0, 0, 0);
        if (testDate >= minDate && testDate <= maxDate) {
          updateDisplay(day, newMonth, year);
          if (availableYears.length > 1) {
            setEditMode('year');
            setEditPosition(0);
          } else {
            setEditMode(null);
          }
        }
      }
    } else if (editMode === 'year') {
      // Editing year - constrain to available years
      const yearStr = String(year);
      let newYearStr = yearStr;

      if (editPosition === 0) {
        newYearStr = digit + yearStr.substring(1);
      } else if (editPosition === 1) {
        newYearStr = yearStr[0] + digit + yearStr.substring(2);
      } else if (editPosition === 2) {
        newYearStr = yearStr.substring(0, 2) + digit + yearStr[3];
      } else if (editPosition === 3) {
        newYearStr = yearStr.substring(0, 3) + digit;
      }

      const newYear = parseInt(newYearStr);
      if (!availableYears.includes(newYear)) return;

      // Sprawdź czy data z nowym rokiem jest ważna
      if (isDateValid(day, month, newYear)) {
        if (editPosition < 3) {
          setEditPosition(editPosition + 1);
        } else {
          // Done editing year
          setEditMode(null);
          setEditPosition(0);
          updateDisplay(day, month, newYear);
        }
      }
    }
  };

  const findNearestMonthForDay = (day: number, startDate: Date) => {
    const { minDate, maxDate } = getDateRange();
    let testDate = new Date(startDate);

    for (let i = 0; i < 7; i++) {
      const year = testDate.getFullYear();
      const month = testDate.getMonth() + 1;
      const daysInMonth = getDaysInMonth(month, year);

      if (daysInMonth >= day) {
        const candidateDate = new Date(year, month - 1, day);
        candidateDate.setHours(0, 0, 0, 0);
        if (candidateDate <= maxDate && candidateDate >= minDate) {
          return { month, year };
        }
      }

      testDate.setMonth(testDate.getMonth() + 1);
    }

    return { month: startDate.getMonth() + 1, year: startDate.getFullYear() };
  };

  const handleDateClick = (date: Date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    const dateStr = `${year}-${month}-${day}`;
    const displayStr = `${day}/${month}/${year}`;

    setDisplayValue(displayStr);
    setSelectedDate(date);
    onChange(dateStr);
    setEditMode(null);
    setIsOpen(false); // zamknij kalendarz po kliknięciu
  };

  const changeMonth = (delta: number) => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    setCurrentMonth(newMonth);
  };

  const renderCalendar = () => {
    const { minDate, maxDate } = getDateRange();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    for (let i = 0; i < (startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1); i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      date.setHours(0, 0, 0, 0);

      const isSelected = selectedDate &&
        date.getDate() === selectedDate.getDate() &&
        date.getMonth() === selectedDate.getMonth() &&
        date.getFullYear() === selectedDate.getFullYear();
      const isToday = date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
      const isDisabled = date < minDate || date > maxDate;

      days.push(
        <div
          key={day}
          className={`calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${isDisabled ? 'disabled' : ''}`}
          onClick={() => !isDisabled && handleDateClick(date)}
        >
          {day}
        </div>
      );
    }

    return days;
  };

  return (
    <div className="date-input-container" ref={containerRef}>
      <div className="date-input-display" onClick={handleInputClick}>
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onKeyDown={handleKeyDown}
          onClick={handleInputClick}
          placeholder="DD/MM/YYYY"
          className="date-text-input"
          readOnly
        />
      </div>

      {isOpen && (
        <div className="calendar-popup">
          <div className="calendar-header">
            <button onClick={() => changeMonth(-1)} className="month-nav">‹</button>
            <div className="month-year">
              {currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </div>
            <button onClick={() => changeMonth(1)} className="month-nav">›</button>
          </div>

          <div className="calendar-weekdays">
            <div className="weekday">Mon</div>
            <div className="weekday">Tue</div>
            <div className="weekday">Wed</div>
            <div className="weekday">Thu</div>
            <div className="weekday">Fri</div>
            <div className="weekday">Sat</div>
            <div className="weekday">Sun</div>
          </div>

          <div className="calendar-grid">
            {renderCalendar()}
          </div>
        </div>
      )}
    </div>
  );
};

export default DateInput;