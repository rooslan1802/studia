import React, { useEffect, useState } from 'react';
import { api } from '@renderer/api';
import DataTable from '@components/DataTable';
import EntityModal from '@components/EntityModal';

export default function StudiosPage() {
  const [items, setItems] = useState([]);
  const [cities, setCities] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const [studioList, cityList] = await Promise.all([api.listStudios(), api.listCities()]);
    setItems(studioList);
    setCities(cityList);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section>
      <h1 className="page-title">Студии</h1>
      {error && <p style={{ color: '#ff6978' }}>{error}</p>}
      <div className="toolbar">
        <button className="primary" onClick={() => setEditing({})}>
          Добавить студию
        </button>
      </div>

      <DataTable
        rows={items}
        columns={[
          { key: 'name', title: 'Студия' },
          { key: 'cityName', title: 'Город' },
          {
            key: 'actions',
            title: 'Действия',
            render: (row) => (
              <div className="row-actions">
                <button onClick={() => setEditing(row)}>Редактировать</button>
                <button
                  onClick={async () => {
                    if (!window.confirm('Удалить студию? Это удалит связанные кружки и детей.')) return;
                    try {
                      await api.deleteStudio(row.id);
                      await load();
                    } catch (e) {
                      setError(e?.message || 'Не удалось удалить студию.');
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
          title={editing.id ? 'Редактировать студию' : 'Новая студия'}
          initialValue={editing}
          fields={[
            { key: 'name', label: 'Название студии' },
            {
              key: 'cityId',
              label: 'Город',
              type: 'select',
              options: cities.map((city) => ({ value: city.id, label: city.name }))
            }
          ]}
          onClose={() => setEditing(null)}
          onSubmit={async (payload) => {
            try {
              await api.saveStudio(payload);
              setEditing(null);
              await load();
              setError('');
            } catch (e) {
              setError(e?.message || 'Не удалось сохранить студию.');
            }
          }}
        />
      )}
    </section>
  );
}
