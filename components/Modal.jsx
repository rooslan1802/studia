import React from 'react';
import { createPortal } from 'react-dom';

export default function Modal({ title, children, onClose }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose}>Закрыть</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
