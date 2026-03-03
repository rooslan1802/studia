import React, { useEffect, useState } from 'react';
import { api } from '@renderer/api';
import DataTable from '@components/DataTable';

export default function NotificationsPage() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.listNotifications().then(setItems);
  }, []);

  return (
    <section>
      <h1 className="page-title">Уведомления</h1>
      <p className="page-subtitle">Лента событий: оплаты, ваучеры, очередь, табели и системные оповещения.</p>

      <DataTable
        rows={items.map((item, index) => ({ ...item, id: item.id || `${item.type}-${item.childId || item.sourceId || index}` }))}
        columns={[
          { key: 'category', title: 'Категория' },
          { key: 'title', title: 'Тип' },
          { key: 'message', title: 'Сообщение' },
          { key: 'studioName', title: 'Студия' },
          { key: 'createdAt', title: 'Дата' }
        ]}
      />
    </section>
  );
}
