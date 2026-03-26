import React, { useState, useEffect, useRef } from 'react';
import './TripNameModal.css';
import { useTexts } from '../hooks/useTexts';

interface TripNameModalProps {
  initialName?: string;
  title?: string;
  confirmLabel?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

const TripNameModal: React.FC<TripNameModalProps> = ({
  initialName = '',
  title = 'Name your trip',
  confirmLabel = 'Save',
  onConfirm,
  onCancel,
}) => {
  const t = useTexts();
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(name.trim());
  };

  const handleOverlayKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div
      className="trip-name-modal-overlay"
      onClick={onCancel}
      onKeyDown={handleOverlayKeyDown}
      tabIndex={-1}
    >
      <div className="trip-name-modal" onClick={e => e.stopPropagation()}>
        <h4 className="trip-name-modal__title">{title}</h4>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="trip-name-modal__input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t.modals.namePlaceholder}
          />
          <div className="trip-name-modal__actions">
            <button type="button" className="trip-name-modal__btn trip-name-modal__btn--cancel" onClick={onCancel}>{t.buttons.cancel}</button>
            <button type="submit" className="trip-name-modal__btn trip-name-modal__btn--confirm">
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TripNameModal;
