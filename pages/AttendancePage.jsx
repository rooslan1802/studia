import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@renderer/api';
import Modal from '@components/Modal';

const markCycle = ['', 'present', 'absent-other', 'sick'];
const markView = { '': '', present: '✓', 'absent-other': '✕', sick: 'Б' };

function monthStartIso(offset = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthEndIso(offset = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthIso(offset = 0) {
  return monthStartIso(offset).slice(0, 7);
}

function toIsoDateInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayIso() {
  return toIsoDateInput(new Date());
}

function addDays(baseIso, days) {
  const date = new Date(`${baseIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return baseIso;
  date.setDate(date.getDate() + Number(days || 0));
  return toIsoDateInput(date);
}

function nextMark(value) {
  const idx = markCycle.indexOf(value || '');
  return markCycle[(idx + 1) % markCycle.length];
}

function monthLabel(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})/);
  if (!match) return String(iso || '');
  const months = { '01': 'Январь', '02': 'Февраль', '03': 'Март', '04': 'Апрель', '05': 'Май', '06': 'Июнь', '07': 'Июль', '08': 'Август', '09': 'Сентябрь', '10': 'Октябрь', '11': 'Ноябрь', '12': 'Декабрь' };
  return `${months[match[2]] || match[2]} ${match[1]}`;
}

function calendarDays(isoMonthStart) {
  const d = new Date(`${isoMonthStart}T00:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const firstWeekday = ((new Date(year, month, 1).getDay() + 6) % 7);
  const cells = [];

  for (let i = 0; i < firstWeekday; i += 1) cells.push({ isBlank: true, key: `blank-start-${i}` });
  for (let i = 0; i < totalDays; i += 1) {
    const day = i + 1;
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, date, isBlank: false, key: date });
  }

  const remainder = cells.length % 7;
  const trailing = remainder === 0 ? 0 : 7 - remainder;
  for (let i = 0; i < trailing; i += 1) cells.push({ isBlank: true, key: `blank-end-${i}` });
  return cells;
}

function isChildLockedForDate(child, date) {
  const meta = child?.transferMeta;
  if (!meta?.effectiveDate) return false;
  if (meta.mode === 'out') return String(date) >= String(meta.effectiveDate);
  if (meta.mode === 'in') return String(date) < String(meta.effectiveDate);
  return false;
}

export default function AttendancePage() {
  const [view, setView] = useState('boards');
  const [cities, setCities] = useState([]);
  const [studios, setStudios] = useState([]);
  const [courses, setCourses] = useState([]);
  const [groups, setGroups] = useState([]);

  const [cityId, setCityId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [groupId, setGroupId] = useState('');

  const [monthOffset, setMonthOffset] = useState(0);
  const month = useMemo(() => monthIso(monthOffset), [monthOffset]);
  const dateFrom = useMemo(() => monthStartIso(monthOffset), [monthOffset]);
  const dateTo = useMemo(() => monthEndIso(monthOffset), [monthOffset]);

  const [boards, setBoards] = useState([]);
  const [sheet, setSheet] = useState({ dates: [], children: [] });
  const [sessionState, setSessionState] = useState({});
  const [marks, setMarks] = useState({});
  const [dateEditorOpen, setDateEditorOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedChild, setSelectedChild] = useState(null);
  const [transferModalData, setTransferModalData] = useState(null);
  const [transferGroupsList, setTransferGroupsList] = useState([]);
  const [transferSaving, setTransferSaving] = useState(false);

  async function loadMeta() {
    const [cityList, studioList, courseList] = await Promise.all([api.listCities(), api.listStudios(), api.listCourses()]);
    setCities(cityList);
    setStudios(studioList);
    setCourses(courseList);
    if (!cityId && cityList.length) setCityId(String(cityList[0].id));
  }

  async function loadGroups() {
    if (!courseId) {
      setGroups([]);
      return;
    }
    const list = await api.listGroups(Number(courseId));
    setGroups(list);
    if (!groupId && list.length) setGroupId(String(list[0].id));
  }

  async function loadBoards() {
    const data = await api.listAttendanceBoards({ month, cityId: cityId || undefined, courseId: courseId || undefined });
    setBoards(data);
  }

  async function loadSheet() {
    if (!groupId) return;
    const data = await api.getAttendanceSheet({ groupId: Number(groupId), dateFrom, dateTo });
    setSheet(data);
    const state = {};
    data.dates.forEach((d) => {
      state[d.date] = d.sessionStatus || '';
    });
    setSessionState(state);
    const m = {};
    data.children.forEach((child) => {
      m[child.childId] = { ...(child.marks || {}) };
    });
    setMarks(m);
  }

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    if (!cityId) return;
    const cityCourses = courses.filter((c) => Number(c.cityId) === Number(cityId));
    if (!courseId && cityCourses.length) setCourseId(String(cityCourses[0].id));
    if (courseId && !cityCourses.some((x) => Number(x.id) === Number(courseId))) {
      setCourseId(cityCourses[0] ? String(cityCourses[0].id) : '');
      setGroupId('');
    }
  }, [cityId, courses]);

  useEffect(() => {
    loadGroups();
  }, [courseId]);

  useEffect(() => {
    if (!courseId) {
      setView('boards');
      setGroupId('');
    }
  }, [courseId]);

  useEffect(() => {
    loadBoards();
  }, [month, cityId, courseId]);

  useEffect(() => {
    if (view === 'sheet') loadSheet();
  }, [view, groupId, dateFrom, dateTo]);

  useEffect(() => {
    if (!transferModalData?.courseId) {
      setTransferGroupsList([]);
      return undefined;
    }
    let cancelled = false;
    api.listGroups(Number(transferModalData.courseId))
      .then((list) => {
        if (!cancelled) setTransferGroupsList(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setTransferGroupsList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [transferModalData?.courseId]);

  const filteredCourses = useMemo(
    () => courses.filter((c) => !cityId || Number(c.cityId) === Number(cityId)),
    [courses, cityId]
  );
  const transferStudios = useMemo(
    () => studios.filter((studio) => !transferModalData?.cityId || Number(studio.cityId) === Number(transferModalData.cityId)),
    [studios, transferModalData?.cityId]
  );
  const transferCourses = useMemo(
    () => courses.filter((course) => !transferModalData?.studioId || Number(course.studioId) === Number(transferModalData.studioId)),
    [courses, transferModalData?.studioId]
  );
  const transferGroups = useMemo(() => transferGroupsList, [transferGroupsList]);

  async function saveSingleDate(date, nextState, nextMarks) {
    if (!groupId) return;
    const sState = nextState[date] || '';
    let entry;
    if (sState === 'cancelled') {
      entry = { date, sessionStatus: 'cancelled', records: [] };
    } else {
      const records = sheet.children
        .map((child) => ({
          childId: child.childId,
          status: nextMarks[child.childId]?.[date] || '',
          note: ''
        }))
        .filter((x) => x.status === 'present' || x.status === 'absent-other' || x.status === 'absent-valid' || x.status === 'sick');

      entry = { date, sessionStatus: sState || 'conducted', records };
    }

    setSaving(true);
    try {
      await api.saveAttendanceSheet({ groupId: Number(groupId), entries: [entry] });
      setError('');
      await loadBoards();
    } catch (e) {
      setError(e?.message || 'Не удалось сохранить отметки.');
    } finally {
      setSaving(false);
    }
  }

  async function onCellClick(childId, date) {
    const child = sheet.children.find((row) => Number(row.childId) === Number(childId));
    if (isChildLockedForDate(child, date)) return;
    const current = marks[childId]?.[date] || '';
    const next = nextMark(current);
    const nextMarks = {
      ...marks,
      [childId]: {
        ...(marks[childId] || {}),
        [date]: next
      }
    };
    setMarks(nextMarks);
    await saveSingleDate(date, sessionState, nextMarks);
  }

  async function applyForDay(date, mark) {
    const nextMarks = { ...marks };
    sheet.children.forEach((child) => {
      if (isChildLockedForDate(child, date)) return;
      nextMarks[child.childId] = {
        ...(nextMarks[child.childId] || {}),
        [date]: mark
      };
    });
    setMarks(nextMarks);
    const nextState = { ...sessionState, [date]: 'conducted' };
    setSessionState(nextState);
    await saveSingleDate(date, nextState, nextMarks);
  }

  async function cancelDay(date) {
    const nextState = { ...sessionState, [date]: 'cancelled' };
    setSessionState(nextState);
    await saveSingleDate(date, nextState, marks);
  }

  async function clearAllDatesInMonth() {
    if (!groupId) return;
    try {
      await Promise.all(sheet.dates.map((d) => api.removeAttendanceDate({ groupId: Number(groupId), date: d.date })));
      await loadSheet();
      await loadBoards();
    } catch (e) {
      setError(e?.message || 'Не удалось очистить даты месяца.');
    }
  }

  async function openProfile(childId) {
    const full = await api.getChild(childId);
    if (full) setSelectedChild(full);
  }

  function openTransferModal(child) {
    if (!child || child.type !== 'paid') return;
    setTransferModalData({
      childId: child.id,
      cityId: String(child.cityId || cityId || ''),
      studioId: String(child.studioId || ''),
      courseId: String(child.courseId || ''),
      groupId: String(child.groupId || ''),
      effectiveDate: addDays(todayIso(), 1)
    });
  }

  async function submitTransferChild() {
    if (!selectedChild || !transferModalData) return;
    if (!transferModalData.studioId || !transferModalData.courseId || !transferModalData.groupId || !transferModalData.effectiveDate) {
      setError('Заполните студию, кружок, группу и дату перевода.');
      return;
    }
    setTransferSaving(true);
    try {
      await api.saveChild({
        id: selectedChild.id,
        studioId: Number(transferModalData.studioId),
        courseId: Number(transferModalData.courseId),
        groupId: Number(transferModalData.groupId),
        transferEffectiveDate: transferModalData.effectiveDate,
        type: selectedChild.type,
        messageTag: selectedChild.messageTag || '',
        profile: selectedChild.profile
      });
      const refreshed = await api.getChild(selectedChild.id);
      if (refreshed) setSelectedChild(refreshed);
      setTransferModalData(null);
      await loadSheet();
      await loadBoards();
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось перевести ребенка.');
    } finally {
      setTransferSaving(false);
    }
  }

  async function clearDayMarks(date) {
    if (!groupId) return;
    const nextMarks = { ...marks };
    sheet.children.forEach((child) => {
      if (isChildLockedForDate(child, date)) return;
      nextMarks[child.childId] = {
        ...(nextMarks[child.childId] || {}),
        [date]: ''
      };
    });
    setMarks(nextMarks);
    const nextState = { ...sessionState, [date]: 'conducted' };
    setSessionState(nextState);
    await saveSingleDate(date, nextState, nextMarks);
  }

  async function toggleCalendarDate(date) {
    if (!groupId) return;
    const exists = sheet.dates.some((d) => d.date === date);
    try {
      if (exists) {
        await api.removeAttendanceDate({ groupId: Number(groupId), date });
      } else {
        await api.addAttendanceDate({ groupId: Number(groupId), date });
      }
      await loadSheet();
      await loadBoards();
    } catch (e) {
      setError(e?.message || 'Не удалось изменить даты табеля.');
    }
  }

  function openBoard(board) {
    setCityId(String(board.cityId));
    setCourseId(String(board.courseId));
    setGroupId(String(board.groupId));
    setView('sheet');
  }

  return (
    <section>
      <h1 className="page-title">Мои табели</h1>
      <p className="page-subtitle">Обычные табели по группам.</p>
      {error && <p style={{ color: '#ff6978' }}>{error}</p>}

      <>
          <div className="toolbar">
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); setCourseId(''); setGroupId(''); }}>
              <option value="">Все города</option>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>

            <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setGroupId(''); }}>
              <option value="">Все кружки</option>
              {filteredCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>

            <button onClick={() => setMonthOffset((v) => v - 1)}>←</button>
            <div className="month-chip">{monthLabel(dateFrom)}</div>
            <button onClick={() => setMonthOffset((v) => v + 1)}>→</button>

            {view === 'sheet' && (
              <>
                <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <button onClick={() => setDateEditorOpen(true)}>Изменить даты</button>
                <button onClick={() => setView('boards')}>К списку табелей</button>
              </>
            )}

            {saving && <span style={{ color: '#97a7c3' }}>Сохранение...</span>}
          </div>

          {view === 'boards' && (
            <div className="attendance-board-grid">
              {boards.map((board) => (
                <button key={`${board.groupId}-${board.month}`} className="attendance-board-card" onClick={() => openBoard(board)}>
                  <div className="attendance-board-top">
                    <div>
                      <div className="attendance-board-course">{board.courseName}</div>
                      <div className="attendance-board-group">{board.groupName}</div>
                    </div>
                    <span className="badge info">{board.fillPercent}%</span>
                  </div>
                  <div style={{ color: '#97a7c3', marginTop: 6 }}>{board.cityName}</div>
                  <div className="attendance-progress">
                    <div className="attendance-progress-fill" style={{ width: `${board.fillPercent}%` }} />
                  </div>
                  <div className="attendance-board-meta">
                    Дней: {board.plannedDays} | Детей: {board.childrenCount} | Заполнено: {board.filledCells}/{board.expectedCells}
                  </div>
                </button>
              ))}
              {!boards.length && <div className="panel" style={{ color: '#97a7c3' }}>Нет табелей по выбранным фильтрам</div>}
            </div>
          )}

          {view === 'sheet' && (
            <>
              <div className="panel attendance-wrap attendance-panel">
                <table className="attendance-table clean">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>ФИО</th>
                      {sheet.dates.map((d) => (
                        <th key={d.date} className="date-head">
                          <div>{d.dayLabel}</div>
                          <div className={`date-source ${d.source === 'manual' ? 'manual' : ''}`}>
                            {d.source === 'manual' ? 'ручная' : 'расп.'}
                          </div>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th></th>
                      <th></th>
                      {sheet.dates.map((d) => (
                        <th key={`${d.date}-actions`} className="date-head">
                          <div className="day-actions compact">
                            <button onClick={() => applyForDay(d.date, 'present')}>✓</button>
                            <button onClick={() => applyForDay(d.date, 'absent-other')}>✕</button>
                            <button onClick={() => applyForDay(d.date, 'sick')}>Б</button>
                            <button className="danger" onClick={() => cancelDay(d.date)}>Отм</button>
                            <button className="muted" onClick={() => clearDayMarks(d.date)}>Сбр.</button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.children.map((child, idx) => (
                      <tr key={child.childId}>
                        <td>{idx + 1}</td>
                        <td
                          className={child.type === 'paid' ? 'type-paid-soft fio-cell' : 'type-voucher-soft fio-cell'}
                          onClick={() => openProfile(child.childId)}
                          title={child.childName}
                          style={{ cursor: 'pointer' }}
                        >
                          <div>{child.childName}</div>
                          {child.transferMeta?.note ? (
                            <div style={{ fontSize: 11, color: '#8fb0d8', marginTop: 4 }}>{child.transferMeta.note}</div>
                          ) : null}
                        </td>
                        {sheet.dates.map((d) => {
                          const sState = sessionState[d.date] || '';
                          const val = marks[child.childId]?.[d.date] || '';
                          const locked = isChildLockedForDate(child, d.date);
                          return (
                            <td key={`${child.childId}-${d.date}`} className="date-head">
                              {sState === 'cancelled' ? (
                                <span style={{ color: '#ff6978' }}>Отм</span>
                              ) : locked ? (
                                <span style={{ color: '#6f87aa', fontSize: 11 }}>→</span>
                              ) : (
                                <button className="attendance-mark" onClick={() => onCellClick(child.childId, d.date)}>{markView[val]}</button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!sheet.children.length && (
                      <tr><td colSpan={2 + sheet.dates.length}>Нет детей в группе</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="panel attendance-legend" style={{ marginTop: 10 }}>
                <div className="legend-title">Инструкция по табелю</div>
                <div className="legend-row">
                  <span className="legend-pill"><b>✓</b> посещение</span>
                  <span className="legend-pill"><b>✕</b> пропуск</span>
                  <span className="legend-pill"><b>Б</b> больничный</span>
                  <span className="legend-pill"><b>Отм</b> отмена занятия студией</span>
                </div>
                <div className="legend-row">
                  <span className="legend-tag paid">Платник</span>
                  <span className="legend-tag voucher">Ваучер</span>
                </div>
              </div>
            </>
          )}
      </>

      {dateEditorOpen && (
        <Modal title="Изменить даты табеля" onClose={() => setDateEditorOpen(false)}>
          <div style={{ color: '#97a7c3', marginBottom: 10 }}>Нажмите на день: включить/выключить дату в табеле.</div>
          <div className="mini-calendar-weekdays">
            <div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>
          </div>
          <div className="mini-calendar-grid">
            {calendarDays(dateFrom).map((day) => {
              if (day.isBlank) return <div key={day.key} className="mini-day blank" />;
              const selected = sheet.dates.some((d) => d.date === day.date);
              return (
                <button key={day.key} className={`mini-day${selected ? ' selected' : ''}`} onClick={() => toggleCalendarDate(day.date)}>
                  {day.day}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button className="muted" onClick={clearAllDatesInMonth}>Очистить все даты месяца</button>
            <button className="primary" onClick={() => setDateEditorOpen(false)}>Готово</button>
          </div>
        </Modal>
      )}

      {selectedChild && (
        <Modal title="Карточка ребенка" onClose={() => setSelectedChild(null)}>
          <div className={`child-sheet ${selectedChild.type === 'paid' ? 'paid' : 'voucher'}`}>
            <div className="child-sheet-head">
              <div className="child-sheet-name">{selectedChild.profile?.childFullName || '—'}</div>
              <span className={`child-sheet-type ${selectedChild.type === 'paid' ? 'paid' : 'voucher'}`}>
                {selectedChild.type === 'paid' ? 'Платно' : 'Ваучер'}
              </span>
            </div>
            <div className="child-sheet-grid">
              <div className="child-sheet-row"><span>ИИН</span><b>{selectedChild.profile?.childIIN || '—'}</b></div>
              <div className="child-sheet-row"><span>Дата рождения</span><b>{selectedChild.profile?.childBirthDate || '—'}</b></div>
              <div className="child-sheet-row"><span>Возраст</span><b>{selectedChild.profile?.childAge ?? '—'}</b></div>
              <div className="child-sheet-row"><span>Телефон родителя</span><b>{selectedChild.profile?.parentPhone || '—'}</b></div>
              <div className="child-sheet-row"><span>ФИО родителя</span><b>{selectedChild.profile?.parentFullName || '—'}</b></div>
              <div className="child-sheet-row"><span>Дата зачисления</span><b>{selectedChild.profile?.enrollmentDate || '—'}</b></div>
            </div>
            {selectedChild.type === 'paid' && (
              <div className="child-sheet-grid" style={{ marginTop: 10 }}>
                <div className="child-sheet-row"><span>Последняя оплата</span><b>{selectedChild.profile?.lastPaymentDate || '—'}</b></div>
                <div className="child-sheet-row"><span>Уроков после оплаты</span><b>{selectedChild.profile?.lessonsCount ?? '—'}</b></div>
                <div className="child-sheet-row"><span>Текущий цикл</span><b>{selectedChild.profile?.lessonsCount ?? 0}/{selectedChild.profile?.cycleLength || 8}</b></div>
              </div>
            )}
            {selectedChild.type === 'voucher' && (
              <div className="child-sheet-grid" style={{ marginTop: 10 }}>
                <div className="child-sheet-row"><span>ИИН родителя</span><b>{selectedChild.profile?.parentIIN || '—'}</b></div>
                <div className="child-sheet-row"><span>Email родителя</span><b>{selectedChild.profile?.parentEmail || '—'}</b></div>
              </div>
            )}
            {selectedChild.type === 'paid' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="primary" onClick={() => openTransferModal(selectedChild)}>Перевести в другую группу</button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {transferModalData && selectedChild?.type === 'paid' && (
        <Modal title="Перевод в другую группу" onClose={() => !transferSaving && setTransferModalData(null)}>
          <div className="form-grid">
            <label>
              Город
              <select
                value={transferModalData.cityId || ''}
                onChange={(e) => setTransferModalData((prev) => ({ ...prev, cityId: e.target.value, studioId: '', courseId: '', groupId: '' }))}
              >
                <option value="">Выберите город</option>
                {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
              </select>
            </label>
            <label>
              Студия
              <select
                value={transferModalData.studioId || ''}
                onChange={(e) => setTransferModalData((prev) => ({ ...prev, studioId: e.target.value, courseId: '', groupId: '' }))}
              >
                <option value="">Выберите студию</option>
                {transferStudios.map((studio) => <option key={studio.id} value={studio.id}>{studio.name}</option>)}
              </select>
            </label>
            <label>
              Кружок
              <select
                value={transferModalData.courseId || ''}
                onChange={(e) => setTransferModalData((prev) => ({ ...prev, courseId: e.target.value, groupId: '' }))}
              >
                <option value="">Выберите кружок</option>
                {transferCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </label>
            <label>
              Группа
              <select
                value={transferModalData.groupId || ''}
                onChange={(e) => setTransferModalData((prev) => ({ ...prev, groupId: e.target.value }))}
              >
                <option value="">Выберите группу</option>
                {transferGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <label>
              Дата перевода
              <input type="date" value={transferModalData.effectiveDate || ''} onChange={(e) => setTransferModalData((prev) => ({ ...prev, effectiveDate: e.target.value }))} />
            </label>
            <div className="full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="muted" onClick={() => setTransferModalData(null)} disabled={transferSaving}>Отмена</button>
              <button type="button" className="primary" onClick={submitTransferChild} disabled={transferSaving}>
                {transferSaving ? 'Перевод...' : 'Сохранить перевод'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
