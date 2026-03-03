import React, { useEffect, useState } from 'react';
import { api } from '@renderer/api';
import DataTable from '@components/DataTable';
import EntityModal from '@components/EntityModal';

export default function CoursesPage() {
  const [items, setItems] = useState([]);
  const [studios, setStudios] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const [courseList, studioList] = await Promise.all([api.listCourses(), api.listStudios()]);
    setItems(courseList);
    setStudios(studioList);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section>
      <h1 className="page-title">Кружки</h1>
      {error && <p style={{ color: '#ff6978' }}>{error}</p>}
      <div className="toolbar">
        <button className="primary" onClick={() => setEditing({})}>
          Добавить кружок
        </button>
      </div>

      <DataTable
        rows={items}
        columns={[
          { key: 'name', title: 'Кружок' },
          { key: 'studioName', title: 'Студия' },
          {
            key: 'actions',
            title: 'Действия',
            render: (row) => (
              <div className="row-actions">
                <button onClick={() => setEditing(row)}>Редактировать</button>
                <button
                  onClick={async () => {
                    if (!window.confirm('Удалить кружок? Это удалит связанных детей в этом кружке.')) return;
                    try {
                      await api.deleteCourse(row.id);
                      await load();
                    } catch (e) {
                      setError(e?.message || 'Не удалось удалить кружок.');
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
          title={editing.id ? 'Редактировать кружок' : 'Новый кружок'}
          initialValue={editing}
          fields={[
            { key: 'name', label: 'Название кружка' },
            {
              key: 'studioId',
              label: 'Студия',
              type: 'select',
              options: studios.map((studio) => ({ value: studio.id, label: studio.name }))
            }
          ]}
          onClose={() => setEditing(null)}
          onSubmit={async (payload) => {
            try {
              await api.saveCourse(payload);
              setEditing(null);
              await load();
              setError('');
            } catch (e) {
              setError(e?.message || 'Не удалось сохранить кружок.');
            }
          }}
        />
      )}
    </section>
  );
}
