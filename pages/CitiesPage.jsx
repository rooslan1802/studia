import React, { useEffect, useState } from 'react';
import { api } from '@renderer/api';
import DataTable from '@components/DataTable';
import EntityModal from '@components/EntityModal';

export default function CitiesPage() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setItems(await api.listCities());
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section>
      <h1 className="page-title">Города</h1>
      {error && <p style={{ color: '#ff6978' }}>{error}</p>}
      <div className="toolbar">
        <button className="primary" onClick={() => setEditing({})}>
          Добавить город
        </button>
      </div>

      <DataTable
        rows={items}
        columns={[
          { key: 'name', title: 'Название' },
          {
            key: 'actions',
            title: 'Действия',
            render: (row) => (
              <div className="row-actions">
                <button onClick={() => setEditing(row)}>Редактировать</button>
                <button
                  onClick={async () => {
                    if (!window.confirm('Удалить город? Это также удалит связанные студии/детей.')) return;
                    try {
                      await api.deleteCity(row.id);
                      await load();
                    } catch (e) {
                      setError(e?.message || 'Не удалось удалить город.');
                    }
                  }}
                >
                  Удалить
                </button>
              </div>
            )
          }
        ]}
      />

      {editing && (
        <EntityModal
          title={editing.id ? 'Редактировать город' : 'Новый город'}
          initialValue={editing}
          fields={[{ key: 'name', label: 'Название города' }]}
          onClose={() => setEditing(null)}
          onSubmit={async (payload) => {
            try {
              await api.saveCity(payload);
              setEditing(null);
              await load();
              setError('');
            } catch (e) {
              setError(e?.message || 'Не удалось сохранить город.');
            }
          }}
        />
      )}
    </section>
  );
}
