import React, { useMemo, useState } from 'react';

export default function DataTable({ columns, rows }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return rows;
    }

    const value = search.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => String(row[col.key] ?? '').toLowerCase().includes(value))
    );
  }, [rows, columns, search]);

  return (
    <div className="panel">
      <div className="toolbar">
        <input
          placeholder="Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
            </tr>
          ))}
          {!filtered.length && (
            <tr>
              <td colSpan={columns.length} style={{ color: '#97a7c3' }}>
                Нет данных
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
