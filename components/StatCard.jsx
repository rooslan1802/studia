import React from 'react';

export default function StatCard({ label, value, onClick }) {
  return (
    <button className="stat-card" onClick={onClick} style={{ textAlign: 'left' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </button>
  );
}
