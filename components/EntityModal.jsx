import React, { useEffect, useState } from 'react';
import Modal from './Modal';

export default function EntityModal({ title, fields, initialValue, onSubmit, onClose }) {
  const [form, setForm] = useState(initialValue || {});

  useEffect(() => {
    setForm(initialValue || {});
  }, [initialValue]);

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await onSubmit(form);
        }}
      >
        <div className="form-grid">
          {fields.map((field) => (
            <label key={field.key} className={field.full ? 'full' : ''}>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>{field.label}</div>
              {field.type === 'select' ? (
                <select
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: Number(e.target.value) || '' }))}
                  required={field.required !== false}
                >
                  <option value="">Выберите...</option>
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  required={field.required !== false}
                />
              )}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" type="submit">
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}
