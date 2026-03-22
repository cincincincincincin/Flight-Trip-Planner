import React from 'react';
import './ConfirmDeleteModal.css';
import { TEXTS } from '../constants/text';

interface ConfirmDeleteModalProps {
  tripName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ tripName, onConfirm, onCancel }) => {
  return (
    <div className="confirm-delete-overlay" onClick={onCancel}>
      <div className="confirm-delete-modal" onClick={e => e.stopPropagation()}>
        <h4 className="confirm-delete-modal__title">{TEXTS.modals.deleteTrip}</h4>
        <p className="confirm-delete-modal__body">{TEXTS.modals.sureDelete}<strong>{tripName ?? TEXTS.modals.thisTrip}</strong>?
          {TEXTS.modals.undoWarning}
        </p>
        <div className="confirm-delete-modal__actions">
          <button className="confirm-delete-modal__btn confirm-delete-modal__btn--cancel" onClick={onCancel}>{TEXTS.buttons.cancel}</button>
          <button className="confirm-delete-modal__btn confirm-delete-modal__btn--confirm" onClick={onConfirm}>{TEXTS.buttons.delete}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
