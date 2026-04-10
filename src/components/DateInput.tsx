import { CONFIG } from '../constants/config';
import { UI_SYMBOLS } from '../constants/ui';
import { useState, useRef, useEffect, useMemo } from 'react';
import './DateInput.css';
import { useTexts } from '../hooks/useTexts';
import dayjs from '../lib/dayjs';

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  timezone?: string;
  minDate?: string; // YYYY-MM-DD, overrides today as the minimum selectable date
}

const DateInput = ({ value, onChange, timezone, minDate: minDateProp }: DateInputProps) => {
  const t = useTexts();
  const [displayValue, setDisplayValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<dayjs.Dayjs | null>(null);
  const [currentMonth, setCurrentMonth] = useState<dayjs.Dayjs>(dayjs());
  const [editMode, setEditMode] = useState<'day' | 'month' | 'year' | null>(null);
  const [editPosition, setEditPosition] = useState(0); 
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const dateRange = useMemo(() => {
    let today = dayjs().startOf('day');
    if (timezone) {
      today = dayjs().tz(timezone).startOf('day');
    }

    let min = today;
    if (minDateProp) {
      const propMin = dayjs(minDateProp).startOf('day');
      if (propMin.isValid() && propMin.isAfter(min)) {
        min = propMin;
      }
    }
    const max = today.add(180, 'days');
    return { min, max, today };
  }, [timezone, minDateProp]);

  const getAvailableYears = () => {
    const { today, max } = dateRange;
    const years = [today.year()];
    if (max.year() > today.year()) {
      years.push(max.year());
    }
    return years;
  };

  const isDateValid = (day: number, month: number, year: number) => {
    const { min, max } = dateRange;
    const date = dayjs(`${year}-${month}-${day}`, 'YYYY-M-D').startOf('day');
    if (!date.isValid()) return false;
    return (date.isSame(min) || date.isAfter(min)) && (date.isSame(max) || date.isBefore(max));
  };

  // Initialize with value or today
  useEffect(() => {
    if (value) {
      const d = dayjs(value).startOf('day');
      if (d.isValid()) {
        setDisplayValue(d.format('DD/MM/YYYY'));
        setSelectedDate(d);
        setCurrentMonth(d.startOf('month'));
      }
    } else {
      const { today } = dateRange;
      setDisplayValue(today.format('DD/MM/YYYY'));
      setSelectedDate(today);
      setCurrentMonth(today.startOf('month'));
    }
  }, [value, dateRange]);

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

  // Update cursor position
  useEffect(() => {
    if (inputRef.current && editMode) {
      let start, end;
      if (editMode === 'day') {
        [start, end] = [0, 2];
      } else if (editMode === 'month') {
        [start, end] = [3, 5];
      } else if (editMode === 'year') {
        [start, end] = [6, 10];
      }
      inputRef.current.setSelectionRange(start ?? 0, end ?? 0);
    }
  }, [editMode, displayValue]);

  const handleInputClick = (e: React.MouseEvent<HTMLInputElement>) => {
    setIsOpen(true);
    const clickPosition = (e.target as HTMLInputElement).selectionStart ?? 0;
    const availableYears = getAvailableYears();

    let mode: 'day' | 'month' | 'year';
    if (clickPosition <= 2) {
      mode = 'day';
    } else if (clickPosition >= 3 && clickPosition <= 5) {
      mode = 'month';
    } else {
      if (availableYears.length <= 1) return;
      mode = 'year';
    }
    setEditMode(mode);
    setEditPosition(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); return; }
    if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    if (e.key === 'Escape') { setIsOpen(false); setEditMode(null); return; }
    if (e.key < '0' || e.key > '9') { e.preventDefault(); return; }

    e.preventDefault();
    if (!editMode) {
      setEditMode('day');
      setEditPosition(0);
    }

    const digit = parseInt(e.key);
    const [dStr, mStr, yStr] = displayValue.split('/');
    let curDay = parseInt(dStr);
    let curMonth = parseInt(mStr);
    let curYear = parseInt(yStr);

    const { min, max } = dateRange;
    const availableYears = getAvailableYears();

    const updateDisplay = (nD: number, nM: number, nY: number) => {
      const dateStr = dayjs(`${nY}-${nM}-${nD}`, 'YYYY-MM-DD').format('YYYY-MM-DD');
      onChange(dateStr);
    };

    if (editMode === 'day') {
      if (editPosition === 0) {
        if (digit > 3) {
          const nD = digit;
          // Find first valid month/year for this day
          for (let i = 0; i < 12; i++) {
            const test = dayjs(`${curYear}-${curMonth}-${nD}`, 'YYYY-MM-DD').add(i, 'month');
            if (test.isValid() && (test.isSame(min) || test.isAfter(min)) && (test.isSame(max) || test.isBefore(max))) {
              updateDisplay(nD, test.month() + 1, test.year());
              setEditMode('month');
              setEditPosition(0);
              return;
            }
          }
        } else {
          setEditPosition(1);
        }
      } else {
        const nD = (curDay % 10) + digit * 10 > 31 ? digit : parseInt(Math.floor(curDay / 10) + '' + digit);
        if (nD > 31 || nD === 0) return;
        for (let i = 0; i < 12; i++) {
          const test = dayjs(`${curYear}-${curMonth}-${nD}`, 'YYYY-M-D').add(i, 'month');
          if (test.isValid() && (test.isSame(min) || test.isAfter(min)) && (test.isSame(max) || test.isBefore(max))) {
            updateDisplay(nD, test.month() + 1, test.year());
            setEditMode('month');
            setEditPosition(0);
            return;
          }
        }
      }
    } else if (editMode === 'month') {
      if (editPosition === 0) {
        if (digit > 1) {
          const nM = digit;
          if (isDateValid(curDay, nM, curYear)) {
            updateDisplay(curDay, nM, curYear);
            if (availableYears.length > 1) { setEditMode('year'); setEditPosition(0); }
            else setEditMode(null);
          }
        } else {
          setEditPosition(1);
        }
      } else {
        const nM = parseInt(Math.floor(curMonth / 10) + '' + digit);
        if (nM > 12 || nM === 0) return;
        if (isDateValid(curDay, nM, curYear)) {
          updateDisplay(curDay, nM, curYear);
          if (availableYears.length > 1) { setEditMode('year'); setEditPosition(0); }
          else setEditMode(null);
        }
      }
    } else if (editMode === 'year') {
      const yStr = String(curYear);
      let nYStr = yStr;
      if (editPosition === 0) nYStr = digit + yStr.substring(1);
      else if (editPosition === 1) nYStr = yStr[0] + digit + yStr.substring(2);
      else if (editPosition === 2) nYStr = yStr.substring(0, 2) + digit + yStr[3];
      else if (editPosition === 3) nYStr = yStr.substring(0, 3) + digit;

      const nY = parseInt(nYStr);
      if (!availableYears.includes(nY)) return;
      if (isDateValid(curDay, curMonth, nY)) {
        if (editPosition < 3) setEditPosition(editPosition + 1);
        else { setEditMode(null); updateDisplay(curDay, curMonth, nY); }
      }
    }
  };

  const handleDateClick = (date: dayjs.Dayjs) => {
    onChange(date.format('YYYY-MM-DD'));
    setIsOpen(false);
    setEditMode(null);
  };

  const changeMonth = (delta: number) => {
    setCurrentMonth(prev => prev.add(delta, 'month'));
  };

  const renderCalendar = () => {
    const { min, max, today } = dateRange;
    const startOfMonth = currentMonth.startOf('month');
    const endOfMonth = currentMonth.endOf('month');
    const daysInMonth = currentMonth.daysInMonth();
    
    // Dayjs weekday: 0 (Sun) to 6 (Sat)
    let startDay: number = startOfMonth.day(); 
    // Adjust to Mon-Sun
    startDay = startDay === 0 ? 6 : startDay - 1;

    const days = [];
    for (let i = 0; i < startDay; i++) {
        days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = currentMonth.date(d).startOf('day');
      const isSelected = selectedDate && date.isSame(selectedDate, 'day');
      const isDayToday = date.isSame(today, 'day');
      const isDisabled = date.isBefore(min) || date.isAfter(max);

      days.push(
        <div
          key={d}
          className={`calendar-day ${isSelected ? 'selected' : ''} ${isDayToday ? 'today' : ''} ${isDisabled ? 'disabled' : ''}`}
          onClick={() => !isDisabled && handleDateClick(date)}
        >
          {d}
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
          placeholder={t.date.placeholder}
          className="date-text-input"
          readOnly
        />
      </div>

      {isOpen && (
        <div className="calendar-popup">
          <div className="calendar-header">
            <button onClick={() => changeMonth(-1)} className="month-nav">{UI_SYMBOLS.PREV}</button>
            <div className="month-year">
              {currentMonth.format('MMMM YYYY')}
            </div>
            <button onClick={() => changeMonth(1)} className="month-nav">{UI_SYMBOLS.NEXT}</button>
          </div>

          <div className="calendar-weekdays">
            <div className="weekday">{t.days.mon}</div>
            <div className="weekday">{t.days.tue}</div>
            <div className="weekday">{t.days.wed}</div>
            <div className="weekday">{t.days.thu}</div>
            <div className="weekday">{t.days.fri}</div>
            <div className="weekday">{t.days.sat}</div>
            <div className="weekday">{t.days.sun}</div>
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