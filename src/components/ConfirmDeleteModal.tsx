import React from 'react';
import './ConfirmDeleteModal.css';

interface ConfirmDeleteModalProps {
  tripName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ tripName, onConfirm, onCancel }) => {
  return (
    <div className="confirm-delete-overlay" onClick={onCancel}>
      <div className="confirm-delete-modal" onClick={e => e.stopPropagation()}>
        <h4 className="confirm-delete-modal__title">Delete trip?</h4>
        <p className="confirm-delete-modal__body">
          Are you sure you want to delete <strong>{tripName ?? 'this trip'}</strong>?
          This action cannot be undone.
        </p>
        <div className="confirm-delete-modal__actions">
          <button className="confirm-delete-modal__btn confirm-delete-modal__btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirm-delete-modal__btn confirm-delete-modal__btn--confirm" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
