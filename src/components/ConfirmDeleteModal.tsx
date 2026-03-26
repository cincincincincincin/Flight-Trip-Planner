import React from 'react';
import './ConfirmDeleteModal.css';
import { useTexts } from '../hooks/useTexts';

interface ConfirmDeleteModalProps {
  tripName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ tripName, onConfirm, onCancel }) => {
  const t = useTexts();
  return (
    <div className="confirm-delete-overlay" onClick={onCancel}>
      <div className="confirm-delete-modal" onClick={e => e.stopPropagation()}>
        <h4 className="confirm-delete-modal__title">{t.modals.deleteTrip}</h4>
        <p className="confirm-delete-modal__body">{t.modals.sureDelete}<strong>{tripName ?? t.modals.thisTrip}</strong>?
          {t.modals.undoWarning}
        </p>
        <div className="confirm-delete-modal__actions">
          <button className="confirm-delete-modal__btn confirm-delete-modal__btn--cancel" onClick={onCancel}>{t.buttons.cancel}</button>
          <button className="confirm-delete-modal__btn confirm-delete-modal__btn--confirm" onClick={onConfirm}>{t.buttons.delete}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
